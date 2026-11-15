// Utilidades comunes de los efectos (puras, sin DOM: corren en el worker y en las pruebas).
// Convención: los efectos reciben un buffer RGBA no premultiplicado y lo modifican en el sitio.
// El ruido sale de un hash de (x, y, semilla): el mismo resultado en la vista previa, en la
// exportación y en cualquier orden de proceso.

import type { Px } from '../pixels';
import { blurFloat, boxBlurChannel, parseHex } from '../pixels';

export type { Px };
export { blurFloat, boxBlurChannel, parseHex };

export const clamp = (v: number, a = 0, b = 255) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (e0: number, e1: number, x: number) => { const t = clamp01((x - e0) / (e1 - e0 || 1e-6)); return t * t * (3 - 2 * t); };
export const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
export const DEG = Math.PI / 180;

// ---------- azar determinista ----------
/** Hash entero → [0, 1). Mismo (x, y, semilla) ⇒ mismo valor. */
export function hash3(x: number, y: number, s: number) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul((s | 0) + 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
/** Generador secuencial con semilla (mulberry32). */
export function rng(seed: number) {
  let a = (seed | 0) + 0x6d2b79f5;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Normal estándar a partir de dos hashes (Box–Muller). */
export function gauss3(x: number, y: number, s: number) {
  const u = Math.max(1e-7, hash3(x, y, s)), v = hash3(x, y, s + 7919);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
/** Ruido de valor suave (interpolado) con celdas de `size` px. */
export function valueNoise(x: number, y: number, size: number, s: number) {
  const fx = x / size, fy = y / size;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const tx = fx - ix, ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const a = hash3(ix, iy, s), b = hash3(ix + 1, iy, s), c = hash3(ix, iy + 1, s), d = hash3(ix + 1, iy + 1, s);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}
/** Ruido fractal (varias octavas) en [0, 1]. */
export function fbm(x: number, y: number, size: number, s: number, oct = 4) {
  let v = 0, amp = 0.5, tot = 0, sz = size;
  for (let o = 0; o < oct; o++) { v += valueNoise(x, y, Math.max(1, sz), s + o * 101) * amp; tot += amp; amp *= 0.5; sz /= 2; }
  return v / tot;
}

// ---------- planos de color ----------
export interface Planes { w: number; h: number; r: Float32Array; g: Float32Array; b: Float32Array; a: Float32Array }

/** RGBA → planos float. Con `premul` los colores se multiplican por el alfa (para desenfocar sin halos). */
export function toPlanes(img: Px, premul = false): Planes {
  const { width: w, height: h, data: d } = img;
  const n = w * h;
  const r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n), a = new Float32Array(n);
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    const k = premul ? d[i + 3] / 255 : 1;
    r[j] = d[i] * k; g[j] = d[i + 1] * k; b[j] = d[i + 2] * k; a[j] = d[i + 3];
  }
  return { w, h, r, g, b, a };
}
export function fromPlanes(p: Planes, img: Px, premul = false) {
  const d = img.data, n = p.w * p.h;
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    const a = p.a[j];
    if (premul) {
      const k = a > 0.01 ? 255 / a : 0;
      d[i] = p.r[j] * k; d[i + 1] = p.g[j] * k; d[i + 2] = p.b[j] * k;
    } else { d[i] = p.r[j]; d[i + 1] = p.g[j]; d[i + 2] = p.b[j]; }
    d[i + 3] = a;
  }
}
export function clonePx(img: Px): Px { return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) }; }

/** Muestra bilineal de un canal (bordes extendidos). */
export function sample(ch: Float32Array | Uint8ClampedArray, w: number, h: number, x: number, y: number, stride = 1, off = 0) {
  if (x < 0) x = 0; else if (x > w - 1) x = w - 1;
  if (y < 0) y = 0; else if (y > h - 1) y = h - 1;
  const x0 = x | 0, y0 = y | 0;
  const x1 = x0 < w - 1 ? x0 + 1 : x0, y1 = y0 < h - 1 ? y0 + 1 : y0;
  const tx = x - x0, ty = y - y0;
  const a = ch[(y0 * w + x0) * stride + off], b = ch[(y0 * w + x1) * stride + off];
  const c = ch[(y1 * w + x0) * stride + off], d = ch[(y1 * w + x1) * stride + off];
  return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
}

