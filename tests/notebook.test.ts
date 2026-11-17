import { describe, expect, it } from 'vitest';
import { kindOf, proFeature, readerFor, tableNameFor, uniqueName } from '../src/features';

// notebook.ts imports storage (Capacitor); test the pure converters through a dynamic import with a stubbed storage.
import { vi } from 'vitest';
vi.mock('../src/storage', () => ({ list: vi.fn(), readText: vi.fn(), remove: vi.fn(), writeText: vi.fn() }));
const { fromIpynb, fromSql, toIpynb, toSql } = await import('../src/notebook');

describe('notebook conversion', () => {
  const nb = {
    id: 'abc',
    title: 'Demo',
    updated: 1,
    cells: [
      { id: '1', type: 'markdown' as const, source: '# Title\nline two' },
      { id: '2', type: 'sql' as const, source: 'SELECT 1;\nSELECT 2;' },
    ],
  };

  it('round-trips through .ipynb', () => {
    const back = fromIpynb(toIpynb(nb), 'x', 'abc');
    expect(back.title).toBe('Demo');
    expect(back.cells.map((c) => [c.type, c.source])).toEqual(nb.cells.map((c) => [c.type, c.source]));
  });

  it('reads Jupyter %%sql cells', () => {
    const j = JSON.stringify({ cells: [{ cell_type: 'code', source: ['%%sql\n', 'SELECT 1'] }], metadata: {} });
    expect(fromIpynb(j, 'Imported').cells[0]).toMatchObject({ type: 'sql', source: 'SELECT 1' });
  });

  it('converts to and from .sql', () => {
    const sql = toSql(nb);
    expect(sql).toContain('-- # Title');
    const back = fromSql(sql, 'S');
    expect(back.cells.map((c) => c.type)).toEqual(['markdown', 'sql']);
    expect(back.cells[1].source).toBe('SELECT 1;\nSELECT 2;');
  });
});

describe('features', () => {
  it('detects Pro SQL', () => {
    expect(proFeature("select * from 'a.parquet'")).toBe('Parquet');
    expect(proFeature("copy t to 'x.xlsx' (format xlsx)")).toBe('Excel');
    expect(proFeature('select st_point(1, 2)')).toBe('Spatial');
    expect(proFeature("select * from 'sales.csv' -- not parquet")).toBeNull();
    expect(proFeature('select 1')).toBeNull();
  });
  it('names files and tables', () => {
    expect(uniqueName('a.csv', ['a.csv', 'a-2.csv'])).toBe('a-3.csv');
    expect(uniqueName('x/y.csv', [])).toBe('x_y.csv');
    expect(tableNameFor('Sales 2024.csv')).toBe('sales_2024');
    expect(tableNameFor('2024.csv')).toBe('t_2024');
    expect(kindOf('A.PARQUET')).toBe('parquet');
    expect(readerFor("it's.xlsx")).toBe("read_xlsx('it''s.xlsx')");
  });
});
