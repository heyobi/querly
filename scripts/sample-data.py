# Writes public/samples/*.csv: small, deterministic demo data copied into the Data folder on first launch.
# Usage: python scripts/sample-data.py
import csv, random, datetime, os
random.seed(7)
os.makedirs('public/samples', exist_ok=True)
products = [('Espresso beans', 'Coffee', 14.5), ('Filter beans', 'Coffee', 11.0), ('Decaf beans', 'Coffee', 12.5),
            ('Green tea', 'Tea', 7.5), ('Earl Grey', 'Tea', 6.9), ('Chai', 'Tea', 8.2),
            ('Ceramic mug', 'Gear', 12.0), ('Pour-over kit', 'Gear', 34.0), ('Grinder', 'Gear', 89.0), ('Kettle', 'Gear', 59.0)]
regions = ['North', 'South', 'East', 'West']
customers = [f'C{n:03d}' for n in range(1, 121)]
start = datetime.date(2025, 1, 1)
with open('public/samples/sales.csv', 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f)
    w.writerow(['order_id', 'order_date', 'region', 'customer', 'product', 'category', 'quantity', 'unit_price'])
    for i in range(1, 1501):
        d = start + datetime.timedelta(days=int(random.random() ** 0.8 * 364))
        p = random.choices(products, weights=[9, 7, 3, 5, 5, 4, 4, 2, 1, 1])[0]
        q = random.choice([1, 1, 1, 2, 2, 3, 4, 6])
        price = round(p[2] * (1 + (d.month - 1) * 0.004), 2)
        w.writerow([i, d.isoformat(), random.choice(regions), random.choice(customers), p[0], p[1], q, price])
cities = [('Istanbul', 'TR', 41.01, 28.98, 15655924), ('Ankara', 'TR', 39.93, 32.86, 5803482), ('Izmir', 'TR', 38.42, 27.14, 4479525),
          ('London', 'GB', 51.51, -0.13, 8982000), ('Paris', 'FR', 48.86, 2.35, 2102650), ('Berlin', 'DE', 52.52, 13.40, 3755251),
          ('Madrid', 'ES', 40.42, -3.70, 3332035), ('Rome', 'IT', 41.90, 12.50, 2746984), ('Amsterdam', 'NL', 52.37, 4.90, 921402),
          ('New York', 'US', 40.71, -74.01, 8258035), ('San Francisco', 'US', 37.77, -122.42, 808988), ('Mexico City', 'MX', 19.43, -99.13, 9209944),
          ('São Paulo', 'BR', -23.55, -46.63, 11451999), ('Tokyo', 'JP', 35.68, 139.69, 14094034), ('Seoul', 'KR', 37.57, 126.98, 9386034),
          ('Sydney', 'AU', -33.87, 151.21, 5450496), ('Cairo', 'EG', 30.04, 31.24, 10230350), ('Lagos', 'NG', 6.52, 3.38, 8048430),
          ('Mumbai', 'IN', 19.08, 72.88, 12478447), ('Singapore', 'SG', 1.35, 103.82, 5917600)]
with open('public/samples/cities.csv', 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f)
    w.writerow(['city', 'country', 'lat', 'lon', 'population'])
    w.writerows(cities)
print('ok')
