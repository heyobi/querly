// Minimal (E)WKB parser for PostGIS values (hex strings) → GeoJSON-like geometry. Supports Z/M by skipping them.
export type Geom =
  | { type: 'Point'; coordinates: number[] }
  | { type: 'LineString' | 'MultiPoint'; coordinates: number[][] }
  | { type: 'Polygon' | 'MultiLineString'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] }
  | { type: 'GeometryCollection'; geometries: Geom[] };

export interface Parsed { geom: Geom; srid: number | null }

export function parseHexWkb(hex: string): Parsed | null {
  if (typeof hex !== 'string' || hex.length < 10 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  const dv = new DataView(bytes.buffer);
  let off = 0;
  let srid: number | null = null;

  function geom(): Geom {
    const le = dv.getUint8(off) === 1;
    off += 1;
    let t = dv.getUint32(off, le);
    off += 4;
    let dims = 2;
    if (t & 0x20000000) { srid = dv.getUint32(off, le); off += 4; }
    if (t & 0x80000000) dims++;
    if (t & 0x40000000) dims++;
    t &= 0x0fffffff;
    // ISO WKB: 1000s = Z, 2000s = M, 3000s = ZM
    if (t > 3000) { dims = 4; t -= 3000; } else if (t > 2000) { dims = 3; t -= 2000; } else if (t > 1000) { dims = 3; t -= 1000; }
    const pt = () => { const x = dv.getFloat64(off, le), y = dv.getFloat64(off + 8, le); off += 8 * dims; return [x, y]; };
    const pts = () => { const n = dv.getUint32(off, le); off += 4; const a: number[][] = []; for (let i = 0; i < n; i++) a.push(pt()); return a; };
    const rings = () => { const n = dv.getUint32(off, le); off += 4; const a: number[][][] = []; for (let i = 0; i < n; i++) a.push(pts()); return a; };
    const many = () => { const n = dv.getUint32(off, le); off += 4; const a: Geom[] = []; for (let i = 0; i < n; i++) a.push(geom()); return a; };
    switch (t) {
      case 1: return { type: 'Point', coordinates: pt() };
      case 2: return { type: 'LineString', coordinates: pts() };
      case 3: return { type: 'Polygon', coordinates: rings() };
      case 4: return { type: 'MultiPoint', coordinates: many().map((g) => (g as { coordinates: number[] }).coordinates) };
      case 5: return { type: 'MultiLineString', coordinates: many().map((g) => (g as { coordinates: number[][] }).coordinates) };
      case 6: return { type: 'MultiPolygon', coordinates: many().map((g) => (g as { coordinates: number[][][] }).coordinates) };
      case 7: return { type: 'GeometryCollection', geometries: many() };
      default: throw new Error(`Unsupported WKB type ${t}`);
    }
  }
  try {
    return { geom: geom(), srid };
  } catch {
    return null;
  }
}
