// Renderizador de escena: compone capas (con grupos, máscaras, recortes, modos de fusión y
// ajustes no destructivos) sobre cualquier contexto 2D. Lo usan el visor y la exportación.

import type { Artboard, DocState, Layer } from './types';
import { createCanvas, ctx2d, cloneCanvas, layerMatrix, layerSize, textFont, textLayout, clearTextMetrics, decorationLines, getImageData } from './util';
import { childrenOf, descendants } from './doc';
import { runOp } from '../engine/workerClient';
import { bumpRender, get, isLive } from './store';
import { fxDef } from '../engine/fx/registry';
import { canvasGradient, dashArray, polygonPoints, DEFAULT_STROKE_STYLE } from './paint';

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
    if (t.gradient) {
      // el degradado ocupa la caja del texto; cada letra está girada, así que se pinta en una capa aparte
      const fillC = createCanvas(w, h), fg = ctx2d(fillC);
      fg.translate(ox, oy); fg.font = g.font; fg.textBaseline = 'alphabetic'; fg.textAlign = 'left';
      for (const q of glyphs) { if (!q.ch.trim()) continue; fg.save(); fg.translate(q.x, q.y); fg.rotate(q.a); fg.fillText(q.ch, -q.w / 2, 0); fg.restore(); }
      fg.setTransform(1, 0, 0, 1, 0, 0); fg.globalCompositeOperation = 'source-in';
      fg.fillStyle = canvasGradient(fg, t.gradient, w, h); fg.fillRect(0, 0, w, h);
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(fillC, 0, 0); g.restore();
      return c;
    }
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
  g.fillStyle = t.gradient ? canvasGradient(g, t.gradient, w, h, -ox, -oy) : t.color;
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
  const st = s.strokeStyle ?? DEFAULT_STROKE_STYLE;
  const sw = s.stroke ? s.strokeWidth : 0;
  // la caja incluye el contorno: se dibuja centrado a sw/2 del borde (como siempre). El relleno llega
  // hasta el centro del contorno (centrado, el modo de siempre), hasta su borde exterior (interior: el
  // contorno queda dentro del relleno) o hasta su borde interior (exterior: el relleno no pasa por debajo)
  const fillInset = st.align === 'outside' ? sw : st.align === 'inside' ? 0 : sw / 2;
  const path = (inset: number) => {
    g.beginPath();
    if (s.shape === 'ellipse') g.ellipse(s.w / 2, s.h / 2, Math.max(0.5, s.w / 2 - inset), Math.max(0.5, s.h / 2 - inset), 0, 0, Math.PI * 2);
    else if (s.shape === 'line') { g.moveTo(0, s.h / 2); g.lineTo(s.w, s.h / 2); }
    else if (s.shape === 'polygon' || s.shape === 'star') {
      const pts = polygonPoints(s.sides ?? (s.shape === 'star' ? 5 : 6), s.w, s.h, inset, s.shape === 'star' ? s.inner ?? 0.5 : undefined);
      pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.closePath();
    } else (g as any).roundRect(inset, inset, Math.max(1, s.w - 2 * inset), Math.max(1, s.h - 2 * inset), Math.max(0, s.radius + (s.radius > 0 ? sw / 2 - inset : 0)));
  };
  if ((s.fill || s.fillGradient) && s.shape !== 'line') {
    path(Math.min(fillInset, Math.min(s.w, s.h) / 2 - 0.5));
    g.fillStyle = s.fillGradient ? canvasGradient(g, s.fillGradient, s.w, s.h) : s.fill!;
    g.fill();
  }
  if (s.stroke || s.shape === 'line') {
    path(s.shape === 'line' ? 0 : sw / 2);
    const lw = s.shape === 'line' ? Math.max(1, s.h) : sw;
    g.strokeStyle = s.stroke || s.fill || '#fff';
    g.lineWidth = lw;
    g.lineCap = st.dash === 'dotted' ? 'round' : st.cap;
    g.lineJoin = st.join;
    g.setLineDash(dashArray(st.dash, lw));
    g.globalAlpha = st.opacity;
    // una línea larga a lo ancho: el trazo no debe salirse de la caja por los extremos
    if (s.shape === 'line' && g.lineCap !== 'butt') { g.save(); g.beginPath(); g.moveTo(lw / 2, s.h / 2); g.lineTo(s.w - lw / 2, s.h / 2); g.stroke(); g.restore(); }
    else g.stroke();
    g.globalAlpha = 1;
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

// ---------- ajustes y efectos no destructivos (asíncronos, en worker) ----------
// Cada capa tiene como mucho un cálculo en curso: si mientras tanto cambian los parámetros, al
// terminar se calcula solo la última versión (no se encolan trabajos al arrastrar un deslizador).
// Mientras se arrastra, los efectos pesados sobre imágenes grandes se calculan reducidos (vista
// previa) y al soltar se calcula a resolución completa, que es la que se exporta.
interface Want { sig: string; scale: number; content: HTMLCanvasElement; l: Layer; useMask: boolean }
interface ProcEntry {
  sig: string; result: HTMLCanvasElement | null;
  draftSig: string; draft: HTMLCanvasElement | null;
  running: Want | null; want: Want | null;
  waiters: (() => void)[];
}
const procCache = new Map<string, ProcEntry>();
const DRAFT_PIXELS = 1_600_000;

const sigMemo = new WeakMap<object, string>();
function adjSig(l: Layer) {
  let s = sigMemo.get(l.adjustments);
  if (s === undefined) {
    s = JSON.stringify(l.adjustments.filter(a => a.enabled).map(a => [a.type, a.params, a.opacity ?? 100, a.blend ?? 'normal']));
    sigMemo.set(l.adjustments, s);
  }
  return s;
}
const stackOf = (l: Layer) => l.adjustments.filter(a => a.enabled).map(a => ({ type: a.type, params: a.params, opacity: a.opacity, blend: a.blend }));

function computeAdjusted(src: HTMLCanvasElement, l: Layer, scale: number): Promise<HTMLCanvasElement> {
  let input = src;
  if (scale < 1) {
    input = createCanvas(Math.max(1, Math.round(src.width * scale)), Math.max(1, Math.round(src.height * scale)));
    const g = ctx2d(input);
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, input.width, input.height);
  }
  const img = getImageData(input);
  return runOp('adjust', img, { adjustments: stackOf(l), scale }).then(r => {
    const c = createCanvas(input.width, input.height);
    ctx2d(c).putImageData(r.image!, 0, 0);
    return c;
  });
}

