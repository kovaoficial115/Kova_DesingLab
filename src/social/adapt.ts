// Motor de adaptación multiformato (función pura): calcula cómo colocar cada elemento de una mesa
// en otra de distinto tamaño. Solo hay escalas uniformes (nada se deforma) y traslaciones.
//
//  fit      Ajustar      toda la composición cabe; los fondos se amplían para cubrir el formato
//  fill     Rellenar     la composición cubre el formato (puede recortar bordes); los textos se
//                        devuelven a la zona segura
//  crop     Recortar     mismo tamaño en píxeles, centrado; lo que no cabe queda fuera
//  reflow   Reorganizar  cada elemento conserva su posición relativa y su tamaño se adapta al
//                        formato; fondos cubren y textos quedan dentro de la zona segura
//  keep     Mantener     la composición exacta, escalada para caber, sin tocar los fondos

export type AdaptMode = 'fit' | 'fill' | 'crop' | 'reflow' | 'keep';

export const ADAPT_MODES: { id: AdaptMode; name: string; hint: string }[] = [
  { id: 'fit', name: 'Ajustar', hint: 'Todo cabe; los fondos se amplían para cubrir el formato.' },
  { id: 'fill', name: 'Rellenar', hint: 'Cubre todo el formato; puede recortar los bordes. Los textos vuelven a la zona segura.' },
  { id: 'crop', name: 'Recortar', hint: 'Mismo tamaño, centrado. Lo que no cabe queda fuera.' },
  { id: 'reflow', name: 'Reorganizar', hint: 'Cada elemento conserva su posición relativa; textos dentro de la zona segura.' },
  { id: 'keep', name: 'Mantener composición', hint: 'La composición exacta escalada para caber, sin ampliar fondos.' },
];

export interface Rect { x: number; y: number; w: number; h: number }

export type ItemRole = 'background' | 'text' | 'other';

export interface AdaptItem {
  id: string;
  role: ItemRole;
  /** caja en coordenadas de mundo */
  bounds: Rect;
}

/** p' = p · k + (dx, dy) */
export interface Placement { k: number; dx: number; dy: number }

export interface AdaptOptions {
  mode: AdaptMode;
  /** zona segura del destino en coordenadas de mundo (por defecto, la mesa entera) */
  safe?: Rect;
}

/** Un elemento es fondo si cubre casi toda la mesa. */
export function isBackground(b: Rect, ab: Rect, cover = 0.95) {
  const ix = Math.max(0, Math.min(b.x + b.w, ab.x + ab.w) - Math.max(b.x, ab.x));
  const iy = Math.max(0, Math.min(b.y + b.h, ab.y + ab.h) - Math.max(b.y, ab.y));
  return ix >= ab.w * cover && iy >= ab.h * cover;
}

const inside = (b: Rect, r: Rect, tol = 1) => b.x >= r.x - tol && b.y >= r.y - tol && b.x + b.w <= r.x + r.w + tol && b.y + b.h <= r.y + r.h + tol;

export const applyPlacement =(r: Rect, p: Placement): Rect => ({ x: r.x * p.k + p.dx, y: r.y * p.k + p.dy, w: r.w * p.k, h: r.h * p.k });

/** Colocación que lleva el centro de `r` (escalado por k) al punto (cx, cy). */
function centerAt(r: Rect, k: number, cx: number, cy: number): Placement {
  return { k, dx: cx - (r.x + r.w / 2) * k, dy: cy - (r.y + r.h / 2) * k };
}

