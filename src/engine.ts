// DuckDB engine: DuckDB-Wasm in a Web Worker (public/querly.worker.js), databases kept as snapshots, data files in
// the Files app.
//
// Databases: DuckDB runs in memory. After every change a snapshot (EXPORT DATABASE as Parquet + schema.sql) is written
// to app storage and loaded again (IMPORT DATABASE) when the database is opened. One database runs at a time.
// Data files: CSV / Parquet / JSON / Excel / SQLite files imported by the user live in Documents/Data. A file is
// registered with DuckDB (in memory) the first time a query mentions its name, so `SELECT * FROM 'sales.csv'` just works.
import * as duckdb from '@duckdb/duckdb-wasm';
import type { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import { DataType, type Field as ArrowField, type Schema } from 'apache-arrow';
import { list, readBlob, readBytes, readText, remove, stat, writeBlob, writeLarge, writeText } from './storage';
import { uid } from './notebook';
import { uniqueName } from './features';

export interface Field { name: string; dataTypeID: number; type: string }
export interface ResultSet { fields: Field[]; rows: unknown[][]; rowCount: number; affectedRows: number; truncated?: boolean }
export interface ExecOk { ms: number; notices: { severity: string; message: string }[]; results: ResultSet[]; written?: string[] }
export interface PgError { message: string; detail?: string; hint?: string; position?: string; code?: string }
export interface Database { id: string; name: string; created: number }
export interface Meta { schema: Record<string, string[]>; functions: string[]; tables: { name: string; kind: string; rows: number | null }[] }
export interface DataFile { name: string; size: number; mtime: number }

export const MAX_ROWS = 5000;
const STATE_FILE = 'databases.json';
const DATA = 'Data';
const snap = (id: string) => `db/${id}.qsnap`;

let db: duckdb.AsyncDuckDB | null = null;
let worker: Worker | null = null;
let conn: AsyncDuckDBConnection | null = null;
let dbs: Database[] = [];
let activeId = '';
let startPromise: Promise<void> | null = null;
let dirty = false;
let saveTimer: number | undefined;
let meta: Meta = { schema: {}, functions: [], tables: [] };
let duckVersion = '';
const registered = new Set<string>();
const memSnap = new Map<string, Blob>();
let queue: Promise<unknown> = Promise.resolve();

export type EngineState = { status: 'starting' | 'ready' | 'error'; version?: string; error?: string; db?: Database; extMode?: string };
let state: EngineState = { status: 'starting' };
const listeners = new Set<(s: EngineState) => void>();
function setState(s: Partial<EngineState>) {
  state = { ...state, ...s, db: active() };
  listeners.forEach((l) => l(state));
}
export function onState(fn: (s: EngineState) => void) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}
export const getState = () => state;
const metaListeners = new Set<(m: Meta) => void>();
export const onMeta = (fn: (m: Meta) => void) => (metaListeners.add(fn), () => metaListeners.delete(fn));
export const getMeta = () => meta;
export const databases = () => dbs;
export const active = () => dbs.find((d) => d.id === activeId);

