// Operaciones de documento: capas, selección, transformaciones, mesas de trabajo y
// operaciones de píxeles (vía worker). Todas pasan por el historial.

import type { Adjustment, AdjustmentType, Artboard, Doc, DocState, Layer, Selection } from './types';
import {
  get, set, commit, silent, activeDoc, docState, activeLayer, selectedLayers, activeArtboard, toast, withBusy, setView, bumpRender,
} from './store';
import {
  uid, createCanvas, ctx2d, cloneCanvas, layerSize, layerMatrix, layerBounds, layerPivot, placeAtPivot, unionRect, getImageData, canvasFromImageData,
  resampleCanvas, rectsIntersect, type Rect, pointInLayer, hexToRgb, trimCanvas, fmtUnit,
} from './util';
import { rasterLayer, groupLayer, newDoc, fitIn, descendants, isEffectivelyLocked, isEffectivelyVisible, childrenOf } from './doc';
import { bakedLayerCanvas, renderArtboard, renderLayerAlone, invalidateLayer, ensureProcessed, processedContent } from './render';
import { runOp } from '../engine/workerClient';
import { magicWand, colorRange } from '../engine/alpha';
import { blurFloat } from '../engine/pixels';

// ---------- documentos ----------
export function addDoc(doc: Doc, fit = true) {
  set(s => ({ docs: [...s.docs, doc], activeDocId: doc.id, screen: 'editor' }));
  if (fit) requestAnimationFrame(() => fitToScreen());
}
export function closeDoc(id: string) {
  set(s => {
    const docs = s.docs.filter(d => d.id !== id);
    const activeDocId = s.activeDocId === id ? docs[docs.length - 1]?.id ?? null : s.activeDocId;
    return { docs, activeDocId, screen: docs.length ? s.screen : 'home' };
  });
}
export function duplicateDoc() {
  const d = activeDoc();
  if (!d) return;
  const copy: Doc = { ...d, id: uid('doc'), name: d.name + ' copia', past: [], future: [], fileHandle: undefined, dirty: true, createdAt: Date.now() };
  addDoc(copy);
}
export function renameDoc(name: string) {
  const d = activeDoc();
  if (!d) return;
  set(s => ({ docs: s.docs.map(x => (x.id === d.id ? { ...x, name } : x)) }));
}

export function fitToScreen(target?: Rect) {
  const s = docState();
  const el = document.getElementById('kova-viewport');
  if (!s || !el) return;
  const r = target ?? (activeArtboard() as Rect | null) ?? unionRect(s.artboards);
  if (!r) return;
  const W = el.clientWidth, H = el.clientHeight;
  const zoom = Math.min((W - 80) / r.w, (H - 80) / r.h);
  setView({ zoom, panX: W / 2 - (r.x + r.w / 2) * zoom, panY: H / 2 - (r.y + r.h / 2) * zoom, autoFit: !target });
}
export function zoomTo(zoom: number, cx?: number, cy?: number) {
  const el = document.getElementById('kova-viewport');
  const d = activeDoc();
  if (!el || !d) return;
  const v = get().views[d.id] || { zoom: 1, panX: 0, panY: 0 };
  zoom = Math.min(64, Math.max(0.01, zoom));
  const px = cx ?? el.clientWidth / 2, py = cy ?? el.clientHeight / 2;
  const wx = (px - v.panX) / v.zoom, wy = (py - v.panY) / v.zoom;
  setView({ zoom, panX: px - wx * zoom, panY: py - wy * zoom });
}

// ---------- utilidades de estado ----------
const mapLayers = (s: DocState, fn: (l: Layer) => Layer): DocState => ({ ...s, layers: s.layers.map(fn) });

export function updateLayer(id: string, patch: Partial<Layer> | ((l: Layer) => Partial<Layer>), label = 'Modificar capa') {
  commit(label, s => mapLayers(s, l => (l.id === id ? { ...l, ...(typeof patch === 'function' ? patch(l) : patch) } : l)));
}
export function updateLayers(ids: string[], fn: (l: Layer) => Partial<Layer>, label: string) {
  commit(label, s => mapLayers(s, l => (ids.includes(l.id) ? { ...l, ...fn(l) } : l)));
}
export function selectLayers(ids: string[]) {
  silent(s => ({ ...s, selectedLayerIds: ids }));
}
export function toggleSelectLayer(id: string, additive: boolean, range = false) {
  const s = docState();
  if (!s) return;
  if (range && s.selectedLayerIds.length) {
    const order = s.layers.map(l => l.id);
    const a = order.indexOf(s.selectedLayerIds[s.selectedLayerIds.length - 1]), b = order.indexOf(id);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    selectLayers(order.slice(lo, hi + 1));
    return;
  }
  if (!additive) return selectLayers([id]);
  selectLayers(s.selectedLayerIds.includes(id) ? s.selectedLayerIds.filter(x => x !== id) : [...s.selectedLayerIds, id]);
}

/** Inserta capas encima de la capa activa (o arriba del todo). */
export function insertLayers(newLayers: Layer[], label = 'Nueva capa') {
  commit(label, s => {
    const act = s.layers.find(l => l.id === s.selectedLayerIds[s.selectedLayerIds.length - 1]);
    const layers = [...s.layers];
    let idx = layers.length;
    let parentId: string | null = null;
    if (act) {
      if (act.kind === 'group' && !act.collapsed) { parentId = act.id; idx = layers.length; }
      else { parentId = act.parentId; idx = layers.indexOf(act) + 1; }
    }
    const withParent = newLayers.map(l => ({ ...l, parentId: l.parentId ?? parentId }));
    layers.splice(idx, 0, ...withParent);
    return { ...s, layers, selectedLayerIds: [withParent[withParent.length - 1].id] };
  });
}

export function addImageLayer(canvas: HTMLCanvasElement, name: string, opts: { fit?: boolean; at?: { x: number; y: number } } = {}) {
  const ab = activeArtboard();
  let l = rasterLayer(canvas, name);
  if (opts.at) l = { ...l, x: opts.at.x, y: opts.at.y };
  else if (ab) l = opts.fit === false ? { ...l, x: ab.x + (ab.w - canvas.width) / 2, y: ab.y + (ab.h - canvas.height) / 2 } : fitIn(l, ab);
  insertLayers([l], 'Importar imagen');
  return l;
}

