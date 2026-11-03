// Conversión de color por fórmula (sin perfil ICC). Para conversión con perfil ICC real
// se usa LittleCMS (engine/cms.ts). Esta conversión aplica GCR y límite de tinta total (TAC),
// pero NO modela el gamut de una impresora concreta: es una aproximación documentada.

export interface CmykSettings { gcr: number; tac: number } // gcr 0..1, tac 0..400 (%)
export const defaultCmyk: CmykSettings = { gcr: 0.8, tac: 300 };

export function rgbToCmykFormula(r: number, g: number, b: number, s: CmykSettings = defaultCmyk): [number, number, number, number] {
  const c0 = 1 - r / 255, m0 = 1 - g / 255, y0 = 1 - b / 255;
  const mn = Math.min(c0, m0, y0);
  const k = mn * s.gcr;
  let c = 0, m = 0, y = 0;
  if (k < 1) { c = (c0 - k) / (1 - k); m = (m0 - k) / (1 - k); y = (y0 - k) / (1 - k); }
  const total = (c + m + y + k) * 100;
  const tac = s.tac;
  if (total > tac) {
    const cmy = (c + m + y) * 100;
    const allowed = Math.max(0, tac - k * 100);
    const f = cmy > 0 ? allowed / cmy : 0;
    c *= f; m *= f; y *= f;
  }
  return [c, m, y, k];
}

export function cmykToRgbFormula(c: number, m: number, y: number, k: number): [number, number, number] {
  return [255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k)];
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, mx ? d / mx : 0, mx];
}
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export const luminance = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
