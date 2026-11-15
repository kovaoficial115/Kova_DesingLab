// Neón, resplandores y luz. La luz se suma con un modo de fusión (trama/sumar/aclarar) y, sobre
// zonas transparentes, aparece con su propio alfa (un halo alrededor de un recorte se ve).

import {
  type Px, type FxBlend, toPlanes, fromPlanes, blurFloat, lumaPlane, sobel, distanceTransform, addLight, rgbOf,
  clamp, clamp01, smooth, fbm, DEG, sample, luma,
} from './core';

/** Desenfoque de resplandor: suma de tres gaussianas (núcleo, medio, halo) para una caída de neón. */
function glowBlur(ch: Float32Array, w: number, h: number, radius: number) {
  const a = new Float32Array(ch), b = new Float32Array(ch), c = ch;
  blurFloat(a, w, h, Math.max(0.5, radius * 0.15));
  blurFloat(b, w, h, Math.max(0.5, radius * 0.4));
  blurFloat(c, w, h, Math.max(0.5, radius));
  for (let j = 0; j < c.length; j++) c[j] = a[j] * 0.45 + b[j] * 0.35 + c[j] * 0.45;
}
/** Planos de luz a partir de una intensidad (0..1) y un color. */
function tint(I: Float32Array, rgb: [number, number, number], k: number) {
  const R = new Float32Array(I.length), G = new Float32Array(I.length), B = new Float32Array(I.length);
  for (let j = 0; j < I.length; j++) { const v = I[j] * k; R[j] = rgb[0] * v; G[j] = rgb[1] * v; B[j] = rgb[2] * v; }
  return [R, G, B] as const;
}
/** Pasa de luces: cuánto supera cada píxel el umbral (0..1). */
function brightPass(img: Px, threshold: number, soft: number) {
  const { data: d } = img;
  const n = img.width * img.height, th = threshold / 100, kn = Math.max(0.01, soft / 100);
  const I = new Float32Array(n);
  for (let j = 0, i = 0; j < n; j++, i += 4) I[j] = smooth(th - kn * 0.5, th + kn * 0.5, luma(d[i], d[i + 1], d[i + 2]) / 255) * (d[i + 3] / 255);
  return I;
}
function darkenBase(img: Px, amount: number) {
  if (amount <= 0) return;
  const k = 1 - clamp01(amount / 100), d = img.data;
  for (let i = 0; i < d.length; i += 4) { d[i] *= k; d[i + 1] *= k; d[i + 2] *= k; }
}

// ---------------- resplandores ----------------

export function bloom(img: Px, p: { threshold: number; softness: number; radius: number; intensity: number; tint: string; useTint: boolean; mode: FxBlend }) {
  const { width: w, height: h, data: d } = img;
  const I = brightPass(img, p.threshold, p.softness);
  const n = w * h;
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  const t = rgbOf(p.tint || '#ffffff');
  for (let j = 0, i = 0; j < n; j++, i += 4) {
    const v = I[j];
    if (p.useTint) { R[j] = t[0] * v; G[j] = t[1] * v; B[j] = t[2] * v; } else { R[j] = d[i] * v; G[j] = d[i + 1] * v; B[j] = d[i + 2] * v; }
  }
  for (const ch of [R, G, B]) glowBlur(ch, w, h, p.radius);
  const k = p.intensity / 100 * 1.6;
  for (let j = 0; j < n; j++) { R[j] *= k; G[j] *= k; B[j] *= k; }
  addLight(img, R, G, B, p.mode || 'screen');
}

export function neonGlow(img: Px, p: { color: string; radius: number; intensity: number; threshold: number; core: number; base: number; mode: FxBlend }) {
  const { width: w, height: h } = img;
  const L = lumaPlane(img);
  blurFloat(L, w, h, 0.8);
  const E = sobel(L, w, h);
  const th = clamp01(p.threshold / 100);
  for (let j = 0; j < E.length; j++) E[j] = smooth(th * 0.5, th + 0.12, E[j]) * (img.data[j * 4 + 3] / 255 > 0.02 ? 1 : 0.5);
  darkenBase(img, p.base);
  const rgb = rgbOf(p.color || '#4d5bff');
  const glow = new Float32Array(E);
  glowBlur(glow, w, h, p.radius);
  const k = p.intensity / 100 * 2.2, core = clamp01(p.core / 100);
  const n = w * h;
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    const g = glow[j] * k, c = E[j] * core;
    // núcleo casi blanco, halo del color: como un tubo de neón
    R[j] = rgb[0] * g + (255 * 0.85 + rgb[0] * 0.15) * c; G[j] = rgb[1] * g + (255 * 0.85 + rgb[1] * 0.15) * c; B[j] = rgb[2] * g + (255 * 0.85 + rgb[2] * 0.15) * c;
  }
  addLight(img, R, G, B, p.mode || 'screen');
}

