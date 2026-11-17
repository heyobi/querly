// The DuckDB extensions bundled with the app (see scripts/duckdb-assets.mjs). All load offline from app files.
// `pro` marks extensions whose main use is a Pro feature (see features.ts); the rest are free.

export interface ExtInfo {
  id: string; title: string; tagline: string; about: string; category: string;
  sizeKb: number; license: string; pro?: boolean; example?: string; sample?: string; autoload?: boolean;
}

export const EXTENSIONS: ExtInfo[] = [
  { id: 'parquet', title: 'Parquet', tagline: 'Read and write Apache Parquet files', category: 'File formats', sizeKb: 3143, license: 'MIT', pro: true, autoload: true,
    about: 'Columnar file format used across data engineering. Query .parquet files by name, read row groups and statistics with parquet_metadata(), and write results with COPY … (FORMAT parquet).',
    example: `SELECT * FROM 'sales.parquet' LIMIT 10;`, sample: 'parquet' },
  { id: 'excel', title: 'Excel', tagline: 'Read and write .xlsx workbooks', category: 'File formats', sizeKb: 580, license: 'MIT', pro: true,
    about: 'read_xlsx() reads a sheet (or a range) into a table; COPY … (FORMAT xlsx) writes one. Also adds Excel-style number formatting with text().',
    example: `SELECT * FROM read_xlsx('revenue.xlsx', header = true);`, sample: 'excel' },
  { id: 'json', title: 'JSON', tagline: 'JSON type, functions and JSON files', category: 'File formats', sizeKb: 802, license: 'MIT', autoload: true,
    about: 'A JSON type with ->, ->> and json_* functions, plus read_json_auto() for JSON and newline-delimited JSON files, with automatic schema detection.',
    example: `SELECT * FROM read_json_auto('orders.json');`, sample: 'nested' },
  { id: 'sqlite_scanner', title: 'SQLite', tagline: 'Open SQLite databases', category: 'File formats', sizeKb: 1603, license: 'MIT', pro: true,
    about: 'ATTACH a .sqlite or .db file and query its tables with DuckDB, or copy them into your database. Great for app exports and backups.',
    example: `ATTACH 'my.sqlite' AS lite (TYPE sqlite, READ_ONLY);\nSELECT name FROM lite.sqlite_master WHERE type = 'table';` },
  { id: 'spatial', title: 'Spatial', tagline: 'GEOMETRY type and ST_ functions', category: 'Geospatial', sizeKb: 23019, license: 'MIT (GDAL, GEOS, PROJ)', pro: true,
    about: 'Hundreds of spatial functions (ST_Point, ST_Distance_Sphere, ST_Buffer, ST_Intersects…), coordinate transforms, and ST_Read() for GeoJSON, Shapefile, GeoPackage and more. Results open on a map.',
    example: `SELECT ST_AsText(ST_Buffer(ST_Point(28.98, 41.01), 0.5));`, sample: 'spatial' },
  { id: 'icu', title: 'ICU', tagline: 'Time zones, collations, calendars', category: 'Text & time', sizeKb: 6240, license: 'MIT / Unicode', autoload: true,
    about: 'TIMESTAMPTZ with real time zones (AT TIME ZONE \'Europe/Istanbul\'), locale-aware sorting (COLLATE tr) and calendar functions.',
    example: `SELECT now() AT TIME ZONE 'Europe/Istanbul' AS istanbul, now() AT TIME ZONE 'America/New_York' AS new_york;` },
  { id: 'fts', title: 'Full-text search', tagline: 'Inverted index with BM25 ranking', category: 'Text & time', sizeKb: 463, license: 'MIT',
    about: 'PRAGMA create_fts_index builds a search index over text columns; match_bm25() ranks rows by relevance. Includes stemmers for many languages.',
    example: `SELECT stem('running', 'english'), stem('koşuyorum', 'turkish');`, sample: 'search' },
  { id: 'inet', title: 'inet', tagline: 'IP addresses and networks', category: 'Data types', sizeKb: 580, license: 'MIT',
    about: 'An INET type for IPv4/IPv6 addresses and CIDR ranges, with containment operators and host/netmask functions. Handy for log analysis.',
    example: `SELECT '192.168.1.42'::INET <<= '192.168.1.0/24'::INET AS in_subnet, host('10.0.0.7/8'::INET);` },
  { id: 'vss', title: 'Vector search', tagline: 'HNSW index for embeddings', category: 'AI & vectors', sizeKb: 394, license: 'MIT',
    about: 'Similarity search over fixed-size FLOAT arrays with an HNSW index and array_distance / array_cosine_similarity. Store embeddings next to your data.',
    example: `SELECT array_cosine_similarity([1, 2, 3]::FLOAT[3], [2, 2, 3]::FLOAT[3]) AS similarity;` },
  { id: 'tpch', title: 'TPC-H', tagline: 'Benchmark data generator', category: 'Benchmarks', sizeKb: 1009, license: 'MIT',
    about: 'CALL dbgen(sf = 0.01) creates the eight TPC-H tables; PRAGMA tpch(n) runs the 22 standard queries. A quick way to get realistic data to practise on.',
    example: `CALL dbgen(sf = 0.01);\nPRAGMA tpch(6);`, sample: 'tpch' },
  { id: 'tpcds', title: 'TPC-DS', tagline: 'Retail benchmark data generator', category: 'Benchmarks', sizeKb: 2183, license: 'MIT',
    about: 'CALL dsdgen(sf = 0.01) creates the 24-table TPC-DS retail schema; tpcds_queries() lists the 99 benchmark queries.',
    example: `SELECT query_nr, left(query, 80) AS starts_with FROM tpcds_queries() LIMIT 5;` },
  { id: 'autocomplete', title: 'Autocomplete', tagline: 'SQL completion suggestions', category: 'Tools', sizeKb: 2063, license: 'MIT',
    about: 'sql_auto_complete(text) suggests the next keyword, table, column or function for a partial query.',
    example: `SELECT suggestion FROM sql_auto_complete('SELECT * FR');` },
];

export const EXT_CATEGORIES = [...new Set(EXTENSIONS.map((e) => e.category))];
