import { describe, it, expect } from 'vitest';
import { dabPositions, sanitizeBrushes, defaultBrushes, rng } from './brush';

describe('dabPositions', () => {
  it('reparte los toques a la separación pedida y arrastra el resto', () => {
    const a = dabPositions({ x: 0, y: 0 }, { x: 25, y: 0 }, 10, 0);
    expect(a.points.map(p => p.x)).toEqual([10, 20]);
    expect(a.carry).toBeCloseTo(5);
    // el siguiente tramo sigue la cuenta: el primer toque cae a 10 px del último
    const b = dabPositions({ x: 25, y: 0 }, { x: 40, y: 0 }, 10, a.carry);
    expect(b.points.map(p => p.x)).toEqual([30, 40]);
    expect(b.carry).toBeCloseTo(0);
  });
  it('un tramo corto no pinta pero acumula distancia', () => {
    const a = dabPositions({ x: 0, y: 0 }, { x: 3, y: 4 }, 10, 2);
    expect(a.points).toEqual([]);
    expect(a.carry).toBeCloseTo(7);
  });
  it('sin movimiento no hace nada', () => {
    expect(dabPositions({ x: 1, y: 1 }, { x: 1, y: 1 }, 10, 3)).toEqual({ points: [], carry: 3 });
  });
});

describe('sanitizeBrushes', () => {
  it('rellena con los valores por defecto lo que falta o no es válido', () => {
    const b = sanitizeBrushes({ eraser: { size: 90, hardness: 'x', texture: 'tex-grain' }, brush: null });
    expect(b.eraser.size).toBe(90);
    expect(b.eraser.hardness).toBe(defaultBrushes().eraser.hardness);
    expect(b.eraser.texture).toBe('tex-grain');
    expect(b.brush).toEqual(defaultBrushes().brush);
    expect(b.restore).toEqual(defaultBrushes().restore);
  });
  it('acepta textura nula y descarta basura', () => {
    expect(sanitizeBrushes({ brush: { texture: null } }).brush.texture).toBeNull();
    expect(sanitizeBrushes('basura')).toEqual(defaultBrushes());
  });
  it('el borrador tiene sus propios ajustes', () => {
    const d = defaultBrushes();
    d.eraser.size = 10;
    expect(d.brush.size).not.toBe(10);
  });
});

describe('rng', () => {
  it('es determinista y está en [0, 1)', () => {
    const a = rng(42), b = rng(42);
    const xs = Array.from({ length: 50 }, () => a());
    expect(xs).toEqual(Array.from({ length: 50 }, () => b()));
    expect(xs.every(v => v >= 0 && v < 1)).toBe(true);
  });
});
