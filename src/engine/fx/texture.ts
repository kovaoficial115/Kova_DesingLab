// Texturas procedurales (sin archivos externos): se generan con la semilla, con escala, rotación,
// opacidad y modo de fusión. Se superponen a la capa como una capa más.

import { type Px, type FxBlend, hash3, fbm, valueNoise, rng, clamp01, smooth, luma, compositeLayer, rgbOf, DEG } from './core';

interface TexBase { scale: number; rotation: number; opacity: number; mode: FxBlend; seed: number }

/** Recorre la imagen con coordenadas rotadas y escaladas alrededor del centro. */
function field(img: Px, p: TexBase, fn: (u: number, v: number, x: number, y: number) => number) {
  const { width: w, height: h } = img;
  const V = new Float32Array(w * h);
  const c = Math.cos(-p.rotation * DEG), s = Math.sin(-p.rotation * DEG), k = 100 / Math.max(1, p.scale);
  const cx = w / 2, cy = h / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x - cx, dy = y - cy;
    V[y * w + x] = fn((dx * c - dy * s) * k + cx, (dx * s + dy * c) * k + cy, x, y);
  }
  return V;
}
function gray(img: Px, V: Float32Array, cover: Float32Array | null, p: TexBase, color?: string) {
  const n = V.length;
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  const rgb = color ? rgbOf(color) : null;
  for (let j = 0; j < n; j++) {
    if (rgb) { R[j] = rgb[0]; G[j] = rgb[1]; B[j] = rgb[2]; } else R[j] = G[j] = B[j] = V[j] * 255;
  }
  compositeLayer(img, R, G, B, cover ?? null, p.mode, clamp01(p.opacity / 100));
}

/** Polvo de película: motas y pelusas claras u oscuras. */
export function filmDust(img: Px, p: TexBase & { amount: number; size: number; dark: boolean }) {
  const { width: w, height: h } = img;
  const cover = new Float32Array(w * h);
  const R = rng(p.seed * 3 + 1);
  const n = Math.round((p.amount / 100) * (w * h) / 4000);
  const S = Math.max(0.5, p.size);
  for (let k = 0; k < n; k++) {
    const x0 = R() * w, y0 = R() * h, r = S * (0.3 + R() * R() * 2.2);
    const hair = R() < 0.18;
    if (hair) {
      // pelusa: curva fina
      let x = x0, y = y0, a = R() * Math.PI * 2;
      const len = S * (8 + R() * 30);
      for (let t = 0; t < len; t += 0.5) {
        a += (R() - 0.5) * 0.25; x += Math.cos(a) * 0.5; y += Math.sin(a) * 0.5;
        const xi = Math.round(x), yi = Math.round(y);
        if (xi >= 0 && yi >= 0 && xi < w && yi < h) cover[yi * w + xi] = Math.max(cover[yi * w + xi], 0.8);
      }
      continue;
    }
    for (let y = Math.floor(y0 - r - 1); y <= y0 + r + 1; y++) for (let x = Math.floor(x0 - r - 1); x <= x0 + r + 1; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const d = Math.hypot(x - x0, y - y0) + (hash3(x, y, p.seed) - 0.5) * r * 0.6;
      const a = 1 - smooth(r * 0.6, r + 0.8, d);
      if (a > 0) cover[y * w + x] = Math.max(cover[y * w + x], a);
    }
  }
  gray(img, cover, cover, p, p.dark ? '#141414' : '#f4f1ea');
}

/** Rayas verticales de película (rotables), cortadas a trozos. */
export function scratches(img: Px, p: TexBase & { amount: number; width: number; dark: boolean }) {
  const { width: w, height: h } = img;
  const R = rng(p.seed * 5 + 3);
  const n = Math.max(1, Math.round(p.amount / 4));
  const lines = Array.from({ length: n }, () => ({ x: R() * w * 1.4 - w * 0.2, wob: R() * 6, a: 0.4 + R() * 0.6, s: R() * 1000 }));
  const hw = Math.max(0.4, p.width / 2);
  const V = field(img, p, (u, v) => {
    let best = 0;
    for (const L of lines) {
      const cx = L.x + Math.sin(v * 0.01 + L.s) * L.wob;
      const d = Math.abs(u - cx);
      if (d > hw + 1.5) continue;
      const on = smooth(0.35, 0.55, valueNoise(L.s, v, 60, p.seed)); // tramos rotos
      best = Math.max(best, (1 - smooth(hw * 0.4, hw + 1, d)) * L.a * on);
    }
    return best;
  });
  gray(img, V, V, p, p.dark ? '#151515' : '#f6f3ec');
}

/** Grano de papel: fibras y poros en varias escalas. */
export function paperGrain(img: Px, p: TexBase & { amount: number; fibers: number }) {
  const amt = p.amount / 100, fib = p.fibers / 100;
  const V = field(img, p, (u, v) => {
    const base = fbm(u, v, 3, p.seed, 3);
    const fibre = fbm(u * 0.25, v * 3, 6, p.seed + 9, 2); // alargado: fibras
    const t = 0.5 + (base - 0.5) * 1.6 * amt + (fibre - 0.5) * fib * 0.9;
    return clamp01(t);
  });
  gray(img, V, null, p);
}