/** Serialise everything that talks to DuckDB: one statement at a time, like a single session. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
}

// ---------- database list ----------
async function loadState() {
  const raw = await readText('lib', STATE_FILE);
  if (raw) try { const j = JSON.parse(raw); dbs = j.dbs ?? []; activeId = j.active ?? ''; } catch { dbs = []; }
  if (!dbs.length) {
    dbs = [{ id: 'main', name: 'main', created: Date.now() }];
    activeId = 'main';
    await saveState();
  }
  if (!dbs.some((d) => d.id === activeId)) activeId = dbs[0].id;
}
const saveState = () => writeText('lib', STATE_FILE, JSON.stringify({ dbs, active: activeId }));

// ---------- snapshot container: "QSNAP1\n" + JSON index + "\n" + file bytes ----------
export function packSnapshot(files: { name: string; data: Uint8Array }[]): Blob {
  const index = JSON.stringify({ format: 'querly-snapshot', duckdb: duckVersion, files: files.map((f) => ({ name: f.name, size: f.data.length })) });
  return new Blob(['QSNAP1\n', index, '\n', ...files.map((f) => f.data as BlobPart)], { type: 'application/octet-stream' });
}
export async function unpackSnapshot(blob: Blob): Promise<{ name: string; data: Uint8Array }[]> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const head = new TextDecoder().decode(bytes.subarray(0, 7));
  if (head !== 'QSNAP1\n') throw new Error('Not a Querly snapshot');
  const nl = bytes.indexOf(10, 7);
  const index = JSON.parse(new TextDecoder().decode(bytes.subarray(7, nl))) as { files: { name: string; size: number }[] };
  let off = nl + 1;
  return index.files.map((f) => { const data = bytes.slice(off, off + f.size); off += f.size; return { name: f.name, data }; });
}

// ---------- worker ----------
function workerCall(w: Worker, msg: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => { ch.port1.close(); resolve(e.data); };
    w.postMessage(msg, [ch.port2]);
  });
}

async function spawn() {
  if (db) { try { await db.terminate(); } catch { /* already gone */ } }
  registered.clear();
  worker = new Worker(new URL('/querly.worker.js', location.href).href);
  const w = worker;
  db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), w);
  await db.instantiate(new URL('/duckdb/duckdb-eh.wasm', location.href).href);
  // Extensions are official DuckDB builds shipped inside the app; they are loaded from our own files, so the signature
  // check that only knows the online repository is switched off.
  await db.open({ path: ':memory:', allowUnsignedExtensions: true, query: { castBigIntToDouble: false, castDecimalToDouble: true } });
  const probe = await workerCall(w, { __q: 'probe' });
  let mode = 'files';
  if (!probe.ok) {
    // Synchronous requests to the app's own files are not possible here: fetch every extension now and pass blob URLs.
    mode = 'blobs';
    const m = await (await fetch('/duckdb/manifest.json')).json() as { version: string; extensions: string[] };
    for (const name of m.extensions) {
      const b = await (await fetch(`/duckdb/ext/${m.version}/wasm_eh/${name}.duckdb_extension.wasm`)).blob();
      await workerCall(w, { __q: 'blob', name, url: `${URL.createObjectURL(b)}#/${name}.duckdb_extension.wasm` });
    }
  }
  conn = await db.connect();
  duckVersion = (await db.getVersion()).replace(/^v?/, 'v');
  // Known extensions install and load on first use, from the app's own files (see querly.worker.js).
  await conn.query(`SET autoinstall_known_extensions = true; SET autoload_known_extensions = true`);
  return mode;
}

async function boot(): Promise<void> {
  setState({ status: 'starting', error: undefined });
  try {
    if (!dbs.length) await loadState();
    const mode = await spawn();
    const d = active()!;
    const blob = memSnap.get(d.id) ?? (await readBlob('lib', snap(d.id)));
    if (blob && blob.size) await restore(blob);
    setState({ status: 'ready', version: duckVersion, extMode: mode });
    void refreshMeta();
  } catch (e) {
    setState({ status: 'error', error: errMsg(e).message });
    throw e;
  }
}

