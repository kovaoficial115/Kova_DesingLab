// Comprobaciones antes de exportar para redes (función pura: recibe la geometría ya calculada).

import type { Rect } from './adapt';
import { isBackground } from './adapt';
import { safeRect, type SocialFormat } from './presets';

export interface CheckLayer {
  name: string;
  kind: string;
  bounds: Rect;
  /** píxeles de salida por píxel de origen (rasters): > 1 = ampliado */
  upscale?: number;
  font?: string;
  fontMissing?: boolean;
}

export interface CheckInput {
  ab: Rect & { name: string; background: string | null };
  format: SocialFormat | null;
  layers: CheckLayer[];
  /** escala de exportación (1 = tamaño del formato) */
  scale: number;
  ext: string;
  /** mesas pegadas de la misma serie continua (lo que cruza hacia ellas no se considera recortado) */
  neighbors?: Rect[];
}

export interface Issue { level: 'error' | 'warn' | 'info'; text: string }

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const within = (b: Rect, r: Rect, tol = 0.5) => b.x >= r.x - tol && b.y >= r.y - tol && b.x + b.w <= r.x + r.w + tol && b.y + b.h <= r.y + r.h + tol;
const quote = (n: string) => `«${n.length > 28 ? n.slice(0, 27) + '…' : n}»`;

export function checkArtboard(i: CheckInput): Issue[] {
  const out: Issue[] = [];
  const { ab, format } = i;
  const W = Math.round(ab.w * i.scale), H = Math.round(ab.h * i.scale);
  if (format) {
    if (Math.abs(ab.w / ab.h - format.w / format.h) > 0.005) out.push({ level: 'error', text: `La proporción no es la del formato ${format.name} (${format.w}×${format.h}); la red la recortará.` });
    else if (W !== format.w || H !== format.h) {
      out.push(W < format.w
        ? { level: 'warn', text: `Se exporta a ${W}×${H} px; ${format.name} pide ${format.w}×${format.h} px y la ampliará.` }
        : { level: 'info', text: `Se exporta a ${W}×${H} px (mayor que ${format.w}×${format.h}); la red lo reducirá.` });
    }
  }
  const inAb = i.layers.filter(l => overlaps(l.bounds, ab));
  if (!inAb.length) out.push({ level: 'warn', text: 'La mesa está vacía.' });

  const safe = format?.safe ? (() => { const s = safeRect(format, ab.w, ab.h); return { x: ab.x + s.x, y: ab.y + s.y, w: s.w, h: s.h }; })() : null;
  const circle = format?.circle ? { cx: ab.x + ab.w / 2, cy: ab.y + ab.h / 2, r: (format.circle.safe / format.w) * ab.w / 2 } : null;
  const cut: string[] = [], unsafe: string[] = [], outCircle: string[] = [], blurry: string[] = [], fonts = new Set<string>();
  for (const l of inAb) {
    const bg = isBackground(l.bounds, ab);
    if (!bg && !within(l.bounds, ab)) {
      // lo que sobresale hacia una diapositiva vecina de un carrusel continuo es intencionado
      const spill = i.neighbors?.some(n => overlaps(l.bounds, n));
      if (!spill) cut.push(l.name);
    }
    if (safe && l.kind === 'text' && !within(l.bounds, safe)) unsafe.push(l.name);
    if (circle && !bg) {
      const b = l.bounds;
      const corners = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]];
      if (corners.some(([x, y]) => Math.hypot(x - circle.cx, y - circle.cy) > circle.r + 0.5) && l.kind !== 'raster') outCircle.push(l.name);
    }
    if (l.upscale && l.upscale * i.scale > 1.05) blurry.push(`${quote(l.name)} ×${(l.upscale * i.scale).toFixed(1)}`);
    if (l.fontMissing && l.font) fonts.add(l.font.split(',')[0].replace(/["']/g, '').trim());
  }
  const list = (a: string[]) => a.slice(0, 3).map(quote).join(', ') + (a.length > 3 ? ` y ${a.length - 3} más` : '');
  if (cut.length) out.push({ level: 'info', text: `Se recorta en el borde: ${list(cut)}.` });
  if (unsafe.length) out.push({ level: 'warn', text: `Texto fuera de la zona segura (la interfaz puede taparlo): ${list(unsafe)}.` });
  if (outCircle.length) out.push({ level: 'warn', text: `Fuera del círculo visible: ${list(outCircle)}.` });
  if (blurry.length) out.push({ level: 'warn', text: `Imágenes ampliadas (pueden verse borrosas): ${blurry.slice(0, 3).join(', ')}${blurry.length > 3 ? '…' : ''}.` });
  if (fonts.size) out.push({ level: 'warn', text: `Tipografías no disponibles en este equipo: ${[...fonts].join(', ')}. Se usará otra.` });
  if ((i.ext === 'jpg' || i.ext === 'jpeg') && !ab.background) out.push({ level: 'info', text: 'JPEG no admite transparencia: el fondo saldrá blanco.' });
  return out;
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
