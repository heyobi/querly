// End-to-end check of the production build in WebKit (the iOS engine), with the network to duckdb.org blocked:
// every bundled extension loads from app files, every example and lesson runs, file import / export work, and the
// database survives a restart through its snapshot.
// Usage: npx vite preview --port 4173 --strictPort & node tests/webkit/app.mjs
import { webkit } from 'playwright';

const URL_ = process.env.APP_URL || 'http://localhost:4173/?pro&selftest';
const b = await webkit.launch();
const ctx = await b.newContext();
const p = await ctx.newPage();
const external = [];
await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => { external.push(r.request().url()); r.abort(); });
p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await p.goto(URL_);
await p.waitForFunction(() => window.__engine?.getState().status === 'ready', null, { timeout: 120000 });

const log = await p.evaluate(async () => {
  const E = window.__engine;
  const log = [];
  const step = async (name, fn) => {
    try { const r = await fn(); log.push(`${name} ok${r !== undefined ? ' ' + r : ''}`); return true; }
    catch (e) { log.push(`${name} ERR ${(e?.message || JSON.stringify(e)).slice(0, 200)}`); return false; }
  };
  const one = async (sql) => (await E.exec(sql)).results[0];
  log.push(`version ${E.getState().version} mode ${E.getState().extMode}`);

  // Extensions, each loaded explicitly and used once.
  const ext = {
    parquet: `COPY (SELECT 1 AS a) TO 'x_test.parquet' (FORMAT parquet); SELECT count(*) FROM 'x_test.parquet'`,
    json: `SELECT '{"a":[1,2]}'::JSON->'$.a' AS j`,
    icu: `SELECT (TIMESTAMPTZ '2024-01-01 12:00:00+00' AT TIME ZONE 'Europe/Istanbul')::VARCHAR`,
    excel: `COPY (SELECT 1 AS a) TO 'x_test.xlsx' (FORMAT xlsx, HEADER true); SELECT * FROM read_xlsx('x_test.xlsx')`,
    spatial: `SELECT ST_AsText(ST_Buffer(ST_Point(0, 0), 1)) IS NOT NULL`,
    sqlite_scanner: `SELECT count(*) FROM duckdb_functions() WHERE function_name = 'sqlite_scan'`,
    fts: `SELECT stem('running', 'english')`,
    inet: `SELECT '192.168.1.5/24'::INET`,
    vss: `SELECT array_distance([1, 2]::FLOAT[2], [2, 2]::FLOAT[2])`,
    tpch: `SELECT count(*) FROM tpch_queries()`,
    tpcds: `SELECT count(*) FROM tpcds_queries()`,
    autocomplete: `SELECT suggestion FROM sql_auto_complete('SELE') LIMIT 1`,
  };
  for (const [name, sql] of Object.entries(ext)) {
    await step(`ext ${name}`, async () => { await E.exec(`LOAD ${name}`); const r = await one(sql); return JSON.stringify(r.rows[0]).slice(0, 60); });
  }

  // Import a file the way the share sheet does, then query it by name.
  await step('import csv', async () => {
    await window.__importBlobs([{ name: 'people.csv', blob: new Blob(['name,age\nAda,36\nAlan,41\nGrace,85\n']) }]);
    const r = await one(`SELECT avg(age) AS a FROM 'people.csv'`);
    if (r.rows[0][0] !== 54) throw new Error('avg ' + r.rows[0][0]);
    return r.rows[0][0];
  });

  // Every example and lesson cell.
  for (const s of [...window.__samples, ...window.__lessons]) {
    let fails = 0, n = 0;
    for (const [kind, src] of s.cells) {
      if (kind !== 'sql' || !src.trim()) continue;
      n++;
      try { await E.exec(src); } catch (e) { fails++; log.push(`  ${s.key} cell ERR ${(e?.message || '').slice(0, 160)} :: ${src.slice(0, 60)}`); }
    }
    log.push(`sample ${s.key} ${n - fails}/${n}`);
  }

  // Types come through readable.
  await step('types', async () => {
    const r = await one(`SELECT 1::BIGINT AS i, 2.5::DECIMAL(5,2) AS d, DATE '2025-01-02' AS dt, TIMESTAMP '2025-01-02 03:04:05' AS ts, [1,2] AS l, {'a': 1} AS s, 'x'::BLOB AS b, ST_Point(1, 2) AS g`);
    return JSON.stringify({ types: r.fields.map((f) => f.type), row: r.rows[0] }).slice(0, 260);
  });

  // Large results are capped without materialising everything.
  await step('big result capped', async () => { const r = await one(`SELECT * FROM range(2000000)`); if (!r.truncated || r.rows.length !== 5000) throw new Error('not capped'); return r.rows.length; });

  // Export formats.
  for (const f of ['csv', 'parquet', 'json', 'xlsx']) await step(`export ${f}`, async () => (await E.exportQuery(`SELECT * FROM 'sales.csv'`, f)).size);

  // Persistence: write, snapshot, restart DuckDB, read back.
  await step('persist', async () => {
    await E.exec(`CREATE OR REPLACE TABLE persist_check AS SELECT range AS i FROM range(1234); CREATE OR REPLACE VIEW persist_view AS SELECT count(*) AS n FROM persist_check`);
    await new Promise((r) => setTimeout(r, 2500));
    await E.save();
    await E.start();
    const r = await one(`SELECT n FROM persist_view`);
    if (r.rows[0][0] !== 1234) throw new Error('got ' + r.rows[0][0]);
    return `${r.rows[0][0]} rows after restart`;
  });
  await step('snapshot export/import', async () => { const b = await E.exportSnapshot(); await E.importSnapshot(b); return (await one(`SELECT count(*) FROM persist_check`)).rows[0][0]; });
  await step('meta', async () => { const m = await E.refreshMeta(); return `${m.tables.length} tables, ${m.functions.length} functions`; });
  return log;
});

console.log(log.join('\n'));
if (external.length) console.log('EXTERNAL REQUESTS (blocked):', [...new Set(external)].join(', '));
await b.close();
const bad = log.filter((l) => / ERR /.test(l) || (/^sample /.test(l) && !/ (\d+)\/\1$/.test(l)));
if (bad.length || external.length) { console.error(`WebKit check failed (${bad.length} problems, ${external.length} external requests)`); process.exit(1); }
console.log('WebKit check passed');
