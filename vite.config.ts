import { defineConfig } from 'vite';

export default defineConfig({
  // DuckDB's worker and wasm are served from public/duckdb (see scripts/duckdb-assets.mjs), not bundled.
  optimizeDeps: { exclude: ['@duckdb/duckdb-wasm'] },
  build: { target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 4000 },
  server: { port: 5199 },
});
