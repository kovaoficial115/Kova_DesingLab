// Herramientas del lienzo. Cada herramienta recibe eventos en coordenadas de mundo y puede
// dibujar una superposición (overlay) que el visor pinta encima de la escena.

import type { Layer, ToolId } from '../core/types';
import {
  get, set, live, finishLive, cancelLive, docState, activeLayer, activeArtboard, commit, toast, bumpRender, getView, setView, silent,
  redrawScene, redrawOverlay, brushFor,
} from '../core/store';
import {
  hitTestLayers, selectLayers, setSelection, shapeSelection, polygonSelection, wandSelect, ensureRaster, selectionInLayer,
  insertLayers, cropArtboard, zoomTo, setActiveArtboard, updateArtboard, addArtboard, maskCanvas,
} from '../core/actions';
import { layerMatrix, layerSize, layerBounds, layerPivot, pivotBox, cloneCanvas, createCanvas, ctx2d, getImageData, resampleCanvas, hexToRgb, unionRect, type Rect } from '../core/util';
import { shapeLayer, textLayer, defaultText, descendants } from '../core/doc';
import { renderArtboard, processedContent, beginLiveCanvas, updateLiveRegion, invalidateLayer } from '../core/render';
import { makeStamp, makeTextureMask, dabPositions, type BrushSettings, type BrushToolId } from '../engine/brush';
import { magicWand } from '../engine/alpha';

export interface ToolEvent {
  wx: number; wy: number; sx: number; sy: number;
  shift: boolean; alt: boolean; ctrl: boolean; button: number; pressure: number; dblclick?: boolean;
}

export interface Overlay {
  rect?: { x: number; y: number; w: number; h: number; ellipse?: boolean } | null;
  lasso?: { x: number; y: number }[] | null;
  line?: { x1: number; y1: number; x2: number; y2: number } | null;
  crop?: Rect | null;
  snapLines?: { axis: 'x' | 'y'; pos: number }[];
  brush?: { x: number; y: number; r: number; ry?: number; angle?: number } | null;
  artboardDraft?: Rect | null;
  hoverLayerId?: string | null;
}
export const overlay: Overlay = {};
export const textEdit = { layerId: null as string | null, listeners: new Set<() => void>() };
export function setTextEdit(id: string | null) { textEdit.layerId = id; textEdit.listeners.forEach(f => f()); }

const redraw = () => bumpRender();

function selMode(e: ToolEvent) {
  if (e.shift && e.alt) return 'intersect' as const;
  if (e.shift) return 'add' as const;
  if (e.alt) return 'subtract' as const;
  return get().opts.selMode;
}
const normRect = (x1: number, y1: number, x2: number, y2: number, square = false): Rect => {
  let w = x2 - x1, h = y2 - y1;
  if (square) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
  return { x: Math.min(x1, x1 + w), y: Math.min(y1, y1 + h), w: Math.abs(w), h: Math.abs(h) };
};

// ---------- ajuste magnético (snap) ----------
function snapCandidates(excludeIds: Set<string>) {
  const s = docState()!;
  const xs: number[] = [], ys: number[] = [];
  for (const ab of s.artboards) {
    xs.push(ab.x, ab.x + ab.w / 2, ab.x + ab.w, ab.x + ab.margin, ab.x + ab.w - ab.margin);
    ys.push(ab.y, ab.y + ab.h / 2, ab.y + ab.h, ab.y + ab.margin, ab.y + ab.h - ab.margin);
  }
  for (const l of s.layers) {
    if (excludeIds.has(l.id) || l.kind === 'group' || !l.visible) continue;
    const b = layerBounds(l);
    xs.push(b.x, b.x + b.w / 2, b.x + b.w); ys.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  if (get().showGuides) for (const g of s.guides) (g.axis === 'x' ? xs : ys).push(g.pos);
  return { xs, ys };
}
function gridSnap(v: number) {
  const st = get();
  const ab = activeArtboard();
  if (!st.showGrid || !ab) return null;
  const { toPx } = require_units();
  const step = toPx(st.gridSize, st.unit, ab.dpi) / Math.max(1, st.gridSub);
  return Math.round(v / step) * step;
}
function require_units() { return { toPx: (v: number, u: any, dpi: number) => (u === 'px' ? v : u === 'in' ? v * dpi : u === 'cm' ? (v / 2.54) * dpi : (v / 25.4) * dpi) }; }

export function snapMove(b: Rect, exclude: Set<string>, enabled: boolean): { dx: number; dy: number; lines: { axis: 'x' | 'y'; pos: number }[] } {
  if (!enabled) return { dx: 0, dy: 0, lines: [] };
  const zoom = getView().zoom;
  const th = 6 / zoom;
  const { xs, ys } = snapCandidates(exclude);
  const bx = [b.x, b.x + b.w / 2, b.x + b.w], by = [b.y, b.y + b.h / 2, b.y + b.h];
  let best: { d: number; v: number } | null = null, bestY: { d: number; v: number } | null = null;
  for (const c of xs) for (const v of bx) { const d = c - v; if (Math.abs(d) < th && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, v: c }; }
  for (const c of ys) for (const v of by) { const d = c - v; if (Math.abs(d) < th && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, v: c }; }
  let dx = best?.d ?? 0, dy = bestY?.d ?? 0;
  const lines: { axis: 'x' | 'y'; pos: number }[] = [];
  if (best) lines.push({ axis: 'x', pos: best.v });
  if (bestY) lines.push({ axis: 'y', pos: bestY.v });
  if (!best) { const g = gridSnap(b.x); if (g != null && Math.abs(g - b.x) < th) dx = g - b.x; }
  if (!bestY) { const g = gridSnap(b.y); if (g != null && Math.abs(g - b.y) < th) dy = g - b.y; }
  return { dx, dy, lines };
}
export function snapPoint(x: number, y: number): { x: number; y: number } {
  if (!get().snap) return { x, y };
  const r = snapMove({ x, y, w: 0, h: 0 }, new Set(), true);
  overlay.snapLines = r.lines;
  return { x: x + r.dx, y: y + r.dy };
}

// ---------- herramienta Mover / Transformar ----------
type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rot';
const handleLocal: Record<Exclude<Handle, 'rot'>, [number, number]> = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };

