// Recorte no destructivo de imágenes: matemática pura del marco de recorte y de la colocación de
// la capa (la parte visible no se mueve en el documento al recortar ni al volver a editar).

export interface CropRect { x: number; y: number; w: number; h: number }
export type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const CROP_ASPECTS: { id: string; label: string; ratio: number | null }[] = [
  { id: 'free', label: 'Libre', ratio: null },
  { id: 'orig', label: 'Original', ratio: -1 },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '2:3', label: '2:3', ratio: 2 / 3 },
];

const MIN = 1;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** El mayor rectángulo con la proporción dada, centrado en `r` y dentro de W×H. */
export function fitAspect(r: CropRect, ratio: number, W: number, H: number): CropRect {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  let w = r.w, h = w / ratio;
  if (h > r.h) { h = r.h; w = h * ratio; }
  // si no cabe centrado, se reduce hasta caber en la imagen
  w = Math.min(w, W, H * ratio); h = w / ratio;
  return { x: clamp(cx - w / 2, 0, W - w), y: clamp(cy - h / 2, 0, H - h), w, h };
}

/**
 * Arrastra un asa del marco (`d` = desplazamiento en px de la imagen desde el inicio del gesto).
 * Con `ratio` mantiene la proporción. El marco nunca sale de la imagen W×H.
 */
export function resizeCrop(r0: CropRect, h: CropHandle, dx: number, dy: number, W: number, H: number, ratio: number | null): CropRect {
  let x1 = r0.x, y1 = r0.y, x2 = r0.x + r0.w, y2 = r0.y + r0.h;
  if (h.includes('w')) x1 = clamp(x1 + dx, 0, x2 - MIN);
  if (h.includes('e')) x2 = clamp(x2 + dx, x1 + MIN, W);
  if (h.includes('n')) y1 = clamp(y1 + dy, 0, y2 - MIN);
  if (h.includes('s')) y2 = clamp(y2 + dy, y1 + MIN, H);
  if (!ratio) return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  // con proporción: el lado que se mueve manda y el otro se ajusta desde el lado fijo
  let w = x2 - x1, hh = y2 - y1;
  const horiz = h === 'e' || h === 'w', vert = h === 'n' || h === 's';
  if (horiz) hh = w / ratio;
  else if (vert) w = hh * ratio;
  else if (w / hh > ratio) hh = w / ratio; else w = hh * ratio;
  // ancla: la esquina o lado opuestos (los lados centran el otro eje)
  const ax = h.includes('w') ? r0.x + r0.w : h.includes('e') ? r0.x : r0.x + r0.w / 2;
  const ay = h.includes('n') ? r0.y + r0.h : h.includes('s') ? r0.y : r0.y + r0.h / 2;
  // limitar al espacio disponible desde el ancla
  const maxW = h.includes('w') ? ax : h.includes('e') ? W - ax : 2 * Math.min(ax, W - ax);
  const maxH = h.includes('n') ? ay : h.includes('s') ? H - ay : 2 * Math.min(ay, H - ay);
  const k = Math.min(1, maxW / w, maxH / hh);
  w *= k; hh *= k;
  const x = h.includes('w') ? ax - w : h.includes('e') ? ax : ax - w / 2;
  const y = h.includes('n') ? ay - hh : h.includes('s') ? ay : ay - hh / 2;
  return { x, y, w, h: hh };
}

/** Mueve el marco sin salir de la imagen. */
export function moveCrop(r0: CropRect, dx: number, dy: number, W: number, H: number): CropRect {
  return { ...r0, x: clamp(r0.x + dx, 0, W - r0.w), y: clamp(r0.y + dy, 0, H - r0.h) };
}

/** Redondea a píxeles enteros dentro de la imagen. */
export function roundCrop(r: CropRect, W: number, H: number): CropRect {
  const x = clamp(Math.round(r.x), 0, W - 1), y = clamp(Math.round(r.y), 0, H - 1);
  return { x, y, w: clamp(Math.round(r.w), 1, W - x), h: clamp(Math.round(r.h), 1, H - y) };
}

/**
 * Centro de giro de la capa (en el mundo) tras cambiar su contenido: el punto `local` del contenido
 * nuevo (px) cae donde estaba el punto `localOld` del contenido anterior.
 * `piv` es el centro de giro actual, (w, h) el tamaño actual y (nw, nh) el nuevo.
 */
export function pivotAfterResize(piv: { x: number; y: number }, rotation: number, sx: number, sy: number,
  w: number, h: number, nw: number, nh: number, localOld: { x: number; y: number }, localNew: { x: number; y: number }) {
  // mundo(p) = piv + R·S·(p − tamaño/2) ⇒ piv' = piv + R·S·((localOld − (w,h)/2) − (localNew − (nw,nh)/2))
  const vx = (localOld.x - w / 2 - (localNew.x - nw / 2)) * sx, vy = (localOld.y - h / 2 - (localNew.y - nh / 2)) * sy;
  const a = (rotation * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return { x: piv.x + vx * c - vy * s, y: piv.y + vx * s + vy * c };
}

export function sanitizeCrop(v: unknown): CropRect | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as any;
  const n = (k: string) => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? o[k] : NaN);
  const r = { x: n('x'), y: n('y'), w: n('w'), h: n('h') };
  return Object.values(r).every(Number.isFinite) && r.w > 0 && r.h > 0 ? r : null;
}
