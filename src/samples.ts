// Built-in example notebooks. Each one uses its own table names and starts clean (CREATE OR REPLACE), so examples never
// collide with lessons or with the user's own tables. `pro` marks examples that use Pro features.
import type { Notebook } from './notebook';

export interface Sample { key: string; title: string; subtitle: string; pro?: boolean; cells: ['md' | 'sql', string][] }

export const SAMPLE_FILES = ['sales.csv', 'cities.csv'];

export const CORE_SAMPLES: Sample[] = [
  {
    key: 'welcome',
    title: 'Welcome to Querly',
    subtitle: 'Query a CSV file in place, aggregate, chart',
    cells: [
      ['md', '# Welcome\nQuerly runs **DuckDB**, a fast analytical database, right on your iPhone. No network, no account.\n\n`sales.csv` is in your **Files** tab (and in the Files app under *On My iPhone › Querly › Data*). DuckDB reads it directly, no import step needed. Tap ▶ to run a cell, or **Run all** at the bottom.'],
      ['sql', `SELECT * FROM 'sales.csv' LIMIT 10;`],
      ['md', '## Describe the file\n`DESCRIBE` shows the column types DuckDB detected. `SUMMARIZE` profiles every column: min, max, unique values, nulls.'],
      ['sql', `SUMMARIZE SELECT * FROM 'sales.csv';`],
      ['md', '## Revenue per category and region\n`GROUP BY ALL` groups by every column that is not an aggregate.'],
      ['sql', `SELECT category, region, round(sum(quantity * unit_price), 2) AS revenue
FROM 'sales.csv'
GROUP BY ALL
ORDER BY revenue DESC;`],
      ['md', '## Monthly trend\nResults with numbers can be shown as a **Chart** (Pro).'],
      ['sql', `SELECT date_trunc('month', order_date) AS month,
       round(sum(quantity * unit_price)) AS revenue,
       count(DISTINCT customer) AS customers
FROM 'sales.csv'
GROUP BY ALL
ORDER BY month;`],
      ['md', '## Keep it as a table\nA table lives in your database and is saved automatically. Querying the file again is just as fine: whatever you prefer.'],
      ['sql', `CREATE OR REPLACE TABLE welcome_sales AS SELECT * FROM 'sales.csv';
SELECT count(*) AS orders, min(order_date) AS first, max(order_date) AS last FROM welcome_sales;`],
    ],
  },
  {
    key: 'friendly',
    title: 'Friendly SQL',
    subtitle: 'EXCLUDE, COLUMNS, QUALIFY, PIVOT and more',
    cells: [
      ['md', '# Friendly SQL\nDuckDB adds many small conveniences to standard SQL. A few favourites:'],
      ['sql', `CREATE OR REPLACE TABLE friendly_sales AS SELECT * FROM 'sales.csv';
-- Every column except a few
SELECT * EXCLUDE (customer, order_id) FROM friendly_sales LIMIT 5;`],
      ['md', '`COLUMNS()` applies an expression to many columns at once, chosen by a regular expression:'],
      ['sql', `SELECT max(COLUMNS('quantity|unit_price')), min(COLUMNS('order_.*')) FROM friendly_sales;`],
      ['md', '`QUALIFY` filters on a window function, like HAVING does for aggregates. Best-selling product per region:'],
      ['sql', `SELECT region, product, sum(quantity) AS units
FROM friendly_sales
GROUP BY region, product
QUALIFY row_number() OVER (PARTITION BY region ORDER BY units DESC) = 1
ORDER BY region;`],
      ['md', '`PIVOT` turns values into columns:'],
      ['sql', `PIVOT friendly_sales ON category USING round(sum(quantity * unit_price)) GROUP BY region ORDER BY region;`],
      ['md', 'Trailing commas, `FROM` first, string slicing and lambdas:'],
      ['sql', `FROM friendly_sales SELECT product[1:3] AS short, list_transform([1, 2, 3], x -> x * quantity) AS multiples, LIMIT 3;`],
    ],
  },
  {
    key: 'nested',
    title: 'JSON and nested data',
    subtitle: 'Structs, lists, unnest, JSON functions',
    cells: [
      ['md', '# JSON and nested data\nDuckDB has real **STRUCT**, **LIST** and **MAP** types, and reads JSON into them.'],
      ['sql', `CREATE OR REPLACE TABLE nested_orders AS
SELECT * FROM (VALUES
  (1, {'name': 'Ada', 'city': 'London'}, ['tea', 'mug']),
  (2, {'name': 'Linus', 'city': 'Helsinki'}, ['coffee']),
  (3, {'name': 'Grace', 'city': 'New York'}, ['coffee', 'grinder', 'kettle'])
) t(id, customer, items);
SELECT id, customer.name, len(items) AS n_items, items[1] AS first_item FROM nested_orders;`],
      ['md', '`unnest` turns a list into rows:'],
      ['sql', `SELECT customer.name, unnest(items) AS item FROM nested_orders;`],
      ['md', '## JSON\nWrite a JSON file with `COPY … TO`, then read it back with `read_json_auto`. The file appears in your **Files** tab.'],
      ['sql', `COPY (SELECT * FROM nested_orders) TO 'orders.json' (FORMAT json, ARRAY true);
SELECT * FROM read_json_auto('orders.json');`],
      ['sql', `SELECT '{"device":"iPhone","tags":["a","b"],"battery":{"level":0.82}}'::JSON AS doc,
       doc->>'$.device' AS device,
       (doc->'$.battery.level')::DOUBLE AS level,
       json_array_length(doc, '$.tags') AS n_tags;`],
    ],
  },
  {
    key: 'tpch',
    title: 'TPC-H benchmark',
    subtitle: 'Generate 60,000 orders and run query 1',
    cells: [
      ['md', '# TPC-H on your phone\nThe `tpch` extension generates the classic decision-support benchmark data. Scale factor 0.01 creates about 60,000 line items in a second or two.'],
      ['sql', `CALL dbgen(sf = 0.01);
SELECT table_name, estimated_size FROM duckdb_tables() WHERE table_name IN ('lineitem','orders','customer','part','supplier','nation','region','partsupp');`],
      ['md', 'TPC-H query 1, the pricing summary report:'],
      ['sql', `PRAGMA tpch(1);`],
      ['md', 'Revenue by nation, joining five tables:'],
      ['sql', `SELECT n_name AS nation, round(sum(l_extendedprice * (1 - l_discount))) AS revenue
FROM lineitem
JOIN orders ON l_orderkey = o_orderkey
JOIN customer ON o_custkey = c_custkey
JOIN nation ON c_nationkey = n_nationkey
JOIN region ON n_regionkey = r_regionkey
WHERE r_name = 'EUROPE'
GROUP BY ALL ORDER BY revenue DESC;`],
    ],
  },
  {
    key: 'timeseries',
    title: 'Time series',
    subtitle: 'generate_series, time_bucket, moving averages',
    cells: [
      ['md', '# Time series\nA year of hourly sensor readings, generated in SQL.'],
      ['sql', `CREATE OR REPLACE TABLE ts_readings AS
SELECT ts, 18 + 6 * sin(2 * pi() * hour(ts) / 24) + 4 * sin(2 * pi() * dayofyear(ts) / 365) + random() * 2 AS temp
FROM generate_series(TIMESTAMP '2025-01-01', TIMESTAMP '2025-12-31 23:00', INTERVAL 1 HOUR) t(ts);
SELECT count(*) AS readings, round(avg(temp), 1) AS avg_temp FROM ts_readings;`],
      ['md', 'Weekly buckets with a 4-week moving average:'],
      ['sql', `WITH weekly AS (
  SELECT time_bucket(INTERVAL 1 WEEK, ts) AS week, avg(temp) AS avg_temp FROM ts_readings GROUP BY ALL
)
SELECT week, round(avg_temp, 2) AS avg_temp,
       round(avg(avg_temp) OVER (ORDER BY week ROWS 3 PRECEDING), 2) AS moving_avg
FROM weekly ORDER BY week;`],
      ['md', '`ASOF JOIN` matches each event with the latest reading before it:'],
      ['sql', `WITH events(happened, what) AS (VALUES (TIMESTAMP '2025-03-14 09:41', 'deploy'), (TIMESTAMP '2025-07-01 12:07', 'outage'))
SELECT e.what, e.happened, r.ts AS reading_at, round(r.temp, 1) AS temp
FROM events e ASOF JOIN ts_readings r ON e.happened >= r.ts;`],
    ],
  },
  {
    key: 'search',
    title: 'Full-text search',
    subtitle: 'BM25 ranking with the fts extension',
    cells: [
      ['md', '# Full-text search\nThe `fts` extension builds an inverted index and ranks matches with BM25.'],
      ['sql', `CREATE OR REPLACE TABLE fts_notes AS SELECT * FROM (VALUES
  (1, 'Grinder', 'Burr grinders give a consistent grind for espresso and filter coffee'),
  (2, 'Green tea', 'Brew green tea at 80 degrees for two minutes to avoid bitterness'),
  (3, 'Pour-over', 'A pour-over kit and a gooseneck kettle make clean, bright filter coffee'),
  (4, 'Chai', 'Simmer black tea with cardamom, ginger and milk'),
  (5, 'Espresso', 'Espresso needs fine coffee, high pressure and about 25 seconds')
) t(id, title, body);
SELECT count(*) AS notes FROM fts_notes;`],
      ['md', 'Build the index (it reads the table, so it gets a cell of its own):'],
      ['sql', `PRAGMA create_fts_index('fts_notes', 'id', 'title', 'body', overwrite = 1);`],
      ['sql', `SELECT title, round(fts_main_fts_notes.match_bm25(id, 'filter coffee'), 3) AS score
FROM fts_notes WHERE score IS NOT NULL ORDER BY score DESC;`],
    ],
  },
  {
    key: 'parquet',
    title: 'Parquet files',
    subtitle: 'Convert CSV to Parquet, read metadata',
    pro: true,
    cells: [
      ['md', '# Parquet\nParquet is the column-oriented file format of data engineering. Convert `sales.csv` and compare.'],
      ['sql', `COPY (SELECT * FROM 'sales.csv') TO 'sales.parquet' (FORMAT parquet, COMPRESSION zstd);
SELECT count(*) AS rows FROM 'sales.parquet';`],
      ['md', 'Row groups, column statistics and compression, straight from the file footer:'],
      ['sql', `SELECT path_in_schema AS column_name, type, stats_min, stats_max, compression, total_compressed_size
FROM parquet_metadata('sales.parquet');`],
      ['sql', `SELECT product, sum(quantity) AS units FROM read_parquet('sales.parquet') GROUP BY ALL ORDER BY units DESC LIMIT 5;`],
    ],
  },
  {
    key: 'excel',
    title: 'Excel sheets',
    subtitle: 'Write and read .xlsx files',
    pro: true,
    cells: [
      ['md', '# Excel\nWrite a summary to an `.xlsx` file (find it in the Files tab and share it), then read it back.'],
      ['sql', `COPY (
  SELECT region, category, round(sum(quantity * unit_price), 2) AS revenue
  FROM 'sales.csv' GROUP BY ALL ORDER BY region, category
) TO 'revenue.xlsx' WITH (FORMAT xlsx, HEADER true);
SELECT * FROM read_xlsx('revenue.xlsx');`],
    ],
  },
  {
    key: 'spatial',
    title: 'Spatial SQL',
    subtitle: 'Points, distances and a map',
    pro: true,
    cells: [
      ['md', '# Spatial\nThe `spatial` extension adds a GEOMETRY type and hundreds of ST_ functions. Geometry results open on a **Map**.'],
      ['sql', `CREATE OR REPLACE TABLE geo_cities AS
SELECT city, country, population, ST_Point(lon, lat) AS geom FROM 'cities.csv';
SELECT city, population, geom FROM geo_cities ORDER BY population DESC;`],
      ['md', 'Great-circle distance from Istanbul, in kilometres:'],
      ['sql', `SELECT b.city, round(ST_Distance_Sphere(ST_FlipCoordinates(a.geom), ST_FlipCoordinates(b.geom)) / 1000) AS km
FROM geo_cities a, geo_cities b
WHERE a.city = 'Istanbul' AND b.city <> a.city
ORDER BY km LIMIT 8;`],
      ['md', 'A 10-degree buffer around Europe\'s capitals, and the cities inside the convex hull:'],
      ['sql', `SELECT 'hull' AS name, ST_ConvexHull(ST_Collect(list(geom))) AS geom FROM geo_cities WHERE country IN ('GB','FR','DE','ES','IT','NL','TR')
UNION ALL SELECT city, geom FROM geo_cities WHERE country IN ('GB','FR','DE','ES','IT','NL','TR');`],
    ],
  },
];

export function sampleNotebook(s: Sample, id: string): Notebook {
  return { id, title: s.title, updated: Date.now(), cells: s.cells.map(([type, source], i) => ({ id: `${id}-${i}`, type: type === 'md' ? 'markdown' : 'sql', source })) };
}
