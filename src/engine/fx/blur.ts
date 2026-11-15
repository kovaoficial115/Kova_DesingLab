// Desenfoques (básicos y creativos). Todos trabajan con alfa premultiplicado para no dejar halos
// oscuros en los bordes transparentes. Los radios y distancias están en px del contenido de la capa.

import {
  type Px, type Planes, toPlanes, fromPlanes, boxBlurChannel, blurPlanes, samplePremul, clamp, clamp01, DEG, luma, smooth,
} from './core';

const QUALITY = { draft: 0.5, normal: 1, high: 2 } as const;
export type Quality = keyof typeof QUALITY;
const qk = (q: unknown) => QUALITY[(q as Quality) in QUALITY ? (q as Quality) : 'normal'];

// ---------- reducción para radios grandes ----------
function downsample(p: Planes, f: number): Planes {
  const w = Math.max(1, Math.round(p.w / f)), h = Math.max(1, Math.round(p.h / f));
  const out: Planes = { w, h, r: new Float32Array(w * h), g: new Float32Array(w * h), b: new Float32Array(w * h), a: new Float32Array(w * h) };
  const cnt = new Float32Array(w * h);
  for (let y = 0; y < p.h; y++) {
    const oy = Math.min(h - 1, Math.floor((y * h) / p.h));
    for (let x = 0; x < p.w; x++) {
      const ox = Math.min(w - 1, Math.floor((x * w) / p.w)), j = oy * w + ox, i = y * p.w + x;
      out.r[j] += p.r[i]; out.g[j] += p.g[i]; out.b[j] += p.b[i]; out.a[j] += p.a[i]; cnt[j]++;
    }
  }
  for (let j = 0; j < w * h; j++) { const k = cnt[j] ? 1 / cnt[j] : 0; out.r[j] *= k; out.g[j] *= k; out.b[j] *= k; out.a[j] *= k; }
  return out;
}
function upsampleInto(small: Planes, p: Planes) {
  const { w, h } = small;
  for (let y = 0; y < p.h; y++) {
    const fy = Math.max(0, Math.min(h - 1, ((y + 0.5) * h) / p.h - 0.5));
    const y0 = fy | 0, y1 = Math.min(h - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < p.w; x++) {
      const fx = Math.max(0, Math.min(w - 1, ((x + 0.5) * w) / p.w - 0.5));
      const x0 = fx | 0, x1 = Math.min(w - 1, x0 + 1), tx = fx - x0;
      const i = y * p.w + x;
      const a = y0 * w + x0, b = y0 * w + x1, c = y1 * w + x0, d = y1 * w + x1;
      const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
      p.r[i] = small.r[a] * w00 + small.r[b] * w10 + small.r[c] * w01 + small.r[d] * w11;
      p.g[i] = small.g[a] * w00 + small.g[b] * w10 + small.g[c] * w01 + small.g[d] * w11;
      p.b[i] = small.b[a] * w00 + small.b[b] * w10 + small.b[c] * w01 + small.b[d] * w11;
      p.a[i] = small.a[a] * w00 + small.a[b] * w10 + small.a[c] * w01 + small.a[d] * w11;
    }
  }
}
/** Ejecuta `fn` sobre una copia reducida cuando el radio es grande (el resultado es borroso de todos modos). */
function scaled(p: Planes, radius: number, maxR: number, fn: (q: Planes, r: number) => void) {
  const f = radius > maxR ? radius / maxR : 1;
  if (f <= 1.05) { fn(p, radius); return; }
  const s = downsample(p, f);
  fn(s, radius / f);
  upsampleInto(s, p);
}

// ---------- básicos ----------
export function boxBlur(img: Px, p: { radius: number; quality?: Quality }) {
  const r = Math.max(0, Math.round(p.radius));
  if (r < 1) return;
  const P = toPlanes(img, true);
  const passes = p.quality === 'high' ? 2 : 1;
  for (const ch of [P.r, P.g, P.b, P.a]) for (let k = 0; k < passes; k++) boxBlurChannel(ch, P.w, P.h, passes > 1 ? Math.max(1, Math.round(r / 1.4)) : r);
  fromPlanes(P, img, true);
}