function startJob(e: ProcEntry, want: Want) {
  e.running = want;
  computeAdjusted(want.content, want.l, want.scale).then(c => {
    const out = want.useMask ? applyMask(c, want.l.mask!) : c;
    if (want.scale < 1) { e.draft = out; e.draftSig = want.sig; }
    else { e.result = out; e.sig = want.sig; }
  }, err => { console.error('Efectos', err); if (want.scale >= 1) e.sig = want.sig; }).finally(() => {
    e.running = null;
    const next = e.want;
    e.want = null;
    if (next && !(next.scale >= 1 ? e.sig === next.sig && e.result : e.draftSig === next.sig && e.draft)) startJob(e, next);
    else { const w = e.waiters; e.waiters = []; w.forEach(f => f()); }
    bumpRender();
  });
}
function request(e: ProcEntry, want: Want) {
  if (e.running) { if (e.running.sig !== want.sig || e.running.scale !== want.scale) e.want = want; else e.want = null; return; }
  startJob(e, want);
}
function isDraftTime(l: Layer, content: HTMLCanvasElement) {
  if (content.width * content.height <= DRAFT_PIXELS) return false;
  const id = get().activeDocId;
  if (!id || !isLive(id)) return false;
  return l.adjustments.some(a => a.enabled && fxDef(a.type)?.heavy);
}

/** Devuelve el contenido final de la capa (ajustes + máscara). Si el cálculo está en curso,
 *  devuelve el último resultado disponible y vuelve a pintar al terminar. Con `allowDraft`, durante
 *  un arrastre puede devolver una vista previa reducida (solo para dibujar en pantalla). */
