// "Learn SQL": a short course for analysing data with DuckDB. Each lesson is a self-contained notebook: its first SQL
// cell (re)creates what it uses (tables prefixed `l<n>_`), so lessons run in any order and can be re-run any time.
// Exercises keep their solution in a collapsed <details> block.
import type { Sample } from './samples';

export interface Lesson extends Sample { n: number; level: 'Basics' | 'Intermediate' | 'Advanced'; minutes: number }

const sol = (sql: string) => `<details><summary>Show solution</summary>\n\n\`\`\`sql\n${sql}\n\`\`\`\n\n</details>`;

export const LESSONS: Lesson[] = [
  {
    n: 1, key: 'learn-1', level: 'Basics', minutes: 4,
    title: 'Your first queries',
    subtitle: 'SELECT, expressions, types and NULL',
    cells: [
      ['md', `# 1 · Your first queries
Every question you ask a database starts with **SELECT**. You do not even need a table: SELECT can compute values.

Tap ▶ on each grey box to run it. The result appears underneath.`],
      ['sql', `SELECT 1 + 1 AS two, 'Hello' || ' ' || 'DuckDB' AS greeting, current_date AS today;`],
      ['md', `## Types
Every value has a **type**: INTEGER, DOUBLE, VARCHAR, DATE, BOOLEAN… \`::\` converts (casts) a value. \`typeof()\` tells you the type.`],
      ['sql', `SELECT 7 / 2 AS division, 7 // 2 AS integer_division,
       '2026-01-15'::DATE + 30 AS a_month_later,
       '3.14'::DOUBLE * 2 AS cast_text,
       typeof(42) AS t1, typeof(4.2) AS t2;`],
      ['md', `## NULL means "unknown"
NULL is not zero and not an empty string. Anything combined with NULL is NULL, so use \`IS NULL\` and \`coalesce()\`.`],
      ['sql', `SELECT NULL = NULL AS unknown, NULL IS NULL AS is_null, 1 + NULL AS math, coalesce(NULL, 'fallback') AS first_non_null;`],
      ['md', `## Try it
Return your name in upper case and its number of characters. *Hint:* \`upper()\` and \`length()\`.

${sol(`SELECT upper('Ada Lovelace') AS name, length('Ada Lovelace') AS letters;`)}`],
      ['sql', `SELECT upper('your name') AS name, length('your name') AS letters;`],
    ],
  },
  {
    n: 2, key: 'learn-2', level: 'Basics', minutes: 5,
    title: 'Reading files',
    subtitle: 'Query CSV and JSON files directly',
    cells: [
      ['md', `# 2 · Reading files
DuckDB can query a file as if it were a table: put the file name in quotes after FROM. \`sales.csv\` is in your **Files** tab.`],
      ['sql', `SELECT * FROM 'sales.csv' LIMIT 5;`],
      ['md', `DuckDB sniffs the delimiter, header and column types. \`DESCRIBE\` shows what it found:`],
      ['sql', `DESCRIBE SELECT * FROM 'sales.csv';`],
      ['md', `When detection needs help, use \`read_csv\` with options:`],
      ['sql', `SELECT * FROM read_csv('sales.csv', header = true, columns = {
  'order_id': 'INTEGER', 'order_date': 'DATE', 'region': 'VARCHAR', 'customer': 'VARCHAR',
  'product': 'VARCHAR', 'category': 'VARCHAR', 'quantity': 'INTEGER', 'unit_price': 'DECIMAL(8,2)'
}) LIMIT 3;`],
      ['md', `## Your own files
Import CSV or JSON files in the **Files** tab (from the Files app, iCloud Drive, Mail or AirDrop). Then query them by name, like above.

## Try it
How many rows does \`cities.csv\` have? *Hint:* \`count(*)\`.

${sol(`SELECT count(*) FROM 'cities.csv';`)}`],
      ['sql', `SELECT count(*) FROM 'cities.csv';`],
    ],
  },
  {
    n: 3, key: 'learn-3', level: 'Basics', minutes: 5,
    title: 'Filtering and sorting',
    subtitle: 'WHERE, LIKE, IN, BETWEEN, ORDER BY, LIMIT',
    cells: [
      ['md', `# 3 · Filtering and sorting
**WHERE** keeps the rows you want. **ORDER BY** sorts, **LIMIT** keeps the first n.`],
      ['sql', `CREATE OR REPLACE TABLE l3_sales AS SELECT * FROM 'sales.csv';
SELECT order_date, product, quantity FROM l3_sales
WHERE region = 'North' AND quantity >= 4
ORDER BY order_date DESC LIMIT 10;`],
      ['md', `Patterns and lists: \`LIKE\` (case-sensitive), \`ILIKE\` (case-insensitive), \`IN\`, \`BETWEEN\`:`],
      ['sql', `SELECT DISTINCT product FROM l3_sales WHERE product ILIKE '%bean%';
SELECT count(*) AS spring_orders FROM l3_sales WHERE order_date BETWEEN '2025-03-01' AND '2025-05-31' AND category IN ('Tea', 'Gear');`],
      ['md', `## Try it
The 5 most expensive single order lines (quantity × unit_price) in the West region.

${sol(`SELECT order_id, product, quantity * unit_price AS total
FROM l3_sales WHERE region = 'West'
ORDER BY total DESC LIMIT 5;`)}`],
      ['sql', `SELECT order_id, product, quantity * unit_price AS total FROM l3_sales;`],
    ],
  },
  {
    n: 4, key: 'learn-4', level: 'Basics', minutes: 6,
    title: 'Aggregates and GROUP BY',
    subtitle: 'count, sum, avg, GROUP BY ALL, HAVING, FILTER',
    cells: [
      ['md', `# 4 · Aggregates
Aggregates turn many rows into one value: \`count\`, \`sum\`, \`avg\`, \`min\`, \`max\`, \`median\`, \`quantile_cont\`…`],
      ['sql', `CREATE OR REPLACE TABLE l4_sales AS SELECT * FROM 'sales.csv';
SELECT count(*) AS orders, sum(quantity) AS units, round(avg(unit_price), 2) AS avg_price, median(quantity) AS median_qty FROM l4_sales;`],
      ['md', `**GROUP BY** computes the aggregates per group. DuckDB's \`GROUP BY ALL\` groups by every non-aggregate column.`],
      ['sql', `SELECT category, count(*) AS orders, round(sum(quantity * unit_price), 2) AS revenue
FROM l4_sales GROUP BY ALL ORDER BY revenue DESC;`],
      ['md', `**HAVING** filters groups; **FILTER** limits one aggregate to some rows:`],
      ['sql', `SELECT customer, count(*) AS orders, count(*) FILTER (WHERE category = 'Gear') AS gear_orders
FROM l4_sales GROUP BY ALL HAVING count(*) >= 18 ORDER BY orders DESC;`],
      ['md', `## Try it
Average order value per region, highest first.

${sol(`SELECT region, round(avg(quantity * unit_price), 2) AS avg_value
FROM l4_sales GROUP BY ALL ORDER BY avg_value DESC;`)}`],
      ['sql', ``],
    ],
  },
  {
    n: 5, key: 'learn-5', level: 'Intermediate', minutes: 6,
    title: 'Joins',
    subtitle: 'INNER, LEFT, ANTI and ASOF joins',
    cells: [
      ['md', `# 5 · Joins
A **join** combines rows from two tables that match on a condition.`],
      ['sql', `CREATE OR REPLACE TABLE l5_products AS SELECT * FROM (VALUES
  ('Espresso beans', 'Brazil'), ('Filter beans', 'Ethiopia'), ('Green tea', 'Japan'), ('Kettle', 'Germany'), ('Teapot', 'China')
) t(product, origin);
CREATE OR REPLACE TABLE l5_sales AS SELECT * FROM 'sales.csv';
SELECT p.origin, sum(s.quantity) AS units
FROM l5_sales s JOIN l5_products p ON p.product = s.product
GROUP BY ALL ORDER BY units DESC;`],
      ['md', `**LEFT JOIN** keeps every row on the left, with NULLs when nothing matches. **ANTI JOIN** keeps rows that have no match:`],
      ['sql', `SELECT p.product, count(s.order_id) AS orders FROM l5_products p LEFT JOIN l5_sales s USING (product) GROUP BY ALL ORDER BY orders;
SELECT * FROM l5_products ANTI JOIN l5_sales USING (product);`],
      ['md', `## Try it
Which products in \`l5_sales\` have no origin in \`l5_products\`? *Hint:* ANTI JOIN the other way round, with DISTINCT.

${sol(`SELECT DISTINCT product FROM l5_sales ANTI JOIN l5_products USING (product);`)}`],
      ['sql', ``],
    ],
  },
  {
    n: 6, key: 'learn-6', level: 'Intermediate', minutes: 6,
    title: 'CTEs and subqueries',
    subtitle: 'WITH, scalar subqueries, IN, EXISTS',
    cells: [
      ['md', `# 6 · CTEs and subqueries
**WITH** names an intermediate result, so long queries read top to bottom.`],
      ['sql', `CREATE OR REPLACE TABLE l6_sales AS SELECT * FROM 'sales.csv';
WITH per_customer AS (
  SELECT customer, sum(quantity * unit_price) AS spent FROM l6_sales GROUP BY ALL
)
SELECT customer, round(spent, 2) AS spent FROM per_customer
WHERE spent > (SELECT avg(spent) * 1.5 FROM per_customer)
ORDER BY spent DESC;`],
      ['md', `**EXISTS** asks whether a matching row exists:`],
      ['sql', `SELECT DISTINCT customer FROM l6_sales s
WHERE EXISTS (SELECT 1 FROM l6_sales g WHERE g.customer = s.customer AND g.product = 'Grinder')
ORDER BY customer;`],
      ['md', `## Try it
Customers who bought tea but never coffee.

${sol(`SELECT DISTINCT customer FROM l6_sales WHERE category = 'Tea'
EXCEPT
SELECT customer FROM l6_sales WHERE category = 'Coffee';`)}`],
      ['sql', ``],
    ],
  },
  {
    n: 7, key: 'learn-7', level: 'Intermediate', minutes: 7,
    title: 'Window functions',
    subtitle: 'row_number, rank, running totals, lag, QUALIFY',
    cells: [
      ['md', `# 7 · Window functions
A window function computes over related rows **without** collapsing them into one.`],
      ['sql', `CREATE OR REPLACE TABLE l7_daily AS
SELECT order_date AS day, round(sum(quantity * unit_price), 2) AS revenue FROM 'sales.csv' GROUP BY ALL;
SELECT day, revenue,
       sum(revenue) OVER (ORDER BY day) AS running_total,
       revenue - lag(revenue) OVER (ORDER BY day) AS change,
       round(avg(revenue) OVER (ORDER BY day ROWS 6 PRECEDING), 2) AS avg_7d
FROM l7_daily ORDER BY day LIMIT 20;`],
      ['md', `Ranking inside groups, and \`QUALIFY\` to keep only the top rows:`],
      ['sql', `SELECT region, customer, sum(quantity * unit_price) AS spent,
       rank() OVER (PARTITION BY region ORDER BY spent DESC) AS rnk
FROM 'sales.csv' GROUP BY region, customer
QUALIFY rnk <= 3 ORDER BY region, rnk;`],
      ['md', `## Try it
The best revenue day of each month. *Hint:* \`date_trunc('month', day)\` in PARTITION BY.

${sol(`SELECT day, revenue FROM l7_daily
QUALIFY row_number() OVER (PARTITION BY date_trunc('month', day) ORDER BY revenue DESC) = 1
ORDER BY day;`)}`],
      ['sql', ``],
    ],
  },
  {
    n: 8, key: 'learn-8', level: 'Intermediate', minutes: 6,
    title: 'Dates and strings',
    subtitle: 'date_trunc, strftime, regexp, string_split',
    cells: [
      ['md', `# 8 · Dates and strings`],
      ['sql', `SELECT DATE '2026-02-14' AS d,
       dayname(d) AS weekday, d + INTERVAL 3 MONTH AS later,
       date_diff('day', d, DATE '2026-12-31') AS days_left,
       strftime(d, '%d %B %Y') AS formatted,
       date_trunc('quarter', d) AS quarter_start;`],
      ['md', `Strings: slicing, splitting, regular expressions:`],
      ['sql', `SELECT s, s[1:5] AS first5, string_split(s, ' ') AS words,
       regexp_extract(s, '(\\d+)') AS first_number, regexp_replace(s, '\\s+', '_', 'g') AS snake
FROM (VALUES ('Order 1042 shipped to Izmir')) t(s);`],
      ['md', `## Try it
Orders per weekday in \`sales.csv\`, Monday first. *Hint:* \`isodow(order_date)\`, \`dayname(order_date)\`.

${sol(`SELECT isodow(order_date) AS n, dayname(order_date) AS day, count(*) AS orders
FROM 'sales.csv' GROUP BY ALL ORDER BY n;`)}`],
      ['sql', ``],
    ],
  },
  {
    n: 9, key: 'learn-9', level: 'Advanced', minutes: 6,
    title: 'Reshaping data',
    subtitle: 'PIVOT, UNPIVOT, lists and unnest',
    cells: [
      ['md', `# 9 · Reshaping data
**PIVOT** turns row values into columns; **UNPIVOT** does the opposite.`],
      ['sql', `CREATE OR REPLACE TABLE l9_wide AS
PIVOT (SELECT region, category, quantity * unit_price AS revenue FROM 'sales.csv')
ON category USING round(sum(revenue)) GROUP BY region;
FROM l9_wide ORDER BY region;`],
      ['sql', `UNPIVOT l9_wide ON COLUMNS(* EXCLUDE region) INTO NAME category VALUE revenue ORDER BY region, category;`],
      ['md', `Lists collect values per group; \`unnest\` expands them again:`],
      ['sql', `SELECT customer, list(DISTINCT product ORDER BY product) AS products
FROM 'sales.csv' GROUP BY ALL ORDER BY len(products) DESC LIMIT 5;`],
      ['md', `## Try it
For each category, the list of regions sorted by revenue.

${sol(`SELECT category, list(region ORDER BY revenue DESC) AS regions
FROM (SELECT category, region, sum(quantity * unit_price) AS revenue FROM 'sales.csv' GROUP BY ALL)
GROUP BY ALL;`)}`],
      ['sql', ``],
    ],
  },
  {
    n: 10, key: 'learn-10', level: 'Advanced', minutes: 5,
    title: 'Writing results',
    subtitle: 'CREATE TABLE AS, views, COPY TO files',
    cells: [
      ['md', `# 10 · Writing results
Keep a result as a **table** (stored in your database), a **view** (a saved query) or a **file**.`],
      ['sql', `CREATE OR REPLACE TABLE l10_monthly AS
SELECT date_trunc('month', order_date) AS month, round(sum(quantity * unit_price), 2) AS revenue
FROM 'sales.csv' GROUP BY ALL ORDER BY month;
CREATE OR REPLACE VIEW l10_best_month AS SELECT * FROM l10_monthly ORDER BY revenue DESC LIMIT 1;
FROM l10_best_month;`],
      ['md', `\`COPY … TO 'name.csv'\` writes a file into your **Files** tab, ready to share. (Parquet and Excel output need Pro.)`],
      ['sql', `COPY l10_monthly TO 'monthly_revenue.csv' (HEADER);
SELECT * FROM 'monthly_revenue.csv';`],
      ['md', `You can also export any result with **Export** under the table.

That is the course: you can now load files, filter, aggregate, join, window, reshape and write data. Happy querying!`],
    ],
  },
];