export function transformTarget(): Layer | null {
  const s = docState();
  if (!s || s.selectedLayerIds.length !== 1) return null;
  const l = s.layers.find(x => x.id === s.selectedLayerIds[0]);
  if (!l || l.kind === 'group' || l.locked) return null;
  return l;
}
export function hitHandle(l: Layer, sx: number, sy: number): Handle | null {
  const v = getView();
  const { w, h } = layerSize(l);
  const m = new DOMMatrix([v.zoom, 0, 0, v.zoom, v.panX, v.panY]).multiply(layerMatrix(l));
  const pts = Object.entries(handleLocal).map(([k, [u, t]]) => ({ k: k as Handle, p: m.transformPoint(new DOMPoint(u * w, t * h)) }));
  for (const { k, p } of pts) if (Math.hypot(p.x - sx, p.y - sy) < 8) return k;
  // zona de rotación: cerca de las esquinas por fuera
  for (const { k, p } of pts) if (k.length === 2 && Math.hypot(p.x - sx, p.y - sy) < 24) return 'rot';
  return null;
}

let drag: any = null;

const moveTool = {
  cursor: 'default',
  down(e: ToolEvent) {
    const s = docState()!;
    const t = get().opts.showTransform ? transformTarget() : null;
    if (t) {
      const h = hitHandle(t, e.sx, e.sy);
      if (h) {
        const c = layerPivot(t);
        // cuadro de texto: las asas cambian el tamaño del cuadro (el texto se vuelve a ajustar);
        // con Ctrl/⌘ se escala como cualquier capa
        const boxMode = h !== 'rot' && t.kind === 'text' && !!t.text?.box && !e.ctrl;
        drag = { mode: h === 'rot' ? 'rotate' : boxMode ? 'box' : 'scale', handle: h, l0: t, m0: layerMatrix(t), center: c, start: { x: e.wx, y: e.wy } };
        return;
      }
    }
    // guías
    if (get().showGuides) {
      const th = 5 / getView().zoom;
      const g = s.guides.find(g => Math.abs((g.axis === 'x' ? e.wx : e.wy) - g.pos) < th);
      if (g) { drag = { mode: 'guide', id: g.id, axis: g.axis }; return; }
    }
    let hit: Layer | null = get().opts.autoSelect || e.ctrl ? hitTestLayers(e.wx, e.wy) : activeLayer();
    if (hit && !get().opts.autoSelect && !e.ctrl) {
      // sin autoselección se mueve la capa activa aunque se haga clic fuera
    }
    if (hit) {
      if (e.shift) {
        const ids = s.selectedLayerIds.includes(hit.id) ? s.selectedLayerIds.filter(x => x !== hit!.id) : [...s.selectedLayerIds, hit.id];
        selectLayers(ids);
      } else if (!s.selectedLayerIds.includes(hit.id)) selectLayers([hit.id]);
    } else if (!e.shift) {
      selectLayers([]);
      drag = { mode: 'marquee', x: e.wx, y: e.wy };
      return;
    }
    const st = docState()!;
    const ids = new Set<string>();
    for (const id of st.selectedLayerIds) { ids.add(id); descendants(st.layers, id).forEach(d => ids.add(d.id)); }
    const movers = st.layers.filter(l => ids.has(l.id) && !l.locked && l.kind !== 'group');
    if (!movers.length) return;
    if (e.alt) {
      // Alt+arrastrar duplica
      const copies = movers.map(l => ({ ...l, id: `${l.id}_c${Date.now().toString(36)}`, name: l.name + ' copia' }));
      insertLayers(copies, 'Duplicar');
      drag = { mode: 'move', start: { x: e.wx, y: e.wy }, orig: copies.map(l => ({ id: l.id, x: l.x, y: l.y })), bounds: unionRect(copies.map(layerBounds)), ids: new Set(copies.map(c => c.id)) };
      return;
    }
    drag = { mode: 'move', start: { x: e.wx, y: e.wy }, orig: movers.map(l => ({ id: l.id, x: l.x, y: l.y })), bounds: unionRect(movers.map(layerBounds)), ids };
  },
  move(e: ToolEvent) {
    if (!drag) {
      // hover para indicar capa bajo el cursor
      const t = transformTarget();
      const el = document.getElementById('kova-viewport');
      if (el) {
        const h = t ? hitHandle(t, e.sx, e.sy) : null;
        const cursors: Record<string, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', rot: 'alias' };
        let cur = h ? cursors[h] : 'default';
        if (!h && get().showGuides) {
          const th = 5 / getView().zoom;
          const g = docState()?.guides.find(g => Math.abs((g.axis === 'x' ? e.wx : e.wy) - g.pos) < th);
          if (g) cur = g.axis === 'x' ? 'col-resize' : 'row-resize';
        }
        el.style.cursor = cur;
      }
      return;
    }
    if (drag.mode === 'marquee') {
      overlay.rect = normRect(drag.x, drag.y, e.wx, e.wy);
      redrawOverlay();
      return;
    }
    if (drag.mode === 'guide') {
      live(s => ({ ...s, guides: s.guides.map(g => (g.id === drag.id ? { ...g, pos: drag.axis === 'x' ? e.wx : e.wy } : g)) }));
      return;
    }
    if (drag.mode === 'move') {
      let dx = e.wx - drag.start.x, dy = e.wy - drag.start.y;
      if (e.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const b = drag.bounds as Rect;
      const sn = snapMove({ ...b, x: b.x + dx, y: b.y + dy }, drag.ids, get().snap);
      dx += sn.dx; dy += sn.dy;
      overlay.snapLines = sn.lines;
      const map = new Map<string, { x: number; y: number }>(drag.orig.map((o: any) => [o.id, o]));
      live(s => ({ ...s, layers: s.layers.map(l => (map.has(l.id) ? { ...l, x: map.get(l.id)!.x + dx, y: map.get(l.id)!.y + dy } : l)) }));
      return;
    }
    const l0: Layer = drag.l0;
    if (drag.mode === 'rotate') {
      const a0 = Math.atan2(drag.start.y - drag.center.y, drag.start.x - drag.center.x);
      const a1 = Math.atan2(e.wy - drag.center.y, e.wx - drag.center.x);
      let rot = l0.rotation + ((a1 - a0) * 180) / Math.PI;
      if (e.shift) rot = Math.round(rot / 15) * 15;
      rot = ((rot % 360) + 540) % 360 - 180;
      live(s => ({ ...s, layers: s.layers.map(l => (l.id === l0.id ? { ...l, rotation: rot } : l)) }));
      return;
    }
    if (drag.mode === 'box') {
      const [hu, hv] = handleLocal[drag.handle as Exclude<Handle, 'rot'>];
      const m0 = drag.m0 as DOMMatrix, inv = m0.inverse();
      const p0 = inv.transformPoint(new DOMPoint(drag.start.x, drag.start.y)), p1 = inv.transformPoint(new DOMPoint(e.wx, e.wy));
      const dx = p1.x - p0.x, dy = p1.y - p0.y;
      const t0 = l0.text!, b0 = pivotBox(l0);
      const minW = Math.max(8, t0.fontSize * 0.6 + 2 * (t0.strokeWidth + 2));
      const w = hu === 0.5 ? b0.w : Math.max(minW, b0.w + (hu === 1 ? dx : -dx) * (e.alt ? 2 : 1));
      const hh = hv === 0.5 ? t0.box!.h : Math.max(1, b0.h + (hv === 1 ? dy : -dy) * (e.alt ? 2 : 1));
      const tmp: Layer = { ...l0, text: { ...t0, box: { w: Math.round(w), h: Math.round(hh) } } };
      const b1 = pivotBox(tmp);
      // el punto opuesto al asa (o el centro con Alt) queda quieto en el mundo; con las asas de los
      // lados el borde superior no se mueve, porque el texto crece hacia abajo
      const u = e.alt ? 0.5 : 1 - hu, v = hv === 0.5 ? 0 : e.alt ? 0.5 : 1 - hv;
      const Aw0 = m0.transformPoint(new DOMPoint(b0.ox + u * b0.w, b0.oy + v * b0.h));
      const Aw1 = layerMatrix(tmp).transformPoint(new DOMPoint(b1.ox + u * b1.w, b1.oy + v * b1.h));
      const nx = l0.x + Aw0.x - Aw1.x, ny = l0.y + Aw0.y - Aw1.y;
      live(s => ({ ...s, layers: s.layers.map(l => (l.id === l0.id ? { ...l, text: tmp.text, x: nx, y: ny } : l)) }));
      return;
    }
    if (drag.mode === 'scale') {
      const { w, h } = layerSize(l0);
      const [hu, hv] = handleLocal[drag.handle as Exclude<Handle, 'rot'>];
      const A = { x: (1 - hu) * w, y: (1 - hv) * h };
      const H = { x: hu * w, y: hv * h };
      const p = (drag.m0 as DOMMatrix).inverse().transformPoint(new DOMPoint(e.wx, e.wy));
      let rx = hu === 0.5 ? 1 : (p.x - A.x) / (H.x - A.x);
      let ry = hv === 0.5 ? 1 : (p.y - A.y) / (H.y - A.y);
      const corner = hu !== 0.5 && hv !== 0.5;
      const keep = corner ? !e.shift : e.shift;
      if (keep) {
        if (corner) { const r = Math.abs(rx) > Math.abs(ry) ? rx : ry; rx = Math.sign(rx || 1) * Math.abs(r); ry = Math.sign(ry || 1) * Math.abs(r); }
        else if (hu === 0.5) rx = Math.abs(ry); else ry = Math.abs(rx);
      }
      if (e.alt) { /* desde el centro */ A.x = w / 2; A.y = h / 2; rx = rx * 2 - 1; ry = ry * 2 - 1; if (hu === 0.5) rx = keep ? ry : 1; if (hv === 0.5) ry = keep ? rx : 1; }
      const minS = 0.001;
      const sx = l0.scaleX * (Math.abs(rx) < minS ? minS : rx), sy = l0.scaleY * (Math.abs(ry) < minS ? minS : ry);
      const Aw0 = (drag.m0 as DOMMatrix).transformPoint(new DOMPoint(A.x, A.y));
      const tmp = { ...l0, scaleX: sx, scaleY: sy };
      const Aw1 = layerMatrix(tmp).transformPoint(new DOMPoint(A.x, A.y));
      const nx = l0.x + Aw0.x - Aw1.x, ny = l0.y + Aw0.y - Aw1.y;
      live(s => ({ ...s, layers: s.layers.map(l => (l.id === l0.id ? { ...l, scaleX: sx, scaleY: sy, x: nx, y: ny } : l)) }));
    }
  },
  up(e: ToolEvent) {
    if (!drag) return;
    const d = drag;
    drag = null;
    overlay.snapLines = [];
    if (d.mode === 'marquee') {
      const r = overlay.rect;
      overlay.rect = null;
      if (r && r.w > 2 && r.h > 2) {
        const s = docState()!;
        const ids = s.layers.filter(l => l.kind !== 'group' && l.visible && !l.locked && !l.parentId && intersects(layerBounds(l), r)).map(l => l.id);
        selectLayers(ids);
      }
      redraw();
      return;
    }
    if (d.mode === 'guide') {
      // soltar la guía fuera del lienzo la elimina
      const el = document.getElementById('kova-viewport')!.getBoundingClientRect();
      const out = d.axis === 'x' ? e.sx < 0 || e.sx > el.width : e.sy < 0 || e.sy > el.height;
      if (out) { cancelLive(); commit('Eliminar guía', s => ({ ...s, guides: s.guides.filter(g => g.id !== d.id) })); }
      else finishLive('Mover guía');
      return;
    }
    finishLive(d.mode === 'move' ? 'Mover' : d.mode === 'rotate' ? 'Rotar' : d.mode === 'box' ? 'Tamaño del cuadro de texto' : 'Escalar');
    redraw();
  },
  dblclick(e: ToolEvent) {
    const l = hitTestLayers(e.wx, e.wy);
    if (l?.kind === 'text') { selectLayers([l.id]); setTextEdit(l.id); }
  },
};
function intersects(a: Rect, b: Rect) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }

