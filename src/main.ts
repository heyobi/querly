import './style.css';
import './style2.css';
import { App as CapApp } from '@capacitor/app';
import { Filesystem } from '@capacitor/filesystem';
import { Keyboard } from '@capacitor/keyboard';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { EditorView, keymap, placeholder, tooltips } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { sql, StandardSQL } from '@codemirror/lang-sql';
import { markdown } from '@codemirror/lang-markdown';
import { Compartment, EditorState } from '@codemirror/state';
import type { CompletionContext } from '@codemirror/autocomplete';
import { oneDark } from '@codemirror/theme-one-dark';
import { marked } from 'marked';
import * as engine from './engine';
import type { DataFile, PgError } from './engine';
import { FREE_FILE_MB, isProKind, kindOf, proFeature, readerFor, tableNameFor } from './features';
import { deleteNotebook, fromIpynb, fromSql, loadNotebooks, saveNotebook, toIpynb, toSql, uid, type Cell, type Notebook } from './notebook';
import { initPro, isPro, onPro, requirePro } from './pro';
import { errorBox, renderResult } from './results';
import { CORE_SAMPLES, SAMPLE_FILES, sampleNotebook, type Sample } from './samples';
import { LESSONS } from './lessons';
import { EXTENSIONS, EXT_CATEGORIES, type ExtInfo } from './extensions';
import { applyTheme, getLangPref, getThemePref, lang, setLangPref, setThemePref, t, type LangPref, type Theme } from './i18n';
import { querySucceeded } from './review';
import { confirmBox, dark, fmtBytes, fmtDate, fmtMs, h, icon, modal, native, pickFiles, promptBox, safeName, sheet, shareFile, toast } from './ui';

const app = document.getElementById('app')!;

// ---------------- state ----------------
let notebooks: Notebook[] = [];
let files: DataFile[] = [];
const schemaComp = new Compartment();
const editors = new Set<EditorView>();

type Tab = 'notebooks' | 'files' | 'extensions' | 'database';
type Route = { tab: Tab; notebook?: string };
let route: Route = { tab: 'notebooks' };

const dialect = StandardSQL;
function sqlLang() {
  const schema: Record<string, string[]> = { ...engine.getMeta().schema };
  for (const f of files) schema[`'${f.name}'`] = [];
  return sql({ dialect, schema, upperCaseKeywords: true });
}
// Function-name completion from duckdb_functions().
const fnCompletion = dialect.language.data.of({
  autocomplete: (ctx: CompletionContext) => {
    const w = ctx.matchBefore(/[A-Za-z_][\w]*/);
    if (!w || (w.from === w.to && !ctx.explicit) || w.text.length < 2) return null;
    const lower = w.text.toLowerCase();
    const fns = engine.getMeta().functions.filter((f) => f.toLowerCase().startsWith(lower)).slice(0, 80);
    if (!fns.length) return null;
    return { from: w.from, options: fns.map((f) => ({ label: f, type: 'function', apply: `${f}(`, boost: -1 })), validFor: /^\w*$/ };
  },
});
const reconfigureEditors = () => { for (const v of editors) v.dispatch({ effects: schemaComp.reconfigure(sqlLang()) }); };
engine.onMeta(reconfigureEditors);

async function refreshFiles() {
  files = await engine.listFiles();
  reconfigureEditors();
}

// ---------------- shell ----------------
function statusPill() {
  const el = h('button', { class: 'pill', onclick: () => go({ tab: 'database' }) });
  const off = engine.onState((s) => {
    el.className = `pill ${s.status}`;
    el.textContent = s.status === 'ready' ? `${s.db?.name ?? ''} · DuckDB` : s.status === 'starting' ? t('Starting…') : t('Error');
  });
  new MutationObserver(() => { if (!el.isConnected) off(); }).observe(document.body, { childList: true, subtree: true });
  return el;
}

function tabBar() {
  const tabs: [Tab, string, string][] = [['notebooks', 'Notebooks', 'doc'], ['files', 'Files', 'folder'], ['extensions', 'Extensions', 'puzzle'], ['database', 'Database', 'db']];
  return h('nav', { class: 'tabbar' }, tabs.map(([tb, label, ic]) =>
    h('button', { class: route.tab === tb && !route.notebook ? 'on' : '', onclick: () => go({ tab: tb }) }, icon(ic), h('span', {}, t(label)))));
}

function go(r: Route) {
  route = r;
  render();
  window.scrollTo(0, 0);
}

function render() {
  for (const v of editors) v.destroy();
  editors.clear();
  hideAccessory();
  app.replaceChildren();
  document.body.classList.toggle('in-notebook', !!route.notebook);
  if (route.notebook) {
    const nb = notebooks.find((n) => n.id === route.notebook);
    if (nb) { app.append(notebookView(nb)); return; }
    route = { tab: 'notebooks' };
  }
  const page = route.tab === 'files' ? filesPage() : route.tab === 'extensions' ? extensionsPage() : route.tab === 'database' ? databasePage() : homePage();
  app.append(page, tabBar());
}

const header = (title: string, ...right: (HTMLElement | false)[]) =>
  h('header', { class: 'bar' }, h('div', { class: 'bar-title big' }, title), ...right.filter(Boolean) as HTMLElement[],
    h('button', { class: 'gear', 'aria-label': t('Settings'), onclick: openSettings }, icon('gear')));

