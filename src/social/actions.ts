// Acciones de Social Design Studio sobre el documento. Todas pasan por el historial (`commit`),
// así que se deshacen y rehacen como cualquier otra.

import type { Artboard, Doc, DocState, Layer } from '../core/types';
import { get, set, commit, docState, activeDoc, toast } from '../core/store';
import { newArtboard, newDoc, descendants, rasterLayer } from '../core/doc';
import { addDoc, fitToScreen, cloneLayerDeep } from '../core/actions';
import { layerBounds, layerPivot, placeAtPivot, unionRect, uid, createCanvas, ctx2d, type Rect } from '../core/util';
import { allFormats, findFormat, safeRect, type SocialFormat } from './presets';
import { emptyDocSocial, seriesArtboards, SERIES_LABEL, type ArtboardSocial, type DocSocial, type SeriesKind } from './model';
import { adaptLayout, isBackground, type AdaptItem, type AdaptMode } from './adapt';
import { SLIDE_GAP, MAX_SLIDES, slidePositions, reorderSlides, slideContent, panoramaSlides } from './carousel';

/** Separación entre mesas sociales sueltas. */
const GAP = 160;

export const formats = () => allFormats(get().socialFormats);
export const formatOf = (ab: Artboard | null | undefined) => findFormat(ab?.social?.preset, get().socialFormats);

function socialArtboard(f: SocialFormat, x: number, y: number, name: string, background: string | null, social: ArtboardSocial): Artboard {
  return { ...newArtboard(f.w, f.h, 72, name, x, y, background), margin: 0, social };
}

// ---------- geometría de capas ----------
function nonGroup(layers: Layer[], l: Layer): Layer[] {
  return l.kind === 'group' ? descendants(layers, l.id).filter(d => d.kind !== 'group') : [l];
}
/** Caja de una capa de nivel superior (la de sus hijos si es un grupo). */
function itemBounds(layers: Layer[], l: Layer): Rect | null {
  const rs = nonGroup(layers, l).map(layerBounds).filter(b => b.w > 0 && b.h > 0);
  return unionRect(rs);
}
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Capas de nivel superior visibles en una mesa. */
export function topItemsIn(st: DocState, ab: Rect) {
  const out: { layer: Layer; bounds: Rect }[] = [];
  for (const l of st.layers) {
    if (l.parentId) continue;
    const b = itemBounds(st.layers, l);
    if (b && overlaps(b, ab)) out.push({ layer: l, bounds: b });
  }
  return out;
}

/** Copia escalada (k) y desplazada de una capa: p' = p·k + d. */
function placeLayer(l: Layer, k: number, dx: number, dy: number): Layer {
  if (l.kind === 'group') return l;
  const P = layerPivot(l);
  const sx = l.scaleX * k, sy = l.scaleY * k;
  return { ...l, scaleX: sx, scaleY: sy, ...placeAtPivot(l, P.x * k + dx, P.y * k + dy, sx, sy) };
}
const shiftLayer = (l: Layer, dx: number, dy: number): Layer => (l.kind === 'group' ? l : { ...l, x: l.x + dx, y: l.y + dy });

/** Abre hueco a la derecha de x en la fila [y, y+h]: desplaza mesas (y su contenido) en dx. */
function insertSpace(st: DocState, atX: number, row: { y: number; h: number }, dx: number, exclude: Set<string>): DocState {
  if (dx <= 0) return st;
  const moving = st.artboards.filter(a => !exclude.has(a.id) && a.x >= atX - 1 && a.y < row.y + row.h && a.y + a.h > row.y);
  if (!moving.length) return st;
  const ids = new Set(moving.map(a => a.id));
  const layers = st.layers.map(l => {
    if (l.kind === 'group') return l;
    const b = layerBounds(l);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    return moving.some(a => cx >= a.x && cx <= a.x + a.w && cy >= a.y && cy <= a.y + a.h) ? shiftLayer(l, dx, 0) : l;
  });
  return { ...st, layers, artboards: st.artboards.map(a => (ids.has(a.id) ? { ...a, x: a.x + dx } : a)) };
}

/** Lugar libre a la derecha de todas las mesas. */
function freeSpot(st: DocState) {
  const all = unionRect(st.artboards)!;
  return { x: Math.round(all.x + all.w + GAP), y: Math.round(all.y) };
}

