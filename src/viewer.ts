// Table viewer and editor for data files: open a CSV, TSV, TXT, JSON, Excel, Parquet or SQLite file and see it as a
// table without writing SQL. Sort, search and filter work for every kind; delimited text (CSV/TSV/TXT) can also be
// edited cell by cell, with rows and columns added, removed and renamed, undo, and Save.
//
// How it works: the file is loaded into a table in a separate in-memory database, qv (attached on demand). It is never
// part of the user's database, its snapshots or the table list (TEMP tables would leak into EXPORT DATABASE).
// An extra column __r keeps the original row order; new rows get a value between their
// neighbours. Delimited text is read with every column as text (all_varchar), so saving writes back exactly what was
// read: "007" stays "007", dates keep their format, empty cells stay empty. Saving keeps the file's delimiter, quote
// character and header row.
import * as engine from './engine';
import type { PgError, ResultSet } from './engine';
import { editableKind, isCompressed, isTextLines, kindOf } from './features';
import { errorBox, fmtValue } from './results';
import { requirePro } from './pro';
import { t } from './i18n';
import { confirmBox, fmtBytes, h, icon, modal, promptBox, saveToFiles, sheet, shareFile, toast } from './ui';

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const qi = (s: string) => `"${s.replace(/"/g, '""')}"`;
const PAGE = 200;

interface CsvFormat { delim: string; quote: string; escape: string; header: boolean; encoding: string }
interface Col { name: string; type: string }
interface UndoStep { undo: () => Promise<void>; drop?: string }

export interface ViewerHooks {
  /** The file in the Data folder changed (Save) or a new one was added (CSV copy). */
  filesChanged(): Promise<void>;
  newNotebook(file: string): void;
  fileMenu(file: string): void;
  /** Open another file in a fresh viewer (after "Edit a CSV copy"). */
  open(file: string): void;
}

/** Tidy a value sniff_csv reports for a quote or escape character: empty or NUL means "use the default". */
const ch = (v: unknown, dflt: string) => {
  const s = v === null || v === undefined ? '' : String(v);
  return !s || s === '\0' || s === '(empty)' ? dflt : s;
};

