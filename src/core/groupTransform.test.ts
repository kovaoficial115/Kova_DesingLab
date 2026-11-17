import { describe, it, expect } from 'vitest';
import type { Layer } from './types';
import { scalePatch, rotatePatch, handleScale } from './groupTransform';
import { layerPivot } from './util';

const rect = (id: string, x: number, y: number, w: number, h: number, extra: Partial<Layer> = {}): Layer => ({
  id, name: id, kind: 'shape', visible: true, locked: false, opacity: 1, blend: 'source-over', x, y, rotation: 0, scaleX: 1, scaleY: 1,
  parentId: null, clip: false, adjustments: [], mask: null, maskEnabled: true,
  shape: { shape: 'rect', w, h, fill: '#000', stroke: null, strokeWidth: 0, radius: 0 }, ...extra,
});
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('transformación conjunta', () => {
  it('escala proporcional desde la esquina: posiciones relativas y tamaños ×2', () => {
    const a = rect('a', 0, 0, 100, 100), b = rect('b', 200, 0, 100, 100);
    const A = { x: 0, y: 0 };
    const pa = { ...a, ...scalePatch(a, A, 2, 2) }, pb = { ...b, ...scalePatch(b, A, 2, 2) };
    expect([pa.x, pa.y, pa.scaleX, pa.scaleY]).toEqual([0, 0, 2, 2]);
    expect([pb.x, pb.y, pb.scaleX]).toEqual([400, 0, 2]);
  });

  it('escala libre de una capa girada 90°: intercambia los ejes', () => {
    const a = rect('a', 0, 0, 100, 50, { rotation: 90 });
    const p = scalePatch(a, { x: 0, y: 0 }, 2, 1);
    close(p.scaleX!, 1); close(p.scaleY!, 2);
  });

  it('girar 90° alrededor del centro de la selección mueve los centros y suma el giro', () => {
    const a = rect('a', 0, 0, 100, 100); // centro (50, 50)
    const C = { x: 150, y: 50 };
    const p = { ...a, ...rotatePatch(a, C, 90) };
    const c = layerPivot(p);
    close(c.x, 150); close(c.y, -50);
    expect(p.rotation).toBe(90);
    // girar de vuelta devuelve el estado inicial (sin acumular errores)
    const back = { ...p, ...rotatePatch(p, C, -90) };
    close(back.x, 0); close(back.y, 0); close(back.rotation, 0);
  });

  it('el giro conserva el volteo de la capa', () => {
    const a = rect('a', 0, 0, 10, 10, { scaleX: -1, rotation: 170 });
    const p = rotatePatch(a, { x: 0, y: 0 }, 20);
    expect(p.rotation).toBe(-170);
    expect(p.scaleX).toBeUndefined();
  });

  it('asas: esquina proporcional, lado libre, desde el centro y sin voltear', () => {
    const box = { x: 0, y: 0, w: 100, h: 50 };
    expect(handleScale(box, 1, 1, { x: 200, y: 60 })).toMatchObject({ A: { x: 0, y: 0 }, rx: 2, ry: 2 });
    expect(handleScale(box, 1, 1, { x: 200, y: 60 }, { free: true })).toMatchObject({ rx: 2, ry: 1.2 });
    expect(handleScale(box, 1, 0.5, { x: 150, y: 999 })).toMatchObject({ rx: 1.5, ry: 1 });
    expect(handleScale(box, 1, 0.5, { x: 150, y: 0 }, { keep: true })).toMatchObject({ rx: 1.5, ry: 1.5 });
    expect(handleScale(box, 1, 0.5, { x: 100, y: 0 }, { fromCenter: true })).toMatchObject({ A: { x: 50, y: 25 }, rx: 1 });
    expect(handleScale(box, 1, 1, { x: -500, y: -500 }).rx).toBe(0.01);
  });
});