function setDocSocial(docId: string, fn: (s: DocSocial) => DocSocial) {
  set(s => ({ docs: s.docs.map(d => (d.id === docId ? { ...d, social: fn(d.social ?? emptyDocSocial()), dirty: true } : d)) }));
}
export function updateDocSocial(fn: (s: DocSocial) => DocSocial) {
  const d = activeDoc();
  if (d) setDocSocial(d.id, fn);
}

/** Encuadra cuando el visor ya existe (al crear un documento desde Inicio aún no está montado). */
function fitWhenReady(r: Rect, tries = 20) {
  requestAnimationFrame(() => {
    const el = document.getElementById('kova-viewport');
    // un fotograma más: el visor recién montado hace su propio encuadre inicial en el primero
    if (el && el.clientWidth > 0) requestAnimationFrame(() => requestAnimationFrame(() => fitToScreen(r)));
    else if (tries > 0) fitWhenReady(r, tries - 1);
  });
}

// ---------- documentos nuevos ----------
export interface NewSocialOptions {
  name?: string;
  background?: string | null;
  /** número de diapositivas (carrusel) */
  slides?: number;
  continuous?: boolean;
  /** nombres de las portadas de destacadas */
  highlights?: string[];
}

export function createSocialDoc(f: SocialFormat, o: NewSocialOptions = {}) {
  const bg = o.background === undefined ? '#ffffff' : o.background;
  const d: Doc = newDoc(o.name ?? `${f.name} ${f.w}×${f.h}`, f.w, f.h, 72, bg);
  const first = d.state.artboards[0];
  let artboards: Artboard[];
  if (o.highlights?.length) {
    const sid = uid('sr');
    const labels = o.highlights.slice(0, MAX_SLIDES);
    artboards = slidePositions(labels.length, f.w, 0, 0, SLIDE_GAP).map((p, i) =>
      socialArtboard(f, p.x, p.y, labels[i] || `Destacada ${i + 1}`, bg, { preset: f.id, label: labels[i], series: { id: sid, kind: 'highlights', name: SERIES_LABEL.highlights, index: i } }));
  } else if ((o.slides ?? 1) > 1 || o.continuous) {
    const n = Math.max(2, Math.min(MAX_SLIDES, o.slides ?? 2));
    const kind: SeriesKind = o.continuous ? 'continuous' : 'carousel';
    const sid = uid('sr');
    artboards = slidePositions(n, f.w, 0, 0, o.continuous ? 0 : SLIDE_GAP).map((p, i) =>
      socialArtboard(f, p.x, p.y, `Diapositiva ${i + 1}`, bg, { preset: f.id, series: { id: sid, kind, name: SERIES_LABEL[kind], index: i } }));
  } else {
    artboards = [{ ...first, name: f.name, margin: 0, social: { preset: f.id } }];
  }
  d.state = { ...d.state, artboards, activeArtboardId: artboards[0].id };
  d.social = emptyDocSocial();
  // las redes se miden en píxeles
  set({ workspace: 'social', unit: 'px' });
  addDoc(d, false);
  fitWhenReady(unionRect(artboards)!);
}

// ---------- mesas sociales en el documento abierto ----------
export function addFormatArtboard(f: SocialFormat, background?: string | null) {
  const st = docState();
  if (!st) return;
  const p = freeSpot(st);
  const cur = st.artboards.find(a => a.id === st.activeArtboardId);
  const ab = socialArtboard(f, p.x, p.y, f.name, background === undefined ? cur?.background ?? '#ffffff' : background, { preset: f.id });
  commit(`Nueva mesa: ${f.name}`, s => ({ ...s, artboards: [...s.artboards, ab], activeArtboardId: ab.id }));
  fitWhenReady(ab);
  return ab;
}

