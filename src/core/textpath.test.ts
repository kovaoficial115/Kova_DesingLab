import { describe, it, expect } from 'vitest';
import { flattenPath, samplePath, pointAt, circlePath, arcPath, wavePath, layoutOnPath, shapeOutline } from './textpath';

describe('trayectorias', () => {
  it('lee líneas, curvas y comandos relativos', () => {
    const [s] = flattenPath('M0 0 L10 0 l0 10 h-10 z');
    expect(s.closed).toBe(true);
    expect(s.pts[0]).toEqual({ x: 0, y: 0 });
    expect(s.pts.at(-1)).toEqual({ x: 0, y: 0 });
    const S = samplePath('M0 0 L10 0 l0 10 h-10 z')!;
    expect(S.total).toBeCloseTo(40);
  });
  it('círculo: empieza arriba y va en el sentido del reloj', () => {
    const S = samplePath(circlePath(100))!;
    expect(S.total).toBeCloseTo(2 * Math.PI * 100, 0);
    const top = pointAt(S, 0);
    expect(top.x).toBeCloseTo(0); expect(top.y).toBeCloseTo(-100);
    const right = pointAt(S, S.total / 4);
    expect(right.x).toBeCloseTo(100, 0); expect(right.y).toBeCloseTo(0, 0);
    // la vuelta completa vuelve al inicio
    expect(pointAt(S, S.total + 1).y).toBeCloseTo(-100, 0);
  });
  it('al revés, la mitad del recorrido queda abajo', () => {
    const S = samplePath(circlePath(50), true)!;
    const p = pointAt(S, S.total / 2);
    expect(p.y).toBeCloseTo(50, 0);
    expect(Math.cos(p.a)).toBeGreaterThan(0.99); // abajo avanza hacia la derecha: se lee bien
  });
  it('arco centrado arriba', () => {
    const S = samplePath(arcPath(100, 90))!;
    expect(S.total).toBeCloseTo((Math.PI / 2) * 100, 0);
    const mid = pointAt(S, S.total / 2);
    expect(mid.x).toBeCloseTo(0, 0); expect(mid.y).toBeCloseTo(-100, 0);
  });
  it('onda y contornos de formas', () => {
    expect(samplePath(wavePath(10, 100, 2))!.pts.at(-1)!.x).toBeCloseTo(200);
    expect(samplePath(shapeOutline('rect', 100, 50))!.total).toBeCloseTo(300);
    expect(samplePath(shapeOutline('ellipse', 100, 100))!.total).toBeCloseTo(Math.PI * 100, 0);
  });
  it('coloca las letras centradas en su posición', () => {
    const S = samplePath('M0 0 L1000 0')!;
    const g = layoutOnPath(['A', 'B', 'C'], i => i * 10, { S, pos: 50, align: 'center', letterSpacing: 0, shift: 0 });
    expect(g.map(x => x.x)).toEqual([490, 500, 510]);
    expect(g[0].a).toBeCloseTo(0);
    const up = layoutOnPath(['A'], i => i * 10, { S, pos: 0, align: 'left', letterSpacing: 0, shift: 5 });
    expect(up[0].y).toBeCloseTo(-5); // «hacia fuera» = encima de la línea
  });
});
