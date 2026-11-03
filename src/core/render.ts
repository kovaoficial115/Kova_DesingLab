// Renderizador de escena: compone capas (con grupos, máscaras, recortes, modos de fusión y
// ajustes no destructivos) sobre cualquier contexto 2D. Lo usan el visor y la exportación.

import type { Artboard, DocState, Layer } from './types';
import { createCanvas, ctx2d, layerMatrix, layerSize, textFont, getImageData } from './util';
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
  const { w, h } = layerSize(l);
  const c = createCanvas(w, h);
  const g = ctx2d(c);
  g.font = textFont(t);
  (g as any).letterSpacing = `${t.letterSpacing}px`;
  g.textBaseline = 'top';
  g.textAlign = t.align;
  const pad = t.strokeWidth + 2;
  const x = t.align === 'left' ? pad : t.align === 'center' ? w / 2 : w - pad;
  t.text.split('\n').forEach((ln, i) => {
    const y = pad + i * t.fontSize * t.lineHeight + (t.fontSize * (t.lineHeight - 1)) / 2;
    if (t.strokeWidth > 0) {
      g.lineJoin = 'round';
      g.strokeStyle = t.strokeColor;
      g.lineWidth = t.strokeWidth * 2;
      g.strokeText(ln, x, y);
    }
    g.fillStyle = t.color;
    g.fillText(ln, x, y);
  });
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
export function invalidateTextContent() { contentCache.clear(); }
export function invalidateLayer(id: string) { procCache.delete(id); contentCache.delete(id); vectorCache.delete(id); }

// ---------- composición ----------
const pool: HTMLCanvasElement[] = [];
function borrow(w: number, h: number) {
  const c = pool.pop() ?? document.createElement('canvas');
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } else ctx2d(c).clearRect(0, 0, w, h);
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
  g.drawImage(src, 0, 0, w, h);
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
