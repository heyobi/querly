// Pure helpers (no DuckDB, no Capacitor): file kinds, readers, names, and which SQL needs Pro.
//
// Free: viewing every data file as a table (CSV/TSV/TXT, JSON, Excel, Parquet, SQLite), editing and saving delimited
//       text, sharing as CSV, DuckDB SQL on in-memory tables, CSV/TSV and JSON files up to FREE_FILE_MB, notebooks,
//       lessons, examples, table results, CSV export, one database.
// Pro (one-time purchase): SQL on Parquet, Excel and SQLite files, spatial SQL with the map view, charts, export to
//       Parquet / Excel / JSON, larger files, more than one database and database snapshots (backup / restore).

export const FREE_FILE_MB = 25;

export type FileKind = 'csv' | 'parquet' | 'json' | 'geojson' | 'excel' | 'sqlite' | 'spatial' | 'snapshot' | 'notebook' | 'other';

/** Plain text that is not a table (notes, logs, code): shown read-only, one line per row. */
const TEXT_EXT = ['md', 'markdown', 'log', 'text', 'conf', 'cfg', 'ini', 'yaml', 'yml', 'toml', 'xml', 'html', 'htm', 'py', 'pyi', 'js', 'ts', 'sh', 'env', 'properties', 'rst', 'out', 'err'];
const ext = (name: string) => (name.includes('.') ? name.toLowerCase().split('.').pop() ?? '' : '');
export const isTextLines = (name: string) => TEXT_EXT.includes(ext(name));
/** Extensions the file picker offers (everything Querly can import). */
export const PICKER_ACCEPT = ['csv', 'tsv', 'txt', 'psv', 'tab', 'dat', 'prn', ...TEXT_EXT, 'parquet', 'pq', 'json', 'jsonl', 'ndjson', 'geojson', 'xlsx',
  'sqlite', 'sqlite3', 'db', 'shp', 'gpkg', 'fgb', 'kml', 'gpx', 'qsnap', 'ipynb', 'sql'].map((e) => '.' + e).join(',');

export function kindOf(name: string): FileKind {
  const e = ext(name);
  if (['csv', 'tsv', 'txt', 'psv', 'tab', 'dat', 'prn'].includes(e) || TEXT_EXT.includes(e)) return 'csv';
  if (['parquet', 'pq'].includes(e)) return 'parquet';
  if (['json', 'jsonl', 'ndjson'].includes(e)) return 'json';
  if (e === 'geojson') return 'geojson';
  if (e === 'xlsx') return 'excel';
  if (['sqlite', 'sqlite3', 'db'].includes(e)) return 'sqlite';
  if (['shp', 'gpkg', 'fgb', 'kml', 'gpx'].includes(e)) return 'spatial';
  if (e === 'qsnap') return 'snapshot';
  if (['ipynb', 'sql'].includes(e)) return 'notebook';
  return 'other';
}

export const isProKind = (k: FileKind) => k === 'parquet' || k === 'excel' || k === 'sqlite' || k === 'spatial' || k === 'geojson';

/** Files the table viewer opens. Viewing is free for all of them; SQL on Pro kinds stays Pro. */
export const viewableKind = (k: FileKind) => k === 'csv' || k === 'json' || k === 'excel' || k === 'parquet' || k === 'sqlite';
/** Files the viewer can edit and save in place (delimited text). Other kinds offer "Edit a CSV copy". */
export const editableKind = (k: FileKind) => k === 'csv';
/** Pro is needed to import these at all (spatial files have no table viewer). */
export const importNeedsPro = (k: FileKind) => isProKind(k) && !viewableKind(k);

const lit = (name: string) => `'${name.replace(/'/g, "''")}'`;

/** A SQL expression that reads the file, used by "Query this file". */
export function readerFor(name: string): string {
  switch (kindOf(name)) {
    case 'excel': return `read_xlsx(${lit(name)})`;
    case 'json': return `read_json_auto(${lit(name)})`;
    case 'geojson': case 'spatial': return `ST_Read(${lit(name)})`;
    case 'sqlite': return `sqlite_scan(${lit(name)}, 'table_name')`;
    default: return lit(name);
  }
}

/** Table name derived from a file name: "Sales 2024.csv" → sales_2024. */
export function tableNameFor(file: string): string {
  const base = file.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'data';
  return /^[0-9]/.test(base) ? `t_${base}` : base;
}

export function uniqueName(name: string, existing: string[]): string {
  const clean = name.replace(/[/\\:*?"<>|]+/g, '_').replace(/^\.+/, '').trim() || 'data';
  if (!existing.includes(clean)) return clean;
  const dot = clean.lastIndexOf('.');
  const base = dot > 0 ? clean.slice(0, dot) : clean, ext = dot > 0 ? clean.slice(dot) : '';
  let i = 2;
  while (existing.includes(`${base}-${i}${ext}`)) i++;
  return `${base}-${i}${ext}`;
}

/** Strip comments and string contents' surroundings so keyword checks do not fire on comments. */
const code = (sql: string) => sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');

/** Name of the Pro feature this SQL uses, or null when it runs in the free version. */
export function proFeature(sql: string): string | null {
  const s = code(sql).toLowerCase();
  if (/\.parquet\b|\bread_parquet\b|\bparquet_(scan|metadata|schema)\b|format\s*'?parquet/.test(s)) return 'Parquet';
  if (/\.xlsx\b|\bread_xlsx\b|format\s*'?xlsx/.test(s)) return 'Excel';
  if (/\bsqlite_(scan|attach)\b|\.sqlite3?\b|type\s+sqlite/.test(s)) return 'SQLite';
  if (/\bst_[a-z0-9_]+\s*\(|\bspatial\b|\bgeometry\b/.test(s)) return 'Spatial';
  return null;
}
