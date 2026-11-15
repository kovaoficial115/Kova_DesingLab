import { describe, it, expect } from 'vitest';
import { boxMean, guidedMatte, otsu, quickSubject, lumaMask } from './matte';

function img(w: number, h: number, fn: (x: number, y: number) => [number, number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(fn(x, y), (y * w + x) * 4);
  return { data, width: w, height: h };
}

describe('boxMean', () => {
  it('promedia en ventanas y respeta los bordes', () => {
    const src = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const m = boxMean(src, 3, 3, 1);
    expect(m[4]).toBeCloseTo(5);
    expect(m[0]).toBeCloseTo((1 + 2 + 4 + 5) / 4);
  });
});

describe('otsu', () => {
  it('separa dos poblaciones', () => {
    const h = new Array(256).fill(0);
    h[20] = 100; h[200] = 100;
    const t = otsu(h);
    expect(t).toBeGreaterThanOrEqual(20);
    expect(t).toBeLessThan(200);
  });
});

describe('guidedMatte', () => {
  it('sigue el borde de la imagen y no toca dentro ni fuera', () => {
    // imagen: mitad izquierda oscura, derecha clara; selección: borde desplazado 3 px y duro
    const W = 40, H = 20;
    const p = img(W, H, (x) => [x < 20 ? 30 : 220, x < 20 ? 30 : 220, x < 20 ? 30 : 220, x < 23 ? 0 : 255]);
    guidedMatte(p, 6, 0.0005);
    const a = (x: number, y = 10) => p.data[(y * W + x) * 4 + 3];
    expect(a(2)).toBe(0); // lejos del borde: igual
    expect(a(37)).toBe(255);
    // el borde de la selección se va al borde de la imagen (x = 20), no al de la selección (x = 23)
    expect(a(18)).toBeLessThan(10);
    expect(a(20)).toBeGreaterThan(90);
    expect(a(23)).toBeGreaterThan(a(20));
  });
});

describe('quickSubject', () => {
  it('encuentra un sujeto sobre un fondo uniforme y rellena sus huecos', () => {
    const W = 120, H = 100;
    const p = img(W, H, (x, y) => {
      const inCircle = (x - 60) ** 2 + (y - 50) ** 2 < 30 ** 2;
      const hole = (x - 60) ** 2 + (y - 50) ** 2 < 6 ** 2; // del color del fondo: debe rellenarse
      return inCircle && !hole ? [200, 40, 40, 255] : [235, 235, 230, 255];
    });
    const frac = quickSubject(p);
    const a = (x: number, y: number) => p.data[(y * W + x) * 4 + 3];
    expect(a(60, 50)).toBe(255); // el hueco interior queda dentro
    expect(a(60, 30)).toBe(255);
    expect(a(5, 5)).toBe(0);
    expect(a(110, 90)).toBe(0);
    expect(frac).toBeGreaterThan(0.2);
    expect(frac).toBeLessThan(0.3);
  });
  it('sin contraste devuelve 0', () => {
    const p = img(50, 50, () => [128, 128, 128, 255]);
    expect(quickSubject(p)).toBe(0);
  });
});

describe('máscara de luminancia', () => {
  it('luces visibles, sombras invertidas y transparente = negro', () => {
    const l = lumaMask(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 0]), false);
    expect([l[0], l[4], l[8]]).toEqual([255, 0, 0]);
    const s = lumaMask(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]), true);
    expect([s[0], s[4]]).toEqual([0, 255]);
  });
});