/** Settings live at the bottom of the Database tab; the gear in every header jumps there. */
function openSettings() {
  go({ tab: 'database' });
  requestAnimationFrame(() => document.getElementById('settings')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

// ---------------- notebooks home ----------------
async function newNotebook(cells?: Cell[], title = t('Untitled notebook')) {
  const nb: Notebook = { id: uid(), title, updated: Date.now(), cells: cells ?? [{ id: uid(), type: 'sql', source: '' }] };
  await saveNotebook(nb);
  notebooks.unshift(nb);
  go({ tab: 'notebooks', notebook: nb.id });
}

async function openSample(s: Sample) {
  if (s.pro && !(await requirePro(`${t(s.title)}: ${t('this example uses Pro features.')}`))) return;
  // Re-opening a lesson continues the copy you already have instead of making another one.
  const existing = s.key.startsWith('learn-') ? notebooks.find((n) => n.title === s.title) : undefined;
  if (existing) { go({ tab: 'notebooks', notebook: existing.id }); return; }
  await ensureSampleFiles();
  const nb = sampleNotebook(s, uid());
  await newNotebook(nb.cells, nb.title);
}

async function importNotebookFile(f: File) {
  const text = await f.text();
  const base = f.name.replace(/\.(ipynb|sql|txt|json)$/i, '');
  const nb = /\.ipynb$/i.test(f.name) || text.trimStart().startsWith('{') ? fromIpynb(text, base) : fromSql(text, base);
  nb.id = uid();
  await saveNotebook(nb);
  notebooks.unshift(nb);
  go({ tab: 'notebooks', notebook: nb.id });
}

function homePage() {
  return h('div', { class: 'page' },
    header(t('Notebooks'), statusPill()),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: () => newNotebook() }, icon('plus'), t('New notebook')),
      h('button', { class: 'btn', onclick: () => void importFlow() }, icon('import'), t('Import'))),
    notebooks.length
      ? h('div', { class: 'list' }, notebooks.map((nb) => h('button', { class: 'row', onclick: () => go({ tab: 'notebooks', notebook: nb.id }) },
          h('div', { class: 'row-icon' }, icon('doc')),
          h('div', { class: 'row-main' },
            h('div', { class: 'row-title' }, nb.title),
            h('div', { class: 'row-sub' }, `${nb.cells.length} ${t(nb.cells.length === 1 ? 'cell' : 'cells')} · ${fmtDate(nb.updated)}`)),
          icon('chevron'))))
      : h('div', { class: 'empty' }, t('No notebooks yet. Start with an example below.')),
    h('h2', { class: 'section' }, t('Examples')),
    h('div', { class: 'cards' }, CORE_SAMPLES.map((s) => h('button', { class: 'card', onclick: () => void openSample(s) },
      h('div', { class: 'card-title' }, t(s.title), s.pro && !isPro() && h('span', { class: 'pro-tag' }, 'PRO')),
      h('div', { class: 'card-sub' }, t(s.subtitle))))),
    h('h2', { class: 'section' }, t('Learn SQL'), h('span', { class: 'section-note' }, `${LESSONS.length} ${t('lessons · free')}`)),
    h('p', { class: 'muted pad' }, t('A short course from your first SELECT to window functions, PIVOT and writing files. Each lesson explains, runs and ends with an exercise.')),
    h('div', { class: 'list lessons' }, LESSONS.map((l) => {
      const started = notebooks.some((n) => n.title === l.title);
      return h('button', { class: 'row', onclick: () => void openSample(l) },
        h('div', { class: `lesson-n ${started ? 'started' : ''}` }, String(l.n)),
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title' }, l.title),
          h('div', { class: 'row-sub' }, l.subtitle),
          h('div', { class: 'lesson-meta' }, h('span', { class: `lvl lvl-${l.level.toLowerCase()}` }, t(l.level)), `${l.minutes} ${lang() === 'tr' ? 'dk' : 'min'}${started ? ` · ${t('in your notebooks')}` : ''}`)),
        icon('chevron'));
    })));
}

// ---------------- files ----------------
async function ensureSampleFiles() {
  const have = (await engine.listFiles()).map((f) => f.name);
  for (const name of SAMPLE_FILES) {
    if (have.includes(name)) continue;
    try {
      const r = await fetch(`/samples/${name}`);
      if (r.ok) await engine.importFile(name, await r.blob());
    } catch { /* offline web preview */ }
  }
  await refreshFiles();
}

/** Import from the file picker, a share sheet or "Open in Querly". Routes notebooks and snapshots to their own place. */
async function importBlobs(items: { name: string; blob: Blob }[]) {
  let imported = 0;
  for (const { name, blob } of items) {
    const kind = kindOf(name);
    try {
      if (kind === 'notebook') { await importNotebookFile(new File([blob], name)); continue; }
      if (kind === 'snapshot') { await restoreSnapshot(blob, name); continue; }
      if (isProKind(kind) && !(await requirePro(`${name}: ${t('this file type is part of Pro.')}`))) continue;
      if (blob.size > FREE_FILE_MB * 1048576 && !(await requirePro(`${name} (${fmtBytes(blob.size)}): ${t('files over')} ${FREE_FILE_MB} MB ${t('are part of Pro.')}`))) continue;
      const bar = h('div', { class: 'progress' }, h('i'));
      const note = h('div', { class: 'muted small drop-hint' }, `${t('Importing')} ${name}…`);
      document.querySelector('.page .actions')?.after(note, bar);
      const saved = await engine.importFile(name, blob, (done) => { (bar.firstChild as HTMLElement).style.width = `${Math.round((done / Math.max(1, blob.size)) * 100)}%`; });
      note.remove(); bar.remove();
      imported++;
      if (saved !== name) toast(`${t('Saved as')} ${saved}`);
    } catch (e) {
      toast(`${t('Could not import')} ${name}: ${(e as Error).message}`, 'err');
    }
  }
  await refreshFiles();
  if (imported) { toast(`${imported} ${t(imported === 1 ? 'file imported' : 'files imported')}`); if (route.tab !== 'files' || route.notebook) go({ tab: 'files' }); else render(); }
}

async function importFlow() {
  const picked = await pickFiles(true);
  if (picked.length) await importBlobs(picked.map((f) => ({ name: f.name, blob: f })));
}