export function outerGlow(img: Px, p: { color: string; radius: number; intensity: number; spread: number }) {
  const { width: w, height: h, data: d } = img;
  const n = w * h;
  const A = new Float32Array(n);
  for (let j = 0; j < n; j++) A[j] = d[j * 4 + 3] / 255;
  const sp = clamp01(p.spread / 100);
  blurFloat(A, w, h, p.radius);
  const rgb = rgbOf(p.color || '#ffffff');
  const k = p.intensity / 100;
  for (let j = 0, i = 0; j < n; j++, i += 4) {
    let g = clamp01((A[j] - (1 - sp) * 0) * (1 + sp * 4)) * k;
    g = Math.min(1, g);
    const a = d[i + 3] / 255;
    const na = a + g * (1 - a);
    if (na <= 0) continue;
    for (let c = 0; c < 3; c++) d[i + c] = (d[i + c] * a + rgb[c] * g * (1 - a)) / na;
    d[i + 3] = na * 255;
  }
}

export function innerGlow(img: Px, p: { color: string; radius: number; intensity: number; source: 'edge' | 'center'; mode: FxBlend }) {
  const { width: w, height: h, data: d } = img;
  const n = w * h;
  const A = new Float32Array(n);
  for (let j = 0; j < n; j++) A[j] = d[j * 4 + 3] / 255;
  // en imágenes opacas el «borde» es el marco de la imagen
  const opaque = A.every(v => v > 0.99);
  if (opaque) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x === 0 || y === 0 || x === w - 1 || y === h - 1) A[y * w + x] = 0;
  blurFloat(A, w, h, p.radius);
  const rgb = rgbOf(p.color || '#ffffff');
  const k = p.intensity / 100;
  const I = new Float32Array(n);
  for (let j = 0; j < n; j++) { const inside = d[j * 4 + 3] / 255; I[j] = (p.source === 'center' ? A[j] : 1 - A[j]) * inside * k; }
  const [R, G, B] = tint(I, rgb, 1);
  addLight(img, R, G, B, p.mode || 'screen');
}

export function edgeGlow(img: Px, p: { radius: number; intensity: number; threshold: number; color: string; useColor: boolean; base: number; mode: FxBlend }) {
  const { width: w, height: h, data: d } = img;
  const L = lumaPlane(img);
  const E = sobel(L, w, h);
  const th = clamp01(p.threshold / 100);
  const n = w * h;
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  const rgb = rgbOf(p.color || '#ffffff');
  for (let j = 0, i = 0; j < n; j++, i += 4) {
    const e = smooth(th * 0.5, th + 0.1, E[j]);
    // el color del propio borde, llevado al máximo brillo
    const mx = Math.max(d[i], d[i + 1], d[i + 2], 1);
    const s = p.useColor ? null : 255 / mx;
    R[j] = (s ? d[i] * s : rgb[0]) * e; G[j] = (s ? d[i + 1] * s : rgb[1]) * e; B[j] = (s ? d[i + 2] * s : rgb[2]) * e;
  }
  for (const ch of [R, G, B]) glowBlur(ch, w, h, p.radius);
  const k = p.intensity / 100 * 2;
  for (let j = 0; j < n; j++) { R[j] *= k; G[j] *= k; B[j] *= k; }
  darkenBase(img, p.base);
  addLight(img, R, G, B, p.mode || 'screen');
}

