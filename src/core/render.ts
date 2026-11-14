// Renderizador de escena: compone capas (con grupos, máscaras, recortes, modos de fusión y
// ajustes no destructivos) sobre cualquier contexto 2D. Lo usan el visor y la exportación.

import type { Artboard, DocState, Layer } from './types';
import { createCanvas, ctx2d, cloneCanvas, layerMatrix, layerSize, textFont, textLayout, clearTextMetrics, decorationLines, getImageData } from './util';
import { childrenOf, descendants } from './doc';
import { runOp } from '../engine/workerClient';
import { bumpRender } from './store';

// ---------- identidad de objetos para firmas de caché ----------
const objIds = new WeakMap<object, number>();
let objCounter = 1;
export const oid = (o: object | null | undefined) => {
  if (!o) return 0;
  let v = objIds.get(o);
  if (!v) { v = objCounter++; objIds.set(o, v); }
  return v;
};

// ---------- contenido base de cada capa ----------
const contentCache = new Map<string, { sig: string; canvas: HTMLCanvasElement }>();
const vectorCache = new Map<string, { svg: string; scale: number; canvas: HTMLCanvasElement | null; loading: boolean }>();

function renderText(l: Layer): HTMLCanvasElement {
  const t = l.text!;
  // caja completa (con lo que sobresale de las letras) y las líneas ya cortadas y alineadas
  const { w, h, ox, oy, lines, base, glyphs } = textLayout(t);
  const c = createCanvas(w, h);
  const g = ctx2d(c);
  g.translate(ox, oy);
  g.font = textFont(t);
  if (glyphs) {
    // texto en trayectoria: cada letra girada sobre su punto de la curva (línea base en la curva)
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    g.lineJoin = 'round';
    const each = (fn: (q: NonNullable<typeof glyphs>[number]) => void) => { for (const q of glyphs) { if (!q.ch.trim()) continue; g.save(); g.translate(q.x, q.y); g.rotate(q.a); fn(q); g.restore(); } };
    if (t.strokeWidth > 0) { g.strokeStyle = t.strokeColor; g.lineWidth = t.strokeWidth * 2; each(q => g.strokeText(q.ch, -q.w / 2, 0)); }
    g.fillStyle = t.color;
    each(q => g.fillText(q.ch, -q.w / 2, 0));
    return c;
  }
  (g as any).letterSpacing = `${t.letterSpacing}px`;
  g.textBaseline = 'top';
  g.textAlign = 'left';
  g.lineJoin = 'round';
  const deco = decorationLines(t, base);
  const pieces = (ln: (typeof lines)[number]) => (ln.words ? ln.words.map(wd => ({ text: wd.text, x: ln.x + wd.x })) : [{ text: ln.text, x: ln.x }]);
  const bars = (ln: (typeof lines)[number]) => {
    const r: [number, number, number, number][] = [];
    if (!ln.text) return r;
    if (t.underline) r.push([ln.x, ln.y + deco.underline, ln.width, deco.thickness]);
    if (t.strike) r.push([ln.x, ln.y + deco.strike, ln.width, deco.thickness]);
    return r;
  };
  if (t.strokeWidth > 0) {
    g.strokeStyle = t.strokeColor;
    g.lineWidth = t.strokeWidth * 2;
    for (const ln of lines) {
      for (const p of pieces(ln)) if (p.text) g.strokeText(p.text, p.x, ln.y);
      for (const [x, y, bw, bh] of bars(ln)) g.strokeRect(x, y, bw, bh);
    }
  }
  g.fillStyle = t.color;
  for (const ln of lines) {
    for (const p of pieces(ln)) if (p.text) g.fillText(p.text, p.x, ln.y);
    for (const [x, y, bw, bh] of bars(ln)) g.fillRect(x, y, bw, bh);
  }
  return c;
}

