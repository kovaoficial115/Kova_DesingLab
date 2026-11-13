import { create } from 'zustand';
import type { Doc, DocState, ToolId, Unit, View, Layer } from './types';
import { defaultBrushes, sanitizeBrushes, type BrushSettings, type BrushToolId } from '../engine/brush';

export type PanelId = 'color' | 'properties' | 'adjustments' | 'layers' | 'history' | 'artboards' | 'channels';

export interface PanelConf { id: PanelId; visible: boolean; collapsed: boolean }

export interface ToolOptions {
  brushTarget: 'pixels' | 'mask';
  wandTolerance: number;
  wandContiguous: boolean;
  wandSampleAll: boolean;
  selMode: 'new' | 'add' | 'subtract' | 'intersect';
  feather: number;
  shapeType: 'rect' | 'ellipse' | 'line';
  shapeFill: boolean;
  shapeStroke: boolean;
  shapeStrokeWidth: number;
  shapeRadius: number;
  fillTolerance: number;
  fillContiguous: boolean;
  gradientType: 'linear' | 'radial';
  gradientToTransparent: boolean;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  showTransform: boolean;
  autoSelect: boolean;
}

export type DialogState = { type: string; props?: any } | null;

export interface Toast { id: number; text: string; kind: 'info' | 'ok' | 'warn' | 'error' }

export interface AppState {
  screen: 'home' | 'editor' | 'studio';
  docs: Doc[];
  activeDocId: string | null;
  views: Record<string, View>;
  tool: ToolId;
  opts: ToolOptions;
  /** ajustes de punta de cada herramienta de pintura (el borrador tiene los suyos) */
  brushes: Record<BrushToolId, BrushSettings>;
  fg: string;
  bg: string;
  unit: Unit;
  panels: PanelConf[];
  rightWidth: number;
  showRulers: boolean;
  showGrid: boolean;
  showGuides: boolean;
  snap: boolean;
  gridSize: number; // en la unidad actual
  gridSub: number;
  hideUI: boolean;
  /** Cajón de paneles abierto (solo en pantallas estrechas; no se guarda). */
  dockOpen: boolean;
  compare: boolean;
  proof: boolean;
  channelView: 'all' | 'c' | 'm' | 'y' | 'k' | 'r' | 'g' | 'b' | 'alpha';
  dialog: DialogState;
  toasts: Toast[];
  busy: string | null;
  renderTick: number;
  cursor: { x: number; y: number } | null;
  swatches: string[];
  /** segundos entre el último cambio y el autoguardado; 0 = desactivado */
  autosaveSec: number;
}

const defaultPanels: PanelConf[] = [
  { id: 'color', visible: true, collapsed: false },
  { id: 'properties', visible: true, collapsed: false },
  { id: 'adjustments', visible: true, collapsed: true },
  { id: 'layers', visible: true, collapsed: false },
  { id: 'channels', visible: false, collapsed: false },
  { id: 'artboards', visible: true, collapsed: true },
  { id: 'history', visible: true, collapsed: true },
];

function loadPrefs(): Partial<AppState> {
  try {
    const raw = localStorage.getItem('kova.prefs');
    if (!raw) return {};
    const p = JSON.parse(raw);
    const panels: PanelConf[] = Array.isArray(p.panels) && p.panels.length === defaultPanels.length ? p.panels : defaultPanels;
    return { ...p, panels, brushes: sanitizeBrushes(p.brushes) };
  } catch { return {}; }
}