export function newEmptyLayer() {
  const ab = activeArtboard();
  if (!ab) return;
  const l = rasterLayer(createCanvas(ab.w, ab.h), nextName('Capa'), ab.x, ab.y);
  insertLayers([l]);
}
function nextName(base: string) {
  const s = docState();
  const n = (s?.layers.filter(l => l.name.startsWith(base)).length ?? 0) + 1;
  return `${base} ${n}`;
}

export function deleteSelectedLayers() {
  const s = docState();
  if (!s || !s.selectedLayerIds.length) return;
  const kill = new Set<string>();
  for (const id of s.selectedLayerIds) { kill.add(id); descendants(s.layers, id).forEach(d => kill.add(d.id)); }
  commit('Eliminar capa', st => {
    const layers = st.layers.filter(l => !kill.has(l.id));
    return { ...st, layers, selectedLayerIds: layers.length ? [layers[layers.length - 1].id] : [] };
  });
}

function cloneLayerDeep(l: Layer, all: Layer[], parentId: string | null): Layer[] {
  const copy: Layer = { ...l, id: uid('ly'), name: l.name + ' copia', parentId };
  const out = [copy];
  if (l.kind === 'group') for (const c of childrenOf(all, l.id)) out.push(...cloneLayerDeep({ ...c, name: c.name.replace(/ copia$/, '') }, all, copy.id));
  return out.map(x => (x === copy ? x : { ...x, name: x.name.replace(/ copia$/, '') }));
}
export function duplicateSelectedLayers() {
  const s = docState();
  if (!s) return;
  const sel = s.layers.filter(l => s.selectedLayerIds.includes(l.id));
  if (!sel.length) return;
  commit('Duplicar capa', st => {
    const layers = [...st.layers];
    const newIds: string[] = [];
    for (const l of sel) {
      const copies = cloneLayerDeep(l, st.layers, l.parentId);
      const idx = layers.indexOf(layers.find(x => x.id === l.id)!) + 1;
      layers.splice(idx, 0, ...copies);
      newIds.push(copies[0].id);
    }
    return { ...st, layers, selectedLayerIds: newIds };
  });
}

export function groupSelected() {
  const s = docState();
  if (!s || !s.selectedLayerIds.length) return;
  const sel = s.layers.filter(l => s.selectedLayerIds.includes(l.id));
  const top = sel[sel.length - 1];
  const g = { ...groupLayer(nextName('Grupo')), parentId: top.parentId };
  commit('Agrupar capas', st => {
    const layers = st.layers.map(l => (s.selectedLayerIds.includes(l.id) ? { ...l, parentId: g.id } : l));
    const idx = layers.findIndex(l => l.id === top.id) + 1;
    layers.splice(idx, 0, g);
    return { ...st, layers, selectedLayerIds: [g.id] };
  });
}
export function ungroupSelected() {
  const l = activeLayer();
  if (!l || l.kind !== 'group') return;
  commit('Desagrupar', st => ({
    ...st,
    layers: st.layers.filter(x => x.id !== l.id).map(x => (x.parentId === l.id ? { ...x, parentId: l.parentId } : x)),
    selectedLayerIds: st.layers.filter(x => x.parentId === l.id).map(x => x.id),
  }));
}

/** Mueve una capa respecto a otra en el árbol. */
export function moveLayer(id: string, targetId: string, pos: 'above' | 'below' | 'inside') {
  if (id === targetId) return;
  const s = docState();
  if (!s) return;
  if (descendants(s.layers, id).some(d => d.id === targetId)) return;
  commit('Reordenar capas', st => {
    const layers = [...st.layers];
    const from = layers.findIndex(l => l.id === id);
    const [l] = layers.splice(from, 1);
    const target = layers.find(x => x.id === targetId)!;
    const ti = layers.indexOf(target);
    if (pos === 'inside') layers.push({ ...l, parentId: target.id, clip: false });
    else layers.splice(pos === 'above' ? ti + 1 : ti, 0, { ...l, parentId: target.parentId });
    return { ...st, layers };
  });
}
/** Sube/baja la capa activa dentro de sus hermanas. */
export function nudgeLayerOrder(dir: 1 | -1 | 'top' | 'bottom') {
  const l = activeLayer();
  const s = docState();
  if (!l || !s) return;
  const sibs = childrenOf(s.layers, l.parentId);
  const i = sibs.findIndex(x => x.id === l.id);
  let t: Layer | undefined;
  if (dir === 'top') t = sibs[sibs.length - 1];
  else if (dir === 'bottom') t = sibs[0];
  else t = sibs[i + dir];
  if (!t || t.id === l.id) return;
  moveLayer(l.id, t.id, dir === 1 || dir === 'top' ? 'above' : 'below');
}

export function toggleClip() {
  const ls = selectedLayers();
  if (!ls.length) return;
  updateLayers(ls.map(l => l.id), l => ({ clip: !l.clip }), 'Máscara de recorte');
}

// ---------- rasterizar / combinar ----------
/** Convierte la capa en raster con ajustes y máscara horneados, a la escala actual. */
export async function rasterizeLayer(id: string, opts: { bakeScale?: boolean } = {}) {
  const s = docState();
  const l = s?.layers.find(x => x.id === id);
  if (!s || !l || l.kind === 'group') return null;
  const baked = await bakedLayerCanvas(l);
  if (!baked) return null;
  const { w, h } = layerSize(l);
  let canvas = cloneCanvas(baked, w, h);
  let patch: Partial<Layer> = {};
  if (opts.bakeScale || l.kind === 'vector') {
    const nw = Math.max(1, Math.round(w * Math.abs(l.scaleX))), nh = Math.max(1, Math.round(h * Math.abs(l.scaleY)));
    canvas = l.kind === 'vector' ? cloneCanvas(baked, nw, nh) : resampleCanvas(canvas, nw, nh);
    patch = { scaleX: Math.sign(l.scaleX), scaleY: Math.sign(l.scaleY) };
  }
  const next: Partial<Layer> = {
    ...patch, kind: 'raster', canvas, origin: canvas, adjustments: [], mask: null, text: undefined, shape: undefined, vector: undefined,
  };
  invalidateLayer(id);
  updateLayer(id, next, 'Rasterizar capa');
  return canvas;
}

