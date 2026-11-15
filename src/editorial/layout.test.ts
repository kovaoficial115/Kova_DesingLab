import { describe, it, expect } from 'vitest';
import {
  bands, contentBox, columnBands, rowBands, layoutSnapLines, presetLayout, sanitizeLayout, hasLayout, emptyLayout,
  compositionGuides, alignDeltas, distributeDeltas, PHI,
} from './layout';

const ab = { x: 100, y: 50, w: 1400, h: 1000 };

describe('retícula de maquetación', () => {
  it('bandas iguales con medianil', () => {
    const b = bands(0, 1000, 4, 20);
    expect(b.length).toBe(4);
    expect(b[0]).toEqual({ a: 0, b: 235 });
    expect(b[3].b).toBeCloseTo(1000);
    expect(bands(0, 100, 10, 20)).toEqual([]); // los medianiles no caben
  });

  it('columnas dentro de los márgenes', () => {
    const g = { ...emptyLayout(), margins: { top: 40, right: 60, bottom: 40, left: 60 }, columns: 12, gutter: 20 };
    expect(contentBox(ab, g)).toEqual({ x: 160, y: 90, w: 1280, h: 920 });
    const c = columnBands(ab, g);
    expect(c.length).toBe(12);
    expect(c[0].a).toBe(160);
    expect(c[11].b).toBeCloseTo(1440);
    expect(c[1].a - c[0].b).toBeCloseTo(20);
    expect(rowBands(ab, g)).toEqual([]);
  });

  it('líneas magnéticas: márgenes, columnas, filas y línea base', () => {
    const g = { ...emptyLayout(), margins: { top: 100, right: 100, bottom: 100, left: 100 }, columns: 2, gutter: 40, rows: 2, rowGutter: 0, baseline: 200 };
    const r = layoutSnapLines(ab, g);
    expect(r.xs).toEqual(expect.arrayContaining([200, 1400, 780, 820]));
    expect(r.ys).toEqual(expect.arrayContaining([150, 950, 550, 350, 750]));
  });

  it('presets proporcionales y saneado', () => {
    const p = presetLayout('c12', 1400, 1000);
    expect(p.columns).toBe(12);
    expect(p.margins.left).toBe(60);
    expect(hasLayout(p)).toBe(true);
    expect(hasLayout(emptyLayout())).toBe(false);
    expect(sanitizeLayout({ columns: 99, gutter: -5, margins: { top: 'x' } })).toEqual({ margins: { top: 0, right: 0, bottom: 0, left: 0 }, columns: 48, gutter: 0, rows: 0, rowGutter: 0, baseline: 0 });
    expect(sanitizeLayout(null)).toBeUndefined();
  });
});

describe('guías de composición', () => {
  const r = { x: 0, y: 0, w: 900, h: 600 };
  it('tercios y φ', () => {
    const t = compositionGuides(r, 'thirds');
    expect(t.filter(s => s.x1 === s.x2).map(s => s.x1)).toEqual([300, 600]);
    expect(t.filter(s => s.y1 === s.y2).map(s => s.y1)).toEqual([200, 400]);
    const p = compositionGuides(r, 'phi');
    expect(p[0].x1).toBeCloseTo(900 / PHI ** 2);
    expect(p[1].x1).toBeCloseTo(900 - 900 / PHI ** 2);
  });
  it('diagonales: las perpendiculares caen sobre la diagonal', () => {
    const d = compositionGuides(r, 'diagonals');
    expect(d.length).toBe(6);
    const f = d[2]; // desde la esquina superior derecha hasta la diagonal principal
    expect(f.y2 / f.x2).toBeCloseTo(600 / 900);
    // perpendicular: producto escalar con la diagonal = 0
    expect((f.x2 - f.x1) * 900 + (f.y2 - f.y1) * 600).toBeCloseTo(0);
  });
  it('espiral: continua y dentro de la caja; girar la refleja', () => {
    const s = compositionGuides(r, 'spiral', 0);
    expect(s.every(l => l.x1 >= -0.01 && l.x1 <= 900.01 && l.y1 >= -0.01 && l.y1 <= 600.01)).toBe(true);
    const arcs = s.slice(10);
    for (let i = 1; i < arcs.length; i++) {
      expect(arcs[i].x1).toBeCloseTo(arcs[i - 1].x2, 6);
      expect(arcs[i].y1).toBeCloseTo(arcs[i - 1].y2, 6);
    }
    const m = compositionGuides(r, 'spiral', 1);
    expect(m[10].x1).toBeCloseTo(900 - s[10].x1);
  });
});

describe('alinear y distribuir', () => {
  const items = [{ x: 0, y: 0, w: 10, h: 10 }, { x: 50, y: 20, w: 30, h: 10 }, { x: 200, y: 5, w: 20, h: 40 }];
  it('alinea a una referencia', () => {
    expect(alignDeltas(items, 'left', { x: 0, y: 0, w: 300, h: 100 }).map(d => d.dx)).toEqual([0, -50, -200]);
    expect(alignDeltas(items, 'bottom', { x: 0, y: 0, w: 300, h: 100 }).map(d => d.dy)).toEqual([90, 70, 55]);
    expect(alignDeltas([items[0]], 'hcenter', { x: 0, y: 0, w: 100, h: 100 })[0].dx).toBe(45);
  });
  it('mismo espacio: los extremos no se mueven', () => {
    const d = distributeDeltas(items, 'h', 'gap');
    expect(d[0]).toBe(0);
    expect(d[2]).toBe(0);
    // huecos iguales: (220 - 60) / 2 = 80 → la segunda empieza en 90
    expect(50 + d[1]).toBe(90);
  });
  it('espacio fijo y centros', () => {
    const f = distributeDeltas(items, 'h', 'fixed', 10);
    expect([0 + f[0], 50 + f[1], 200 + f[2]]).toEqual([0, 20, 60]);
    const c = distributeDeltas(items, 'h', 'centers');
    expect(65 + c[1]).toBeCloseTo((5 + 210) / 2);
    // el orden de entrada se respeta aunque no estén ordenadas
    const r = distributeDeltas([items[2], items[0], items[1]], 'h', 'fixed', 10);
    expect([200 + r[0], 0 + r[1], 50 + r[2]]).toEqual([60, 0, 20]);
  });
});
