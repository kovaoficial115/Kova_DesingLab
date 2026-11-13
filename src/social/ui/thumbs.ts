// Miniaturas de mesas para paneles y simuladores: se renderizan pequeñas (≤ 480 px) y se guardan
// en caché por estado de capas, así que no se vuelve a pintar nada mientras el documento no cambie.

import type { Artboard, DocState } from '../../core/types';
import { renderArtboard } from '../../core/render';

const cache = new WeakMap<object, Map<string, Promise<HTMLCanvasElement>>>();

export function thumbFor(state: DocState, ab: Artboard, max = 320): Promise<HTMLCanvasElement> {
  let m = cache.get(state.layers);
  if (!m) { m = new Map(); cache.set(state.layers, m); }
  const key = `${ab.id}|${ab.x}|${ab.y}|${ab.w}|${ab.h}|${ab.background}|${max}`;
  let p = m.get(key);
  if (!p) {
    const scale = Math.min(1, max / Math.max(ab.w, ab.h));
    p = renderArtboard(state, ab, scale);
    m.set(key, p);
  }
  return p;
}

/** Color medio y luminosidad de una miniatura (para la armonía del feed). */
export function averageColor(c: HTMLCanvasElement): { r: number; g: number; b: number } {
  const s = document.createElement('canvas');
  s.width = 16; s.height = 16;
  const g = s.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(c, 0, 0, 16, 16);
  const d = g.getImageData(0, 0, 16, 16).data;
  let r = 0, gg = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    if (a < 0.05) continue;
    r += d[i] * a; gg += d[i + 1] * a; b += d[i + 2] * a; n += a;
  }
  return n ? { r: r / n, g: gg / n, b: b / n } : { r: 255, g: 255, b: 255 };
}
