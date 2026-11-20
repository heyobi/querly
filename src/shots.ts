// App Store screenshot tour, compiled in only when VITE_SHOTS=1 (the simulator build in screenshots.yml).
// Each step sets up a screen, then writes its name to Documents/shots/ready. scripts/sim-shots.sh takes the
// screenshot with simctl and answers by writing the same name to Documents/shots/next.
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { setThemePref, type Theme } from './i18n';

type W = Window & {
  __engine: typeof import('./engine');
  __samples: { key: string }[];
  __importBlobs(items: { name: string; blob: Blob }[], open?: boolean): Promise<void>;
  __openFile(name: string): void;
  __go(r: { tab: string; notebook?: string }): void;
  __openSample(s: unknown): Promise<void>;
  __setPro(v: boolean): void;
  __analyze(name: string): Promise<void>;
};
const w = window as unknown as W;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (fn: () => boolean, ms = 30000) => { const t0 = Date.now(); while (!fn() && Date.now() - t0 < ms) await sleep(200); };
const write = (path: string, data: string) => Filesystem.writeFile({ directory: Directory.Documents, path, data, encoding: Encoding.UTF8, recursive: true });
const read = async (path: string) => {
  try { return String((await Filesystem.readFile({ directory: Directory.Documents, path, encoding: Encoding.UTF8 })).data); } catch { return ''; }
};

function closeAll() {
  document.querySelectorAll('.viewer, .modal-back, .sheet-back').forEach((e) => e.remove());
  document.body.classList.remove('in-viewer');
}
function theme(t: Theme) { setThemePref(t); w.__go({ tab: 'files' }); }
async function runCell(i: number) {
  (document.querySelectorAll('.cell.sql .run')[i] as HTMLButtonElement | undefined)?.click();
  await until(() => !!document.querySelectorAll('.cell.sql')[i]?.querySelector('.out')?.children.length);
}

/** A believable library: the samples plus Excel, Parquet, JSON and a log made from them (one import, nothing opens). */
async function seed() {
  const E = w.__engine;
  const items: { name: string; blob: Blob }[] = [];
  const make = async (name: string, sql: string, fmt: 'xlsx' | 'parquet' | 'json') => {
    try { items.push({ name, blob: await E.exportQuery(sql, fmt) }); } catch { /* skip */ }
  };
  await make('Orders 2025.xlsx', `SELECT * FROM 'sales.csv'`, 'xlsx');
  await make('sales_by_region.parquet', `SELECT region, product, sum(quantity) AS units, round(sum(quantity * unit_price), 2) AS revenue FROM 'sales.csv' GROUP BY ALL`, 'parquet');
  await make('cities.json', `SELECT * FROM 'cities.csv'`, 'json');
  const log = Array.from({ length: 60 }, (_, i) => `2025-06-${String(1 + (i % 28)).padStart(2, '0')} ${['INFO', 'INFO', 'WARN', 'INFO', 'ERROR'][i % 5]} worker-${i % 4} request ${1000 + i}`).join('\n');
  items.push({ name: 'server.log', blob: new Blob([log]) });
  await w.__importBlobs(items);
  closeAll();
}

/** Bring a result (chart, map) into the middle of the screen. */
async function centre(cell: number, sel: string) {
  await until(() => !!document.querySelectorAll('.cell.sql')[cell]?.querySelector(sel), 20000);
  const el = document.querySelectorAll('.cell.sql')[cell]?.querySelector(sel) as HTMLElement | undefined;
  el?.scrollIntoView({ block: 'center' });
}

const steps: [string, () => Promise<void>][] = [
  ['files', async () => { closeAll(); theme('dark'); await sleep(2500); }],
  ['viewer', async () => { w.__openFile('sales.csv'); await until(() => !!document.querySelector('.v-insight:not(.hidden)')); }],
  ['stats', async () => {
    (document.querySelector('.vi-num') as HTMLElement | null)?.click();
    await until(() => !!document.querySelector('.cs-stats'));
  }],
  ['chart', async () => {
    closeAll();
    await w.__analyze('sales.csv');
    await until(() => document.querySelectorAll('.result').length >= 4, 40000);
    await centre(1, '.chart');
  }],
  ['trend', async () => { theme('light'); await w.__analyze('sales.csv'); await until(() => document.querySelectorAll('.result').length >= 4, 40000); await centre(2, '.chart'); }],
  ['map', async () => {
    w.__go({ tab: 'notebooks' });
    await w.__openSample(w.__samples.find((s) => s.key === 'spatial'));
    await until(() => !!document.querySelector('.cell.sql'));
    await runCell(0);
    await until(() => !!document.querySelector('.out canvas, .out svg'), 40000);
    await centre(0, '.result');
  }],
  ['log', async () => { theme('dark'); await w.__analyze('server.log'); await until(() => document.querySelectorAll('.result').length >= 3, 40000); await centre(1, '.chart'); }],
  ['analyze', async () => { theme('light'); w.__go({ tab: 'notebooks' }); }],
];

export async function startTour() {
  await until(() => w.__engine?.getState().status === 'ready', 120000);
  w.__setPro(true);
  await Filesystem.deleteFile({ directory: Directory.Documents, path: 'shots/next' }).catch(() => {});
  await seed();
  for (const [name, setup] of steps) {
    try { await setup(); } catch (e) { console.error('shot', name, e); }
    await sleep(1800);
    await write('shots/ready', name);
    const t0 = Date.now();
    while ((await read('shots/next')) !== name && Date.now() - t0 < 60000) await sleep(300);
  }
  await write('shots/ready', 'done');
}
