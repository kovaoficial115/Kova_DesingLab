import { describe, it, expect } from 'vitest';
import { uvOverlap } from './uvOverlap';

// cuadrado [0,0]-[1,1] hecho con dos triángulos que comparten la diagonal
const quad = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y0, x1, y1, x0, y1];

describe('solapes UV', () => {
  it('dos triángulos que comparten arista no cuentan como solape', () => {
    const r = uvOverlap(quad(0, 0, 1, 1), null, [0, 0, 1, 1], 256);
    expect(r.coverage).toBeGreaterThan(0.98);
    expect(r.overlap).toBe(0);
  });
  it('dos islas encima detecta el solape', () => {
    const r = uvOverlap([...quad(0, 0, 0.5, 0.5), ...quad(0.25, 0.25, 0.75, 0.75)], null, [0, 0, 1, 1], 256);
    // 0.0625 de solape sobre 0.4375 cubierto
    expect(r.overlap).toBeCloseTo(0.0625 / 0.4375, 2);
  });
  it('solo analiza la región pedida (zona imprimible) y admite índices', () => {
    const uv = [0, 0, 0.5, 0, 0.5, 0.5, 0, 0.5, /* isla 2 */ 0.6, 0.6, 0.9, 0.6, 0.9, 0.9, 0.6, 0.9];
    const idx = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, /* duplicado de la isla 2 */ 4, 5, 6, 4, 6, 7];
    expect(uvOverlap(uv, idx, [0, 0, 0.5, 0.5], 128).overlap).toBe(0);
    expect(uvOverlap(uv, idx, [0.55, 0.55, 1, 1], 128).overlap).toBeCloseTo(1, 2);
  });
});