async function flattenToLayer(state: DocState, ids: Set<string>, name: string): Promise<Layer | null> {
  const ls = state.layers.filter(l => ids.has(l.id) && l.kind !== 'group' && isEffectivelyVisible(state.layers, l));
  const b = unionRect(ls.map(layerBounds));
  if (!b) return null;
  const x = Math.floor(b.x), y = Math.floor(b.y);
  const ab: Artboard = { id: 'tmp', name: '', x, y, w: Math.ceil(b.x + b.w) - x, h: Math.ceil(b.y + b.h) - y, dpi: 300, background: null, margin: 0 };
  const canvas = await renderArtboard(state, ab, 1, { only: ids });
  return rasterLayer(canvas, name, x, y);
}

export async function mergeDown() {
  const s = docState();
  const l = activeLayer();
  if (!s || !l) return;
  const sibs = childrenOf(s.layers, l.parentId);
  const below = sibs[sibs.findIndex(x => x.id === l.id) - 1];
  if (!below) return toast('No hay capa inferior para combinar', 'warn');
  const ids = new Set([l.id, below.id, ...descendants(s.layers, l.id).map(x => x.id), ...descendants(s.layers, below.id).map(x => x.id)]);
  const merged = await flattenToLayer(s, ids, below.name);
  if (!merged) return;
  commit('Combinar hacia abajo', st => {
    const layers = st.layers.filter(x => !ids.has(x.id) || x.id === below.id).map(x => (x.id === below.id ? { ...merged, id: below.id, parentId: below.parentId } : x));
    return { ...st, layers, selectedLayerIds: [below.id] };
  });
}
export async function mergeSelected() {
  const s = docState();
  if (!s || s.selectedLayerIds.length < 2) return mergeDown();
  const ids = new Set<string>();
  s.selectedLayerIds.forEach(id => { ids.add(id); descendants(s.layers, id).forEach(d => ids.add(d.id)); });
  const merged = await flattenToLayer(s, ids, 'Combinada');
  if (!merged) return;
  const topId = s.layers.filter(l => ids.has(l.id)).pop()!.id;
  commit('Combinar capas', st => {
    const layers: Layer[] = [];
    for (const x of st.layers) {
      if (x.id === topId) layers.push({ ...merged, parentId: x.parentId });
      else if (!ids.has(x.id)) layers.push(x);
    }
    return { ...st, layers, selectedLayerIds: [merged.id] };
  });
}
export async function flattenImage() {
  const s = docState();
  const ab = activeArtboard();
  if (!s || !ab) return;
  const canvas = await renderArtboard(s, ab, 1, { background: false });
  const l = rasterLayer(canvas, 'Fondo', ab.x, ab.y);
  commit('Acoplar imagen', st => ({ ...st, layers: [l], selectedLayerIds: [l.id] }));
}

// ---------- ajustes no destructivos ----------
export const adjustmentDefaults: Record<AdjustmentType, { label: string; params: any }> = {
  brightnessContrast: { label: 'Brillo/Contraste', params: { brightness: 0, contrast: 0 } },
  hueSaturation: { label: 'Tono/Saturación', params: { hue: 0, saturation: 0, lightness: 0, colorize: false } },
  colorize: { label: 'Colorear', params: { color: '#d21625', mode: 'tint', amount: 100 } },
  gradientMap: { label: 'Mapa de degradado', params: { dark: '#1b1464', light: '#ffd23f', amount: 100 } },
  exposure: { label: 'Exposición', params: { exposure: 0, offset: 0, gamma: 1 } },
  levels: { label: 'Niveles', params: { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255, channel: 'rgb' } },
  curves: { label: 'Curvas', params: { rgb: [[0, 0], [64, 64], [192, 192], [255, 255]] } },
  vibrance: { label: 'Intensidad', params: { vibrance: 0, saturation: 0 } },
  blackWhite: { label: 'Blanco y negro', params: { r: 0.299, g: 0.587, b: 0.114 } },
  invert: { label: 'Invertir', params: {} },
  threshold: { label: 'Umbral', params: { level: 128 } },
  posterize: { label: 'Posterizar', params: { levels: 4 } },
  blur: { label: 'Desenfoque gaussiano', params: { radius: 4 } },
  sharpen: { label: 'Enfocar (máscara de enfoque)', params: { amount: 80, radius: 2, threshold: 2 } },
  denoise: { label: 'Reducir ruido', params: { radius: 1, strength: 100 } },
};

async function ensureEditableForAdjust(l: Layer): Promise<Layer | null> {
  if (l.kind === 'group') { toast('Selecciona una capa (no un grupo) para aplicar ajustes', 'warn'); return null; }
  return l;
}
export async function addAdjustment(type: AdjustmentType) {
  const l = activeLayer();
  if (!l) return toast('Selecciona una capa', 'warn');
  if (!(await ensureEditableForAdjust(l))) return;
  const adj: Adjustment = { id: uid('adj'), type, enabled: true, params: structuredClone(adjustmentDefaults[type].params) };
  updateLayer(l.id, x => ({ adjustments: [...x.adjustments, adj] }), adjustmentDefaults[type].label);
  set(s => ({ panels: s.panels.map(p => (p.id === 'adjustments' ? { ...p, visible: true, collapsed: false } : p)) }));
  return adj;
}
export function updateAdjustment(layerId: string, adjId: string, params: any, isLive = false) {
  const fn = (s: DocState) => mapLayers(s, l => (l.id === layerId ? { ...l, adjustments: l.adjustments.map(a => (a.id === adjId ? { ...a, params: { ...a.params, ...params } } : a)) } : l));
  if (isLive) import('./store').then(m => m.live(fn));
  else commit('Editar ajuste', fn);
}
export function toggleAdjustment(layerId: string, adjId: string) {
  updateLayer(layerId, l => ({ adjustments: l.adjustments.map(a => (a.id === adjId ? { ...a, enabled: !a.enabled } : a)) }), 'Activar/desactivar ajuste');
}
export function removeAdjustment(layerId: string, adjId: string) {
  updateLayer(layerId, l => ({ adjustments: l.adjustments.filter(a => a.id !== adjId) }), 'Eliminar ajuste');
}
export async function applyAdjustments() {
  const l = activeLayer();
  if (!l) return;
  await withBusy('Aplicando ajustes…', async () => { await rasterizeLayer(l.id); });
}

// ---------- operaciones de píxeles con selección ----------
/** Selección proyectada al espacio local de una capa (alpha = seleccionado). */
export function selectionInLayer(sel: Selection, l: Layer): HTMLCanvasElement {
  const { w, h } = layerSize(l);
  const c = createCanvas(w, h);
  const g = ctx2d(c);
  const inv = layerMatrix(l).inverse();
  g.setTransform(inv.a, inv.b, inv.c, inv.d, inv.e, inv.f);
  g.drawImage(sel.canvas, sel.x, sel.y);
  return c;
}