function fileRow(f: DataFile) {
  const kind = kindOf(f.name);
  return h('button', { class: 'row', onclick: () => fileActions(f) },
    h('span', { class: `kind ${kind}` }, kind === 'other' ? f.name.split('.').pop() ?? '?' : kind),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, f.name),
      h('div', { class: 'row-sub' }, `${fmtBytes(f.size)} · ${fmtDate(f.mtime)}`)),
    isProKind(kind) && !isPro() ? h('span', { class: 'pro-tag' }, 'PRO') : icon('chevron'));
}

function fileActions(f: DataFile) {
  const kind = kindOf(f.name);
  const reader = readerFor(f.name);
  const gate = async () => !isProKind(kind) || requirePro(`${f.name}: ${t('this file type is part of Pro.')}`);
  sheet(f.name, [
    { label: t('Preview'), run: async () => { if (await gate()) await previewModal(f.name, kind === 'sqlite' ? `SELECT * FROM sqlite_master` : `SELECT * FROM ${reader} LIMIT 200`); } },
    { label: t('New notebook from this file'), run: async () => {
      if (!(await gate())) return;
      const tbl = tableNameFor(f.name);
      const cells: Cell[] = kind === 'sqlite'
        ? [{ id: uid(), type: 'markdown', source: `# ${f.name}\nAttach the SQLite file, list its tables, then query them as \`db.table_name\`.` },
           { id: uid(), type: 'sql', source: `ATTACH '${f.name}' AS ${tbl} (TYPE sqlite, READ_ONLY);\nSELECT name FROM ${tbl}.sqlite_master WHERE type = 'table';` }]
        : [{ id: uid(), type: 'markdown', source: `# ${f.name}` },
           { id: uid(), type: 'sql', source: `DESCRIBE SELECT * FROM ${reader};` },
           { id: uid(), type: 'sql', source: `SELECT * FROM ${reader} LIMIT 100;` },
           { id: uid(), type: 'sql', source: `SUMMARIZE SELECT * FROM ${reader};` }];
      await newNotebook(cells, f.name.replace(/\.[^.]+$/, ''));
    } },
    ...(kind === 'sqlite' || kind === 'other' ? [] : [{ label: `${t('Load into a table')} (${tableNameFor(f.name)})`, run: async () => {
      if (!(await gate())) return;
      const name = await promptBox(t('Load into a table'), t('Table name'), tableNameFor(f.name), t('Load'));
      if (!name) return;
      try {
        const r = await engine.exec(`CREATE OR REPLACE TABLE "${name.replace(/"/g, '""')}" AS SELECT * FROM ${reader}; SELECT count(*) AS rows FROM "${name.replace(/"/g, '""')}"`);
        toast(`${name}: ${(r.results[0]?.rows[0]?.[0] as number ?? 0).toLocaleString()} ${t('rows')}`);
      } catch (e) { toast((e as PgError).message, 'err'); }
    } }]),
    { label: t('Share'), run: async () => { const b = await engine.fileBytes(f.name); if (b) await shareFile(f.name, new Blob([b as BlobPart]), 'application/octet-stream'); } },
    { label: t('Rename'), run: async () => {
      const n = await promptBox(t('Rename file'), t('Name'), f.name, t('Rename'));
      if (!n || n === f.name) return;
      try { await engine.renameFile(f.name, n); await refreshFiles(); render(); } catch (e) { toast((e as Error).message, 'err'); }
    } },
    { label: t('Delete'), danger: true, run: async () => {
      if (!(await confirmBox(`${t('Delete')} “${f.name}”?`, t('The file is removed from this iPhone. Tables you created from it are kept.'), t('Delete'), true))) return;
      await engine.deleteFile(f.name); await refreshFiles(); render();
    } },
  ]);
}

async function previewModal(title: string, query: string) {
  const out = h('div', { class: 'out' }, h('div', { class: 'muted' }, t('running…')));
  modal(h('div', { class: 'preview-modal' }, h('h1', {}, title), h('code', { class: 'muted small' }, query), out));
  try {
    const r = await engine.exec(query);
    out.replaceChildren();
    renderResult(out, r, query);
  } catch (e) {
    out.replaceChildren(errorBox(e as PgError));
  }
}

function filesPage() {
  const page = h('div', { class: 'page' },
    header(t('Files'), statusPill()),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: () => void importFlow() }, icon('import'), t('Import files'))),
    h('p', { class: 'muted small drop-hint' }, t('CSV, TSV and JSON are free. Parquet, Excel (.xlsx), SQLite and spatial files need Pro. You can also use Share › Querly in other apps, or copy files into Files › On My iPhone › Querly › Data.')),
    files.length
      ? h('div', { class: 'list' }, files.map(fileRow))
      : h('div', { class: 'empty' }, t('No files yet. Import a CSV, Parquet, JSON or Excel file.')));
  const offPro = onPro(() => render());
  new MutationObserver(() => { if (!page.isConnected) offPro(); }).observe(document.body, { childList: true, subtree: true });
  return page;
}

// ---------------- extensions ----------------
const slug = (x: string) => x.toLowerCase().replace(/[^a-z]+/g, '-');
function catIcon(c: string) {
  return ({ 'File formats': 'doc', Geospatial: 'globe', 'Text & time': 'search', 'Data types': 'shapes', 'AI & vectors': 'spark', Benchmarks: 'bolt', Tools: 'wrench' } as Record<string, string>)[c] ?? 'puzzle';
}
let extLoaded: Record<string, boolean> = {};

function extBadge(e: ExtInfo) {
  if (extLoaded[e.id]) return { label: t('Loaded'), cls: 'on' };
  if (e.pro && !isPro()) return { label: 'Pro', cls: 'get' };
  return { label: e.autoload ? t('Auto') : t('Ready'), cls: 'na' };
}