/** Muestrea el RGBA completo (premultiplicado) en (x, y): devuelve en `out`. */
export function samplePremul(src: Uint8ClampedArray, w: number, h: number, x: number, y: number, out: Float32Array) {
  if (x < 0) x = 0; else if (x > w - 1) x = w - 1;
  if (y < 0) y = 0; else if (y > h - 1) y = h - 1;
  const x0 = x | 0, y0 = y | 0;
  const x1 = x0 < w - 1 ? x0 + 1 : x0, y1 = y0 < h - 1 ? y0 + 1 : y0;
  const tx = x - x0, ty = y - y0;
  const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
  const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4, i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
  const a00 = src[i00 + 3] * w00, a10 = src[i10 + 3] * w10, a01 = src[i01 + 3] * w01, a11 = src[i11 + 3] * w11;
  for (let c = 0; c < 3; c++) out[c] = src[i00 + c] * a00 + src[i10 + c] * a10 + src[i01 + c] * a01 + src[i11 + c] * a11;
  out[3] = a00 + a10 + a01 + a11;
}

/** Desenfoque gaussiano de los cuatro planos (premultiplicados). */
export function blurPlanes(p: Planes, radius: number, alpha = true) {
  if (radius <= 0) return;
  blurFloat(p.r, p.w, p.h, radius); blurFloat(p.g, p.w, p.h, radius); blurFloat(p.b, p.w, p.h, radius);
  if (alpha) blurFloat(p.a, p.w, p.h, radius);
}

/** Luminancia 0..255 (sin alfa). */
export function lumaPlane(img: Px) {
  const { width: w, height: h, data: d } = img;
  const L = new Float32Array(w * h);
  for (let i = 0, j = 0; j < L.length; i += 4, j++) L[j] = luma(d[i], d[i + 1], d[i + 2]);
  return L;
}

/** Magnitud de bordes (Sobel) 0..~1 sobre la luminancia. */
export function sobel(L: Float32Array, w: number, h: number) {
  const E = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ym = y > 0 ? y - 1 : 0, yp = y < h - 1 ? y + 1 : y;
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : 0, xp = x < w - 1 ? x + 1 : x;
      const tl = L[ym * w + xm], t = L[ym * w + x], tr = L[ym * w + xp];
      const l = L[y * w + xm], r = L[y * w + xp];
      const bl = L[yp * w + xm], b = L[yp * w + x], br = L[yp * w + xp];
      const gx = tr + 2 * r + br - tl - 2 * l - bl;
      const gy = bl + 2 * b + br - tl - 2 * t - tr;
      E[y * w + x] = Math.min(1, Math.hypot(gx, gy) / 1020);
    }
  }
  return E;
}

/** Transformada de distancia euclídea exacta (Felzenszwalb). `inside[j]` true = semilla (dist 0). */
export function distanceTransform(inside: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e20;
  const f = new Float32Array(Math.max(w, h));
  const dtmp = new Float32Array(Math.max(w, h));
  const v = new Int32Array(Math.max(w, h));
  const z = new Float32Array(Math.max(w, h) + 1);
  const D = new Float32Array(w * h);
  for (let j = 0; j < w * h; j++) D[j] = inside[j] ? 0 : INF;
  const pass = (n: number, get: (i: number) => number, put: (i: number, val: number) => void) => {
    for (let i = 0; i < n; i++) f[i] = get(i);
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; dtmp[q] = (q - v[k]) ** 2 + f[v[k]]; }
    for (let i = 0; i < n; i++) put(i, dtmp[i]);
  };
  for (let x = 0; x < w; x++) pass(h, i => D[i * w + x], (i, val) => { D[i * w + x] = val; });
  for (let y = 0; y < h; y++) pass(w, i => D[y * w + i], (i, val) => { D[y * w + i] = val; });
  for (let j = 0; j < w * h; j++) D[j] = Math.sqrt(D[j]);
  return D;
}