function renderShape(l: Layer): HTMLCanvasElement {
  const s = l.shape!;
  const c = createCanvas(s.w, s.h);
  const g = ctx2d(c);
  const sw = s.stroke ? s.strokeWidth : 0;
  const i = sw / 2;
  g.beginPath();
  if (s.shape === 'ellipse') g.ellipse(s.w / 2, s.h / 2, Math.max(0.5, s.w / 2 - i), Math.max(0.5, s.h / 2 - i), 0, 0, Math.PI * 2);
  else if (s.shape === 'line') { g.moveTo(0, s.h / 2); g.lineTo(s.w, s.h / 2); }
  else (g as any).roundRect(i, i, Math.max(1, s.w - sw), Math.max(1, s.h - sw), Math.max(0, s.radius));
  if (s.fill && s.shape !== 'line') { g.fillStyle = s.fill; g.fill(); }
  if (s.stroke || s.shape === 'line') {
    g.strokeStyle = s.stroke || s.fill || '#fff';
    g.lineWidth = s.shape === 'line' ? Math.max(1, s.h) : sw;
    g.stroke();
  }
  return c;
}

/** Rasteriza un SVG a una resolución dada (asíncrono). */
export function rasterizeSvg(svg: string, w: number, h: number): Promise<HTMLCanvasElement> {
  return new Promise((res, rej) => {
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const im = new Image();
    im.onload = () => {
      const c = createCanvas(w, h);
      const g = ctx2d(c);
      g.drawImage(im, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c);
    };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('SVG no válido')); };
    im.src = url;
  });
}

function vectorScaleFor(l: Layer) {
  const v = l.vector!;
  const need = Math.max(Math.abs(l.scaleX), Math.abs(l.scaleY)) * 2;
  const maxDim = Math.max(v.w, v.h);
  return Math.max(0.25, Math.min(need, 8000 / maxDim));
}

export function vectorContent(l: Layer): HTMLCanvasElement | null {
  const v = l.vector!;
  const scale = vectorScaleFor(l);
  let e = vectorCache.get(l.id);
  if (!e || e.svg !== v.svg || (e.scale < scale * 0.99 && !e.loading)) {
    const prev = e?.svg === v.svg ? e.canvas : null;
    e = { svg: v.svg, scale, canvas: prev, loading: true };
    vectorCache.set(l.id, e);
    const entry = e;
    rasterizeSvg(v.svg, v.w * scale, v.h * scale).then(c => {
      if (vectorCache.get(l.id) === entry) { entry.canvas = c; entry.loading = false; bumpRender(); }
    }).catch(() => { entry.loading = false; });
  }
  return e.canvas;
}
export async function ensureVector(l: Layer, scale: number) {
  const v = l.vector!;
  const e = vectorCache.get(l.id);
  if (e && e.svg === v.svg && e.canvas && e.scale >= scale && !e.loading) return e.canvas;
  const c = await rasterizeSvg(v.svg, v.w * scale, v.h * scale);
  vectorCache.set(l.id, { svg: v.svg, scale, canvas: c, loading: false });
  return c;
}

export function layerContent(l: Layer): HTMLCanvasElement | null {
  if (l.kind === 'raster') return l.canvas ?? null;
  if (l.kind === 'vector') return vectorContent(l);
  const sig = l.kind === 'text' ? JSON.stringify(l.text) : JSON.stringify(l.shape);
  const e = contentCache.get(l.id);
  if (e && e.sig === sig) return e.canvas;
  const canvas = l.kind === 'text' ? renderText(l) : l.kind === 'shape' ? renderShape(l) : null;
  if (canvas) contentCache.set(l.id, { sig, canvas });
  return canvas;
}

// ---------- máscaras ----------
const maskAlphaCache = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
export function maskToAlpha(mask: HTMLCanvasElement) {
  let a = maskAlphaCache.get(mask);
  if (a) return a;
  const img = getImageData(mask);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = ((0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * d[i + 3]) / 255;
    d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = v;
  }
  a = createCanvas(img.width, img.height);
  ctx2d(a).putImageData(img, 0, 0);
  maskAlphaCache.set(mask, a);
  return a;
}