/** asText: a file with an unknown extension whose bytes look like text; shown one line per row. */
export function openViewer(file: string, hooks: ViewerHooks, asText = false) {
  const kind = asText ? 'csv' : kindOf(file);
  const lines = asText || isTextLines(file);
  const editable = editableKind(kind) && !lines && !isCompressed(file); // notes, logs, code and .gz are shown read-only
  const id = `qv_${Math.random().toString(36).slice(2, 9)}`;
  const tn = (n: string) => `qv.${qi(n)}`;
  const T = tn(id);
  const q = (sql: string, max = engine.MAX_ROWS) => engine.viewerQuery(sql, max);

  let fmt: CsvFormat | null = null;
  let attached = '';
  let tables: string[] = [];
  let table = '';
  let cols: Col[] = [];
  let order: string[] = []; // column order on screen and in the saved file (ALTER ADD COLUMN always appends)
  let search = '';
  const filters = new Map<string, string>();
  let sort: { col: string; dir: 'ASC' | 'DESC' } | null = null;
  let total = 0, matched = 0, loaded = 0, loading = false;
  let dirty = false;
  let undo: UndoStep[] = [];
  let tmpN = 0;
  let closed = false;

  // ---------- DOM ----------
  const titleEl = h('div', { class: 'v-title' }, file);
  const saveBtn = h('button', { class: 'v-save', disabled: true, onclick: () => saveMenu() }, t('Save'));
  const searchEl = h('input', { class: 'search', type: 'search', placeholder: t('Search'), autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'search' }) as HTMLInputElement;
  const countEl = h('div', { class: 'v-count muted small' });
  const chipsEl = h('div', { class: 'v-chips' });
  const tabsEl = h('div', { class: 'v-tabs' });
  const bannerEl = h('div', { class: 'v-banner hidden' });
  const insightEl = h('div', { class: 'v-insight hidden' });
  const thead = h('thead');
  const tbody = h('tbody');
  const more = h('div', { class: 'v-more muted small' });
  const wrap = h('div', { class: 'v-wrap' }, h('table', { class: 'v-table' }, thead, tbody), more);
  const undoBtn = h('button', { class: 'btn', disabled: true, onclick: () => void doUndo() }, icon('undo'), t('Undo'));
  const foot = h('div', { class: 'v-foot' },
    h('button', { class: 'btn', onclick: () => void addRowForm() }, icon('plus'), t('Row')),
    h('button', { class: 'btn', onclick: () => void addColumn(order.length - 1) }, icon('plus'), t('Column')),
    undoBtn);
  const el = h('div', { class: 'viewer' },
    h('header', { class: 'bar' },
      h('button', { class: 'back', onclick: () => void close() }, icon('back'), t('Files')),
      titleEl,
      editable && saveBtn,
      !lines && h('button', { class: 'v-analyze', 'aria-label': t('Analyze with SQL & charts'), onclick: () => void close().then((ok) => ok && hooks.newNotebook(file)) }, icon('graph')),
      h('button', { class: 'more', 'aria-label': t('File actions'), onclick: () => moreMenu() }, icon('more'))),
    h('div', { class: 'v-tools' }, searchEl, countEl),
    tabsEl, insightEl, chipsEl, bannerEl, wrap,
    editable && foot);
  document.body.append(el);
  document.body.classList.add('in-viewer');

  const setDirty = (v: boolean) => {
    dirty = v;
    saveBtn.toggleAttribute('disabled', !v);
    titleEl.classList.toggle('dirty', v);
  };
  const pushUndo = (s: UndoStep) => {
    undo.push(s);
    while (undo.length > 40) { const old = undo.shift()!; if (old.drop) void q(`DROP TABLE IF EXISTS ${tn(old.drop)}`).catch(() => {}); }
    undoBtn.removeAttribute('disabled');
    setDirty(true);
  };

  // ---------- loading ----------
  async function create(src: string) {
    await q(`ATTACH IF NOT EXISTS ':memory:' AS qv; CREATE OR REPLACE TABLE ${T} AS SELECT * FROM ${src}; ALTER TABLE ${T} ADD COLUMN __r DOUBLE; UPDATE ${T} SET __r = rowid;`);
  }

  async function load() {
    const src = lit(file);
    if (kind === 'csv') {
      if (!fmt && lines) {
        // One line per row: separators that cannot appear in text, so nothing is split or unquoted.
        fmt = { delim: '\x1f', quote: '\x1e', escape: '\x1e', header: false, encoding: 'utf-8' };
      } else if (!fmt) {
        const s = await q(`SELECT Delimiter, Quote, Escape, HasHeader FROM sniff_csv(${src}, sample_size = 20480)`);
        const [d, qu, es, hh] = (s.rows[0] ?? []) as unknown[];
        const quote = ch(qu, '"');
        fmt = { delim: ch(d, ','), quote, escape: ch(es, quote), header: hh !== false, encoding: 'utf-8' };
        // Space-separated numbers (".txt" exports, YOLO labels…): the sniffer reports "," and one column.
        if (fmt.delim === ',') {
          const sample = await q(`SELECT content[1:8192] FROM read_text(${src})`).catch(() => null);
          const rows = String(sample?.rows[0]?.[0] ?? '').split(/\r?\n/).slice(0, 50).filter((l) => l.trim());
          if (rows.length > 1) rows.pop(); // the sample may cut the last line
          const n = rows.map((l) => (l.includes(',') ? -1 : l.split(' ').length));
          if (n.length && n[0] > 1 && n.every((x) => x === n[0])) fmt = { delim: ' ', quote: '"', escape: '"', header: false, encoding: 'utf-8' };
        }
      }
      const opts = () => `all_varchar = true, header = ${fmt!.header}, delim = ${lit(fmt!.delim)}, quote = ${lit(fmt!.quote)}, escape = ${lit(fmt!.escape)}, null_padding = true, strict_mode = false, encoding = ${lit(fmt!.encoding)}`;
      try {
        await create(`read_csv(${src}, ${opts()})`);
      } catch (e) {
        if (!/unicode|utf-?8|encod/i.test((e as PgError).message) || fmt.encoding !== 'utf-8') throw e;
        fmt.encoding = 'latin-1'; // older Excel exports; saved back as UTF-8
        await create(`read_csv(${src}, ${opts()})`);
      }
    } else if (kind === 'json') {
      await create(`read_json_auto(${src})`);
    } else if (kind === 'parquet') {
      await create(`read_parquet(${src})`);
    } else if (kind === 'excel') {
      try { await create(`read_xlsx(${src})`); } catch { await create(`read_xlsx(${src}, all_varchar = true)`); }
    } else if (kind === 'sqlite') {
      if (!attached) {
        attached = `${id}_db`;
        await q(`ATTACH ${src} AS ${qi(attached)} (TYPE sqlite, READ_ONLY)`);
        const r = await q(`SELECT table_name FROM duckdb_tables() WHERE database_name = ${lit(attached)} ORDER BY 1`);
        tables = r.rows.map((x) => String(x[0]));
        table = tables[0] ?? '';
      }
      if (!table) throw { message: t('This SQLite file has no tables.') } as PgError;
      await create(`${qi(attached)}.${qi(table)}`);
    }
    const c = await q(`SELECT column_name, data_type FROM duckdb_columns() WHERE database_name = 'qv' AND table_name = ${lit(id)} ORDER BY column_index`);
    cols = c.rows.map(([n, ty]) => ({ name: String(n), type: String(ty) })).filter((x) => x.name !== '__r');
    order = cols.map((x) => x.name);
    sort = null; filters.clear(); search = ''; searchEl.value = '';
    undo = []; undoBtn.setAttribute('disabled', '');
    setDirty(false);
  }

  const typeOf = (name: string) => cols.find((c) => c.name === name)?.type ?? 'VARCHAR';
  const contains = (c: string, v: string) => `contains(lower(CAST(${qi(c)} AS VARCHAR)), ${lit(v.toLowerCase())})`;
  function where() {
    const parts: string[] = [];
    if (search && order.length) parts.push(`(${order.map((c) => contains(c, search)).join(' OR ')})`);
    for (const [c, v] of filters) if (order.includes(c)) parts.push(contains(c, v));
    return parts.length ? parts.join(' AND ') : 'TRUE';
  }
  function orderBy() {
    if (!sort || !order.includes(sort.col)) return '__r';
    const c = qi(sort.col), d = sort.dir;
    // Text columns that hold numbers sort as numbers first, then as text.
    return typeOf(sort.col) === 'VARCHAR' ? `TRY_CAST(${c} AS DOUBLE) ${d} NULLS LAST, ${c} ${d} NULLS LAST, __r` : `${c} ${d} NULLS LAST, __r`;
  }
  const selectList = () => ['__r', ...order.map(qi)].join(', ');

  async function counts() {
    const r = await q(`SELECT count(*)::BIGINT, count(*) FILTER (WHERE ${where()})::BIGINT FROM ${T}`);
    total = Number(r.rows[0]?.[0] ?? 0);
    matched = Number(r.rows[0]?.[1] ?? 0);
    const filtered = !!search || filters.size > 0;
    countEl.textContent = `${filtered ? `${matched.toLocaleString()} / ` : ''}${total.toLocaleString()} ${t(total === 1 ? 'row' : 'rows')} · ${order.length} ${t(order.length === 1 ? 'column' : 'columns')}`;
  }

  /** Re-read the view. keep = keep the rows already loaded and the scroll position (after an edit). */
  async function refresh(keep = false) {
    const top = wrap.scrollTop;
    const n = keep ? Math.max(loaded, PAGE) : PAGE;
    await counts();
    const r = await q(`SELECT ${selectList()} FROM ${T} WHERE ${where()} ORDER BY ${orderBy()} LIMIT ${n}`, n);
    drawHead();
    tbody.replaceChildren();
    loaded = 0;
    appendRows(r);
    drawChips();
    wrap.scrollTop = keep ? top : 0;
  }

  async function loadMore() {
    if (loading || loaded >= matched || closed) return;
    loading = true;
    try {
      const r = await q(`SELECT ${selectList()} FROM ${T} WHERE ${where()} ORDER BY ${orderBy()} LIMIT ${PAGE} OFFSET ${loaded}`, PAGE);
      appendRows(r);
    } catch (e) { toast((e as PgError).message, 'err'); } finally { loading = false; }
  }
  wrap.addEventListener('scroll', () => { if (wrap.scrollTop + wrap.clientHeight > wrap.scrollHeight - 600) void loadMore(); }, { passive: true });

  // ---------- drawing ----------
  function drawHead() {
    thead.replaceChildren(h('tr', {},
      h('th', { class: 'rn' }, '#'),
      order.map((c, i) => h('th', { 'data-c': String(i), class: filters.has(c) ? 'filtered' : '' },
        h('span', { class: 'th-name' }, c),
        sort?.col === c && h('span', { class: 'th-sort' }, sort.dir === 'ASC' ? '▲' : '▼')))));
  }

  function appendRows(r: ResultSet) {
    const frag = document.createDocumentFragment();
    for (const row of r.rows) {
      loaded++;
      const tr = h('tr', { 'data-r': String(row[0]) }, h('td', { class: 'rn' }, String(loaded)));
      for (let i = 1; i < row.length; i++) {
        const v = fmtValue(row[i]);
        tr.append(h('td', { class: v.cls ?? '' }, v.cls === 'null' ? '' : v.text));
      }
      frag.append(tr);
    }
    tbody.append(frag);
    more.textContent = loaded < matched ? `${loaded.toLocaleString()} / ${matched.toLocaleString()} · ${t('scroll for more')}` : matched === 0 ? (search || filters.size ? t('No matching rows.') : t('No rows.')) : '';
  }

  function drawChips() {
    const chips: HTMLElement[] = [];
    if (sort) chips.push(h('button', { class: 'chip', onclick: () => { sort = null; void refresh(); } }, `${sort.dir === 'ASC' ? '▲' : '▼'} ${sort.col}`, icon('close')));
    for (const [c, v] of filters) chips.push(h('button', { class: 'chip', onclick: () => { filters.delete(c); void refresh(); } }, `${c} ∋ “${v}”`, icon('close')));
    chipsEl.replaceChildren(...chips);
    tabsEl.replaceChildren(...(tables.length > 1 ? tables.map((tb) => h('button', { class: `chip${tb === table ? ' on' : ''}`, onclick: () => void switchTable(tb) }, tb)) : []));
  }

  // ---------- interactions ----------
  let searchTimer: number | undefined;
  searchEl.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => { search = searchEl.value.trim(); void refresh().catch((e) => toast((e as PgError).message, 'err')); }, 250);
  });

  thead.addEventListener('click', (e) => {
    const th = (e.target as HTMLElement).closest('th[data-c]');
    if (th) columnMenu(order[Number(th.getAttribute('data-c'))]);
  });
  tbody.addEventListener('click', (e) => {
    const td = (e.target as HTMLElement).closest('td');
    const tr = td?.parentElement;
    if (!td || !tr) return;
    const r = Number(tr.getAttribute('data-r'));
    const ci = [...tr.children].indexOf(td) - 1;
    if (ci < 0) { if (editable) rowMenu(r, tr); return; }
    if (editable) void editCell(r, order[ci], td);
    else showValue(order[ci], td.textContent ?? '');
  });

  // ---------- overview and column stats ----------
  const isNum = (ty: string) => /INT|DOUBLE|FLOAT|DECIMAL|REAL|NUMERIC/.test(ty);
  const num = (c: string) => (isNum(typeOf(c)) ? `${qi(c)}::DOUBLE` : `TRY_CAST(${qi(c)} AS DOUBLE)`);
  const fmtN = (v: unknown) => { const x = Number(v); return !isFinite(x) ? '–' : Math.abs(x) >= 1e6 ? `${+(x / 1e6).toFixed(2)}M` : Math.abs(x) >= 1e4 ? Math.round(x).toLocaleString() : (+x.toFixed(2)).toLocaleString(); };

  /** A small card above the table: size, how complete the data is, and the range of every number column. */
  async function insight() {
    if (lines || !order.length) { insightEl.classList.add('hidden'); return; }
    const use = order.slice(0, 40);
    const parts = use.flatMap((c) => [`count(${qi(c)})`, `count(${num(c)})`, `min(${num(c)})`, `max(${num(c)})`, `avg(${num(c)})`]);
    const r = await q(`SELECT count(*)::BIGINT, ${parts.join(', ')} FROM ${T}`, 1);
    const row = r.rows[0] ?? [];
    const rows = Number(row[0] ?? 0);
    let filled = 0;
    const nums: { c: string; lo: unknown; hi: unknown; avg: unknown }[] = [];
    use.forEach((c, i) => {
      const [nn, nc, lo, hi, avg] = row.slice(1 + i * 5, 6 + i * 5);
      filled += Number(nn);
      const idLike = /(^|_)(id|code|zip|no)$|^id_|uuid/i.test(c); // ranges of IDs say nothing
      if (!idLike && Number(nc) > 0 && Number(nc) >= 0.9 * Number(nn)) nums.push({ c, lo, hi, avg });
    });
    const empty = rows && use.length ? 100 - (filled / (rows * use.length)) * 100 : 0;
    insightEl.replaceChildren(
      h('div', { class: 'vi-line' },
        h('b', {}, `${rows.toLocaleString()} ${t(rows === 1 ? 'row' : 'rows')}`), ` · ${order.length} ${t(order.length === 1 ? 'column' : 'columns')} · `,
        h('span', { class: empty < 1 ? 'vi-good' : empty > 20 ? 'vi-warn' : '' }, empty < 0.05 ? t('no empty cells') : `${empty < 1 ? empty.toFixed(1) : Math.round(empty)}% ${t('empty')}`)),
      nums.length ? h('div', { class: 'vi-nums' }, nums.slice(0, 6).map((x) =>
        h('button', { class: 'vi-num', onclick: () => void columnStats(x.c) },
          h('span', { class: 'vi-c' }, x.c),
          h('span', { class: 'vi-r' }, `${fmtN(x.lo)} – ${fmtN(x.hi)}`),
          h('span', { class: 'vi-a' }, `${t('avg')} ${fmtN(x.avg)}`)))) : '');
    insightEl.classList.remove('hidden');
  }

  /** Column at a glance: how full it is, distinct values, a histogram for numbers or the most common values. */
  async function columnStats(c: string) {
    const body = h('div', { class: 'cs' }, h('div', { class: 'muted small' }, t('Counting…')));
    modal(h('div', {}, h('div', { class: 'cs-title' }, c), body));
    try {
      const n = num(c);
      const base = await q(`SELECT count(*)::BIGINT, count(${qi(c)})::BIGINT, count(DISTINCT ${qi(c)})::BIGINT, count(${n})::BIGINT, min(${n}), max(${n}), avg(${n}), median(${n}) FROM ${T}`, 1);
      const [all, nn, distinct, nc, lo, hi, avg, med] = base.rows[0] ?? [];
      const numeric = Number(nc) > 0 && Number(nc) >= 0.9 * Number(nn);
      const stat = (label: string, v: string) => h('div', { class: 'cs-stat' }, h('div', { class: 'cs-v' }, v), h('div', { class: 'cs-l' }, label));
      const stats = h('div', { class: 'cs-stats' },
        stat(t('filled'), `${Number(all) ? Math.round((Number(nn) / Number(all)) * 100) : 0}%`),
        stat(t('distinct'), Number(distinct).toLocaleString()),
        ...(numeric ? [stat(t('min'), fmtN(lo)), stat(t('max'), fmtN(hi)), stat(t('avg'), fmtN(avg)), stat(t('median'), fmtN(med))] : []));
      const bars: { label: string; n: number }[] = [];
      const discrete = numeric && Number(distinct) <= 15;
      if (discrete) {
        // Few distinct numbers (ratings, quantities): one bar per value, labelled.
        const r = await q(`SELECT ${n} AS v, count(*)::BIGINT FROM ${T} WHERE ${n} IS NOT NULL GROUP BY 1 ORDER BY 1`, 16);
        for (const [v, k] of r.rows) bars.push({ label: fmtN(v), n: Number(k) });
      } else if (numeric && Number(hi) > Number(lo)) {
        const bins = 12, l = Number(lo), w = (Number(hi) - l) / bins;
        const r = await q(`SELECT least(${bins - 1}, floor((${n} - ${l}) / ${w}))::INT AS b, count(*)::BIGINT FROM ${T} WHERE ${n} IS NOT NULL GROUP BY 1 ORDER BY 1`, bins + 1);
        const counts = new Array(bins).fill(0);
        for (const [b, k] of r.rows) counts[Number(b)] = Number(k);
        counts.forEach((k, i) => bars.push({ label: fmtN(l + w * i), n: k }));
      } else if (!numeric) {
        const r = await q(`SELECT CAST(${qi(c)} AS VARCHAR) AS v, count(*)::BIGINT AS n FROM ${T} WHERE ${qi(c)} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 6`, 6);
        for (const [v, k] of r.rows) bars.push({ label: String(v), n: Number(k) });
      }
      const max = Math.max(1, ...bars.map((b) => b.n));
      const chart = numeric
        ? h('div', { class: `cs-hist${discrete ? ' discrete' : ''}` }, bars.map((b) => h('div', { class: 'cs-col', title: `${b.label}: ${b.n}` },
          discrete && h('span', { class: 'cs-cn' }, b.n.toLocaleString()),
          h('i', { style: { height: `${Math.max(2, (b.n / max) * 100)}%` } }),
          discrete && h('span', { class: 'cs-xl' }, b.label))))
        : h('div', { class: 'cs-top' }, bars.map((b) => h('div', { class: 'cs-row' },
          h('div', { class: 'cs-name' }, b.label || '""'),
          h('div', { class: 'cs-bar' }, h('i', { style: { width: `${(b.n / max) * 100}%` } })),
          h('div', { class: 'cs-n' }, b.n.toLocaleString()))));
      body.replaceChildren(stats,
        bars.length ? h('div', { class: 'cs-sub' }, numeric ? t('Distribution') : t('Most common values')) : '',
        bars.length ? chart : '',
        numeric && !discrete && bars.length ? h('div', { class: 'cs-axis' }, h('span', {}, fmtN(lo)), h('span', {}, fmtN(hi))) : '');
    } catch (e) {
      body.replaceChildren(h('div', { class: 'muted' }, (e as PgError).message));
    }
  }

  function columnMenu(c: string) {
    sheet(c, [
      { label: t('Column stats'), run: () => void columnStats(c) },
      { label: t('Sort ascending'), run: () => { sort = { col: c, dir: 'ASC' }; void refresh(); } },
      { label: t('Sort descending'), run: () => { sort = { col: c, dir: 'DESC' }; void refresh(); } },
      { label: filters.has(c) ? t('Change filter') : t('Filter…'), run: async () => {
        const v = await promptBox(`${t('Filter')}: ${c}`, t('Rows where this column contains…'), filters.get(c) ?? '', t('Filter'));
        if (v === null) return;
        if (v) filters.set(c, v); else filters.delete(c);
        void refresh();
      } },
      ...(editable ? [
        { label: t('Rename column'), run: () => void renameColumn(c) },
        { label: t('Insert column right'), run: () => void addColumn(order.indexOf(c)) },
        { label: t('Delete column'), danger: true, run: () => void deleteColumn(c) },
      ] : []),
    ]);
  }

  function rowMenu(r: number, tr: HTMLElement) {
    sheet(`${t('Row')} ${tr.firstElementChild?.textContent ?? ''}`, [
      { label: t('Insert row above'), run: () => void insertRow(r, 'above') },
      { label: t('Insert row below'), run: () => void insertRow(r, 'below') },
      { label: t('Duplicate row'), run: () => void insertRow(r, 'dup') },
      { label: t('Delete row'), danger: true, run: () => void deleteRow(r) },
    ]);
  }

  function showValue(c: string, v: string) {
    const back = h('div', { class: 'sheet-back center', onclick: (e: Event) => e.target === back && back.remove() },
      h('div', { class: 'dialog' },
        h('div', { class: 'dialog-title' }, c),
        h('div', { class: 'dialog-body' }, h('pre', { class: 'v-value' }, v)),
        h('div', { class: 'dialog-actions' },
          h('button', { onclick: () => { void navigator.clipboard?.writeText(v).then(() => toast(t('Copied'))).catch(() => {}); back.remove(); } }, t('Copy')),
          h('button', { class: 'primary', onclick: () => back.remove() }, t('Done')))));
    document.body.append(back);
  }

  /** Dialog with one text area per field. Resolves the values, or null when cancelled. */
  function fieldsDialog(title: string, fields: { label: string; value: string | null }[], allowEmpty = false): Promise<(string | null)[] | null> {
    return new Promise((resolve) => {
      const inputs = fields.map((f) => h('textarea', { class: 'field v-field', rows: '1', 'aria-label': f.label, placeholder: f.value === null ? t('empty') : '', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false' }) as HTMLTextAreaElement);
      inputs.forEach((x, i) => { x.value = fields[i].value ?? ''; });
      const grow = (x: HTMLTextAreaElement) => { x.style.height = 'auto'; x.style.height = `${Math.min(160, x.scrollHeight)}px`; };
      inputs.forEach((x) => x.addEventListener('input', () => grow(x)));
      const done = (v: (string | null)[] | null) => { back.remove(); resolve(v); };
      const back = h('div', { class: 'sheet-back center' },
        h('div', { class: 'dialog wide' },
          h('div', { class: 'dialog-title' }, title),
          h('div', { class: 'dialog-body v-fields' }, fields.map((f, i) => h('label', {}, fields.length > 1 && h('span', { class: 'muted small' }, f.label), inputs[i]))),
          h('div', { class: 'dialog-actions' },
            h('button', { onclick: () => done(null) }, t('Cancel')),
            allowEmpty && h('button', { onclick: () => done(fields.map(() => null)) }, t('Clear')),
            h('button', { class: 'primary', onclick: () => done(inputs.map((x) => x.value === '' ? null : x.value)) }, t('Save')))));
      document.body.append(back);
      setTimeout(() => { inputs.forEach(grow); inputs[0]?.focus(); }, 50);
    });
  }

  const sqlVal = (v: string | null) => (v === null ? 'NULL' : lit(v));
  const run = async (fn: () => Promise<void>) => { try { await fn(); } catch (e) { toast((e as PgError).message, 'err'); } };

  async function editCell(r: number, c: string, td: HTMLElement) {
    const cur = await q(`SELECT ${qi(c)} FROM ${T} WHERE __r = ${r}`);
    const old = (cur.rows[0]?.[0] ?? null) as string | null;
    const res = await fieldsDialog(c, [{ label: c, value: old }], true);
    if (!res || res[0] === old) return;
    const val = res[0];
    await run(async () => {
      await q(`UPDATE ${T} SET ${qi(c)} = ${sqlVal(val)} WHERE __r = ${r}`);
      td.textContent = val ?? '';
      td.className = '';
      pushUndo({ undo: async () => { await q(`UPDATE ${T} SET ${qi(c)} = ${sqlVal(old)} WHERE __r = ${r}`); } });
    });
  }

  async function newRowKey(r: number, where: 'above' | 'below' | 'dup'): Promise<number> {
    if (where === 'above') {
      const p = (await q(`SELECT max(__r) FROM ${T} WHERE __r < ${r}`)).rows[0]?.[0] as number | null;
      return p === null || p === undefined ? r - 1 : (p + r) / 2;
    }
    const n = (await q(`SELECT min(__r) FROM ${T} WHERE __r > ${r}`)).rows[0]?.[0] as number | null;
    return n === null || n === undefined ? r + 1 : (r + n) / 2;
  }

  async function insertRow(r: number, where: 'above' | 'below' | 'dup') {
    await run(async () => {
      const k = await newRowKey(r, where);
      if (where === 'dup') await q(`INSERT INTO ${T} SELECT * REPLACE (${k} AS __r) FROM ${T} WHERE __r = ${r}`);
      else await q(`INSERT INTO ${T} (__r) VALUES (${k})`);
      pushUndo({ undo: async () => { await q(`DELETE FROM ${T} WHERE __r = ${k}`); } });
      await refresh(true);
    });
  }

  async function addRowForm() {
    if (!order.length) { toast(t('Add a column first.'), 'err'); return; }
    const res = await fieldsDialog(t('New row'), order.map((c) => ({ label: c, value: null })));
    if (!res) return;
    await run(async () => {
      const k = Number((await q(`SELECT coalesce(max(__r), 0) + 1 FROM ${T}`)).rows[0]?.[0] ?? 1);
      await q(`INSERT INTO ${T} (__r, ${order.map(qi).join(', ')}) VALUES (${k}, ${res.map(sqlVal).join(', ')})`);
      pushUndo({ undo: async () => { await q(`DELETE FROM ${T} WHERE __r = ${k}`); } });
      await refresh(true);
      toast(`${t('Row added')} (${total.toLocaleString()})`);
    });
  }

  async function deleteRow(r: number) {
    await run(async () => {
      const keep = `${id}_t${++tmpN}`;
      await q(`CREATE TABLE ${tn(keep)} AS SELECT * FROM ${T} WHERE __r = ${r}; DELETE FROM ${T} WHERE __r = ${r};`);
      pushUndo({ drop: keep, undo: async () => { await q(`INSERT INTO ${T} BY NAME SELECT * FROM ${tn(keep)}; DROP TABLE ${tn(keep)};`); } });
      await refresh(true);
    });
  }

  const validName = (n: string) => {
    if (n === '__r') return t('This name is reserved.');
    if (order.includes(n)) return t('A column with this name already exists.');
    return '';
  };

  async function renameColumn(c: string) {
    const n = await promptBox(t('Rename column'), t('Name'), c, t('Rename'));
    if (!n || n === c) return;
    const bad = validName(n);
    if (bad) { toast(bad, 'err'); return; }
    await run(async () => {
      const ren = async (a: string, b: string) => {
        await q(`ALTER TABLE ${T} RENAME COLUMN ${qi(a)} TO ${qi(b)}`);
        order = order.map((x) => (x === a ? b : x));
        cols = cols.map((x) => (x.name === a ? { ...x, name: b } : x));
        if (sort?.col === a) sort.col = b;
        if (filters.has(a)) { filters.set(b, filters.get(a)!); filters.delete(a); }
      };
      await ren(c, n);
      pushUndo({ undo: () => ren(n, c) });
      await refresh(true);
    });
  }

  async function addColumn(after: number) {
    let i = order.length + 1;
    while (order.includes(`column${i}`)) i++;
    const n = await promptBox(t('New column'), t('Name'), '', t('Add'), `column${i}`);
    if (!n) return;
    const bad = validName(n);
    if (bad) { toast(bad, 'err'); return; }
    await run(async () => {
      await q(`ALTER TABLE ${T} ADD COLUMN ${qi(n)} VARCHAR`);
      order.splice(after + 1, 0, n);
      cols.push({ name: n, type: 'VARCHAR' });
      pushUndo({ undo: async () => {
        await q(`ALTER TABLE ${T} DROP COLUMN ${qi(n)}`);
        order = order.filter((x) => x !== n); cols = cols.filter((x) => x.name !== n);
      } });
      await refresh(true);
    });
  }

  async function deleteColumn(c: string) {
    if (!(await confirmBox(`${t('Delete column')} “${c}”?`, t('You can undo this until you close the file.'), t('Delete'), true))) return;
    await run(async () => {
      const keep = `${id}_t${++tmpN}`;
      const at = order.indexOf(c);
      const type = typeOf(c);
      await q(`CREATE TABLE ${tn(keep)} AS SELECT __r, ${qi(c)} AS v FROM ${T}; ALTER TABLE ${T} DROP COLUMN ${qi(c)};`);
      order = order.filter((x) => x !== c); cols = cols.filter((x) => x.name !== c);
      filters.delete(c); if (sort?.col === c) sort = null;
      pushUndo({ drop: keep, undo: async () => {
        await q(`ALTER TABLE ${T} ADD COLUMN ${qi(c)} ${type}; UPDATE ${T} AS t SET ${qi(c)} = k.v FROM ${tn(keep)} k WHERE t.__r = k.__r; DROP TABLE ${tn(keep)};`);
        order.splice(at, 0, c); cols.push({ name: c, type });
      } });
      await refresh(true);
    });
  }

  async function doUndo() {
    const s = undo.pop();
    if (!s) return;
    await run(async () => {
      await s.undo();
      if (!undo.length) { undoBtn.setAttribute('disabled', ''); setDirty(false); }
      await refresh(true);
    });
  }

  async function switchTable(tb: string) {
    if (tb === table) return;
    table = tb;
    await run(async () => { await load(); await refresh(); void insight().catch(() => {}); });
  }

  // ---------- saving and sharing ----------
  const base = file.replace(/\.[^.]+$/, '');
  const ordered = () => `SELECT ${order.length ? order.map(qi).join(', ') : '*'} FROM ${T} ORDER BY __r`;

  /** The file as it is now: edited delimited text in its own format, other kinds as their original bytes. */
  async function currentBytes(): Promise<Blob> {
    if (editable && fmt) {
      const opts = `(FORMAT csv, HEADER ${fmt.header}, DELIMITER ${lit(fmt.delim)}, QUOTE ${lit(fmt.quote)}, ESCAPE ${lit(fmt.escape)})`;
      return engine.exportQuery(ordered(), 'csv', opts);
    }
    const b = await engine.fileBytes(file);
    return new Blob([(b ?? new Uint8Array()) as BlobPart]);
  }

  async function saveHere(): Promise<Blob> {
    const blob = await currentBytes();
    await engine.writeDataFile(file, blob);
    setDirty(false);
    undo = []; undoBtn.setAttribute('disabled', '');
    await hooks.filesChanged();
    return blob;
  }

  function saveMenu() {
    sheet(t('Save'), [
      { label: t('Save to Files…'), run: () => void run(async () => {
        const blob = await saveHere();
        if (await saveToFiles(file, blob)) toast(t('Saved to Files'));
        else toast(t('Saved in Querly'));
      }) },
      { label: t('Save in Querly only'), run: () => void run(async () => { await saveHere(); toast(t('Saved in Querly')); }) },
    ]);
  }

  async function shareAs(format: 'csv' | 'xlsx' | 'json' | 'parquet') {
    if (format !== 'csv' && !(await requirePro(`${t('Exporting as')} ${format === 'xlsx' ? 'Excel' : format.toUpperCase()} ${t('is part of Pro.')}`))) return;
    await run(async () => {
      const blob = await engine.exportQuery(ordered(), format);
      await shareFile(`${base}.${format}`, blob, blob.type || 'application/octet-stream');
    });
  }

  async function editCopy() {
    await run(async () => {
      const blob = await engine.exportQuery(ordered(), 'csv');
      const saved = await engine.importFile(`${base}${table && tables.length > 1 ? `-${table}` : ''}.csv`, blob);
      await hooks.filesChanged();
      await close(true);
      hooks.open(saved);
    });
  }

  function moreMenu() {
    sheet(file, [
      { label: t('Save to Files…'), run: () => void run(async () => {
        const blob = editable && dirty ? await saveHere() : await currentBytes();
        if (await saveToFiles(file, blob)) toast(t('Saved to Files'));
      }) },
      { label: t('Share as CSV'), run: () => void shareAs('csv') },
      { label: `${t('Share as Excel')} · Pro`, run: () => void shareAs('xlsx') },
      { label: `${t('Share as JSON')} · Pro`, run: () => void shareAs('json') },
      { label: `${t('Share as Parquet')} · Pro`, run: () => void shareAs('parquet') },
      ...(!editable ? [{ label: t('Edit a CSV copy'), run: () => void editCopy() }] : []),
      ...(editable && fmt ? [{ label: `${fmt.header ? '✓ ' : ''}${t('First row is the header')}`, run: () => void toggleHeader() }] : []),
      ...(!lines ? [{ label: t('Analyze with SQL & charts'), run: () => void close().then((ok) => ok && hooks.newNotebook(file)) }] : []),
      { label: t('Rename, delete…'), run: () => void close().then((ok) => ok && hooks.fileMenu(file)) },
    ]);
  }

  async function toggleHeader() {
    if (!fmt) return;
    if (dirty && !(await confirmBox(t('Discard changes?'), t('Changing the header row reloads the file.'), t('Discard'), true))) return;
    fmt.header = !fmt.header;
    await run(async () => { await load(); await refresh(); void insight().catch(() => {}); });
  }

  async function close(force = false): Promise<boolean> {
    if (dirty && !force && !(await confirmBox(t('Discard changes?'), `${t('Your edits to')} “${file}” ${t('are not saved.')}`, t('Discard'), true))) return false;
    closed = true;
    el.remove();
    document.body.classList.remove('in-viewer');
    const drops = [T, ...undo.filter((s) => s.drop).map((s) => tn(s.drop!))].map((x) => `DROP TABLE IF EXISTS ${x};`).join(' ');
    await q(`${drops}${attached ? ` DETACH DATABASE IF EXISTS ${qi(attached)};` : ''}`).catch(() => {});
    return true;
  }

  // ---------- start ----------
  more.textContent = t('Opening…');
  void (async () => {
    try {
      await load();
      if (!editable) {
        bannerEl.classList.remove('hidden');
        bannerEl.replaceChildren(h('span', {}, t('Read-only.')), ' ', h('button', { class: 'link', onclick: () => void editCopy() }, t('Edit a CSV copy')));
      }
      await refresh();
      void insight().catch(() => {});
    } catch (e) {
      more.replaceChildren(errorBox(e as PgError, h('div', { class: 'muted' }, `${file} · ${fmtBytes((await engine.fileBytes(file))?.length ?? 0)}`)));
    }
  })();
}
