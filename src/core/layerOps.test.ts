import { describe, it, expect } from 'vitest';
import { editableLoss } from './layerOps';
import type { Layer } from './types';

const L = (id: string, kind: Layer['kind'], extra: Partial<Layer> = {}): Layer => ({
  id, name: id, kind, visible: true, locked: false, opacity: 1, blend: 'source-over', x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1,
  parentId: null, clip: false, adjustments: [], mask: null, maskEnabled: true, ...extra,
});

describe('avisos de combinar', () => {
  it('píxeles sin nada editable: sin aviso', () => {
    expect(editableLoss([L('a', 'raster'), L('b', 'raster')], ['a', 'b'])).toEqual([]);
  });
  it('cuenta texto, formas y los hijos de un grupo', () => {
    const ls = [L('g', 'group'), L('t1', 'text', { parentId: 'g' }), L('t2', 'text', { parentId: 'g' }), L('s', 'shape'), L('r', 'raster')];
    expect(editableLoss(ls, ['g', 's'])).toEqual(['2 textos editables', 'una forma editable']);
  });
  it('efectos activos, máscaras y recortes', () => {
    const ls = [L('a', 'raster', { adjustments: [{ id: 'x', type: 'blur', enabled: true, params: {} }], crop: { x: 0, y: 0, w: 1, h: 1 } })];
    expect(editableLoss(ls, ['a'])).toEqual(['efectos no destructivos', 'un recorte no destructivo']);
    const off = [L('a', 'raster', { adjustments: [{ id: 'x', type: 'blur', enabled: false, params: {} }] })];
    expect(editableLoss(off, ['a'])).toEqual([]);
  });
});
