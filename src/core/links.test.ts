import { describe, it, expect } from 'vitest';
import type { DocState, Layer } from './types';
import { syncLinks, makeVariant, resetVariant, overrides, subtree } from './links';

const base = (id: string, p: Partial<Layer> = {}): Layer => ({
  id, name: id, kind: 'shape', visible: true, locked: false, opacity: 1, blend: 'source-over', x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1,
  parentId: null, clip: false, adjustments: [], mask: null, maskEnabled: true, ...p,
});
const txt = (id: string, text: string, p: Partial<Layer> = {}) => base(id, {
  kind: 'text', text: { text, fontFamily: 'A', fontSize: 40, fontWeight: 400, italic: false, color: '#000000', align: 'left', lineHeight: 1.2, letterSpacing: 0, strokeColor: '#000000', strokeWidth: 0 }, ...p,
});
const state = (layers: Layer[]): DocState => ({ layers, artboards: [], guides: [], selection: null, selectedLayerIds: [], activeArtboardId: 'ab' });
const upd = (s: DocState, id: string, fn: (l: Layer) => Layer): DocState => ({ ...s, layers: s.layers.map(l => (l.id === id ? fn(l) : l)) });

function setup() {
  const g = base('g', { kind: 'group', component: { name: 'Etiqueta' } });
  const t = txt('t', 'PRECIO', { parentId: 'g', x: 10, y: 10 });
  const r = base('r', { parentId: 'g', x: 0, y: 0, shape: { shape: 'rect', w: 100, h: 50, fill: '#d21625', stroke: null, strokeWidth: 0, radius: 0 } });
  const layers = [r, t, g];
  const v = makeVariant(layers, 'g', 300, 0, 'Etiqueta · variante 1');
  return state([...layers, ...v]);
}
const inst = (s: DocState, src: string) => s.layers.find(l => l.link?.src === src && l.link.master === 'g')!;

describe('variantes vinculadas', () => {
  it('crea copias vinculadas desplazadas', () => {
    const s = setup();
    expect(inst(s, 't').x).toBe(310);
    expect(inst(s, 'g').name).toBe('Etiqueta · variante 1');
    expect(inst(s, 't').parentId).toBe(inst(s, 'g').id);
  });
  it('lleva a la variante un cambio de texto y color del principal', () => {
    const s = setup();
    const n = syncLinks(s, upd(s, 't', l => ({ ...l, text: { ...l.text!, text: 'OFERTA', color: '#00001f' } })));
    expect(inst(n, 't').text!.text).toBe('OFERTA');
    expect(inst(n, 't').text!.color).toBe('#00001f');
  });
  it('respeta lo que la variante cambió (sustitución)', () => {
    let s = setup();
    s = upd(s, inst(s, 't').id, l => ({ ...l, text: { ...l.text!, text: '$ 99.000' } }));
    const n = syncLinks(s, upd(s, 't', l => ({ ...l, text: { ...l.text!, text: 'OFERTA', fontSize: 60 } })));
    expect(inst(n, 't').text!.text).toBe('$ 99.000');
    expect(inst(n, 't').text!.fontSize).toBe(60);
    expect(overrides(inst(n, 't'), n.layers.find(l => l.id === 't')!)).toEqual(['texto']);
  });
  it('mover el componente entero no mueve las variantes; mover una parte sí', () => {
    const s = setup();
    const moved = { ...s, layers: s.layers.map(l => (l.id === 't' || l.id === 'r' ? { ...l, x: l.x + 50 } : l)) };
    expect(inst(syncLinks(s, moved), 't').x).toBe(310);
    const part = syncLinks(s, upd(s, 't', l => ({ ...l, x: l.x + 5, y: l.y + 7 })));
    expect(inst(part, 't').x).toBe(315);
    expect(inst(part, 't').y).toBe(17);
  });
  it('capas añadidas o borradas en el principal', () => {
    const s = setup();
    const added = syncLinks(s, { ...s, layers: [...s.layers.slice(0, 2), base('n', { parentId: 'g', x: 20, y: 30 }), ...s.layers.slice(2)] });
    const c = inst(added, 'n');
    expect(c.x).toBe(320);
    expect(c.parentId).toBe(inst(added, 'g').id);
    // el orden dentro de la variante sigue al del principal (r, t, n)
    const order = subtree(added.layers, inst(added, 'g').id).filter(l => l.kind !== 'group').map(l => l.link!.src);
    expect(order).toEqual(['r', 't', 'n']);
    const removed = syncLinks(added, { ...added, layers: added.layers.filter(l => l.id !== 'r') });
    expect(removed.layers.some(l => l.link?.src === 'r')).toBe(false);
  });
  it('restablecer deja la variante igual al principal en su sitio', () => {
    let s = setup();
    s = upd(s, inst(s, 't').id, l => ({ ...l, text: { ...l.text!, text: 'otro', color: '#ffffff' } }));
    const layers = resetVariant(s.layers, inst(s, 'g'));
    const t = layers.find(l => l.link?.src === 't')!;
    expect(t.text!.text).toBe('PRECIO');
    expect(t.x).toBe(310);
  });
  it('sin componentes no hace nada', () => {
    const s = state([txt('a', 'x')]);
    const n = { ...s, layers: [...s.layers] };
    expect(syncLinks(s, n)).toBe(n);
  });
});