function extensionsPage() {
  const listEl = h('div');
  const draw = () => {
    const parts: (HTMLElement | false)[] = [
      h('div', { class: 'featured' }, ['parquet', 'excel', 'spatial', 'json'].map((id) => {
        const e = EXTENSIONS.find((x) => x.id === id)!;
        const b = extBadge(e);
        return h('button', { class: `feat cat-${slug(e.category)}`, onclick: () => extDetail(e, draw) },
          h('div', { class: 'feat-ico' }, icon(catIcon(e.category))),
          h('div', { class: 'feat-title' }, e.title),
          h('div', { class: 'feat-sub' }, t(e.tagline)),
          h('span', { class: `badge ${b.cls}` }, b.label));
      })),
      ...EXT_CATEGORIES.flatMap((c) => [
        h('h3', { class: 'group' }, icon(catIcon(c)), t(c)),
        h('div', { class: 'list' }, EXTENSIONS.filter((e) => e.category === c).map((e) => {
          const b = extBadge(e);
          return h('button', { class: 'row', onclick: () => extDetail(e, draw) },
            h('div', { class: `row-icon cat-${slug(e.category)}` }, icon(catIcon(e.category))),
            h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, e.title), h('div', { class: 'row-sub' }, t(e.tagline))),
            h('span', { class: `badge ${b.cls}` }, b.label));
        })),
      ]),
    ];
    listEl.replaceChildren(...(parts.filter(Boolean) as HTMLElement[]));
  };
  draw();
  void engine.extensionStatus().then((st) => { extLoaded = st; if (listEl.isConnected) draw(); }).catch(() => {});
  const offPro = onPro(() => render());
  new MutationObserver(() => { if (!listEl.isConnected) offPro(); }).observe(document.body, { childList: true, subtree: true });
  return h('div', { class: 'page' },
    header(t('Extensions'), statusPill()),
    h('p', { class: 'muted small drop-hint' }, `${EXTENSIONS.length} ${t('DuckDB extensions are built into the app and load offline, without downloading anything. Most load automatically the first time a query needs them.')}`),
    !isPro() && h('button', { class: 'pro-banner', onclick: () => requirePro().then(() => render()) },
      h('div', {}, h('b', {}, t('Unlock Parquet, Excel, SQLite and Spatial')), h('div', { class: 'small' }, t('Charts, maps and big files too · one-time purchase'))),
      h('span', { class: 'pro-tag big' }, 'PRO')),
    listEl);
}

function extDetail(e: ExtInfo, redraw: () => void) {
  const loaded = !!extLoaded[e.id];
  const loadBtn = h('button', { class: 'btn big primary', disabled: loaded }, loaded ? t('Loaded') : e.pro && !isPro() ? t('Load · Pro') : t('Load'));
  loadBtn.onclick = async () => {
    if (e.pro && !(await requirePro(`${e.title} ${t('is part of Pro.')}`))) return;
    loadBtn.setAttribute('disabled', '');
    loadBtn.textContent = t('Loading…');
    try {
      await engine.loadExtension(e.id);
      extLoaded = await engine.extensionStatus();
      toast(`${e.title} ${t('loaded')}`);
      close(); redraw();
    } catch (err) { toast((err as PgError).message, 'err'); loadBtn.removeAttribute('disabled'); loadBtn.textContent = t('Load'); }
  };
  const sample = e.sample ? CORE_SAMPLES.find((x) => x.key === e.sample) : undefined;
  const content = h('div', { class: 'ext-detail' },
    h('div', { class: `ext-hero cat-${slug(e.category)}` }, h('div', { class: 'feat-ico big' }, icon(catIcon(e.category)))),
    h('h1', {}, e.title),
    h('div', { class: 'muted center' }, t(e.tagline)),
    h('p', {}, e.about),
    h('div', { class: 'kv' },
      h('div', {}, h('span', {}, t('Category')), h('b', {}, t(e.category))),
      h('div', {}, h('span', {}, 'LOAD'), h('code', {}, e.id)),
      h('div', {}, h('span', {}, t('Size')), h('b', {}, e.sizeKb >= 1024 ? `${(e.sizeKb / 1024).toFixed(1)} MB` : `${e.sizeKb} KB`)),
      h('div', {}, h('span', {}, t('Licence')), h('b', {}, e.license)),
      h('div', {}, h('span', {}, t('Version')), h('b', {}, `DuckDB ${engine.duckdbVersion() || 'v1.5.4'}`)),
      h('div', {}, h('span', {}, t('Plan')), h('b', {}, e.pro ? 'Pro' : t('Free')))),
    e.example && h('pre', { class: 'ext-example' }, e.example),
    loadBtn,
    e.example && h('button', { class: 'btn big', onclick: async () => {
      if (e.pro && !(await requirePro(`${e.title} ${t('is part of Pro.')}`))) return;
      close();
      await newNotebook([{ id: uid(), type: 'markdown', source: `# ${e.title}\n${e.about}` }, { id: uid(), type: 'sql', source: e.example! }], e.title);
    } }, icon('plus'), t('Try it in a notebook')),
    sample && h('button', { class: 'btn big', onclick: () => { close(); void openSample(sample); } }, icon('doc'), t('See example notebook')));
  const close = modal(content);
}

// ---------------- database ----------------
function tableActions(name: string, kind: string) {
  const q = name.split('.').map((p) => `"${p.replace(/"/g, '""')}"`).join('.');
  sheet(name, [
    { label: t('Preview'), run: () => void previewModal(name, `SELECT * FROM ${q} LIMIT 200`) },
    { label: t('Columns'), run: () => void previewModal(name, `DESCRIBE ${q}`) },
    { label: t('New notebook'), run: () => void newNotebook([{ id: uid(), type: 'sql', source: `SELECT * FROM ${q} LIMIT 100;` }, { id: uid(), type: 'sql', source: `SUMMARIZE ${q};` }], name) },
    { label: `${t('Drop')} ${t(kind)}`, danger: true, run: async () => {
      if (!(await confirmBox(`${t('Drop')} ${name}?`, t('This cannot be undone.'), t('Drop'), true))) return;
      try { await engine.exec(`DROP ${kind === 'view' ? 'VIEW' : 'TABLE'} ${q}`); await engine.refreshMeta(); render(); } catch (e) { toast((e as PgError).message, 'err'); }
    } },
  ]);
}

