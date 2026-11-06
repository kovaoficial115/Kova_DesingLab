import type { Layer, Unit } from './types';

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
export function measureText(t: import('./types').TextProps) {
  if (!measureCtx) measureCtx = ctx2d(createCanvas(4, 4));
  measureCtx.font = textFont(t);
  (measureCtx as any).letterSpacing = `${t.letterSpacing}px`;
  const lines = t.text.split('\n');
  let w = 0;
  for (const ln of lines) w = Math.max(w, measureCtx.measureText(ln || ' ').width);
  const h = lines.length * t.fontSize * t.lineHeight;
  const pad = t.strokeWidth * 2 + 4;
  return { w: Math.ceil(w + pad), h: Math.ceil(h + pad) };
}

/** Matriz local→mundo de una capa. */
export function layerMatrix(l: Layer): DOMMatrix {
  const { w, h } = layerSize(l);
  const m = new DOMMatrix();
  m.translateSelf(l.x + (w * Math.abs(l.scaleX)) / 2, l.y + (h * Math.abs(l.scaleY)) / 2);
  m.rotateSelf(l.rotation);
  m.scaleSelf(l.scaleX, l.scaleY);
  m.translateSelf(-w / 2, -h / 2);
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