/** Desenfoque de lente: núcleo circular (bokeh) con realce de las luces. */
export function lensBlur(img: Px, p: { radius: number; bokeh: number; brightness?: number; quality?: Quality }) {
  const radius = Math.max(0, p.radius);
  if (radius < 0.5) return;
  const P = toPlanes(img, true);
  const gamma = 1 + clamp01((p.bokeh ?? 0) / 100) * 3;
  if (gamma > 1) for (const ch of [P.r, P.g, P.b]) for (let j = 0; j < ch.length; j++) ch[j] = Math.pow(ch[j] / 255, gamma) * 255;
  scaled(P, radius, 14 * qk(p.quality), (q, r) => diskBlur(q, r));
  const gain = 1 + (p.brightness ?? 0) / 100;
  if (gamma > 1 || gain !== 1) for (const ch of [P.r, P.g, P.b]) for (let j = 0; j < ch.length; j++) ch[j] = Math.min(P.a[j], Math.pow(Math.max(0, ch[j]) / 255, 1 / gamma) * 255 * gain);
  fromPlanes(P, img, true);
}
function diskBlur(P: Planes, radius: number) {
  const { w, h } = P;
  const r = Math.max(1, Math.round(radius));
  const half = new Int32Array(2 * r + 1);
  let area = 0;
  for (let dy = -r; dy <= r; dy++) { half[dy + r] = Math.floor(Math.sqrt(r * r - dy * dy)); }
  const pre = new Float64Array((w + 1) * h);
  for (const ch of [P.r, P.g, P.b, P.a]) {
    for (let y = 0; y < h; y++) { let acc = 0; const o = y * (w + 1); pre[o] = 0; for (let x = 0; x < w; x++) { acc += ch[y * w + x]; pre[o + x + 1] = acc; } }
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0; area = 0;
        for (let dy = -r; dy <= r; dy++) {
          const yy = y + dy < 0 ? 0 : y + dy >= h ? h - 1 : y + dy;
          const hw = half[dy + r];
          const x0 = x - hw < 0 ? 0 : x - hw, x1 = x + hw >= w ? w - 1 : x + hw;
          const o = yy * (w + 1);
          s += pre[o + x1 + 1] - pre[o + x0];
          area += x1 - x0 + 1;
        }
        out[y * w + x] = s / area;
      }
    }
    ch.set(out);
  }
}

/** Desenfoque de superficie: suaviza las zonas parejas y respeta los bordes (bilateral muestreado). */
export function surfaceBlur(img: Px, p: { radius: number; threshold: number; quality?: Quality }) {
  const { width: w, height: h, data: d } = img;
  const r = Math.max(1, p.radius), th = Math.max(1, p.threshold);
  const src = new Uint8ClampedArray(d);
  const n = Math.round(clamp(24 * qk(p.quality) * Math.min(2, r / 6 + 0.5), 8, 96));
  // espiral de Vogel: muestras repartidas por el disco
  const ox = new Float32Array(n), oy = new Float32Array(n), ow = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const rr = r * Math.sqrt((k + 0.5) / n), t = k * 2.39996323;
    ox[k] = Math.round(rr * Math.cos(t)); oy[k] = Math.round(rr * Math.sin(t));
    ow[k] = Math.exp(-(rr * rr) / (2 * (r * 0.6) ** 2));
  }
  const lim = 2.5 * th;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const cr = src[i], cg = src[i + 1], cb = src[i + 2];
      let sr = cr, sg = cg, sb = cb, sw = 1;
      for (let k = 0; k < n; k++) {
        const xx = x + ox[k], yy = y + oy[k];
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = (yy * w + xx) * 4;
        const diff = (Math.abs(src[j] - cr) + Math.abs(src[j + 1] - cg) + Math.abs(src[j + 2] - cb)) / 3;
        const wt = ow[k] * Math.max(0, 1 - diff / lim) * (src[j + 3] / 255);
        if (wt <= 0) continue;
        sr += src[j] * wt; sg += src[j + 1] * wt; sb += src[j + 2] * wt; sw += wt;
      }
      d[i] = sr / sw; d[i + 1] = sg / sw; d[i + 2] = sb / sw;
    }
  }
}

