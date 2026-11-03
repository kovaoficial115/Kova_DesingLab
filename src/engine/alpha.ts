// Operaciones sobre transparencia: eliminación de fondo por color, descontaminación de bordes,
// morfología (contraer/expandir) con transformada de distancia euclidiana exacta,
// limpieza de alfa para DTF, contornos, siluetas, base blanca y varita mágica.

import { blurFloat, type Px } from './pixels';

const INF = 1e20;

function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Distancia euclidiana de cada píxel al píxel "dentro" más cercano (inside[j] = true). */
export function distanceTransform(inside: (j: number) => boolean, w: number, h: number): Float32Array {
  const grid = new Float64Array(w * h);
  for (let j = 0; j < w * h; j++) grid[j] = inside(j) ? 0 : INF;
  const mx = Math.max(w, h);
  const f = new Float64Array(mx), d = new Float64Array(mx), z = new Float64Array(mx + 1);
  const v = new Int32Array(mx);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x];
  }
  const out = new Float32Array(w * h);
  for (let j = 0; j < w * h; j++) out[j] = Math.sqrt(grid[j]);
  return out;
}

// ---------- Eliminación de fondo por color ----------
export interface ColorKeyParams {
  color: [number, number, number];
  tolerance: number; // 0..100
  softness: number; // 0..100
  contiguous: boolean; // solo regiones conectadas al borde
  decontaminate: boolean;
  choke: number; // px de contracción tras recortar
}

export function colorKey(img: Px, p: ColorKeyParams) {
  const { width: w, height: h, data: d } = img;
  const n = w * h;
  const [br, bg, bb] = p.color;
  const MAXD = 441.673;
  const tol = (p.tolerance / 100) * MAXD;
  const soft = Math.max(0.5, (p.softness / 100) * MAXD);
  const dist = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    const o = j * 4;
    const dr = d[o] - br, dg = d[o + 1] - bg, db = d[o + 2] - bb;
    dist[j] = Math.sqrt(dr * dr + dg * dg + db * db);
  }
  let reach: Uint8Array | null = null;
  if (p.contiguous) {
    reach = new Uint8Array(n);
    const lim = tol + soft;
    const stack = new Int32Array(n);
    let sp = 0;
    const push = (j: number) => { if (!reach![j] && dist[j] <= lim) { reach![j] = 1; stack[sp++] = j; } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (sp) {
      const j = stack[--sp];
      const x = j % w, y = (j / w) | 0;
      if (x > 0) push(j - 1);
      if (x < w - 1) push(j + 1);
      if (y > 0) push(j - w);
      if (y < h - 1) push(j + w);
    }
  }
  for (let j = 0; j < n; j++) {
    if (reach && !reach[j]) continue;
    const t = (dist[j] - tol) / soft;
    const k = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
    if (k >= 1) continue;
    const o = j * 4;
    const a0 = d[o + 3];
    if (p.decontaminate && k > 0.004) {
      // c = α·fg + (1-α)·bg  →  fg = (c - (1-α)·bg)/α
      d[o] = (d[o] - (1 - k) * br) / k;
      d[o + 1] = (d[o + 1] - (1 - k) * bg) / k;
      d[o + 2] = (d[o + 2] - (1 - k) * bb) / k;
    }
    d[o + 3] = a0 * k;
  }
  if (p.choke > 0) morphAlpha(img, -p.choke);
}

/** Expande (r>0) o contrae (r<0) el alfa con bordes suavizados. */
export function morphAlpha(img: Px, r: number) {
  const { width: w, height: h, data: d } = img;
  const n = w * h;
  if (r > 0) {
    const dt = distanceTransform(j => d[j * 4 + 3] >= 128, w, h);
    for (let j = 0; j < n; j++) {
      const a = Math.min(1, Math.max(0, r - dt[j] + 0.5));
      const o = j * 4 + 3;
      d[o] = Math.max(d[o], a * 255);
    }
  } else if (r < 0) {
    const rr = -r;
    const dt = distanceTransform(j => d[j * 4 + 3] < 128, w, h);
    for (let j = 0; j < n; j++) {
      const a = Math.min(1, Math.max(0, dt[j] - rr + 0.5));
      const o = j * 4 + 3;
      d[o] = Math.min(d[o], a * 255);
    }
  }
}

export function featherAlpha(img: Px, radius: number) {
  const { width: w, height: h, data: d } = img;
  const n = w * h;
  const a = new Float32Array(n);
  for (let j = 0; j < n; j++) a[j] = d[j * 4 + 3];
  blurFloat(a, w, h, radius);
  for (let j = 0; j < n; j++) d[j * 4 + 3] = a[j];
}

