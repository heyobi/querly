# Writes store/listing.json (App Store text in 5 languages) and checks App Store length limits.
# Usage: python scripts/listing.py
import json, os

NAME = "Querly: SQL for Your Files"

FEATURES = {
    "en-US": {
        "intro": "Open a CSV, Parquet, JSON or Excel file on your iPhone and ask it questions in SQL. Querly runs DuckDB, the fast analytical database, entirely on your phone: no upload, no server, no account.\n\nQuery files directly by name (SELECT * FROM 'sales.csv'), join them, aggregate millions of rows in a moment, and share the result as a new file.",
        "sections": [
            ("YOUR FILES", ["Import from the Files app, iCloud Drive, Mail, AirDrop or any app's share sheet", "CSV, TSV and JSON free; Parquet, Excel (.xlsx), SQLite and GeoJSON with Pro", "Imported files appear in the Files app too"]),
            ("NOTEBOOKS", ["Jupyter-style notebooks with SQL and Markdown cells, saved as .ipynb", "Code editor with autocomplete for tables, columns and functions", "Symbol keys and Run above the keyboard"]),
            ("RESULTS", ["Fast tables for large results", "Bar, line and scatter charts (Pro)", "Map view for spatial results (Pro)", "Export as CSV, or Parquet, Excel and JSON with Pro"]),
            ("MODERN SQL", ["Window functions, PIVOT, QUALIFY, GROUP BY ALL, ASOF joins", "Lists, structs, JSON, regular expressions, time zones", "Full-text search, TPC-H data generator, spatial functions"]),
            ("LEARN", ["10 free lessons from SELECT to window functions and PIVOT", "Example notebooks with sample data"]),
            ("PRIVATE BY DESIGN", ["Everything runs on your device; nothing is uploaded", "No network access, no account, no tracking"]),
        ],
        "outro": "Querly Pro is a one-time purchase: Parquet, Excel, SQLite and spatial files, charts and maps, large files, more databases and backups.\n\nOpen source under the MIT licence: github.com/heyobi/querly\nPowered by DuckDB. Querly is independent and not affiliated with or endorsed by the DuckDB Foundation.",
    },
    "tr": {
        "intro": "iPhone'unuzda bir CSV, Parquet, JSON ya da Excel dosyası açın ve ona SQL ile soru sorun. Querly, hızlı analitik veritabanı DuckDB'yi tamamen telefonunuzda çalıştırır: yükleme yok, sunucu yok, hesap yok.\n\nDosyaları doğrudan adıyla sorgulayın (SELECT * FROM 'satislar.csv'), birleştirin, milyonlarca satırı anında özetleyin ve sonucu yeni bir dosya olarak paylaşın.",
        "sections": [
            ("DOSYALARINIZ", ["Dosyalar uygulaması, iCloud Drive, Mail, AirDrop ya da herhangi bir uygulamanın paylaş menüsünden içe aktarın", "CSV, TSV ve JSON ücretsiz; Parquet, Excel (.xlsx), SQLite ve GeoJSON Pro ile", "İçe aktarılan dosyalar Dosyalar uygulamasında da görünür"]),
            ("NOT DEFTERLERİ", ["SQL ve Markdown hücreli, .ipynb olarak kaydedilen Jupyter tarzı not defterleri", "Tablo, sütun ve fonksiyonlar için otomatik tamamlamalı kod düzenleyici", "Klavyenin üstünde sembol tuşları ve Çalıştır"]),
            ("SONUÇLAR", ["Büyük sonuçlar için hızlı tablolar", "Çubuk, çizgi ve dağılım grafikleri (Pro)", "Coğrafi sonuçlar için harita (Pro)", "CSV olarak, Pro ile Parquet, Excel ve JSON olarak dışa aktarın"]),
            ("MODERN SQL", ["Pencere fonksiyonları, PIVOT, QUALIFY, GROUP BY ALL, ASOF join", "Listeler, struct'lar, JSON, düzenli ifadeler, saat dilimleri", "Tam metin arama, TPC-H veri üreteci, coğrafi fonksiyonlar"]),
            ("ÖĞRENİN", ["SELECT'ten pencere fonksiyonlarına ve PIVOT'a 10 ücretsiz ders", "Örnek verili örnek not defterleri"]),
            ("GİZLİLİK ÖNCELİKLİ", ["Her şey cihazınızda çalışır; hiçbir şey yüklenmez", "İnternet erişimi yok, hesap yok, izleme yok"]),
        ],
        "outro": "Querly Pro tek seferlik bir satın alımdır: Parquet, Excel, SQLite ve coğrafi dosyalar, grafikler ve haritalar, büyük dosyalar, daha fazla veritabanı ve yedekler.\n\nMIT lisansıyla açık kaynak: github.com/heyobi/querly\nDuckDB ile çalışır. Querly bağımsızdır; DuckDB Foundation ile bağlantılı değildir ve onun tarafından onaylanmamıştır.",
    },
    "es-MX": {
        "intro": "Abre un archivo CSV, Parquet, JSON o Excel en tu iPhone y hazle preguntas en SQL. Querly ejecuta DuckDB, la rápida base de datos analítica, completamente en tu teléfono: sin subir nada, sin servidor, sin cuenta.\n\nConsulta archivos directamente por su nombre (SELECT * FROM 'ventas.csv'), únelos, agrega millones de filas en un instante y comparte el resultado como un archivo nuevo.",
        "sections": [
            ("TUS ARCHIVOS", ["Importa desde Archivos, iCloud Drive, Mail, AirDrop o el menú Compartir de cualquier app", "CSV, TSV y JSON gratis; Parquet, Excel (.xlsx), SQLite y GeoJSON con Pro", "Los archivos importados también aparecen en la app Archivos"]),
            ("NOTEBOOKS", ["Notebooks estilo Jupyter con celdas SQL y Markdown, guardados como .ipynb", "Editor con autocompletado de tablas, columnas y funciones", "Teclas de símbolos y Ejecutar sobre el teclado"]),
            ("RESULTADOS", ["Tablas rápidas para resultados grandes", "Gráficas de barras, líneas y dispersión (Pro)", "Mapa para resultados espaciales (Pro)", "Exporta como CSV, o Parquet, Excel y JSON con Pro"]),
            ("SQL MODERNO", ["Funciones de ventana, PIVOT, QUALIFY, GROUP BY ALL, ASOF joins", "Listas, structs, JSON, expresiones regulares, zonas horarias", "Búsqueda de texto completo, generador TPC-H, funciones espaciales"]),
            ("APRENDE", ["10 lecciones gratis de SELECT a funciones de ventana y PIVOT", "Notebooks de ejemplo con datos de muestra"]),
            ("PRIVADO", ["Todo se ejecuta en tu dispositivo; no se sube nada", "Sin acceso a la red, sin cuenta, sin rastreo"]),
        ],
        "outro": "Querly Pro es una compra única: archivos Parquet, Excel, SQLite y espaciales, gráficas y mapas, archivos grandes, más bases de datos y respaldos.\n\nCódigo abierto con licencia MIT: github.com/heyobi/querly\nFunciona con DuckDB. Querly es independiente y no está afiliado ni respaldado por la DuckDB Foundation.",
    },
    "pt-BR": {
        "intro": "Abra um arquivo CSV, Parquet, JSON ou Excel no iPhone e faça perguntas em SQL. O Querly roda o DuckDB, o rápido banco de dados analítico, inteiramente no seu celular: sem upload, sem servidor, sem conta.\n\nConsulte arquivos diretamente pelo nome (SELECT * FROM 'vendas.csv'), junte-os, agregue milhões de linhas num instante e compartilhe o resultado como um novo arquivo.",
        "sections": [
            ("SEUS ARQUIVOS", ["Importe do app Arquivos, iCloud Drive, Mail, AirDrop ou da folha de compartilhamento de qualquer app", "CSV, TSV e JSON grátis; Parquet, Excel (.xlsx), SQLite e GeoJSON com Pro", "Arquivos importados também aparecem no app Arquivos"]),
            ("NOTEBOOKS", ["Notebooks no estilo Jupyter com células SQL e Markdown, salvos como .ipynb", "Editor com preenchimento automático de tabelas, colunas e funções", "Teclas de símbolos e Executar acima do teclado"]),
            ("RESULTADOS", ["Tabelas rápidas para resultados grandes", "Gráficos de barras, linhas e dispersão (Pro)", "Mapa para resultados espaciais (Pro)", "Exporte como CSV, ou Parquet, Excel e JSON com Pro"]),
            ("SQL MODERNO", ["Funções de janela, PIVOT, QUALIFY, GROUP BY ALL, ASOF joins", "Listas, structs, JSON, expressões regulares, fusos horários", "Busca de texto completo, gerador TPC-H, funções espaciais"]),
            ("APRENDA", ["10 lições grátis do SELECT às funções de janela e PIVOT", "Notebooks de exemplo com dados de amostra"]),
            ("PRIVADO", ["Tudo roda no seu aparelho; nada é enviado", "Sem acesso à rede, sem conta, sem rastreamento"]),
        ],
        "outro": "O Querly Pro é uma compra única: arquivos Parquet, Excel, SQLite e espaciais, gráficos e mapas, arquivos grandes, mais bancos de dados e backups.\n\nCódigo aberto sob a licença MIT: github.com/heyobi/querly\nFunciona com DuckDB. O Querly é independente e não é afiliado nem endossado pela DuckDB Foundation.",
    },
    "de-DE": {
        "intro": "Öffne eine CSV-, Parquet-, JSON- oder Excel-Datei auf dem iPhone und stelle ihr Fragen in SQL. Querly führt DuckDB, die schnelle analytische Datenbank, komplett auf deinem Telefon aus: kein Upload, kein Server, kein Konto.\n\nFrage Dateien direkt über ihren Namen ab (SELECT * FROM 'umsatz.csv'), verknüpfe sie, aggregiere Millionen Zeilen im Nu und teile das Ergebnis als neue Datei.",
        "sections": [
            ("DEINE DATEIEN", ["Import aus der Dateien-App, iCloud Drive, Mail, AirDrop oder dem Teilen-Menü jeder App", "CSV, TSV und JSON kostenlos; Parquet, Excel (.xlsx), SQLite und GeoJSON mit Pro", "Importierte Dateien erscheinen auch in der Dateien-App"]),
            ("NOTEBOOKS", ["Notebooks im Jupyter-Stil mit SQL- und Markdown-Zellen, gespeichert als .ipynb", "Editor mit Autovervollständigung für Tabellen, Spalten und Funktionen", "Symboltasten und Ausführen über der Tastatur"]),
            ("ERGEBNISSE", ["Schnelle Tabellen auch für große Ergebnisse", "Balken-, Linien- und Streudiagramme (Pro)", "Kartenansicht für räumliche Ergebnisse (Pro)", "Export als CSV, mit Pro auch als Parquet, Excel und JSON"]),
            ("MODERNES SQL", ["Fensterfunktionen, PIVOT, QUALIFY, GROUP BY ALL, ASOF-Joins", "Listen, Structs, JSON, reguläre Ausdrücke, Zeitzonen", "Volltextsuche, TPC-H-Datengenerator, räumliche Funktionen"]),
            ("LERNEN", ["10 kostenlose Lektionen von SELECT bis Fensterfunktionen und PIVOT", "Beispiel-Notebooks mit Beispieldaten"]),
            ("PRIVAT", ["Alles läuft auf deinem Gerät; nichts wird hochgeladen", "Kein Netzwerkzugriff, kein Konto, kein Tracking"]),
        ],
        "outro": "Querly Pro ist ein einmaliger Kauf: Parquet-, Excel-, SQLite- und Geodateien, Diagramme und Karten, große Dateien, weitere Datenbanken und Backups.\n\nOpen Source unter der MIT-Lizenz: github.com/heyobi/querly\nBasiert auf DuckDB. Querly ist unabhängig und weder mit der DuckDB Foundation verbunden noch von ihr unterstützt.",
    },
}

