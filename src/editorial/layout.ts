// Herramientas editoriales (funciones puras, sin DOM):
//  - retícula de maquetación de cada mesa: márgenes, columnas, filas y línea base
//  - guías de composición (tercios, proporción áurea, diagonales, espiral, centro)
//  - alinear y distribuir cajas
// La retícula vive en `Artboard.layout` (deshacer, .kova y colaboración); las guías de
// composición son solo de vista. Nada de esto se exporta.

export interface Box { x: number; y: number; w: number; h: number }
export interface Insets { top: number; right: number; bottom: number; left: number }

export interface LayoutGrid {
  margins: Insets;
  /** columnas (0 = sin columnas) y medianil entre ellas, en px de la mesa */
  columns: number;
  gutter: number;
  /** filas (0 = sin filas) y su separación */
  rows: number;
  rowGutter: number;
  /** línea base cada n px (0 = desactivada), desde el margen superior */
  baseline: number;
}

export const emptyLayout = (): LayoutGrid => ({ margins: { top: 0, right: 0, bottom: 0, left: 0 }, columns: 0, gutter: 0, rows: 0, rowGutter: 0, baseline: 0 });

/** Retículas de partida, proporcionales al ancho de la mesa (m = margen relativo, g = medianil). */
export const LAYOUT_PRESETS: { id: string; name: string; columns: number; rows: number; m: number; g: number }[] = [
  { id: 'c12', name: '12 columnas', columns: 12, rows: 0, m: 0.06, g: 0.015 },
  { id: 'c6', name: '6 columnas', columns: 6, rows: 0, m: 0.06, g: 0.02 },
  { id: 'c4', name: '4 columnas', columns: 4, rows: 0, m: 0.07, g: 0.025 },
  { id: 'c3', name: '3 columnas', columns: 3, rows: 0, m: 0.08, g: 0.03 },
  { id: 'c2', name: '2 columnas', columns: 2, rows: 0, m: 0.08, g: 0.04 },
  { id: 'm6', name: 'Modular 6×6', columns: 6, rows: 6, m: 0.06, g: 0.02 },
  { id: 'm1', name: 'Solo márgenes', columns: 0, rows: 0, m: 0.08, g: 0 },
];

export function presetLayout(id: string, w: number, h: number): LayoutGrid {
  const p = LAYOUT_PRESETS.find(x => x.id === id) ?? LAYOUT_PRESETS[0];
  const m = Math.round(Math.min(w, h) * p.m), g = Math.round(w * p.g);
  return { margins: { top: m, right: m, bottom: m, left: m }, columns: p.columns, gutter: g, rows: p.rows, rowGutter: p.rows ? g : 0, baseline: 0 };
}

/** Zona de contenido (dentro de los márgenes), en coordenadas de la mesa. */
export function contentBox(ab: Box, g: LayoutGrid): Box {
  const m = g.margins;
  return { x: ab.x + m.left, y: ab.y + m.top, w: Math.max(0, ab.w - m.left - m.right), h: Math.max(0, ab.h - m.top - m.bottom) };
}

/** Tramos de n bandas iguales en [start, start+len] separadas por gap. */
export function bands(start: number, len: number, n: number, gap: number): { a: number; b: number }[] {
  if (n <= 0) return [];
  const size = (len - gap * (n - 1)) / n;
  if (size <= 0) return [];
  return Array.from({ length: n }, (_, i) => ({ a: start + i * (size + gap), b: start + i * (size + gap) + size }));
}

export function columnBands(ab: Box, g: LayoutGrid) { const c = contentBox(ab, g); return bands(c.x, c.w, g.columns, g.gutter); }
export function rowBands(ab: Box, g: LayoutGrid) { const c = contentBox(ab, g); return bands(c.y, c.h, g.rows, g.rowGutter); }

/** Líneas a las que se ajusta lo que se mueve: márgenes, bordes de columnas y filas, línea base. */
export function layoutSnapLines(ab: Box, g: LayoutGrid): { xs: number[]; ys: number[] } {
  const c = contentBox(ab, g);
  const xs = [c.x, c.x + c.w], ys = [c.y, c.y + c.h];
  for (const b of columnBands(ab, g)) xs.push(b.a, b.b);
  for (const b of rowBands(ab, g)) ys.push(b.a, b.b);
  if (g.baseline > 0) for (let y = c.y; y <= c.y + c.h + 0.01 && ys.length < 2000; y += g.baseline) ys.push(y);
  return { xs, ys };
}