/** Fugas de luz: manchas cálidas que entran desde un borde. */
export function lightLeaks(img: Px, p: TexBase & { color: string; color2: string; size: number; position: number; amount: number }) {
  const { width: w, height: h } = img;
  const c1 = rgbOf(p.color || '#ff5a1f'), c2 = rgbOf(p.color2 || '#ffd23f');
  const R = rng(p.seed * 9 + 7);
  const blobs = Array.from({ length: 4 }, (_, k) => {
    const edge = ((p.position / 100) * 4 + k * 0.15 + R() * 0.3) % 4; // 0..4 recorre el perímetro
    const t = edge % 1, side = Math.floor(edge);
    const x = side === 0 ? t * w : side === 1 ? w : side === 2 ? (1 - t) * w : 0;
    const y = side === 0 ? 0 : side === 1 ? t * h : side === 2 ? h : (1 - t) * h;
    return { x, y, r: Math.max(w, h) * (p.size / 100) * (0.4 + R() * 0.8), mix: R() };
  });
  const n = w * h;
  const RR = new Float32Array(n), GG = new Float32Array(n), BB = new Float32Array(n), cover = new Float32Array(n);
  const amt = clamp01(p.amount / 100);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let acc = 0, mx = 0;
    for (const b of blobs) {
      const d = Math.hypot(x - b.x, y - b.y) / b.r;
      const f = Math.exp(-d * d * 2.2) * (0.8 + fbm(x, y, b.r * 0.4, p.seed, 2) * 0.4);
      acc += f; mx += f * b.mix;
    }
    const j = y * w + x;
    const t = acc > 0 ? mx / acc : 0;
    RR[j] = c1[0] + (c2[0] - c1[0]) * t; GG[j] = c1[1] + (c2[1] - c1[1]) * t; BB[j] = c1[2] + (c2[2] - c1[2]) * t;
    cover[j] = clamp01(acc) * amt;
  }
  compositeLayer(img, RR, GG, BB, cover, p.mode, clamp01(p.opacity / 100));
}

/** Trama de semitono (no destructiva, para superponer). */
export function halftoneOverlay(img: Px, p: TexBase & { cell: number; shape: 'dot' | 'line'; contrast: number; color: string }) {
  const { width: w, height: h, data: d } = img;
  const C = Math.max(2, p.cell);
  const ca = Math.cos(p.rotation * DEG), sa = Math.sin(p.rotation * DEG);
  const n = w * h;
  const cover = new Float32Array(n);
  const ct = 1 + p.contrast / 100;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const j = y * w + x, i = j * 4;
    const u = x * ca + y * sa, v = -x * sa + y * ca;
    const fu = u / C - Math.floor(u / C) - 0.5, fv = v / C - Math.floor(v / C) - 0.5;
    const dark = clamp01((1 - luma(d[i], d[i + 1], d[i + 2]) / 255 - 0.5) * ct + 0.5);
    let ink: number;
    if (p.shape === 'line') ink = 1 - smooth(dark * 0.5 - 0.06, dark * 0.5 + 0.06, Math.abs(fv));
    else { const r = Math.sqrt(dark / Math.PI) * 1.05; ink = 1 - smooth(r - 0.06, r + 0.06, Math.hypot(fu, fv)); }
    cover[j] = ink;
  }
  gray(img, cover, cover, p, p.color || '#000000');
}

/** Suciedad (grunge): manchas, salpicaduras y desgaste. */
export function grunge(img: Px, p: TexBase & { amount: number; contrast: number; dark: boolean }) {
  const amt = p.amount / 100, ct = 1 + p.contrast / 50;
  const V = field(img, p, (u, v, x, y) => {
    const stains = fbm(u, v, 90, p.seed, 4);
    const speck = hash3(Math.floor(u / 2), Math.floor(v / 2), p.seed + 3) > 0.985 ? 1 : 0;
    const wear = fbm(u, v, 14, p.seed + 5, 3);
    const t = clamp01(((stains - 0.5) * ct + 0.5) * 0.7 + wear * 0.3 + speck * 0.6 - (1 - amt) * 0.6);
    void x; void y;
    return smooth(0.45, 0.8, t) * amt;
  });
  gray(img, V, V, p, p.dark ? '#1a1612' : '#efe8dc');
}

/** Estática de televisión: nieve con bandas horizontales. */
export function staticInterference(img: Px, p: TexBase & { amount: number; bands: number }) {
  const { height: h } = img;
  const amt = clamp01(p.amount / 100);
  const V = field(img, p, (u, v, x, y) => {
    const band = 0.6 + 0.4 * Math.sin((y / h) * p.bands * Math.PI * 2 + p.seed);
    return clamp01(hash3(Math.floor(u), Math.floor(v), p.seed) * band * (0.5 + amt));
  });
  const cover = new Float32Array(V.length).fill(amt);
  gray(img, V, cover, p);
}

/** Líneas de barrido como textura (con rotación y escala). */
export function scanlineTexture(img: Px, p: TexBase & { spacing: number; thickness: number }) {
  const sp = Math.max(1, p.spacing), th = clamp01(p.thickness / 100);
  const V = field(img, p, (u, v) => {
    const ph = (((v / sp) % 1) + 1) % 1;
    return 1 - smooth(th * 0.5, th * 0.5 + 0.15, Math.abs(ph - 0.5));
  });
  gray(img, V, V, p, '#000000');
}
