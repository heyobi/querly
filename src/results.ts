// Result rendering: Table, Chart, Map (spatial) and Plot (embedding arrays) views, plus export.
import type { ExecOk, PgError, ResultSet } from './engine';
import { exportQuery, MAX_ROWS } from './engine';
import { h, haptic, icon, sheet, shareFile, toast } from './ui';
import { isPro, requirePro } from './pro';
import { parseHexWkb, type Geom } from './wkb';
import { LAND } from './world';
import { t } from './i18n';

const NUMERIC = new Set(['TINYINT', 'SMALLINT', 'INTEGER', 'BIGINT', 'UTINYINT', 'USMALLINT', 'UINTEGER', 'UBIGINT', 'FLOAT', 'DOUBLE', 'HUGEINT']);
const isNumType = (t: string) => NUMERIC.has(t) || t.startsWith('DECIMAL');
const GEO = new Set(['GEOMETRY']);
const PALETTE = ['#5b8cff', '#f59e0b', '#22c55e', '#ef4444', '#a855f7', '#14b8a6', '#ec4899', '#84cc16'];

export function fmtValue(v: unknown): { text: string; cls?: string } {
  if (v === null || v === undefined) return { text: 'NULL', cls: 'null' };
  if (typeof v === 'boolean') return { text: v ? 'true' : 'false', cls: 'bool' };
  if (typeof v === 'number') return { text: String(v), cls: 'num' };
  if (typeof v === 'object') {
    const o = v as { $bytes?: number[]; length?: number };
    if (o.$bytes) return { text: '\\x' + o.$bytes.map((b) => b.toString(16).padStart(2, '0')).join('') + (o.length! > 64 ? '…' : ''), cls: 'bytes' };
    return { text: JSON.stringify(v), cls: 'json' };
  }
  const s = String(v);
  return { text: s.length > 500 ? s.slice(0, 500) + '…' : s };
}