async function restore(blob: Blob) {
  const files = await unpackSnapshot(blob);
  const schema = files.find((f) => f.name.endsWith('schema.sql'));
  if (schema) await ensureFiles(new TextDecoder().decode(schema.data));
  const dirName = `restore_${uid()}`;
  for (const f of files) if (!f.name.endsWith('load.sql')) await db!.registerFileBuffer(`${dirName}/${f.name.split('/').pop()}`, f.data);
  // load.sql refers to the export directory by name; rewrite it to where we registered the files.
  const load = files.find((f) => f.name.endsWith('load.sql'));
  if (load) {
    const text = new TextDecoder().decode(load.data);
    const fixed = text.replace(/'[^']*?\/([^/']+\.(parquet|csv))'/g, `'${dirName}/$1'`);
    await db!.registerFileBuffer(`${dirName}/load.sql`, new TextEncoder().encode(fixed));
  }
  await conn!.query(`IMPORT DATABASE '${dirName}'`);
  for (const f of files) await db!.dropFile(`${dirName}/${f.name.split('/').pop()}`).catch(() => {});
}

export function start(): Promise<void> {
  startPromise = serial(boot);
  return startPromise;
}
export async function ready() {
  if (!startPromise) start();
  return startPromise!;
}

// ---------- values ----------
function typeName(f: ArrowField): string {
  const ext = f.metadata?.get('ARROW:extension:name') ?? '';
  if (/geoarrow|geometry/i.test(ext)) return 'GEOMETRY';
  const t = f.type as unknown as { typeId: number; bitWidth?: number; isSigned?: boolean; precision?: number; scale?: number; unit?: number; timezone?: string | null; children?: ArrowField[]; dictionary?: unknown };
  if (DataType.isDictionary(f.type)) return 'ENUM';
  if (DataType.isInt(f.type)) {
    const w = t.bitWidth;
    const n = w === 8 ? 'TINYINT' : w === 16 ? 'SMALLINT' : w === 32 ? 'INTEGER' : 'BIGINT';
    return t.isSigned ? n : `U${n}`;
  }
  if (DataType.isFloat(f.type)) return String(f.type) === 'Float32' ? 'FLOAT' : 'DOUBLE';
  if (DataType.isDecimal(f.type)) return `DECIMAL(${t.precision},${t.scale})`;
  if (DataType.isUtf8(f.type) || DataType.isLargeUtf8(f.type)) return 'VARCHAR';
  if (DataType.isBool(f.type)) return 'BOOLEAN';
  if (DataType.isDate(f.type)) return 'DATE';
  if (DataType.isTimestamp(f.type)) return t.timezone ? 'TIMESTAMPTZ' : 'TIMESTAMP';
  if (DataType.isTime(f.type)) return 'TIME';
  if (DataType.isInterval(f.type)) return 'INTERVAL';
  if (DataType.isBinary(f.type) || DataType.isLargeBinary(f.type) || DataType.isFixedSizeBinary(f.type)) return 'BLOB';
  if (DataType.isList(f.type) || DataType.isFixedSizeList(f.type)) return `${t.children?.[0] ? typeName(t.children[0]) : ''}[]`;
  if (DataType.isStruct(f.type)) return 'STRUCT';
  if (DataType.isMap(f.type)) return 'MAP';
  if (DataType.isNull(f.type)) return 'NULL';
  return String(f.type).toUpperCase();
}

const pad = (n: number, l = 2) => String(n).padStart(l, '0');
function fmtDate(ms: number, withTime: boolean, tz: boolean) {
  const d = new Date(ms);
  if (isNaN(d.getTime())) return String(ms);
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  if (!withTime) return date;
  const frac = d.getUTCMilliseconds() ? `.${pad(d.getUTCMilliseconds(), 3)}` : '';
  return `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${frac}${tz ? '+00' : ''}`;
}
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export function plain(v: unknown, type = ''): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') { const n = Number(v); return Number.isSafeInteger(n) ? n : v.toString(); }
  if (typeof v === 'number') {
    if (type === 'DATE') return fmtDate(v, false, false);
    if (type === 'TIMESTAMP' || type === 'TIMESTAMPTZ') return fmtDate(v, true, type === 'TIMESTAMPTZ');
    if (type === 'TIME') { const s = Math.floor(v / 1000); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; }
    return v;
  }
  if (v instanceof Date) return fmtDate(v.getTime(), type !== 'DATE', type === 'TIMESTAMPTZ');
  if (v instanceof Uint8Array) {
    if (type === 'GEOMETRY') return hex(v);
    return { $bytes: Array.from(v.subarray(0, 64)), length: v.length };
  }
  if (ArrayBuffer.isView(v)) return Array.from(v as unknown as ArrayLike<number>, (x) => plain(x));
  if (Array.isArray(v)) return v.map((x) => plain(x, type.endsWith('[]') ? type.slice(0, -2) : ''));
  if (typeof v === 'object') {
    const o = v as { toArray?: () => unknown[]; toJSON?: () => unknown };
    const src = typeof o.toJSON === 'function' ? o.toJSON() : v;
    if (Array.isArray(src)) return src.map((x) => plain(x, type.endsWith('[]') ? type.slice(0, -2) : ''));
    if (src && typeof src === 'object') return Object.fromEntries(Object.entries(src as Record<string, unknown>).map(([k, x]) => [k, plain(x)]));
    return src;
  }
  return v;
}

function errMsg(e: unknown): PgError {
  const m = (e as Error)?.message ?? String(e);
  const lines = m.split('\n');
  const [head, ...rest] = lines;
  const hintLine = rest.find((l) => /^(Did you mean|Candidate)/.test(l.trim()));
  return { message: head, detail: rest.filter((l) => l !== hintLine).join('\n').trim() || undefined, hint: hintLine?.trim() };
}