function applyMask(src: HTMLCanvasElement, mask: HTMLCanvasElement) {
  const out = createCanvas(src.width, src.height);
  const g = ctx2d(out);
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(maskToAlpha(mask), 0, 0, out.width, out.height);
  return out;
}

// ---------- ajustes no destructivos (asíncronos, en worker) ----------
interface ProcEntry { sig: string; result: HTMLCanvasElement | null; pendingSig: string | null; promise: Promise<HTMLCanvasElement> | null }
const procCache = new Map<string, ProcEntry>();

function adjSig(l: Layer) {
  return JSON.stringify(l.adjustments.filter(a => a.enabled).map(a => [a.type, a.params]));
}

function computeAdjusted(src: HTMLCanvasElement, l: Layer): Promise<HTMLCanvasElement> {
  const adjustments = l.adjustments.filter(a => a.enabled).map(a => ({ type: a.type, params: a.params }));
  const img = getImageData(src);
  return runOp('adjust', img, { adjustments }).then(r => {
    const c = createCanvas(src.width, src.height);
    ctx2d(c).putImageData(r.image!, 0, 0);
    return c;
  });
}

/** Devuelve el contenido final de la capa (ajustes + máscara). Si el cálculo está en curso,
 *  devuelve el último resultado disponible y vuelve a pintar al terminar. */
export function processedContent(l: Layer, bypass = false): HTMLCanvasElement | null {
  const content = layerContent(l);
  if (!content) return null;
  const hasAdj = !bypass && l.adjustments.some(a => a.enabled);
  const useMask = l.mask && l.maskEnabled;
  if (!hasAdj && !useMask) return content;
  const sig = `${oid(content)}|${hasAdj ? adjSig(l) : ''}|${useMask ? oid(l.mask) : 0}`;
  let e = procCache.get(l.id + (bypass ? ':b' : ''));
  if (!e) { e = { sig: '', result: null, pendingSig: null, promise: null }; procCache.set(l.id + (bypass ? ':b' : ''), e); }
  if (e.sig === sig && e.result) return e.result;
  if (!hasAdj) {
    e.result = applyMask(content, l.mask!);
    e.sig = sig;
    return e.result;
  }
  if (e.pendingSig !== sig) {
    e.pendingSig = sig;
    const entry = e;
    entry.promise = computeAdjusted(content, l).then(c => {
      const out = useMask ? applyMask(c, l.mask!) : c;
      if (entry.pendingSig === sig) { entry.result = out; entry.sig = sig; entry.pendingSig = null; bumpRender(); }
      return out;
    });
  }
  return e.result ?? content;
}

/** Garantiza que todos los ajustes estén calculados (para exportar). */
export async function ensureProcessed(layers: Layer[]) {
  for (const l of layers) {
    if (l.kind === 'vector') await ensureVector(l, Math.max(1, Math.abs(l.scaleX), Math.abs(l.scaleY)) * 1.5);
    if (!l.visible) continue;
    processedContent(l);
    const e = procCache.get(l.id);
    if (e?.pendingSig && e.promise) await e.promise;
  }
}

/** Versión síncrona definitiva de una capa en su resolución nativa (para hornear). */
export async function bakedLayerCanvas(l: Layer): Promise<HTMLCanvasElement | null> {
  if (l.kind === 'vector') await ensureVector(l, Math.max(1, Math.abs(l.scaleX), Math.abs(l.scaleY)));
  await ensureProcessed([l]);
  return processedContent(l);
}

/** Las fuentes disponibles cambiaron: re-rasterizar textos (y formas, que son baratas). */
export function invalidateTextContent() { clearTextMetrics(); contentCache.clear(); }
export function invalidateLayer(id: string) { procCache.delete(id); contentCache.delete(id); vectorCache.delete(id); }