/** Asegura que la capa sea raster editable (rasteriza texto/forma/vector). */
export async function ensureRaster(l: Layer): Promise<Layer | null> {
  if (isEffectivelyLocked(docState()!.layers, l)) { toast('La capa está bloqueada', 'warn'); return null; }
  if (l.kind === 'group') { toast('Selecciona una capa de píxeles', 'warn'); return null; }
  if (l.kind !== 'raster') {
    toast('Capa rasterizada para editar sus píxeles', 'info');
    await rasterizeLayer(l.id);
    return docState()!.layers.find(x => x.id === l.id) ?? null;
  }
  return l;
}

export function blendBySelection(orig: ImageData, result: ImageData, selMask: HTMLCanvasElement) {
  const sm = getImageData(selMask).data;
  const o = orig.data, r = result.data;
  for (let i = 0; i < o.length; i += 4) {
    const t = sm[i + 3] / 255;
    if (t >= 1) continue;
    for (let c = 0; c < 4; c++) r[i + c] = o[i + c] + (r[i + c] - o[i + c]) * t;
  }
  return result;
}

/** Ejecuta una operación del worker sobre la capa activa (respetando la selección). */
export async function applyPixelOp(op: string, params: any, label: string, layerId?: string) {
  const s = docState();
  let l = layerId ? s?.layers.find(x => x.id === layerId) ?? null : activeLayer();
  if (!s || !l) { toast('Selecciona una capa', 'warn'); return; }
  l = await ensureRaster(l);
  if (!l) return;
  await withBusy(label + '…', async () => {
    const img = getImageData(l!.canvas!);
    const { image } = await runOp(op, img, params);
    if (!image) return;
    const sel = docState()!.selection;
    const out = sel ? blendBySelection(img, image, selectionInLayer(sel, l!)) : image;
    const canvas = canvasFromImageData(out);
    updateLayer(l!.id, { canvas }, label);
  });
}

/** Reemplaza el canvas de una capa raster con historial. */
export function setLayerCanvas(id: string, canvas: HTMLCanvasElement, label: string, extra: Partial<Layer> = {}) {
  updateLayer(id, { canvas, ...extra }, label);
}

// ---------- selección ----------
export function selectionBoundsRect(): Rect | null {
  const sel = docState()?.selection;
  return sel ? { x: sel.x, y: sel.y, w: sel.canvas.width, h: sel.canvas.height } : null;
}

export function combineSelection(a: Selection | null, b: Selection, mode: 'new' | 'add' | 'subtract' | 'intersect'): Selection | null {
  if (mode === 'new' || !a) return mode === 'subtract' ? a : b;
  const r = mode === 'intersect'
    ? { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), w: 0, h: 0 }
    : unionRect([{ x: a.x, y: a.y, w: a.canvas.width, h: a.canvas.height }, { x: b.x, y: b.y, w: b.canvas.width, h: b.canvas.height }])!;
  if (mode === 'intersect') {
    r.w = Math.min(a.x + a.canvas.width, b.x + b.canvas.width) - r.x;
    r.h = Math.min(a.y + a.canvas.height, b.y + b.canvas.height) - r.y;
    if (r.w <= 0 || r.h <= 0) return null;
  }
  const c = createCanvas(r.w, r.h);
  const g = ctx2d(c);
  g.drawImage(a.canvas, a.x - r.x, a.y - r.y);
  g.globalCompositeOperation = mode === 'add' ? 'source-over' : mode === 'subtract' ? 'destination-out' : 'destination-in';
  g.drawImage(b.canvas, b.x - r.x, b.y - r.y);
  return { x: r.x, y: r.y, canvas: c, shape: null };
}

export function featherCanvas(c: HTMLCanvasElement, radius: number) {
  if (radius <= 0) return c;
  const pad = Math.ceil(radius * 2);
  const out = createCanvas(c.width + pad * 2, c.height + pad * 2);
  ctx2d(out).drawImage(c, pad, pad);
  const img = getImageData(out);
  const a = new Float32Array(out.width * out.height);
  for (let j = 0; j < a.length; j++) a[j] = img.data[j * 4 + 3];
  blurFloat(a, out.width, out.height, radius);
  for (let j = 0; j < a.length; j++) { img.data[j * 4] = img.data[j * 4 + 1] = img.data[j * 4 + 2] = 255; img.data[j * 4 + 3] = a[j]; }
  ctx2d(out).putImageData(img, 0, 0);
  return { canvas: out, pad };
}

export function setSelection(sel: Selection | null, label = 'Selección', mode = get().opts.selMode) {
  let next = sel;
  const feather = get().opts.feather;
  if (sel && feather > 0) {
    const f = featherCanvas(sel.canvas, feather) as { canvas: HTMLCanvasElement; pad: number };
    next = { x: sel.x - f.pad, y: sel.y - f.pad, canvas: f.canvas, shape: null };
  }
  commit(label, s => ({ ...s, selection: next ? combineSelection(s.selection, next, mode) : null }));
}

export function shapeSelection(type: 'rect' | 'ellipse', r: Rect): Selection {
  const x = Math.round(r.x), y = Math.round(r.y), w = Math.max(1, Math.round(r.w)), h = Math.max(1, Math.round(r.h));
  const c = createCanvas(w, h);
  const g = ctx2d(c);
  g.fillStyle = '#fff';
  if (type === 'rect') g.fillRect(0, 0, w, h);
  else { g.beginPath(); g.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); g.fill(); }
  return { x, y, canvas: c, shape: { type, x, y, w, h } };
}
export function polygonSelection(pts: { x: number; y: number }[]): Selection | null {
  if (pts.length < 3) return null;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x = Math.floor(Math.min(...xs)), y = Math.floor(Math.min(...ys));
  const w = Math.ceil(Math.max(...xs)) - x, h = Math.ceil(Math.max(...ys)) - y;
  if (w < 1 || h < 1) return null;
  const c = createCanvas(w, h);
  const g = ctx2d(c);
  g.fillStyle = '#fff';
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(p.x - x, p.y - y) : g.moveTo(p.x - x, p.y - y)));
  g.closePath();
  g.fill();
  return { x, y, canvas: c, shape: null };
}

