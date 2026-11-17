import { describe, it, expect } from 'vitest';
import type { Layer } from './types';
import { collectClip, instantiateClip, clipText } from './clipboard';

const base = (id: string, kind: Layer['kind'], extra: Partial<Layer> = {}): Layer => ({
  id, name: id, kind, visible: true, locked: false, opacity: 1, blend: 'source-over', x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1,
  parentId: null, clip: false, adjustments: [], mask: null, maskEnabled: true, ...extra,
});
const text = (id: string, t: string, extra: Partial<Layer> = {}) => base(id, 'text', {
  text: { text: t, fontFamily: 'Inter', fontSize: 40, fontWeight: 700, italic: false, color: '#123456' } as any, ...extra,
});
const rect = (id: string, extra: Partial<Layer> = {}) => base(id, 'shape', { shape: { shape: 'rect', w: 100, h: 50, fill: '#f00', stroke: null, strokeWidth: 0, radius: 0 }, ...extra });

let n = 0;
const newId = () => `new${++n}`;

describe('portapapeles de objetos', () => {
  const doc: Layer[] = [
    rect('bg'),
    rect('a', { parentId: 'g', x: 10, y: 10 }),
    text('t', 'Hola', { parentId: 'g', x: 30, y: 40, adjustments: [{ id: 'fx1', type: 'blur', enabled: true, params: { radius: 3 } } as any] }),
    base('g', 'group'),
    rect('b', { x: 200, y: 0 }),
  ];

  it('copia un grupo con su contenido y no duplica hijos también seleccionados', () => {
    const c = collectClip(doc, ['g', 't', 'b'])!;
    expect(c.roots).toEqual(['g', 'b']);
    expect(c.layers.map(l => l.id)).toEqual(['a', 't', 'g', 'b']);
    expect(c.layers.find(l => l.id === 'g')!.parentId).toBeNull();
    expect(c.layers.find(l => l.id === 't')!.parentId).toBe('g');
  });

  it('el texto sigue siendo texto editable con sus propiedades y efectos', () => {
    const c = collectClip(doc, ['t'])!;
    const r = instantiateClip(c, { dx: 5, dy: 5, newId, parentId: null, existingIds: new Set(doc.map(l => l.id)) });
    const t = r.layers[0];
    expect(t.kind).toBe('text');
    expect(t.text).toEqual(doc[2].text);
    expect(t.adjustments[0].params).toEqual({ radius: 3 });
    expect(t.adjustments[0].params).not.toBe(doc[2].adjustments[0].params);
    expect([t.x, t.y]).toEqual([35, 45]);
    expect(t.id).not.toBe('t');
  });

  it('reconstruye los grupos con ids nuevos y conserva posiciones relativas', () => {
    const c = collectClip(doc, ['g', 'b'])!;
    const r = instantiateClip(c, { dx: 10, dy: 0, newId, parentId: 'dest', existingIds: new Set() });
    const ids = new Set(r.layers.map(l => l.id));
    expect(ids.size).toBe(4);
    for (const old of ['a', 't', 'g', 'b']) expect(ids.has(old)).toBe(false);
    const g = r.layers.find(l => l.kind === 'group')!;
    expect(g.parentId).toBe('dest');
    const kids = r.layers.filter(l => l.parentId === g.id);
    expect(kids.map(k => k.kind)).toEqual(['shape', 'text']);
    expect(r.layers.find(l => l.name === 'b')!.parentId).toBe('dest');
    const a2 = r.layers.find(l => l.name === 'a')!, b2 = r.layers.find(l => l.name === 'b')!;
    expect(b2.x - a2.x).toBe(200 - 10);
    expect(r.roots).toEqual([g.id, b2.id]);
  });

  it('las variantes siguen vinculadas solo si su componente existe; las copias de un principal no son principales', () => {
    const v = rect('v', { link: { master: 'M', src: 'M' } });
    const m = rect('M', { component: { name: 'Botón' } });
    const c = collectClip([m, v], ['M', 'v'])!;
    const inDoc = instantiateClip(c, { dx: 0, dy: 0, newId, parentId: null, existingIds: new Set(['M', 'v']) });
    expect(inDoc.layers[0].component).toBeNull();
    // el principal también va en el portapapeles: la copia de la variante no se ata al original
    expect(inDoc.layers[1].link).toBeNull();
    const onlyVariant = collectClip([m, v], ['v'])!;
    expect(instantiateClip(onlyVariant, { dx: 0, dy: 0, newId, parentId: null, existingIds: new Set(['M']) }).layers[0].link).toEqual({ master: 'M', src: 'M' });
    expect(instantiateClip(onlyVariant, { dx: 0, dy: 0, newId, parentId: null, existingIds: new Set() }).layers[0].link).toBeNull();
  });

  it('el texto del sistema es el contenido de los textos o un resumen', () => {
    expect(clipText(collectClip(doc, ['t', 'b'])!)).toBe('Hola');
    expect(clipText(collectClip(doc, ['b', 'bg'])!)).toBe('KOVA Design Lab · 2 objetos');
  });

  it('sin selección no hay portapapeles', () => {
    expect(collectClip(doc, [])).toBeNull();
    expect(collectClip(doc, ['nope'])).toBeNull();
  });
});