// ---------- selecciones ----------
function marqueeTool(ellipse: boolean) {
  return {
    cursor: 'crosshair',
    down(e: ToolEvent) { const p = snapPoint(e.wx, e.wy); drag = { x: p.x, y: p.y, e }; },
    move(e: ToolEvent) {
      if (!drag) return;
      const p = snapPoint(e.wx, e.wy);
      overlay.rect = { ...normRect(drag.x, drag.y, p.x, p.y, e.shift && !drag.e.shift), ellipse };
      if (e.alt && !drag.e.alt) {
        const w = p.x - drag.x, h = p.y - drag.y;
        overlay.rect = { x: drag.x - Math.abs(w), y: drag.y - Math.abs(h), w: Math.abs(w) * 2, h: Math.abs(h) * 2, ellipse };
      }
      redrawOverlay();
    },
    up() {
      const r = overlay.rect;
      const ev = drag?.e as ToolEvent;
      drag = null; overlay.rect = null; overlay.snapLines = [];
      if (!r || r.w < 2 || r.h < 2) {
        if (ev && selMode(ev) === 'new') commit('Deseleccionar', s => ({ ...s, selection: null }));
        redraw();
        return;
      }
      setSelection(shapeSelection(ellipse ? 'ellipse' : 'rect', r), ellipse ? 'Marco elíptico' : 'Marco rectangular', selMode(ev));
    },
  };
}
const lassoTool = {
  cursor: 'crosshair',
  down(e: ToolEvent) { drag = { e }; overlay.lasso = [{ x: e.wx, y: e.wy }]; },
  move(e: ToolEvent) { if (!drag) return; overlay.lasso!.push({ x: e.wx, y: e.wy }); redrawOverlay(); },
  up() {
    const pts = overlay.lasso;
    const ev = drag?.e;
    overlay.lasso = null; drag = null;
    const sel = pts ? polygonSelection(pts) : null;
    if (sel) setSelection(sel, 'Lazo', selMode(ev));
    redraw();
  },
};
const wandTool = {
  cursor: 'crosshair',
  async down(e: ToolEvent) {
    const prev = get().opts.selMode;
    set(s => ({ opts: { ...s.opts, selMode: selMode(e) } }));
    await wandSelect(e.wx, e.wy);
    set(s => ({ opts: { ...s.opts, selMode: prev } }));
  },
  move() {}, up() {},
};