export function selectAll() {
  const ab = activeArtboard();
  if (ab) setSelection(shapeSelection('rect', ab), 'Seleccionar todo', 'new');
}
export function deselect() {
  if (docState()?.selection) commit('Deseleccionar', s => ({ ...s, selection: null }));
}
export function invertSelection() {
  const s = docState();
  const ab = activeArtboard();
  if (!s || !ab) return;
  const full = shapeSelection('rect', unionRect([ab, ...(s.selection ? [selectionBoundsRect()!] : [])])!);
  if (!s.selection) return setSelection(full, 'Invertir selección', 'new');
  const g = ctx2d(full.canvas);
  g.globalCompositeOperation = 'destination-out';
  g.drawImage(s.selection.canvas, s.selection.x - full.x, s.selection.y - full.y);
  commit('Invertir selección', st => ({ ...st, selection: { ...full, shape: null } }));
}
export function modifySelection(kind: 'feather' | 'expand' | 'contract' | 'smooth', amount: number) {
  const s = docState();
  if (!s?.selection) return toast('No hay selección activa', 'warn');
  const sel = s.selection;
  const pad = Math.ceil(amount * 2) + 2;
  const c = createCanvas(sel.canvas.width + pad * 2, sel.canvas.height + pad * 2);
  ctx2d(c).drawImage(sel.canvas, pad, pad);
  const img = getImageData(c);
  const op = kind === 'feather' ? 'feather' : kind === 'smooth' ? 'refine' : 'morph';
  const params = kind === 'feather' ? { r: amount } : kind === 'smooth'
    ? { smooth: amount, contract: 0, feather: 0, cleanLow: 0, cleanHigh: 255, decontaminate: false, matte: [0, 0, 0] }
    : { r: kind === 'expand' ? amount : -amount };
  return withBusy('Modificando selección…', async () => {
    const { image } = await runOp(op, img, params);
    const out = canvasFromImageData(image!);
    commit('Modificar selección', st => ({ ...st, selection: { x: sel.x - pad, y: sel.y - pad, canvas: out, shape: null } }));
  });
}

/** Varita mágica: devuelve la máscara en coordenadas de mundo. */
export async function wandSelect(wx: number, wy: number) {
  const s = docState();
  const ab = activeArtboard();
  const { wandTolerance, wandContiguous, wandSampleAll } = get().opts;
  if (!s || !ab) return;
  const l = activeLayer();
  if (wandSampleAll || !l || l.kind === 'group') {
    const comp = await renderArtboard(s, ab, 1, { background: false });
    const mask = magicWand(getImageData(comp), wx - ab.x, wy - ab.y, { tolerance: wandTolerance, contiguous: wandContiguous, useAlpha: true });
    setSelection({ x: ab.x, y: ab.y, canvas: maskCanvas(mask, ab.w, ab.h), shape: null }, 'Varita mágica');
    return;
  }
  const src = processedContent(l);
  if (!src) return;
  const p = layerMatrix(l).inverse().transformPoint(new DOMPoint(wx, wy));
  const local = maskCanvas(magicWand(getImageData(src), p.x, p.y, { tolerance: wandTolerance, contiguous: wandContiguous, useAlpha: true }), src.width, src.height);
  setSelection(localMaskToWorld(local, l), 'Varita mágica');
}
export function selectColorRange(color: string, fuzz: number) {
  const s = docState();
  const l = activeLayer();
  if (!s || !l) return;
  const src = processedContent(l);
  if (!src) return;
  const mask = colorRange(getImageData(src), hexToRgb(color), fuzz);
  setSelection(localMaskToWorld(maskCanvas(mask, src.width, src.height), l), 'Gama de colores', 'new');
}
/** Selecciona el contenido opaco de una capa (Ctrl+clic en la miniatura). */
export function selectLayerAlpha(id: string) {
  const l = docState()?.layers.find(x => x.id === id);
  if (!l) return;
  const src = processedContent(l);
  if (!src) return;
  setSelection(localMaskToWorld(src, l), 'Cargar selección', 'new');
}
export function maskCanvas(mask: Uint8ClampedArray, w: number, h: number) {
  const img = new ImageData(w, h);
  for (let j = 0; j < mask.length; j++) { img.data[j * 4] = img.data[j * 4 + 1] = img.data[j * 4 + 2] = 255; img.data[j * 4 + 3] = mask[j]; }
  return canvasFromImageData(img);
}
export function localMaskToWorld(local: HTMLCanvasElement, l: Layer): Selection {
  const b = layerBounds(l);
  const x = Math.floor(b.x), y = Math.floor(b.y);
  const c = createCanvas(Math.ceil(b.x + b.w) - x, Math.ceil(b.y + b.h) - y);
  const g = ctx2d(c);
  const m = new DOMMatrix().translateSelf(-x, -y).multiply(layerMatrix(l));
  g.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
  const { w, h } = layerSize(l);
  g.drawImage(local, 0, 0, w, h);
  return { x, y, canvas: c, shape: null };
}

export async function deleteSelectionPixels() {
  const s = docState();
  const l = activeLayer();
  if (!s?.selection) return deleteSelectedLayers();
  if (!l) return;
  const r = await ensureRaster(l);
  if (!r) return;
  const c = cloneCanvas(r.canvas!);
  const g = ctx2d(c);
  g.globalCompositeOperation = 'destination-out';
  g.drawImage(selectionInLayer(docState()!.selection!, r), 0, 0);
  setLayerCanvas(r.id, c, 'Borrar selección');
}
export async function fillSelection(color: string) {
  const s = docState();
  const l = activeLayer();
  if (!s || !l) return;
  const r = await ensureRaster(l);
  if (!r) return;
  const c = cloneCanvas(r.canvas!);
  const g = ctx2d(c);
  if (s.selection) {
    const m = selectionInLayer(s.selection, r);
    const tmp = createCanvas(c.width, c.height);
    const tg = ctx2d(tmp);
    tg.fillStyle = color; tg.fillRect(0, 0, c.width, c.height);
    tg.globalCompositeOperation = 'destination-in';
    tg.drawImage(m, 0, 0);
    g.drawImage(tmp, 0, 0);
  } else { g.fillStyle = color; g.fillRect(0, 0, c.width, c.height); }
  setLayerCanvas(r.id, c, 'Rellenar');
}

