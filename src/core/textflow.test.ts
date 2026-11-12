import { describe, it, expect } from 'vitest';
import { flowText, type FlowInput } from './textflow';

// medida falsa: 10 px por carácter (espacio incluido)
const m = (s: string) => s.length * 10;
const base: FlowInput = { text: '', fontSize: 20, lineHeight: 1.2, align: 'left', pad: 2 };

describe('flowText', () => {
  it('texto de punto: una línea por párrafo y la misma caja de siempre', () => {
    const f = flowText({ ...base, text: 'hola\nmundo!!' }, m);
    expect(f.lines.map(l => l.text)).toEqual(['hola', 'mundo!!']);
    expect(f.bw).toBe(70 + 4);
    expect(f.bh).toBe(Math.ceil(2 * 24 + 4));
    expect(f.lines[0].x).toBe(2);
    expect(f.lines[1].y).toBeCloseTo(2 + 24 + 2);
  });

  it('texto de punto centrado y a la derecha', () => {
    const c = flowText({ ...base, text: 'ab\nabcd', align: 'center' }, m);
    expect(c.lines[0].x).toBe(2 + 10);
    const r = flowText({ ...base, text: 'ab\nabcd', align: 'right' }, m);
    expect(r.lines[0].x).toBe(44 - 2 - 20);
  });

  it('cuadro: corta por palabras al ancho interior', () => {
    // interior = 104 - 4 = 100 px = 10 caracteres
    const f = flowText({ ...base, text: 'uno dos tres cuatro cinco', box: { w: 104, h: 10 } }, m);
    expect(f.lines.map(l => l.text)).toEqual(['uno dos', 'tres', 'cuatro', 'cinco']);
    for (const l of f.lines) expect(l.x + l.width).toBeLessThanOrEqual(102);
    expect(f.bw).toBe(104);
    expect(f.bh).toBe(Math.ceil(4 * 24 + 4)); // crece si no cabe
  });

  it('cuadro alto: conserva su altura', () => {
    const f = flowText({ ...base, text: 'uno', box: { w: 104, h: 300 } }, m);
    expect(f.bh).toBe(300);
  });

  it('parte palabras más largas que la línea', () => {
    const f = flowText({ ...base, text: 'abcdefghijklmnopqrstuvwxyz', box: { w: 104, h: 0 } }, m);
    expect(f.lines.map(l => l.text)).toEqual(['abcdefghij', 'klmnopqrst', 'uvwxyz']);
  });

  it('justificado: ocupa todo el ancho menos la última línea', () => {
    const f = flowText({ ...base, text: 'aa bb cc dd ee', align: 'justify-left', box: { w: 104, h: 0 } }, m);
    expect(f.lines.map(l => l.text)).toEqual(['aa bb cc', 'dd ee']);
    const [a, b] = f.lines;
    expect(a.words!.map(w => w.text)).toEqual(['aa', 'bb', 'cc']);
    expect(a.words![0].x).toBe(0);
    expect(a.words![2].x + 20).toBeCloseTo(100);
    expect(b.words).toBeUndefined();
    expect(b.x).toBe(2);
  });

  it('última línea centrada, a la derecha o también justificada', () => {
    const txt = 'aa bb cc dd ee';
    const c = flowText({ ...base, text: txt, align: 'justify-center', box: { w: 104, h: 0 } }, m).lines[1];
    expect(c.x).toBe(2 + (100 - 50) / 2);
    const r = flowText({ ...base, text: txt, align: 'justify-right', box: { w: 104, h: 0 } }, m).lines[1];
    expect(r.x).toBe(102 - 50);
    const all = flowText({ ...base, text: txt, align: 'justify', box: { w: 104, h: 0 } }, m).lines[1];
    expect(all.words!.map(w => w.x)).toEqual([0, 80]);
  });

  it('sangría de primera línea y espacio entre párrafos', () => {
    const f = flowText({ ...base, text: 'aaaa bbbb cc\nzz', box: { w: 104, h: 0 }, indent: 30, paraSpacing: 10 }, m);
    expect(f.lines.map(l => l.text)).toEqual(['aaaa', 'bbbb cc', 'zz']);
    expect(f.lines[0].x).toBe(32);
    expect(f.lines[1].x).toBe(2);
    expect(f.lines[2].x).toBe(32);
    expect(f.lines[2].y - f.lines[1].y).toBeCloseTo(24 + 10);
    expect(f.bh).toBe(Math.ceil(3 * 24 + 10 + 4));
  });

  it('líneas vacías conservan su renglón', () => {
    const f = flowText({ ...base, text: 'a\n\nb', box: { w: 104, h: 0 } }, m);
    expect(f.lines.map(l => l.text)).toEqual(['a', '', 'b']);
  });
});

describe('originalLines', () => {
  it('recupera las minúsculas de las líneas cortadas en mayúsculas', async () => {
    const { originalLines } = await import('./actions');
    const orig = 'Hola  mundo bonito\n\nfin';
    const shown = orig.toUpperCase();
    expect(originalLines(orig, shown, ['HOLA MUNDO', 'BONITO', '', 'FIN'])).toEqual(['Hola mundo', 'bonito', '', 'fin']);
  });
});