/** Mediana por canal con histograma deslizante (radio hasta 12). */
export function medianBlur(img: Px, p: { radius: number }) {
  const { width: w, height: h, data: d } = img;
  const r = Math.max(1, Math.min(12, Math.round(p.radius)));
  const src = new Uint8ClampedArray(d);
  const half = ((2 * r + 1) ** 2) >> 1;
  const hist = new Int32Array(256);
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < h; y++) {
      hist.fill(0);
      for (let dy = -r; dy <= r; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -r; dx <= r; dx++) hist[src[(yy * w + Math.min(w - 1, Math.max(0, dx))) * 4 + c]]++;
      }
      for (let x = 0; x < w; x++) {
        if (x > 0) {
          const xo = Math.max(0, x - r - 1), xn = Math.min(w - 1, x + r);
          for (let dy = -r; dy <= r; dy++) {
            const yy = Math.min(h - 1, Math.max(0, y + dy));
            hist[src[(yy * w + xo) * 4 + c]]--;
            hist[src[(yy * w + xn) * 4 + c]]++;
          }
        }
        let cnt = 0, m = 0;
        for (; m < 255; m++) { cnt += hist[m]; if (cnt > half) break; }
        d[(y * w + x) * 4 + c] = m;
      }
    }
  }
}

// ---------- creativos (muestreo a lo largo de una trayectoria) ----------
type PathFn = (x: number, y: number, t: number, out: Float32Array) => void; // t ∈ [-1, 1] o [0, 1]

function pathBlur(img: Px, samples: number, path: (x: number, y: number, k: number, n: number, pos: Float32Array) => number, weightAt?: (x: number, y: number) => number) {
  const { width: w, height: h, data: d } = img;
  const src = new Uint8ClampedArray(d);
  const pos = new Float32Array(2), px = new Float32Array(4);
  const n = Math.max(2, samples | 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const amt = weightAt ? weightAt(x, y) : 1;
      if (amt <= 0.001) continue;
      let sr = 0, sg = 0, sb = 0, sa = 0, sw = 0;
      for (let k = 0; k < n; k++) {
        const wt = path(x, y, k, n, pos);
        if (wt <= 0) continue;
        const xx = x + (pos[0] - x) * amt, yy = y + (pos[1] - y) * amt;
        samplePremul(src, w, h, xx, yy, px);
        sr += px[0] * wt; sg += px[1] * wt; sb += px[2] * wt; sa += px[3] * wt; sw += wt;
      }
      const i = (y * w + x) * 4;
      const a = sa / sw;
      if (a > 0.01) { d[i] = sr / sa; d[i + 1] = sg / sa; d[i + 2] = sb / sa; }
      d[i + 3] = a;
    }
  }
}
const sampleCount = (len: number, q: unknown) => Math.round(clamp(len * 0.6 * qk(q), 3, 96 * qk(q)));

/** Desenfoque de movimiento: arrastre simétrico a lo largo de un ángulo. */
export function motionBlur(img: Px, p: { angle: number; distance: number; quality?: Quality }) {
  const dist = Math.max(0, p.distance);
  if (dist < 1) return;
  const ca = Math.cos(p.angle * DEG), sa = -Math.sin(p.angle * DEG);
  pathBlur(img, sampleCount(dist, p.quality), (x, y, k, n, pos) => {
    const t = (k / (n - 1) - 0.5) * dist;
    pos[0] = x + ca * t; pos[1] = y + sa * t;
    return 1;
  });
}

/** Desenfoque direccional: estela hacia un lado, con caída controlable. */
export function directionalBlur(img: Px, p: { angle: number; distance: number; intensity: number; falloff: number; quality?: Quality }) {
  const dist = Math.max(0, p.distance);
  if (dist < 1) return;
  const ca = Math.cos(p.angle * DEG), sa = -Math.sin(p.angle * DEG);
  const fall = Math.max(0.05, p.falloff / 50);
  const keep = 1 - clamp01((p.intensity ?? 100) / 100);
  pathBlur(img, sampleCount(dist, p.quality), (x, y, k, n, pos) => {
    const t = k / (n - 1);
    pos[0] = x - ca * t * dist; pos[1] = y - sa * t * dist;
    return (k === 0 ? 1 + keep * n : 1) * Math.pow(1 - t * 0.98, fall);
  });
}