export function csv(rs: ResultSet): string {
  const esc = (v: unknown) => {
    const t = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [rs.fields.map((f) => esc(f.name)).join(','), ...rs.rows.map((r) => r.map(esc).join(','))].join('\n') + '\n';
}

const isNumCol = (rs: ResultSet, i: number) => isNumType(rs.fields[i].type) || (rs.rows.length > 0 && rs.rows.every((r) => r[i] === null || typeof r[i] === 'number'));
const num = (v: unknown) => (v === null || v === undefined ? NaN : typeof v === 'number' ? v : parseFloat(String(v)));

export function renderResult(out: HTMLElement, r: ExecOk, sql?: string) {
  for (const n of r.notices) out.append(h('div', { class: `notice ${n.severity.toLowerCase()}` }, `${n.severity}: ${n.message}`));
  const sets = r.results.filter((x) => x.fields.length);
  if (!sets.length) {
    const affected = r.results.reduce((a, x) => a + (x.affectedRows || 0), 0);
    out.append(h('div', { class: 'ok' }, affected ? `✓ ${affected} ${t(affected === 1 ? 'row' : 'rows')} ${t('affected')}` : `✓ ${r.results.length} ${t(r.results.length === 1 ? 'statement' : 'statements')} ${t('executed')}`));
    return;
  }
  for (const rs of sets.slice(-3)) out.append(resultBlock(rs, sql));
  if (r.written?.length) out.append(h('div', { class: 'ok' }, `✓ ${t('Saved to Files')}: ${r.written.join(', ')}`));
}

function resultBlock(rs: ResultSet, sql?: string): HTMLElement {
  const geoCols = rs.fields.map((f, i) => (GEO.has(f.type) || (typeof rs.rows[0]?.[i] === 'string' && /^0[01]0[0-9a-f]{7}/i.test(String(rs.rows[0][i])) && !!parseHexWkb(String(rs.rows[0][i])))) ? i : -1).filter((i) => i >= 0);
  const vecCols = rs.fields.map((f, i) => (/^(FLOAT|DOUBLE)\[\]$/.test(f.type) && Array.isArray(rs.rows[0]?.[i]) && (rs.rows[0][i] as unknown[]).length > 2 ? i : -1)).filter((i) => i >= 0);
  const numCols = rs.fields.map((_, i) => i).filter((i) => isNumCol(rs, i) && !geoCols.includes(i));
  const views: [string, () => HTMLElement][] = [['Table', () => table(rs)]];
  if (rs.rows.length > 1 && numCols.length) views.push(['Chart', () => (isPro() ? chart(rs, numCols) : lockedChart())]);
  if (geoCols.length) views.push(['Map', () => map(rs, geoCols)]);
  if (vecCols.length && rs.rows.length > 1) views.push(['Plot', () => vectorPlot(rs, vecCols[0])]);

  const body = h('div', { class: 'view-body' });
  const tabs = h('div', { class: 'seg' });
  const show = (i: number) => {
    [...tabs.children].forEach((c, j) => c.classList.toggle('on', i === j));
    body.replaceChildren(views[i][1]());
  };
  views.forEach(([name], i) => tabs.append(h('button', { onclick: () => show(i) }, t(name))));
  // Open on the most useful view: map for geometry results, a chart for "label, number" totals, table otherwise.
  const totals = isPro() && rs.rows.length > 1 && rs.fields.length === 2
    && ((numCols.length === 1 && numCols[0] === 1 && rs.rows.length <= 60) || numCols.length === 2);
  show(geoCols.length ? views.findIndex((v) => v[0] === 'Map') : totals ? views.findIndex((v) => v[0] === 'Chart') : 0);

  return h('div', { class: 'result' },
    views.length > 1 && tabs,
    body,
    h('div', { class: 'result-foot' },
      h('span', {}, rs.truncated ? `${t('first')} ${MAX_ROWS.toLocaleString()} ${t('rows')}` : `${rs.rowCount.toLocaleString()} ${t(rs.rowCount === 1 ? 'row' : 'rows')}`),
      h('button', { class: 'link', onclick: () => exportMenu(rs, sql) }, t('Export'))));
}

function lockedChart(): HTMLElement {
  return h('div', { class: 'locked pad' },
    h('b', {}, t('Charts are part of Pro')),
    h('div', { class: 'muted small' }, t('Bar, line and scatter charts for any result with numbers.')),
    h('button', { class: 'btn primary', onclick: () => void requirePro(t('Charts are part of Pro')) }, t('Unlock Pro')));
}

/** Export the whole result (re-running the query) as CSV, or with Pro as Parquet, Excel or JSON. */
function exportMenu(rs: ResultSet, sql?: string) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const run = async (fmt: 'csv' | 'parquet' | 'xlsx' | 'json') => {
    if (fmt !== 'csv' && !(await requirePro(t('Parquet, Excel and JSON export are part of Pro')))) return;
    if (!sql) { await shareFile(`result-${stamp}.csv`, csv(rs), 'text/csv'); return; }
    try {
      toast(t('Exporting…'));
      const blob = await exportQuery(sql, fmt);
      await shareFile(`result-${stamp}.${fmt}`, blob, blob.type);
    } catch (e) {
      // Statements that are not a single query (several statements, DDL) export what is on screen.
      if (fmt === 'csv') await shareFile(`result-${stamp}.csv`, csv(rs), 'text/csv');
      else toast((e as PgError).message, 'err');
    }
  };
  const lock = isPro() ? '' : ' · Pro';
  sheet(t('Export result'), [
    { label: 'CSV', run: () => void run('csv') },
    { label: `Parquet${lock}`, run: () => void run('parquet') },
    { label: `Excel (.xlsx)${lock}`, run: () => void run('xlsx') },
    { label: `JSON${lock}`, run: () => void run('json') },
  ]);
}

function table(rs: ResultSet): HTMLElement {
  const MAX = 300;
  return h('div', { class: 'table-wrap' },
    h('table', {},
      h('thead', {}, h('tr', {}, h('th', { class: 'rn' }, ''), rs.fields.map((f) => h('th', {}, h('div', {}, f.name), f.type && h('small', {}, f.type))))),
      h('tbody', {}, rs.rows.slice(0, MAX).map((row, ri) => h('tr', {},
        h('td', { class: 'rn' }, String(ri + 1)),
        row.map((v, ci) => {
          const f = fmtValue(v);
          const isGeo = GEO.has(rs.fields[ci].type);
          return h('td', { class: (isGeo ? 'geo ' : '') + (f.cls ?? '') }, isGeo && typeof v === 'string' ? geoLabel(v) : f.text);
        }))))),
    rs.rows.length > MAX && h('div', { class: 'more-rows' }, `+ ${rs.rows.length - MAX} ${t('more rows — use Export CSV')}`));
}