// ---------- recorte ----------
export const cropState = { rect: null as Rect | null };
const cropTool = {
  cursor: 'crosshair',
  down(e: ToolEvent) { const p = snapPoint(e.wx, e.wy); drag = { x: p.x, y: p.y }; },
  move(e: ToolEvent) {
    if (!drag) return;
    const p = snapPoint(e.wx, e.wy);
    cropState.rect = normRect(drag.x, drag.y, p.x, p.y, e.shift);
    overlay.crop = cropState.rect;
    redrawOverlay();
  },
  up() { drag = null; overlay.snapLines = []; set({}); redraw(); },
  dblclick() { applyCrop(); },
};
export function applyCrop() {
  if (cropState.rect && cropState.rect.w > 2) cropArtboard(cropState.rect);
  cropState.rect = null; overlay.crop = null; redraw(); set({});
}
export function cancelCrop() { cropState.rect = null; overlay.crop = null; redraw(); set({}); }

// ---------- cuentagotas ----------
export async function sampleColor(wx: number, wy: number): Promise<string | null> {
  const s = docState();
  const ab = activeArtboard();
  if (!s || !ab) return null;
  const c = await renderArtboard(s, { ...ab, x: Math.floor(wx), y: Math.floor(wy), w: 1, h: 1, background: ab.background }, 1);
  const d = ctx2d(c).getImageData(0, 0, 1, 1).data;
  if (d[3] === 0) return null;
  return '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('');
}
const eyedropperTool = {
  cursor: 'crosshair',
  async down(e: ToolEvent) {
    const hex = await sampleColor(e.wx, e.wy);
    if (!hex) return toast('Píxel transparente', 'info', 1500);
    if (e.alt) set({ bg: hex }); else set({ fg: hex });
  },
  move() {}, up() {},
};

// ---------- pinceles: pincel, borrador y restaurar ----------
// El trazo se pinta en un «búfer» del tamaño de la capa (cuánto cubre el trazo, sin pasar de la
// opacidad) y se compone sobre una copia de la capa. Para que vaya fluido aun en hojas DTF de
// 80 megapíxeles: cada toque es un sello ya teñido, solo se recompone el rectángulo que cambió,
// una vez por fotograma, y el visor dibuja reducciones que se actualizan solo en esa zona.
interface Stroke {
  layer: Layer; target: 'pixels' | 'mask'; base: HTMLCanvasElement; working: HTMLCanvasElement; buffer: SparseCanvas;
  last: { x: number; y: number } | null; carry: number; kind: BrushToolId; inv: DOMMatrix; scale: number; restoreSrc?: HTMLCanvasElement;
  sel: HTMLCanvasElement | null; brush: BrushSettings; stamp: HTMLCanvasElement; texture: CanvasPattern | null; textureScale: number;
  dirty: Rect[]; raf: number; procAt: number; rand: () => number;
}
let stroke: Stroke | null = null;
let lastStrokeEnd: { x: number; y: number } | null = null;

