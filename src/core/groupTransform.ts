// Transformación conjunta de varias capas (caja global de la selección). Cada capa conserva su tipo
// (texto, forma, vector, imagen) y solo cambian su posición, escala y giro: nada se rasteriza.
// Los cálculos parten siempre del estado inicial del gesto, así no se acumulan errores.

import type { Layer } from './types';
import { layerPivot, placeAtPivot } from './util';

type P = { x: number; y: number };
const norm180 = (d: number) => (((d % 360) + 540) % 360) - 180;

/**
 * Escala la capa respecto al punto `A` con factores (rx, ry) en los ejes del documento.
 * Con escala proporcional (rx = ry) el resultado es exacto para cualquier giro; con escala libre
 * las capas giradas conservan su giro y se estiran a lo largo de sus propios ejes (sin sesgar).
 */
export function scalePatch(l: Layer, A: P, rx: number, ry: number): Partial<Layer> {
  const p = layerPivot(l);
  const nx = A.x + (p.x - A.x) * rx, ny = A.y + (p.y - A.y) * ry;
  const r = (l.rotation * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const fx = Math.hypot(rx * c, ry * s), fy = Math.hypot(rx * s, ry * c);
  const sx = l.scaleX * fx, sy = l.scaleY * fy;
  return { scaleX: sx, scaleY: sy, ...placeAtPivot(l, nx, ny, sx, sy) };
}

/** Gira la capa `deg` grados alrededor de `C` (su giro propio también cambia). Exacto. */
export function rotatePatch(l: Layer, C: P, deg: number): Partial<Layer> {
  const p = layerPivot(l);
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const dx = p.x - C.x, dy = p.y - C.y;
  const nx = C.x + dx * c - dy * s, ny = C.y + dx * s + dy * c;
  return { rotation: norm180(l.rotation + deg), ...placeAtPivot(l, nx, ny) };
}

/** Aplica parches por id sobre la lista de capas. */
export function applyPatches(layers: Layer[], patches: Map<string, Partial<Layer>>): Layer[] {
  return layers.map(l => { const p = patches.get(l.id); return p ? { ...l, ...p } : l; });
}

/**
 * Factores de escala de un asa de la caja: `hu`/`hv` ∈ {0, 0.5, 1} indican el asa; `fromCenter`
 * escala desde el centro. Las esquinas mantienen la proporción salvo con `free`; los lados la
 * mantienen solo con `keep`. Nunca voltea (factor mínimo 0.01).
 */
export function handleScale(box: { x: number; y: number; w: number; h: number }, hu: number, hv: number, pt: P, o: { fromCenter?: boolean; free?: boolean; keep?: boolean } = {}) {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const A = o.fromCenter ? { x: cx, y: cy } : { x: box.x + (1 - hu) * box.w, y: box.y + (1 - hv) * box.h };
  const H = { x: box.x + hu * box.w, y: box.y + hv * box.h };
  let rx = hu === 0.5 || H.x === A.x ? 1 : (pt.x - A.x) / (H.x - A.x);
  let ry = hv === 0.5 || H.y === A.y ? 1 : (pt.y - A.y) / (H.y - A.y);
  const corner = hu !== 0.5 && hv !== 0.5;
  const keep = corner ? !o.free : !!o.keep;
  if (keep) {
    if (corner) { const k = Math.max(rx, ry); rx = k; ry = k; }
    else if (hu === 0.5) rx = ry; else ry = rx;
  }
  rx = Math.max(0.01, rx); ry = Math.max(0.01, ry);
  return { A, rx, ry };
}