/** Destellos de luz: estelas rectas desde las luces (2, 4, 6 u 8 rayos). */
export function lightStreaks(img: Px, p: { threshold: number; length: number; angle: number; rays: number; intensity: number; tint: string; useTint: boolean }) {
  const { width: w, height: h, data: d } = img;
  const I = brightPass(img, p.threshold, 8);
  const n = w * h;
  const t = rgbOf(p.tint || '#ffffff');
  const S = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let j = 0, i = 0; j < n; j++, i += 4) {
    const v = I[j];
    if (p.useTint) { S[0][j] = t[0] * v; S[1][j] = t[1] * v; S[2][j] = t[2] * v; } else { S[0][j] = d[i] * v; S[1][j] = d[i + 1] * v; S[2][j] = d[i + 2] * v; }
  }
  const rays = Math.max(1, Math.round(p.rays / 2));
  const len = Math.max(2, p.length);
  const out = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const steps = Math.min(80, Math.max(8, Math.round(len / 3)));
  for (let r = 0; r < rays; r++) {
    const a = (p.angle + (180 / rays) * r) * DEG, ca = Math.cos(a), sa = -Math.sin(a);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const j = y * w + x;
      let ar = 0, ag = 0, ab = 0;
      for (let k = 1; k <= steps; k++) {
        const tt = k / steps, f = Math.pow(1 - tt, 2.2);
        const dd = tt * len;
        for (const sgn of [1, -1]) {
          const sx = x + ca * dd * sgn, sy = y + sa * dd * sgn;
          if (sx < 0 || sy < 0 || sx > w - 1 || sy > h - 1) continue;
          ar += sample(S[0], w, h, sx, sy) * f; ag += sample(S[1], w, h, sx, sy) * f; ab += sample(S[2], w, h, sx, sy) * f;
        }
      }
      out[0][j] += ar / steps * 3; out[1][j] += ag / steps * 3; out[2][j] += ab / steps * 3;
    }
  }
  const k = p.intensity / 100 * 1.5;
  for (let j = 0; j < n; j++) { out[0][j] *= k; out[1][j] *= k; out[2][j] *= k; }
  addLight(img, out[0], out[1], out[2], 'screen');
}

/** Halación: el halo rojizo que deja la película alrededor de las luces fuertes. */
export function halation(img: Px, p: { threshold: number; radius: number; intensity: number; color: string }) {
  const { width: w, height: h } = img;
  const I = brightPass(img, p.threshold, 25);
  const outer = new Float32Array(I);
  blurFloat(outer, w, h, p.radius);
  // el halo se ve sobre todo fuera de la luz que lo produce
  for (let j = 0; j < I.length; j++) outer[j] = Math.max(0, outer[j] - I[j] * 0.6);
  const [R, G, B] = tint(outer, rgbOf(p.color || '#ff4a1c'), p.intensity / 100 * 1.8);
  addLight(img, R, G, B, 'screen');
}

/** Difusión: niebla luminosa (filtro de difusión / Pro-Mist). */
export function diffusionGlow(img: Px, p: { radius: number; intensity: number; highlights: number; mode: FxBlend }) {
  const { width: w, height: h, data: d } = img;
  const P = toPlanes(img, true);
  for (const ch of [P.r, P.g, P.b, P.a]) blurFloat(ch, w, h, p.radius);
  const hl = clamp01(p.highlights / 100);
  const n = w * h;
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  const k = p.intensity / 100;
  for (let j = 0; j < n; j++) {
    const l = luma(P.r[j], P.g[j], P.b[j]) / 255;
    const wgt = (1 - hl) + hl * smooth(0.35, 0.9, l);
    R[j] = P.r[j] * wgt * k; G[j] = P.g[j] * wgt * k; B[j] = P.b[j] * wgt * k;
  }
  addLight(img, R, G, B, p.mode || 'screen');
  void d;
}

/** Resplandor de color: la luminosidad de la imagen convertida en luz de un color. */
export function colorGlow(img: Px, p: { color: string; radius: number; intensity: number; threshold: number; mode: FxBlend }) {
  const { width: w, height: h } = img;
  const I = brightPass(img, p.threshold, 60);
  glowBlur(I, w, h, p.radius);
  const [R, G, B] = tint(I, rgbOf(p.color || '#00ff88'), p.intensity / 100 * 1.6);
  addLight(img, R, G, B, p.mode || 'screen');
}

/** Resplandor por umbral: solo lo que supera el umbral brilla (con su color o uno fijo). */
export function thresholdGlow(img: Px, p: { threshold: number; radius: number; intensity: number; color: string; useColor: boolean; mode: FxBlend }) {
  bloom(img, { threshold: p.threshold, softness: 4, radius: p.radius, intensity: p.intensity, tint: p.color, useTint: p.useColor, mode: p.mode });
}