/** Asigna un formato a una mesa. Si cambia el tamaño, adapta su contenido con el modo dado. */
export function setArtboardFormat(abId: string, f: SocialFormat, mode: AdaptMode | null = 'fit') {
  const st = docState();
  const ab = st?.artboards.find(a => a.id === abId);
  if (!st || !ab) return;
  const series = ab.social?.series;
  const targets = series ? seriesArtboards(st.artboards, series.id) : [ab];
  // nuevas posiciones: las diapositivas se recolocan en fila con el ancho nuevo
  const gap = series?.kind === 'continuous' ? 0 : series ? SLIDE_GAP : 0;
  const pos = slidePositions(targets.length, f.w, targets[0].x, targets[0].y, gap);
  const oldRight = Math.max(...targets.map(t => t.x + t.w));
  const newRight = pos[pos.length - 1].x + f.w;
  commit(`Formato: ${f.name}`, s => {
    // primero se abre sitio (con el contenido aún en su lugar) y luego se adapta
    let next = newRight > oldRight ? insertSpace(s, oldRight, { y: targets[0].y, h: Math.max(f.h, targets[0].h) }, newRight - oldRight, new Set(targets.map(t => t.id))) : s;
    targets.forEach((t, i) => {
      const dst = { x: pos[i].x, y: pos[i].y, w: f.w, h: f.h };
      const layers = mode && (t.w !== f.w || t.h !== f.h || t.x !== dst.x || t.y !== dst.y) ? adaptLayersInPlace(next, t, dst, mode, f) : next.layers;
      next = { ...next, layers, artboards: next.artboards.map(a => (a.id === t.id ? { ...a, ...dst, social: { ...(a.social ?? {}), preset: f.id }, margin: 0, dpi: a.social ? a.dpi : 72 } : a)) };
    });
    return next;
  });
}

/** Quita el formato de redes de una mesa (vuelve a ser una mesa normal; no cambia su tamaño). */
export function clearArtboardFormat(abId: string) {
  commit('Quitar formato de redes', s => ({ ...s, artboards: s.artboards.map(a => (a.id === abId ? { ...a, social: null } : a)) }));
}

/**
 * Un fondo ampliado para cubrir el formato sobresale de la mesa y podría verse en las vecinas:
 * se recorta exactamente a la mesa. Rectángulos: se redimensionan. Imágenes: se recorta el
 * lienzo (y su máscara). Lo girado, volteado o de otro tipo se deja como está.
 */
function trimToFrame(l: Layer, frame: Rect): Layer {
  if (l.rotation % 360 !== 0 || l.scaleX <= 0 || l.scaleY <= 0) return l;
  const b = layerBounds(l);
  const x0 = Math.max(b.x, frame.x), y0 = Math.max(b.y, frame.y), x1 = Math.min(b.x + b.w, frame.x + frame.w), y1 = Math.min(b.y + b.h, frame.y + frame.h);
  if (x1 - x0 < 1 || y1 - y0 < 1 || (x0 <= b.x + 0.5 && y0 <= b.y + 0.5 && x1 >= b.x + b.w - 0.5 && y1 >= b.y + b.h - 0.5)) return l;
  if (l.kind === 'shape' && l.shape?.shape === 'rect' && !l.mask) {
    const w = (x1 - x0) / l.scaleX, h = (y1 - y0) / l.scaleY;
    return { ...l, x: x0, y: y0, shape: { ...l.shape, w, h } };
  }
  if (l.kind === 'raster' && l.canvas) {
    // en píxeles del lienzo de la capa
    const sx = Math.max(0, Math.floor((x0 - b.x) / l.scaleX)), sy = Math.max(0, Math.floor((y0 - b.y) / l.scaleY));
    const sw = Math.min(l.canvas.width - sx, Math.ceil((x1 - x0) / l.scaleX)), sh = Math.min(l.canvas.height - sy, Math.ceil((y1 - y0) / l.scaleY));
    if (sw < 1 || sh < 1) return l;
    const crop = (src: HTMLCanvasElement) => { const c = createCanvas(sw, sh); ctx2d(c).drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh); return c; };
    const canvas = crop(l.canvas);
    const origin = l.origin && l.origin !== l.canvas && l.origin.width === l.canvas.width && l.origin.height === l.canvas.height ? crop(l.origin) : canvas;
    const mask = l.mask && l.mask.width === l.canvas.width && l.mask.height === l.canvas.height ? crop(l.mask) : l.mask;
    return { ...l, canvas, origin, mask, x: b.x + sx * l.scaleX, y: b.y + sy * l.scaleY };
  }
  return l;
}

