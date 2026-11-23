import { describe, it, expect } from 'vitest';
import { applyRunStyle, adjustRuns, normalizeRuns, splitByRuns, sanitizeRuns, styleAt } from './textruns';
import { flowText } from './textflow';

describe('fragmentos de texto', () => {
  it('aplica un color a una parte y lo combina con otra tipografía', () => {
    let r = applyRunStyle(undefined, 0, 5, { color: '#ff0000' }, 11);
    expect(r).toEqual([{ start: 0, end: 5, color: '#ff0000' }]);
    r = applyRunStyle(r, 3, 8, { fontFamily: 'Georgia' }, 11);
    expect(r).toEqual([
      { start: 0, end: 3, color: '#ff0000' },
      { start: 3, end: 5, color: '#ff0000', fontFamily: 'Georgia' },
      { start: 5, end: 8, fontFamily: 'Georgia' },
    ]);
    expect(styleAt(r, 4)).toEqual({ color: '#ff0000', fontFamily: 'Georgia' });
    expect(styleAt(r, 9)).toEqual({});
  });
  it('quitar el estilo deja el resto y une lo que queda igual', () => {
    const r = applyRunStyle([{ start: 0, end: 10, color: '#00ff00' }], 3, 6, { color: null }, 10);
    expect(r).toEqual([{ start: 0, end: 3, color: '#00ff00' }, { start: 6, end: 10, color: '#00ff00' }]);
    expect(applyRunStyle(r, 3, 6, { color: '#00ff00' }, 10)).toEqual([{ start: 0, end: 10, color: '#00ff00' }]);
  });
  it('al escribir, lo de detrás se desplaza y lo escrito al final de un fragmento lo continúa', () => {
    const runs = [{ start: 5, end: 10, color: '#0000ff' }]; // "Hola mundo azul" → "mundo"
    expect(adjustRuns(runs, 'Hola mundo azul', '¡Hola mundo azul')).toEqual([{ start: 6, end: 11, color: '#0000ff' }]);
    expect(adjustRuns(runs, 'Hola mundo azul', 'Hola mundos azul')).toEqual([{ start: 5, end: 11, color: '#0000ff' }]);
    expect(adjustRuns(runs, 'Hola mundo azul', 'Hola azul')).toBeUndefined();
  });
  it('normaliza solapes y recorta al texto', () => {
    expect(normalizeRuns([{ start: 5, end: 50, italic: true }, { start: 2, end: 7, color: '#111111' }], 10))
      .toEqual([{ start: 2, end: 7, color: '#111111' }, { start: 7, end: 10, italic: true }]);
  });
  it('parte un trozo por los límites de los fragmentos', () => {
    const p = splitByRuns('mundo', 5, [{ start: 7, end: 20, color: '#ff0000' }]);
    expect(p.map(x => [x.text, x.start, x.style.color])).toEqual([['mu', 5, undefined], ['ndo', 7, '#ff0000']]);
  });
  it('saneado: descarta valores raros', () => {
    expect(sanitizeRuns([{ start: 0, end: 3, color: 'red', fontFamily: 'a;b', fontWeight: 5000 }, { start: 0, end: 2, italic: true }], 5))
      .toEqual([{ start: 0, end: 2, italic: true }]);
    expect(sanitizeRuns('x', 5)).toBeUndefined();
  });
});

describe('reparto de líneas con fragmentos', () => {
  const base = { fontSize: 10, lineHeight: 1, align: 'left' as const, pad: 0 };
  const measure = (s: string) => s.length * 10;
  // los caracteres de 6 en adelante miden el doble (otra tipografía más ancha)
  const at = (s: string, start: number) => Array.from(s).reduce((a, _, i) => a + (start + i >= 6 ? 20 : 10), 0);
  it('sin fragmentos da lo mismo que antes', () => {
    const a = flowText({ ...base, text: 'uno dos tres', box: { w: 75, h: 0 } }, measure);
    const b = flowText({ ...base, text: 'uno dos tres', box: { w: 75, h: 0 } }, measure, (s) => measure(s));
    expect(b.lines.map(l => [l.text, l.width])).toEqual(a.lines.map(l => [l.text, l.width]));
  });
  it('mide cada palabra con su estilo y conserva su posición en el texto', () => {
    // "uno" 30 + espacio 10 + "dos" (d, o normales; s ancha) 40 = 80 ≤ 85; "tres" todo ancho = 80
    const f = flowText({ ...base, text: 'uno dos tres', box: { w: 85, h: 0 } }, measure, at);
    expect(f.lines.map(l => l.text)).toEqual(['uno dos', 'tres']);
    expect(f.lines[0].segs).toEqual([{ text: 'uno', start: 0, x: 0 }, { text: 'dos', start: 4, x: 40 }]);
    expect(f.lines[0].width).toBe(80);
    expect(f.lines[1].width).toBe(80);
    // con la medida normal "uno dos tres" cabría distinto: la anchura de cada estilo cuenta al cortar
    const g = flowText({ ...base, text: 'uno dos tres', box: { w: 75, h: 0 } }, measure, at);
    expect(g.lines[0].text).toBe('uno');
  });
  it('texto de punto: respeta los espacios dobles en las posiciones', () => {
    const f = flowText({ ...base, text: 'a  b' }, measure, (s) => measure(s));
    expect(f.lines[0].segs).toEqual([{ text: 'a', start: 0, x: 0 }, { text: 'b', start: 3, x: 30 }]);
    expect(f.lines[0].width).toBe(40);
  });
});
