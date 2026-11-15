// Capas de ajuste, máscaras (revelar, ocultar, invertir, luminancia, degradado) y acciones rápidas
// sobre el sujeto seleccionado (ocultar o reemplazar el fondo, extraerlo, efectos solo en él).

import type { Adjustment, DocState, Layer } from './types';
import { commit, docState, activeLayer, activeArtboard, toast, set, withBusy } from './store';
import { createCanvas, ctx2d, getImageData, layerBounds, layerSize, canvasToBlob, cloneCanvas } from './util';
import { adjustLayer, shapeLayer } from './doc';
import { maskFromSelection, copySelection, layerViaCopy, selectionToMask } from './actions';
import { layerContent, renderInLayerSpace, invalidateLayer } from './render';
import { platform } from '../platform';
import { lumaMask } from '../engine/matte';

const showPanel = (id: string) => set(st => ({ panels: st.panels.map(p => (p.id === id ? { ...p, visible: true, collapsed: false } : p)) }));

/** Inserta `l` encima de la capa activa (dentro de su grupo) y la selecciona. */
function insertAbove(st: DocState, l: Layer, act: Layer | null): DocState {
  const layers = [...st.layers];
  let idx = layers.length, parentId: string | null = null;
  if (act) {
    if (act.kind === 'group' && !act.collapsed) { parentId = act.id; idx = layers.length; }
    else { parentId = act.parentId; idx = layers.indexOf(act) + 1; }
    // encima de las capas ya recortadas a la activa, para no romper su recorte
    while (!l.clip && idx < layers.length && layers[idx].clip && layers[idx].parentId === parentId) idx++;
  }
  layers.splice(idx, 0, { ...l, parentId });
  return { ...st, layers, selectedLayerIds: [l.id] };
}

export interface NewAdjustOpts {
  /** recortar a la capa activa (solo la afecta a ella) */
  clip?: boolean;
  /** con selección: la máscara deja fuera lo seleccionado (p. ej. efectos solo en el fondo) */
  invertSelection?: boolean;
  adjustments?: Adjustment[];
  name?: string;
  /** no abrir el panel de Efectos */
  quiet?: boolean;
}

/**
 * Nueva capa de ajuste encima de la capa activa. Actúa sobre todo lo que hay debajo en su nivel
 * (dentro de un grupo, solo sobre el grupo); recortada, solo sobre la capa activa. Si hay una
 * selección, se convierte en su máscara.
 */
export function newAdjustmentLayer(o: NewAdjustOpts = {}): Layer | null {
  const s = docState();
  const ab = activeArtboard();
  if (!s || !ab) return null;
  const act = activeLayer();
  const clip = !!o.clip && !!act && act.kind !== 'group' && act.kind !== 'adjust';
  // zona: la mesa activa; recortada, la caja de la capa
  const r = clip && act ? layerBounds(act) : ab;
  const x = Math.floor(r.x), y = Math.floor(r.y);
  const w = Math.max(1, Math.ceil(r.x + r.w) - x), h = Math.max(1, Math.ceil(r.y + r.h) - y);
  const l: Layer = { ...adjustLayer(w, h, x, y, o.name ?? (clip ? `Ajuste de ${act!.name}` : 'Capa de ajuste')), clip, adjustments: o.adjustments ?? [] };
  if (s.selection) { l.mask = maskFromSelection(l, s.selection, !!o.invertSelection); l.maskEnabled = true; }
  const label = s.selection ? (o.invertSelection ? 'Capa de ajuste (fuera de la selección)' : 'Capa de ajuste (selección)') : 'Nueva capa de ajuste';
  commit(label, st => ({ ...insertAbove(st, l, act), selection: null }));
  if (!o.quiet) showPanel('effects');
  return l;
}

/** ¿Está la capa activa dentro de un grupo que contiene capas de ajuste? (para explicarlo) */
export function adjustScopeText(l: Layer, all: Layer[]) {
  if (l.clip) return 'Solo afecta a la capa de debajo (recortada).';
  if (l.parentId) { const g = all.find(x => x.id === l.parentId); return `Afecta a lo que hay debajo dentro del grupo «${g?.name ?? ''}».`; }
  return 'Afecta a todas las capas que tiene debajo.';
}

// ---------- máscaras ----------
function setMask(l: Layer, mask: HTMLCanvasElement, label: string) {
  invalidateLayer(l.id);
  commit(label, st => ({ ...st, layers: st.layers.map(x => (x.id === l.id ? { ...x, mask, maskEnabled: true } : x)) }));
  set(st => ({ opts: { ...st.opts, brushTarget: 'mask' } }));
}
function maskTarget(): Layer | null {
  const l = activeLayer();
  if (!l || l.kind === 'group') { toast('Selecciona una capa', 'warn'); return null; }
  return l;
}

/** Máscara en blanco (todo visible) o en negro (todo oculto). */
export function addMaskFill(hide: boolean) {
  const l = maskTarget();
  if (!l) return;
  const { w, h } = layerSize(l);
  const m = createCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  const g = ctx2d(m);
  g.fillStyle = hide ? '#000' : '#fff';
  g.fillRect(0, 0, m.width, m.height);
  setMask(l, m, hide ? 'Máscara: ocultar todo' : 'Máscara: revelar todo');
}

