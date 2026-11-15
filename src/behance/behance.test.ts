import { describe, it, expect } from 'vitest';
import {
  sectionPositions, restackPlan, planSegments, maxSegmentHeight, crossingItems, checkOutput, checkCover, coverCrop,
  seamDifference, sectionFileName, segmentFileName, sanitizeArtboardBehance, listProjects, projectSections, presetHeight,
  SECTION_PRESETS, BEHANCE_GUIDE, inSection,
} from './model';
import { parseKova, downgradeToV1, buildKova } from '../io/kova';

const ab = (id: string, y: number, h: number, index: number, project = 'p1', continuous = true) =>
  ({ id, name: id, x: 0, y, w: 1400, h, dpi: 72, background: '#fff', margin: 0, behance: { project, name: 'Proyecto', index, continuous } });

describe('secciones', () => {
  it('apila con y sin hueco', () => {
    expect(sectionPositions([1000, 1800, 2400], 0, 0)).toEqual([0, 1000, 2800]);
    expect(sectionPositions([1000, 1800], 50, 120)).toEqual([50, 1170]);
  });

  it('presets de diseño: escalan con el ancho del proyecto', () => {
    expect(SECTION_PRESETS.map(p => p.h)).toEqual([1000, 1800, 2400, 3000, 4000]);
    expect(presetHeight(SECTION_PRESETS[0], 2800)).toBe(2000);
  });

  it('lista proyectos con las secciones en orden', () => {
    const abs = [ab('b', 1000, 1800, 1), ab('a', 0, 1000, 0), ab('z', 0, 500, 0, 'p2'), { ...ab('n', 0, 10, 0), behance: null }] as any[];
    const ps = listProjects(abs);
    expect(ps.map(p => p.id)).toEqual(['p1', 'p2']);
    expect(projectSections(abs, 'p1').map(a => a.id)).toEqual(['a', 'b']);
  });

  it('reordenar: cada sección se lleva su contenido; lo que cruza un corte se queda (continuo)', () => {
    const secs = [{ id: 'a', x: 0, y: 0, w: 1400, h: 1000 }, { id: 'b', x: 0, y: 1000, w: 1400, h: 2000 }];
    const items = [
      { id: 'inA', b: { x: 10, y: 10, w: 100, h: 100 } },
      { id: 'inB', b: { x: 10, y: 1500, w: 100, h: 100 } },
      { id: 'cross', b: { x: 10, y: 900, w: 100, h: 200 } },
    ];
    const plan = restackPlan(secs, [{ id: 'b', h: 2000 }, { id: 'a', h: 1000 }], 0, 0, items, i => i.b, true);
    expect(plan.ys.get('b')).toBe(0);
    expect(plan.ys.get('a')).toBe(2000);
    expect(plan.shifts.get('inA')).toBe(2000);
    expect(plan.shifts.get('inB')).toBe(-1000);
    expect(plan.shifts.has('cross')).toBe(false);
    expect(plan.bottom).toBe(3000);
  });

  it('modo separado: pertenece a la sección donde está su centro', () => {
    expect(inSection({ x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 80, w: 10, h: 30 }, false)).toBe(true);
    expect(inSection({ x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 80, w: 10, h: 30 }, true)).toBe(false);
  });

  it('cambiar el alto mueve lo de las secciones de debajo', () => {
    const secs = [{ id: 'a', x: 0, y: 0, w: 1400, h: 1000 }, { id: 'b', x: 0, y: 1000, w: 1400, h: 1000 }];
    const plan = restackPlan(secs, [{ id: 'a', h: 1800 }, { id: 'b', h: 1000 }], 0, 0, [{ id: 't', b: { x: 0, y: 1200, w: 10, h: 10 } }], i => i.b, true);
    expect(plan.ys.get('b')).toBe(1800);
    expect(plan.shifts.get('t')).toBe(800);
  });

  it('detecta elementos que cruzan el límite entre secciones', () => {
    const secs = [{ x: 0, y: 0, w: 1400, h: 1000 }, { x: 0, y: 1000, w: 1400, h: 1000 }];
    const r = crossingItems(secs, [{ b: { x: 0, y: 950, w: 10, h: 100 } }, { b: { x: 0, y: 100, w: 10, h: 100 } }, { b: { x: 2000, y: 950, w: 10, h: 100 } }], i => i.b);
    expect(r.length).toBe(1);
    expect(r[0].at).toBe(0);
  });
});

