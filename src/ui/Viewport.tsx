import { StageSlot } from '../collab/ui';
import { platform } from '../platform';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore, get, set, getView, setView, activeLayer, live, finishLive, cancelLive } from '../core/store';
import type { Doc, Layer, Selection } from '../core/types';
import { renderLayers } from '../core/render';
import { layerMatrix, layerSize, createCanvas, ctx2d, fromPx, toPx, layerBounds } from '../core/util';
import { tools, overlay, textEdit, setTextEdit, transformTarget, cropState, type ToolEvent } from '../tools/tools';
import { zoomTo, fitToScreen, addGuide, hitTestLayers, selectLayers } from '../core/actions';
import { MenuList, type Item } from './MenuBar';
import { placeFiles } from '../io/fileOps';
import { softProof, channelView } from '../engine/cms';
import { Slider } from './components/controls';
import { KOVA } from './theme';

export const keys = { space: false };

let checkerPattern: CanvasPattern | null = null;
function checker(g: CanvasRenderingContext2D) {
  if (checkerPattern) return checkerPattern;
  const c = createCanvas(16, 16);
  const cg = ctx2d(c);
  cg.fillStyle = '#ffffff'; cg.fillRect(0, 0, 16, 16);
  cg.fillStyle = '#d8d8dc'; cg.fillRect(0, 0, 8, 8); cg.fillRect(8, 8, 8, 8);
  checkerPattern = g.createPattern(c, 'repeat');
  return checkerPattern!;
}

function drawScene(canvas: HTMLCanvasElement, doc: Doc, W: number, H: number, dpr: number, compareX: number | null) {
  const st = get();
  const v = getView(doc.id);
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  const g = ctx2d(canvas, { willReadFrequently: st.proof || st.channelView !== 'all' });
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.fillStyle = KOVA.pasteboard;
  g.fillRect(0, 0, canvas.width, canvas.height);
  const s = doc.state;
  const z = v.zoom * dpr;
  const base = new DOMMatrix([z, 0, 0, z, v.panX * dpr, v.panY * dpr]);
  const abRects = s.artboards.map(a => ({ a, x: a.x * z + v.panX * dpr, y: a.y * z + v.panY * dpr, w: a.w * z, h: a.h * z }));

  const paintArtboards = () => {
    for (const r of abRects) {
      g.save();
      g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 18 * dpr;
      g.fillStyle = '#000'; g.fillRect(r.x, r.y, r.w, r.h);
      g.restore();
      if (r.a.background) { g.fillStyle = r.a.background; g.fillRect(r.x, r.y, r.w, r.h); }
      else {
        g.save();
        g.translate(r.x, r.y);
        g.scale(dpr, dpr);
        g.fillStyle = checker(g);
        g.fillRect(0, 0, r.w / dpr, r.h / dpr);
        g.restore();
      }
    }
  };
  paintArtboards();
  const smoothing = v.zoom < 2;
  renderLayers(g, s, { base, width: canvas.width, height: canvas.height, smoothing });

  if (compareX != null) {
    const cx = compareX * dpr;
    g.save();
    g.beginPath(); g.rect(0, 0, cx, canvas.height); g.clip();
    g.fillStyle = KOVA.pasteboard; g.fillRect(0, 0, cx, canvas.height);
    paintArtboards();
    renderLayers(g, s, { base, width: canvas.width, height: canvas.height, smoothing, bypassIds: new Set(s.layers.map(l => l.id)) });
    g.restore();
  }

  // prueba de color / canales: solo sobre las mesas visibles
  if (st.proof || st.channelView !== 'all' || doc.colorMode === 'CMYK') {
    for (const r of abRects) {
      const x = Math.max(0, Math.floor(r.x)), y = Math.max(0, Math.floor(r.y));
      const w = Math.min(canvas.width, Math.ceil(r.x + r.w)) - x, h = Math.min(canvas.height, Math.ceil(r.y + r.h)) - y;
      if (w <= 0 || h <= 0) continue;
      const img = g.getImageData(x, y, w, h);
      if (st.channelView !== 'all') channelView(img, st.channelView);
      else softProof(img, false);
      g.putImageData(img, x, y);
    }
  }

  // atenuar el contenido fuera de las mesas
  g.save();
  g.beginPath();
  g.rect(0, 0, canvas.width, canvas.height);
  for (const r of abRects) g.rect(r.x, r.y, r.w, r.h);
  g.fillStyle = 'rgba(17,17,20,0.78)';
  g.fill('evenodd');
  g.restore();

  // bordes y nombres de mesas
  g.save();
  g.font = `500 ${11 * dpr}px ${KOVA.font}`;
  for (const r of abRects) {
    const active = r.a.id === s.activeArtboardId;
    g.strokeStyle = active ? KOVA.redA(.55) : 'rgba(255,255,255,.12)';
    g.lineWidth = dpr;
    g.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h));
    if (s.artboards.length > 1 || active) {
      g.fillStyle = active ? KOVA.red : '#8b8b93';
      const unit = st.unit;
      const label = `${r.a.name}  ·  ${fromPx(r.a.w, unit, r.a.dpi).toFixed(unit === 'px' ? 0 : 1)}×${fromPx(r.a.h, unit, r.a.dpi).toFixed(unit === 'px' ? 0 : 1)} ${unit} @ ${r.a.dpi} ppp`;
      g.fillText(label, r.x, r.y - 7 * dpr);
    }
  }
  g.restore();
}

