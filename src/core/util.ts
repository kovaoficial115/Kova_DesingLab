import type { Layer, Unit } from './types';
import { flowText, type FlowLine } from './textflow';
import { samplePath, layoutOnPath, pathBounds, glyphBounds, type PathGlyph } from './textpath';

let counter = 0;
export const uid = (p = 'id') => `${p}_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ---------- Unidades ----------
export function toPx(v: number, unit: Unit, dpi: number): number {
  switch (unit) {
    case 'px': return v;
    case 'in': return v * dpi;
    case 'cm': return (v / 2.54) * dpi;
    case 'mm': return (v / 25.4) * dpi;
  }
}
export function fromPx(px: number, unit: Unit, dpi: number): number {
  switch (unit) {
    case 'px': return px;
    case 'in': return px / dpi;
    case 'cm': return (px / dpi) * 2.54;
    case 'mm': return (px / dpi) * 25.4;
  }
}
export function fmtUnit(px: number, unit: Unit, dpi: number, digits?: number) {
  const v = fromPx(px, unit, dpi);
  const d = digits ?? (unit === 'px' ? 0 : unit === 'mm' ? 1 : 2);
  return `${v.toFixed(d)} ${unit}`;
}

// ---------- Canvas ----------
export function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
export function ctx2d(c: HTMLCanvasElement, opts?: CanvasRenderingContext2DSettings) {
  return c.getContext('2d', { willReadFrequently: true, ...opts }) as CanvasRenderingContext2D;
}
export function cloneCanvas(src: HTMLCanvasElement | ImageBitmap | HTMLImageElement, w?: number, h?: number) {
  const sw = (src as any).width, sh = (src as any).height;
  const c = createCanvas(w ?? sw, h ?? sh);
  const g = ctx2d(c);
  g.imageSmoothingQuality = 'high';
  g.drawImage(src as any, 0, 0, c.width, c.height);
  return c;
}
export function getImageData(c: HTMLCanvasElement) {
  return ctx2d(c).getImageData(0, 0, c.width, c.height);
}
export function canvasFromImageData(img: ImageData) {
  const c = createCanvas(img.width, img.height);
  ctx2d(c).putImageData(img, 0, 0);
  return c;
}

/** Remuestreo de alta calidad por pasos (evita aliasing al reducir mucho). */
export function resampleCanvas(src: HTMLCanvasElement, w: number, h: number, method: 'smooth' | 'nearest' = 'smooth') {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  if (method === 'nearest') {
    const c = createCanvas(w, h);
    const g = ctx2d(c);
    g.imageSmoothingEnabled = false;
    g.drawImage(src, 0, 0, w, h);
    return c;
  }
  let cur: HTMLCanvasElement = src;
  let cw = src.width, ch = src.height;
  while (cw / 2 > w && ch / 2 > h) {
    cw = Math.round(cw / 2); ch = Math.round(ch / 2);
    const step = createCanvas(cw, ch);
    const g = ctx2d(step);
    g.imageSmoothingQuality = 'high';
    g.drawImage(cur, 0, 0, cw, ch);
    cur = step;
  }
  const out = createCanvas(w, h);
  const g = ctx2d(out);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(cur, 0, 0, w, h);
  return out;
}

export function canvasToBlob(c: HTMLCanvasElement, type = 'image/png', q?: number): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('No se pudo codificar la imagen'))), type, q));
}

export async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(blob);
  const c = cloneCanvas(bmp);
  bmp.close();
  return c;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('No se pudo cargar la imagen'));
    im.src = src;
  });
}

// ---------- Geometría de capas ----------
export function layerSize(l: Layer): { w: number; h: number } {
  if (l.kind === 'raster' && l.canvas) return { w: l.canvas.width, h: l.canvas.height };
  if (l.kind === 'shape' && l.shape) return { w: l.shape.w, h: l.shape.h };
  if (l.kind === 'vector' && l.vector) return { w: l.vector.w, h: l.vector.h };
  if (l.kind === 'text' && l.text) return measureText(l.text);
  return { w: 0, h: 0 };
}

let measureCtx: CanvasRenderingContext2D | null = null;
export function textFont(t: { fontWeight: number; italic: boolean; fontSize: number; fontFamily: string }) {
  return `${t.italic ? 'italic ' : ''}${t.fontWeight} ${t.fontSize}px ${t.fontFamily}`;
}

/**
 * Disposición de un texto. `bw`×`bh` es la caja de las líneas (la de siempre: define la posición
 * de la capa y su centro de giro). Las letras de algunas tipografías (caligráficas, con adornos)
 * se salen de esa caja por arriba, abajo o los lados: `w`×`h` es la caja completa que las
 * contiene y (`ox`, `oy`) dónde empieza la caja de las líneas dentro de ella. Así nada se recorta
 * y las letras no se mueven de sitio al crecer la caja.
 */
export interface TextLayout {
  w: number; h: number; bw: number; bh: number; ox: number; oy: number;
  /** De la línea superior de cada renglón a su línea base (para SVG y el subrayado). */
  base: number;
  /** Líneas ya cortadas, alineadas y justificadas (coordenadas de la caja de las líneas). */
  lines: FlowLine[];
  /** Texto tal como se dibuja (en mayúsculas si `caps`). */
  shown: string;
  /** Texto en trayectoria: cada letra con su posición (caja de las líneas) y giro. */
  glyphs?: PathGlyph[];
}

// medir texto es caro (más en WebKit, la app de escritorio, y con fuentes complejas) y la caja se
// consulta muchas veces por fotograma al mover o transformar: se guarda por contenido y fuente
const layoutCache = new Map<string, TextLayout>();
/** Las fuentes cambiaron (terminó de cargar una): las medidas guardadas ya no valen. */
export function clearTextMetrics() { layoutCache.clear(); }

/** Subrayado y tachado: posición (desde la línea superior del renglón) y grosor. */
export function decorationLines(t: import('./types').TextProps, base: number) {
  const th = Math.max(1, t.fontSize * 0.06);
  return { thickness: th, underline: base + t.fontSize * 0.1, strike: base - t.fontSize * 0.3 };
}

export function textLayout(t: import('./types').TextProps): TextLayout {
  const font = textFont(t);
  const key = `${font}|${t.letterSpacing}|${t.lineHeight}|${t.strokeWidth}|${t.align}|${t.box ? t.box.w + 'x' + t.box.h : ''}|${t.caps ? 1 : 0}${t.underline ? 1 : 0}${t.strike ? 1 : 0}|${t.paraSpacing ?? 0}|${t.indent ?? 0}|${t.path ? JSON.stringify(t.path) : ''}|${t.text}`;
  const hit = layoutCache.get(key);
  if (hit) return hit;
  if (!measureCtx) measureCtx = ctx2d(createCanvas(4, 4));
  const g = measureCtx;
  if (t.path?.d) {
    const p = pathLayout(t, g, font);
    if (p) { if (layoutCache.size > 500) layoutCache.clear(); layoutCache.set(key, p); return p; }
  }
  g.font = font;
  (g as any).letterSpacing = `${t.letterSpacing}px`;
  g.textBaseline = 'top';
  g.textAlign = 'left';
  const widths = new Map<string, number>();
  const measure = (s: string) => { let v = widths.get(s); if (v === undefined) { v = g.measureText(s).width; widths.set(s, v); } return v; };
  const shown = t.caps ? t.text.toLocaleUpperCase('es') : t.text;
  const pad = t.strokeWidth + 2, sw = t.strokeWidth;
  const flow = flowText({ text: shown, fontSize: t.fontSize, lineHeight: t.lineHeight, align: t.align, pad, box: t.box, paraSpacing: t.paraSpacing, indent: t.indent }, measure);
  const { bw, bh, lines } = flow;
  // distancia real de la línea superior a la base de las letras (varía mucho entre tipografías)
  const ab = -(g.measureText(shown.trim() ? shown.replace(/\n[\s\S]*/, '') || 'M' : 'M').alphabeticBaseline ?? NaN);
  const base = isFinite(ab) && ab > 0 ? ab : t.fontSize * 0.8;
  const deco = decorationLines(t, base);
  // tinta de cada línea, dibujada como en renderText (línea base 'top')
  let x0 = 0, y0 = 0, x1 = bw, y1 = bh;
  for (const ln of lines) {
    if (!ln.text) continue;
    const m = g.measureText(ln.text);
    // justificada: los huecos crecen, la tinta va del inicio de la primera palabra al final de la última
    const right = ln.words ? ln.x + ln.width - m.width + (m.actualBoundingBoxRight || 0) : ln.x + (m.actualBoundingBoxRight || 0);
    x0 = Math.min(x0, ln.x - (m.actualBoundingBoxLeft || 0) - sw);
    x1 = Math.max(x1, right + sw);
    y0 = Math.min(y0, ln.y - (m.actualBoundingBoxAscent || 0) - sw);
    y1 = Math.max(y1, ln.y + (m.actualBoundingBoxDescent || 0) + sw, t.underline ? ln.y + deco.underline + deco.thickness : 0);
  }
  // margen para el suavizado de los bordes de lo que sobresale (la medida de la tinta es aproximada)
  const M = 3;
  const ox = x0 < 0 ? Math.ceil(-x0) + M : 0, oy = y0 < 0 ? Math.ceil(-y0) + M : 0;
  const ex = x1 > bw ? Math.ceil(x1 - bw) + M : 0, ey = y1 > bh ? Math.ceil(y1 - bh) + M : 0;
  const out: TextLayout = { w: bw + ox + ex, h: bh + oy + ey, bw, bh, ox, oy, base, lines, shown };
  if (layoutCache.size > 500) layoutCache.clear();
  layoutCache.set(key, out);
  return out;
}

/** Disposición de un texto en trayectoria: la caja de las líneas es la de la curva con un margen
 *  fijo (no cambia al escribir, así la curva no se mueve) y las letras van sobre ella. */
function pathLayout(t: import('./types').TextProps, g: CanvasRenderingContext2D, font: string): TextLayout | null {
  const tp = t.path!;
  const S = samplePath(tp.d, tp.flip);
  if (!S) return null;
  g.font = font;
  (g as any).letterSpacing = '0px';
  g.textBaseline = 'alphabetic';
  const shown = (t.caps ? t.text.toLocaleUpperCase('es') : t.text).replace(/\s*\n\s*/g, ' ');
  const chars = Array.from(shown);
  // ancho de cada prefijo (respeta el interletraje de la fuente entre pares de letras)
  const pre = [0];
  let acc = '';
  for (const ch of chars) { acc += ch; pre.push(g.measureText(acc).width); }
  const sw = t.strokeWidth;
  const m = g.measureText(shown.trim() || 'M');
  const ascent = m.actualBoundingBoxAscent || t.fontSize * 0.8, descent = m.actualBoundingBoxDescent || t.fontSize * 0.2;
  // del otro lado, las letras cuelgan de la curva (como el texto inferior de un sello): la parte
  // alta toca la curva y el cuerpo queda fuera, en la misma franja que el texto del lado normal
  const shift = tp.shift - (tp.flip ? ascent : 0);
  const glyphs = layoutOnPath(chars, i => pre[i], { S, pos: tp.pos, align: t.align, letterSpacing: t.letterSpacing, shift });
  const pb = pathBounds(S);
  // la caja de referencia es la de la curva (con un margen fijo): no depende del texto, así
  // cambiar el tamaño, el contenido o el lado no mueve la curva; las letras que salen de ella
  // amplían la caja completa (ox, oy) como en el resto de textos
  const margin = 2;
  const bw = Math.max(4, Math.ceil(pb.w + 2 * margin)), bh = Math.max(4, Math.ceil(pb.h + 2 * margin));
  const gx = (bw - pb.w) / 2 - pb.x, gy = (bh - pb.h) / 2 - pb.y;
  const placed = glyphs.map(q => ({ ...q, x: q.x + gx, y: q.y + gy }));
  const ink = glyphBounds(placed, ascent, descent, sw + 3);
  let ox = 0, oy = 0, ex = 0, ey = 0;
  if (ink) {
    ox = ink.x < 0 ? Math.ceil(-ink.x) : 0; oy = ink.y < 0 ? Math.ceil(-ink.y) : 0;
    ex = ink.x + ink.w > bw ? Math.ceil(ink.x + ink.w - bw) : 0; ey = ink.y + ink.h > bh ? Math.ceil(ink.y + ink.h - bh) : 0;
  }
  return { w: bw + ox + ex, h: bh + oy + ey, bw, bh, ox, oy, base: ascent, lines: [], shown, glyphs: placed };
}

export function measureText(t: import('./types').TextProps) {
  const { w, h } = textLayout(t);
  return { w, h };
}

/** Caja de referencia de la capa: define su posición (x, y) y su centro de giro. Solo difiere del
 *  tamaño en los textos cuyas letras se salen de la caja de las líneas. */
export function pivotBox(l: Layer): { w: number; h: number; ox: number; oy: number } {
  if (l.kind === 'text' && l.text) { const t = textLayout(l.text); return { w: t.bw, h: t.bh, ox: t.ox, oy: t.oy }; }
  const { w, h } = layerSize(l);
  return { w, h, ox: 0, oy: 0 };
}
/** Centro de giro de la capa en el mundo. */
export function layerPivot(l: Layer) {
  const b = pivotBox(l);
  return { x: l.x + (b.w * Math.abs(l.scaleX)) / 2, y: l.y + (b.h * Math.abs(l.scaleY)) / 2 };
}
/** Posición (x, y) que deja el centro de giro en (cx, cy) con la escala dada. */
export function placeAtPivot(l: Layer, cx: number, cy: number, sx = l.scaleX, sy = l.scaleY) {
  const b = pivotBox(l);
  return { x: cx - (b.w * Math.abs(sx)) / 2, y: cy - (b.h * Math.abs(sy)) / 2 };
}

/** Matriz local→mundo de una capa. */
export function layerMatrix(l: Layer): DOMMatrix {
  const b = pivotBox(l);
  const m = new DOMMatrix();
  m.translateSelf(l.x + (b.w * Math.abs(l.scaleX)) / 2, l.y + (b.h * Math.abs(l.scaleY)) / 2);
  m.rotateSelf(l.rotation);
  m.scaleSelf(l.scaleX, l.scaleY);
  m.translateSelf(-b.w / 2 - b.ox, -b.h / 2 - b.oy);
  return m;
}

export function layerCorners(l: Layer) {
  const { w, h } = layerSize(l);
  const m = layerMatrix(l);
  return [
    m.transformPoint(new DOMPoint(0, 0)),
    m.transformPoint(new DOMPoint(w, 0)),
    m.transformPoint(new DOMPoint(w, h)),
    m.transformPoint(new DOMPoint(0, h)),
  ];
}

export interface Rect { x: number; y: number; w: number; h: number }
export function layerBounds(l: Layer): Rect {
  const pts = layerCorners(l);
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
export function unionRect(rs: Rect[]): Rect | null {
  if (!rs.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const r of rs) { x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y); x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h); }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
export function rectsIntersect(a: Rect, b: Rect) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
export function pointInLayer(l: Layer, x: number, y: number) {
  const { w, h } = layerSize(l);
  const p = layerMatrix(l).inverse().transformPoint(new DOMPoint(x, y));
  return p.x >= 0 && p.y >= 0 && p.x <= w && p.y <= h;
}

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}


export function debounce<T extends (...a: any[]) => void>(fn: T, ms: number) {
  let t: any;
  return (...a: Parameters<T>) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** Recorta los bordes totalmente transparentes. Devuelve el canvas recortado y el desplazamiento. */
export function trimCanvas(c: HTMLCanvasElement, alphaMin = 1): { canvas: HTMLCanvasElement; x: number; y: number } | null {
  const { width: w, height: h } = c;
  const d = getImageData(c).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (d[row + x * 4 + 3] >= alphaMin) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  if (x0 === 0 && y0 === 0 && x1 === w - 1 && y1 === h - 1) return { canvas: c, x: 0, y: 0 };
  const out = createCanvas(x1 - x0 + 1, y1 - y0 + 1);
  ctx2d(out).drawImage(c, -x0, -y0);
  return { canvas: out, x: x0, y: y0 };
}