/** Transforma en el sitio las capas de una mesa hacia otro rectángulo. */
function adaptLayersInPlace(st: DocState, src: Artboard, dst: Rect, mode: AdaptMode, f: SocialFormat | null): Layer[] {
  const items = topItemsIn(st, src);
  const plan = adaptLayout(items.map(toAdaptItem(src)), src, dst, { mode, safe: f ? safeIn(f, dst) : dst });
  const change = new Map<string, Layer>();
  const bgs = new Set(items.filter(it => isBackground(it.bounds, src)).map(it => it.layer.id));
  for (const { layer } of items) {
    const p = plan.get(layer.id)!;
    for (const l of nonGroup(st.layers, layer)) {
      const placed = placeLayer(l, p.k, p.dx, p.dy);
      change.set(l.id, bgs.has(layer.id) ? trimToFrame(placed, dst) : placed);
    }
  }
  return st.layers.map(l => change.get(l.id) ?? l);
}

const toAdaptItem = (src: Rect) => ({ layer, bounds }: { layer: Layer; bounds: Rect }): AdaptItem => ({
  id: layer.id, bounds, role: isBackground(bounds, src) ? 'background' : layer.kind === 'text' ? 'text' : 'other',
});
function safeIn(f: SocialFormat, dst: Rect): Rect {
  const s = safeRect(f, dst.w, dst.h);
  return { x: dst.x + s.x, y: dst.y + s.y, w: s.w, h: s.h };
}

/**
 * Copias de una mesa en otros formatos: cada una es una mesa nueva con copias de las capas
 * colocadas por el motor de adaptación. El original no cambia.
 */
export function adaptToFormats(abId: string, targets: SocialFormat[], mode: AdaptMode) {
  const st = docState();
  const src = st?.artboards.find(a => a.id === abId);
  if (!st || !src || !targets.length) return [];
  const created: Artboard[] = [];
  commit(targets.length === 1 ? `Adaptar a ${targets[0].name}` : `Adaptar a ${targets.length} formatos`, s => {
    const all = unionRect(s.artboards)!;
    let cursor = Math.round(all.x + all.w + GAP);
    const y = src.y;
    let layers = [...s.layers];
    const items = topItemsIn(s, src);
    for (const f of targets) {
      // primero en x = 0 para medir cuánto sobresale lo que no se puede recortar
      const probe = { x: 0, y, w: f.w, h: f.h };
      const plan0 = adaptLayout(items.map(toAdaptItem(src)), src, probe, { mode, safe: safeIn(f, probe) });
      const placedAll = items.map(({ layer, bounds }) => {
        const p = plan0.get(layer.id)!;
        const copies = cloneLayerDeep(layer, s.layers, null).map(c => ({ ...placeLayer(c, p.k, p.dx, p.dy), name: c.name.replace(/ copia$/, '') }));
        return isBackground(bounds, src) ? copies.map(c => trimToFrame(c, probe)) : copies;
      }).flat();
      const ext = unionRect(placedAll.filter(l => l.kind !== 'group').map(layerBounds).filter(b => b.w > 0)) ?? probe;
      const x = Math.round(cursor + Math.max(0, -ext.x));
      layers.push(...placedAll.map(l => shiftLayer(l, x, 0)));
      const ab = socialArtboard(f, x, y, `${src.name} · ${f.name}`, src.background, { preset: f.id });
      created.push(ab);
      cursor = Math.round(Math.max(x + f.w, x + ext.x + ext.w) + GAP);
    }
    return { ...s, layers, artboards: [...s.artboards, ...created], activeArtboardId: created[0].id };
  });
  if (created.length) fitWhenReady(unionRect(created)!);
  return created;
}

/** Estado temporal con la adaptación aplicada, para la vista previa (no toca el documento). */
export function previewAdapt(st: DocState, src: Artboard, f: SocialFormat, mode: AdaptMode): { state: DocState; ab: Artboard } {
  const dst = { x: src.x, y: src.y, w: f.w, h: f.h };
  const layers = adaptLayersInPlace(st, src, dst, mode, f);
  const ab: Artboard = { ...src, ...dst, id: 'preview', social: { preset: f.id } };
  return { state: { ...st, layers }, ab };
}

