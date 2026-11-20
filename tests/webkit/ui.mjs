// Touch-driven UI check on an emulated iPhone: the tab bar switches pages, also after Pro turns on while a page is open
// (a Pro change used to re-render in an endless loop and freeze the app for anyone who had bought Pro).
// Usage: npx vite preview --port 4183 --strictPort & APP_URL='http://localhost:4183/?selftest' node tests/webkit/ui.mjs
import { webkit, devices } from 'playwright';

const URL_ = process.env.APP_URL || 'http://localhost:4183/?selftest';
const b = await webkit.launch();
const c = await b.newContext({ ...devices['iPhone 14'], locale: 'en-US' });
await c.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
const p = await c.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(URL_);
await p.waitForSelector('.open-card');
const title = () => p.evaluate(() => document.querySelector('.bar-title, .brand-name')?.textContent);
const alive = () => Promise.race([p.evaluate(() => new Promise((r) => setTimeout(() => r(true), 50))), new Promise((r) => setTimeout(() => r(false), 3000))]);
const fails = [];
for (const [i, want] of [[3, 'Settings'], [2, 'Analyze'], [1, 'Querly']]) {
  await p.evaluate(() => window.__setPro(false));
  await p.evaluate(() => window.__setPro(true));
  if (!(await alive())) { fails.push(`page froze after Pro turned on (before tab ${i})`); break; }
  await p.tap(`.tabbar button:nth-child(${i})`);
  await p.waitForTimeout(300);
  const got = await title();
  console.log(`tab ${i}: ${got}`);
  if (got !== want) fails.push(`tab ${i} shows ${got}, expected ${want}`);
}
// File types: every file opens somehow. Space-separated text gets columns, logs and unknown text open as lines,
// Markdown is rendered (without running scripts), pictures are kept for Quick Look.
const imported = async (name, text) => {
  await p.evaluate(async ([n, t]) => {
    document.querySelectorAll('.viewer, .modal-back').forEach((e) => e.remove());
    await window.__importBlobs([{ name: n, blob: new Blob([t]) }], true);
  }, [name, text]);
  await p.waitForTimeout(1500);
  return p.evaluate((n) => {
    const v = document.querySelector('.viewer')?.innerText.match(/\d+ rows? · \d+ columns?/)?.[0];
    if (v) return v;
    const md = document.querySelector('.md-body');
    if (md) return `markdown h1=${md.querySelector('h1')?.textContent} xss=${String(window.__x)}`;
    const err = document.querySelector('.toast.err')?.textContent;
    if (err) return 'error ' + err;
    return [...document.querySelectorAll('.row-title')].some((e) => e.textContent === n) ? 'kept' : 'nothing';
  }, name);
};
const checks = [
  ['frame.txt', '0 0.1 0.2 0.3 0.4\n0 0.5 0.6 0.7 0.8\n1 0.9 0.1 0.2 0.3\n', /3 rows · 5 columns/],
  ['server.log', 'INFO start, ok | 1\nWARN slow\n\nERROR done\n', /4 rows · 1 column/],
  ['settings.foo', 'a = 1\nb = 2\n', /2 rows · 1 column/],
  ['notes.md', '# Title\n\nSome text\n\n<img src=x onerror="window.__x=1">\n', /markdown h1=Title xss=undefined/],
  ['photo.jpg', '\xff\xd8\xff\xe0\x00\x10 binary', /kept/],
];
for (const [n, body, want] of checks) {
  const got = await imported(n, body);
  console.log(`${n}: ${got}`);
  if (!want.test(got)) fails.push(`${n}: got "${got}"`);
}
await b.close();
if (errs.length) fails.push(...errs.map((e) => 'pageerror ' + e));
if (fails.length) { console.error('UI check failed:\n' + fails.join('\n')); process.exit(1); }
console.log('UI check passed');