// ---------- hormigas en marcha ----------
let antsCache: { key: string; a: HTMLCanvasElement; b: HTMLCanvasElement } | null = null;
function selectionAnts(sel: Selection, v: { zoom: number; panX: number; panY: number }, W: number, H: number) {
  const key = `${(sel.canvas as any).__id ?? ((sel.canvas as any).__id = Math.random())}|${sel.x}|${sel.y}|${v.zoom}|${v.panX}|${v.panY}|${W}|${H}`;
  if (antsCache?.key === key) return antsCache;
  const off = createCanvas(W, H);
  const g = ctx2d(off);
  g.imageSmoothingEnabled = v.zoom < 1;
  g.setTransform(v.zoom, 0, 0, v.zoom, v.panX, v.panY);
  g.drawImage(sel.canvas, sel.x, sel.y);
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  const A = new ImageData(W, H), B = new ImageData(W, H);
  const inside = (i: number) => d[i * 4 + 3] >= 128;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (!inside(i)) continue;
    if (inside(i - 1) && inside(i + 1) && inside(i - W) && inside(i + W)) continue;
    const on = ((x + y) >> 2) & 1;
    const o = i * 4;
    const va = on ? 255 : 0, vb = on ? 0 : 255;
    A.data[o] = A.data[o + 1] = A.data[o + 2] = va; A.data[o + 3] = 255;
    B.data[o] = B.data[o + 1] = B.data[o + 2] = vb; B.data[o + 3] = 255;
  }
  const a = createCanvas(W, H), b = createCanvas(W, H);
  ctx2d(a).putImageData(A, 0, 0); ctx2d(b).putImageData(B, 0, 0);
  antsCache = { key, a, b };
  return antsCache;
}

