// Colocación precisa de un estampado dentro de su zona, en centímetros. Todo se mide sobre la
// parte con tinta del arte (lo transparente de la mesa de trabajo no cuenta), igual que el
// motor de estampados. Coordenadas de la zona: origen arriba a la izquierda (vista desde su
// lado), x hacia la derecha, y hacia abajo. Puro: sin three.js ni DOM.

import type { ZonePrint } from '../core/garment3d';
import type { ZoneDef } from './zones';

/** Tamaño físico de la mesa de trabajo (cm, a escala 1) y su caja con tinta en fracciones. */
export interface ArtInfo { wCm: number; hCm: number; ink: [number, number, number, number] }
/** Caja alineada con los ejes de la parte con tinta (cm, coordenadas de la zona). */
export interface InkBox { x0: number; y0: number; x1: number; y1: number; cx: number; cy: number; w: number; h: number }
export interface Guide { axis: 'x' | 'y'; at: number }
type Pos = Pick<ZonePrint, 'x' | 'y'>;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Centro de la tinta respecto al centro del arte (cm), ya girado. */
function inkOffset(p: ZonePrint, art: ArtInfo) {
  const [s0, t0, s1, t1] = art.ink, W = art.wCm * p.scale, H = art.hCm * p.scale;
  const ox = ((s0 + s1) / 2 - 0.5) * W, oy = ((t0 + t1) / 2 - 0.5) * H;
  // giro positivo = horario en pantalla (y hacia abajo), como en el editor 2D
  const c = Math.cos(rad(p.rotation)), s = Math.sin(rad(p.rotation));
  return { dx: ox * c - oy * s, dy: ox * s + oy * c, iw: (s1 - s0) * W, ih: (t1 - t0) * H, c, s };
}

export function inkBoxCm(zone: ZoneDef, p: ZonePrint, art: ArtInfo): InkBox {
  const [zw, zh] = zone.sizeCm;
  const { dx, dy, iw, ih, c, s } = inkOffset(p, art);
  const cx = p.x * zw + dx, cy = p.y * zh + dy;
  const hx = Math.abs((iw / 2) * c) + Math.abs((ih / 2) * s), hy = Math.abs((iw / 2) * s) + Math.abs((ih / 2) * c);
  return { x0: cx - hx, y0: cy - hy, x1: cx + hx, y1: cy + hy, cx, cy, w: hx * 2, h: hy * 2 };
}

/** Posición que deja el centro de la tinta en (cx, cy) cm. */
export function inkCenterTo(zone: ZoneDef, p: ZonePrint, art: ArtInfo, cx: number, cy: number): Pos {
  const [zw, zh] = zone.sizeCm;
  const { dx, dy } = inkOffset(p, art);
  return { x: clamp01((cx - dx) / zw), y: clamp01((cy - dy) / zh) };
}

export type HAlign = 'left' | 'center' | 'right';
export type VAlign = 'top' | 'middle' | 'bottom';

/** Alinea la tinta con los bordes o el centro del área de impresión. */
export function align(zone: ZoneDef, p: ZonePrint, art: ArtInfo, h: HAlign | null, v: VAlign | null): Pos {
  const [zw, zh] = zone.sizeCm, b = inkBoxCm(zone, p, art);
  const cx = h === 'left' ? b.w / 2 : h === 'right' ? zw - b.w / 2 : h === 'center' ? zw / 2 : b.cx;
  const cy = v === 'top' ? b.h / 2 : v === 'bottom' ? zh - b.h / 2 : v === 'middle' ? zh / 2 : b.cy;
  return inkCenterTo(zone, p, art, cx, cy);
}

/** Desplaza el estampado `dx`, `dy` cm. */
export function nudge(zone: ZoneDef, p: ZonePrint, dxCm: number, dyCm: number): Pos {
  return { x: clamp01(p.x + dxCm / zone.sizeCm[0]), y: clamp01(p.y + dyCm / zone.sizeCm[1]) };
}

/** Escala para que la tinta mida `wCm` de ancho; conserva el centro horizontal y el borde superior de la tinta. */
export function setInkWidth(zone: ZoneDef, p: ZonePrint, art: ArtInfo, wCm: number): Partial<ZonePrint> {
  const inkW1 = (art.ink[2] - art.ink[0]) * art.wCm;
  if (!(inkW1 > 0) || !(wCm > 0)) return {};
  const before = inkBoxCm(zone, p, art);
  const scale = Math.min(10, Math.max(0.02, wCm / inkW1));
  const next = { ...p, scale };
  const after = inkBoxCm(zone, next, art);
  return { scale, ...inkCenterTo(zone, next, art, before.cx, after.cy + (before.y0 - after.y0)) };
}