/** Copia los píxeles seleccionados (o la capa) como canvas en coordenadas de mundo. */
export async function copySelection(merged = false): Promise<{ canvas: HTMLCanvasElement; x: number; y: number } | null> {
  const s = docState();
  if (!s) return null;
  const l = activeLayer();
  const sel = s.selection;
  if (merged || !l) {
    const ab = activeArtboard()!;
    const r = sel ? selectionBoundsRect()! : ab;
    const tmp: Artboard = { ...ab, x: Math.floor(r.x), y: Math.floor(r.y), w: Math.ceil(r.w), h: Math.ceil(r.h), background: null };
    const c = await renderArtboard(s, tmp, 1, { background: false });
    if (sel) { const g = ctx2d(c); g.globalCompositeOperation = 'destination-in'; g.drawImage(sel.canvas, sel.x - tmp.x, sel.y - tmp.y); }
    return { canvas: c, x: tmp.x, y: tmp.y };
  }
  const { canvas, bounds } = await renderLayerAlone(s, l, 1);
  if (sel) {
    const g = ctx2d(canvas);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(sel.canvas, sel.x - bounds.x, sel.y - bounds.y);
    // recortar al área seleccionada
    const ix = Math.max(sel.x, bounds.x), iy = Math.max(sel.y, bounds.y);
    const iw = Math.min(sel.x + sel.canvas.width, bounds.x + bounds.w) - ix, ih = Math.min(sel.y + sel.canvas.height, bounds.y + bounds.h) - iy;
    if (iw < 1 || ih < 1) return null;
    const out = createCanvas(iw, ih);
    ctx2d(out).drawImage(canvas, bounds.x - ix, bounds.y - iy);
    return { canvas: out, x: ix, y: iy };
  }
  return { canvas, x: bounds.x, y: bounds.y };
}

export async function layerViaCopy(cut = false) {
  const s = docState();
  const l = activeLayer();
  if (!s || !l) return;
  const data = await copySelection();
  if (!data) return;
  if (cut && s.selection) await deleteSelectionPixels();
  insertLayers([rasterLayer(data.canvas, l.name + (cut ? ' cortada' : ' copia'), data.x, data.y)], cut ? 'Capa vía cortar' : 'Capa vía copiar');
}

export async function selectionToMask(hideSelected = false) {
  const s = docState();
  const l = activeLayer();
  if (!s || !l || l.kind === 'group') return toast('Selecciona una capa', 'warn');
  const { w, h } = layerSize(l);
  const mask = createCanvas(w, h);
  const g = ctx2d(mask);
  if (s.selection) {
    const m = selectionInLayer(s.selection, l);
    g.fillStyle = hideSelected ? '#fff' : '#000';
    g.fillRect(0, 0, w, h);
    const tint = createCanvas(w, h);
    const tg = ctx2d(tint);
    tg.fillStyle = hideSelected ? '#000' : '#fff';
    tg.fillRect(0, 0, w, h);
    tg.globalCompositeOperation = 'destination-in';
    tg.drawImage(m, 0, 0);
    g.drawImage(tint, 0, 0);
  } else { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); }
  commit('Añadir máscara de capa', st => ({ ...mapLayers(st, x => (x.id === l.id ? { ...x, mask, maskEnabled: true } : x)), selection: null }));
}
export async function applyMask() {
  const l = activeLayer();
  if (!l?.mask) return;
  await rasterizeLayer(l.id);
}

// ---------- transformaciones ----------
export function flipLayers(axis: 'h' | 'v') {
  const ls = selectedLayers().filter(l => !l.locked && l.kind !== 'group');
  updateLayers(ls.map(l => l.id), l => (axis === 'h' ? { scaleX: -l.scaleX } : { scaleY: -l.scaleY }), axis === 'h' ? 'Voltear horizontal' : 'Voltear vertical');
}
export function rotateLayers(deg: number) {
  const ls = selectedLayers().filter(l => !l.locked && l.kind !== 'group');
  updateLayers(ls.map(l => l.id), l => ({ rotation: ((l.rotation + deg) % 360 + 540) % 360 - 180 }), 'Rotar');
}
export function nudge(dx: number, dy: number) {
  const s = docState();
  if (!s) return;
  const ids = new Set<string>();
  for (const id of s.selectedLayerIds) { ids.add(id); descendants(s.layers, id).forEach(d => ids.add(d.id)); }
  const ls = s.layers.filter(l => ids.has(l.id) && !l.locked);
  updateLayers(ls.map(l => l.id), l => ({ x: l.x + dx, y: l.y + dy }), 'Mover');
}

export type AlignKind = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export function alignLayers(kind: AlignKind, to: 'selection' | 'artboard') {
  const s = docState();
  const ab = activeArtboard();
  if (!s || !ab) return;
  const ls = s.layers.filter(l => s.selectedLayerIds.includes(l.id) && l.kind !== 'group' && !l.locked);
  if (!ls.length) return;
  const ref = to === 'artboard' || ls.length === 1 ? ab : unionRect(ls.map(layerBounds))!;
  updateLayers(ls.map(l => l.id), l => {
    const b = layerBounds(l);
    let dx = 0, dy = 0;
    if (kind === 'left') dx = ref.x - b.x;
    if (kind === 'hcenter') dx = ref.x + ref.w / 2 - (b.x + b.w / 2);
    if (kind === 'right') dx = ref.x + ref.w - (b.x + b.w);
    if (kind === 'top') dy = ref.y - b.y;
    if (kind === 'vcenter') dy = ref.y + ref.h / 2 - (b.y + b.h / 2);
    if (kind === 'bottom') dy = ref.y + ref.h - (b.y + b.h);
    return { x: l.x + dx, y: l.y + dy };
  }, 'Alinear');
}
export function distributeLayers(axis: 'h' | 'v') {
  const s = docState();
  if (!s) return;
  const ls = s.layers.filter(l => s.selectedLayerIds.includes(l.id) && l.kind !== 'group' && !l.locked);
  if (ls.length < 3) return toast('Selecciona al menos 3 capas para distribuir', 'warn');
  const items = ls.map(l => ({ l, b: layerBounds(l) })).sort((a, b) => (axis === 'h' ? a.b.x - b.b.x : a.b.y - b.b.y));
  const first = items[0].b, last = items[items.length - 1].b;
  const total = items.reduce((acc, it) => acc + (axis === 'h' ? it.b.w : it.b.h), 0);
  const span = axis === 'h' ? last.x + last.w - first.x : last.y + last.h - first.y;
  const gap = (span - total) / (items.length - 1);
  let cur = axis === 'h' ? first.x : first.y;
  const moves = new Map<string, number>();
  for (const it of items) {
    moves.set(it.l.id, cur - (axis === 'h' ? it.b.x : it.b.y));
    cur += (axis === 'h' ? it.b.w : it.b.h) + gap;
  }
  updateLayers([...moves.keys()], l => (axis === 'h' ? { x: l.x + moves.get(l.id)! } : { y: l.y + moves.get(l.id)! }), 'Distribuir');
}