/** Desenfoque radial (giro alrededor de un centro, toda la imagen). */
export function radialBlur(img: Px, p: { cx: number; cy: number; angle: number; inner: number; quality?: Quality }) {
  const { width: w, height: h } = img;
  const cx = p.cx * w, cy = p.cy * h, ang = p.angle * DEG;
  const maxR = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));
  const inner = clamp01((p.inner ?? 0) / 100) * maxR;
  pathBlur(img, sampleCount(ang * maxR * 0.5, p.quality), (x, y, k, n, pos) => {
    const t = (k / (n - 1) - 0.5) * ang;
    const dx = x - cx, dy = y - cy, c = Math.cos(t), s = Math.sin(t);
    pos[0] = cx + dx * c - dy * s; pos[1] = cy + dx * s + dy * c;
    return 1;
  }, inner > 0 ? (x, y) => smooth(inner * 0.7, inner * 1.3, Math.hypot(x - cx, y - cy)) : undefined);
}

/** Desenfoque de giro: el giro solo dentro de una elipse (como una rueda en movimiento). */
export function spinBlur(img: Px, p: { cx: number; cy: number; angle: number; radius: number; feather: number; quality?: Quality }) {
  const { width: w, height: h } = img;
  const cx = p.cx * w, cy = p.cy * h, ang = p.angle * DEG, R = Math.max(1, p.radius);
  const fe = clamp01((p.feather ?? 20) / 100);
  pathBlur(img, sampleCount(ang * R * 0.5, p.quality), (x, y, k, n, pos) => {
    const t = (k / (n - 1) - 0.5) * ang;
    const dx = x - cx, dy = y - cy, c = Math.cos(t), s = Math.sin(t);
    pos[0] = cx + dx * c - dy * s; pos[1] = cy + dx * s + dy * c;
    return 1;
  }, (x, y) => 1 - smooth(R * (1 - fe), R * (1 + fe * 0.2), Math.hypot(x - cx, y - cy)));
}

/** Desenfoque de zoom: estelas hacia (o desde) un punto. */
export function zoomBlur(img: Px, p: { cx: number; cy: number; amount: number; quality?: Quality }) {
  const { width: w, height: h } = img;
  const cx = p.cx * w, cy = p.cy * h, amt = clamp01(p.amount / 100) * 0.6;
  if (amt <= 0) return;
  const maxR = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));
  pathBlur(img, sampleCount(amt * maxR * 0.5, p.quality), (x, y, k, n, pos) => {
    const t = (k / (n - 1)) * amt;
    pos[0] = x + (cx - x) * t; pos[1] = y + (cy - y) * t;
    return 1;
  });
}

/** Cambio de inclinación: zona nítida (franja o elipse) y desenfoque progresivo fuera. */
export function tiltShift(img: Px, p: { mode: 'linear' | 'radial'; cx: number; cy: number; angle: number; focus: number; transition: number; radius: number; saturation?: number }) {
  const { width: w, height: h, data: d } = img;
  const R = Math.max(0, p.radius);
  if (R < 0.5) return;
  const P1 = toPlanes(img, true), P2 = toPlanes(img, true);
  scaled(P1, R / 2, 40, (q, r) => blurPlanes(q, r));
  scaled(P2, R, 40, (q, r) => blurPlanes(q, r));
  const B1 = { width: w, height: h, data: new Uint8ClampedArray(d) }, B2 = { width: w, height: h, data: new Uint8ClampedArray(d) };
  fromPlanes(P1, B1, true); fromPlanes(P2, B2, true);
  const cx = p.cx * w, cy = p.cy * h, size = Math.min(w, h);
  const focus = (clamp01(p.focus / 100) * size) / 2, trans = Math.max(1, (clamp01(p.transition / 100) * size) / 1);
  const nx = -Math.sin(p.angle * DEG), ny = -Math.cos(p.angle * DEG);
  const sat = 1 + (p.saturation ?? 0) / 100;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dist = p.mode === 'radial' ? Math.hypot(x - cx, y - cy) : Math.abs((x - cx) * nx + (y - cy) * ny);
      const t = clamp01((dist - focus) / trans); // 0 nítido → 1 desenfoque máximo
      if (t <= 0 && sat === 1) continue;
      const i = (y * w + x) * 4;
      const a = t * 2;
      for (let c = 0; c < 4; c++) {
        const v1 = B1.data[i + c], v2 = B2.data[i + c];
        d[i + c] = a <= 1 ? d[i + c] + (v1 - d[i + c]) * a : v1 + (v2 - v1) * (a - 1);
      }
      if (sat !== 1) {
        const l = luma(d[i], d[i + 1], d[i + 2]);
        for (let c = 0; c < 3; c++) d[i + c] = clamp(l + (d[i + c] - l) * sat);
      }
    }
  }
}

export type { PathFn };
