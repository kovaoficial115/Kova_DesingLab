import { describe, it, expect } from 'vitest';
import { colorize, gradientMap, parseHex, runAdjustment, type Px } from './pixels';
import { halftone, defaultHalftone, type HalftoneParams } from './halftone';

const px = (...rgba: number[][]): Px => ({ data: new Uint8ClampedArray(rgba.flat()), width: rgba.length, height: 1 });
const at = (img: Px, i: number) => Array.from(img.data.slice(i * 4, i * 4 + 4));
const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

describe('colorear', () => {
  it('lee colores hexadecimales de 3 y 6 cifras', () => {
    expect(parseHex('#d21625')).toEqual([210, 22, 37]);
    expect(parseHex('fff')).toEqual([255, 255, 255]);
    expect(parseHex('rojo')).toEqual([0, 0, 0]);
  });

  it('teñir pone el color y conserva las luces y sombras', () => {
    const img = px([128, 128, 128, 255], [0, 0, 0, 255], [255, 255, 255, 255], [40, 200, 90, 0]);
    colorize(img, { color: '#d21625', mode: 'tint', amount: 100 });
    const [r, g, b] = at(img, 0);
    expect(r).toBeGreaterThan(g); expect(r).toBeGreaterThan(b); // rojizo
    expect(Math.abs(lum(r, g, b) - 128)).toBeLessThan(2); // misma luminosidad
    expect(at(img, 1)).toEqual([0, 0, 0, 255]);
    expect(at(img, 2)).toEqual([255, 255, 255, 255]);
    expect(at(img, 3)).toEqual([40, 200, 90, 0]); // lo transparente no se toca
  });

  it('rellenar pinta del color exacto y respeta el alfa; la intensidad mezcla', () => {
    const img = px([0, 0, 0, 255], [250, 250, 250, 120]);
    colorize(img, { color: '#00ff00', mode: 'fill' });
    expect(at(img, 0)).toEqual([0, 255, 0, 255]);
    expect(at(img, 1)).toEqual([0, 255, 0, 120]);
    const half = px([0, 0, 0, 255]);
    colorize(half, { color: '#ffffff', mode: 'fill', amount: 50 });
    expect(at(half, 0)[0]).toBeGreaterThanOrEqual(127);
    expect(at(half, 0)[0]).toBeLessThanOrEqual(128);
  });

  it('mapa de degradado: sombras y luces toman los colores elegidos', () => {
    const img = px([0, 0, 0, 255], [255, 255, 255, 255]);
    runAdjustment(img, 'gradientMap', { dark: '#1b1464', light: '#ffd23f', amount: 100 });
    expect(at(img, 0)).toEqual([0x1b, 0x14, 0x64, 255]);
    expect(at(img, 1)).toEqual([0xff, 0xd2, 0x3f, 255]);
    const none = px([10, 20, 30, 255]);
    gradientMap(none, { dark: '#ff0000', light: '#00ff00', amount: 0 });
    expect(at(none, 0)).toEqual([10, 20, 30, 255]);
  });
});

// imagen de 40×40 con un degradado horizontal de negro a blanco, opaca
function ramp(): Px {
  const w = 40, h = 40, d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4, v = Math.round((x / (w - 1)) * 255); d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255; }
  return { data: d, width: w, height: h };
}
const params = (p: Partial<HalftoneParams>): HalftoneParams => ({ ...defaultHalftone, cellPx: 6, ...p });
const inked = (img: Px) => { const out: number[][] = []; for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3] > 0) out.push(Array.from(img.data.slice(i, i + 3))); return out; };

describe('color de los puntos del semitono', () => {
  it('«un color» pinta todos los puntos de ese color, en cualquier modo', () => {
    const out = halftone(ramp(), params({ mode: 'color', dotColor: 'solid', inkColor: [210, 22, 37] }));
    const dots = inked(out);
    expect(dots.length).toBeGreaterThan(50);
    expect(dots.every(([r, g, b]) => r === 210 && g === 22 && b === 37)).toBe(true);
  });

  it('sin elegir color, los puntos conservan los de la imagen (como antes)', () => {
    const src = ramp();
    const out = halftone(src, params({ mode: 'color' }));
    for (let i = 0; i < out.data.length; i += 4) if (out.data[i + 3] > 0) expect(out.data[i]).toBe(src.data[i]);
  });

  it('«degradado» colorea según el tono: oscuros → primer color, claros → segundo', () => {
    const out = halftone(ramp(), params({ mode: 'alpha', dotColor: 'gradient', inkColor: [255, 0, 0], inkColor2: [0, 0, 255] }));
    const row = (x: number) => Array.from(out.data.slice((20 * 40 + x) * 4, (20 * 40 + x) * 4 + 3));
    expect(row(0)).toEqual([255, 0, 0]);
    expect(row(39)).toEqual([0, 0, 255]);
  });

  it('CMYK: con las tintas de proceso el resultado es el de siempre; cada canal admite cualquier color', () => {
    const red: Px = { data: new Uint8ClampedArray(Array(16 * 16).fill([255, 0, 0, 255]).flat()), width: 16, height: 16 };
    const base = halftone(red, params({ mode: 'cmyk' }));
    const legacy = halftone(red, params({ mode: 'cmyk', inks: { c: [0, 255, 255], m: [255, 0, 255], y: [255, 255, 0], k: [0, 0, 0] } }));
    expect(Array.from(base.data)).toEqual(Array.from(legacy.data));
    // rojo puro = magenta + amarillo sólidos → (255, 0, 0)
    expect(at(base, 8 * 16 + 8)).toEqual([255, 0, 0, 255]);
    // con el magenta cambiado por un azul, la mezcla con el amarillo da otro color
    const spot = halftone(red, params({ mode: 'cmyk', inks: { m: [0, 0, 255] } }));
    expect(at(spot, 8 * 16 + 8)).toEqual([0, 0, 0, 255]);
  });
});
