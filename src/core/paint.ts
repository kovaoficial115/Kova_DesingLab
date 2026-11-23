// Pintura vectorial editable: degradados (lineal, radial, angular) con varios puntos de color,
// estilos de contorno y geometría de polígonos y estrellas. Funciones puras (sin DOM salvo
// las que reciben un contexto de lienzo).

export type GradientType = 'linear' | 'radial' | 'conic';
export interface GradientStop { pos: number; color: string; opacity: number }
/**
 * Degradado guardado en coordenadas relativas a la caja del objeto (0..1):
 * lineal de (x1,y1) a (x2,y2); radial con centro (x1,y1) y radio hasta (x2,y2);
 * angular con centro (x1,y1) y ángulo inicial hacia (x2,y2).
 */
export interface Gradient { type: GradientType; stops: GradientStop[]; x1: number; y1: number; x2: number; y2: number }

export type DashKind = 'solid' | 'dashed' | 'dotted';
export type StrokeAlign = 'inside' | 'center' | 'outside';
export interface StrokeStyle {
  dash: DashKind;
  cap: CanvasLineCap;
  join: CanvasLineJoin;
  /** dónde queda el contorno respecto al relleno (centrado = como siempre); la caja incluye el contorno */
  align: StrokeAlign;
  opacity: number;
}
export const DEFAULT_STROKE_STYLE: StrokeStyle = { dash: 'solid', cap: 'butt', join: 'miter', align: 'center', opacity: 1 };

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const clamp01 = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Degradado lineal de izquierda a derecha entre dos colores. */
export function defaultGradient(a = '#d21625', b = '#1b1b3a', type: GradientType = 'linear'): Gradient {
  const stops = [{ pos: 0, color: a, opacity: 1 }, { pos: 1, color: b, opacity: 1 }];
  if (type === 'linear') return { type, stops, x1: 0, y1: 0.5, x2: 1, y2: 0.5 };
  return { type, stops, x1: 0.5, y1: 0.5, x2: 1, y2: 0.5 };
}

/** Ángulo (grados, 0 = hacia la derecha, en el sentido de las agujas) del degradado lineal o angular. */
export function gradientAngle(g: Gradient): number {
  return Math.round(((Math.atan2(g.y2 - g.y1, g.x2 - g.x1) * 180) / Math.PI) * 10) / 10;
}
/** Cambia el ángulo conservando el centro y la longitud. */
export function withAngle(g: Gradient, deg: number): Gradient {
  const a = (deg * Math.PI) / 180;
  if (g.type === 'linear') {
    const cx = (g.x1 + g.x2) / 2, cy = (g.y1 + g.y2) / 2, len = Math.hypot(g.x2 - g.x1, g.y2 - g.y1) / 2 || 0.5;
    return { ...g, x1: cx - Math.cos(a) * len, y1: cy - Math.sin(a) * len, x2: cx + Math.cos(a) * len, y2: cy + Math.sin(a) * len };
  }
  const len = Math.hypot(g.x2 - g.x1, g.y2 - g.y1) || 0.5;
  return { ...g, x2: g.x1 + Math.cos(a) * len, y2: g.y1 + Math.sin(a) * len };
}
/** Cambia el tipo manteniendo los colores (lineal ↔ radial/angular recolocan los puntos). */
export function withType(g: Gradient, type: GradientType): Gradient {
  if (type === g.type) return g;
  const base = defaultGradient('#000', '#fff', type);
  return { ...base, stops: g.stops };
}
export const sortedStops = (g: Gradient) => [...g.stops].sort((a, b) => a.pos - b.pos);