function geoLabel(hex: string) {
  const p = parseHexWkb(hex);
  if (!p) return hex.slice(0, 24) + '…';
  const g = p.geom;
  if (g.type === 'Point') return `POINT(${g.coordinates.map((c) => +c.toFixed(5)).join(' ')})`;
  return `${g.type.toUpperCase()}${p.srid ? ` · SRID ${p.srid}` : ''}`;
}

// ---------------- chart ----------------
function chart(rs: ResultSet, numCols: number[]): HTMLElement {
  const labelCol = rs.fields.findIndex((_, i) => !numCols.includes(i));
  const kinds = ['Bar', 'Line', ...(numCols.length >= 2 ? ['Scatter'] : [])];
  // Over time (a date or timestamp label) reads best as a line.
  const overTime = labelCol >= 0 && /^(DATE|TIMESTAMP)/.test(rs.fields[labelCol].type);
  let kind = numCols.length >= 2 && labelCol < 0 ? 'Scatter' : rs.rows.length > 40 || overTime ? 'Line' : 'Bar';
  const wrap = h('div', { class: 'chart' });
  const bar = h('div', { class: 'chips' });
  // "Total quantity — Region": what the chart shows, in words.
  const pretty = (s: string) => { const w = s.replace(/[_-]+/g, ' ').trim(); return w.charAt(0).toUpperCase() + w.slice(1); };
  const title = kind === 'Scatter' || numCols.length > 1
    ? numCols.slice(0, 3).map((c) => pretty(rs.fields[c].name)).join(', ')
    : `${pretty(rs.fields[numCols[0]].name)}${labelCol >= 0 ? ` — ${pretty(rs.fields[labelCol].name)}` : ''}`;
  const share = h('button', { class: 'chart-share', 'aria-label': t('Share chart'), onclick: () => void shareChart(wrap, title) }, icon('share'));
  wrap.append(h('div', { class: 'chart-head' }, h('div', { class: 'chart-title' }, title), share));
  const draw = () => {
    [...bar.children].forEach((c, i) => c.classList.toggle('on', kinds[i] === kind));
    wrap.querySelector('svg')?.remove();
    wrap.querySelector('.legend')?.remove();
    wrap.append(kind === 'Scatter' ? scatterSvg(rs, numCols[0], numCols[1], labelCol) : seriesSvg(rs, numCols.slice(0, 6), labelCol, kind));
    if (kind !== 'Scatter' && numCols.length > 1)
      wrap.append(h('div', { class: 'legend' }, numCols.slice(0, 6).map((c, i) => h('span', {}, h('i', { style: { background: PALETTE[i] } }), rs.fields[c].name))));
  };
  kinds.forEach((k) => bar.append(h('button', { onclick: () => { if (kind !== k) haptic.tap(); kind = k; draw(); } }, t(k))));
  wrap.append(bar);
  draw();
  return wrap;
}

const W = 640, H = 300, PAD = { l: 52, r: 12, t: 12, b: 46 };
/** The chart as a PNG (title, axes, colours as on screen) through the share sheet. */
async function shareChart(wrap: HTMLElement, title: string) {
  const svg = wrap.querySelector('svg');
  if (!svg) return;
  try {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    // Inline the computed colours and fonts: the image is drawn outside the page's style sheets.
    const live = svg.querySelectorAll('*'), copy = clone.querySelectorAll('*');
    live.forEach((el, i) => {
      const cs = getComputedStyle(el), c = copy[i] as SVGElement;
      for (const p of ['fill', 'stroke', 'stroke-width', 'opacity', 'font-size', 'font-weight', 'font-family']) c.style.setProperty(p, cs.getPropertyValue(p));
    });
    const scale = 2, top = 56, w = W * scale, hgt = H * scale + top;
    clone.setAttribute('width', String(W * scale)); clone.setAttribute('height', String(H * scale));
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
    const img = new Image();
    await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = hgt;
    const g = canvas.getContext('2d')!;
    const css = getComputedStyle(wrap);
    g.fillStyle = getComputedStyle(document.body).getPropertyValue('--surface').trim() || '#111';
    g.fillRect(0, 0, w, hgt);
    g.fillStyle = css.color || '#fff';
    g.font = `600 ${28}px -apple-system, system-ui, sans-serif`;
    g.fillText(title, 24, 40);
    g.drawImage(img, 0, top);
    g.globalAlpha = 0.5; g.font = `22px -apple-system, system-ui, sans-serif`; g.textAlign = 'right';
    g.fillText('Querly', w - 20, 40);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (blob) await shareFile(`${title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'chart'}.png`, blob, 'image/png');
  } catch (e) {
    toast((e as Error).message || t('Could not make the image'), 'err');
  }
}

