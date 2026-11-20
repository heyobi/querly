"""GitHub Pages landing pages (docs/index.html) for Tuple and Querly: SEO meta, Open Graph, JSON-LD, FAQ. Copy an app dict for a new app."""
import html, json

BADGE = 'app-store-badge.svg'

CSS = """
:root{--bg:#fff;--fg:#14141a;--muted:#5b5b6b;--card:#f4f5f8;--line:#e3e5ec;--accent:#4f6bff}
@media (prefers-color-scheme:dark){:root{--bg:#0b0b10;--fg:#f2f2f6;--muted:#a4a4b4;--card:#16161e;--line:#262633;--accent:#7d93ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:1040px;margin:0 auto;padding:40px 16px 64px}
header{text-align:center}header img.icon{width:112px;height:112px;border-radius:24px;box-shadow:0 10px 30px rgba(0,0,0,.18)}
h1{font-size:clamp(30px,5vw,46px);line-height:1.15;margin:18px 0 10px;letter-spacing:-.02em}
.lead{font-size:clamp(17px,2.2vw,20px);color:var(--muted);max-width:720px;margin:0 auto 22px}
.badge img{height:54px}
.shots{display:flex;gap:14px;overflow-x:auto;padding:28px 0 8px;scroll-snap-type:x mandatory}
.shots img{height:min(560px,70vh);border-radius:18px;scroll-snap-align:center;flex:none;box-shadow:0 8px 24px rgba(0,0,0,.15)}
h2{font-size:28px;margin:48px 0 12px;letter-spacing:-.01em}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px}
.card b{display:block;margin-bottom:4px}
details{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 18px;margin:10px 0}
summary{font-weight:600;cursor:pointer}
a{color:var(--accent)}code{font:15px ui-monospace,Menlo,monospace;background:var(--card);padding:1px 6px;border-radius:6px}
.wide img{width:100%;border-radius:18px;box-shadow:0 8px 24px rgba(0,0,0,.15)}
footer{color:var(--muted);font-size:14px;margin-top:56px;text-align:center}
"""


def page(app):
    faq_ld = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in app['faq']]}
    app_ld = {"@context": "https://schema.org", "@type": "SoftwareApplication", "name": app['name'],
              "operatingSystem": "iOS, iPadOS", "applicationCategory": app['category'],
              "description": app['description'], "url": app['store'], "downloadUrl": app['store'],
              "image": app['site'] + 'icon.png', "screenshot": [app['site'] + s for s, _ in app['shots']],
              "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
              "author": {"@type": "Person", "name": "heyobi", "url": "https://github.com/heyobi"}}
    e = html.escape
    shots = '\n'.join(f'    <img src="{s}" alt="{e(alt)}" loading="lazy">' for s, alt in app['shots'])
    feats = '\n'.join(f'    <div class="card"><b>{e(t)}</b>{e(d)}</div>' for t, d in app['features'])
    faq = '\n'.join(f'  <details><summary>{e(q)}</summary><p>{e(a)}</p></details>' for q, a in app['faq'])
    extra = app.get('extra', '')
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(app['title'])}</title>
<meta name="description" content="{e(app['description'])}">
<meta name="keywords" content="{e(app['keywords'])}">
<link rel="canonical" href="{app['site']}">
<link rel="icon" href="icon.png">
<meta name="apple-itunes-app" content="app-id={app['id']}">
<meta property="og:type" content="website">
<meta property="og:title" content="{e(app['title'])}">
<meta property="og:description" content="{e(app['description'])}">
<meta property="og:url" content="{app['site']}">
<meta property="og:image" content="{app['site']}{app['shots'][0][0]}">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">{json.dumps(app_ld, ensure_ascii=False)}</script>
<script type="application/ld+json">{json.dumps(faq_ld, ensure_ascii=False)}</script>
<style>{CSS}</style>
</head>
<body>
<main>
<header>
  <img class="icon" src="icon.png" alt="{e(app['name'])} app icon" width="112" height="112">
  <h1>{e(app['h1'])}</h1>
  <p class="lead">{e(app['lead'])}</p>
  <a class="badge" href="{app['store']}"><img src="{BADGE}" alt="Download {e(app['name'])} on the App Store"></a>
</header>
<div class="shots">
{shots}
</div>
<h2>{e(app['features_title'])}</h2>
<div class="grid">
{feats}
</div>
{extra}
<h2>Questions</h2>
{faq}
<footer>
  <p><a href="{app['store']}">{e(app['name'])} on the App Store</a> · <a href="{app['repo']}">Source code on GitHub</a> · {app['sibling']}</p>
  <p>{e(app['legal'])}</p>
