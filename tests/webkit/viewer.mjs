// End-to-end check of the table viewer / editor in WebKit (the iOS engine) against the production build:
// open files without SQL, sort, search, filter, edit cells, add and delete rows and columns, undo, save, and make sure
// saving keeps unchanged values byte for byte (leading zeros, dates, quoted commas, the delimiter and the header).
// Usage: npx vite preview --port 4173 --strictPort & node tests/webkit/viewer.mjs   (APP_URL to override, SHOTS=dir for screenshots)
import { webkit } from 'playwright';

const URL_ = process.env.APP_URL || 'http://localhost:4173/?selftest';
const SHOTS = process.env.SHOTS || '';
const b = await webkit.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'en-US' });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(URL_);
await p.waitForFunction(() => window.__engine?.getState().status === 'ready', null, { timeout: 120000 });

let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failed++; };
const shot = async (n) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${n}.png` }); };
const count = () => p.locator('.v-count').innerText();
const cells = (col) => p.$$eval(`.v-table tbody tr`, (trs, c) => trs.map((tr) => tr.children[c + 1]?.textContent ?? ''), col);
const sheetBtn = (label) => p.locator('.sheet-btn', { hasText: label }).first().click();
const waitIdle = () => p.waitForTimeout(400);
const fileText = (name) => p.evaluate(async (n) => new TextDecoder().decode(await window.__engine.fileBytes(n)), name);

// 1. Semicolon CSV with tricky values, opened the way the share sheet does it (single file → viewer opens).
const original = 'id;name;joined;note\n007;Ada;2024-01-05;"hello; world"\n010;Alan;05/02/2023;\n003;Grace;2023-12-31;"say ""hi"""\n';
await p.evaluate(async (txt) => { await window.__importBlobs([{ name: 'people.csv', blob: new Blob([txt]) }], true); }, original);
await p.waitForSelector('.viewer .v-table tbody tr');
await waitIdle();
ok((await count()).includes('3') && (await count()).includes('4'), `opens with rows and columns: ${await count()}`);
ok(JSON.stringify(await cells(0)) === JSON.stringify(['007', '010', '003']), `leading zeros kept: ${await cells(0)}`);
ok((await cells(3))[0] === 'hello; world', `quoted delimiter read: ${(await cells(3))[0]}`);
await shot('1-open');

// Save without changes must reproduce the file exactly.
await p.evaluate(() => { document.querySelector('.v-save').disabled = false; });
await p.click('.v-save');
await sheetBtn('Save in Querly only');
await waitIdle();
ok((await fileText('people.csv')) === original, 'unchanged save is byte-identical');

// 2. Sort by id (numeric text sorts as numbers), then search, then a column filter.
await p.click('.v-table th[data-c="0"]');
await sheetBtn('Sort descending');
await waitIdle();
ok(JSON.stringify(await cells(0)) === JSON.stringify(['010', '007', '003']), `sort desc: ${await cells(0)}`);
await p.fill('.v-tools .search', 'gra');
await p.waitForTimeout(700);
ok((await cells(1)).join() === 'Grace', `search: ${await cells(1)}`);
await p.fill('.v-tools .search', '');
await p.waitForTimeout(700);
await p.locator('.v-chips .chip').first().click(); // clear sort
await waitIdle();
await shot('2-sorted');

// 3. Edit a cell.
await p.locator('.v-table tbody tr').nth(1).locator('td').nth(2).click();
await p.waitForSelector('.v-field');
await p.fill('.v-field', 'Alan Turing');
await p.locator('.dialog-actions button.primary').click();
await waitIdle();
ok((await cells(1))[1] === 'Alan Turing', `edit cell: ${await cells(1)}`);
ok(await p.locator('.v-title.dirty').count() === 1, 'marked as unsaved');
await shot('3-edited');

// 4. Add a column, add a row with the form, delete a row, undo the delete.
await p.click('.v-foot button:nth-child(2)');
await p.waitForSelector('.dialog input.field');
await p.fill('.dialog input.field', 'city');
await p.locator('.dialog-actions button.primary').click();
await waitIdle();
ok((await count()).includes('5'), `column added: ${await count()}`);
await p.click('.v-foot button:nth-child(1)');
await p.waitForSelector('.v-fields');
const fields = p.locator('.v-field');
await fields.nth(0).fill('099'); await fields.nth(1).fill('Linus'); await fields.nth(2).fill('2025-02-02'); await fields.nth(4).fill('Helsinki');
await p.locator('.dialog-actions button.primary').click();
await waitIdle();
ok((await cells(0)).join() === '007,010,003,099', `row added at end: ${await cells(0)}`);
await p.locator('.v-table tbody tr').nth(2).locator('td.rn').click();
await sheetBtn('Delete row');
await waitIdle();
ok((await cells(0)).join() === '007,010,099', `row deleted: ${await cells(0)}`);
await p.click('.v-foot button:nth-child(3)');
await waitIdle();
ok((await cells(0)).join() === '007,010,003,099', `undo restores the row in place: ${await cells(0)}`);
await shot('4-rows');

// 5. Save and check the file: same delimiter, header, untouched values kept exactly.
await p.click('.v-save');
await sheetBtn('Save in Querly only');
await waitIdle();
const saved = await fileText('people.csv');
const expected = 'id;name;joined;note;city\n007;Ada;2024-01-05;"hello; world";\n010;Alan Turing;05/02/2023;;\n003;Grace;2023-12-31;"say ""hi""";\n099;Linus;2025-02-02;;Helsinki\n';
ok(saved === expected, `saved file:\n${saved}`);
ok(await p.locator('.v-title.dirty').count() === 0, 'clean after save');

// 6. Rename a column then undo it; close.
await p.click('.v-table th[data-c="4"]');
await sheetBtn('Rename column');
await p.fill('.dialog input.field', 'town');
await p.locator('.dialog-actions button.primary').click();
await waitIdle();
ok((await p.locator('.v-table th[data-c="4"]').innerText()).startsWith('town'), 'rename column');
await p.click('.v-foot button:nth-child(3)');
await waitIdle();
ok((await p.locator('.v-table th[data-c="4"]').innerText()).startsWith('city'), 'undo rename');
// Delete a column and undo it (values come back in their rows).
await p.click('.v-table th[data-c="1"]');
await sheetBtn('Delete column');
await p.locator('.dialog-actions button.danger').click();
await waitIdle();
ok((await count()).includes('4 columns'), `column deleted: ${await count()}`);
await p.click('.v-foot button:nth-child(3)');
await waitIdle();
ok((await cells(1)).join() === 'Ada,Alan Turing,Grace,Linus', `undo delete column: ${await cells(1)}`);
// The viewer's tables must never reach the database snapshot.
const snapSql = await p.evaluate(async () => {
  const E = window.__engine;
  await E.exec('CREATE OR REPLACE TABLE keep_me AS SELECT 1 AS x');
  const files = await E.unpackSnapshot(await E.exportSnapshot());
  return files.filter((f) => f.name.endsWith('.sql')).map((f) => new TextDecoder().decode(f.data)).join(' ');
});
ok(snapSql.includes('keep_me') && !snapSql.includes('qv_'), 'snapshot excludes viewer tables');
await p.click('.viewer .back');
await waitIdle();
ok(await p.locator('.viewer').count() === 0, 'closes when nothing is unsaved');

// 7. TXT with tabs and no header row.
await p.evaluate(async () => { await window.__importBlobs([{ name: 'list.txt', blob: new Blob(['apple\t3\npear\t5\nplum\t1\n']) }], true); });
await p.waitForSelector('.viewer .v-table tbody tr');
await waitIdle();
const hdr = await p.locator('.v-table thead').innerText();
ok((await count()).includes('3'), `txt rows: ${await count()} header: ${hdr.replace(/\s+/g, ' ')}`);
await shot('7-txt');
await p.click('.viewer .back');
await waitIdle();

// 8. Excel without Pro: import is allowed, the viewer opens read-only, "Edit a CSV copy" makes an editable CSV.
await p.evaluate(async () => {
  const E = window.__engine;
  await E.exec('LOAD excel');
  const blob = await E.exportQuery(`SELECT * FROM (VALUES ('North', 120), ('South', 80)) t(region, sales)`, 'xlsx');
  await window.__importBlobs([{ name: 'sales.xlsx', blob }], true);
});
await p.waitForSelector('.viewer .v-table tbody tr', { timeout: 30000 });
await waitIdle();
ok(await p.locator('.paywall').count() === 0, 'no paywall when opening Excel');
ok((await cells(0)).join() === 'North,South', `excel rows: ${await cells(0)}`);
ok(await p.locator('.v-banner:not(.hidden)').count() === 1, 'read-only banner');
await shot('8-excel');
await p.locator('.v-banner .link').click();
await p.waitForFunction(() => /^sales(-\d+)?\.csv$/.test(document.querySelector('.viewer .v-title')?.textContent ?? ''), null, { timeout: 20000 });
await p.waitForSelector('.viewer .v-foot');
ok(true, 'CSV copy opened editable');
await p.click('.viewer .back');
await waitIdle();

// 9. Unsaved edits ask before closing.
await p.evaluate(() => window.__openFile('sales.csv'));
await p.waitForSelector('.viewer .v-table tbody tr');
await waitIdle();
await p.locator('.v-table tbody tr').nth(0).locator('td').nth(2).click();
await p.fill('.v-field', '999');
await p.locator('.dialog-actions button.primary').click();
await waitIdle();
await p.click('.viewer .back');
ok(await p.locator('.dialog-title', { hasText: 'Discard changes?' }).count() === 1, 'asks before discarding edits');
await p.locator('.dialog-actions button').first().click();
ok(await p.locator('.viewer').count() === 1, 'cancel keeps the viewer open');

ok(errors.length === 0, `no page errors ${errors.join(' | ')}`);
await b.close();
console.log(failed ? `${failed} FAILED` : 'ALL OK');
process.exit(failed ? 1 : 0);
