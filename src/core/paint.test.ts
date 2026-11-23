import { describe, it, expect } from 'vitest';
import {
  defaultGradient, gradientAngle, withAngle, withType, sampleGradient, addStop, removeStop, reverseGradient,
  svgGradientDef, dashArray, polygonPoints, sanitizeGradient, sanitizeStrokeStyle, lineGeometry, lineBoxHeight, sanitizeArrowHead,
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

describe('puntas de línea', () => {
  it('sin puntas la caja mide el grosor y el tramo ocupa todo el ancho', () => {
    expect(lineBoxHeight(6)).toBe(6);
    const g = lineGeometry(100, 6, 6);
    expect(g.x1).toBe(0); expect(g.x2).toBe(100); expect(g.heads).toHaveLength(0);
  });
  it('extremos redondos sin punta: el trazo no se sale de la caja', () => {
    const g = lineGeometry(100, 6, 6, 'none', 'none', 'round');
    expect(g.x1).toBe(3); expect(g.x2).toBe(97);
  });
  it('con punta la caja crece y la punta queda dentro', () => {
    const t = 4, h = lineBoxHeight(t, 'none', 'triangle');
    expect(h).toBeGreaterThan(t);
    const g = lineGeometry(200, h, t, 'none', 'triangle');
    const tri = g.heads[0];
    expect(tri.kind).toBe('fill');
    if (tri.kind !== 'fill') return;
    for (const p of tri.pts) { expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(200); expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(h); }
    expect(Math.max(...tri.pts.map(p => p.x))).toBe(200); // la punta toca el final
    expect(g.x2).toBeLessThan(200); // el tramo se recorta bajo la punta
  });
  it('flecha abierta en el inicio apunta hacia la izquierda', () => {
    const t = 4, h = lineBoxHeight(t, 'arrow');
    const g = lineGeometry(200, h, t, 'arrow');
    const v = g.heads[0];
    expect(v.kind).toBe('open');
    if (v.kind !== 'open') return;
    expect(v.pts[1].x).toBeLessThan(v.pts[0].x); // el vértice está más a la izquierda que los brazos
    expect(v.pts[1].x - t / 2).toBeGreaterThanOrEqual(0);
    expect(Math.min(...v.pts.map(p => p.y)) - t / 2).toBeGreaterThanOrEqual(0);
  });
  it('una línea más corta que sus puntas no dibuja tramo negativo', () => {
    const g = lineGeometry(4, lineBoxHeight(4, 'triangle', 'triangle'), 4, 'triangle', 'triangle');
    expect(g.x2).toBeGreaterThanOrEqual(g.x1);
  });
  it('saneado de puntas', () => {
    expect(sanitizeArrowHead('arrow')).toBe('arrow');
    expect(sanitizeArrowHead('none')).toBeUndefined();
    expect(sanitizeArrowHead('<script>')).toBeUndefined();
  });
});