// ---------- files ----------
export async function listFiles(): Promise<DataFile[]> {
  const names = (await list('docs', DATA)).filter((n) => !n.endsWith('.part'));
  const out: DataFile[] = [];
  for (const n of names) { const s = await stat('docs', `${DATA}/${n}`); if (s) out.push({ name: n, size: s.size, mtime: s.mtime }); }
  return out.sort((a, b) => b.mtime - a.mtime);
}

export async function importFile(name: string, data: Blob, onProgress?: (done: number) => void): Promise<string> {
  const existing = (await list('docs', DATA));
  const n = uniqueName(name, existing);
  await writeLarge('docs', `${DATA}/${n}`, data, onProgress);
  return n;
}

export async function deleteFile(name: string) {
  await remove('docs', `${DATA}/${name}`);
  if (registered.has(name)) { registered.delete(name); await serial(() => db!.dropFile(name)).catch(() => {}); }
}

export async function renameFile(from: string, to: string): Promise<string> {
  const bytes = await readBytes('docs', `${DATA}/${from}`);
  if (!bytes) throw new Error('File not found');
  const n = uniqueName(to, await list('docs', DATA));
  await writeLarge('docs', `${DATA}/${n}`, new Blob([bytes as BlobPart]));
  await deleteFile(from);
  return n;
}

export const fileBytes = (name: string) => readBytes('docs', `${DATA}/${name}`);

/** Register every library file that `text` mentions, so DuckDB can read it by name. */
async function ensureFiles(text: string) {
  const lower = text.toLowerCase();
  const names = await list('docs', DATA);
  for (const n of names) {
    if (registered.has(n) || !lower.includes(n.toLowerCase())) continue;
    const bytes = await readBytes('docs', `${DATA}/${n}`);
    if (!bytes) continue;
    await db!.registerFileBuffer(n, bytes);
    registered.add(n);
  }
}

// ---------- queries ----------
const WRITES = /\b(create|insert|update|delete|drop|alter|truncate|import|attach|detach|comment|merge|upsert|replace|rename|call\s+dbgen|call\s+dsdgen)\b/i;
const COPY_TO = /\bcopy\b[\s\S]*?\bto\s+'([^']+)'/gi;

async function runQuery(sql: string, maxRows = MAX_ROWS): Promise<ResultSet> {
  const reader = await conn!.send(sql, true);
  // The schema is known once the stream is open (it may carry no batches at all, e.g. for DDL).
  await (reader as unknown as { open?: () => Promise<unknown> }).open?.();
  let schema = reader.schema as Schema | undefined;
  let fields: Field[] = schema ? schema.fields.map((f, i) => ({ name: f.name, dataTypeID: i, type: typeName(f) })) : [];
  const rows: unknown[][] = [];
  let truncated = false;
  for await (const batch of reader) {
    if (!schema) { schema = batch.schema; fields = schema.fields.map((f, i) => ({ name: f.name, dataTypeID: i, type: typeName(f) })); }
    const cols = fields.map((_, i) => batch.getChildAt(i));
    for (let r = 0; r < batch.numRows; r++) {
      if (rows.length >= maxRows) { truncated = true; break; }
      rows.push(cols.map((c, i) => plain(c?.get(r), fields[i].type)));
    }
    if (truncated) break;
  }
  if (truncated) await conn!.cancelSent().catch(() => false);
  const affected = fields.length === 1 && fields[0].name === 'Count' && rows.length === 1 && /^\s*(insert|update|delete|create|copy|merge)/i.test(sql) ? Number(rows[0][0]) : 0;
  return { fields: affected ? [] : fields, rows: affected ? [] : rows, rowCount: affected ? 0 : rows.length, affectedRows: affected, truncated };
}

