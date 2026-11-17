// Puts everything DuckDB needs at runtime into public/duckdb/ so the app never touches the network:
//  - the DuckDB-Wasm worker + wasm (exception-handling build, which every iOS 16.4+ WebKit supports)
//  - the official extension binaries for this DuckDB version, downloaded once and pinned by SHA-256
// Usage: node scripts/duckdb-assets.mjs   (runs before dev/build)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const DUCKDB_VERSION = 'v1.5.4';
// sha256 of https://extensions.duckdb.org/<version>/wasm_eh/<name>.duckdb_extension.wasm
const EXTENSIONS = {
  parquet: '4845705bbd69fc9ad52878d96a505c73cae4a6c509822079cc2413e5eb437f95',
  json: '993b19f7929cc305b2529c548f2842e8e7a5b112d1c88f31c84798b51901ca16',
  icu: 'ecdbbb29331f72103b8eb227db5792f186b191a4f7a359db8dda9919b0a736de',
  excel: '7cba33e0c37b02640c16e390d1f47bbe46570ea261bdc2ce735ac52f1cff3505',
  spatial: 'ccb0599b7203d4b9e4b551421a5685f0a7c988fc762ffafd98dabe1f01934971',
  sqlite_scanner: '489c1be5b6e9b839c1eff358486337e72e1d209f113b620deb5987d094fc32a9',
  fts: '7f075f760004e731759965cd39a434ac05bab1aa56df94cdb36048c0fd20414a',
  inet: 'e9bc86dae665277f348fd433686fa7ead7c6ef057f9530abbdd1e7b3cb064b7a',
  vss: '8252fc639a0a8afd5b6b73ed137c4e9b45d068d55aab14f471ff2dd84889a0a7',
  tpch: '7d68cad8a8e27f5bea486fc275eb86af32c037715a75fb6031c83457d9b92027',
  tpcds: '4529f5fcfe410cb1a229b5979c19788e25f5292133b0bd4f43b22b9c984254b1',
  autocomplete: '56ed85e85c671a262eb010b276278244c8a26e9146005f780ec5e34fb3cb2dec',
};

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const out = path.join(root, 'public', 'duckdb');
const extDir = path.join(out, 'ext', DUCKDB_VERSION, 'wasm_eh');
const cache = path.join(root, '.cache', 'duckdb-ext', DUCKDB_VERSION);
fs.mkdirSync(extDir, { recursive: true });
fs.mkdirSync(cache, { recursive: true });

const dist = path.join(root, 'node_modules', '@duckdb', 'duckdb-wasm', 'dist');
for (const f of ['duckdb-browser-eh.worker.js', 'duckdb-eh.wasm']) {
  const src = path.join(dist, f), dst = path.join(out, f);
  if (!fs.existsSync(dst) || fs.statSync(dst).size !== fs.statSync(src).size) fs.copyFileSync(src, dst);
}

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
for (const [name, want] of Object.entries(EXTENSIONS)) {
  const file = `${name}.duckdb_extension.wasm`;
  const cached = path.join(cache, file);
  let buf = fs.existsSync(cached) ? fs.readFileSync(cached) : null;
  if (!buf || sha(buf) !== want) {
    const url = `https://extensions.duckdb.org/${DUCKDB_VERSION}/wasm_eh/${file}`;
    process.stdout.write(`downloading ${url}\n`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
    if (sha(buf) !== want) throw new Error(`${file}: checksum mismatch (${sha(buf)})`);
    fs.writeFileSync(cached, buf);
  }
  const dst = path.join(extDir, file);
  if (!fs.existsSync(dst) || fs.statSync(dst).size !== buf.length) fs.writeFileSync(dst, buf);
}
fs.writeFileSync(path.join(out, 'ext', 'ok.txt'), 'ok');
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ version: DUCKDB_VERSION, extensions: Object.keys(EXTENSIONS) }));
console.log(`DuckDB assets ready (${Object.keys(EXTENSIONS).length} extensions, ${DUCKDB_VERSION})`);