function hexRgb(hex: string): [number, number, number] {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (r: number, g: number, b: number) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
export const rgba = (s: GradientStop) => { const [r, g, b] = hexRgb(s.color); return `rgba(${r},${g},${b},${s.opacity})`; };

/** Color y opacidad del degradado en una posición (para añadir un punto sin cambiar el aspecto). */
export function sampleGradient(g: Gradient, pos: number): GradientStop {
  const st = sortedStops(g);
  if (pos <= st[0].pos) return { ...st[0], pos };
  if (pos >= st[st.length - 1].pos) return { ...st[st.length - 1], pos };
  for (let i = 1; i < st.length; i++) {
    const a = st[i - 1], b = st[i];
    if (pos <= b.pos) {
      const t = b.pos === a.pos ? 0 : (pos - a.pos) / (b.pos - a.pos);
      const ca = hexRgb(a.color), cb = hexRgb(b.color);
      return { pos, color: toHex(ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t), opacity: a.opacity + (b.opacity - a.opacity) * t };
    }
  }
  return { ...st[st.length - 1], pos };
}
export function addStop(g: Gradient, pos: number): { g: Gradient; index: number } {
  const s = sampleGradient(g, Math.min(1, Math.max(0, pos)));
  const stops = [...g.stops, s];
  return { g: { ...g, stops }, index: stops.length - 1 };
}
/** Quita un punto (siempre quedan al menos dos). */
export function removeStop(g: Gradient, index: number): Gradient {
  return g.stops.length <= 2 ? g : { ...g, stops: g.stops.filter((_, i) => i !== index) };
}
export const reverseGradient = (g: Gradient): Gradient => ({ ...g, stops: g.stops.map(s => ({ ...s, pos: 1 - s.pos })) });

/** CSS para previsualizar el degradado en una barra (siempre de izquierda a derecha). */
export function gradientCss(g: Gradient, asBar = true): string {
  const stops = sortedStops(g).map(s => `${rgba(s)} ${(s.pos * 100).toFixed(1)}%`).join(', ');
  if (asBar || g.type === 'linear') return `linear-gradient(90deg, ${stops})`;
  if (g.type === 'radial') return `radial-gradient(circle, ${stops})`;
  return `conic-gradient(from ${gradientAngle(g) + 90}deg, ${stops})`;
}

/** Crea el degradado del lienzo para una caja de w×h (px locales del objeto). */
export function canvasGradient(ctx: CanvasRenderingContext2D, g: Gradient, w: number, h: number, ox = 0, oy = 0): CanvasGradient {
  const x1 = ox + g.x1 * w, y1 = oy + g.y1 * h, x2 = ox + g.x2 * w, y2 = oy + g.y2 * h;
  let cg: CanvasGradient;
  if (g.type === 'radial') cg = ctx.createRadialGradient(x1, y1, 0, x1, y1, Math.max(0.5, Math.hypot(x2 - x1, y2 - y1)));
  else if (g.type === 'conic' && typeof (ctx as any).createConicGradient === 'function') cg = (ctx as any).createConicGradient(Math.atan2(y2 - y1, x2 - x1), x1, y1);
  else cg = ctx.createLinearGradient(x1, y1, x2, y2);
  for (const s of sortedStops(g)) cg.addColorStop(Math.min(1, Math.max(0, s.pos)), rgba(s));
  return cg;
}

/** Definición SVG (`<linearGradient>`/`<radialGradient>`) en px locales; null si SVG no la admite (angular). */
export function svgGradientDef(id: string, g: Gradient, w: number, h: number, ox = 0, oy = 0): string | null {
  if (g.type === 'conic') return null;
  const f = (v: number) => +v.toFixed(3);
  const stops = sortedStops(g).map(s => `<stop offset="${f(s.pos)}" stop-color="${s.color}"${s.opacity < 1 ? ` stop-opacity="${f(s.opacity)}"` : ''}/>`).join('');
  const x1 = ox + g.x1 * w, y1 = oy + g.y1 * h, x2 = ox + g.x2 * w, y2 = oy + g.y2 * h;
  if (g.type === 'radial') return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${f(x1)}" cy="${f(y1)}" r="${f(Math.hypot(x2 - x1, y2 - y1))}">${stops}</radialGradient>`;
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}">${stops}</linearGradient>`;
}

/** Patrón de trazo para el lienzo y SVG. */
export function dashArray(kind: DashKind | undefined, width: number): number[] {
  const w = Math.max(1, width);
  if (kind === 'dashed') return [w * 3, w * 2];
  if (kind === 'dotted') return [0.001, w * 2];
  return [];
}