/** Cambia el tamaño físico de la capa (no destructivo, por escala). */
export function setLayerDisplaySize(id: string, w: number | null, h: number | null, keepRatio: boolean) {
  updateLayer(id, l => {
    const sz = layerSize(l);
    let sx = Math.abs(l.scaleX), sy = Math.abs(l.scaleY);
    if (w != null) { const nsx = w / sz.w; if (keepRatio) sy *= nsx / sx; sx = nsx; }
    if (h != null && w == null) { const nsy = h / sz.h; if (keepRatio) sx *= nsy / sy; sy = nsy; }
    const c = layerPivot(l);
    return { scaleX: sx * Math.sign(l.scaleX || 1), scaleY: sy * Math.sign(l.scaleY || 1), ...placeAtPivot(l, c.x, c.y, sx, sy) };
  }, 'Cambiar tamaño de capa');
}

// ---------- mesas de trabajo ----------
export function addArtboard(ab?: Partial<Artboard>) {
  const s = docState();
  const cur = activeArtboard();
  if (!s || !cur) return;
  const all = unionRect(s.artboards)!;
  const nab: Artboard = {
    ...cur, id: uid('ab'), name: `Mesa ${s.artboards.length + 1}`, x: all.x + all.w + 200, y: cur.y, ...ab,
  };
  commit('Nueva mesa de trabajo', st => ({ ...st, artboards: [...st.artboards, nab], activeArtboardId: nab.id }));
  return nab;
}
export function updateArtboard(id: string, patch: Partial<Artboard>, label = 'Modificar mesa', moveContent = false) {
  commit(label, st => {
    const ab = st.artboards.find(a => a.id === id)!;
    const next = { ...ab, ...patch };
    let layers = st.layers;
    if (moveContent && (patch.x !== undefined || patch.y !== undefined)) {
      const dx = next.x - ab.x, dy = next.y - ab.y;
      layers = layers.map(l => {
        if (l.kind === 'group') return l;
        const b = layerBounds(l);
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        return cx >= ab.x && cx <= ab.x + ab.w && cy >= ab.y && cy <= ab.y + ab.h ? { ...l, x: l.x + dx, y: l.y + dy } : l;
      });
    }
    return { ...st, layers, artboards: st.artboards.map(a => (a.id === id ? next : a)) };
  });
}
export function deleteArtboard(id: string) {
  const s = docState();
  if (!s || s.artboards.length < 2) return toast('El documento necesita al menos una mesa de trabajo', 'warn');
  commit('Eliminar mesa', st => {
    const artboards = st.artboards.filter(a => a.id !== id);
    return { ...st, artboards, activeArtboardId: artboards[0].id };
  });
}
/** Caja de los píxeles visibles de las capas (sin márgenes transparentes); si no hay píxeles, su caja. */
async function visibleBounds(st: DocState, list: Layer[]): Promise<Rect | null> {
  const rects: Rect[] = [];
  for (const l of list) {
    const { canvas, bounds } = await renderLayerAlone(st, l, 1);
    const t = trimCanvas(canvas);
    if (t) rects.push({ x: bounds.x + t.x, y: bounds.y + t.y, w: t.canvas.width, h: t.canvas.height });
    else if (bounds.w > 0 && bounds.h > 0) rects.push(bounds);
  }
  const u = unionRect(rects);
  // alinear a píxeles enteros para que la mesa no corte medio píxel
  if (!u) return null;
  const x = Math.floor(u.x), y = Math.floor(u.y);
  return { x, y, w: Math.ceil(u.x + u.w) - x, h: Math.ceil(u.y + u.h) - y };
}

/**
 * Crea una mesa de trabajo del tamaño exacto de las capas seleccionadas, a la derecha de las
 * demás, y mueve (o copia) ahí esas capas. Conserva los ppp de la mesa donde estaban.
 */
export async function artboardFromSelection(mode: 'move' | 'copy') {
  const s = docState();
  if (!s) return;
  const selIds = new Set(s.selectedLayerIds);
  // capas de nivel superior de la selección (si un grupo está seleccionado, sus hijos van con él)
  const top = s.layers.filter(l => selIds.has(l.id) && !ancestorIds(s.layers, l).some(a => selIds.has(a)));
  if (!top.length) return toast('Selecciona una o más capas', 'warn');
  if (mode === 'move' && top.some(l => isEffectivelyLocked(s.layers, l))) return toast('Hay capas bloqueadas en la selección', 'warn');
  const b = await visibleBounds(s, top);
  if (!b) return toast('La selección está vacía', 'warn');
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const src = s.artboards.find(a => cx >= a.x && cx <= a.x + a.w && cy >= a.y && cy <= a.y + a.h) ?? activeArtboard() ?? s.artboards[0];
  const all = unionRect(s.artboards)!;
  const name = top.length === 1 ? top[0].name : `Selección (${top.length} capas)`;
  const nab: Artboard = { id: uid('ab'), name, x: Math.round(all.x + all.w + Math.max(200, src.dpi * 0.5)), y: Math.round(all.y), w: b.w, h: b.h, dpi: src.dpi, background: null, margin: 0 };
  const dx = nab.x - b.x, dy = nab.y - b.y;
  const shift = (l: Layer): Layer => (l.kind === 'group' ? l : { ...l, x: l.x + dx, y: l.y + dy });
  commit(mode === 'move' ? 'Mesa desde selección' : 'Copiar a mesa nueva', st => {
    let layers: Layer[];
    let selected: string[];
    if (mode === 'move') {
      const moving = new Set(top.flatMap(l => [l.id, ...descendants(st.layers, l.id).map(d => d.id)]));
      layers = st.layers.map(l => (moving.has(l.id) ? shift(l) : l));
      selected = top.map(l => l.id);
    } else {
      layers = [...st.layers];
      selected = [];
      for (const l of top) {
        const copies = cloneLayerDeep(l, st.layers, l.parentId).map(shift);
        layers.splice(layers.findIndex(x => x.id === l.id) + 1, 0, ...copies);
        selected.push(copies[0].id);
      }
    }
    return { ...st, layers, artboards: [...st.artboards, nab], activeArtboardId: nab.id, selectedLayerIds: selected };
  });
  requestAnimationFrame(() => fitToScreen(nab));
  toast(`Mesa «${name}» creada: ${fmtUnit(nab.w, 'cm', nab.dpi)} × ${fmtUnit(nab.h, 'cm', nab.dpi)} a ${nab.dpi} ppp`, 'ok', 4500);
  return nab;
}
function ancestorIds(layers: Layer[], l: Layer): string[] {
  const out: string[] = [];
  for (let p = l.parentId; p; p = layers.find(x => x.id === p)?.parentId ?? null) out.push(p);
  return out;
}
export function setActiveArtboard(id: string) { silent(s => ({ ...s, activeArtboardId: id })); }