function niceTicks(min: number, max: number, n = 5) {
  if (min === max) { min -= 1; max += 1; }
  const step = Math.pow(10, Math.floor(Math.log10((max - min) / n)));
  const err = (n * step) / (max - min);
  const s = step * (err <= 0.15 ? 10 : err <= 0.35 ? 5 : err <= 0.75 ? 2 : 1);
  const lo = Math.floor(min / s) * s, hi = Math.ceil(max / s) * s;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + s / 2; v += s) ticks.push(+v.toPrecision(12));
  return { lo, hi, ticks };
}
const fmtTick = (v: number) => (Math.abs(v) >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${+(v / 1e3).toFixed(1)}k` : String(+v.toFixed(2)));
const svgEl = (tag: string, attrs: Record<string, string | number>, text?: string) => {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
};

function axes(svg: SVGSVGElement, ticks: number[], y: (v: number) => number) {
  for (const t of ticks) {
    svg.append(svgEl('line', { x1: PAD.l, x2: W - PAD.r, y1: y(t), y2: y(t), class: 'grid' }));
    svg.append(svgEl('text', { x: PAD.l - 6, y: y(t) + 4, 'text-anchor': 'end', class: 'tick' }, fmtTick(t)));
  }
}

function seriesSvg(rs: ResultSet, cols: number[], labelCol: number, kind: string): SVGSVGElement {
  const rows = rs.rows.slice(0, 500);
  const vals = cols.flatMap((c) => rows.map((r) => num(r[c]))).filter(isFinite);
  const { lo, hi, ticks } = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals));
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'svg' }) as SVGSVGElement;
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const y = (v: number) => PAD.t + ih - ((v - lo) / (hi - lo)) * ih;
  axes(svg, ticks, y);
  const n = rows.length, band = iw / n;
  // Dates as "Jan 25" instead of a cut-off ISO string.
  const isDate = labelCol >= 0 && /^(DATE|TIMESTAMP)/.test(rs.fields[labelCol].type);
  const dateLabel = (v: unknown) => { const d = new Date(typeof v === 'number' ? v : String(v)); return isNaN(+d) ? fmtValue(v).text : d.toLocaleDateString([], { month: 'short', year: '2-digit' }); };
  const label = (i: number) => (labelCol >= 0 ? (isDate ? dateLabel(rows[i][labelCol]) : fmtValue(rows[i][labelCol]).text) : String(i + 1));
  const every = Math.ceil(n / 8);
  rows.forEach((_, i) => {
    if (i % every) return;
    const t = label(i);
    svg.append(svgEl('text', { x: PAD.l + band * (i + 0.5), y: H - PAD.b + 16, 'text-anchor': 'middle', class: 'tick' }, t.length > 10 ? t.slice(0, 9) + '…' : t));
  });
  cols.forEach((c, si) => {
    const color = PALETTE[si % PALETTE.length];
    const series = rows.map((r) => num(r[c]));
    const top = series.reduce((b, v, i) => (isFinite(v) && (b < 0 || v > series[b]) ? i : b), -1);
    const single = cols.length === 1;
    if (kind === 'Bar') {
      const bw = Math.max(1, (band * 0.8) / cols.length);
      rows.forEach((_, i) => {
        const v = series[i];
        if (!isFinite(v)) return;
        const x = PAD.l + band * i + band * 0.1 + bw * si;
        const y0 = y(0), y1 = y(v);
        // One series: the biggest bar in full colour, the rest softer, so the answer stands out.
        svg.append(svgEl('rect', { x, y: Math.min(y0, y1), width: bw, height: Math.max(1, Math.abs(y1 - y0)), fill: color, rx: Math.min(4, bw / 3), opacity: single && i !== top ? 0.55 : 1 }));
        if (single && n <= 12) svg.append(svgEl('text', { x: x + bw / 2, y: Math.min(y0, y1) - 5, 'text-anchor': 'middle', class: `vlabel${i === top ? ' top' : ''}` }, fmtTick(v)));
      });
    } else {
      const pts = rows.map((_, i) => [PAD.l + band * (i + 0.5), y(series[i])]);
      const d = pts.filter(([, yy]) => isFinite(yy)).map(([x, yy], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${yy.toFixed(1)}`).join('');
      if (single) svg.append(svgEl('path', { d: `${d}L${pts[pts.length - 1][0].toFixed(1)},${y(Math.max(lo, 0))}L${pts[0][0].toFixed(1)},${y(Math.max(lo, 0))}Z`, fill: color, opacity: 0.12 }));
      svg.append(svgEl('path', { d, fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      if (single && n <= 40) pts.forEach(([x, yy], i) => { if (isFinite(yy)) svg.append(svgEl('circle', { cx: x, cy: yy, r: i === top ? 4.5 : 2.5, fill: color })); });
      if (single && top >= 0) svg.append(svgEl('text', { x: pts[top][0], y: pts[top][1] - 9, 'text-anchor': 'middle', class: 'vlabel top' }, fmtTick(series[top])));
    }
  });
  return svg;
}