export const useStore = create<AppState>(() => ({
  screen: 'home',
  docs: [],
  activeDocId: null,
  views: {},
  tool: 'move',
  opts: {
    brushTarget: 'pixels',
    wandTolerance: 32, wandContiguous: true, wandSampleAll: false, selMode: 'new', feather: 0,
    shapeType: 'rect', shapeFill: true, shapeStroke: false, shapeStrokeWidth: 8, shapeRadius: 0,
    fillTolerance: 32, fillContiguous: true, gradientType: 'linear', gradientToTransparent: false,
    fontFamily: 'Inter, sans-serif', fontSize: 160, fontWeight: 700, showTransform: true, autoSelect: true,
  },
  brushes: defaultBrushes(),
  fg: '#ffffff',
  bg: '#000000',
  unit: 'cm',
  panels: defaultPanels,
  rightWidth: 300,
  showRulers: true,
  showGrid: false,
  showGuides: true,
  snap: true,
  gridSize: 1,
  gridSub: 4,
  hideUI: false,
  dockOpen: false,
  compare: false,
  proof: false,
  channelView: 'all',
  dialog: null,
  toasts: [],
  busy: null,
  renderTick: 0,
  cursor: null,
  autosaveSec: 4,
  swatches: ['#000000', '#ffffff', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#007aff', '#5856d6', '#af52de', '#ff2d55', '#8e8e93', '#d21625', '#00001f', '#f0e7de'],
  ...loadPrefs(),
}));

// Persistencia de preferencias de interfaz
useStore.subscribe((s, prev) => {
  if (s.panels !== prev.panels || s.unit !== prev.unit || s.rightWidth !== prev.rightWidth || s.showRulers !== prev.showRulers ||
    s.gridSize !== prev.gridSize || s.swatches !== prev.swatches || s.snap !== prev.snap || s.autosaveSec !== prev.autosaveSec || s.brushes !== prev.brushes) {
    try {
      localStorage.setItem('kova.prefs', JSON.stringify({ panels: s.panels, unit: s.unit, rightWidth: s.rightWidth, showRulers: s.showRulers, gridSize: s.gridSize, gridSub: s.gridSub, swatches: s.swatches, snap: s.snap, autosaveSec: s.autosaveSec, brushes: s.brushes }));
    } catch { /* almacenamiento no disponible */ }
  }
});

export const set = useStore.setState;
export const get = useStore.getState;

export function activeDoc(): Doc | null {
  const s = get();
  return s.docs.find(d => d.id === s.activeDocId) ?? null;
}
export function useActiveDoc(): Doc | null {
  return useStore(s => s.docs.find(d => d.id === s.activeDocId) ?? null);
}

export function bumpRender() { set(s => ({ renderTick: s.renderTick + 1 })); }

// Repintado directo del visor, sin pasar por React: un trazo de pincel o el lazo cambian a cada
// movimiento del ratón, y avisar con `renderTick` volvía a pintar también paneles, miniaturas y
// menús. El visor junta los avisos en uno por fotograma.
const repaintListeners = { scene: new Set<() => void>(), overlay: new Set<() => void>() };
export function onRepaint(kind: 'scene' | 'overlay', fn: () => void) { repaintListeners[kind].add(fn); return () => { repaintListeners[kind].delete(fn); }; }
/** Vuelve a pintar el lienzo (y la superposición) en el próximo fotograma. */
export function redrawScene() { repaintListeners.scene.forEach(f => f()); }
/** Solo la superposición: lazo, marcos, cursor del pincel… */
export function redrawOverlay() { repaintListeners.overlay.forEach(f => f()); }
/** Ajustes de la herramienta de pintura activa. */
export function brushFor(tool: BrushToolId): BrushSettings { return get().brushes[tool]; }
export function setBrush(tool: BrushToolId, patch: Partial<BrushSettings>) { set(s => ({ brushes: { ...s.brushes, [tool]: { ...s.brushes[tool], ...patch } } })); }

let toastId = 1;
export function toast(text: string, kind: Toast['kind'] = 'info', ms = 3500) {
  const id = toastId++;
  set(s => ({ toasts: [...s.toasts, { id, text, kind }] }));
  setTimeout(() => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), ms);
}

export async function withBusy<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  set({ busy: label });
  await new Promise(r => setTimeout(r, 30));
  try { return await fn(); }
  catch (e: any) { console.error(e); toast(e?.message || String(e), 'error', 6000); return undefined; }
  finally { set({ busy: null }); }
}

// ---------- Historial ----------
const HISTORY_LIMIT = 60;
const liveBase = new Map<string, { state: DocState; label: string }>();

/** Ganchos de la colaboración: deshacer/rehacer con el historial de Liveblocks (solo los cambios
 *  propios) y bloqueo de la edición para lectores o salas que aún cargan. */
export const collabHooks: {
  undo?: (docId: string) => boolean;
  redo?: (docId: string) => boolean;
  blocked?: (docId: string) => string | null;
} = {};
let lastBlockToast = 0;
function isBlocked(docId: string) {
  const why = collabHooks.blocked?.(docId);
  if (why && Date.now() - lastBlockToast > 2500) { lastBlockToast = Date.now(); toast(why, 'warn'); }
  return !!why;
}
/** true mientras hay un cambio en vivo (arrastre, trazo) sin consolidar. */
export function isLive(docId: string) { return liveBase.has(docId); }
/** Aplica un cambio remoto al estado actual y a la base del cambio en vivo, sin historial. */
export function patchRemote(docId: string, fn: (s: DocState) => DocState, docFn?: (d: Doc) => Doc) {
  const base = liveBase.get(docId);
  if (base) base.state = fn(base.state);
  patchDoc(docId, d => { const nd = { ...d, state: fn(d.state) }; return docFn ? docFn(nd) : nd; });
}

