import { describe, it, expect } from 'vitest';
import { fitAspect, resizeCrop, moveCrop, roundCrop, pivotAfterResize, sanitizeCrop } from './imageCrop';

const W = 400, H = 300;
// mundo(p) = piv + R·S·(p − tamaño/2)
const world = (piv: { x: number; y: number }, rot: number, sx: number, sy: number, w: number, h: number, p: { x: number; y: number }) => {
  const a = (rot * Math.PI) / 180, vx = (p.x - w / 2) * sx, vy = (p.y - h / 2) * sy;
  return { x: piv.x + vx * Math.cos(a) - vy * Math.sin(a), y: piv.y + vx * Math.sin(a) + vy * Math.cos(a) };
};

describe('recorte de imagen', () => {
  it('fitAspect: mayor marco con la proporción, centrado y dentro de la imagen', () => {
    const r = fitAspect({ x: 0, y: 0, w: W, h: H }, 1, W, H);
    expect(r).toEqual({ x: 50, y: 0, w: 300, h: 300 });
    const v = fitAspect({ x: 0, y: 0, w: W, h: H }, 9 / 16, W, H);
    expect(v.h).toBeCloseTo(300); expect(v.w).toBeCloseTo(168.75); expect(v.x + v.w).toBeLessThanOrEqual(W);
  });
  it('resizeCrop libre: el asa mueve solo su lado y no sale de la imagen', () => {
    const r0 = { x: 50, y: 50, w: 100, h: 100 };
    expect(resizeCrop(r0, 'e', 30, 99, W, H, null)).toEqual({ x: 50, y: 50, w: 130, h: 100 });
    expect(resizeCrop(r0, 'nw', -500, -500, W, H, null)).toEqual({ x: 0, y: 0, w: 150, h: 150 });
    expect(resizeCrop(r0, 'w', 500, 0, W, H, null).w).toBeGreaterThanOrEqual(1);
  });
  it('resizeCrop con proporción la mantiene y respeta los bordes', () => {
    const r0 = { x: 100, y: 100, w: 100, h: 100 };
    const r = resizeCrop(r0, 'se', 500, 20, W, H, 16 / 9);
    expect(r.w / r.h).toBeCloseTo(16 / 9);
    expect(r.x).toBe(100); expect(r.y).toBe(100);
    expect(r.x + r.w).toBeLessThanOrEqual(W + 1e-9); expect(r.y + r.h).toBeLessThanOrEqual(H + 1e-9);
    const s = resizeCrop(r0, 'n', 0, -40, W, H, 1);
    expect(s.w).toBeCloseTo(s.h); expect(s.y + s.h).toBeCloseTo(200);
  });
  it('moveCrop no deja salir el marco', () => {
    expect(moveCrop({ x: 10, y: 10, w: 100, h: 50 }, 1000, -1000, W, H)).toEqual({ x: 300, y: 0, w: 100, h: 50 });
  });
  it('roundCrop da píxeles enteros dentro de la imagen', () => {
    expect(roundCrop({ x: 10.4, y: -2, w: 500.7, h: 20.5 }, W, H)).toEqual({ x: 10, y: 0, w: 390, h: 21 });
  });
  it('pivotAfterResize conserva la posición en el mundo de la zona visible (con giro y escala)', () => {
    const piv = { x: 500, y: 300 }, rot = 33, sx = 1.5, sy = -0.75;
    const crop = { x: 60, y: 40, w: 200, h: 120 };
    const np = pivotAfterResize(piv, rot, sx, sy, W, H, crop.w, crop.h, { x: crop.x, y: crop.y }, { x: 0, y: 0 });
    for (const [u, v] of [[0, 0], [crop.w, 0], [crop.w, crop.h], [37, 91]]) {
      const before = world(piv, rot, sx, sy, W, H, { x: crop.x + u, y: crop.y + v });
      const after = world(np, rot, sx, sy, crop.w, crop.h, { x: u, y: v });
      expect(after.x).toBeCloseTo(before.x, 9); expect(after.y).toBeCloseTo(before.y, 9);
    }
    // ida y vuelta: quitar el recorte devuelve el centro original
    const back = pivotAfterResize(np, rot, sx, sy, crop.w, crop.h, W, H, { x: 0, y: 0 }, { x: crop.x, y: crop.y });
    expect(back.x).toBeCloseTo(piv.x, 9); expect(back.y).toBeCloseTo(piv.y, 9);
  });
  it('sanitizeCrop rechaza datos inválidos', () => {
    expect(sanitizeCrop({ x: 1, y: 2, w: 3, h: 4 })).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(sanitizeCrop({ x: 1, y: 2, w: 0, h: 4 })).toBeNull();
    expect(sanitizeCrop({ x: '1', y: 2, w: 3, h: 4 })).toBeNull();
    expect(sanitizeCrop(null)).toBeNull();
  });
});