// ---------- modos de fusión (0..1) ----------
export type FxBlend = 'normal' | 'multiply' | 'screen' | 'overlay' | 'soft-light' | 'hard-light' | 'add' | 'lighten' | 'darken'
  | 'difference' | 'exclusion' | 'color-dodge' | 'color-burn' | 'hue' | 'saturation' | 'color' | 'luminosity';

export const FX_BLENDS: { value: FxBlend; label: string }[] = [
  { value: 'normal', label: 'Normal' }, { value: 'screen', label: 'Trama' }, { value: 'add', label: 'Sumar (luz)' },
  { value: 'lighten', label: 'Aclarar' }, { value: 'color-dodge', label: 'Sobreexponer color' }, { value: 'multiply', label: 'Multiplicar' },
  { value: 'darken', label: 'Oscurecer' }, { value: 'color-burn', label: 'Subexponer color' }, { value: 'overlay', label: 'Superponer' },
  { value: 'soft-light', label: 'Luz suave' }, { value: 'hard-light', label: 'Luz fuerte' }, { value: 'difference', label: 'Diferencia' },
  { value: 'exclusion', label: 'Exclusión' }, { value: 'hue', label: 'Tono' }, { value: 'saturation', label: 'Saturación' },
  { value: 'color', label: 'Color' }, { value: 'luminosity', label: 'Luminosidad' },
];

function sep(m: FxBlend, a: number, b: number) {
  switch (m) {
    case 'multiply': return a * b;
    case 'screen': return a + b - a * b;
    case 'overlay': return a <= 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b);
    case 'hard-light': return b <= 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b);
    case 'soft-light': {
      if (b <= 0.5) return a - (1 - 2 * b) * a * (1 - a);
      const d = a <= 0.25 ? ((16 * a - 12) * a + 4) * a : Math.sqrt(a);
      return a + (2 * b - 1) * (d - a);
    }
    case 'add': return Math.min(1, a + b);
    case 'lighten': return Math.max(a, b);
    case 'darken': return Math.min(a, b);
    case 'difference': return Math.abs(a - b);
    case 'exclusion': return a + b - 2 * a * b;
    case 'color-dodge': return a === 0 ? 0 : b >= 1 ? 1 : Math.min(1, a / (1 - b));
    case 'color-burn': return a >= 1 ? 1 : b <= 0 ? 0 : 1 - Math.min(1, (1 - a) / b);
    default: return b;
  }
}
const L3 = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b;
function clipColor(c: number[]) {
  const l = L3(c[0], c[1], c[2]), n = Math.min(c[0], c[1], c[2]), x = Math.max(c[0], c[1], c[2]);
  if (n < 0) for (let i = 0; i < 3; i++) c[i] = l + ((c[i] - l) * l) / (l - n || 1e-6);
  if (x > 1) for (let i = 0; i < 3; i++) c[i] = l + ((c[i] - l) * (1 - l)) / (x - l || 1e-6);
  return c;
}
function setLum(c: number[], l: number) { const d = l - L3(c[0], c[1], c[2]); return clipColor([c[0] + d, c[1] + d, c[2] + d]); }
const satOf = (c: number[]) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
function setSat(c: number[], s: number) {
  const idx = [0, 1, 2].sort((i, j) => c[i] - c[j]);
  const out = [0, 0, 0];
  const mn = c[idx[0]], md = c[idx[1]], mx = c[idx[2]];
  if (mx > mn) { out[idx[1]] = ((md - mn) * s) / (mx - mn); out[idx[2]] = s; }
  return out;
}
/** Fusiona (a = base, b = efecto) en 0..1 y escribe en `o`. */
export function blendRGB(m: FxBlend, ar: number, ag: number, ab: number, br: number, bg: number, bb: number, o: number[]) {
  if (m === 'hue' || m === 'saturation' || m === 'color' || m === 'luminosity') {
    const A = [ar, ag, ab], B = [br, bg, bb];
    const r = m === 'hue' ? setLum(setSat(B, satOf(A)), L3(ar, ag, ab))
      : m === 'saturation' ? setLum(setSat(A, satOf(B)), L3(ar, ag, ab))
        : m === 'color' ? setLum(B, L3(ar, ag, ab))
          : setLum(A, L3(br, bg, bb));
    o[0] = r[0]; o[1] = r[1]; o[2] = r[2];
    return;
  }
  o[0] = sep(m, ar, br); o[1] = sep(m, ag, bg); o[2] = sep(m, ab, bb);
}