// ---------- carruseles ----------
/** Convierte una mesa en la primera diapositiva de un carrusel de n y crea las demás. */
export function makeCarousel(abId: string, n: number, continuous: boolean) {
  const st = docState();
  const ab = st?.artboards.find(a => a.id === abId);
  if (!st || !ab) return;
  if (ab.social?.series) return toast('Esta mesa ya forma parte de una serie', 'warn');
  n = Math.max(2, Math.min(MAX_SLIDES, Math.round(n)));
  const f = formatOf(ab);
  const kind: SeriesKind = continuous ? 'continuous' : 'carousel';
  const sid = uid('sr');
  const gap = continuous ? 0 : SLIDE_GAP;
  const pos = slidePositions(n, ab.w, ab.x, ab.y, gap);
  commit(continuous ? 'Crear carrusel continuo' : 'Crear carrusel', s => {
    let next = insertSpace(s, ab.x + ab.w, { y: ab.y, h: ab.h }, (n - 1) * (ab.w + gap) + GAP, new Set([ab.id]));
    const slides: Artboard[] = pos.map((p, i) => (i === 0
      ? { ...ab, social: { preset: f?.id ?? ab.social?.preset ?? 'custom', series: { id: sid, kind, name: SERIES_LABEL[kind], index: 0 } } }
      : { ...ab, id: uid('ab'), name: `Diapositiva ${i + 1}`, x: p.x, y: p.y, social: { preset: f?.id ?? ab.social?.preset ?? 'custom', series: { id: sid, kind, name: SERIES_LABEL[kind], index: i } } }));
    next = { ...next, artboards: [...next.artboards.filter(a => a.id !== ab.id), ...slides] };
    return next;
  });
  fitWhenReady({ x: ab.x, y: ab.y, w: pos[n - 1].x + ab.w - ab.x, h: ab.h });
}

function renumber(artboards: Artboard[], seriesId: string, order: string[]): Artboard[] {
  return artboards.map(a => {
    const i = order.indexOf(a.id);
    if (i < 0 || a.social?.series?.id !== seriesId) return a;
    const auto = /^Diapositiva \d+$/.test(a.name);
    return { ...a, name: auto ? `Diapositiva ${i + 1}` : a.name, social: { ...a.social!, series: { ...a.social!.series!, index: i } } };
  });
}

/** Añade una diapositiva vacía (o copia de una) después de `afterId`. */
export function addSlide(afterId: string, copyContent = false) {
  const st = docState();
  const after = st?.artboards.find(a => a.id === afterId);
  const ser = after?.social?.series;
  if (!st || !after || !ser) return;
  const slides = seriesArtboards(st.artboards, ser.id);
  if (slides.length >= MAX_SLIDES) return toast(`Un carrusel admite hasta ${MAX_SLIDES} diapositivas`, 'warn');
  const at = slides.findIndex(a => a.id === afterId) + 1;
  const gap = ser.kind === 'continuous' ? 0 : SLIDE_GAP;
  const step = after.w + gap;
  const nab: Artboard = { ...after, id: uid('ab'), name: copyContent ? `${after.name} copia` : `Diapositiva ${at + 1}`, x: after.x + step, social: { ...after.social!, label: copyContent ? after.social?.label : undefined, series: { ...ser, index: at } } };
  if (/^Diapositiva \d+$/.test(after.name) && copyContent) nab.name = `Diapositiva ${at + 1}`;
  commit(copyContent ? 'Duplicar diapositiva' : 'Añadir diapositiva', s => {
    // las diapositivas siguientes y lo que haya a la derecha se desplazan un paso
    let next = insertSpace(s, after.x + after.w + 1, { y: after.y, h: after.h }, step, new Set([after.id]));
    let layers = next.layers;
    if (copyContent) {
      const cont = ser.kind === 'continuous';
      const tops = s.layers.filter(l => {
        if (l.parentId) return false;
        const b = itemBounds(s.layers, l);
        return !!b && slideContent([{ id: l.id, kind: 'item', x: 0, y: 0 }], after, cont, () => b).length > 0;
      });
      const copies = tops.flatMap(l => cloneLayerDeep(l, s.layers, null).map(c => shiftLayer({ ...c, name: c.name.replace(/ copia$/, '') }, step, 0)));
      layers = [...layers, ...copies];
    }
    const order = [...slides.slice(0, at).map(a => a.id), nab.id, ...slides.slice(at).map(a => a.id)];
    return { ...next, layers, artboards: renumber([...next.artboards, nab], ser.id, order), activeArtboardId: nab.id };
  });
  return nab;
}