// ---------- reducciones (mipmaps) ----------
// drawImage reduce con muestreo bilineal: al alejar el zoom no promedia los píxeles que se salta
// (WebKit nunca; Chrome no siempre). Una trama fina (semitonos, texturas) se ve entonces como un
// «tejido» de moiré que no existe en el arte. Se dibuja desde una copia reducida a la mitad tantas
// veces como haga falta (cada paso promedia 2×2) y el último paso, de 2× como mucho, ya no crea moiré.
const mipCache = new WeakMap<HTMLCanvasElement, HTMLCanvasElement[]>();
function halve(src: HTMLCanvasElement) {
  const c = createCanvas(Math.max(1, Math.ceil(src.width / 2)), Math.max(1, Math.ceil(src.height / 2)));
  const g = ctx2d(c);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  // exactamente a la mitad (la última columna o fila impar queda a medias): cada píxel es el
  // promedio de un bloque 2×2, lo mismo que calcula `updateLiveRegion`
  g.drawImage(src, 0, 0, src.width / 2, src.height / 2);
  return c;
}

/** Promedio 2×2 (con alfa premultiplicado) de una zona alineada a pares. */
function halveData(src: ImageData): ImageData {
  const sw = src.width, sh = src.height, w = Math.ceil(sw / 2), h = Math.ceil(sh / 2);
  const out = new ImageData(w, h), s = src.data, d = out.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let dy = 0; dy < 2; dy++) {
      const yy = 2 * y + dy;
      if (yy >= sh) continue;
      for (let dx = 0; dx < 2; dx++) {
        const xx = 2 * x + dx;
        if (xx >= sw) continue;
        const i = (yy * sw + xx) * 4, al = s[i + 3];
        r += s[i] * al; g += s[i + 1] * al; b += s[i + 2] * al; a += al;
      }
    }
    const o = (y * w + x) * 4;
    if (a > 0) { d[o] = r / a; d[o + 1] = g / a; d[o + 2] = b / a; d[o + 3] = a / 4; }
  }
  return out;
}

// ---------- mosaicos para el visor ----------
// En Chrome los lienzos con lectura frecuente viven en la CPU y cada drawImage desde uno de
// 80 megapíxeles cuesta ~25 ms aunque se copie un trocito (se toma una instantánea entera). Con
// zoom de cerca el visor dibuja la capa a resolución completa: se trocea en mosaicos acelerados
// de 1024 px, se crean solo los visibles y un trazo en curso actualiza solo los que toca.
const TILE = 1024;
const BIG = 4_000_000;
interface TileSet { cols: number; rows: number; tiles: (HTMLCanvasElement | null)[] }
const tileCache = new WeakMap<HTMLCanvasElement, TileSet>();

