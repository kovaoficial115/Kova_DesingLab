import { describe, it, expect } from 'vitest';
import { restyle, applyStyleProps, styleOverrides, sanitizeKit, exportKit, importKit, cleanSvg, svgSize, minLogoWidth } from './model';
import { KOVA_KIT } from './kova';

describe('kit oficial de KOVA', () => {
  it('trae solo los colores y tipografías del manual', () => {
    expect(KOVA_KIT.colors.map(c => c.hex)).toEqual(['#00001f', '#f0e7de', '#d21625']);
    expect(KOVA_KIT.colors[0].cmyk).toBe('99;88;50;83');
    expect(KOVA_KIT.fonts.map(f => f.family)).toEqual(['Anton', 'Satoshi']);
    expect(KOVA_KIT.styles.every(s => s.props.fontSize === undefined)).toBe(true);
  });
  it('vectores del manual: logotipo, marca responsive e iconos', () => {
    const logo = KOVA_KIT.assets.find(a => a.id === 'logo')!;
    expect(logo.recolor).toBe(false);
    expect(logo.w / logo.h).toBeCloseTo(2.49, 1);
    expect(KOVA_KIT.assets.filter(a => a.kind === 'icon').length).toBe(13);
    expect(KOVA_KIT.assets.filter(a => a.kind === 'icon').every(a => a.recolor && a.svg.includes('currentColor'))).toBe(true);
  });
  it('tamaño mínimo: 200 px en digital y 35 mm a la resolución de impresión', () => {
    expect(minLogoWidth(KOVA_KIT.rules, 72)).toBe(200);
    expect(minLogoWidth(KOVA_KIT.rules, 300)).toBeCloseTo(413.4, 0);
  });
  it('se exporta y se vuelve a importar igual', () => {
    const k = importKit(exportKit(KOVA_KIT));
    expect(k.colors).toEqual(KOVA_KIT.colors);
    expect(k.assets.length).toBe(KOVA_KIT.assets.length);
    expect(k.builtin).toBeUndefined();
    expect(() => importKit('{"format":"otro"}')).toThrow();
  });
  it('descarta SVG con scripts o recursos externos', () => {
    expect(cleanSvg('<svg><script>alert(1)</script></svg>')).toBeNull();
    expect(cleanSvg('<svg onload="x()"></svg>')).toBeNull();
    expect(cleanSvg('<svg><image href="https://x.y/a.png"/></svg>')).toBeNull();
    expect(cleanSvg('<svg viewBox="0 0 10 20"><use href="#a"/></svg>')).toBeTruthy();
    expect(svgSize('<svg viewBox="0 0 10 20">')).toEqual({ w: 10, h: 20 });
    expect(sanitizeKit({ id: 'x', name: 'X', colors: [{ hex: 'rojo' }, { hex: '#FF0000', name: 'Rojo' }] })!.colors).toEqual([{ id: '#ff0000', name: 'Rojo', hex: '#ff0000' }]);
  });
});

describe('estilos de texto vinculados', () => {
  const t = { fontFamily: 'A', fontSize: 40, fontWeight: 400, color: '#000000', italic: false };
  it('aplica solo lo que define el estilo', () => {
    expect(applyStyleProps(t, { fontFamily: 'B' })).toEqual({ ...t, fontFamily: 'B' });
  });
  it('al cambiar el estilo sigue lo no tocado y respeta lo cambiado a mano', () => {
    const before = { fontFamily: 'A', fontSize: 40, color: '#000000' };
    const mine = { ...t, color: '#d21625' }; // color cambiado a mano
    const r = restyle(mine, before, { fontFamily: 'B', fontSize: 60, color: '#00001f' });
    expect(r.fontFamily).toBe('B');
    expect(r.fontSize).toBe(60);
    expect(r.color).toBe('#d21625');
    expect(styleOverrides(r, { fontFamily: 'B', fontSize: 60, color: '#00001f' })).toEqual(['color']);
  });
});