/** Elimina una diapositiva con su contenido y cierra el hueco. */
export function deleteSlide(abId: string) {
  const st = docState();
  const ab = st?.artboards.find(a => a.id === abId);
  const ser = ab?.social?.series;
  if (!st || !ab || !ser) return;
  if (st.artboards.length < 2) return toast('El documento necesita al menos una mesa de trabajo', 'warn');
  const slides = seriesArtboards(st.artboards, ser.id);
  const gap = ser.kind === 'continuous' ? 0 : SLIDE_GAP;
  const step = ab.w + gap;
  commit('Eliminar diapositiva', s => {
    const own = new Set(slideContent(s.layers, ab, ser.kind === 'continuous', layerBounds).map(l => l.id));
    // grupos que quedan vacíos también se van
    let layers = s.layers.filter(l => !own.has(l.id));
    layers = layers.filter(l => l.kind !== 'group' || descendants(s.layers, l.id).length === 0 || descendants(layers, l.id).length > 0);
    let next: DocState = { ...s, layers, artboards: s.artboards.filter(a => a.id !== abId) };
    // cerrar el hueco: lo que está a la derecha vuelve un paso
    const right = next.artboards.filter(a => a.x > ab.x && a.y < ab.y + ab.h && a.y + a.h > ab.y);
    const ids = new Set(right.map(a => a.id));
    next = {
      ...next,
      layers: next.layers.map(l => {
        if (l.kind === 'group') return l;
        const b = layerBounds(l);
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        return right.some(a => cx >= a.x && cx <= a.x + a.w && cy >= a.y && cy <= a.y + a.h) ? shiftLayer(l, -step, 0) : l;
      }),
      artboards: next.artboards.map(a => (ids.has(a.id) ? { ...a, x: a.x - step } : a)),
    };
    const order = slides.filter(a => a.id !== abId).map(a => a.id);
    const remaining = renumber(next.artboards, ser.id, order);
    return { ...next, artboards: remaining, activeArtboardId: order[Math.max(0, slides.findIndex(a => a.id === abId) - 1)] ?? remaining[0].id, selectedLayerIds: next.selectedLayerIds.filter(id => !own.has(id)) };
  });
}

/** Mueve una diapositiva a otra posición: el contenido la acompaña. */
export function moveSlide(abId: string, toIndex: number) {
  const st = docState();
  const ab = st?.artboards.find(a => a.id === abId);
  const ser = ab?.social?.series;
  if (!st || !ab || !ser) return;
  const slides = seriesArtboards(st.artboards, ser.id);
  const from = slides.findIndex(a => a.id === abId);
  toIndex = Math.max(0, Math.min(slides.length - 1, toIndex));
  if (from === toIndex) return;
  const order = slides.map(a => a.id);
  order.splice(from, 1);
  order.splice(toIndex, 0, abId);
  commit('Reordenar diapositivas', s => {
    const { positions, shifts } = reorderSlides(slides, order, s.layers, ser.kind === 'continuous', layerBounds);
    const layers = s.layers.map(l => { const d = shifts.get(l.id); return d ? shiftLayer(l, d.dx, d.dy) : l; });
    const artboards = s.artboards.map(a => { const p = positions.get(a.id); return p ? { ...a, x: p.x, y: p.y } : a; });
    return { ...s, layers, artboards: renumber(artboards, ser.id, order) };
  });
}

export function renameSeries(seriesId: string, name: string) {
  commit('Renombrar serie', s => ({ ...s, artboards: s.artboards.map(a => (a.social?.series?.id === seriesId ? { ...a, social: { ...a.social!, series: { ...a.social!.series!, name } } } : a)) }));
}