function scatterSvg(rs: ResultSet, cx: number, cy: number, labelCol: number): SVGSVGElement {
  const pts = rs.rows.slice(0, 2000).map((r) => [num(r[cx]), num(r[cy]), r] as const).filter(([x, y]) => isFinite(x) && isFinite(y));
  const xs = niceTicks(Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0])));
  const ys = niceTicks(Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1])));
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'svg' }) as SVGSVGElement;
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const X = (v: number) => PAD.l + ((v - xs.lo) / (xs.hi - xs.lo)) * iw;
  const Y = (v: number) => PAD.t + ih - ((v - ys.lo) / (ys.hi - ys.lo)) * ih;
  axes(svg, ys.ticks, Y);
  for (const t of xs.ticks) svg.append(svgEl('text', { x: X(t), y: H - PAD.b + 16, 'text-anchor': 'middle', class: 'tick' }, fmtTick(t)));
  svg.append(svgEl('text', { x: PAD.l + iw / 2, y: H - 6, 'text-anchor': 'middle', class: 'axis' }, rs.fields[cx].name));
  for (const [x, y, r] of pts) {
    svg.append(svgEl('circle', { cx: X(x), cy: Y(y), r: 4.5, fill: PALETTE[0], 'fill-opacity': 0.75 }));
    if (labelCol >= 0 && pts.length <= 40) svg.append(svgEl('text', { x: X(x) + 7, y: Y(y) + 4, class: 'pt-label' }, fmtValue(r[labelCol]).text));
  }
  return svg;
}

// ---------------- vector plot (PCA to 2-D) ----------------
function vectorPlot(rs: ResultSet, col: number): HTMLElement {
  const labelCol = rs.fields.findIndex((f, i) => i !== col && !isNumType(f.type) && !f.type.endsWith('[]'));
  const data = rs.rows.slice(0, 1000).map((r) => {
    const v = typeof r[col] === 'string' ? (r[col] as string).replace(/[[\]]/g, '').split(',').map(Number) : (r[col] as number[]);
    return { v, label: labelCol >= 0 ? fmtValue(r[labelCol]).text : '' };
  }).filter((d) => Array.isArray(d.v) && d.v.every(isFinite));
  if (data.length < 2) return h('div', { class: 'muted pad' }, t('Need at least two vectors.'));
  const dim = data[0].v.length;
  const mean = Array.from({ length: dim }, (_, j) => data.reduce((a, d) => a + d.v[j], 0) / data.length);
  const X = data.map((d) => d.v.map((x, j) => x - mean[j]));
  const pc = (deflate: number[] | null) => {
    let w = Array.from({ length: dim }, (_, j) => Math.sin(j + 1 + (deflate ? 7 : 0)));
    for (let it = 0; it < 60; it++) {
      const s = X.map((x) => x.reduce((a, xi, j) => a + xi * w[j], 0));
      const nw = Array.from({ length: dim }, (_, j) => X.reduce((a, x, i) => a + x[j] * s[i], 0));
      if (deflate) { const p = nw.reduce((a, x, j) => a + x * deflate[j], 0); for (let j = 0; j < dim; j++) nw[j] -= p * deflate[j]; }
      const n = Math.hypot(...nw) || 1;
      w = nw.map((x) => x / n);
    }
    return w;
  };
  const p1 = pc(null), p2 = dim > 1 ? pc(p1) : p1.map(() => 0);
  const pts = X.map((x, i) => ({ x: x.reduce((a, xi, j) => a + xi * p1[j], 0), y: x.reduce((a, xi, j) => a + xi * p2[j], 0), label: data[i].label }));
  const rsLike: ResultSet = { fields: [{ name: 'PC1', dataTypeID: 0, type: 'DOUBLE' }, { name: 'PC2', dataTypeID: 0, type: 'DOUBLE' }, { name: 'label', dataTypeID: 0, type: 'VARCHAR' }], rows: pts.map((p) => [p.x, p.y, p.label]), rowCount: pts.length, affectedRows: 0 };
  return h('div', { class: 'chart' },
    scatterSvg(rsLike, 0, 1, labelCol >= 0 ? 2 : -1),
    h('div', { class: 'muted small pad' }, `${dim}-dimensional vectors projected to 2-D (PCA). Nearby points are similar.`));
}

