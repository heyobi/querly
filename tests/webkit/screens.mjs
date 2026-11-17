// App Store screenshots (1206x2622 = iPhone 6.3" slot) from the production build in WebKit, English UI.
// Usage: npx vite preview --port 4183 --strictPort & node tests/webkit/screens.mjs [outDir]
import { webkit } from 'playwright';
import fs from 'node:fs';

const URL_ = process.env.APP_URL || 'http://localhost:4183/?pro&selftest';
const out = process.argv[2] || 'store/screens';
const lang = process.env.LANG_UI || 'en';
fs.mkdirSync(out, { recursive: true });
const b = await webkit.launch();

async function session(scheme, shots) {
  const ctx = await b.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, colorScheme: scheme, locale: lang === 'tr' ? 'tr-TR' : 'en-US' });
  const p = await ctx.newPage();
  await p.addInitScript((l) => { try { localStorage.setItem('qly-lang', l); } catch {} }, lang);
  await p.goto(URL_);
  await p.waitForFunction(() => window.__engine?.getState().status === 'ready', null, { timeout: 120000 });
  await p.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important} .bar{background:var(--bg)!important}' });
  for (const [name, fn] of shots) { await fn(p); await p.waitForTimeout(700); await p.screenshot({ path: `${out}/${name}.png` }); console.log('saved', name); }
  await ctx.close();
}

const openSample = (key) => async (p) => {
  await p.evaluate((k) => window.__openSample(window.__samples.find((s) => s.key === k) || window.__lessons.find((s) => s.key === k)), key);
  await p.waitForSelector('.cell.sql');
};
const runCell = (i) => async (p) => { await p.locator('.cell.sql .run').nth(i).click(); await p.waitForFunction((n) => document.querySelectorAll('.cell.sql')[n]?.querySelector('.out')?.children.length, i, { timeout: 60000 }); };
const scrollTo = (sel, n = 0) => async (p) => { await p.locator(sel).nth(n).evaluate((e) => e.scrollIntoView({ block: 'start' })); await p.evaluate(() => window.scrollBy(0, -70)); };

await session('dark', [
  ['1-chart', async (p) => { await openSample('welcome')(p); await runCell(3)(p); await p.locator('.cell.sql').nth(3).locator('.seg button').nth(1).click(); await scrollTo('.cell.sql', 3)(p); }],
  ['2-table', async (p) => { await runCell(2)(p); await scrollTo('.cell.sql', 2)(p); }],
  ['3-summarize', async (p) => { await runCell(1)(p); await scrollTo('.cell.sql', 1)(p); }],
  ['4-extensions', async (p) => { await p.evaluate(() => window.__go({ tab: 'extensions' })); await p.waitForSelector('.featured'); await p.waitForTimeout(800); }],
  ['5-files', async (p) => { await p.evaluate(() => window.__go({ tab: 'files' })); await p.waitForSelector('.kind'); }],
]);
await session('light', [
  ['6-map', async (p) => { await openSample('spatial')(p); await runCell(0)(p); await scrollTo('.cell.sql', 0)(p); }],
  ['7-lesson', async (p) => { await openSample('learn-7')(p); await runCell(0)(p); await scrollTo('.cell.sql', 0)(p); }],
  ['8-home', async (p) => { await p.evaluate(() => window.__go({ tab: 'notebooks' })); await p.waitForSelector('.cards'); }],
]);

// In-app purchase review screenshot (1290x2796): the paywall, as a user without Pro sees it.
{
  const ctx = await b.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, colorScheme: 'dark', locale: 'en-US' });
  const p = await ctx.newPage();
  await p.addInitScript(() => { try { localStorage.setItem('qly-lang', 'en'); localStorage.setItem('qly-pro', '0'); } catch {} });
  await p.goto(URL_.replace('pro&', '').replace('&pro', ''));
  await p.waitForFunction(() => window.__engine?.getState().status === 'ready', null, { timeout: 120000 });
  await p.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
  await p.evaluate(() => window.__go({ tab: 'database' }));
  await p.locator('button', { hasText: 'New database' }).click();
  await p.waitForSelector('.paywall');
  await p.waitForTimeout(700);
  await p.screenshot({ path: 'assets/iap-review-1290x2796.png' });
  console.log('saved paywall');
  await ctx.close();
}
await b.close();