/** Vértices de un polígono regular (o estrella con `inner` < 1) inscrito en la elipse de la caja. */
export function polygonPoints(sides: number, w: number, h: number, inset = 0, inner?: number): { x: number; y: number }[] {
  const n = Math.max(3, Math.min(64, Math.round(sides)));
  const rx = Math.max(0.5, w / 2 - inset), ry = Math.max(0.5, h / 2 - inset);
  const star = typeof inner === 'number' && inner > 0 && inner < 1;
  const count = star ? n * 2 : n;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    const k = star && i % 2 === 1 ? inner! : 1;
    pts.push({ x: w / 2 + Math.cos(a) * rx * k, y: h / 2 + Math.sin(a) * ry * k });
  }
  return pts;
}

// ---------- puntas de línea (flechas) ----------
export type ArrowHead = 'none' | 'arrow' | 'triangle' | 'circle' | 'square' | 'bar';
export const ARROW_HEADS: ArrowHead[] = ['none', 'arrow', 'triangle', 'circle', 'square', 'bar'];
export const ARROW_LABELS: Record<ArrowHead, string> = { none: 'Sin punta', arrow: 'Flecha', triangle: 'Triángulo', circle: 'Círculo', square: 'Cuadrado', bar: 'Barra' };
/** Media altura de una punta para una línea de grosor `t`. */
export const headHalf = (t: number) => Math.max(2 * t, t / 2 + 4);
/** Alto de la caja de una línea: el grosor, o lo que ocupen las puntas. */
export const lineBoxHeight = (t: number, start?: ArrowHead, end?: ArrowHead) =>
  (start && start !== 'none') || (end && end !== 'none') ? Math.ceil(2 * headHalf(t)) : t;
/** Grosor de una línea (sin puntas el alto de la caja es el grosor). */
export const lineThickness = (s: { h: number; lineWeight?: number }) => Math.max(0.5, Math.min(s.h, s.lineWeight ?? s.h));

export type HeadPrim =
  | { kind: 'fill'; pts: { x: number; y: number }[] } // polígono relleno
  | { kind: 'open'; pts: { x: number; y: number }[] } // trazo abierto (grosor de la línea, uniones redondas)
  | { kind: 'circle'; cx: number; cy: number; r: number };

/**
 * Geometría de una línea horizontal en una caja w×h con grosor t y puntas opcionales: el tramo
 * recortado (para que no asome bajo la punta) y las primitivas de cada punta. La usan el lienzo
 * y la exportación SVG para que se vean igual.
 */
export function lineGeometry(w: number, h: number, t: number, start: ArrowHead = 'none', end: ArrowHead = 'none', cap: CanvasLineCap = 'butt') {
  const y = h / 2;
  const hh = Math.max(t / 2, Math.min(headHalf(t), h / 2));
  const heads: HeadPrim[] = [];
  // punta en el extremo x = edge que apunta hacia fuera (dir = +1 derecha, -1 izquierda); devuelve hasta dónde llega el tramo
  const head = (kind: ArrowHead, edge: number, dir: number): number => {
    const X = (d: number) => edge - dir * d; // d = distancia hacia dentro desde el extremo
    if (kind === 'triangle') {
      const L = hh * 1.7;
      heads.push({ kind: 'fill', pts: [{ x: X(0), y }, { x: X(L), y: y - hh }, { x: X(L), y: y + hh }] });
      return X(L - Math.min(L, 0.5));
    }
    if (kind === 'arrow') {
      const a = hh - t / 2, tip = t / 2;
      heads.push({ kind: 'open', pts: [{ x: X(tip + a * 1.1), y: y - a }, { x: X(tip), y }, { x: X(tip + a * 1.1), y: y + a }] });
      return X(tip);
    }
    if (kind === 'circle') {
      const r = hh * 0.8;
      heads.push({ kind: 'circle', cx: X(r), cy: y, r });
      return X(r);
    }
    if (kind === 'square') {
      const r = hh * 0.75;
      heads.push({ kind: 'fill', pts: [{ x: X(0), y: y - r }, { x: X(2 * r), y: y - r }, { x: X(2 * r), y: y + r }, { x: X(0), y: y + r }] });
      return X(r);
    }
    if (kind === 'bar') {
      const bw = Math.max(1, t);
      heads.push({ kind: 'fill', pts: [{ x: X(0), y: y - hh }, { x: X(bw), y: y - hh }, { x: X(bw), y: y + hh }, { x: X(0), y: y + hh }] });
      return X(bw / 2);
    }
    // sin punta: con extremos redondos o cuadrados el trazo no debe salirse de la caja
    return X(cap === 'butt' ? 0 : t / 2);
  };
  const x1 = head(start, 0, -1);
  const x2 = head(end, w, 1);
  return { y, t, x1, x2: Math.max(x1, x2), heads };
}