/** Distancias que se ven en la tarjeta de la zona (cm). */
export function measures(zone: ZoneDef, p: ZonePrint, art: ArtInfo) {
  const b = inkBoxCm(zone, p, art), { iw, ih } = inkOffset(p, art);
  return { width: iw, height: ih, fromCenter: b.cx - zone.sizeCm[0] / 2, fromTop: b.y0 };
}

/** Ajuste magnético a centro y bordes del área. Devuelve la posición ajustada y las guías usadas. */
export function snap(zone: ZoneDef, p: ZonePrint, art: ArtInfo, thresholdCm = 0.8): Pos & { guides: Guide[] } {
  const [zw, zh] = zone.sizeCm, b = inkBoxCm(zone, p, art);
  const guides: Guide[] = [];
  const best = (cands: { at: number; delta: number }[]) => cands.filter(c => Math.abs(c.delta) <= thresholdCm).sort((a, b2) => Math.abs(a.delta) - Math.abs(b2.delta))[0];
  const sx = best([{ at: zw / 2, delta: zw / 2 - b.cx }, { at: 0, delta: -b.x0 }, { at: zw, delta: zw - b.x1 }]);
  const sy = best([{ at: zh / 2, delta: zh / 2 - b.cy }, { at: 0, delta: -b.y0 }, { at: zh, delta: zh - b.y1 }]);
  if (sx) guides.push({ axis: 'x', at: sx.at });
  if (sy) guides.push({ axis: 'y', at: sy.at });
  const pos = inkCenterTo(zone, p, art, b.cx + (sx?.delta ?? 0), b.cy + (sy?.delta ?? 0));
  return { ...pos, guides };
}

// ---------- colocaciones rápidas ----------

export interface Preset { id: string; label: string; title: string }

/** Logo de pecho: ancho habitual de 9 cm, a ~10 cm del centro y ~3 cm bajo el inicio del área. */
const CHEST_LOGO_W = 9, CHEST_LOGO_OFFSET = 10, CHEST_LOGO_TOP = 3;

export function presets(zone: ZoneDef): Preset[] {
  const center: Preset = { id: 'center', label: 'Centrar', title: 'En el centro del área de impresión' };
  if (zone.id === 'front') return [
    { id: 'chest', label: 'Pecho', title: 'Centrado y arriba del área (a la distancia habitual del cuello)' },
    { id: 'leftChest', label: 'Logo pecho', title: `Logo de ${CHEST_LOGO_W} cm en el pecho izquierdo de quien la lleva` },
    center,
    { id: 'bottom', label: 'Abajo', title: 'Centrado y pegado al borde inferior del área' },
  ];
  if (zone.id === 'back') return [
    { id: 'upper', label: 'Arriba', title: 'Centrado bajo el cuello' },
    center,
    { id: 'bottom', label: 'Abajo', title: 'Centrado y pegado al borde inferior del área' },
  ];
  return [center];
}

/** Ajusta a la zona si no cabe (sin agrandar nunca). */
function fitScale(zone: ZoneDef, p: ZonePrint, art: ArtInfo) {
  const b = inkBoxCm(zone, { ...p, rotation: p.rotation }, art), [zw, zh] = zone.sizeCm;
  const k = Math.min(1, zw / b.w, zh / b.h);
  return p.scale * k;
}

export function applyPreset(zone: ZoneDef, p: ZonePrint, art: ArtInfo, id: string): Partial<ZonePrint> {
  const [zw] = zone.sizeCm;
  if (id === 'leftChest') {
    const w = Math.min(CHEST_LOGO_W, zw / 2 - 1);
    const sized = { ...p, rotation: 0, ...setInkWidth(zone, { ...p, rotation: 0 }, art, w) };
    const b = inkBoxCm(zone, sized, art);
    // de frente, el pecho izquierdo de quien la lleva queda a la derecha de la pantalla
    const cx = Math.min(zw - b.w / 2, zw / 2 + CHEST_LOGO_OFFSET);
    return { scale: sized.scale, rotation: 0, ...inkCenterTo(zone, sized, art, cx, CHEST_LOGO_TOP + b.h / 2) };
  }
  const fitted = { ...p, scale: fitScale(zone, p, art) };
  const v: VAlign = id === 'chest' || id === 'upper' ? 'top' : id === 'bottom' ? 'bottom' : 'middle';
  return { scale: fitted.scale, ...align(zone, fitted, art, 'center', v) };
}