function tileSet(src: HTMLCanvasElement): TileSet {
  let t = tileCache.get(src);
  if (!t) {
    const cols = Math.ceil(src.width / TILE), rows = Math.ceil(src.height / TILE);
    t = { cols, rows, tiles: new Array(cols * rows).fill(null) };
    tileCache.set(src, t);
  }
  return t;
}
/** Zona del lienzo que cubre un mosaico, con 1 px de borde compartido (evita costuras al escalar). */
function tileRect(src: HTMLCanvasElement, i: number, j: number) {
  const x0 = Math.max(0, i * TILE - 1), y0 = Math.max(0, j * TILE - 1);
  const x1 = Math.min(src.width, (i + 1) * TILE + 1), y1 = Math.min(src.height, (j + 1) * TILE + 1);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
function getTile(src: HTMLCanvasElement, ts: TileSet, i: number, j: number) {
  const k = j * ts.cols + i;
  let c = ts.tiles[k];
  if (!c) {
    const r = tileRect(src, i, j);
    c = createCanvas(r.w, r.h);
    ctx2d(c, { willReadFrequently: false }).putImageData(ctx2d(src).getImageData(r.x, r.y, r.w, r.h), 0, 0);
    ts.tiles[k] = c;
  }
  return c;
}
/** Copia en los mosaicos ya creados una zona modificada del lienzo. */
function refreshTiles(src: HTMLCanvasElement, r: { x: number; y: number; w: number; h: number }, data?: ImageData) {
  const ts = tileCache.get(src);
  if (!ts) return;
  const sg = ctx2d(src);
  for (let j = Math.max(0, Math.floor((r.y - 1) / TILE)); j <= Math.min(ts.rows - 1, Math.floor((r.y + r.h) / TILE)); j++) {
    for (let i = Math.max(0, Math.floor((r.x - 1) / TILE)); i <= Math.min(ts.cols - 1, Math.floor((r.x + r.w) / TILE)); i++) {
      const c = ts.tiles[j * ts.cols + i];
      if (!c) continue;
      const tr = tileRect(src, i, j);
      const x0 = Math.max(tr.x, r.x), y0 = Math.max(tr.y, r.y), x1 = Math.min(tr.x + tr.w, r.x + r.w), y1 = Math.min(tr.y + tr.h, r.y + r.h);
      if (x1 <= x0 || y1 <= y0) continue;
      const tg = ctx2d(c, { willReadFrequently: false });
      if (data) tg.putImageData(data, r.x - tr.x, r.y - tr.y, x0 - r.x, y0 - r.y, x1 - x0, y1 - y0);
      else tg.putImageData(sg.getImageData(x0, y0, x1 - x0, y1 - y0), x0 - tr.x, y0 - tr.y);
    }
  }
}
/** Dibuja un lienzo grande por mosaicos, solo los que caen dentro del destino. */
function drawTiled(g: CanvasRenderingContext2D, src: HTMLCanvasElement, w: number, h: number, o: RenderOpts) {
  g.save();
  g.scale(w / src.width, h / src.height);
  const inv = g.getTransform().inverse();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [px, py] of [[0, 0], [o.width, 0], [0, o.height], [o.width, o.height]]) {
    const q = inv.transformPoint(new DOMPoint(px, py));
    x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y);
  }
  const ts = tileSet(src);
  const i0 = Math.max(0, Math.floor((x0 - 2) / TILE)), i1 = Math.min(ts.cols - 1, Math.floor((x1 + 2) / TILE));
  const j0 = Math.max(0, Math.floor((y0 - 2) / TILE)), j1 = Math.min(ts.rows - 1, Math.floor((y1 + 2) / TILE));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const c = getTile(src, ts, i, j), tr = tileRect(src, i, j);
    // se dibuja solo la parte propia del mosaico; el borde de 1 px es para el filtrado
    const ox = i * TILE, oy = j * TILE;
    const cw = Math.min(TILE, src.width - ox), ch = Math.min(TILE, src.height - oy);
    g.drawImage(c, ox - tr.x, oy - tr.y, cw, ch, ox, oy, cw, ch);
  }
  g.restore();
}

/**
 * Lienzo que se va a modificar en sitio (trazo en curso). Hereda las reducciones del lienzo del que
 * se copió y quien lo modifica las mantiene al día con `updateLiveRegion`: así el visor sigue
 * dibujando una copia pequeña y no el lienzo entero (que puede tener 80 megapíxeles) a cada fotograma.
 */
export function beginLiveCanvas(c: HTMLCanvasElement, copiedFrom?: HTMLCanvasElement) {
  const lv = copiedFrom && mipCache.get(copiedFrom);
  if (lv?.length && lv[0].width === Math.ceil(c.width / 2) && lv[0].height === Math.ceil(c.height / 2)) {
    // copias por zonas (sin drawImage desde los niveles grandes)
    mipCache.set(c, lv.map(x => { const k = createCanvas(x.width, x.height); ctx2d(k).putImageData(ctx2d(x).getImageData(0, 0, x.width, x.height), 0, 0); return k; }));
  }
  // los mosaicos visibles del original sirven tal cual (son acelerados: copiarlos es barato)
  const ts = copiedFrom && tileCache.get(copiedFrom);
  if (ts && copiedFrom.width === c.width && copiedFrom.height === c.height) {
    tileCache.set(c, { cols: ts.cols, rows: ts.rows, tiles: ts.tiles.map(t => { if (!t) return null; const k = createCanvas(t.width, t.height); ctx2d(k, { willReadFrequently: false }).drawImage(t, 0, 0); return k; }) });
  }
}
/**
 * Un rectángulo del lienzo cambió: actualiza sus mosaicos y la zona correspondiente de cada
 * reducción (promedios 2×2 calculados aquí, sin drawImage desde el lienzo grande).
 */