describe('imagen continua por segmentos', () => {
  it('no parte nada si cabe en un segmento', () => {
    const s = planSegments([1000, 1800, 2400], 16000);
    expect(s.length).toBe(1);
    expect(s[0].h).toBe(5200);
    expect(s[0].pieces.map(p => p.section)).toEqual([0, 1, 2]);
  });

  it('corta entre secciones cuando puede', () => {
    const s = planSegments([3000, 3000, 3000], 7000);
    expect(s.map(x => x.h)).toEqual([6000, 3000]);
    expect(s[1].pieces).toEqual([{ section: 2, y0: 0, y1: 3000 }]);
  });

  it('parte una sección más alta que el límite y no pierde ni repite píxeles', () => {
    const hs = [1000, 9000, 500];
    const s = planSegments(hs, 4000);
    expect(s.every(x => x.h <= 4000)).toBe(true);
    const per = [0, 0, 0];
    for (const seg of s) {
      expect(seg.h).toBe(seg.pieces.reduce((n, p) => n + p.y1 - p.y0, 0));
      for (const p of seg.pieces) per[p.section] += p.y1 - p.y0;
    }
    expect(per).toEqual(hs);
  });

  it('alto máximo: 32 MP, 16 000 px y el límite de WebP', () => {
    expect(maxSegmentHeight(1400, 'jpg')).toBe(16000);
    expect(maxSegmentHeight(2800, 'jpg')).toBe(Math.floor(32_000_000 / 2800));
    expect(maxSegmentHeight(500, 'webp')).toBe(16000);
    expect(maxSegmentHeight(2800, 'png') * 2800).toBeLessThanOrEqual(BEHANCE_GUIDE.maxPixels);
  });
});

describe('comprobaciones con la guía de Behance', () => {
  it('ancho, megapíxeles, peso y formato', () => {
    expect(checkOutput(1400, 2000, 'jpg', 2e6)).toEqual([]);
    expect(checkOutput(3000, 2000, 'jpg').some(c => c.level === 'warn' && /2800/.test(c.text))).toBe(true);
    expect(checkOutput(1000, 2000, 'jpg').some(c => c.level === 'info')).toBe(true);
    expect(checkOutput(2800, 12000, 'jpg').some(c => c.level === 'error' && /32/.test(c.text))).toBe(true);
    expect(checkOutput(1400, 2000, 'png', 12 * 1024 * 1024).some(c => c.level === 'warn' && /10 MB/.test(c.text))).toBe(true);
    expect(checkOutput(1400, 2000, 'png', 60 * 1024 * 1024).some(c => c.level === 'error')).toBe(true);
    expect(checkOutput(1400, 2000, 'webp').some(c => /WebP/.test(c.text))).toBe(true);
  });

  it('portada: proporción 808:632, encuadre y mínimo', () => {
    const r = coverCrop(1400, 1000, 1, 0.5, 0);
    expect(r.w / r.h).toBeCloseTo(808 / 632, 5);
    expect(r.h).toBeLessThanOrEqual(1000);
    expect(r.x).toBeCloseTo((1400 - r.w) / 2);
    const z = coverCrop(1400, 1000, 2, 1, 1);
    expect(z.x + z.w).toBeCloseTo(1400);
    expect(z.y + z.h).toBeCloseTo(1000);
    expect(checkCover(808, 632)[0].level).toBe('ok');
    expect(checkCover(600, 470)[0].level).toBe('warn');
  });

  it('diferencia de color en el corte', () => {
    const white = new Uint8ClampedArray(16).fill(255);
    const black = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
    expect(seamDifference(white, white)).toBe(0);
    expect(seamDifference(white, black)).toBe(255);
  });

  it('nombres de archivo', () => {
    expect(sectionFileName('Mi Proyecto', 0, 'Proceso creativo', 'jpg')).toBe('mi_proyecto_01_proceso_creativo.jpg');
    expect(segmentFileName('Mi Proyecto', 1, 3, 'png')).toBe('mi_proyecto_continuo_parte-02.png');
    expect(segmentFileName('Mi Proyecto', 0, 1, 'png')).toBe('mi_proyecto_continuo.png');
  });
});

describe('.kova', () => {
  const file = () => ({
    format: 'kova-designlab', version: 3, id: 'd', name: 'B', colorMode: 'RGB', createdAt: 1,
    state: { layers: [], artboards: [ab('a', 0, 1000, 0), ab('b', 1000, 1800, 1)], guides: [], selectedLayerIds: [], activeArtboardId: 'a' },
    assets: {}, fonts: [],
  });

  it('conserva las secciones y quita las dañadas con un aviso', () => {
    const p = parseKova(file());
    expect(p.file.state.artboards[1].behance).toEqual({ project: 'p1', name: 'Proyecto', index: 1, continuous: true });
    const bad = file(); (bad.state.artboards[1] as any).behance = { project: 7 };
    const q = parseKova(bad);
    expect(q.file.state.artboards[1].behance).toBeUndefined();
    expect(q.warnings.some(w => /Behance/.test(w))).toBe(true);
  });

  it('sanea los campos y la versión 1 no los lleva', () => {
    expect(sanitizeArtboardBehance({ project: 'x', index: -3, continuous: 1 })).toEqual({ project: 'x', name: 'Proyecto Behance', index: 0, continuous: true });
    const v1 = downgradeToV1(buildKova(parseKova(file()).file) as any) as any;
    expect(v1.state.artboards.some((a: any) => 'behance' in a)).toBe(false);
  });
});
