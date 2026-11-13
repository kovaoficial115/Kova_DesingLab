// Carruseles: colocación de diapositivas, carrusel continuo y reordenación (funciones puras).
//
// Una diapositiva es una mesa de trabajo. En un carrusel normal las mesas van separadas por un
// hueco; en uno continuo van pegadas (hueco 0), así una capa que cruza el corte sale en las dos
// diapositivas y el panorama se exporta partido exactamente por los bordes.

import type { Rect } from './adapt';

/** Hueco entre diapositivas de un carrusel normal, en px del formato. */
export const SLIDE_GAP = 80;
export const MAX_SLIDES = 20;

/** Posiciones de n diapositivas en fila. */
export function slidePositions(n: number, w: number, x0: number, y0: number, gap: number) {
  return Array.from({ length: n }, (_, i) => ({ x: x0 + i * (w + gap), y: y0 }));
}

/** Número de diapositivas para un panorama de ancho total W con diapositivas de ancho w. */
export function panoramaSlides(totalW: number, slideW: number) {
  return Math.max(1, Math.min(MAX_SLIDES, Math.ceil(totalW / slideW - 1e-6)));
}

/** Cortes de un panorama: rectángulos de cada diapositiva (el último puede ser más estrecho). */
export function panoramaCuts(totalW: number, h: number, slideW: number): Rect[] {
  const n = panoramaSlides(totalW, slideW);
  return Array.from({ length: n }, (_, i) => ({ x: i * slideW, y: 0, w: Math.min(slideW, totalW - i * slideW), h }));
}

export interface MovableLayer { id: string; kind: string; x: number; y: number }

const contains = (r: Rect, b: Rect, tol = 0.5) => b.x >= r.x - tol && b.y >= r.y - tol && b.x + b.w <= r.x + r.w + tol && b.y + b.h <= r.y + r.h + tol;
const centerIn = (r: Rect, b: Rect) => { const cx = b.x + b.w / 2, cy = b.y + b.h / 2; return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h; };

/**
 * Capas que pertenecen a una diapositiva y se mueven con ella.
 *  - carrusel normal: las que tienen el centro dentro (como al mover una mesa)
 *  - continuo: solo las que están enteras dentro; las que cruzan un corte son del panorama
 */
export function slideContent<L extends MovableLayer>(layers: L[], slide: Rect, continuous: boolean, boundsOf: (l: L) => Rect): L[] {
  return layers.filter(l => {
    if (l.kind === 'group') return false;
    const b = boundsOf(l);
    return continuous ? contains(slide, b) : centerIn(slide, b);
  });
}

export interface SlideBox extends Rect { id: string }

/**
 * Nuevo orden de diapositivas: cada una pasa a la posición que ocupaba la de su nuevo índice y su
 * contenido la acompaña. Devuelve la posición nueva de cada mesa y el desplazamiento de cada capa.
 */
export function reorderSlides<L extends MovableLayer>(
  slides: SlideBox[], order: string[], layers: L[], continuous: boolean, boundsOf: (l: L) => Rect,
): { positions: Map<string, { x: number; y: number; index: number }>; shifts: Map<string, { dx: number; dy: number }> } {
  const positions = new Map<string, { x: number; y: number; index: number }>();
  const shifts = new Map<string, { dx: number; dy: number }>();
  const byId = new Map(slides.map(s => [s.id, s]));
  // las ranuras son las posiciones actuales, en orden
  const slots = slides.map(s => ({ x: s.x, y: s.y }));
  order.forEach((id, i) => {
    const s = byId.get(id);
    if (!s) return;
    const to = slots[i];
    positions.set(id, { ...to, index: i });
    const dx = to.x - s.x, dy = to.y - s.y;
    if (!dx && !dy) return;
    for (const l of slideContent(layers, s, continuous, boundsOf)) if (!shifts.has(l.id)) shifts.set(l.id, { dx, dy });
  });
  return { positions, shifts };
}

/** Mueve un elemento de una lista de `from` a `to`. */
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const out = [...arr];
  if (from < 0 || from >= out.length) return out;
  const [x] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, x);
  return out;
}