export function processedContent(l: Layer, bypass = false, allowDraft = false): HTMLCanvasElement | null {
  const content = layerContent(l);
  if (!content) return null;
  const hasAdj = !bypass && l.adjustments.some(a => a.enabled);
  const useMask = !!(l.mask && l.maskEnabled);
  if (!hasAdj && !useMask) return content;
  const key = l.id + (bypass ? ':b' : '');
  const sig = `${oid(content)}|${hasAdj ? adjSig(l) : ''}|${useMask ? oid(l.mask) : 0}`;
  let e = procCache.get(key);
  if (!e) { e = { sig: '', result: null, draftSig: '', draft: null, running: null, want: null, waiters: [] }; procCache.set(key, e); }
  if (e.sig === sig && e.result) return e.result;
  if (!hasAdj) {
    e.result = applyMask(content, l.mask!);
    e.sig = sig;
    return e.result;
  }
  const draftNow = isDraftTime(l, content);
  if (draftNow) {
    if (!(e.draftSig === sig && e.draft)) {
      const k = Math.sqrt(DRAFT_PIXELS / (content.width * content.height));
      request(e, { sig, scale: Math.max(0.2, Math.min(1, k)), content, l, useMask });
    }
    if (allowDraft && e.draft) return e.draft;
  } else request(e, { sig, scale: 1, content, l, useMask });
  return e.result ?? content;
}

/** Espera a que el resultado a resolución completa de la capa esté listo. */
function whenReady(l: Layer): Promise<void> | null {
  processedContent(l);
  const e = procCache.get(l.id);
  if (!e) return null;
  const content = layerContent(l);
  if (!content) return null;
  const hasAdj = l.adjustments.some(a => a.enabled), useMask = !!(l.mask && l.maskEnabled);
  if (!hasAdj) return null;
  const sig = `${oid(content)}|${adjSig(l)}|${useMask ? oid(l.mask) : 0}`;
  if (e.sig === sig && e.result) return null;
  if (!e.running) request(e, { sig, scale: 1, content, l, useMask });
  else if (!(e.running.sig === sig && e.running.scale >= 1)) e.want = { sig, scale: 1, content, l, useMask };
  return new Promise<void>(res => e.waiters.push(res));
}

/** Garantiza que todos los ajustes estén calculados a resolución completa (para exportar). */
export async function ensureProcessed(layers: Layer[]) {
  for (const l of layers) {
    if (l.kind === 'vector') await ensureVector(l, Math.max(1, Math.abs(l.scaleX), Math.abs(l.scaleY)) * 1.5);
    if (!l.visible) continue;
    for (let guard = 0; guard < 4; guard++) { const p = whenReady(l); if (!p) break; await p; }
  }
}

/** Versión síncrona definitiva de una capa en su resolución nativa (para hornear). */
export async function bakedLayerCanvas(l: Layer): Promise<HTMLCanvasElement | null> {
  if (l.kind === 'vector') await ensureVector(l, Math.max(1, Math.abs(l.scaleX), Math.abs(l.scaleY)));
  await ensureProcessed([{ ...l, visible: true }]);
  return processedContent(l);
}

/** Las fuentes disponibles cambiaron: re-rasterizar textos (y formas, que son baratas). */
export function invalidateTextContent() { clearTextMetrics(); contentCache.clear(); }
export function invalidateLayer(id: string) { procCache.delete(id); contentCache.delete(id); vectorCache.delete(id); adjCache.delete(id); }

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
  /** visor: durante un arrastre se aceptan vistas previas reducidas de los efectos pesados */
  allowDraft?: boolean;
  /** fondos de las mesas ya pintados debajo (las capas de ajuste del nivel superior los incluyen) */
  backgrounds?: BgRect[];
}