function niceStep(pxPerUnit: number, minPx = 60) {
  const raw = minPx / pxPerUnit;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

function drawOverlay(canvas: HTMLCanvasElement, doc: Doc, W: number, H: number, dpr: number, phase: number, compareX: number | null) {
  const st = get();
  const v = getView(doc.id);
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  const g = ctx2d(canvas);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const s = doc.state;
  const sx = (x: number) => x * v.zoom + v.panX, sy = (y: number) => y * v.zoom + v.panY;
  const ab = s.artboards.find(a => a.id === s.activeArtboardId) ?? s.artboards[0];

  // cuadrícula
  if (st.showGrid && ab) {
    const step = toPx(st.gridSize, st.unit, ab.dpi);
    const sub = step / Math.max(1, st.gridSub);
    g.save();
    g.beginPath(); g.rect(sx(ab.x), sy(ab.y), ab.w * v.zoom, ab.h * v.zoom); g.clip();
    for (const [stp, alpha] of [[sub, 0.08], [step, 0.2]] as [number, number][]) {
      if (stp * v.zoom < 6) continue;
      g.strokeStyle = KOVA.arenaA(alpha);
      g.lineWidth = 1;
      g.beginPath();
      for (let x = ab.x; x <= ab.x + ab.w; x += stp) { const px = Math.round(sx(x)) + 0.5; g.moveTo(px, sy(ab.y)); g.lineTo(px, sy(ab.y + ab.h)); }
      for (let y = ab.y; y <= ab.y + ab.h; y += stp) { const py = Math.round(sy(y)) + 0.5; g.moveTo(sx(ab.x), py); g.lineTo(sx(ab.x + ab.w), py); }
      g.stroke();
    }
    g.restore();
  }
  // márgenes de seguridad
  if (st.showGuides) {
    g.save();
    g.setLineDash([4, 4]);
    g.strokeStyle = 'rgba(255,95,200,.55)';
    for (const a of s.artboards) if (a.margin > 0) g.strokeRect(sx(a.x + a.margin) + 0.5, sy(a.y + a.margin) + 0.5, (a.w - a.margin * 2) * v.zoom, (a.h - a.margin * 2) * v.zoom);
    g.restore();
    // guías
    g.strokeStyle = '#00d0ff';
    g.lineWidth = 1;
    g.beginPath();
    for (const gd of s.guides) {
      if (gd.axis === 'x') { const p = Math.round(sx(gd.pos)) + 0.5; g.moveTo(p, 0); g.lineTo(p, H); }
      else { const p = Math.round(sy(gd.pos)) + 0.5; g.moveTo(0, p); g.lineTo(W, p); }
    }
    g.stroke();
  }

  // selección
  const sel = s.selection;
  if (sel) {
    if (sel.shape) {
      const r = sel.shape;
      g.save();
      g.lineWidth = 1;
      const path = () => { g.beginPath(); if (r.type === 'rect') g.rect(Math.round(sx(r.x)) + 0.5, Math.round(sy(r.y)) + 0.5, Math.round(r.w * v.zoom), Math.round(r.h * v.zoom)); else g.ellipse(sx(r.x + r.w / 2), sy(r.y + r.h / 2), (r.w * v.zoom) / 2, (r.h * v.zoom) / 2, 0, 0, Math.PI * 2); };
      path(); g.strokeStyle = '#000'; g.stroke();
      g.setLineDash([4, 4]); g.lineDashOffset = -phase; path(); g.strokeStyle = '#fff'; g.stroke();
      g.restore();
    } else {
      const ants = selectionAnts(sel, v, Math.round(W), Math.round(H));
      g.drawImage(phase % 8 < 4 ? ants.a : ants.b, 0, 0);
    }
  }

  // capa(s) seleccionadas
  const showBox = st.tool === 'move' || st.tool === 'artboard';
  if (showBox) {
    const ids = new Set(s.selectedLayerIds);
    g.save();
    g.strokeStyle = KOVA.red;
    g.lineWidth = 1;
    for (const l of s.layers) {
      if (!ids.has(l.id) || l.kind === 'group') continue;
      const m = new DOMMatrix([v.zoom, 0, 0, v.zoom, v.panX, v.panY]).multiply(layerMatrix(l));
      const { w, h } = layerSize(l);
      const pts = [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => m.transformPoint(new DOMPoint(x, y)));
      g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.stroke();
    }
    // grupos: caja punteada de la unión
    for (const id of ids) {
      const grp = s.layers.find(l => l.id === id && l.kind === 'group');
      if (!grp) continue;
      const kids = s.layers.filter(l => l.parentId === grp.id && l.kind !== 'group');
      if (!kids.length) continue;
      const bs = kids.map(layerBounds);
      const x1 = Math.min(...bs.map(b => b.x)), y1 = Math.min(...bs.map(b => b.y)), x2 = Math.max(...bs.map(b => b.x + b.w)), y2 = Math.max(...bs.map(b => b.y + b.h));
      g.setLineDash([5, 3]); g.strokeRect(sx(x1), sy(y1), (x2 - x1) * v.zoom, (y2 - y1) * v.zoom); g.setLineDash([]);
    }
    const t = st.tool === 'move' && st.opts.showTransform ? transformTarget() : null;
    if (t) {
      const m = new DOMMatrix([v.zoom, 0, 0, v.zoom, v.panX, v.panY]).multiply(layerMatrix(t));
      const { w, h } = layerSize(t);
      g.fillStyle = '#fff';
      for (const [u, tt] of [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]]) {
        const p = m.transformPoint(new DOMPoint(u * w, tt * h));
        g.fillRect(p.x - 4, p.y - 4, 8, 8); g.strokeRect(p.x - 4 + 0.5, p.y - 4 + 0.5, 7, 7);
      }
      const c = m.transformPoint(new DOMPoint(w / 2, h / 2));
      g.beginPath(); g.arc(c.x, c.y, 3, 0, Math.PI * 2); g.stroke();
    }
    g.restore();
  }

  // superposiciones de herramienta
  g.save();
  if (overlay.rect) {
    const r = overlay.rect;
    g.strokeStyle = '#fff'; g.setLineDash([4, 4]); g.lineWidth = 1;
    g.beginPath();
    if (r.ellipse) g.ellipse(sx(r.x + r.w / 2), sy(r.y + r.h / 2), (r.w * v.zoom) / 2, (r.h * v.zoom) / 2, 0, 0, Math.PI * 2);
    else g.rect(sx(r.x) + 0.5, sy(r.y) + 0.5, r.w * v.zoom, r.h * v.zoom);
    g.stroke();
    g.setLineDash([]);
    if (ab) {
      g.font = '11px JetBrains Mono, monospace';
      const txt = `${fromPx(r.w, st.unit, ab.dpi).toFixed(st.unit === 'px' ? 0 : 2)} × ${fromPx(r.h, st.unit, ab.dpi).toFixed(st.unit === 'px' ? 0 : 2)} ${st.unit}`;
      const tw = g.measureText(txt).width + 12;
      g.fillStyle = 'rgba(20,20,24,.9)'; g.fillRect(sx(r.x + r.w) + 8, sy(r.y + r.h) + 8, tw, 20);
      g.fillStyle = '#fff'; g.fillText(txt, sx(r.x + r.w) + 14, sy(r.y + r.h) + 22);
    }
  }
  if (overlay.lasso && overlay.lasso.length > 1) {
    g.strokeStyle = '#fff'; g.setLineDash([4, 4]);
    g.beginPath(); overlay.lasso.forEach((p, i) => (i ? g.lineTo(sx(p.x), sy(p.y)) : g.moveTo(sx(p.x), sy(p.y)))); g.stroke();
    g.setLineDash([]);
  }
  if (overlay.line) {
    const l = overlay.line;
    g.strokeStyle = '#fff'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(sx(l.x1), sy(l.y1)); g.lineTo(sx(l.x2), sy(l.y2)); g.stroke();
    g.fillStyle = '#fff';
    for (const [x, y] of [[l.x1, l.y1], [l.x2, l.y2]]) { g.beginPath(); g.arc(sx(x), sy(y), 4, 0, Math.PI * 2); g.fill(); }
  }
  if (overlay.crop) {
    const r = overlay.crop;
    g.fillStyle = 'rgba(0,0,0,.55)';
    g.beginPath(); g.rect(0, 0, W, H); g.rect(sx(r.x), sy(r.y), r.w * v.zoom, r.h * v.zoom); g.fill('evenodd');
    g.strokeStyle = '#fff'; g.lineWidth = 1; g.strokeRect(sx(r.x) + 0.5, sy(r.y) + 0.5, r.w * v.zoom, r.h * v.zoom);
    g.strokeStyle = 'rgba(255,255,255,.35)';
    g.beginPath();
    for (const f of [1 / 3, 2 / 3]) { g.moveTo(sx(r.x + r.w * f), sy(r.y)); g.lineTo(sx(r.x + r.w * f), sy(r.y + r.h)); g.moveTo(sx(r.x), sy(r.y + r.h * f)); g.lineTo(sx(r.x + r.w), sy(r.y + r.h * f)); }
    g.stroke();
  }
  if (overlay.artboardDraft) {
    const r = overlay.artboardDraft;
    g.strokeStyle = KOVA.red; g.setLineDash([6, 4]);
    g.strokeRect(sx(r.x) + 0.5, sy(r.y) + 0.5, r.w * v.zoom, r.h * v.zoom);
    g.setLineDash([]);
  }
  if (st.tool === 'artboard') {
    g.fillStyle = KOVA.red;
    for (const a of s.artboards) g.fillRect(sx(a.x + a.w) - 4, sy(a.y + a.h) - 4, 8, 8);
  }
  if (overlay.snapLines?.length) {
    g.strokeStyle = '#ff3df0'; g.lineWidth = 1;
    g.beginPath();
    for (const ln of overlay.snapLines) {
      if (ln.axis === 'x') { const p = Math.round(sx(ln.pos)) + 0.5; g.moveTo(p, 0); g.lineTo(p, H); }
      else { const p = Math.round(sy(ln.pos)) + 0.5; g.moveTo(0, p); g.lineTo(W, p); }
    }
    g.stroke();
  }
  if (overlay.brush && ['brush', 'eraser', 'restore'].includes(st.tool)) {
    const b = overlay.brush;
    const r = Math.max(1, b.r * v.zoom);
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(0,0,0,.8)'; g.beginPath(); g.arc(sx(b.x), sy(b.y), r + 1, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(sx(b.x), sy(b.y), r, 0, Math.PI * 2); g.stroke();
  }
  if (compareX != null) {
    g.fillStyle = KOVA.red;
    g.fillRect(compareX - 1, 0, 2, H);
    g.beginPath(); g.arc(compareX, H / 2, 12, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#111'; g.font = `700 10px ${KOVA.font}`; g.textAlign = 'center'; g.fillText('⇆', compareX, H / 2 + 4);
    g.fillStyle = 'rgba(20,20,24,.85)'; g.fillRect(compareX - 70, 10, 60, 20); g.fillRect(compareX + 10, 10, 60, 20);
    g.fillStyle = '#fff'; g.font = `500 11px ${KOVA.font}`; g.fillText('Antes', compareX - 40, 24); g.fillText('Después', compareX + 40, 24);
  }
  g.restore();
}

function drawRuler(c: HTMLCanvasElement, axis: 'x' | 'y', len: number, dpr: number, doc: Doc) {
  const st = get();
  const v = getView(doc.id);
  const ab = doc.state.artboards.find(a => a.id === doc.state.activeArtboardId) ?? doc.state.artboards[0];
  const T = 22;
  const W = axis === 'x' ? len : T, H = axis === 'x' ? T : len;
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  c.style.width = W + 'px'; c.style.height = H + 'px';
  const g = ctx2d(c);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = KOVA.panel; g.fillRect(0, 0, W, H);
  if (!ab) return;
  const pxPerUnit = toPx(1, st.unit, ab.dpi) * v.zoom;
  const step = niceStep(pxPerUnit);
  const origin = axis === 'x' ? ab.x * v.zoom + v.panX : ab.y * v.zoom + v.panY;
  // zona de la mesa activa
  g.fillStyle = KOVA.panel2;
  if (axis === 'x') g.fillRect(origin, 0, ab.w * v.zoom, T); else g.fillRect(0, origin, T, ab.h * v.zoom);
  g.strokeStyle = KOVA.tick; g.fillStyle = KOVA.muted;
  g.font = '9px JetBrains Mono, monospace';
  g.lineWidth = 1;
  const startU = Math.floor(-origin / pxPerUnit / step) * step;
  const endU = (len - origin) / pxPerUnit;
  g.beginPath();
  for (let u = startU; u <= endU; u += step) {
    const p = Math.round(origin + u * pxPerUnit) + 0.5;
    for (let k = 1; k < 10; k++) {
      const q = Math.round(origin + (u + (step * k) / 10) * pxPerUnit) + 0.5;
      const tl = k === 5 ? 7 : 4;
      if (axis === 'x') { g.moveTo(q, T - tl); g.lineTo(q, T); } else { g.moveTo(T - tl, q); g.lineTo(T, q); }
    }
    if (axis === 'x') { g.moveTo(p, 0); g.lineTo(p, T); } else { g.moveTo(0, p); g.lineTo(T, p); }
    const label = String(+u.toFixed(3));
    if (axis === 'x') g.fillText(label, p + 3, 9);
    else { g.save(); g.translate(9, p + 3); g.rotate(-Math.PI / 2); g.fillText(label, 0, 0); g.restore(); }
  }
  g.stroke();
  // posición del cursor
  const cur = st.cursor;
  if (cur) {
    g.strokeStyle = KOVA.red;
    g.beginPath();
    if (axis === 'x') { const p = cur.x * v.zoom + v.panX; g.moveTo(p, 0); g.lineTo(p, T); }
    else { const p = cur.y * v.zoom + v.panY; g.moveTo(0, p); g.lineTo(T, p); }
    g.stroke();
  }
  g.strokeStyle = KOVA.line;
  g.beginPath();
  if (axis === 'x') { g.moveTo(0, T - 0.5); g.lineTo(W, T - 0.5); } else { g.moveTo(T - 0.5, 0); g.lineTo(T - 0.5, H); }
  g.stroke();
}

export function Viewport({ doc }: { doc: Doc }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  const rulerX = useRef<HTMLCanvasElement>(null);
  const rulerY = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [dragOver, setDragOver] = useState(false);
  const [compareX, setCompareX] = useState<number | null>(null);
  const view = useStore(s => s.views[doc.id]);
  const tick = useStore(s => s.renderTick);
  const flags = useStore(s => `${s.proof}|${s.channelView}|${s.showGrid}|${s.showGuides}|${s.gridSize}|${s.gridSub}|${s.unit}|${s.tool}|${s.opts.showTransform}`);
  const compare = useStore(s => s.compare);
  const showRulers = useStore(s => s.showRulers);
  const tool = useStore(s => s.tool);
  const cursor = useStore(s => s.cursor);
  const [, force] = useState(0);
  const dpr = window.devicePixelRatio || 1;

  useEffect(() => { const f = () => force(x => x + 1); textEdit.listeners.add(f); return () => { textEdit.listeners.delete(f); }; }, []);

  useLayoutEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => { if (!get().views[doc.id]) requestAnimationFrame(() => fitToScreen()); }, [doc.id]);
  useEffect(() => { if (size.w && get().views[doc.id]?.autoFit) fitToScreen(); }, [size.w, size.h]);
  useEffect(() => { setCompareX(compare ? size.w / 2 : null); }, [compare]);

  // escena
  const sceneRaf = useRef(0);
  useEffect(() => {
    cancelAnimationFrame(sceneRaf.current);
    sceneRaf.current = requestAnimationFrame(() => { if (sceneRef.current) drawScene(sceneRef.current, doc, size.w, size.h, dpr, compareX); });
  }, [doc.state, view, tick, flags, size, compareX, doc.colorMode]);

  // superposición (animada si hay selección)
  const phase = useRef(0);
  useEffect(() => {
    let raf = 0;
    const draw = () => { if (overRef.current) drawOverlay(overRef.current, doc, size.w, size.h, dpr, phase.current, compareX); };
    raf = requestAnimationFrame(draw);
    let timer: any = null;
    if (doc.state.selection) timer = setInterval(() => { phase.current = (phase.current + 1) % 8; draw(); }, 140);
    return () => { cancelAnimationFrame(raf); if (timer) clearInterval(timer); };
  }, [doc.state, view, tick, flags, size, compareX]);

  // reglas
  useEffect(() => {
    if (!showRulers) return;
    if (rulerX.current) drawRuler(rulerX.current, 'x', size.w, dpr, doc);
    if (rulerY.current) drawRuler(rulerY.current, 'y', size.h, dpr, doc);
  }, [doc.state.artboards, doc.state.activeArtboardId, view, size, flags, cursor, showRulers]);

  // rueda: desplazar / zoom
  useEffect(() => {
    const el = wrapRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const v = getView();
      if (e.ctrlKey || e.metaKey || e.altKey) {
        const f = Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 50 ? 0.02 : 0.0025));
        zoomTo(v.zoom * f, e.clientX - r.left, e.clientY - r.top);
      } else setView({ panX: v.panX - e.deltaX, panY: v.panY - e.deltaY });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const toEvent = (e: React.PointerEvent | PointerEvent | React.MouseEvent): ToolEvent => {
    const r = wrapRef.current!.getBoundingClientRect();
    const v = getView();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    return {
      sx, sy, wx: (sx - v.panX) / v.zoom, wy: (sy - v.panY) / v.zoom,
      shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, button: (e as any).button ?? 0, pressure: (e as any).pressure ?? 0.5,
    };
  };

  const panDrag = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const compareDrag = useRef(false);
  const onPointerDown = (e: React.PointerEvent) => {
    if (textEdit.layerId) { finishLive('Editar texto'); setTextEdit(null); }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const ev = toEvent(e);
    if (compareX != null && Math.abs(ev.sx - compareX) < 14) { compareDrag.current = true; return; }
    if (e.button === 1 || keys.space || (e.button === 0 && tool === 'hand')) {
      const v = getView();
      panDrag.current = { sx: e.clientX, sy: e.clientY, px: v.panX, py: v.panY };
      return;
    }
    if (e.button !== 0) return;
    tools[tool]?.down(ev);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const ev = toEvent(e);
    set({ cursor: { x: ev.wx, y: ev.wy } });
    if (compareDrag.current) { setCompareX(Math.max(20, Math.min(size.w - 20, ev.sx))); return; }
    if (panDrag.current) {
      const p = panDrag.current;
      setView({ panX: p.px + e.clientX - p.sx, panY: p.py + e.clientY - p.sy });
      return;
    }
    tools[tool]?.move(ev);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (compareDrag.current) { compareDrag.current = false; return; }
    if (panDrag.current) { panDrag.current = null; return; }
    tools[tool]?.up(toEvent(e));
  };
  const onDbl = (e: React.MouseEvent) => tools[tool]?.dblclick?.(toEvent(e));

  // reglas → guías
  const startGuide = (axis: 'x' | 'y') => (e: React.PointerEvent) => {
    e.preventDefault();
    const r = wrapRef.current!.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const v = getView();
      overlay.snapLines = [{ axis, pos: axis === 'x' ? (ev.clientX - r.left - v.panX) / v.zoom : (ev.clientY - r.top - v.panY) / v.zoom }];
      useStore.setState(s => ({ renderTick: s.renderTick + 1 }));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      overlay.snapLines = [];
      const v = getView();
      const sxp = ev.clientX - r.left, syp = ev.clientY - r.top;
      if (sxp >= 0 && syp >= 0 && sxp <= r.width && syp <= r.height) addGuide(axis, Math.round(axis === 'x' ? (sxp - v.panX) / v.zoom : (syp - v.panY) / v.zoom));
      else useStore.setState(s => ({ renderTick: s.renderTick + 1 }));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // clic derecho: seleccionar la capa bajo el cursor (si no lo estaba) y abrir el menú contextual
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: Item[] } | null>(null);
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const ev = toEvent(e);
    const hit = hitTestLayers(ev.wx, ev.wy);
    const sel = doc.state.selectedLayerIds;
    if (hit && !sel.includes(hit.id)) selectLayers([hit.id]);
    const hasSel = !!hit || sel.length > 0;
    const items: Item[] = hasSel
      ? ['artboard.fromSelection', 'artboard.copyToNew', '-', 'edit.copy', 'edit.paste', 'layer.duplicate', 'layer.delete', '-',
        'layer.group', 'layer.ungroup', { label: 'Organizar', sub: ['layer.top', 'layer.up', 'layer.down', 'layer.bottom'] }, '-',
        'dtf.bg', 'dtf.halftone', 'dtf.vectorize']
      : ['edit.paste', 'file.place', '-', 'view.fit'];
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  };
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', close);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', key); window.removeEventListener('blur', close); };
  }, [ctxMenu]);

  const cursorCss = keys.space || panDrag.current ? 'grab' : tools[tool]?.cursor ?? 'default';

  return (
    <div className={'viewport-wrap' + (showRulers ? '' : ' no-rulers')}>
      <div className="ruler-corner" title="Arrastra desde las reglas para crear guías" />
      <div className="ruler" style={{ cursor: 'row-resize', overflow: 'hidden' }} onPointerDown={startGuide('y')}>{showRulers && <canvas ref={rulerX} />}</div>
      <div className="ruler" style={{ cursor: 'col-resize', overflow: 'hidden' }} onPointerDown={startGuide('x')}>{showRulers && <canvas ref={rulerY} />}</div>
      <div
        id="kova-viewport" ref={wrapRef} className="viewport"
        style={{ cursor: cursorCss, outline: dragOver ? `2px dashed ${KOVA.red}` : undefined, outlineOffset: -6 }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerLeave={() => { set({ cursor: null }); tools[tool]?.leave?.(); }}
        onDoubleClick={onDbl}
        onContextMenu={onContextMenu}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault(); setDragOver(false);
          const files = platform.droppedFiles(e.dataTransfer);
          if (!files.length) return;
          const ev = toEvent(e as any);
          placeFiles(files, { x: ev.wx, y: ev.wy });
        }}
      >
        <canvas ref={sceneRef} style={{ width: size.w, height: size.h }} />
        <canvas ref={overRef} style={{ width: size.w, height: size.h, pointerEvents: 'none' }} />
        <TextEditPop size={size} />
        {doc.collab && <StageSlot />}
      </div>
      {ctxMenu && <MenuList items={ctxMenu.items} x={ctxMenu.x} y={ctxMenu.y} onClose={() => setCtxMenu(null)} />}
    </div>
  );
}