async function restoreSnapshot(blob: Blob, name = 'snapshot') {
  if (!(await requirePro(t('Backups and restores are part of Pro.')))) return;
  const cur = engine.active();
  if (!cur) return;
  if (!(await confirmBox(t('Restore this backup?'), `“${cur.name}” ${t('is replaced by')} ${name}.`, t('Restore'), true))) return;
  try { await engine.importSnapshot(blob); toast(t('Backup restored')); } catch (e) { toast(`${t('Restore failed')}: ${(e as PgError).message}`, 'err'); }
  render();
}

function databasePage() {
  const st = engine.getState();
  const cur = engine.active();
  const sizeEl = h('span', {}, '…');
  if (cur) engine.sizeOf(cur.id).then((b) => { sizeEl.textContent = b ? `${fmtBytes(b)} ${t('saved')}` : t('not saved yet'); });
  const tables = engine.getMeta().tables;

  const page = h('div', { class: 'page' },
    header(t('Database'), statusPill()),
    st.status === 'error' && errorBox({ message: `DuckDB did not start: ${st.error}` }, h('div', { class: 'muted' }, t('Restore a backup or reset this database.'))),
    cur && h('div', { class: 'db-hero' },
      h('div', { class: 'db-hero-top' },
        h('div', { class: 'row-icon big' }, icon('db')),
        h('div', { class: 'grow' }, h('div', { class: 'db-name' }, cur.name), h('div', { class: 'muted small' }, `DuckDB ${st.version ?? ''}`, ' · ', sizeEl)),
        h('span', { class: `pill ${st.status}` }, st.status === 'ready' ? t('Running') : st.status)),
      h('div', { class: 'actions wrap' },
        h('button', { class: 'btn', onclick: async () => {
          if (!(await requirePro(t('Backups and restores are part of Pro.')))) return;
          await shareFile(`${safeName(cur.name)}-${new Date().toISOString().slice(0, 10)}.qsnap`, await engine.exportSnapshot(), 'application/octet-stream');
        } }, icon('export'), t('Back up')),
        h('button', { class: 'btn', onclick: async () => { const [f] = await pickFiles(false); if (f) await restoreSnapshot(f, f.name); } }, icon('import'), t('Restore')),
        h('button', { class: 'btn', onclick: async () => { const n = await promptBox(t('Rename database'), t('Name'), cur.name, t('Rename')); if (n) { await engine.renameDatabase(cur.id, n); render(); } } }, t('Rename')),
        h('button', { class: 'btn danger', onclick: async () => {
          if (!(await confirmBox(`${t('Reset')} “${cur.name}”?`, t('All tables and views in this database are deleted. Notebooks and files are kept. This cannot be undone.'), t('Reset'), true))) return;
          await engine.resetDatabase(); toast(t('Database reset')); render();
        } }, icon('trash'), t('Reset')))),
    h('h2', { class: 'section' }, t('Tables and views'), h('span', { class: 'section-note' }, String(tables.length))),
    tables.length
      ? h('div', { class: 'list' }, tables.map((x) => h('button', { class: 'row', onclick: () => tableActions(x.name, x.kind) },
          h('div', { class: 'row-icon' }, icon(x.kind === 'view' ? 'doc' : 'table')),
          h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, x.name), h('div', { class: 'row-sub' }, x.kind === 'view' ? t('view') : `${t('table')}${x.rows !== null ? ` · ~${Number(x.rows).toLocaleString()} ${t('rows')}` : ''}`)),
          icon('chevron'))))
      : h('div', { class: 'empty' }, t('No tables yet. Run an example, or load a file into a table from the Files tab.')),
    h('h2', { class: 'section' }, t('All databases')),
    h('div', { class: 'list' }, engine.databases().map((d) => h('button', { class: `row${d.id === cur?.id ? ' current' : ''}`, onclick: async () => {
      if (d.id === cur?.id) return;
      sheet(d.name, [
        { label: `${t('Switch to')} ${d.name}`, run: async () => { toast(`${t('Opening')} ${d.name}…`); try { await engine.switchDatabase(d.id); } catch (e) { toast((e as PgError).message, 'err'); } render(); } },
        { label: t('Delete database'), danger: true, run: async () => {
          if (!(await confirmBox(`${t('Delete')} “${d.name}”?`, t('The database and all its data are deleted. This cannot be undone.'), t('Delete'), true))) return;
          await engine.deleteDatabase(d.id); render();
        } },
      ]);
    } },
      h('div', { class: 'row-icon' }, icon('db')),
      h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, d.name), h('div', { class: 'row-sub' }, fmtDate(d.created))),
      d.id === cur?.id ? h('span', { class: 'badge on' }, t('Active')) : icon('chevron')))),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: newDatabase }, icon('plus'), t('New database'), !isPro() && h('span', { class: 'pro-tag' }, 'PRO'))),
    h('h2', { class: 'section', id: 'settings' }, t('Settings')),
    h('div', { class: 'list' },
      settingRow('sun', t('Appearance'), { system: t('System'), light: t('Light'), dark: t('Dark') }, getThemePref(), (v) => { setThemePref(v as Theme); applyStatusBar(); render(); }),
      settingRow('globe', t('Language'), { system: t('System'), en: 'English', tr: 'Türkçe' }, getLangPref(), (v) => { setLangPref(v as LangPref); render(); })),
    h('h2', { class: 'section' }, 'Querly'),
    h('div', { class: 'list' },
      h('button', { class: 'row', onclick: () => requirePro().then(() => render()) },
        h('div', { class: 'row-icon' }, icon('spark')),
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, isPro() ? t('Pro is active') : t('Unlock Pro')), h('div', { class: 'row-sub' }, isPro() ? t('Thank you for supporting Querly') : t('Parquet, Excel, charts, maps · one-time purchase'))),
        isPro() ? h('span', { class: 'badge on' }, 'PRO') : icon('chevron'))),
    h('div', { class: 'info muted small' },
      h('div', {}, 'Open source (MIT): github.com/heyobi/querly'),
      h('div', {}, `Powered by DuckDB ${engine.duckdbVersion()} (MIT) via DuckDB-Wasm. Spatial extension uses GDAL, GEOS and PROJ (MIT/LGPL). Map data: Natural Earth (public domain). DuckDB is a trademark of the DuckDB Foundation; Querly is an independent app, not affiliated with or endorsed by the DuckDB Foundation.`)));
  const offPro = onPro(() => render());
  new MutationObserver(() => { if (!page.isConnected) offPro(); }).observe(document.body, { childList: true, subtree: true });
  return page;
}