export function updateLiveRegion(c: HTMLCanvasElement, r: { x: number; y: number; w: number; h: number }, data?: ImageData) {
  refreshTiles(c, r, data);
  const levels = mipCache.get(c);
  if (!levels?.length) return;
  let prev = c;
  // zona alineada a pares en el nivel anterior
  let x0 = r.x & ~1, y0 = r.y & ~1, x1 = Math.min(prev.width, r.x + r.w), y1 = Math.min(prev.height, r.y + r.h);
  for (const lv of levels) {
    if (x1 <= x0 || y1 <= y0) return;
    const src = ctx2d(prev).getImageData(x0, y0, x1 - x0, y1 - y0);
    const half = halveData(src);
    const lx = x0 / 2, ly = y0 / 2;
    const cw = Math.min(half.width, lv.width - lx), chh = Math.min(half.height, lv.height - ly);
    if (cw <= 0 || chh <= 0) return;
    ctx2d(lv).putImageData(half, lx, ly, 0, 0, cw, chh);
    const lr = { x: lx, y: ly, w: cw, h: chh };
    refreshTiles(lv, lr, half.width === cw && half.height === chh ? half : undefined);
    prev = lv;
    x0 = lx & ~1; y0 = ly & ~1; x1 = Math.min(lv.width, lx + cw + 1); y1 = Math.min(lv.height, ly + chh + 1);
  }
}

/** Versión del lienzo para dibujarlo a `scale` píxeles de destino por píxel de origen. */
export function mipFor(src: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  if (!(scale < 0.5) || src.width < 64 || src.height < 64) return src;
  let levels = mipCache.get(src);
  if (!levels) mipCache.set(src, (levels = []));
  let cur = src;
  for (let i = 0; scale < 0.5 && cur.width >= 32 && cur.height >= 32; i++, scale *= 2) cur = levels[i] ??= halve(cur);
  return cur;
}

// ---------- composición ----------
const pool: HTMLCanvasElement[] = [];
function borrow(w: number, h: number) {
  const c = pool.pop() ?? document.createElement('canvas');
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } else ctx2d(c, { willReadFrequently: false }).clearRect(0, 0, w, h);
  ctx2d(c, { willReadFrequently: false });
  return c;
}
function giveBack(c: HTMLCanvasElement) { if (pool.length < 8) pool.push(c); }

export interface RenderOpts {
  base: DOMMatrix; // mundo → píxeles del destino
  width: number;
  height: number;
  smoothing: boolean;
  bypassIds?: Set<string> | null; // capas renderizadas sin ajustes (antes/después)
  only?: Set<string> | null; // renderizar solo estas capas (y sus grupos)
  hidden?: Set<string> | null; // ocultar estas capas temporalmente
  /** visor: dibujar los lienzos grandes por mosaicos (solo lo visible) */
  tiles?: boolean;
}

function drawLayer(g: CanvasRenderingContext2D, l: Layer, o: RenderOpts, all: Layer[], forceNormal = false) {
  if (l.kind === 'group') {
    const kids = childrenOf(all, l.id);
    if (l.blend === 'source-over' && l.opacity >= 1 && !forceNormal) { drawList(g, kids, o, all); return; }
    const off = borrow(o.width, o.height);
    drawList(ctx2d(off), kids, o, all);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = forceNormal ? 1 : l.opacity;
    g.globalCompositeOperation = forceNormal ? 'source-over' : l.blend;
    g.drawImage(off, 0, 0);
    g.restore();
    giveBack(off);
    return;
  }
  if (o.only && !o.only.has(l.id)) return;
  const src = processedContent(l, !!o.bypassIds?.has(l.id));
  if (!src) return;
  const { w, h } = layerSize(l);
  const m = o.base.multiply(layerMatrix(l));
  g.save();
  g.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
  g.globalAlpha = forceNormal ? 1 : l.opacity;
  g.globalCompositeOperation = forceNormal ? 'source-over' : l.blend;
  g.imageSmoothingEnabled = o.smoothing;
  g.imageSmoothingQuality = 'high';
  // escala real: píxeles de destino por píxel del contenido (la mayor de los dos ejes, para no emborronar)
  const k = Math.max(Math.hypot(m.a, m.b) * (w / src.width), Math.hypot(m.c, m.d) * (h / src.height));
  const pick = o.smoothing ? mipFor(src, k) : src;
  if (o.tiles && pick.width * pick.height > BIG) drawTiled(g, pick, w, h, o);
  else g.drawImage(pick, 0, 0, w, h);
  g.restore();
}