// ---------- saneado (archivos .kova de cualquier origen) ----------
export function sanitizeGradient(v: unknown): Gradient | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as any;
  const type: GradientType = o.type === 'radial' || o.type === 'conic' ? o.type : 'linear';
  const stops: GradientStop[] = Array.isArray(o.stops)
    ? o.stops.filter((s: any) => s && typeof s.color === 'string' && HEX.test(s.color)).slice(0, 32)
      .map((s: any) => ({ pos: clamp01(s.pos, 0), color: s.color, opacity: clamp01(s.opacity, 1) }))
    : [];
  if (stops.length < 2) return null;
  return { type, stops, x1: num(o.x1, 0), y1: num(o.y1, 0.5), x2: num(o.x2, 1), y2: num(o.y2, 0.5) };
}
export const sanitizeArrowHead = (v: unknown): ArrowHead | undefined =>
  typeof v === 'string' && v !== 'none' && (ARROW_HEADS as string[]).includes(v) ? (v as ArrowHead) : undefined;
export function sanitizeStrokeStyle(v: unknown): StrokeStyle | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as any;
  return {
    dash: o.dash === 'dashed' || o.dash === 'dotted' ? o.dash : 'solid',
    cap: o.cap === 'round' || o.cap === 'square' ? o.cap : 'butt',
    join: o.join === 'round' || o.join === 'bevel' ? o.join : 'miter',
    align: o.align === 'inside' || o.align === 'outside' ? o.align : 'center',
    opacity: clamp01(o.opacity, 1),
  };
}

// ---------- degradados guardados por el usuario ----------
const LIB_KEY = 'kova.gradients';
export function loadSavedGradients(): Gradient[] {
  try { const a = JSON.parse(localStorage.getItem(LIB_KEY) || '[]'); return Array.isArray(a) ? a.map(sanitizeGradient).filter((g): g is Gradient => !!g).slice(0, 48) : []; } catch { return []; }
}
export function saveGradients(list: Gradient[]) {
  try { localStorage.setItem(LIB_KEY, JSON.stringify(list.slice(0, 48))); } catch { /* sin almacenamiento */ }
}
/** Degradados de partida (combinaciones neutras, no colores de marca). */
export const BUILTIN_GRADIENTS: Gradient[] = [
  defaultGradient('#000000', '#ffffff'),
  defaultGradient('#ff512f', '#f09819'),
  defaultGradient('#4776e6', '#8e54e9'),
  defaultGradient('#11998e', '#38ef7d'),
  { ...defaultGradient('#ffffff', '#000000', 'radial') },
  { type: 'linear', x1: 0, y1: 0.5, x2: 1, y2: 0.5, stops: [{ pos: 0, color: '#ff0080', opacity: 1 }, { pos: 0.5, color: '#7928ca', opacity: 1 }, { pos: 1, color: '#0070f3', opacity: 1 }] },
  { type: 'linear', x1: 0.5, y1: 0, x2: 0.5, y2: 1, stops: [{ pos: 0, color: '#000000', opacity: 0 }, { pos: 1, color: '#000000', opacity: 0.85 }] },
  { type: 'conic', x1: 0.5, y1: 0.5, x2: 1, y2: 0.5, stops: [{ pos: 0, color: '#ff0000', opacity: 1 }, { pos: 0.33, color: '#00ff00', opacity: 1 }, { pos: 0.66, color: '#0000ff', opacity: 1 }, { pos: 1, color: '#ff0000', opacity: 1 }] },
];