function settingRow(ic: string, title: string, options: Record<string, string>, current: string, onPick: (v: string) => void) {
  return h('button', { class: 'row', onclick: () => sheet(title, Object.entries(options).map(([k, label]) => ({ label: (k === current ? '✓ ' : '') + label, run: () => onPick(k) }))) },
    h('div', { class: 'row-icon' }, icon(ic)),
    h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, title)),
    h('span', { class: 'setting-value' }, options[current] ?? current), icon('chevron'));
}

function applyStatusBar() {
  if (!native) return;
  const pref = getThemePref();
  StatusBar.setStyle({ style: pref === 'system' ? Style.Default : pref === 'dark' ? Style.Dark : Style.Light }).catch(() => {});
}

async function newDatabase() {
  if (!(await requirePro(t('More than one database is part of Pro.')))) return;
  let n = engine.databases().length + 1;
  while (engine.databases().some((d) => d.name === `db${n}`)) n++;
  const name = await promptBox(t('New database'), `${t('Name')} (db${n})`, '', t('Create'), `db${n}`);
  if (!name) return;
  const d = await engine.createDatabase(name);
  toast(`${t('Opening')} ${d.name}…`);
  try { await engine.switchDatabase(d.id); } catch (e) { toast((e as PgError).message, 'err'); }
  render();
}

// ---------------- notebook editor ----------------
interface CellUi { cell: Cell; el: HTMLElement; run?: () => Promise<boolean>; focus?: () => void }