function visibleNow(l: Layer, o: RenderOpts) {
  return l.visible && !o.hidden?.has(l.id);
}

function drawList(g: CanvasRenderingContext2D, list: Layer[], o: RenderOpts, all: Layer[]) {
  let i = 0;
  while (i < list.length) {
    const base = list[i];
    let j = i + 1;
    const clipped: Layer[] = [];
    while (j < list.length && list[j].clip) { if (visibleNow(list[j], o)) clipped.push(list[j]); j++; }
    if (!visibleNow(base, o)) { i = j; continue; }
    if (!clipped.length) drawLayer(g, base, o, all);
    else {
      const group = borrow(o.width, o.height);
      const gg = ctx2d(group);
      drawLayer(gg, base, o, all, true);
      const alphaRef = borrow(o.width, o.height);
      ctx2d(alphaRef).drawImage(group, 0, 0);
      for (const c of clipped) {
        const tmp = borrow(o.width, o.height);
        const tg = ctx2d(tmp);
        drawLayer(tg, c, o, all, true);
        tg.globalCompositeOperation = 'destination-in';
        tg.drawImage(alphaRef, 0, 0);
        gg.save();
        gg.globalAlpha = c.opacity;
        gg.globalCompositeOperation = c.blend;
        gg.drawImage(tmp, 0, 0);
        gg.restore();
        giveBack(tmp);
      }
      giveBack(alphaRef);
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = base.opacity;
      g.globalCompositeOperation = base.blend;
      g.drawImage(group, 0, 0);
      g.restore();
      giveBack(group);
    }
    i = j;
  }
}

export function renderLayers(g: CanvasRenderingContext2D, state: Pick<DocState, 'layers'>, o: RenderOpts) {
  drawList(g, childrenOf(state.layers, null), o, state.layers);
}

/** Renderiza una mesa de trabajo a un canvas nuevo con la escala indicada. */
export async function renderArtboard(state: DocState, ab: Artboard, scale = 1, opts: { background?: boolean; only?: Set<string> | null; hidden?: Set<string> | null } = {}) {
  await ensureProcessed(state.layers);
  const w = Math.max(1, Math.round(ab.w * scale)), h = Math.max(1, Math.round(ab.h * scale));
  const c = createCanvas(w, h);
  const g = ctx2d(c);
  if (opts.background !== false && ab.background) { g.fillStyle = ab.background; g.fillRect(0, 0, w, h); }
  const base = new DOMMatrix().scaleSelf(scale, scale).translateSelf(-ab.x, -ab.y);
  renderLayers(g, state, { base, width: w, height: h, smoothing: true, only: opts.only ?? null, hidden: opts.hidden ?? null });
  return c;
}

/** Renderiza una capa individual (con su transformación) recortada a su caja. */
export async function renderLayerAlone(state: DocState, l: Layer, scale = 1) {
  const { layerBounds } = await import('./util');
  const b = layerBounds(l);
  const ab: Artboard = { id: 'tmp', name: '', x: b.x, y: b.y, w: b.w, h: b.h, dpi: 300, background: null, margin: 0 };
  const ids = new Set([l.id, ...descendants(state.layers, l.id).map(x => x.id)]);
  return { canvas: await renderArtboard(state, ab, scale, { only: ids }), bounds: b };
}