/** Suaviza dientes de sierra: desenfoca el alfa y lo vuelve a endurecer. */
export function smoothAlpha(img: Px, radius: number) {
  const { width: w, height: h, data: d } = img;
  const n = w * h;
  const a = new Float32Array(n);
  for (let j = 0; j < n; j++) a[j] = d[j * 4 + 3] / 255;
  blurFloat(a, w, h, radius);
  for (let j = 0; j < n; j++) {
    const t = (a[j] - 0.5) * 4 + 0.5;
    d[j * 4 + 3] = (t < 0 ? 0 : t > 1 ? 1 : t) * 255;
  }
}

/** Limpieza de alfa para DTF: elimina semitransparencias problemáticas. */
export function cleanupAlpha(img: Px, p: { low: number; high: number; binarize: boolean; mid: number }) {
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) {
    const a = d[i];
    if (a <= p.low) d[i] = 0;
    else if (a >= p.high) d[i] = 255;
    else if (p.binarize) d[i] = a >= p.mid ? 255 : 0;
  }
}

export interface EdgeRefineParams { contract: number; feather: number; smooth: number; cleanLow: number; cleanHigh: number; decontaminate: boolean; matte: [number, number, number] }
export function refineEdges(img: Px, p: EdgeRefineParams) {
  if (p.smooth > 0) smoothAlpha(img, p.smooth);
  if (p.contract) morphAlpha(img, -p.contract);
  if (p.feather > 0) featherAlpha(img, p.feather);
  if (p.decontaminate) {
    const d = img.data;
    const [mr, mg, mb] = p.matte;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3] / 255;
      if (a > 0.02 && a < 0.98) {
        d[i] = (d[i] - (1 - a) * mr) / a;
        d[i + 1] = (d[i + 1] - (1 - a) * mg) / a;
        d[i + 2] = (d[i + 2] - (1 - a) * mb) / a;
      }
    }
  }
  if (p.cleanLow > 0 || p.cleanHigh < 255) cleanupAlpha(img, { low: p.cleanLow, high: p.cleanHigh, binarize: false, mid: 128 });
}

/** Contorno (stroke exterior) del alfa, devuelto como imagen nueva del mismo tamaño. */
export function outline(img: Px, p: { width: number; color: [number, number, number]; position: 'outside' | 'inside' | 'center' }): Px {
  const { width: w, height: h, data: d } = img;
  const n = w * h;
  const out = new Uint8ClampedArray(d.length);
  const outsideDt = distanceTransform(j => d[j * 4 + 3] >= 128, w, h);
  const insideDt = distanceTransform(j => d[j * 4 + 3] < 128, w, h);
  const r = p.width;
  for (let j = 0; j < n; j++) {
    let a = 0;
    const inside = d[j * 4 + 3] >= 128;
    if (p.position === 'outside') a = inside ? 1 : Math.min(1, Math.max(0, r - outsideDt[j] + 0.5));
    else if (p.position === 'inside') a = inside ? Math.min(1, Math.max(0, r - insideDt[j] + 0.5)) : 0;
    else {
      const sd = inside ? insideDt[j] : outsideDt[j];
      a = Math.min(1, Math.max(0, r / 2 - sd + 0.5));
    }
    const o = j * 4;
    out[o] = p.color[0]; out[o + 1] = p.color[1]; out[o + 2] = p.color[2]; out[o + 3] = a * 255;
  }
  return { data: out, width: w, height: h };
}

/** Base blanca (white underbase) a partir del alfa compuesto del diseño. */
export interface UnderbaseParams {
  choke: number; // px que se contrae la base para que no asome
  threshold: number; // alfa mínimo para depositar blanco
  knockout: [number, number, number] | null; // color de la prenda que no necesita blanco
  knockoutTolerance: number; // 0..100
  density: number; // 0..1 opacidad máxima de la base
}
export function underbase(img: Px, p: UnderbaseParams): Px {
  const { width: w, height: h, data: d } = img;
  const n = w * h;
  const out = new Uint8ClampedArray(d.length);
  const tol = (p.knockoutTolerance / 100) * 441.67;
  for (let j = 0; j < n; j++) {
    const o = j * 4;
    let a = d[o + 3];
    if (a < p.threshold) a = 0;
    if (a && p.knockout) {
      const dr = d[o] - p.knockout[0], dg = d[o + 1] - p.knockout[1], db = d[o + 2] - p.knockout[2];
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      if (dist <= tol) a = 0;
      else if (dist < tol * 1.5) a *= (dist - tol) / (tol * 0.5);
    }
    out[o] = out[o + 1] = out[o + 2] = 255;
    out[o + 3] = a * p.density;
  }
  const res = { data: out, width: w, height: h };
  if (p.choke > 0) morphAlpha(res, -p.choke);
  return res;
}

