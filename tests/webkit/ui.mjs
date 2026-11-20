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
// File types: space-separated text gets columns, notes open as lines, pictures are refused with a message.
const imported = async (name, text) => {
  await p.evaluate(async ([n, t]) => { document.querySelector('.viewer .back, .viewer button')?.click(); await window.__importBlobs([{ name: n, blob: new Blob([t]) }], true); }, [name, text]);
  await p.waitForTimeout(1500);
  return p.evaluate(() => document.querySelector('.viewer')?.innerText.match(/\d+ rows? · \d+ columns?/)?.[0] ?? (document.querySelector('.toast')?.textContent || 'nothing'));
};
const checks = [
  ['frame.txt', '0 0.1 0.2 0.3 0.4\n0 0.5 0.6 0.7 0.8\n1 0.9 0.1 0.2 0.3\n', /3 rows · 5 columns/],
  ['notes.md', '# Title\n\nSome text, with a comma | and a pipe\n- item\n', /rows? · 1 column/],
  ['photo.jpg', '\xff\xd8\xff\xe0 binary', /opens data and text files/],
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
