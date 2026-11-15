import { describe, it, expect } from 'vitest';
import { FX_LIST, scaleParams } from './registry';
import { runStack } from './pipeline';
import { parseCube, encodeLut, decodeLut, cubeText, resampleLut } from './color';
import { hash3, distanceTransform, mixInto } from './core';
import { pixelTextWidth } from './analog';

function testImage(w = 64, h = 48, transparentBorder = false) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    data[i] = (x * 4) & 255; data[i + 1] = (y * 5) & 255; data[i + 2] = ((x + y) * 3) & 255;
    // un disco claro en el centro (luces, bordes, silueta)
    const inDisc = Math.hypot(x - w / 2, y - h / 2) < 12;
    if (inDisc) { data[i] = 250; data[i + 1] = 245; data[i + 2] = 240; }
    data[i + 3] = transparentBorder ? (inDisc ? 255 : 0) : 255;
  }
  return { width: w, height: h, data };
}
const lutText = (n: number, f: (r: number, g: number, b: number) => [number, number, number]) => {
  const lines = [`LUT_3D_SIZE ${n}`];
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) lines.push(f(r / (n - 1), g / (n - 1), b / (n - 1)).join(' '));
  return lines.join('\n');
};

describe('efectos del registro', () => {
  for (const def of FX_LIST) {
    it(`${def.id}: corre, es determinista y no deja NaN`, () => {
      const transparent = ['outerGlow', 'innerGlow', 'contourEcho'].includes(def.id);
      let params: any = { ...def.defaults };
      if (def.id === 'lut') params = { ...params, ...(() => { const { lut } = parseCube(lutText(5, (r, g, b) => [1 - r, g, b])); return { data: encodeLut(lut), size: lut.size }; })() };
      if (def.id === 'colorBasic') params = { ...params, exposure: 0.5, contrast: 30, temperature: 20 };
      if (def.id === 'hsl') params = { ...params, h_red: 20, s_blue: 50 };
      if (def.id === 'colorBalance') params = { ...params, s_cr: 40, h_yb: -30 };
      if (def.id === 'colorWheels') params = { ...params, liftAmt: 50, gainAmt: 40 };
      if (def.id === 'selectiveColor') params = { ...params, reds_c: 50, neutrals_y: 30 };
      if (def.id === 'filmDust') params = { ...params, amount: 100, size: 4 };
      const a = testImage(64, 48, transparent), b = testImage(64, 48, transparent);
      const orig = new Uint8ClampedArray(a.data);
      runStack(a, [{ type: def.id, params }]);
      runStack(b, [{ type: def.id, params }]);
      expect(a.data.length).toBe(64 * 48 * 4);
      expect(Array.from(a.data)).toEqual(Array.from(b.data));
      let diff = 0;
      for (let i = 0; i < orig.length; i++) diff += Math.abs(orig[i] - a.data[i]);
      expect(diff).toBeGreaterThan(0);
    });
  }
});

describe('pila de efectos', () => {
  it('la opacidad 0 no cambia nada y el 50 % queda en medio', () => {
    const a = testImage(), o = new Uint8ClampedArray(a.data);
    runStack(a, [{ type: 'invert', params: {}, opacity: 0 }]);
    expect(Array.from(a.data)).toEqual(Array.from(o));
    const b = testImage();
    runStack(b, [{ type: 'invert', params: {}, opacity: 50 }]);
    expect(Math.abs(b.data[0] - 127.5)).toBeLessThanOrEqual(1);
  });
  it('mezcla con modo de fusión (multiplicar oscurece)', () => {
    const before = new Uint8ClampedArray([200, 200, 200, 255]), after = new Uint8ClampedArray([128, 128, 128, 255]);
    mixInto(before, after, 'multiply', 1);
    expect(after[0]).toBe(100);
  });
  it('los ajustes clásicos siguen funcionando dentro de la pila', () => {
    const a = testImage();
    runStack(a, [{ type: 'threshold', params: { level: 128 } }]);
    for (let i = 0; i < a.data.length; i += 4) expect([0, 255]).toContain(a.data[i]);
  });
  it('escala solo los parámetros en px', () => {
    expect(scaleParams('motionBlur', { angle: 30, distance: 40 }, 0.5)).toEqual({ angle: 30, distance: 20 });
    expect(scaleParams('blur', { radius: 10 }, 2)).toEqual({ radius: 20 });
    expect(scaleParams('invert', {}, 2)).toEqual({});
  });
  it('un tipo desconocido (de otra versión) no rompe la pila', () => {
    const a = testImage(), o = new Uint8ClampedArray(a.data);
    runStack(a, [{ type: 'efectoDelFuturo', params: { x: 1 } }]);
    expect(Array.from(a.data)).toEqual(Array.from(o));
  });
});

describe('utilidades', () => {
  it('el ruido con semilla es estable', () => {
    expect(hash3(10, 20, 3)).toBe(hash3(10, 20, 3));
    expect(hash3(10, 20, 3)).not.toBe(hash3(10, 20, 4));
  });
  it('transformada de distancia exacta', () => {
    const w = 9, h = 1, inside = new Uint8Array(w);
    inside[4] = 1;
    expect(Array.from(distanceTransform(inside, w, h))).toEqual([4, 3, 2, 1, 0, 1, 2, 3, 4]);
  });
  it('fuente de píxeles: 5×7 por carácter', async () => {
    const mod = await import('./analog');
    expect(pixelTextWidth('PLAY', 2)).toBe(48);
    void mod;
  });
});

describe('LUT .cube', () => {
  it('lee, aplica, codifica y vuelve a escribir', () => {
    const { lut } = parseCube('TITLE "Invertir"\n' + lutText(3, (r, g, b) => [1 - r, 1 - g, 1 - b]));
    expect(lut.size).toBe(3);
    const img = { width: 1, height: 1, data: new Uint8ClampedArray([255, 0, 128, 255]) };
    runStack(img, [{ type: 'lut', params: { data: encodeLut(lut), size: lut.size, amount: 100 } }]);
    expect(img.data[0]).toBeLessThanOrEqual(1); expect(img.data[1]).toBeGreaterThanOrEqual(254); expect(Math.abs(img.data[2] - 127)).toBeLessThanOrEqual(2);
    const back = decodeLut(encodeLut(lut), 3)!;
    expect(back.data.length).toBe(81);
    expect(parseCube(cubeText(lut, 'x')).lut.size).toBe(3);
  });
  it('remuestrea las LUT grandes a 33 y convierte las 1D', () => {
    expect(resampleLut(parseCube(lutText(4, (r, g, b) => [r, g, b])).lut, 6).size).toBe(6);
    const one = parseCube('LUT_1D_SIZE 2\n0 0 0\n1 1 1\n');
    expect(one.lut.size).toBe(33);
  });
  it('rechaza archivos que no son .cube', () => {
    expect(() => parseCube('hola')).toThrow();
  });
});