function patchDoc(docId: string, fn: (d: Doc) => Doc) {
  set(s => ({ docs: s.docs.map(d => (d.id === docId ? fn(d) : d)) }));
}

/** Aplica un cambio registrándolo en el historial. */
export function commit(label: string, updater: (s: DocState) => DocState, docId = get().activeDocId) {
  if (!docId) return;
  if (isBlocked(docId)) { cancelLive(docId); return; }
  const base = liveBase.get(docId);
  liveBase.delete(docId);
  patchDoc(docId, d => {
    const prevState = base ? base.state : d.state;
    const next = updater(d.state);
    if (next === d.state && !base) return d;
    const past = [...d.past, { label: d.lastLabel, state: prevState, time: Date.now() }].slice(-HISTORY_LIMIT);
    return { ...d, state: next, past, future: [], lastLabel: label, dirty: true };
  });
}

/** Cambio en vivo (p. ej. durante un arrastre); se consolida con finishLive(). */
export function live(updater: (s: DocState) => DocState, docId = get().activeDocId) {
  if (!docId) return;
  if (isBlocked(docId)) return;
  const doc = get().docs.find(d => d.id === docId);
  if (!doc) return;
  if (!liveBase.has(docId)) liveBase.set(docId, { state: doc.state, label: doc.lastLabel });
  patchDoc(docId, d => ({ ...d, state: updater(d.state) }));
}
export function finishLive(label: string, docId = get().activeDocId) {
  if (!docId || !liveBase.has(docId)) return;
  commit(label, s => s, docId);
}
export function cancelLive(docId = get().activeDocId) {
  if (!docId) return;
  const base = liveBase.get(docId);
  if (!base) return;
  liveBase.delete(docId);
  patchDoc(docId, d => ({ ...d, state: base.state }));
}

/** Cambio sin historial (estado efímero como la selección de capas en el panel). */
export function silent(updater: (s: DocState) => DocState, docId = get().activeDocId) {
  if (!docId) return;
  patchDoc(docId, d => ({ ...d, state: updater(d.state) }));
}

export function undo() {
  const d = activeDoc();
  if (!d) return;
  if (collabHooks.undo?.(d.id)) return;
  if (!d.past.length) return;
  const prev = d.past[d.past.length - 1];
  patchDoc(d.id, doc => ({
    ...doc, state: prev.state, past: doc.past.slice(0, -1),
    future: [{ label: doc.lastLabel, state: doc.state, time: Date.now() }, ...doc.future], lastLabel: prev.label, dirty: true,
  }));
}
export function redo() {
  const d = activeDoc();
  if (!d) return;
  if (collabHooks.redo?.(d.id)) return;
  if (!d.future.length) return;
  const nx = d.future[0];
  patchDoc(d.id, doc => ({
    ...doc, state: nx.state, future: doc.future.slice(1),
    past: [...doc.past, { label: doc.lastLabel, state: doc.state, time: Date.now() }], lastLabel: nx.label, dirty: true,
  }));
}
/** Salta a una entrada del historial: index en la lista combinada [past..., actual, future...]. */
export function jumpHistory(index: number) {
  const d = activeDoc();
  if (!d) return;
  const cur = d.past.length;
  if (index < cur) for (let i = 0; i < cur - index; i++) undo();
  else if (index > cur) for (let i = 0; i < index - cur; i++) redo();
}

// ---------- Accesos rápidos al estado del documento ----------
export function docState(): DocState | null { return activeDoc()?.state ?? null; }
export function selectedLayers(): Layer[] {
  const s = docState();
  if (!s) return [];
  return s.layers.filter(l => s.selectedLayerIds.includes(l.id));
}
export function activeLayer(): Layer | null {
  const s = docState();
  if (!s || !s.selectedLayerIds.length) return null;
  const id = s.selectedLayerIds[s.selectedLayerIds.length - 1];
  return s.layers.find(l => l.id === id) ?? null;
}
export function activeArtboard() {
  const s = docState();
  if (!s) return null;
  return s.artboards.find(a => a.id === s.activeArtboardId) ?? s.artboards[0] ?? null;
}
export function getView(docId?: string | null): View {
  const id = docId ?? get().activeDocId;
  return (id && get().views[id]) || { zoom: 1, panX: 0, panY: 0 };
}
export function setView(v: Partial<View>, docId = get().activeDocId) {
  if (!docId) return;
  // cualquier zoom o desplazamiento manual desactiva el reajuste automático
  set(s => ({ views: { ...s.views, [docId]: { ...getView(docId), autoFit: false, ...v } } }));
}