/** ¿Hay algo que dibujar? */
export const hasLayout = (g: LayoutGrid | null | undefined): g is LayoutGrid =>
  !!g && (g.columns > 0 || g.rows > 0 || g.baseline > 0 || g.margins.top > 0 || g.margins.right > 0 || g.margins.bottom > 0 || g.margins.left > 0);

const num = (v: unknown, lo: number, hi: number, def = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def);
export function sanitizeLayout(v: any): LayoutGrid | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const m = v.margins && typeof v.margins === 'object' ? v.margins : {};
  return {
    margins: { top: num(m.top, 0, 1e5), right: num(m.right, 0, 1e5), bottom: num(m.bottom, 0, 1e5), left: num(m.left, 0, 1e5) },
    columns: Math.round(num(v.columns, 0, 48)), gutter: num(v.gutter, 0, 1e4),
    rows: Math.round(num(v.rows, 0, 48)), rowGutter: num(v.rowGutter, 0, 1e4),
    baseline: num(v.baseline, 0, 1e3),
  };
}

// ---------- guías de composición ----------
export type CompositionKind = 'thirds' | 'phi' | 'diagonals' | 'spiral' | 'center';
export const COMPOSITIONS: { id: CompositionKind; name: string }[] = [
  { id: 'thirds', name: 'Regla de los tercios' },
  { id: 'phi', name: 'Proporción áurea (φ)' },
  { id: 'diagonals', name: 'Diagonales' },
  { id: 'spiral', name: 'Espiral áurea' },
  { id: 'center', name: 'Centro y ejes' },
];
export const PHI = (1 + Math.sqrt(5)) / 2;

export type Seg = { x1: number; y1: number; x2: number; y2: number };
/** Segmentos de una guía de composición en la caja r (la espiral, aproximada con segmentos). */
export function compositionGuides(r: Box, kind: CompositionKind, turn = 0): Seg[] {
  const segs: Seg[] = [];
  const V = (x: number) => segs.push({ x1: x, y1: r.y, x2: x, y2: r.y + r.h });
  const H = (y: number) => segs.push({ x1: r.x, y1: y, x2: r.x + r.w, y2: y });
  if (kind === 'thirds') { V(r.x + r.w / 3); V(r.x + (2 * r.w) / 3); H(r.y + r.h / 3); H(r.y + (2 * r.h) / 3); }
  if (kind === 'phi') { const a = 1 / PHI ** 2; V(r.x + r.w * a); V(r.x + r.w * (1 - a)); H(r.y + r.h * a); H(r.y + r.h * (1 - a)); }
  if (kind === 'center') { V(r.x + r.w / 2); H(r.y + r.h / 2); }
  if (kind === 'diagonals') {
    segs.push({ x1: r.x, y1: r.y, x2: r.x + r.w, y2: r.y + r.h }, { x1: r.x + r.w, y1: r.y, x2: r.x, y2: r.y + r.h });
    // perpendiculares desde las otras dos esquinas (método de las diagonales recíprocas)
    const foot = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
      const dx = bx - ax, dy = by - ay, t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
      return { x: ax + t * dx, y: ay + t * dy };
    };
    const f1 = foot(r.x + r.w, r.y, r.x, r.y, r.x + r.w, r.y + r.h), f2 = foot(r.x, r.y + r.h, r.x, r.y, r.x + r.w, r.y + r.h);
    segs.push({ x1: r.x + r.w, y1: r.y, x2: f1.x, y2: f1.y }, { x1: r.x, y1: r.y + r.h, x2: f2.x, y2: f2.y });
    const f3 = foot(r.x, r.y, r.x + r.w, r.y, r.x, r.y + r.h), f4 = foot(r.x + r.w, r.y + r.h, r.x + r.w, r.y, r.x, r.y + r.h);
    segs.push({ x1: r.x, y1: r.y, x2: f3.x, y2: f3.y }, { x1: r.x + r.w, y1: r.y + r.h, x2: f4.x, y2: f4.y });
  }
  if (kind === 'spiral') goldenSpiral(r, turn, segs);
  return segs;
}

/**
 * Espiral áurea dentro de r (se estira a la proporción de la caja): se va cortando un cuadrado
 * por un lado (izquierda, arriba, derecha, abajo, …) y en cada uno se dibuja un cuarto de arco.
 * `turn` (0..3) la refleja en horizontal, vertical o ambos.
 */