/** Mezcla el resultado de un efecto con lo que había antes: modo de fusión y opacidad (0..1). */
export function mixInto(before: Uint8ClampedArray, after: Uint8ClampedArray, mode: FxBlend, amount: number) {
  const t = clamp01(amount);
  if (mode === 'normal' && t >= 1) return;
  const o = [0, 0, 0];
  for (let i = 0; i < after.length; i += 4) {
    const aa = before[i + 3], fa = after[i + 3];
    if (mode === 'normal') {
      for (let c = 0; c < 4; c++) after[i + c] = before[i + c] + (after[i + c] - before[i + c]) * t;
      continue;
    }
    blendRGB(mode, before[i] / 255, before[i + 1] / 255, before[i + 2] / 255, after[i] / 255, after[i + 1] / 255, after[i + 2] / 255, o);
    // donde la base era transparente, el efecto se ve tal cual (un resplandor fuera de la silueta)
    const k = aa / 255;
    for (let c = 0; c < 3; c++) {
      const blended = (o[c] * 255) * k + after[i + c] * (1 - k);
      after[i + c] = before[i + c] + (blended - before[i + c]) * t;
    }
    after[i + 3] = aa + (Math.max(aa, fa) - aa) * t;
  }
}

/** Escribe una «capa» de color (planos 0..255, alfa 0..1 de cobertura) sobre la imagen con un modo. */
export function compositeLayer(img: Px, R: Float32Array, G: Float32Array, B: Float32Array, cover: Float32Array | null, mode: FxBlend, opacity = 1) {
  const d = img.data;
  const o = [0, 0, 0];
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const k = (cover ? cover[j] : 1) * opacity;
    if (k <= 0) continue;
    const ar = d[i] / 255, ag = d[i + 1] / 255, ab = d[i + 2] / 255;
    blendRGB(mode, ar, ag, ab, clamp01(R[j] / 255), clamp01(G[j] / 255), clamp01(B[j] / 255), o);
    d[i] = (ar + (o[0] - ar) * k) * 255; d[i + 1] = (ag + (o[1] - ag) * k) * 255; d[i + 2] = (ab + (o[2] - ab) * k) * 255;
  }
}

/** Resplandor aditivo: suma luz (0..255 por canal) con caída suave y da alfa donde había transparencia. */
export function addLight(img: Px, R: Float32Array, G: Float32Array, B: Float32Array, mode: FxBlend = 'screen') {
  const d = img.data;
  const o = [0, 0, 0];
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const lr = clamp01(R[j] / 255), lg = clamp01(G[j] / 255), lb = clamp01(B[j] / 255);
    const lmax = Math.max(lr, lg, lb);
    if (lmax <= 0.0005) continue;
    const a = d[i + 3] / 255;
    // sobre transparencia la luz es el propio color, con alfa según su intensidad
    const ar = (d[i] / 255) * a, ag = (d[i + 1] / 255) * a, ab = (d[i + 2] / 255) * a;
    blendRGB(mode, ar, ag, ab, lr, lg, lb, o);
    const na = Math.max(a, Math.min(1, lmax));
    const k = na > 0 ? 1 / na : 0;
    d[i] = clamp(o[0] * k * 255); d[i + 1] = clamp(o[1] * k * 255); d[i + 2] = clamp(o[2] * k * 255);
    d[i + 3] = na * 255;
  }
}

/** Color hex → [0..255]. */
export const rgbOf = (hex: string) => parseHex(hex);