function drawLayer(g: CanvasRenderingContext2D, l: Layer, o: RenderOpts, all: Layer[], forceNormal = false) {
  if (l.kind === 'group') {
    const kids = childrenOf(all, l.id);
    // un grupo con capas de ajuste se compone aparte: sus ajustes solo afectan a lo que hay dentro
    const isolate = kids.some(k => k.kind === 'adjust');
    if (l.blend === 'source-over' && l.opacity >= 1 && !forceNormal && !isolate) { drawList(g, kids, o, all); return; }
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
  if (l.kind === 'adjust') return; // se dibujan en drawList (necesitan lo que hay debajo)
  if (o.only && !o.only.has(l.id)) return;
  const src = processedContent(l, !!o.bypassIds?.has(l.id), !!o.allowDraft);
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
const adjustActive = (l: Layer, o: RenderOpts) => l.kind === 'adjust' && visibleNow(l, o) && !o.bypassIds?.has(l.id) && !(o.only && !o.only.has(l.id)) && l.adjustments.some(a => a.enabled);

function drawList(g: CanvasRenderingContext2D, list: Layer[], o: RenderOpts, all: Layer[], bgs?: BgRect[]) {
  let i = 0;
  while (i < list.length) {
    const base = list[i];
    let j = i + 1;
    const clipped: Layer[] = [];
    while (j < list.length && list[j].clip) { if (visibleNow(list[j], o)) clipped.push(list[j]); j++; }
    if (!visibleNow(base, o)) { i = j; continue; }
    if (base.kind === 'adjust') {
      // capa de ajuste: actúa sobre todo lo que hay debajo en su nivel (o en su grupo)
      if (adjustActive(base, o)) drawAdjust(g, base, list.slice(0, i), list.slice(0, i), o, all, bgs ?? null, null);
      for (const c of clipped) drawLayer(g, c, o, all);
    } else if (!clipped.length) drawLayer(g, base, o, all);
    else {
      const group = borrow(o.width, o.height);
      const gg = ctx2d(group);
      drawLayer(gg, base, o, all, true);
      const alphaRef = borrow(o.width, o.height);
      ctx2d(alphaRef).drawImage(group, 0, 0);
      const plainBase = { ...base, clip: false, opacity: 1, blend: 'source-over' as const };
      for (let ci = 0; ci < clipped.length; ci++) {
        const c = clipped[ci];
        if (c.kind === 'adjust') {
          // capa de ajuste recortada: solo afecta a la capa base (y a lo recortado por debajo)
          if (adjustActive(c, o)) drawAdjust(gg, c, [plainBase, ...clipped.slice(0, ci)], [base, ...clipped.slice(0, ci)], o, all, null, alphaRef);
          continue;
        }
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

// ---------- capas de ajuste ----------
// Una capa de ajuste no tiene píxeles: su pila de ajustes y efectos se aplica a lo que hay debajo.
// Lo de debajo se compone en el espacio de la capa (resolución del documento), se procesa en el
// worker y el resultado se mezcla con la máscara y la opacidad:
//   resultado = debajo · (1 − m) + ajustado · m      (m = máscara × opacidad)
// Para que «debajo» sea exactamente lo ya dibujado, el nivel donde está la capa se compone aparte.
export interface BgRect { x: number; y: number; w: number; h: number; color: string }
interface AdjEntry { sig: string; result: HTMLCanvasElement | null; running: string | null; want: (() => void) | null; waiters: (() => void)[] }
const adjCache = new Map<string, AdjEntry>();
const ADJ_MAX_PIXELS = 16_000_000, ADJ_DRAFT_PIXELS = 700_000;
/** promesas de capas de ajuste pendientes durante un render para exportar (ver renderArtboard) */
let adjPending: Promise<void>[] | null = null;

function scopeSig(list: Layer[], o: RenderOpts, all: Layer[]): string {
  let s = '';
  for (const l of list) {
    if (!visibleNow(l, o)) { s += '-,'; continue; }
    if (l.kind === 'group') s += `g${oid(l)}(${scopeSig(childrenOf(all, l.id), o, all)}),`;
    else if (l.kind === 'adjust') s += `a${oid(l)}:${adjustActive(l, o) ? oid(adjCache.get(l.id)?.result) : 0},`;
    else if (o.only && !o.only.has(l.id)) s += 'o,';
    else s += `${oid(l)}:${oid(processedContent(l, !!o.bypassIds?.has(l.id)))},`;
  }
  return s;
}

/** Capa de ajuste lista para dibujar (en su espacio local) o null si aún no hay resultado. */
function adjustResult(adj: Layer, scope: Layer[], sigScope: Layer[], o: RenderOpts, all: Layer[], bgs: BgRect[] | null): HTMLCanvasElement | null {
  const { w, h } = layerSize(adj);
  if (w < 1 || h < 1) return null;
  const mtx = layerMatrix(adj);
  let k = Math.min(1, Math.sqrt(ADJ_MAX_PIXELS / (w * h)));
  const id = get().activeDocId;
  const liveNow = !!id && isLive(id);
  if (liveNow) k = Math.min(k, Math.sqrt(ADJ_DRAFT_PIXELS / (w * h)));
  const sig = [adjSig(adj), mtx.toString(), w, h, k.toFixed(4), bgs ? JSON.stringify(bgs) : '', scopeSig(sigScope, o, all)].join('|');
  let e = adjCache.get(adj.id);
  if (!e) { e = { sig: '', result: null, running: null, want: null, waiters: [] }; adjCache.set(adj.id, e); }
  if (e.sig === sig && e.result) return e.result;
  const entry = e;
  const start = () => {
    entry.running = sig;
    // lo de debajo, compuesto en el espacio local de la capa de ajuste
    const W = Math.max(1, Math.round(w * k)), H = Math.max(1, Math.round(h * k));
    const under = createCanvas(W, H);
    const ug = ctx2d(under);
    const base = new DOMMatrix().scaleSelf(W / w, H / h).multiplySelf(mtx.inverse());
    if (bgs) for (const b of bgs) { ug.save(); ug.setTransform(base.a, base.b, base.c, base.d, base.e, base.f); ug.fillStyle = b.color; ug.fillRect(b.x, b.y, b.w, b.h); ug.restore(); }
    drawList(ug, scope, { ...o, base, width: W, height: H, tiles: false, allowDraft: false, smoothing: true }, all);
    runOp('adjust', getImageData(under), { adjustments: stackOf(adj), scale: W / w }).then(r => {
      const c = createCanvas(W, H);
      ctx2d(c).putImageData(r.image!, 0, 0);
      entry.result = c; entry.sig = sig;
    }, err => { console.error('Capa de ajuste', err); entry.sig = sig; }).finally(() => {
      entry.running = null;
      const next = entry.want;
      entry.want = null;
      if (next) next();
      else { const ws = entry.waiters; entry.waiters = []; ws.forEach(f => f()); }
      bumpRender();
    });
  };
  if (!e.running) start();
  else if (e.running !== sig) e.want = start;
  if (adjPending) adjPending.push(new Promise<void>(res => entry.waiters.push(res)));
  return e.result;
}

const maskedCache = new WeakMap<HTMLCanvasElement, { mask: HTMLCanvasElement | null; out: HTMLCanvasElement }>();
function maskedResult(res: HTMLCanvasElement, maskA: HTMLCanvasElement | null) {
  if (!maskA) return res;
  const c = maskedCache.get(res);
  if (c && c.mask === maskA) return c.out;
  const out = cloneCanvas(res);
  const g = ctx2d(out);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(maskA, 0, 0, out.width, out.height);
  maskedCache.set(res, { mask: maskA, out });
  return out;
}

function drawAdjust(g: CanvasRenderingContext2D, adj: Layer, scope: Layer[], sigScope: Layer[], o: RenderOpts, all: Layer[], bgs: BgRect[] | null, clipRef: HTMLCanvasElement | null) {
  const res = adjustResult(adj, scope, sigScope, o, all, bgs);
  if (!res) return;
  const { w, h } = layerSize(adj);
  const maskA = adj.mask && adj.maskEnabled ? maskToAlpha(adj.mask) : null;
  const Am = maskedResult(res, maskA);
  const m = o.base.multiply(layerMatrix(adj));
  const normal = adj.blend === 'source-over';
  // dibuja `fn` en la transformación de la capa, recortado (si hace falta) a la capa base
  const paint = (mode: GlobalCompositeOperation, fn: (t: CanvasRenderingContext2D) => void) => {
    if (!clipRef) {
      g.save();
      g.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
      g.globalAlpha = adj.opacity;
      g.globalCompositeOperation = mode;
      g.imageSmoothingEnabled = true;
      fn(g);
      g.restore();
      return;
    }
    const tmp = borrow(o.width, o.height);
    const tg = ctx2d(tmp);
    tg.save(); tg.setTransform(m.a, m.b, m.c, m.d, m.e, m.f); fn(tg); tg.restore();
    tg.globalCompositeOperation = 'destination-in';
    tg.drawImage(clipRef, 0, 0);
    tg.globalCompositeOperation = 'source-over';
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = adj.opacity;
    g.globalCompositeOperation = mode;
    g.drawImage(tmp, 0, 0);
    g.restore();
    giveBack(tmp);
  };
  if (normal) {
    paint('destination-out', t => { if (maskA) t.drawImage(maskA, 0, 0, w, h); else { t.fillStyle = '#fff'; t.fillRect(0, 0, w, h); } });
    paint('lighter', t => t.drawImage(Am, 0, 0, w, h));
  } else paint(adj.blend, t => t.drawImage(Am, 0, 0, w, h));
}

export function renderLayers(g: CanvasRenderingContext2D, state: Pick<DocState, 'layers'>, o: RenderOpts) {
  const top = childrenOf(state.layers, null);
  if (!top.some(l => adjustActive(l, o))) { drawList(g, top, o, state.layers); return; }
  // hay capas de ajuste en el nivel superior: se compone aparte, con los fondos de las mesas
  const iso = borrow(o.width, o.height);
  const ig = ctx2d(iso);
  const bgs = o.backgrounds ?? [];
  for (const b of bgs) { ig.save(); ig.setTransform(o.base.a, o.base.b, o.base.c, o.base.d, o.base.e, o.base.f); ig.fillStyle = b.color; ig.fillRect(b.x, b.y, b.w, b.h); ig.restore(); }
  drawList(ig, top, o, state.layers, bgs);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(iso, 0, 0);
  g.restore();
  giveBack(iso);
}

/** Compone las capas con la matriz `base` (mundo → píxeles) en un canvas nuevo de w×h. Las capas de
 *  ajuste se calculan en el worker: se repite el render hasta que todas están al día (varias pasadas
 *  si hay capas de ajuste encima de otras). */
async function renderWith(state: DocState, base: DOMMatrix, w: number, h: number, extra: Partial<RenderOpts>, fill: (g: CanvasRenderingContext2D) => void) {
  await ensureProcessed(state.layers);
  const c = createCanvas(w, h);
  const g = ctx2d(c);
  const ro: RenderOpts = { base, width: w, height: h, smoothing: true, ...extra };
  for (let pass = 0; pass < 8; pass++) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, w, h);
    fill(g);
    adjPending = [];
    renderLayers(g, state, ro);
    const wait = adjPending;
    adjPending = null;
    if (!wait.length) break;
    await Promise.all(wait);
  }
  return c;
}

/** Renderiza una mesa de trabajo a un canvas nuevo con la escala indicada. */
export async function renderArtboard(state: DocState, ab: Artboard, scale = 1, opts: { background?: boolean; only?: Set<string> | null; hidden?: Set<string> | null } = {}) {
  const w = Math.max(1, Math.round(ab.w * scale)), h = Math.max(1, Math.round(ab.h * scale));
  const bg = opts.background !== false && ab.background ? ab.background : null;
  const base = new DOMMatrix().scaleSelf(scale, scale).translateSelf(-ab.x, -ab.y);
  return renderWith(state, base, w, h, { only: opts.only ?? null, hidden: opts.hidden ?? null, backgrounds: bg ? [{ x: ab.x, y: ab.y, w: ab.w, h: ab.h, color: bg }] : [] },
    g => { if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); } });
}

/** Lo que se ve en la zona de una capa, en su espacio local (w×h de la capa), sin las capas de
 *  `hidden`. Incluye los fondos de las mesas. */
export async function renderInLayerSpace(state: DocState, l: Layer, hidden: Set<string>) {
  const { w, h } = layerSize(l);
  const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
  const base = new DOMMatrix().scaleSelf(W / w, H / h).multiplySelf(layerMatrix(l).inverse());
  const bgs = state.artboards.filter(a => a.background).map(a => ({ x: a.x, y: a.y, w: a.w, h: a.h, color: a.background! }));
  return renderWith(state, base, W, H, { hidden, backgrounds: bgs }, g => {
    for (const b of bgs) { g.save(); g.setTransform(base.a, base.b, base.c, base.d, base.e, base.f); g.fillStyle = b.color; g.fillRect(b.x, b.y, b.w, b.h); g.restore(); }
  });
}

/** Renderiza una capa individual (con su transformación) recortada a su caja. */
export async function renderLayerAlone(state: DocState, l: Layer, scale = 1) {
  const { layerBounds } = await import('./util');
  const b = layerBounds(l);
  const ab: Artboard = { id: 'tmp', name: '', x: b.x, y: b.y, w: b.w, h: b.h, dpi: 300, background: null, margin: 0 };
  const ids = new Set([l.id, ...descendants(state.layers, l.id).map(x => x.id)]);
  return { canvas: await renderArtboard(state, ab, scale, { only: ids }), bounds: b };
}