export async function exec(sql: string): Promise<ExecOk> {
  await ready();
  return serial(async () => {
    const t0 = performance.now();
    try {
      await ensureFiles(sql);
      const targets = [...sql.matchAll(COPY_TO)].map((m) => m[1]).filter((n) => !n.includes('/') && !n.startsWith('restore_'));
      for (const n of targets) await db!.registerEmptyFileBuffer(n).catch(() => {});
      let rs: ResultSet;
      try {
        rs = await runQuery(sql);
      } catch (e) {
        // Functions such as ST_Point do not autoload their extension; DuckDB names it in the error. Load it and retry.
        const m = /exists in the (\w+) extension/.exec((e as Error)?.message ?? '');
        if (!m) throw e;
        await conn!.query(`LOAD ${m[1]}`);
        rs = await runQuery(sql);
      }
      const ms = performance.now() - t0;
      // COPY … TO 'name.ext' writes into the Data folder (visible in the Files app).
      const written: string[] = [];
      for (const n of targets) {
        try {
          const bytes = await db!.copyFileToBuffer(n);
          await writeLarge('docs', `${DATA}/${n}`, new Blob([bytes as BlobPart]));
          await db!.dropFile(n).catch(() => {});
          await db!.registerFileBuffer(n, bytes);
          registered.add(n);
          written.push(n);
        } catch { /* not a file target */ }
      }
      if (WRITES.test(sql)) markDirty();
      if (/\b(create|drop|alter|import|attach|detach|rename|call)\b/i.test(sql)) setTimeout(() => void refreshMeta(), 0);
      return { ms, notices: [], results: [rs], written };
    } catch (e) {
      if (WRITES.test(sql)) markDirty();
      throw errMsg(e);
    }
  });
}

/**
 * Queries for the file viewer: temporary tables only, so the database is not marked as changed and the table list is
 * not refreshed. Loads an extension named in a "exists in the … extension" error and retries, like exec().
 */
export async function viewerQuery(sql: string, maxRows = MAX_ROWS): Promise<ResultSet> {
  await ready();
  return serial(async () => {
    try {
      await ensureFiles(sql);
      try {
        return await runQuery(sql, maxRows);
      } catch (e) {
        const m = /exists in the (\w+) extension/.exec((e as Error)?.message ?? '');
        if (!m) throw e;
        await conn!.query(`LOAD ${m[1]}`);
        return await runQuery(sql, maxRows);
      }
    } catch (e) {
      throw errMsg(e);
    }
  });
}

/** Replace a file in the Data folder (the viewer's Save). The next query reads the new bytes. */
export async function writeDataFile(name: string, data: Blob): Promise<void> {
  await writeLarge('docs', `${DATA}/${name}`, data);
  if (registered.has(name)) { registered.delete(name); await serial(() => db!.dropFile(name)).catch(() => {}); }
}

/** Run a query and return its full result as a file in the given format (for export / share). */
export async function exportQuery(sql: string, format: 'csv' | 'parquet' | 'json' | 'xlsx', copyOptions?: string): Promise<Blob> {
  await ready();
  return serial(async () => {
    await ensureFiles(sql);
    const name = `export_${uid()}.${format}`;
    await db!.registerEmptyFileBuffer(name);
    const opts = copyOptions ?? (format === 'csv' ? '(HEADER, DELIMITER \',\')' : format === 'parquet' ? '(FORMAT parquet, COMPRESSION zstd)' : format === 'json' ? '(FORMAT json, ARRAY true)' : '(FORMAT xlsx, HEADER true)');
    const body = sql.trim().replace(/;\s*$/, '');
    try {
      await conn!.query(`COPY (${body}) TO '${name}' ${opts}`);
      const bytes = await db!.copyFileToBuffer(name);
      return new Blob([bytes as BlobPart], { type: format === 'csv' ? 'text/csv' : format === 'json' ? 'application/json' : 'application/octet-stream' });
    } catch (e) {
      throw errMsg(e);
    } finally {
      await db!.dropFile(name).catch(() => {});
    }
  });
}

/** Bundled extensions DuckDB knows about, and whether each is loaded in the running database. */
export async function extensionStatus(): Promise<Record<string, boolean>> {
  await ready();
  const r = await serial(() => runQuery(`SELECT extension_name, loaded FROM duckdb_extensions()`, 1000));
  return Object.fromEntries((r.rows as [string, boolean][]).map(([n, l]) => [n, l]));
}

export async function loadExtension(id: string): Promise<void> {
  await ready();
  await serial(async () => { try { await conn!.query(`LOAD ${id}`); } catch (e) { throw errMsg(e); } });
  void refreshMeta();
}