function notebookView(nb: Notebook) {
  let saveTimer: number | undefined;
  const persist = () => { clearTimeout(saveTimer); saveTimer = window.setTimeout(() => void saveNotebook(nb), 600); };
  const uis: CellUi[] = [];
  const cellsEl = h('div', { class: 'cells' });

  const title = h('input', { class: 'nb-title', value: nb.title, 'aria-label': t('Notebook title'), enterkeyhint: 'done' }) as HTMLInputElement;
  title.oninput = () => { nb.title = title.value || t('Untitled notebook'); persist(); };
  title.onkeydown = (e) => e.key === 'Enter' && title.blur();

  const rebuild = () => {
    for (const u of uis) u.el.remove();
    uis.length = 0;
    nb.cells.forEach((c, i) => { const u = cellView(c, i); uis.push(u); cellsEl.append(u.el); });
  };
  const insertAt = (idx: number, type: Cell['type']) => {
    nb.cells.splice(idx, 0, { id: uid(), type, source: '' });
    persist(); rebuild();
    uis[idx]?.focus?.();
  };
  const runAll = async () => { for (const u of uis) if (u.run && !(await u.run())) break; };

  function cellView(cell: Cell, index: number): CellUi {
    const ui: CellUi = { cell, el: h('div') };
    const out = h('div', { class: 'out' });
    const idx = () => nb.cells.indexOf(cell);
    const move = (d: number) => { const i = idx(), j = i + d; if (j < 0 || j >= nb.cells.length) return; nb.cells.splice(j, 0, nb.cells.splice(i, 1)[0]); persist(); rebuild(); };
    const menu = () => sheet(cell.type === 'sql' ? t('SQL cell') : t('Text cell'), [
      ...(cell.type === 'markdown' ? [{ label: t('Edit text'), run: () => ui.focus?.() }] : []),
      { label: t('Insert SQL cell below'), run: () => insertAt(idx() + 1, 'sql') },
      { label: t('Insert text cell below'), run: () => insertAt(idx() + 1, 'markdown') },
      { label: t('Move up'), run: () => move(-1) },
      { label: t('Move down'), run: () => move(1) },
      { label: t('Duplicate'), run: () => { nb.cells.splice(idx() + 1, 0, { ...cell, id: uid() }); persist(); rebuild(); } },
      { label: cell.type === 'sql' ? t('Change to text') : t('Change to SQL'), run: () => { cell.type = cell.type === 'sql' ? 'markdown' : 'sql'; persist(); rebuild(); } },
      { label: t('Clear output'), run: () => out.replaceChildren() },
      { label: t('Delete cell'), danger: true, run: () => { nb.cells.splice(idx(), 1); persist(); rebuild(); } },
    ]);

    const onChange = EditorView.updateListener.of((u) => {
      if (u.docChanged) { cell.source = u.state.doc.toString(); persist(); }
      if (u.focusChanged) u.view.hasFocus ? showAccessory(u.view, cell.type) : setTimeout(() => !document.activeElement?.closest('.cm-editor') && hideAccessory(), 60);
    });
    const theme = EditorView.theme({
      '&': { fontSize: '15px' },
      '.cm-content': { fontFamily: 'var(--mono)', padding: '6px 0' },
      '.cm-gutters': { minWidth: '28px' },
    });
    const makeEditor = (parent: HTMLElement, kind: 'sql' | 'md', extra: unknown[] = []) => {
      const view = new EditorView({
        parent,
        state: EditorState.create({
          doc: cell.source,
          extensions: [
            basicSetup,
            // Render completion popups on <body> so cell borders never clip them.
            tooltips({ parent: document.body, position: 'fixed' }),
            kind === 'sql' ? [schemaComp.of(sqlLang()), fnCompletion] : markdown(),
            EditorView.lineWrapping,
            placeholder(kind === 'sql' ? "SELECT * FROM 'file.csv' …" : t('Write notes in Markdown…')),
            theme,
            dark() ? oneDark : [],
            EditorState.tabSize.of(2),
            onChange,
            ...(extra as never[]),
          ],
        }),
      });
      editors.add(view);
      return view;
    };

    if (cell.type === 'sql') {
      const runBtn = h('button', { class: 'run', 'aria-label': 'Run cell' }, icon('play'));
      const ed = h('div', { class: 'editor' });
      const counter = h('span', { class: 'cell-meta' }, `[${index + 1}]`);
      ui.el = h('div', { class: 'cell sql' },
        h('div', { class: 'cell-head' }, runBtn, counter, h('div', { class: 'grow' }),
          h('button', { class: 'more', 'aria-label': 'Cell actions', onclick: menu }, icon('more'))),
        ed, out);
      const view = makeEditor(ed, 'sql', [keymap.of([{ key: 'Mod-Enter', run: () => (void ui.run!(), true) }, { key: 'Shift-Enter', run: () => (void ui.run!(), true) }])]);
      ui.focus = () => view.focus();
      ui.run = async () => {
        const text = view.state.doc.toString().trim();
        if (!text) return true;
        runBtn.classList.add('busy');
        counter.textContent = t('running…');
        out.replaceChildren();
        try {
          const feature = proFeature(text);
          if (feature && !(await requirePro(`${feature} ${t('is part of Pro.')}`))) throw { message: `${feature} ${t('needs Querly Pro')}` } as PgError;
          const r = await engine.exec(text);
          renderResult(out, r, text);
          counter.textContent = fmtMs(r.ms);
          if (r.written?.length) void refreshFiles();
          querySucceeded();
          return true;
        } catch (e) {
          counter.textContent = t('error');
          out.append(errorBox(e as PgError));
          return false;
        } finally {
          runBtn.classList.remove('busy');
        }
      };
      runBtn.onclick = () => void ui.run!();
    } else {
      const html = () => (cell.source.trim() ? (marked.parse(cell.source) as string) : `<p class="muted">${t('Empty text cell — tap to edit')}</p>`);
      const view = h('div', { class: 'md', html: html() });
      const ed = h('div', { class: 'editor hidden' });
      let editor: EditorView | null = null;
      const done = h('button', { class: 'link hidden' }, t('Done'));
      const edit = () => {
        view.classList.add('hidden'); ed.classList.remove('hidden'); done.classList.remove('hidden');
        editor ??= makeEditor(ed, 'md');
        editor.focus();
      };
      done.onclick = () => { view.innerHTML = html(); view.classList.remove('hidden'); ed.classList.add('hidden'); done.classList.add('hidden'); hideAccessory(); };
      // Reading comes first: a single tap never opens the editor (lessons are full of tappable solutions).
      view.ondblclick = (e) => { if (!(e.target as HTMLElement).closest('details, a')) edit(); };
      view.onclick = () => { if (!cell.source.trim()) edit(); };
      ui.focus = edit;
      ui.el = h('div', { class: 'cell md-cell' },
        h('div', { class: 'cell-head' }, h('span', { class: 'cell-meta' }, t('Text')), h('div', { class: 'grow' }), done,
          h('button', { class: 'more', 'aria-label': 'Cell actions', onclick: menu }, icon('more'))),
        view, ed);
      if (!cell.source.trim()) queueMicrotask(edit);
    }
    return ui;
  }

  rebuild();

  return h('div', { class: 'page nb' },
    h('header', { class: 'bar' },
      h('button', { class: 'back', onclick: async () => { clearTimeout(saveTimer); await saveNotebook(nb); notebooks.sort((a, b) => b.updated - a.updated); go({ tab: 'notebooks' }); } }, icon('back'), t('Notebooks')),
      h('div', { class: 'grow' }),
      statusPill(),
      h('button', { class: 'more', 'aria-label': 'Notebook actions', onclick: () => sheet(nb.title, [
        { label: t('Run all cells'), run: runAll },
        { label: t('Share as Jupyter notebook (.ipynb)'), run: () => shareFile(`${safeName(nb.title)}.ipynb`, toIpynb(nb), 'application/x-ipynb+json') },
        { label: t('Share as SQL script (.sql)'), run: () => shareFile(`${safeName(nb.title)}.sql`, toSql(nb), 'application/sql') },
        { label: t('Duplicate notebook'), run: async () => { const copy = structuredClone(nb); await newNotebook(copy.cells.map((c) => ({ ...c, id: uid() })), `${nb.title} copy`); } },
        { label: t('Delete notebook'), danger: true, run: async () => {
          if (!(await confirmBox(t('Delete notebook?'), `“${nb.title}” ${t('will be deleted. Tables and files are not affected.')}`, t('Delete'), true))) return;
          clearTimeout(saveTimer);
          await deleteNotebook(nb.id);
          notebooks = notebooks.filter((n) => n.id !== nb.id);
          go({ tab: 'notebooks' });
        } },
      ]) }, icon('more'))),
    title,
    cellsEl,
    h('div', { class: 'nb-foot' },
      h('button', { class: 'btn', onclick: () => insertAt(nb.cells.length, 'sql') }, icon('plus'), 'SQL'),
      h('button', { class: 'btn', onclick: () => insertAt(nb.cells.length, 'markdown') }, icon('plus'), t('Text')),
      h('button', { class: 'btn primary', onclick: runAll }, icon('play'), t('Run all'))));
}