</footer>
</main>
</body>
</html>
"""


tuple_app = dict(
    id='6835658208', name='Tuple', category='DeveloperApplication',
    store='https://apps.apple.com/us/app/tuple-sql-notebook/id6835658208',
    site='https://heyobi.github.io/pgnotebook/', repo='https://github.com/heyobi/pgnotebook',
    title='Tuple: run PostgreSQL on iPhone and iPad, offline | PostGIS, pgvector, psql',
    h1='Run PostgreSQL on your iPhone',
    lead='Tuple is a real PostgreSQL 18 server on your iPhone and iPad: offline, in milliseconds. PostGIS maps, pgvector search, Apache AGE graphs, a psql terminal and SQL notebooks. No server, no network, no account.',
    description='Run a real PostgreSQL 18 database locally on iPhone and iPad, offline. PostGIS, pgvector, Apache AGE, psql terminal, Jupyter-style SQL notebooks and free SQL lessons.',
    keywords='PostgreSQL iPhone, run PostgreSQL locally on iPhone, Postgres iOS app, PostGIS iOS, pgvector iPhone, psql iPhone, offline SQL database iPhone, PGlite, SQL notebook iPad, learn SQL iPhone',
    shots=[('screens/1.jpg', 'PostGIS query with results on an offline world map'),
           ('screens/3.jpg', 'pgvector nearest-neighbour search plotted in 2-D'),
           ('screens/4.jpg', 'psql-style terminal'),
           ('screens/2.jpg', 'Extensions: PostGIS, pgvector, Apache AGE, pgcrypto'),
           ('screens/5.jpg', 'Window functions with a running total'),
           ('screens/6.jpg', 'Free SQL lessons'),
           ('screens/7.jpg', 'Several databases, PostgreSQL 16, 17 or 18')],
    features_title='A database, not a client',
    features=[('PostgreSQL 18 on the device', 'Also 17 and 16, chosen per database, running in WebAssembly (PGlite). Works in flight mode.'),
              ('PostGIS with maps', 'Geometry and geography types and 1000+ spatial functions; results drawn on an offline world map.'),
              ('pgvector', 'Vector similarity search with a 2-D plot of your embeddings.'),
              ('Apache AGE', 'Graph queries in openCypher, inside PostgreSQL.'),
              ('psql terminal', 'Backslash commands like \\d, \\dt, \\dx, \\df, \\l, \\c, \\x and \\timing, with history.'),
              ('Jupyter-style notebooks', 'SQL and Markdown cells saved as .ipynb in the Files app; tables, charts and maps.'),
              ('30+ extensions', 'pgcrypto, pg_trgm, hstore, ltree, citext, uuid-ossp, tablefunc, pgmq, pgTAP and more, all bundled.'),
              ('Learn SQL', 'Free lessons from SELECT to joins, CTEs and window functions.')],
    faq=[('How do I run PostgreSQL on my iPhone?', 'Install Tuple from the App Store and open it. A PostgreSQL 18 server starts on the device in milliseconds; there is nothing to configure and no server to connect to.'),
         ('Is Tuple a client for a remote PostgreSQL server?', 'No. The database runs on your iPhone or iPad itself, compiled to WebAssembly with PGlite, so it works offline.'),
         ('Can I use PostGIS and pgvector on iOS?', 'Yes. PostGIS, pgvector, Apache AGE and 30+ other extensions are bundled in the app and need no download.'),
         ('Which PostgreSQL versions does Tuple support?', 'PostgreSQL 18, 17 and 16. Each database can use its own version and extensions.'),
         ('Does Tuple have a psql terminal?', 'Yes, a psql-style terminal with \\d, \\dt, \\dx, \\df, \\l, \\c, \\x and \\timing.'),
         ('Can I learn SQL on my iPhone with Tuple?', 'Yes. Free lessons cover SELECT, filtering, joins, GROUP BY, CTEs and window functions, each one a notebook you can run.'),
         ('Where is my data stored?', 'Only on your device. Notebooks are .ipynb files in Files › On My iPhone › Tuple, and databases can be backed up and restored as .tar.gz files.')],
    sibling='<a href="https://heyobi.github.io/querly/">Querly: CSV viewer and DuckDB on iPhone</a>',
    legal='PostgreSQL is a trademark of the PostgreSQL Community Association; Tuple is not affiliated with or endorsed by it.',
)

querly_app = dict(
    id='6835789553', name='Querly', category='BusinessApplication',
    store='https://apps.apple.com/app/id6835789553',
    site='https://heyobi.github.io/querly/', repo='https://github.com/heyobi/querly',
    title='Querly: open CSV, Excel and JSON files on iPhone and iPad, with charts and DuckDB',
    h1='Open CSV, Excel and JSON files on iPhone',
    lead='Querly opens CSV, Excel, JSON, SQLite and Parquet files on iPhone and iPad as a fast table, explains every column, and turns your data into charts in one tap. DuckDB runs on the device: no upload, no account. Made for iPhone Duo.',
    description='Open CSV, Excel (.xlsx), JSON, SQLite and Parquet files on iPhone and iPad. Table viewer, CSV editor, column stats, one-tap charts and maps, and DuckDB SQL notebooks, all offline. Made for iPhone Duo.',
    keywords='open CSV on iPhone, CSV viewer iPhone, Excel viewer iPad, JSON viewer iOS, Parquet viewer iPhone, SQLite viewer iPhone, DuckDB iPhone, run DuckDB on iOS, charts from CSV iPhone, iPhone Duo apps',
    shots=[('screens/iphone-1-chart.jpg', 'Bar chart of totals by product, made from a CSV file'),
           ('screens/iphone-2-files.jpg', 'Files screen with CSV, Excel, JSON, Parquet and log files'),
           ('screens/iphone-3-viewer.jpg', 'Table viewer with an overview of the file'),
           ('screens/iphone-4-map.jpg', 'Cities from a CSV file on a map'),
           ('screens/iphone-5-stats.jpg', 'Column statistics with a histogram'),
           ('screens/iphone-6-trend.jpg', 'Monthly trend as a line chart'),
           ('screens/iphone-7-log.jpg', 'Log levels charted from a text file')],
    features_title='Your files, understood',
    features=[('Opens almost anything', 'CSV, TSV, TXT, Excel (.xlsx), JSON, SQLite, Parquet and .csv.gz; logs and Markdown as text; photos and PDFs in Quick Look.'),
              ('From the Files app', 'Touch and hold a file, choose Open With › Querly, or Share › Querly from Mail, Messages and Safari.'),
              ('Table viewer and CSV editor', 'Sort, search and filter; edit cells, rows and columns and save back to Files without changing your file format.'),
              ('Every column explained', 'Rows, columns and empty cells at a glance; tap a column for a histogram or its most common values.'),
              ('Charts in one tap', 'Ready-made questions for each file, answered as bar, line and scatter charts you can share as images.'),
              ('DuckDB SQL notebooks', 'DuckDB 1.5 on the device: query files by name, join them, PIVOT, window functions; parquet, excel, spatial and more bundled.'),
              ('iPad and iPhone Duo', 'SQL beside the result on wide screens; on iPhone Duo the layout splits at the hinge.'),
              ('Private', 'Everything runs on your device. No network access, no account, no tracking.')],
    extra="""<h2>Made for iPad and iPhone Duo</h2>