// ---------------- map ----------------
function map(rs: ResultSet, geoCols: number[]): HTMLElement {
  const labelCol = rs.fields.findIndex((f, i) => !geoCols.includes(i) && !isNumType(f.type));
  const feats: { g: Geom; label: string; color: string }[] = [];
  let srid: number | null = null;
  rs.rows.slice(0, 5000).forEach((r, i) => {
    for (const c of geoCols) {
      const p = typeof r[c] === 'string' ? parseHexWkb(r[c] as string) : null;
      if (!p) continue;
      srid ??= p.srid;
      feats.push({ g: p.geom, label: labelCol >= 0 ? fmtValue(r[labelCol]).text : '', color: PALETTE[(geoCols.length > 1 ? geoCols.indexOf(c) : i) % PALETTE.length] });
    }
  });
  const geographic = srid === 4326 || srid === 4269 || srid === null || srid === 0;
  const canvas = h('canvas', { class: 'map-canvas' }) as HTMLCanvasElement;
  const wrap = h('div', { class: 'map' }, canvas);
  if (!feats.length) return h('div', { class: 'muted pad' }, t('No geometries to show.'));

  // Projection: Web Mercator for lon/lat data, identity otherwise.
  const merc = ([x, y]: number[]) => geographic ? [x, (Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, y)) * Math.PI) / 360)) * 180) / Math.PI] : [x, y];
  const each = (g: Geom, fn: (p: number[]) => void) => {
    const walk = (c: unknown): void => { if (typeof (c as number[])[0] === 'number') fn(c as number[]); else (c as unknown[]).forEach(walk); };
    if (g.type === 'GeometryCollection') g.geometries.forEach((x) => each(x, fn)); else walk(g.coordinates);
  };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of feats) each(f.g, (p) => { const [x, y] = merc(p); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); });
  const spanMin = geographic ? 2 : 1e-6;
  if (maxX - minX < spanMin) { const c = (minX + maxX) / 2; minX = c - spanMin; maxX = c + spanMin; }
  if (maxY - minY < spanMin) { const c = (minY + maxY) / 2; minY = c - spanMin; maxY = c + spanMin; }
  const pad = 0.12;
  const view = { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, span: Math.max(maxX - minX, maxY - minY) * (1 + pad * 2) };
  const home = { ...view };

  const css = getComputedStyle(document.documentElement);
  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth || 600, hgt = Math.min(420, Math.max(240, w * 0.62));
    canvas.width = w * dpr; canvas.height = hgt * dpr; canvas.style.height = `${hgt}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const scale = Math.min(w, hgt) / view.span;
    const P = (p: number[]) => { const [x, y] = merc(p); return [w / 2 + (x - view.cx) * scale, hgt / 2 - (y - view.cy) * scale]; };
    ctx.fillStyle = css.getPropertyValue('--map-sea').trim() || '#0e1a2b';
    ctx.fillRect(0, 0, w, hgt);
    if (geographic) {
      ctx.fillStyle = css.getPropertyValue('--map-land').trim() || '#1d2b3f';
      ctx.strokeStyle = css.getPropertyValue('--map-coast').trim() || '#2f4566';
      ctx.lineWidth = 0.8;
      for (const ring of LAND) {
        ctx.beginPath();
        ring.forEach((p, i) => { const [x, y] = P(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }
    const pointsToLabel: [number, number, string][] = [];
    for (const f of feats) {
      const g = f.g;
      ctx.strokeStyle = f.color; ctx.fillStyle = f.color; ctx.lineWidth = 2;
      const path = (pts: number[][], close: boolean) => { ctx.beginPath(); pts.forEach((p, i) => { const [x, y] = P(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); if (close) ctx.closePath(); };
      const poly = (rings: number[][][]) => { ctx.beginPath(); for (const r of rings) r.forEach((p, i) => { const [x, y] = P(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.globalAlpha = 0.25; ctx.fill('evenodd'); ctx.globalAlpha = 1; ctx.stroke(); };
      const point = (p: number[]) => { const [x, y] = P(p); ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke(); if (f.label) pointsToLabel.push([x, y, f.label]); };
      const drawG = (g: Geom): void => {
        switch (g.type) {
          case 'Point': point(g.coordinates); break;
          case 'MultiPoint': g.coordinates.forEach(point); break;
          case 'LineString': path(g.coordinates, false); ctx.stroke(); break;
          case 'MultiLineString': g.coordinates.forEach((l) => { path(l, false); ctx.stroke(); }); break;
          case 'Polygon': poly(g.coordinates); break;
          case 'MultiPolygon': g.coordinates.forEach(poly); break;
          case 'GeometryCollection': g.geometries.forEach(drawG); break;
        }
      };
      drawG(g);
    }
    ctx.font = '12px -apple-system, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    if (pointsToLabel.length <= 60) for (const [x, y, t] of pointsToLabel) {
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.strokeText(t, x + 8, y);
      ctx.fillStyle = '#fff'; ctx.fillText(t, x + 8, y);
    }
  };

  // Pan / pinch-zoom with pointer events.
  const ptrs = new Map<number, { x: number; y: number }>();
  let last: { x: number; y: number; d: number } | null = null;
  const pos = () => { const a = [...ptrs.values()]; const x = a.reduce((s, p) => s + p.x, 0) / a.length, y = a.reduce((s, p) => s + p.y, 0) / a.length; const d = a.length > 1 ? Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) : 0; return { x, y, d }; };
  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); last = pos(); });
  canvas.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId) || !last) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = pos();
    const scale = Math.min(canvas.clientWidth, canvas.clientHeight) / view.span;
    view.cx -= (p.x - last.x) / scale; view.cy += (p.y - last.y) / scale;
    if (p.d && last.d) view.span *= last.d / p.d;
    last = p;
    requestAnimationFrame(draw);
  });
  const up = (e: PointerEvent) => { ptrs.delete(e.pointerId); last = ptrs.size ? pos() : null; };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); view.span *= Math.exp(e.deltaY * 0.0015); draw(); }, { passive: false });
  canvas.style.touchAction = 'none';

  const zoom = (f: number) => { view.span *= f; draw(); };
  wrap.append(h('div', { class: 'map-ctrl' },
    h('button', { onclick: () => zoom(0.6), 'aria-label': 'Zoom in' }, '+'),
    h('button', { onclick: () => zoom(1.6), 'aria-label': 'Zoom out' }, '−'),
    h('button', { onclick: () => { Object.assign(view, home); draw(); }, 'aria-label': 'Fit' }, '⤢')));
  wrap.append(h('div', { class: 'map-note' }, `${feats.length} geometr${feats.length === 1 ? 'y' : 'ies'}${srid ? ` · SRID ${srid}` : ''}${geographic ? ' · Natural Earth' : ''}`));
  requestAnimationFrame(draw);
  new ResizeObserver(() => draw()).observe(wrap);
  return wrap;
}

export function errorBox(e: PgError, extra?: HTMLElement): HTMLElement {
  return h('div', { class: 'error-box' },
    h('b', {}, e.message ?? String(e)),
    e.detail && h('div', {}, e.detail),
    e.hint && h('div', { class: 'muted' }, `Hint: ${e.hint}`),
    extra);
}