/** Resplandor de fósforo: luz verdosa/ámbar con persistencia horizontal (el fósforo tarda en apagarse). */
export function phosphorGlow(img: Px, p: { radius: number; intensity: number; persistence: number; color: string; useColor: boolean }) {
  const { width: w, height: h, data: d } = img;
  const n = w * h;
  const t = rgbOf(p.color || '#7dffb0');
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  for (let j = 0, i = 0; j < n; j++, i += 4) {
    const l = luma(d[i], d[i + 1], d[i + 2]) / 255 * (d[i + 3] / 255);
    if (p.useColor) { R[j] = t[0] * l; G[j] = t[1] * l; B[j] = t[2] * l; } else { R[j] = d[i] * (d[i + 3] / 255); G[j] = d[i + 1] * (d[i + 3] / 255); B[j] = d[i + 2] * (d[i + 3] / 255); }
  }
  const pers = clamp01(p.persistence / 100);
  for (const ch of [R, G, B]) {
    if (pers > 0) for (let y = 0; y < h; y++) { let acc = 0; for (let x = 0; x < w; x++) { const j = y * w + x; acc = Math.max(ch[j], acc * (0.85 + pers * 0.14)); ch[j] = acc; } }
    glowBlur(ch, w, h, p.radius);
  }
  const k = p.intensity / 100;
  for (let j = 0; j < n; j++) { R[j] *= k; G[j] *= k; B[j] *= k; }
  addLight(img, R, G, B, 'screen');
}

// ---------------- líneas luminosas (referencias de contorno) ----------------

/** Campo de líneas: dado un valor de fase por píxel, dibuja una línea en cada entero con grosor uniforme. */
function linesFromPhase(phase: Float32Array, w: number, h: number, width: number, valid: (j: number, k: number) => number) {
  const out = new Float32Array(w * h);
  const hw = Math.max(0.3, width / 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const j = y * w + x;
    const ph = phase[j];
    const k = Math.round(ph);
    const v = valid(j, k);
    if (v <= 0) continue;
    const gx = (phase[y * w + Math.min(w - 1, x + 1)] - phase[y * w + Math.max(0, x - 1)]) / 2;
    const gy = (phase[Math.min(h - 1, y + 1) * w + x] - phase[Math.max(0, y - 1) * w + x]) / 2;
    const g = Math.hypot(gx, gy) || 1e-3;
    const dist = Math.abs(ph - k) / g; // distancia en px a la línea más cercana
    const a = 1 - smooth(hw * 0.5, hw + 0.75, dist);
    if (a > 0) out[j] = a * v;
  }
  return out;
}

function lineColors(t: number, c1: [number, number, number], c2: [number, number, number]) {
  return [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t];
}

/**
 * Contornos de eco: varias líneas que repiten la silueta hacia fuera (y/o hacia dentro), con
 * separación, ondulación y brillo configurables. La silueta sale del alfa o de la luminosidad.
 */
export function contourEcho(img: Px, p: {
  source: 'alpha' | 'luma'; threshold: number; lines: number; spacing: number; width: number; offset: number;
  wave: number; frequency: number; jitter: number; side: 'outside' | 'inside' | 'both'; falloff: number;
  color: string; color2: string; glow: number; intensity: number; base: number; seed: number;
}) {
  const { width: w, height: h, data: d } = img;
  const n = w * h;
  // silueta suavizada
  const S = new Float32Array(n);
  if (p.source === 'luma') { for (let j = 0, i = 0; j < n; j++, i += 4) S[j] = luma(d[i], d[i + 1], d[i + 2]) / 255 * (d[i + 3] / 255); }
  else for (let j = 0; j < n; j++) S[j] = d[j * 4 + 3] / 255;
  blurFloat(S, w, h, Math.max(1, Math.min(w, h) / 300));
  const th = clamp01(p.threshold / 100);
  const inside = new Uint8Array(n), outside = new Uint8Array(n);
  for (let j = 0; j < n; j++) { inside[j] = S[j] >= th ? 1 : 0; outside[j] = 1 - inside[j]; }
  const Dout = distanceTransform(inside, w, h); // distancia desde la silueta (fuera)
  const Din = p.side === 'outside' ? null : distanceTransform(outside, w, h);
  const sp = Math.max(1.5, p.spacing);
  const phase = new Float32Array(n);
  const freq = Math.max(0.1, p.frequency);
  const amp = p.wave;
  const sideOf = new Int8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const j = y * w + x;
    const out = !inside[j];
    const D = out ? Dout[j] : (Din ? Din[j] : 0);
    sideOf[j] = out ? 1 : -1;
    // ondulación: seno a lo largo de la vertical + ruido suave, crece con la distancia
    const wob = amp * (Math.sin((y / h) * freq * Math.PI * 2 + p.seed) * 0.6 + (fbm(x, y, Math.max(8, Math.min(w, h) / 12), p.seed, 3) - 0.5) * 2 * clamp01(p.jitter / 100))
      * (0.35 + Math.min(1, D / (sp * Math.max(1, p.lines))));
    phase[j] = (D - p.offset + wob) / sp;
  }
  const N = Math.max(1, Math.round(p.lines));
  const fall = clamp01(p.falloff / 100);
  const lines = linesFromPhase(phase, w, h, p.width, (j, k) => {
    if (k < 0 || k >= N) return 0;
    const s = sideOf[j];
    if (p.side === 'outside' && s < 0) return 0;
    if (p.side === 'inside' && s > 0) return 0;
    return Math.pow(1 - fall, k);
  });
  const c1 = rgbOf(p.color || '#3a4bff'), c2 = rgbOf(p.color2 || p.color || '#9fb0ff');
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    const v = lines[j];
    if (!v) continue;
    const t = clamp01(Math.round(phase[j]) / Math.max(1, N - 1));
    const c = lineColors(t, c1, c2);
    R[j] = c[0] * v; G[j] = c[1] * v; B[j] = c[2] * v;
  }
  finishLines(img, R, G, B, p.glow, p.intensity, p.base);
}