function goldenSpiral(r: Box, turn: number, segs: Seg[]) {
  // en coordenadas normalizadas de un rectángulo áureo horizontal (PHI × 1)
  let x = 0, y = 0, w = PHI, h = 1;
  const loc: { cx: number; cy: number; r: number; a0: number }[] = [];
  const cut: Seg[] = [];
  for (let i = 0; i < 10; i++) {
    const side = i % 4;
    if (side === 0) { const s = h; loc.push({ cx: x + s, cy: y + s, r: s, a0: Math.PI }); cut.push({ x1: x + s, y1: y, x2: x + s, y2: y + h }); x += s; w -= s; }
    else if (side === 1) { const s = w; loc.push({ cx: x, cy: y + s, r: s, a0: -Math.PI / 2 }); cut.push({ x1: x, y1: y + s, x2: x + w, y2: y + s }); y += s; h -= s; }
    else if (side === 2) { const s = h; loc.push({ cx: x + w - s, cy: y, r: s, a0: 0 }); cut.push({ x1: x + w - s, y1: y, x2: x + w - s, y2: y + h }); w -= s; }
    else { const s = w; loc.push({ cx: x + s, cy: y + h - s, r: s, a0: Math.PI / 2 }); cut.push({ x1: x, y1: y + h - s, x2: x + w, y2: y + h - s }); h -= s; }
  }
  const t = ((turn % 4) + 4) % 4;
  // giros: 0 normal, 1 espejo horizontal, 2 espejo vertical, 3 ambos
  const fx = t === 1 || t === 3, fy = t === 2 || t === 3;
  const X = (u: number) => r.x + ((fx ? PHI - u : u) / PHI) * r.w;
  const Y = (v: number) => r.y + (fy ? 1 - v : v) * r.h;
  for (const c of cut) segs.push({ x1: X(c.x1), y1: Y(c.y1), x2: X(c.x2), y2: Y(c.y2) });
  // los arcos se aproximan con segmentos para poder estirarlos a la caja
  for (const a of loc) {
    const n = 16;
    for (let k = 0; k < n; k++) {
      const t0 = a.a0 + (k / n) * (Math.PI / 2), t1 = a.a0 + ((k + 1) / n) * (Math.PI / 2);
      segs.push({ x1: X(a.cx + a.r * Math.cos(t0)), y1: Y(a.cy + a.r * Math.sin(t0)), x2: X(a.cx + a.r * Math.cos(t1)), y2: Y(a.cy + a.r * Math.sin(t1)) });
    }
  }
}

// ---------- alinear y distribuir ----------
export type AlignKind = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** Desplazamiento de cada caja para alinearla a `ref`. */
export function alignDeltas(items: Box[], kind: AlignKind, ref: Box): { dx: number; dy: number }[] {
  return items.map(b => {
    let dx = 0, dy = 0;
    if (kind === 'left') dx = ref.x - b.x;
    if (kind === 'hcenter') dx = ref.x + ref.w / 2 - (b.x + b.w / 2);
    if (kind === 'right') dx = ref.x + ref.w - (b.x + b.w);
    if (kind === 'top') dy = ref.y - b.y;
    if (kind === 'vcenter') dy = ref.y + ref.h / 2 - (b.y + b.h / 2);
    if (kind === 'bottom') dy = ref.y + ref.h - (b.y + b.h);
    return { dx, dy };
  });
}

/**
 * Distribución en un eje. 'gap': mismo hueco entre cajas entre la primera y la última (que no se
 * mueven). 'fixed': hueco fijo `gap` a partir de la primera. 'centers': centros equidistantes.
 * Devuelve el desplazamiento de cada caja en el orden de entrada.
 */
export function distributeDeltas(items: Box[], axis: 'h' | 'v', mode: 'gap' | 'fixed' | 'centers', gap = 0): number[] {
  const pos = (b: Box) => (axis === 'h' ? b.x : b.y), size = (b: Box) => (axis === 'h' ? b.w : b.h);
  const order = items.map((b, i) => ({ b, i })).sort((a, c) => pos(a.b) - pos(c.b) || a.i - c.i);
  const out = new Array(items.length).fill(0);
  if (order.length < 2) return out;
  const first = order[0].b, last = order[order.length - 1].b;
  if (mode === 'centers') {
    const c0 = pos(first) + size(first) / 2, c1 = pos(last) + size(last) / 2;
    order.forEach((o, k) => { out[o.i] = c0 + ((c1 - c0) * k) / (order.length - 1) - (pos(o.b) + size(o.b) / 2); });
    return out;
  }
  const total = order.reduce((n, o) => n + size(o.b), 0);
  const g = mode === 'fixed' ? gap : (pos(last) + size(last) - pos(first) - total) / (order.length - 1);
  let cur = pos(first);
  for (const o of order) { out[o.i] = cur - pos(o.b); cur += size(o.b) + g; }
  return out;
}
