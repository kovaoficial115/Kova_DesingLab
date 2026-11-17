import { describe, it, expect } from 'vitest';
import {
  defaultGradient, gradientAngle, withAngle, withType, sampleGradient, addStop, removeStop, reverseGradient,
  svgGradientDef, dashArray, polygonPoints, sanitizeGradient, sanitizeStrokeStyle,
} from './paint';

describe('degradados', () => {
  it('ángulo: lectura y cambio conservando el centro', () => {
    const g = defaultGradient('#ff0000', '#0000ff');
    expect(gradientAngle(g)).toBe(0);
    const r = withAngle(g, 90);
    expect(gradientAngle(r)).toBe(90);
    expect((r.x1 + r.x2) / 2).toBeCloseTo(0.5); expect((r.y1 + r.y2) / 2).toBeCloseTo(0.5);
  });
  it('añadir un punto no cambia el aspecto (color interpolado) y quitar deja al menos dos', () => {
    const g = defaultGradient('#000000', '#ffffff');
    const { g: g2, index } = addStop(g, 0.5);
    expect(g2.stops).toHaveLength(3);
    expect(g2.stops[index].color).toBe('#808080');
    expect(sampleGradient({ ...g, stops: [{ pos: 0, color: '#000000', opacity: 0 }, { pos: 1, color: '#000000', opacity: 1 }] }, 0.25).opacity).toBeCloseTo(0.25);
    expect(removeStop(g, 0).stops).toHaveLength(2);
    expect(removeStop(g2, 1).stops).toHaveLength(2);
  });
  it('invertir y cambiar de tipo conservan los colores', () => {
    const g = defaultGradient('#112233', '#445566');
    expect(reverseGradient(g).stops.map(s => s.pos)).toEqual([1, 0]);
    const r = withType(g, 'radial');
    expect(r.type).toBe('radial'); expect(r.stops).toEqual(g.stops);
  });
  it('SVG: lineal y radial en px; angular no admitido (se rasteriza)', () => {
    const g = { ...defaultGradient('#ff0000', '#0000ff'), stops: [{ pos: 0, color: '#ff0000', opacity: 0.5 }, { pos: 1, color: '#0000ff', opacity: 1 }] };
    const d = svgGradientDef('g1', g, 200, 100)!;
    expect(d).toContain('<linearGradient id="g1"'); expect(d).toContain('x2="200"'); expect(d).toContain('stop-opacity="0.5"');
    expect(svgGradientDef('g2', withType(g, 'radial'), 200, 100)).toContain('<radialGradient');
    expect(svgGradientDef('g3', withType(g, 'conic'), 200, 100)).toBeNull();
  });
  it('saneado: descarta colores no válidos y exige dos puntos', () => {
    expect(sanitizeGradient({ type: 'x', stops: [{ pos: 2, color: '#fff' }, { pos: 0, color: '#000000', opacity: 9 }] }))
      .toEqual({ type: 'linear', stops: [{ pos: 1, color: '#fff', opacity: 1 }, { pos: 0, color: '#000000', opacity: 1 }], x1: 0, y1: 0.5, x2: 1, y2: 0.5 });
    expect(sanitizeGradient({ stops: [{ pos: 0, color: 'red' }, { pos: 1, color: '#000' }] })).toBeNull();
    expect(sanitizeGradient('x')).toBeNull();
  });
});

describe('contornos y formas', () => {
  it('patrones de trazo', () => {
    expect(dashArray('solid', 4)).toEqual([]);
    expect(dashArray('dashed', 4)).toEqual([12, 8]);
    expect(dashArray('dotted', 4)[1]).toBe(8);
  });
  it('estilo de contorno saneado con valores por defecto compatibles', () => {
    expect(sanitizeStrokeStyle({})).toEqual({ dash: 'solid', cap: 'butt', join: 'miter', align: 'center', opacity: 1 });
    expect(sanitizeStrokeStyle({ dash: 'dotted', align: 'outside', opacity: 3 })?.opacity).toBe(1);
    expect(sanitizeStrokeStyle(null)).toBeNull();
  });
  it('polígono y estrella', () => {
    const hex = polygonPoints(6, 100, 100);
    expect(hex).toHaveLength(6);
    expect(hex[0].x).toBeCloseTo(50); expect(hex[0].y).toBeCloseTo(0);
    const star = polygonPoints(5, 100, 100, 0, 0.5);
    expect(star).toHaveLength(10);
    expect(Math.hypot(star[1].x - 50, star[1].y - 50)).toBeCloseTo(25);
    expect(polygonPoints(1, 10, 10)).toHaveLength(3);
  });
});