export async function refreshMeta(): Promise<Meta> {
  if (!conn) return meta;
  try {
    meta = await serial(async () => {
      const cols = await runQuery(`select case when table_schema = 'main' then table_name else table_schema || '.' || table_name end t, column_name c
        from information_schema.columns where table_catalog = current_database() order by table_schema, table_name, ordinal_position`, 100000);
      const schema: Record<string, string[]> = {};
      for (const [t, c] of cols.rows as [string, string][]) (schema[t] ??= []).push(c);
      const tabs = await runQuery(`select case when schema_name = 'main' then table_name else schema_name || '.' || table_name end, 'table', estimated_size from duckdb_tables() where database_name = current_database()
        union all select case when schema_name = 'main' then view_name else schema_name || '.' || view_name end, 'view', null from duckdb_views() where not internal and database_name = current_database() order by 1`, 10000);
      if (!meta.functions.length) {
        const fn = await runQuery(`select distinct function_name from duckdb_functions() where function_name not like '\\_%' escape '\\' and function_type in ('scalar','aggregate','table','macro','table_macro') order by 1`, 100000);
        meta.functions = (fn.rows as [string][]).map((r) => r[0]);
      }
      return { schema, functions: meta.functions, tables: (tabs.rows as [string, string, number | null][]).map(([name, kind, rows]) => ({ name, kind, rows })) };
    });
    metaListeners.forEach((l) => l(meta));
  } catch { /* not running */ }
  return meta;
}

function markDirty() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void save(), 1500);
}

async function makeSnapshot(): Promise<Blob> {
  return serial(async () => {
    const dir = `snap_${uid()}`;
    await conn!.query(`EXPORT DATABASE '${dir}' (FORMAT parquet, COMPRESSION zstd)`);
    const files: { name: string; data: Uint8Array }[] = [];
    for (const f of await db!.globFiles(`${dir}/*`)) {
      files.push({ name: f.fileName.split('/').pop()!, data: await db!.copyFileToBuffer(f.fileName) });
      await db!.dropFile(f.fileName).catch(() => {});
    }
    return packSnapshot(files);
  });
}

export async function save(): Promise<void> {
  if (!dirty || state.status !== 'ready') return;
  dirty = false;
  const d = active();
  if (!d) return;
  try {
    const blob = await makeSnapshot();
    memSnap.set(d.id, blob);
    await writeBlob('lib', snap(d.id), blob);
  } catch (e) {
    dirty = true;
    console.error('snapshot failed', e);
  }
}

export async function exportSnapshot(): Promise<Blob> {
  await ready();
  return makeSnapshot();
}

// ---------- databases ----------
export async function createDatabase(name: string): Promise<Database> {
  const d: Database = { id: uid(), name, created: Date.now() };
  dbs.push(d);
  await saveState();
  return d;
}

export async function switchDatabase(id: string): Promise<void> {
  if (id === activeId) return;
  dirty = true;
  await save();
  activeId = id;
  meta = { schema: {}, functions: meta.functions, tables: [] };
  await saveState();
  await start();
}

export async function renameDatabase(id: string, name: string) {
  const d = dbs.find((x) => x.id === id);
  if (d) { d.name = name; await saveState(); setState({}); }
}

export async function deleteDatabase(id: string): Promise<void> {
  if (dbs.length === 1) throw new Error('Keep at least one database');
  dbs = dbs.filter((d) => d.id !== id);
  memSnap.delete(id);
  await remove('lib', snap(id));
  if (activeId === id) { activeId = dbs[0].id; await saveState(); await start(); } else await saveState();
}

/** Replace the active database with a snapshot (.qsnap). */
export async function importSnapshot(blob: Blob): Promise<void> {
  await unpackSnapshot(blob); // validates
  const d = active()!;
  memSnap.set(d.id, blob);
  await writeBlob('lib', snap(d.id), blob);
  dirty = false;
  await start();
}

export async function resetDatabase(): Promise<void> {
  clearTimeout(saveTimer);
  dirty = false;
  const d = active()!;
  memSnap.delete(d.id);
  await remove('lib', snap(d.id));
  await start();
}

export async function sizeOf(id: string): Promise<number> {
  const b = memSnap.get(id) ?? (await readBlob('lib', snap(id)));
  return b?.size ?? 0;
}

export const duckdbVersion = () => duckVersion;

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void save();
});