META = {
    "en-US": ("Powered by DuckDB · CSV, Excel", "csv,parquet,excel,xlsx,json,sql,database,data,analytics,query,notebook,jupyter,spreadsheet,offline",
              "Query CSV, Parquet, JSON and Excel files with SQL right on your iPhone. A real analytical database runs on the device: fast, private, offline."),
    "tr": ("DuckDB ile CSV, Excel analizi", "csv,parquet,excel,xlsx,json,sql,veritabanı,veri,analiz,sorgu,not defteri,jupyter,tablo,offline",
           "CSV, Parquet, JSON ve Excel dosyalarını iPhone'unuzda SQL ile sorgulayın. Gerçek bir analitik veritabanı cihazda çalışır: hızlı, gizli, internetsiz."),
    "es-MX": ("Con DuckDB · CSV, Excel, Parquet", "csv,parquet,excel,xlsx,json,sql,base de datos,datos,análisis,consulta,notebook,jupyter,offline",
              "Consulta archivos CSV, Parquet, JSON y Excel con SQL en tu iPhone. Una base de datos analítica real corre en el dispositivo: rápida, privada, sin conexión."),
    "pt-BR": ("Com DuckDB · CSV, Excel, Parquet", "csv,parquet,excel,xlsx,json,sql,banco de dados,dados,análise,consulta,notebook,jupyter,offline",
              "Consulte arquivos CSV, Parquet, JSON e Excel com SQL no iPhone. Um banco de dados analítico de verdade roda no aparelho: rápido, privado, offline."),
    "de-DE": ("Mit DuckDB · CSV, Excel, Parquet", "csv,parquet,excel,xlsx,json,sql,datenbank,daten,analyse,abfrage,notebook,jupyter,tabelle,offline",
              "Frage CSV-, Parquet-, JSON- und Excel-Dateien mit SQL direkt auf dem iPhone ab. Eine echte analytische Datenbank läuft auf dem Gerät: schnell, privat, offline."),
}

out = {}
for loc, f in FEATURES.items():
    desc = f["intro"] + "\n\n" + "\n\n".join(t + "\n" + "\n".join("• " + x for x in items) for t, items in f["sections"]) + "\n\n" + f["outro"]
    sub, kw, promo = META[loc]
    d = {"name": NAME, "subtitle": sub, "keywords": kw, "promo": promo, "description": desc}
    for k, lim in [("name", 30), ("subtitle", 30), ("keywords", 100), ("promo", 170), ("description", 4000)]:
        assert len(d[k]) <= lim, (loc, k, len(d[k]))
    out[loc] = d
    print(loc, {k: len(v) for k, v in d.items()})
os.makedirs("store", exist_ok=True)
with open("store/listing.json", "w", encoding="utf-8") as fh:
    json.dump(out, fh, ensure_ascii=False, indent=1)