/**
 * Lienzo disperso: mosaicos de 512 px que se crean solo donde se pinta. El búfer del trazo no
 * necesita ocupar la capa entera (en una hoja DTF serían otros 300 MB) y cada lectura o copia
 * toca solo lienzos pequeños.
 */
class SparseCanvas {
  static T = 512;
  tiles = new Map<number, HTMLCanvasElement>();
  constructor(public w: number, public h: number) {}
  /** Pinta con `fn` (en coordenadas de la capa) en los mosaicos que toca el rectángulo. */
  paint(r: Rect, fn: (g: CanvasRenderingContext2D) => void) {
    const T = SparseCanvas.T;
    const i0 = Math.max(0, Math.floor(r.x / T)), i1 = Math.min(Math.ceil(this.w / T) - 1, Math.floor((r.x + r.w) / T));
    const j0 = Math.max(0, Math.floor(r.y / T)), j1 = Math.min(Math.ceil(this.h / T) - 1, Math.floor((r.y + r.h) / T));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * 65536 + i;
      let c = this.tiles.get(k);
      if (!c) { c = createCanvas(T, T); this.tiles.set(k, c); }
      const g = ctx2d(c);
      g.save();
      g.setTransform(1, 0, 0, 1, -i * T, -j * T);
      fn(g);
      g.restore();
    }
  }
  /** Copia el rectángulo (x, y, w, h) de la capa a (0, 0) de `g`. */
  copyTo(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    const T = SparseCanvas.T;
    for (let j = Math.floor(y / T); j <= Math.floor((y + h - 1) / T); j++) for (let i = Math.floor(x / T); i <= Math.floor((x + w - 1) / T); i++) {
      const c = this.tiles.get(j * 65536 + i);
      if (!c) continue;
      const sx = Math.max(x, i * T), sy = Math.max(y, j * T), ex = Math.min(x + w, (i + 1) * T), ey = Math.min(y + h, (j + 1) * T);
      if (ex > sx && ey > sy) g.drawImage(c, sx - i * T, sy - j * T, ex - sx, ey - sy, sx - x, sy - y, ex - sx, ey - sy);
    }
  }
}

// lienzos auxiliares del tamaño de la zona que se recompone (se reutilizan)
const scratchW = document.createElement('canvas'), scratchA = document.createElement('canvas');
const scratchB = document.createElement('canvas'), scratchS = document.createElement('canvas');
function scratch(c: HTMLCanvasElement, w: number, h: number) {
  if (c.width < w || c.height < h) { c.width = Math.max(c.width, w); c.height = Math.max(c.height, h); }
  const g = ctx2d(c);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.clearRect(0, 0, w, h);
  return g;
}

/**
 * Recompone una zona: original + trazo (con textura, selección y opacidad). Todo se hace en
 * lienzos del tamaño de la zona; de los lienzos grandes solo se leen o escriben píxeles de esa
 * zona (un drawImage desde un lienzo de 80 MP costaría ~25 ms aunque se copiara un trocito).
 */
function recomposite(st: Stroke, r: Rect) {
  const { x, y, w, h } = r;
  const W = scratch(scratchW, w, h);
  W.putImageData(ctx2d(st.base).getImageData(x, y, w, h), 0, 0);
  const A = scratch(scratchA, w, h);
  st.buffer.copyTo(A, x, y, w, h);
  if (st.texture) {
    // la textura está fija en la capa (no se mueve con el pincel)
    st.texture.setTransform(new DOMMatrix().translateSelf(-x, -y).scaleSelf(st.textureScale, st.textureScale));
    A.globalCompositeOperation = 'destination-in';
    A.fillStyle = st.texture;
    A.fillRect(0, 0, w, h);
  }
  if (st.sel) {
    scratch(scratchS, w, h).putImageData(ctx2d(st.sel).getImageData(x, y, w, h), 0, 0);
    A.globalCompositeOperation = 'destination-in';
    A.drawImage(scratchS, 0, 0, w, h, 0, 0, w, h);
  }
  let src = scratchA;
  if (st.kind === 'restore' && st.target === 'pixels' && st.restoreSrc) {
    const B = scratch(scratchB, w, h);
    B.putImageData(ctx2d(st.restoreSrc).getImageData(x, y, w, h), 0, 0);
    B.globalCompositeOperation = 'destination-in';
    B.drawImage(scratchA, 0, 0, w, h, 0, 0, w, h);
    src = scratchB;
  }
  W.globalAlpha = st.brush.opacity;
  W.globalCompositeOperation = st.target === 'pixels' && st.kind === 'eraser' ? 'destination-out' : 'source-over';
  W.drawImage(src, 0, 0, w, h, 0, 0, w, h);
  const out = W.getImageData(0, 0, w, h);
  ctx2d(st.working).putImageData(out, x, y);
  updateLiveRegion(st.working, r, out);
}