/** Invierte la máscara de la capa activa. */
export function invertMask() {
  const l = maskTarget();
  if (!l?.mask) return toast('La capa no tiene máscara', 'warn');
  const img = getImageData(l.mask);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    // lo transparente cuenta como negro (oculto): al invertir pasa a blanco
    const v = ((0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * d[i + 3]) / 255;
    d[i] = d[i + 1] = d[i + 2] = 255 - Math.round(v); d[i + 3] = 255;
  }
  const out = createCanvas(img.width, img.height);
  ctx2d(out).putImageData(img, 0, 0);
  setMask(l, out, 'Invertir máscara');
}

/**
 * Máscara de luminancia: las luces (o las sombras) quedan visibles. En una capa de ajuste se toma
 * de lo que hay debajo; en las demás, del contenido de la propia capa.
 */
export async function luminanceMask(shadows: boolean) {
  const l = maskTarget();
  const s = docState();
  if (!l || !s) return;
  await withBusy('Calculando máscara de luminancia…', async () => {
    let src: HTMLCanvasElement | null;
    if (l.kind === 'adjust') {
      // lo de debajo: se ocultan esta capa y todas las que están por encima en el orden global
      const idx = s.layers.findIndex(x => x.id === l.id);
      const hidden = new Set(s.layers.slice(idx).map(x => x.id));
      src = await renderInLayerSpace(s, l, hidden);
    } else {
      const c = layerContent(l);
      const { w, h } = layerSize(l);
      src = c ? cloneCanvas(c, Math.max(1, Math.round(w)), Math.max(1, Math.round(h))) : null;
    }
    if (!src) return;
    const img = getImageData(src);
    lumaMask(img.data, shadows);
    const out = createCanvas(img.width, img.height);
    ctx2d(out).putImageData(img, 0, 0);
    setMask(l, out, shadows ? 'Máscara de luminancia (sombras)' : 'Máscara de luminancia (luces)');
  });
}

/** Prepara una máscara de degradado: crea la máscara si falta y activa el Degradado sobre ella. */
export function gradientMask() {
  const l = maskTarget();
  if (!l) return;
  if (!l.mask) addMaskFill(false);
  set(st => ({ tool: 'gradient', opts: { ...st.opts, brushTarget: 'mask' } }));
  toast('Arrastra con Degradado sobre el lienzo: blanco = visible, negro = oculto (usa los colores frontal y de fondo)', 'info', 6000);
}

// ---------- sujeto ----------
function needSelection() {
  const s = docState();
  if (!s?.selection) { toast('Primero selecciona el sujeto (Selección → Seleccionar sujeto)', 'warn'); return false; }
  return true;
}

/** Oculta el fondo sin borrarlo: máscara de capa desde la selección del sujeto. */
export function hideBackground() {
  if (!needSelection()) return;
  void selectionToMask(false);
}

/** Copia el sujeto seleccionado a una capa nueva. */
export function extractSubject() {
  if (!needSelection()) return;
  void layerViaCopy(false);
}

/** Efectos solo en el sujeto (o solo en el fondo): capa de ajuste recortada a la capa con la
 *  selección como máscara. */
export function effectsOnSelection(background: boolean) {
  if (!needSelection()) return;
  const act = activeLayer();
  const clip = !!act && act.kind !== 'group' && act.kind !== 'adjust';
  newAdjustmentLayer({ clip, invertSelection: background, name: background ? 'Efectos del fondo' : 'Efectos del sujeto' });
  toast(`Capa de ajuste creada: elige efectos o preajustes y solo afectarán ${background ? 'al fondo' : 'al sujeto'}`, 'info', 5000);
}

/** Reemplaza el fondo: oculta el fondo de la capa (máscara) y pone debajo una capa de color. */
export function replaceBackground(color: string) {
  const s = docState();
  const l = activeLayer();
  const ab = activeArtboard();
  if (!s || !l || !ab || l.kind === 'group') return toast('Selecciona la capa del sujeto', 'warn');
  if (!s.selection && !(l.mask && l.maskEnabled)) return toast('Primero selecciona el sujeto (Selección → Seleccionar sujeto)', 'warn');
  const mask = s.selection ? maskFromSelection(l, s.selection, false) : l.mask!;
  const fill = { ...shapeLayer({ shape: 'rect', w: ab.w, h: ab.h, fill: color, stroke: null, strokeWidth: 0, radius: 0 }, ab.x, ab.y), name: 'Fondo nuevo' };
  invalidateLayer(l.id);
  commit('Reemplazar fondo', st => {
    const layers: Layer[] = [];
    // el fondo nuevo va justo debajo de la capa (y de su recorte, si es la base de uno)
    for (const x of st.layers) {
      if (x.id === l.id) layers.push({ ...fill, parentId: x.parentId }, { ...x, mask, maskEnabled: true });
      else layers.push(x);
    }
    return { ...st, layers, selection: null, selectedLayerIds: [l.id] };
  });
}

/** Exporta el sujeto seleccionado (de la capa activa) como PNG con transparencia. */
export async function exportSubjectPng() {
  if (!needSelection()) return;
  const data = await copySelection(false);
  if (!data) return toast('La selección está vacía en esta capa', 'warn');
  const blob = await canvasToBlob(data.canvas, 'image/png');
  const name = (activeLayer()?.name ?? 'sujeto').replace(/[^\w-]+/g, '_') + '-sujeto.png';
  await platform.saveFile(blob, { suggestedName: name, pick: true });
}
