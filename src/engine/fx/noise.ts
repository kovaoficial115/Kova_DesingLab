// Ruido y grano. Determinista por (x, y, semilla): la previsualización y la exportación coinciden
// píxel a píxel y cambiar la semilla da otra «toma» del mismo grano.

import { type Px, hash3, gauss3, clamp, luma, lerp } from './core';

export type NoiseKind = 'gaussian' | 'uniform' | 'film' | 'analog' | 'chromatic' | 'mono' | 'digital' | 'sensor';

export interface NoiseParams {
  kind: NoiseKind;
  amount: number;      // 0..100
  size: number;        // tamaño del grano (px)
  density: number;     // % de píxeles con ruido
  distribution: 'gaussian' | 'uniform';
  mono: boolean;
  contrast: number;    // -100..100
  seed: number;
}

/** Valor aleatorio de media 0 y varianza ~1 en una celda entera. */
function cell(ix: number, iy: number, s: number, dist: 'gaussian' | 'uniform') {
  return dist === 'uniform' ? (hash3(ix, iy, s) * 2 - 1) * 1.732 : gauss3(ix, iy, s);
}
/** Ruido con tamaño de grano: interpolado entre celdas de `size` px (o por píxel si size ≤ 1). */
function grain(x: number, y: number, sx: number, sy: number, s: number, dist: 'gaussian' | 'uniform', blocky = false) {
  if (sx <= 1.01 && sy <= 1.01) return cell(x, y, s, dist);
  const fx = x / sx, fy = y / sy;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  if (blocky) return cell(ix, iy, s, dist);
  const tx = fx - ix, ty = fy - iy;
  const a = cell(ix, iy, s, dist), b = cell(ix + 1, iy, s, dist), c = cell(ix, iy + 1, s, dist), d = cell(ix + 1, iy + 1, s, dist);
  const v = lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
  // la interpolación reduce la varianza: se compensa para que «cantidad» signifique lo mismo
  const k = 1 / Math.sqrt(((1 - tx) ** 2 + tx ** 2) * ((1 - ty) ** 2 + ty ** 2));
  return v * k;
}

export function addNoise(img: Px, p: NoiseParams) {
  const { width: w, height: h, data: d } = img;
  const kind = p.kind ?? 'gaussian';
  const sigma = Math.max(0, p.amount) * 0.55;
  if (sigma <= 0) return;
  const seed = (p.seed | 0) * 7 + 13;
  const size = Math.max(1, p.size ?? 1);
  const dens = Math.max(0, Math.min(1, (p.density ?? 100) / 100));
  const dist = kind === 'uniform' ? 'uniform' : kind === 'gaussian' ? 'gaussian' : (p.distribution ?? 'gaussian');
  const mono = kind === 'mono' || kind === 'film' ? true : kind === 'chromatic' ? false : !!p.mono;
  const gamma = Math.pow(2, -(p.contrast ?? 0) / 60);
  const shape = (v: number) => (gamma === 1 ? v : Math.sign(v) * Math.pow(Math.abs(v) / 2.5, gamma) * 2.5);
  const n = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    // analógico: cada línea tiene además su propio desplazamiento de brillo
    const lineJit = kind === 'analog' ? gauss3(0, y, seed + 991) * 0.35 : 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] === 0) continue;
      if (dens < 1 && hash3(x, y, seed + 31) > dens) continue;
      const l = luma(d[i], d[i + 1], d[i + 2]) / 255;
      let wgt = 1;
      switch (kind) {
        case 'film': {
          // grano fotográfico: más visible en los medios tonos, con grumos de dos escalas
          wgt = 0.35 + 2.6 * l * (1 - l);
          const g = grain(x, y, size, size, seed, dist) * 0.75 + grain(x, y, size * 2.3, size * 2.3, seed + 5, dist) * 0.45;
          n[0] = n[1] = n[2] = g;
          break;
        }
        case 'analog': {
          const g = grain(x, y, size * 4, size, seed, dist) * 0.8 + lineJit;
          if (mono) n[0] = n[1] = n[2] = g;
          else { n[0] = g + grain(x, y, size * 6, size, seed + 1, dist) * 0.4; n[1] = g; n[2] = g + grain(x, y, size * 6, size, seed + 2, dist) * 0.4; }
          break;
        }
        case 'chromatic': {
          // ruido de color: los canales se mueven sin cambiar apenas el brillo
          const r = grain(x, y, size, size, seed, dist), g = grain(x, y, size, size, seed + 1, dist), b = grain(x, y, size, size, seed + 2, dist);
          const m = (r + g + b) / 3;
          n[0] = (r - m) * 1.6; n[1] = (g - m) * 1.6; n[2] = (b - m) * 1.6;
          break;
        }
        case 'digital': {
          const blk = Math.max(1, Math.round(size));
          const g = grain(x, y, blk, blk, seed, dist, true);
          if (mono) n[0] = n[1] = n[2] = g;
          else { n[0] = g + grain(x, y, blk, blk, seed + 1, dist, true) * 0.7; n[1] = g; n[2] = g + grain(x, y, blk, blk, seed + 2, dist, true) * 0.7; }
          // píxeles «muertos» o encendidos de vez en cuando
          const hot = hash3(x, y, seed + 77);
          if (hot > 0.9985) n[0] = n[1] = n[2] = 6; else if (hot < 0.0015) n[0] = n[1] = n[2] = -6;
          break;
        }
        case 'sensor': {
          // ruido de sensor: crece en las sombras y tiene manchas de color
          wgt = 0.25 + 1.6 * (1 - l) ** 2;
          const lum = grain(x, y, size, size, seed, dist);
          const cr = grain(x, y, size * 2.5, size * 2.5, seed + 1, dist), cb = grain(x, y, size * 2.5, size * 2.5, seed + 2, dist);
          if (mono) n[0] = n[1] = n[2] = lum;
          else { n[0] = lum + cr * 0.9; n[1] = lum - (cr + cb) * 0.35; n[2] = lum + cb * 0.9; }
          break;
        }
        default: {
          const g = grain(x, y, size, size, seed, dist);
          if (mono) n[0] = n[1] = n[2] = g;
          else { n[0] = g; n[1] = grain(x, y, size, size, seed + 1, dist); n[2] = grain(x, y, size, size, seed + 2, dist); }
        }
      }
      const k = sigma * wgt;
      d[i] = clamp(d[i] + shape(n[0]) * k);
      d[i + 1] = clamp(d[i + 1] + shape(n[1]) * k);
      d[i + 2] = clamp(d[i + 2] + shape(n[2]) * k);
    }
  }
}