function TextEditPop({ size }: { size: { w: number; h: number } }) {
  const id = textEdit.layerId;
  const doc = useStore(s => s.docs.find(d => d.id === s.activeDocId));
  const view = useStore(s => (s.activeDocId ? s.views[s.activeDocId] : null));
  const ref = useRef<HTMLTextAreaElement>(null);
  const l = doc?.state.layers.find(x => x.id === id) as Layer | undefined;
  useEffect(() => { if (l) setTimeout(() => { ref.current?.focus(); ref.current?.select(); }, 0); }, [id]);
  if (!l || !l.text || !view) return null;
  const b = layerBounds(l);
  const left = Math.min(size.w - 300, Math.max(8, b.x * view.zoom + view.panX));
  const top = Math.min(size.h - 160, Math.max(8, (b.y + b.h) * view.zoom + view.panY + 10));
  const upd = (patch: Partial<NonNullable<Layer['text']>>) => {
    live(s => ({ ...s, layers: s.layers.map(x => (x.id === l.id ? { ...x, text: { ...x.text!, ...patch }, name: patch.text !== undefined ? (patch.text.split('\n')[0].slice(0, 24) || 'Texto') : x.name } : x)) }));
  };
  const done = () => { finishLive('Editar texto'); setTextEdit(null); };
  return (
    <div className="text-editor-pop" style={{ left, top }} onPointerDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
      <textarea ref={ref} className="input" rows={3} value={l.text.text} onChange={e => upd({ text: e.target.value })}
        onKeyDown={e => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); done(); } }} />
      <div className="row" style={{ marginTop: 6 }}>
        <div className="grow"><Slider label="Tamaño" value={l.text.fontSize} min={4} max={2000} onChange={v => upd({ fontSize: v })} suffix="px" /></div>
      </div>
      <div className="row" style={{ marginTop: 6, justifyContent: 'space-between' }}>
        <span className="tiny muted">Ctrl/⌘+Enter para terminar</span>
        <div className="row">
          <button className="btn sm" onClick={() => { cancelLive(); setTextEdit(null); }}>Cancelar</button>
          <button className="btn sm primary" onClick={done}>Listo</button>
        </div>
      </div>
    </div>
  );
}

export { cropState, activeLayer };