// ---------------- keyboard accessory (symbols above the keyboard) ----------------
let accessory: HTMLElement | null = null;
let accView: EditorView | null = null;
function showAccessory(view: EditorView, kind: Cell['type']) {
  accView = view;
  hideAccessory(false);
  const keys = kind === 'sql'
    ? ['⇥', '*', ',', '(', ')', "'", ';', '=', '<', '>', '.', '_', ':', '%', '"', '[', ']', '{', '}', '|', '-', '+', '/']
    : ['#', '*', '`', '-', '[', ']', '(', ')', '>', '_'];
  const ins = (k: string) => {
    const v = accView!;
    const { from, to } = v.state.selection.main;
    const text = k === '⇥' ? '  ' : k;
    v.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
    v.focus();
  };
  const run = () => { const cell = accView?.dom.closest('.cell'); (cell?.querySelector('.run') as HTMLButtonElement | null)?.click(); };
  accessory = h('div', { class: 'accessory', onmousedown: (e: Event) => e.preventDefault(), ontouchstart: (e: Event) => e.preventDefault() },
    kind === 'sql' && h('button', { class: 'acc-run', ontouchend: (e: Event) => { e.preventDefault(); run(); }, onclick: run }, icon('play')),
    h('div', { class: 'acc-keys' }, keys.map((k) => h('button', { onclick: () => ins(k), ontouchend: (e: Event) => { e.preventDefault(); ins(k); } }, k))),
    h('button', { class: 'acc-done', ontouchend: (e: Event) => { e.preventDefault(); accView?.contentDOM.blur(); hideAccessory(); }, onclick: () => { accView?.contentDOM.blur(); hideAccessory(); } }, t('Done')));
  document.body.append(accessory);
  placeAccessory();
}
function hideAccessory(clear = true) {
  accessory?.remove();
  accessory = null;
  if (clear) accView = null;
}
function placeAccessory() {
  if (!accessory || !window.visualViewport) return;
  const vv = window.visualViewport;
  accessory.style.top = `${vv.offsetTop + vv.height - accessory.offsetHeight}px`;
}
window.visualViewport?.addEventListener('resize', placeAccessory);
window.visualViewport?.addEventListener('scroll', placeAccessory);

// ---------------- boot ----------------
function dismissKeyboardOnTapOutside() {
  document.addEventListener('pointerdown', (e) => {
    const target = e.target as HTMLElement;
    const activeEl = document.activeElement as HTMLElement | null;
    if (!activeEl || activeEl === document.body) return;
    if (target.closest('input, textarea, .cm-editor, .accessory, .dialog, .sheet')) return;
    activeEl.blur();
  }, true);
  document.addEventListener('touchmove', () => {
    const a = document.activeElement as HTMLElement | null;
    if (a && a.matches('input.search, input.field')) a.blur();
  }, { passive: true });
}

function trackKeyboard() {
  const set = (open: boolean) => document.body.classList.toggle('kb-open', open);
  if (native) {
    Keyboard.addListener('keyboardWillShow', () => set(true));
    Keyboard.addListener('keyboardWillHide', () => set(false));
  } else {
    document.addEventListener('focusin', (e) => set(!!(e.target as HTMLElement).closest('input, textarea, .cm-content')));
    document.addEventListener('focusout', () => setTimeout(() => set(!!document.activeElement?.closest('input, textarea, .cm-content')), 50));
  }
}

/** A file opened with "Open in Querly" / the share sheet arrives as a file:// URL (a copy in our Inbox). */
async function openSharedUrl(url: string) {
  if (!/^file:/i.test(url)) return;
  try {
    const name = decodeURIComponent(url.split('/').pop() || 'data.csv');
    let blob: Blob | null = null;
    try {
      const r = await fetch((window as unknown as { Capacitor: { convertFileSrc(u: string): string } }).Capacitor.convertFileSrc(url));
      if (r.ok) blob = await r.blob();
    } catch { /* fall back to the bridge */ }
    if (!blob) {
      const f = await Filesystem.readFile({ path: url });
      const bin = atob(typeof f.data === 'string' ? f.data : '');
      blob = new Blob([Uint8Array.from(bin, (c) => c.charCodeAt(0))]);
    }
    await importBlobs([{ name, blob }]);
    Filesystem.deleteFile({ path: url }).catch(() => {});
  } catch (e) {
    toast(`${t('Could not open this file')}: ${(e as Error).message}`, 'err');
  }
}

async function boot() {
  trackKeyboard();
  dismissKeyboardOnTapOutside();
  if (native) {
    Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => {});
    applyStatusBar();
  }
  notebooks = await loadNotebooks();
  let seeded = false;
  try { seeded = localStorage.getItem('qly-seeded') === '1'; } catch { /* ignore */ }
  if (!seeded) {
    await ensureSampleFiles();
    if (!notebooks.length) {
      const nb = sampleNotebook(CORE_SAMPLES[0], uid());
      await saveNotebook(nb);
      notebooks = [nb];
    }
    try { localStorage.setItem('qly-seeded', '1'); } catch { /* ignore */ }
  }
  await refreshFiles();
  render();
  if (native) {
    SplashScreen.hide().catch(() => {});
    CapApp.addListener('appUrlOpen', (e) => void openSharedUrl(e.url)).catch(() => {});
    CapApp.getLaunchUrl().then((u) => { if (u?.url) void openSharedUrl(u.url); }).catch(() => {});
    // Files dropped into Files › Querly › Data from outside show up when the app comes back.
    CapApp.addListener('appStateChange', (s) => { if (s.isActive) void refreshFiles().then(() => { if (route.tab === 'files' && !route.notebook) render(); }); }).catch(() => {});
  }
  void initPro().then(() => !route.notebook && render());
  engine.start().catch((e) => { console.error(e); toast(t('DuckDB did not start — see Database'), 'err'); });
}

// Automated checks (WebKit via Playwright) reach the engine through this hook; only with ?selftest in the URL.
if (new URLSearchParams(location.search).has('selftest')) Object.assign(window, { __engine: engine, __lessons: LESSONS, __samples: CORE_SAMPLES, __importBlobs: importBlobs, __go: go, __openSample: openSample });

engine.onState((s) => { if (s.status !== 'starting' && route.tab === 'database' && !route.notebook) render(); });
engine.onMeta(() => { if (route.tab === 'database' && !route.notebook && !document.querySelector('.modal-back, .sheet-back')) render(); });
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyTheme(); render(); });
void boot();