/** Saca una mesa de su serie (queda como publicación suelta). */
export function leaveSeries(abId: string) {
  const st = docState();
  const ser = st?.artboards.find(a => a.id === abId)?.social?.series;
  if (!st || !ser) return;
  const order = seriesArtboards(st.artboards, ser.id).filter(a => a.id !== abId).map(a => a.id);
  commit('Separar de la serie', s => ({
    ...s,
    artboards: renumber(s.artboards.map(a => (a.id === abId ? { ...a, social: { preset: a.social!.preset, label: a.social!.label } } : a)), ser.id, order)
      // una serie de una sola diapositiva deja de ser serie
      .map(a => (order.length === 1 && a.id === order[0] ? { ...a, social: { preset: a.social!.preset, label: a.social!.label } } : a)),
  }));
}

export function setSlideLabel(abId: string, label: string) {
  commit('Nombre de destacada', s => ({ ...s, artboards: s.artboards.map(a => (a.id === abId ? { ...a, name: label || a.name, social: { ...a.social!, label } } : a)) }));
}

/** Añade portadas de destacadas al documento abierto, en fila. */
export function addHighlights(f: SocialFormat, labels: string[], background: string | null) {
  const st = docState();
  if (!st || !labels.length) return;
  const p = freeSpot(st);
  const sid = uid('sr');
  const abs = slidePositions(labels.length, f.w, p.x, p.y, SLIDE_GAP).map((q, i) =>
    socialArtboard(f, q.x, q.y, labels[i] || `Destacada ${i + 1}`, background, { preset: f.id, label: labels[i], series: { id: sid, kind: 'highlights', name: SERIES_LABEL.highlights, index: i } }));
  commit('Portadas de destacadas', s => ({ ...s, artboards: [...s.artboards, ...abs], activeArtboardId: abs[0].id }));
  fitWhenReady(unionRect(abs)!);
}

/**
 * Carrusel continuo a partir de una imagen panorámica (p. ej. 5400×1350 → 5 diapositivas de
 * 1080×1350): la capa se escala a la altura del formato y se crean las diapositivas pegadas
 * debajo de ella, cortando exactamente por los bordes.
 */
export function panoramaFromLayer(layerId: string, f: SocialFormat) {
  const st = docState();
  const l = st?.layers.find(x => x.id === layerId);
  if (!st || !l || l.kind === 'group') return toast('Selecciona una capa de imagen', 'warn');
  const b = layerBounds(l);
  const k = f.h / b.h;
  const n = panoramaSlides(b.w * k, f.w);
  if (b.w * k > MAX_SLIDES * f.w) toast(`La imagen da para más de ${MAX_SLIDES} diapositivas; se usan ${MAX_SLIDES}`, 'warn');
  const p = freeSpot(st);
  const sid = uid('sr');
  const abs = slidePositions(n, f.w, p.x, p.y, 0).map((q, i) =>
    socialArtboard(f, q.x, q.y, `Diapositiva ${i + 1}`, null, { preset: f.id, series: { id: sid, kind: 'continuous', name: 'Panorama', index: i } }));
  const total = n * f.w;
  commit('Carrusel panorámico', s => {
    // la propia capa pasa a ser el panorama (se deshace como cualquier cambio)
    const placed = placeLayer(l, k, 0, 0);
    const pb = layerBounds(placed);
    // centrada en horizontal si sobra espacio en la última diapositiva
    const dx = p.x + (total - pb.w) / 2 - pb.x, dy = p.y - pb.y;
    const moved = shiftLayer(placed, dx, dy);
    return { ...s, layers: s.layers.map(x => (x.id === l.id ? moved : x)), artboards: [...s.artboards, ...abs], activeArtboardId: abs[0].id, selectedLayerIds: [l.id] };
  });
  fitWhenReady(unionRect(abs)!);
  toast(`Panorama repartido en ${n} diapositivas de ${f.w}×${f.h}`, 'ok');
}

/** Coloca una imagen como capa cubriendo la mesa (para {{imagen}} y para importar panoramas). */
export function coverLayerFor(canvas: HTMLCanvasElement, box: Rect, name: string): Layer {
  const k = Math.max(box.w / canvas.width, box.h / canvas.height);
  const l = rasterLayer(canvas, name, 0, 0);
  const sized = { ...l, scaleX: k, scaleY: k };
  return { ...sized, ...placeAtPivot(sized, box.x + box.w / 2, box.y + box.h / 2, k, k) };
}