<div class="wide"><img src="screens/duo-1-chart.jpg" alt="iPhone Duo half open: SQL on one side of the hinge, chart on the other" loading="lazy"></div>
<p>On wide screens (iPad, the open iPhone Duo, an iPhone in landscape) notebooks put the SQL on the left and the result on the right, and files become a grid of cards. On iPhone Duo the split follows the hinge, half open or flat.</p>
<div class="shots">
    <img src="screens/ipad-2-files.jpg" alt="iPad: files as a grid of cards" loading="lazy">
    <img src="screens/ipad-1-chart.jpg" alt="iPad: SQL beside the chart" loading="lazy">
    <img src="screens/ipad-3-viewer.jpg" alt="iPad: table viewer" loading="lazy">
</div>""",
    faq=[('How do I open a CSV file on my iPhone?', 'In the Files app, touch and hold the CSV file and choose Open With › Querly, or use Share › Querly from Mail, Messages or Safari. It opens as a table you can sort, search, filter and edit.'),
         ('Can I open Excel, Parquet and SQLite files on iPhone or iPad?', 'Yes. Querly opens .xlsx, .parquet, .sqlite and .db files for free, as well as JSON, JSON Lines and compressed .csv.gz files.'),
         ('How do I make a chart from a CSV or Excel file on my phone?', 'Open the file in Querly and tap Analyze. Querly writes ready-made questions for the file and shows the answers as bar, line and scatter charts.'),
         ('How do I run DuckDB on my iPhone?', 'Install Querly. It runs DuckDB 1.5 (DuckDB-Wasm) on the device, offline, with SQL notebooks that query your files by name.'),
         ('Which DuckDB extensions work offline in Querly?', 'parquet, json, excel, icu, spatial, sqlite_scanner, fts, inet, vss, tpch, tpcds and autocomplete are bundled in the app.'),
         ('Does Querly work on iPad and iPhone Duo?', 'Yes. Querly is a native iPad app and is made for iPhone Duo, with a side-by-side layout on wide screens that splits at the hinge on iPhone Duo.'),
         ('Are my files uploaded anywhere?', 'No. Everything runs on your device; Querly makes no network requests and needs no account.')],
    sibling='<a href="https://heyobi.github.io/pgnotebook/">Tuple: PostgreSQL on iPhone</a>',
    legal='Powered by DuckDB. Querly is independent and not affiliated with or endorsed by the DuckDB Foundation.',
)

open('C:/tmp/pgnotebook/docs/index.html', 'w', encoding='utf-8').write(page(tuple_app))
open('C:/tmp/querly/docs/index.html', 'w', encoding='utf-8').write(page(querly_app))
print('ok')