/**
 * Líneas de luz: un barrido de líneas paralelas que se desplazan con la luminosidad de la imagen
 * (relieve de señal, como un monitor de vectores). Las líneas solo aparecen sobre el motivo.
 */
export function lightLines(img: Px, p: {
  direction: 'horizontal' | 'vertical'; spacing: number; width: number; displace: number; smoothing: number;
  wave: number; frequency: number; threshold: number; color: string; color2: string; glow: number; intensity: number;
  base: number; seed: number;
}) {
  const { width: w, height: h, data: d } = img;
  const n = w * h;
  const L = lumaPlane(img);
  for (let j = 0; j < n; j++) L[j] *= d[j * 4 + 3] / 255;
  const M = new Float32Array(L);
  blurFloat(L, w, h, Math.max(1, p.smoothing));
  blurFloat(M, w, h, 1.5);
  const sp = Math.max(1.5, p.spacing);
  const vert = p.direction === 'vertical';
  const freq = Math.max(0.1, p.frequency);
  const phase = new Float32Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const j = y * w + x;
    const along = vert ? y : x, across = vert ? x : y, len = vert ? h : w;
    const disp = (L[j] / 255) * p.displace + p.wave * Math.sin((along / len) * freq * Math.PI * 2 + across * 0.013 + p.seed)
      + (fbm(x, y, Math.max(6, Math.min(w, h) / 20), p.seed + 3, 2) - 0.5) * p.wave * 0.6;
    phase[j] = (across - disp) / sp;
  }
  const th = clamp01(p.threshold / 100);
  const lines = linesFromPhase(phase, w, h, p.width, j => smooth(th - 0.04, th + 0.08, M[j] / 255) * (0.55 + 0.45 * Math.min(1, M[j] / 255 / Math.max(0.2, th + 0.2))));
  const c1 = rgbOf(p.color || '#3a4bff'), c2 = rgbOf(p.color2 || '#e6ecff');
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    const v = lines[j];
    if (!v) continue;
    const c = lineColors(clamp01(M[j] / 255), c1, c2); // las zonas claras van al segundo color (núcleo más blanco)
    R[j] = c[0] * v; G[j] = c[1] * v; B[j] = c[2] * v;
  }
  finishLines(img, R, G, B, p.glow, p.intensity, p.base);
}

function finishLines(img: Px, R: Float32Array, G: Float32Array, B: Float32Array, glow: number, intensity: number, base: number) {
  const { width: w, height: h } = img;
  const k = intensity / 100;
  if (glow > 0) {
    const gR = new Float32Array(R), gG = new Float32Array(G), gB = new Float32Array(B);
    for (const ch of [gR, gG, gB]) glowBlur(ch, w, h, glow);
    for (let j = 0; j < R.length; j++) { R[j] = (R[j] + gR[j] * 1.2) * k; G[j] = (G[j] + gG[j] * 1.2) * k; B[j] = (B[j] + gB[j] * 1.2) * k; }
  } else for (let j = 0; j < R.length; j++) { R[j] *= k; G[j] *= k; B[j] *= k; }
  darkenBase(img, base);
  addLight(img, R, G, B, 'screen');
}

export { clamp, fromPlanes };
