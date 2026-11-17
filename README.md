# Querly: SQL for Your Files

An iPhone app that runs **DuckDB** on the device and lets you query **CSV, Parquet, JSON and Excel** files with SQL,
in Jupyter-style notebooks. No server, no upload, no account.

- DuckDB 1.5 via [DuckDB-Wasm](https://github.com/duckdb/duckdb-wasm) in a Web Worker, inside a Capacitor 8 app
- Extensions bundled in the app and loaded offline: parquet, json, icu, excel, spatial, sqlite_scanner, fts, inet,
  vss, tpch, tpcds, autocomplete
- Query files by name: `SELECT * FROM 'sales.csv'`; `COPY … TO 'out.csv'` writes into the Files app
- Notebooks stored as `.ipynb`; results as table, chart, map; export CSV / Parquet / Excel / JSON
- 10 lessons and example notebooks; English and Turkish UI

Powered by DuckDB. Querly is independent and not affiliated with or endorsed by the DuckDB Foundation.

## Free and Pro

Free: SQL, notebooks, CSV/TSV/JSON files up to 25 MB, table results, CSV export, lessons and examples, one database.
Pro (one-time purchase): Parquet, Excel and SQLite files, spatial SQL with maps, charts, Parquet/Excel/JSON export,
larger files, more databases, backups and restores.

## How it works

| Piece | Where |
|---|---|
| Worker that hosts DuckDB and maps extension loads to bundled files | `public/querly.worker.js` |
| Copies DuckDB's wasm/worker and downloads extensions (pinned SHA-256) | `scripts/duckdb-assets.mjs` |
| Engine: queries, files, snapshots (EXPORT/IMPORT DATABASE as Parquet) | `src/engine.ts` |
| Free/Pro rules and file kinds | `src/features.ts` |
| UI | `src/main.ts`, `src/results.ts`, `src/ui.ts` |

DuckDB runs in memory; after each change the database is exported as a Parquet snapshot into app storage and imported
again on launch.

## Develop

```bash
npm ci
npm run dev          # http://localhost:5199/?pro  (pro unlocks everything in the browser)
npm test             # unit tests
npm run build && npx vite preview --port 4183 --strictPort &
APP_URL='http://localhost:4183/?pro&selftest' node tests/webkit/app.mjs   # end-to-end in WebKit, network blocked
```

Test in WebKit (Playwright), not Chrome: it is the iOS engine.

## Release

`.github/workflows/ios-testflight.yml` type-checks, runs the WebKit check, then builds, signs and uploads to TestFlight
on every push to `main`. Repository secrets: `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`,
`APP_STORE_CONNECT_PRIVATE_KEY`, `BUILD_CERTIFICATE_BASE64`, `P12_PASSWORD`, `KEYCHAIN_PASSWORD`.

## Licence

MIT. DuckDB is MIT-licensed. The spatial extension bundles GDAL, GEOS and PROJ.