/** Tamaño de imagen: cambia resolución y/o remuestrea la mesa activa y su contenido. */
export function imageSize(newW: number, newH: number, dpi: number, resample: boolean) {
  const s = docState();
  const ab = activeArtboard();
  if (!s || !ab) return;
  if (!resample) { updateArtboard(ab.id, { dpi, margin: Math.round(ab.margin * (dpi / ab.dpi)) }, 'Resolución de impresión'); return; }
  const fx = newW / ab.w, fy = newH / ab.h;
  commit('Tamaño de imagen', st => {
    const layers = st.layers.map(l => {
      if (l.kind === 'group') return l;
      const b = layerBounds(l);
      if (!rectsIntersect(b, ab)) return l;
      const c = layerPivot(l);
      const ncx = ab.x + (c.x - ab.x) * fx, ncy = ab.y + (c.y - ab.y) * fy;
      const sx = l.scaleX * fx, sy = l.scaleY * fy;
      return { ...l, scaleX: sx, scaleY: sy, ...placeAtPivot(l, ncx, ncy, sx, sy) };
    });
    return { ...st, layers, artboards: st.artboards.map(a => (a.id === ab.id ? { ...a, w: Math.round(newW), h: Math.round(newH), dpi, margin: Math.round(a.margin * fx) } : a)) };
  });
}
/** Tamaño de lienzo con ancla (0..1 en cada eje). */
export function canvasSize(newW: number, newH: number, ax: number, ay: number) {
  const ab = activeArtboard();
  if (!ab) return;
  updateArtboard(ab.id, { w: Math.round(newW), h: Math.round(newH), x: Math.round(ab.x - (newW - ab.w) * ax), y: Math.round(ab.y - (newH - ab.h) * ay) }, 'Tamaño de lienzo');
}
export function cropArtboard(r: Rect) {
  const ab = activeArtboard();
  if (!ab) return;
  updateArtboard(ab.id, { x: Math.round(r.x), y: Math.round(r.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) }, 'Recortar');
}
export function trimArtboardToContent() {
  const s = docState();
  const ab = activeArtboard();
  if (!s || !ab) return;
  const vis = s.layers.filter(l => l.kind !== 'group' && isEffectivelyVisible(s.layers, l));
  const b = unionRect(vis.map(layerBounds));
  if (b) cropArtboard(b);
}
export function rotateArtboard(deg: 90 | -90 | 180) {
  const s = docState();
  const ab = activeArtboard();
  if (!s || !ab) return;
  const cx = ab.x + ab.w / 2, cy = ab.y + ab.h / 2;
  const rad = (deg * Math.PI) / 180;
  commit('Rotar mesa', st => {
    const layers = st.layers.map(l => {
      if (l.kind === 'group') return l;
      const b = layerBounds(l);
      if (!rectsIntersect(b, ab)) return l;
      const p = layerPivot(l);
      const dx = p.x - cx, dy = p.y - cy;
      const ncx = cx + dx * Math.cos(rad) - dy * Math.sin(rad), ncy = cy + dx * Math.sin(rad) + dy * Math.cos(rad);
      return { ...l, rotation: l.rotation + deg, ...placeAtPivot(l, ncx, ncy) };
    });
    const nw = deg === 180 ? ab.w : ab.h, nh = deg === 180 ? ab.h : ab.w;
    return { ...st, layers, artboards: st.artboards.map(a => (a.id === ab.id ? { ...a, w: nw, h: nh, x: Math.round(cx - nw / 2), y: Math.round(cy - nh / 2) } : a)) };
  });
}

// ---------- guías ----------
export function addGuide(axis: 'x' | 'y', pos: number) {
  commit('Nueva guía', s => ({ ...s, guides: [...s.guides, { id: uid('g'), axis, pos }] }));
}
export function clearGuides() { commit('Borrar guías', s => ({ ...s, guides: [] })); }

// ---------- capas desde píxeles de otro proceso ----------
export async function newDocFromCanvas(canvas: HTMLCanvasElement, name: string, dpi = 300) {
  const d = newDoc(name, canvas.width, canvas.height, dpi);
  const l = rasterLayer(canvas, name, 0, 0);
  d.state = { ...d.state, layers: [l], selectedLayerIds: [l.id] };
  addDoc(d);
}

export function hitTestLayers(x: number, y: number): Layer | null {
  const s = docState();
  if (!s) return null;
  for (let i = s.layers.length - 1; i >= 0; i--) {
    const l = s.layers[i];
    if (l.kind === 'group' || !isEffectivelyVisible(s.layers, l) || l.locked) continue;
    if (!pointInLayer(l, x, y)) continue;
    const src = processedContent(l);
    if (!src) continue;
    const p = layerMatrix(l).inverse().transformPoint(new DOMPoint(x, y));
    const { w, h } = layerSize(l);
    const px = Math.floor((p.x / w) * src.width), py = Math.floor((p.y / h) * src.height);
    try {
      const a = ctx2d(src).getImageData(px, py, 1, 1).data[3];
      if (a > 10) return topLevelOf(s.layers, l);
    } catch { return l; }
  }
  return null;
}
function topLevelOf(layers: Layer[], l: Layer) {
  // si la capa está en un grupo cerrado, se selecciona el grupo
  let cur = l;
  while (cur.parentId) {
    const p = layers.find(x => x.id === cur.parentId);
    if (!p || !p.collapsed) break;
    cur = p;
  }
  return cur;
}

export { ensureProcessed, bumpRender };