/** Aplica lo pintado desde el último fotograma. */
function flushStroke(st: Stroke) {
  if (st.raf) { cancelAnimationFrame(st.raf); st.raf = 0; }
  if (!st.dirty.length) return;
  const rects = st.dirty;
  st.dirty = [];
  for (const d of rects) {
    const x0 = Math.max(0, Math.floor(d.x)), y0 = Math.max(0, Math.floor(d.y));
    const x1 = Math.min(st.working.width, Math.ceil(d.x + d.w)), y1 = Math.min(st.working.height, Math.ceil(d.y + d.h));
    if (x1 > x0 && y1 > y0) recomposite(st, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  // capas con máscara o ajustes: su resultado se calcula sobre el lienzo entero, así que se
  // refresca como mucho cuatro veces por segundo (y al soltar)
  const l = st.layer;
  if ((l.mask && l.maskEnabled) || l.adjustments.some(a => a.enabled)) {
    const now = performance.now();
    if (now - st.procAt > 250) { st.procAt = now; invalidateLayer(l.id); }
  }
  redrawScene();
}

/** Añade una zona pendiente; se juntan si no crece mucho el área (un trazo rápido en diagonal
 *  con un pincel grande no debe convertirse en un rectángulo enorme). */
function addDirty(st: Stroke, r: Rect) {
  const last = st.dirty[st.dirty.length - 1];
  if (last) {
    const u = unionRect([last, r])!;
    if (u.w * u.h <= 1.5 * (last.w * last.h + r.w * r.h)) { st.dirty[st.dirty.length - 1] = u; return; }
  }
  st.dirty.push(r);
}

function stampDab(st: Stroke, x: number, y: number, d: number) {
  const b = st.brush;
  let size = d;
  if (b.sizeJitter > 0) size *= 1 - b.sizeJitter * st.rand();
  if (b.scatter > 0) { const a = st.rand() * Math.PI * 2, k = st.rand() * b.scatter * d; x += Math.cos(a) * k; y += Math.sin(a) * k; }
  const angle = b.angle + (b.angleJitter > 0 ? (st.rand() - 0.5) * 360 * b.angleJitter : 0);
  const sh = size * b.roundness;
  // zona afectada (con margen para el giro)
  const half = (angle === 0 ? Math.max(size, sh) / 2 : Math.hypot(size, sh) / 2) + 2;
  const r = { x: x - half, y: y - half, w: half * 2, h: half * 2 };
  st.buffer.paint(r, g => {
    g.globalAlpha = b.flow;
    g.imageSmoothingEnabled = true;
    if (angle === 0) g.drawImage(st.stamp, x - size / 2, y - sh / 2, size, sh);
    else {
      g.translate(x, y);
      g.rotate((angle * Math.PI) / 180);
      g.drawImage(st.stamp, -size / 2, -sh / 2, size, sh);
    }
  });
  addDirty(st, r);
}

function brushTool(kind: BrushToolId) {
  return {
    cursor: 'none',
    async down(e: ToolEvent) {
      const s = docState()!;
      let l = activeLayer();
      if (!l) return toast('Selecciona una capa', 'warn');
      const { opts, fg } = get();
      const brush = { ...brushFor(kind) };
      const target = opts.brushTarget === 'mask' && l.mask ? 'mask' : 'pixels';
      if (target === 'pixels') { l = await ensureRaster(l); if (!l) return; }
      const base = target === 'mask' ? l.mask! : l.canvas!;
      const working = cloneCanvas(base);
      beginLiveCanvas(working, base);
      const buffer = new SparseCanvas(base.width, base.height);
      const inv = layerMatrix(l).inverse();
      const scale = Math.max(Math.abs(l.scaleX), Math.abs(l.scaleY));
      let color = kind === 'brush' ? fg : '#000000';
      if (target === 'mask') {
        const [r, g, b] = hexToRgb(fg);
        const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        const v = kind === 'eraser' ? 0 : kind === 'restore' ? 255 : lum;
        color = '#' + v.toString(16).padStart(2, '0').repeat(3);
      }
      let restoreSrc: HTMLCanvasElement | undefined;
      if (kind === 'restore' && target === 'pixels') {
        const o = l.origin ?? l.canvas!;
        restoreSrc = o.width === base.width && o.height === base.height ? o : resampleCanvas(o, base.width, base.height);
      }
      const sel = s.selection ? selectionInLayer(s.selection, l) : null;
      const stamp = makeStamp(brush, color, brush.size / scale);
      const texMask = makeTextureMask(brush);
      const texture = texMask ? ctx2d(scratchA).createPattern(texMask, 'repeat') : null;
      stroke = {
        layer: l, target, base, working, buffer, last: null, carry: 0, kind, inv, scale, restoreSrc, sel, brush, stamp,
        texture, textureScale: Math.max(0.05, brush.textureScale) / scale, dirty: [], raf: 0, procAt: performance.now(), rand: Math.random,
      };
      const id = l.id;
      live(st => ({ ...st, layers: st.layers.map(x => (x.id === id ? (target === 'mask' ? { ...x, mask: working } : { ...x, canvas: working }) : x)) }));
      if (e.shift && lastStrokeEnd) { const q = inv.transformPoint(new DOMPoint(lastStrokeEnd.x, lastStrokeEnd.y)); stroke.last = { x: q.x, y: q.y }; }
      this.move(e);
    },
    move(e: ToolEvent) {
      const b = brushFor(kind);
      overlay.brush = { x: e.wx, y: e.wy, r: b.size / 2, ry: (b.size / 2) * b.roundness, angle: b.angle };
      if (!stroke) { redrawOverlay(); return; }
      const st = stroke;
      const p = st.inv.transformPoint(new DOMPoint(e.wx, e.wy));
      const pen = st.brush.pressure && e.pressure > 0 && e.pressure !== 0.5;
      const d = Math.max(1, (st.brush.size / st.scale) * (pen ? 0.3 + e.pressure * 0.7 : 1));
      const step = Math.max(0.5, d * Math.max(0.01, st.brush.spacing));
      if (!st.last) stampDab(st, p.x, p.y, d);
      else {
        const r = dabPositions(st.last, p, step, st.carry);
        for (const q of r.points) stampDab(st, q.x, q.y, d);
        st.carry = r.carry;
      }
      st.last = { x: p.x, y: p.y };
      if (!st.raf && st.dirty.length) st.raf = requestAnimationFrame(() => { st.raf = 0; if (stroke === st) flushStroke(st); });
      redrawOverlay();
    },
    up(e: ToolEvent) {
      if (!stroke) return;
      const st = stroke;
      stroke = null;
      void e;
      flushStroke(st);
      if (st.last) { const q = st.inv.inverse().transformPoint(new DOMPoint(st.last.x, st.last.y)); lastStrokeEnd = { x: q.x, y: q.y }; }
      // el lienzo de trabajo ya no cambia: pasa a ser el bitmap (inmutable) de la capa tal cual,
      // sin copiarlo, y conserva sus reducciones al día
      if (st.layer.mask || st.layer.adjustments.length) invalidateLayer(st.layer.id);
      finishLive(kind === 'brush' ? 'Pincel' : kind === 'eraser' ? 'Borrador' : 'Restaurar');
    },
    leave() { overlay.brush = null; redrawOverlay(); },
  };
}

// ---------- bote de pintura ----------
const fillTool = {
  cursor: 'crosshair',
  async down(e: ToolEvent) {
    let l = activeLayer();
    if (!l) return toast('Selecciona una capa', 'warn');
    l = await ensureRaster(l);
    if (!l) return;
    const { opts, fg } = get();
    const p = layerMatrix(l).inverse().transformPoint(new DOMPoint(e.wx, e.wy));
    const src = l.canvas!;
    const mask = magicWand(getImageData(src), p.x, p.y, { tolerance: opts.fillTolerance, contiguous: opts.fillContiguous, useAlpha: true });
    const m = maskCanvas(mask, src.width, src.height);
    const s = docState()!;
    if (s.selection) { const g = ctx2d(m); g.globalCompositeOperation = 'destination-in'; g.drawImage(selectionInLayer(s.selection, l), 0, 0); }
    const tint = createCanvas(src.width, src.height);
    const tg = ctx2d(tint);
    tg.fillStyle = fg; tg.fillRect(0, 0, tint.width, tint.height);
    tg.globalCompositeOperation = 'destination-in';
    tg.drawImage(m, 0, 0);
    const out = cloneCanvas(src);
    ctx2d(out).drawImage(tint, 0, 0);
    commit('Bote de pintura', st => ({ ...st, layers: st.layers.map(x => (x.id === l!.id ? { ...x, canvas: out } : x)) }));
  },
  move() {}, up() {},
};

// ---------- degradado ----------
const gradientTool = {
  cursor: 'crosshair',
  down(e: ToolEvent) { drag = { x: e.wx, y: e.wy }; overlay.line = { x1: e.wx, y1: e.wy, x2: e.wx, y2: e.wy }; },
  move(e: ToolEvent) {
    if (!drag) return;
    let x2 = e.wx, y2 = e.wy;
    if (e.shift) { const a = Math.round(Math.atan2(y2 - drag.y, x2 - drag.x) / (Math.PI / 4)) * (Math.PI / 4); const d = Math.hypot(x2 - drag.x, y2 - drag.y); x2 = drag.x + Math.cos(a) * d; y2 = drag.y + Math.sin(a) * d; }
    overlay.line = { x1: drag.x, y1: drag.y, x2, y2 };
    redrawOverlay();
  },
  async up() {
    const ln = overlay.line;
    drag = null; overlay.line = null; redraw();
    if (!ln || Math.hypot(ln.x2 - ln.x1, ln.y2 - ln.y1) < 3) return;
    let l = activeLayer();
    if (!l) return toast('Selecciona una capa', 'warn');
    l = await ensureRaster(l);
    if (!l) return;
    const { opts, fg, bg } = get();
    const src = l.canvas!;
    const inv = layerMatrix(l).inverse();
    const a = inv.transformPoint(new DOMPoint(ln.x1, ln.y1)), b = inv.transformPoint(new DOMPoint(ln.x2, ln.y2));
    const grad = createCanvas(src.width, src.height);
    const g = ctx2d(grad);
    const gr = opts.gradientType === 'radial' ? g.createRadialGradient(a.x, a.y, 0, a.x, a.y, Math.hypot(b.x - a.x, b.y - a.y)) : g.createLinearGradient(a.x, a.y, b.x, b.y);
    const [r, gg, bb] = hexToRgb(fg);
    gr.addColorStop(0, fg);
    gr.addColorStop(1, opts.gradientToTransparent ? `rgba(${r},${gg},${bb},0)` : bg);
    g.fillStyle = gr;
    g.fillRect(0, 0, grad.width, grad.height);
    const s = docState()!;
    if (s.selection) { g.globalCompositeOperation = 'destination-in'; g.drawImage(selectionInLayer(s.selection, l), 0, 0); }
    const out = cloneCanvas(src);
    ctx2d(out).drawImage(grad, 0, 0);
    commit('Degradado', st => ({ ...st, layers: st.layers.map(x => (x.id === l!.id ? { ...x, canvas: out } : x)) }));
  },
};

// ---------- texto ----------
const textTool = {
  cursor: 'text',
  // clic: texto de punto (una línea por párrafo); arrastrar: cuadro de texto (el texto se ajusta al ancho)
  down(e: ToolEvent) {
    const hit = hitTestLayers(e.wx, e.wy);
    if (hit?.kind === 'text' && !e.shift) { selectLayers([hit.id]); setTextEdit(hit.id); drag = null; return; }
    drag = { x: e.wx, y: e.wy, sx: e.sx, sy: e.sy };
  },
  move(e: ToolEvent) {
    if (!drag) return;
    if (Math.hypot(e.sx - drag.sx, e.sy - drag.sy) < 6 && !overlay.rect) return;
    overlay.rect = normRect(drag.x, drag.y, e.wx, e.wy);
    redrawOverlay();
  },
  up(e: ToolEvent) {
    if (!drag) return;
    const d = drag;
    drag = null;
    const r = overlay.rect;
    overlay.rect = null;
    const { opts, fg } = get();
    const t = { ...defaultText(fg, opts.fontSize), fontFamily: opts.fontFamily, fontWeight: opts.fontWeight, text: 'Texto' };
    const boxed = r && Math.hypot(e.sx - d.sx, e.sy - d.sy) >= 8 && r.w * getView().zoom >= 8;
    const l = boxed
      ? textLayer({ ...t, box: { w: Math.max(t.fontSize, Math.round(r!.w)), h: Math.max(1, Math.round(r!.h)) } }, r!.x, r!.y)
      : textLayer(t, d.x, d.y - opts.fontSize * 0.6);
    if (boxed) l.name = 'Cuadro de texto';
    insertLayers([l], boxed ? 'Nuevo cuadro de texto' : 'Nuevo texto');
    setTextEdit(l.id);
    redraw();
  },
};

// ---------- formas ----------
const shapeTool = {
  cursor: 'crosshair',
  down(e: ToolEvent) { const p = snapPoint(e.wx, e.wy); drag = { x: p.x, y: p.y }; },
  move(e: ToolEvent) {
    if (!drag) return;
    const p = snapPoint(e.wx, e.wy);
    const type = get().opts.shapeType;
    if (type === 'line') overlay.line = { x1: drag.x, y1: drag.y, x2: p.x, y2: p.y };
    else overlay.rect = { ...normRect(drag.x, drag.y, p.x, p.y, e.shift), ellipse: type === 'ellipse' };
    redrawOverlay();
  },
  up() {
    const { opts, fg, bg } = get();
    const r = overlay.rect, ln = overlay.line;
    drag = null; overlay.rect = null; overlay.line = null; overlay.snapLines = [];
    if (opts.shapeType === 'line' && ln) {
      const len = Math.hypot(ln.x2 - ln.x1, ln.y2 - ln.y1);
      if (len < 3) return redraw();
      const th = Math.max(1, opts.shapeStrokeWidth);
      let l = shapeLayer({ shape: 'line', w: len, h: th, fill: fg, stroke: null, strokeWidth: th, radius: 0 }, 0, 0);
      const ang = (Math.atan2(ln.y2 - ln.y1, ln.x2 - ln.x1) * 180) / Math.PI;
      const cx = (ln.x1 + ln.x2) / 2, cy = (ln.y1 + ln.y2) / 2;
      l = { ...l, rotation: ang, x: cx - len / 2, y: cy - th / 2 };
      insertLayers([l], 'Línea');
      return;
    }
    if (!r || r.w < 2 || r.h < 2) return redraw();
    const l = shapeLayer({
      shape: opts.shapeType, w: r.w, h: r.h, fill: opts.shapeFill ? fg : null, stroke: opts.shapeStroke ? bg : null,
      strokeWidth: opts.shapeStrokeWidth, radius: opts.shapeRadius,
    }, r.x, r.y);
    insertLayers([l], 'Forma');
  },
};

// ---------- mano y zoom ----------
const handTool = {
  cursor: 'grab',
  down(e: ToolEvent) { const v = getView(); drag = { sx: e.sx, sy: e.sy, px: v.panX, py: v.panY }; },
  move(e: ToolEvent) { if (!drag) return; setView({ panX: drag.px + e.sx - drag.sx, panY: drag.py + e.sy - drag.sy }); },
  up() { drag = null; },
};
const zoomTool = {
  cursor: 'zoom-in',
  down(e: ToolEvent) { const v = getView(); zoomTo(v.zoom * (e.alt ? 1 / 1.5 : 1.5), e.sx, e.sy); },
  move() {}, up() {},
};

// ---------- mesas de trabajo ----------
const artboardTool = {
  cursor: 'crosshair',
  down(e: ToolEvent) {
    const s = docState()!;
    const v = getView();
    const hitAb = [...s.artboards].reverse().find(a => e.wx >= a.x && e.wx <= a.x + a.w && e.wy >= a.y && e.wy <= a.y + a.h);
    // esquina inferior derecha → redimensionar
    for (const a of s.artboards) {
      if (Math.hypot((a.x + a.w - e.wx) * v.zoom, (a.y + a.h - e.wy) * v.zoom) < 10) {
        setActiveArtboard(a.id);
        drag = { mode: 'resize', ab: a, sx: e.wx, sy: e.wy };
        return;
      }
    }
    if (hitAb) {
      setActiveArtboard(hitAb.id);
      drag = { mode: 'move', ab: hitAb, sx: e.wx, sy: e.wy };
      return;
    }
    drag = { mode: 'new', sx: e.wx, sy: e.wy };
  },
  move(e: ToolEvent) {
    if (!drag) return;
    if (drag.mode === 'new') { overlay.artboardDraft = normRect(drag.sx, drag.sy, e.wx, e.wy, e.shift); redrawOverlay(); return; }
    const a = drag.ab;
    if (drag.mode === 'move') {
      const dx = Math.round(e.wx - drag.sx), dy = Math.round(e.wy - drag.sy);
      drag.dx = dx; drag.dy = dy;
      live(s => ({ ...s, artboards: s.artboards.map(x => (x.id === a.id ? { ...x, x: a.x + dx, y: a.y + dy } : x)) }));
    } else {
      const w = Math.max(16, Math.round(a.w + e.wx - drag.sx)), h = Math.max(16, Math.round(a.h + e.wy - drag.sy));
      live(s => ({ ...s, artboards: s.artboards.map(x => (x.id === a.id ? { ...x, w, h } : x)) }));
    }
  },
  up() {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.mode === 'new') {
      const r = overlay.artboardDraft;
      overlay.artboardDraft = null;
      if (r && r.w > 10 && r.h > 10) addArtboard({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });
      redraw();
    } else if (d.mode === 'move') {
      cancelLive();
      if (d.dx || d.dy) updateArtboard(d.ab.id, { x: d.ab.x + d.dx, y: d.ab.y + d.dy }, 'Mover mesa', true);
    } else finishLive('Redimensionar mesa');
  },
};

export const tools: Record<ToolId, any> = {
  move: moveTool,
  marquee: marqueeTool(false),
  ellipseMarquee: marqueeTool(true),
  lasso: lassoTool,
  wand: wandTool,
  crop: cropTool,
  eyedropper: eyedropperTool,
  brush: brushTool('brush'),
  eraser: brushTool('eraser'),
  restore: brushTool('restore'),
  fill: fillTool,
  gradient: gradientTool,
  text: textTool,
  shape: shapeTool,
  hand: handTool,
  zoom: zoomTool,
  artboard: artboardTool,
};

export function setTool(t: ToolId) {
  if (get().tool === 'crop' && t !== 'crop') cancelCrop();
  overlay.brush = null;
  set({ tool: t });
}

export function isDragging() { return !!drag || !!stroke; }
export { silent, processedContent };