/** Fondo: escala mínima para cubrir el destino, centrado. */
function coverPlacement(b: Rect, dst: Rect, src: Rect): Placement {
  // centro del fondo relativo a la mesa de origen (un fondo descentrado sigue descentrado)
  const k = Math.max(dst.w / Math.max(1e-6, b.w), dst.h / Math.max(1e-6, b.h));
  const u = (b.x + b.w / 2 - src.x) / src.w, v = (b.y + b.h / 2 - src.y) / src.h;
  let p = centerAt(b, k, dst.x + u * dst.w, dst.y + v * dst.h);
  // que no quede ningún hueco
  const r = applyPlacement(b, p);
  if (r.x > dst.x) p = { ...p, dx: p.dx - (r.x - dst.x) };
  if (r.y > dst.y) p = { ...p, dy: p.dy - (r.y - dst.y) };
  const r2 = applyPlacement(b, p);
  if (r2.x + r2.w < dst.x + dst.w) p = { ...p, dx: p.dx + (dst.x + dst.w - r2.x - r2.w) };
  if (r2.y + r2.h < dst.y + dst.h) p = { ...p, dy: p.dy + (dst.y + dst.h - r2.y - r2.h) };
  return p;
}

/** Ajusta una colocación para que la caja resultante quede dentro de `safe` (reduciendo si no cabe). */
export function clampInto(b: Rect, p: Placement, safe: Rect): Placement {
  let r = applyPlacement(b, p);
  if (r.w > safe.w || r.h > safe.h) {
    const f = Math.min(safe.w / r.w, safe.h / r.h);
    p = centerAt(b, p.k * f, r.x + r.w / 2, r.y + r.h / 2);
    r = applyPlacement(b, p);
  }
  let dx = 0, dy = 0;
  if (r.x < safe.x) dx = safe.x - r.x; else if (r.x + r.w > safe.x + safe.w) dx = safe.x + safe.w - (r.x + r.w);
  if (r.y < safe.y) dy = safe.y - r.y; else if (r.y + r.h > safe.y + safe.h) dy = safe.y + safe.h - (r.y + r.h);
  return { k: p.k, dx: p.dx + dx, dy: p.dy + dy };
}

/**
 * Calcula la colocación de cada elemento de `src` en `dst`.
 * Los elementos fuera de la mesa de origen se colocan con la misma transformación global.
 */
export function adaptLayout(items: AdaptItem[], src: Rect, dst: Rect, o: AdaptOptions): Map<string, Placement> {
  const out = new Map<string, Placement>();
  const safe = o.safe ?? dst;
  const kx = dst.w / src.w, ky = dst.h / src.h;
  const kFit = Math.min(kx, ky), kFill = Math.max(kx, ky);
  const scx = src.x + src.w / 2, scy = src.y + src.h / 2;
  const dcx = dst.x + dst.w / 2, dcy = dst.y + dst.h / 2;
  // transformación global de la composición: escala k alrededor del centro
  const global = (k: number): Placement => ({ k, dx: dcx - scx * k, dy: dcy - scy * k });

  for (const it of items) {
    let p: Placement;
    switch (o.mode) {
      case 'keep': p = global(kFit); break;
      case 'crop': p = global(1); break;
      case 'fit': p = it.role === 'background' ? coverPlacement(it.bounds, dst, src) : global(kFit); break;
      case 'fill':
        p = it.role === 'background' ? coverPlacement(it.bounds, dst, src) : global(kFill);
        if (it.role === 'text') p = clampInto(it.bounds, p, safe);
        break;
      case 'reflow': {
        if (it.role === 'background') { p = coverPlacement(it.bounds, dst, src); break; }
        // tamaño: el de «ajustar», algo mayor si el formato da sitio (media geométrica), nunca
        // mayor que «rellenar»
        const k = Math.min(kFill, Math.sqrt(kx * ky));
        const b = it.bounds;
        // posición relativa del centro, medida dentro de la mesa
        const u = (b.x + b.w / 2 - src.x) / src.w, v = (b.y + b.h / 2 - src.y) / src.h;
        p = centerAt(b, k, dst.x + u * dst.w, dst.y + v * dst.h);
        // el texto queda dentro de la zona segura; lo demás, dentro del formato si ya lo estaba
        // (una imagen que sangra a propósito por un borde sigue sangrando)
        if (it.role === 'text') p = clampInto(b, p, safe);
        else if (inside(b, src)) p = clampInto(b, p, dst);
        break;
      }
    }
    out.set(it.id, p);
  }
  return out;
}
