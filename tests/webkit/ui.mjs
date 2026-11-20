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
await b.close();
if (errs.length) fails.push(...errs.map((e) => 'pageerror ' + e));
if (fails.length) { console.error('UI check failed:\n' + fails.join('\n')); process.exit(1); }
console.log('UI check passed');