/** Elimina del diseño los tonos cercanos al color de la prenda (knockout), con transición suave. */
export function garmentKnockout(img: Px, p: { color: [number, number, number]; tolerance: number; softness: number }) {
  colorKey(img, { color: p.color, tolerance: p.tolerance, softness: p.softness, contiguous: false, decontaminate: false, choke: 0 });
}

// ---------- Varita mágica / gama de colores ----------
export function magicWand(img: Px, sx: number, sy: number, p: { tolerance: number; contiguous: boolean; useAlpha: boolean }): Uint8ClampedArray {
  const { width: w, height: h, data: d } = img;
  const n = w * h;
  const mask = new Uint8ClampedArray(n);
  sx = Math.floor(sx); sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return mask;
  const so = (sy * w + sx) * 4;
  const r0 = d[so], g0 = d[so + 1], b0 = d[so + 2], a0 = d[so + 3];
  const tol = p.tolerance;
  const match = (j: number) => {
    const o = j * 4;
    const da = Math.abs(d[o + 3] - a0);
    if (a0 === 0 && d[o + 3] === 0) return true;
    if (p.useAlpha && da > tol) return false;
    return Math.max(Math.abs(d[o] - r0), Math.abs(d[o + 1] - g0), Math.abs(d[o + 2] - b0), da) <= tol;
  };
  if (!p.contiguous) {
    for (let j = 0; j < n; j++) if (match(j)) mask[j] = 255;
    return mask;
  }
  const stack = new Int32Array(n);
  let sp = 0;
  const start = sy * w + sx;
  stack[sp++] = start; mask[start] = 255;
  while (sp) {
    const j = stack[--sp];
    const x = j % w;
    const nb = [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, j - w, j + w];
    for (const k of nb) {
      if (k < 0 || k >= n || mask[k]) continue;
      if (match(k)) { mask[k] = 255; stack[sp++] = k; }
    }
  }
  return mask;
}

export function colorRange(img: Px, color: [number, number, number], fuzziness: number): Uint8ClampedArray {
  const { width: w, height: h, data: d } = img;
  const mask = new Uint8ClampedArray(w * h);
  const f = Math.max(1, fuzziness);
  for (let j = 0; j < w * h; j++) {
    const o = j * 4;
    if (!d[o + 3]) continue;
    const dist = Math.sqrt((d[o] - color[0]) ** 2 + (d[o + 1] - color[1]) ** 2 + (d[o + 2] - color[2]) ** 2);
    mask[j] = dist <= f ? 255 : dist <= f * 1.5 ? 255 * (1 - (dist - f) / (f * 0.5)) : 0;
  }
  return mask;
}

/** Colores dominantes por k-means sobre una muestra de píxeles opacos. */
export function dominantColors(img: Px, k = 6): { color: [number, number, number]; share: number }[] {
  const d = img.data;
  const n = img.width * img.height;
  const step = Math.max(1, Math.floor(n / 40000));
  const pts: number[][] = [];
  for (let j = 0; j < n; j += step) {
    const o = j * 4;
    if (d[o + 3] > 128) pts.push([d[o], d[o + 1], d[o + 2]]);
  }
  if (!pts.length) return [];
  // k-means++ simple
  const cents: number[][] = [pts[Math.floor(Math.random() * pts.length)]];
  while (cents.length < Math.min(k, pts.length)) {
    let best = pts[0], bd = -1;
    for (let i = 0; i < pts.length; i += 7) {
      const p = pts[i];
      let md = Infinity;
      for (const c of cents) md = Math.min(md, (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2);
      if (md > bd) { bd = md; best = p; }
    }
    cents.push([...best]);
  }
  const assign = new Int32Array(pts.length);
  for (let it = 0; it < 12; it++) {
    const sums = cents.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      let bi = 0, bd = Infinity;
      for (let c = 0; c < cents.length; c++) {
        const dd = (p[0] - cents[c][0]) ** 2 + (p[1] - cents[c][1]) ** 2 + (p[2] - cents[c][2]) ** 2;
        if (dd < bd) { bd = dd; bi = c; }
      }
      assign[i] = bi;
      const s = sums[bi]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
    }
    sums.forEach((s, c) => { if (s[3]) cents[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
  }
  const counts = new Array(cents.length).fill(0);
  for (let i = 0; i < pts.length; i++) counts[assign[i]]++;
  return cents
    .map((c, i) => ({ color: [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])] as [number, number, number], share: counts[i] / pts.length }))
    .filter(c => c.share > 0)
    .sort((a, b) => b.share - a.share);
}

export function alphaStats(img: Px) {
  const d = img.data;
  let transparent = 0, semi = 0, opaque = 0;
  for (let i = 3; i < d.length; i += 4) {
    const a = d[i];
    if (a === 0) transparent++;
    else if (a === 255) opaque++;
    else semi++;
  }
  const total = transparent + semi + opaque;
  return { transparent, semi, opaque, total };
}
