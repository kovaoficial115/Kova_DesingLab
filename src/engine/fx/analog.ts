// VHS y CRT: señal analógica, cinta y pantallas de tubo. Todo procedural y determinista.

import { type Px, hash3, gauss3, fbm, rng, sample, samplePremul, clamp, clamp01, smooth, luma, blurFloat, boxBlurChannel, rgbOf } from './core';

// ======================= VHS =======================

/** Desajuste de tracking: una franja de líneas temblorosas con ruido blanco. */
export function vhsTracking(img: Px, p: { amount: number; position: number; height: number; noise: number; seed: number }) {
  const { width: w, height: h, data: d } = img;
  const src = new Uint8ClampedArray(d);
  const yc = (p.position / 100) * h, bh = Math.max(2, p.height);
  const nz = clamp01(p.noise / 100);
  for (let y = 0; y < h; y++) {
    const t = 1 - Math.min(1, Math.abs(y - yc) / bh);
    if (t <= 0) continue;
    const k = t * t;
    const sh = (gauss3(0, y, p.seed) * 0.6 + Math.sin(y * 0.21 + p.seed) * 0.4) * p.amount * k;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const sx = x - sh;
      for (let c = 0; c < 4; c++) d[i + c] = sample(src, w, h, sx, y, 4, c);
      // ruido de cabeza: rayas blancas cortas
      const streak = fbm(x, y * 8, 18, p.seed + 3, 2);
      if (streak > 1 - nz * 0.45 * k) { const v = 200 + hash3(x, y, p.seed) * 55; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = Math.max(d[i + 3], 220); }
    }
  }
}

/** Ruido de cinta: destellos horizontales finos repartidos por la imagen. */
export function tapeNoise(img: Px, p: { amount: number; length: number; brightness: number; seed: number }) {
  const { width: w, height: h, data: d } = img;
  const R = rng(p.seed * 7 + 2);
  const n = Math.round((p.amount / 100) * h * 0.6);
  for (let k = 0; k < n; k++) {
    const y = Math.floor(R() * h), x0 = Math.floor(R() * w), len = Math.max(2, Math.round(p.length * (0.2 + R())));
    const v = clamp(p.brightness * 2.55 * (0.6 + R() * 0.4));
    for (let x = x0; x < Math.min(w, x0 + len); x++) {
      const t = (x - x0) / len, f = Math.sin(t * Math.PI);
      const i = (y * w + x) * 4;
      d[i] += (v - d[i]) * f; d[i + 1] += (v - d[i + 1]) * f; d[i + 2] += (v - d[i + 2]) * f;
      d[i + 3] = Math.max(d[i + 3], 255 * f);
    }
  }
}

/** Líneas horizontales simples (alternas) como en una señal de vídeo. */
export function hScanlines(img: Px, p: { intensity: number; spacing: number; thickness: number }) {
  const { width: w, height: h, data: d } = img;
  const sp = Math.max(1, p.spacing), th = clamp01(p.thickness / 100), k = clamp01(p.intensity / 100);
  for (let y = 0; y < h; y++) {
    const ph = (y % sp) / sp;
    if (ph >= th) continue;
    for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; d[i] *= 1 - k; d[i + 1] *= 1 - k; d[i + 2] *= 1 - k; }
  }
}

/** Sangrado de color analógico: el croma se emborrona y se corre a la derecha (YIQ). */
export function colorBleed(img: Px, p: { amount: number; shift: number; saturation: number }) {
  const { width: w, height: h, data: d } = img;
  const n = w * h;
  const Y = new Float32Array(n), I = new Float32Array(n), Q = new Float32Array(n);
  for (let j = 0, i = 0; j < n; j++, i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    Y[j] = 0.299 * r + 0.587 * g + 0.114 * b; I[j] = 0.596 * r - 0.274 * g - 0.322 * b; Q[j] = 0.211 * r - 0.523 * g + 0.312 * b;
  }
  const rad = Math.max(0, Math.round(p.amount));
  // solo en horizontal: la cinta pierde resolución de color a lo largo de la línea
  if (rad > 0) for (const ch of [I, Q]) {
    const tmp = new Float32Array(w);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let pass = 0; pass < 2; pass++) {
        let acc = 0;
        for (let x = -rad; x <= rad; x++) acc += ch[row + clamp(x, 0, w - 1)];
        for (let x = 0; x < w; x++) { tmp[x] = acc / (2 * rad + 1); acc += ch[row + Math.min(w - 1, x + rad + 1)] - ch[row + Math.max(0, x - rad)]; }
        ch.set(tmp, row);
      }
    }
  }
  const sh = p.shift, sat = 1 + p.saturation / 100;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const j = y * w + x, i = j * 4;
    const ii = sample(I, w, h, x - sh, y) * sat, qq = sample(Q, w, h, x - sh, y) * sat, yy = Y[j];
    d[i] = clamp(yy + 0.956 * ii + 0.621 * qq); d[i + 1] = clamp(yy - 0.272 * ii - 0.647 * qq); d[i + 2] = clamp(yy - 1.106 * ii + 1.703 * qq);
  }
}

/** Distorsión de cinta: cada línea se desplaza con un vaivén lento (cinta estirada). */
export function tapeDistortion(img: Px, p: { amount: number; frequency: number; jitter: number; seed: number }) {
  const { width: w, height: h, data: d } = img;
  const src = new Uint8ClampedArray(d);
  const px = new Float32Array(4);
  for (let y = 0; y < h; y++) {
    const s = (Math.sin((y / h) * p.frequency * Math.PI * 2 + p.seed) * 0.6 + (fbm(0, y, Math.max(4, h / 30), p.seed, 3) - 0.5) * 1.6) * p.amount
      + gauss3(3, y, p.seed) * p.jitter * 0.5;
    for (let x = 0; x < w; x++) {
      samplePremul(src, w, h, x - s, y, px);
      const i = (y * w + x) * 4;
      if (px[3] > 0.01) { d[i] = px[0] / px[3]; d[i + 1] = px[1] / px[3]; d[i + 2] = px[2] / px[3]; }
      d[i + 3] = px[3];
    }
  }
}

/** Pérdida de señal: líneas que se quedan en blanco, negro o ruido. */
export function signalDropout(img: Px, p: { amount: number; length: number; mode: 'white' | 'black' | 'noise'; seed: number }) {
  const { width: w, height: h, data: d } = img;
  const R = rng(p.seed * 5 + 11);
  const n = Math.round(p.amount);
  for (let k = 0; k < n; k++) {
    const y = Math.floor(R() * h), x0 = Math.floor(R() * w), len = Math.max(4, Math.round(p.length * (0.3 + R() * 1.4)));
    const rows = R() < 0.3 ? 2 : 1;
    for (let yy = y; yy < Math.min(h, y + rows); yy++) for (let x = x0; x < Math.min(w, x0 + len); x++) {
      const i = (yy * w + x) * 4;
      const v = p.mode === 'white' ? 235 : p.mode === 'black' ? 8 : hash3(x, yy, p.seed) * 255;
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
  }
}

/** Imágenes fantasma: copias tenues desplazadas a la derecha (reflejos de señal). */
export function ghosting(img: Px, p: { offset: number; amount: number; copies: number }) {
  const { width: w, height: h, data: d } = img;
  const src = new Uint8ClampedArray(d);
  const n = Math.max(1, Math.round(p.copies)), k = clamp01(p.amount / 100);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) {
      let acc = 0, tot = 0;
      for (let m = 1; m <= n; m++) { const f = k / m; acc += sample(src, w, h, x - p.offset * m, y, 4, c) * f; tot += f; }
      d[i + c] = clamp(src[i + c] * (1 - tot * 0.5) + acc * 0.5 + acc * 0.25);
    }
  }
}

/** Nitidez analógica: realce solo horizontal, con los halos claros/oscuros típicos del vídeo. */
export function analogSharpness(img: Px, p: { amount: number; radius: number }) {
  const { width: w, height: h, data: d } = img;
  const r = Math.max(1, Math.round(p.radius)), k = p.amount / 100;
  const row = new Float32Array(w);
  for (let y = 0; y < h; y++) for (let c = 0; c < 3; c++) {
    for (let x = 0; x < w; x++) row[x] = d[(y * w + x) * 4 + c];
    const bl = new Float32Array(row);
    for (let pass = 0; pass < 2; pass++) {
      const t = new Float32Array(bl);
      for (let x = 0; x < w; x++) { let s = 0; for (let o = -r; o <= r; o++) s += t[clamp(x + o, 0, w - 1)]; bl[x] = s / (2 * r + 1); }
    }
    for (let x = 0; x < w; x++) d[(y * w + x) * 4 + c] = clamp(row[x] + (row[x] - bl[x]) * k);
  }
}

/** Entrelazado: las líneas impares se desplazan y oscurecen (dos campos de vídeo). */
export function interlacing(img: Px, p: { offset: number; darken: number; field: 'odd' | 'even' }) {
  const { width: w, height: h, data: d } = img;
  const src = new Uint8ClampedArray(d);
  const k = 1 - clamp01(p.darken / 100);
  for (let y = p.field === 'even' ? 0 : 1; y < h; y += 2) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    for (let c = 0; c < 4; c++) d[i + c] = sample(src, w, h, x - p.offset, y, 4, c) * (c < 3 ? k : 1);
  }
}

/** Ruido de cambio de cabezal: las últimas líneas se tuercen hacia un lado con ruido. */
export function headSwitching(img: Px, p: { height: number; amount: number; noise: number; seed: number }) {
  const { width: w, height: h, data: d } = img;
  const src = new Uint8ClampedArray(d);
  const H = Math.max(1, Math.min(h, Math.round(p.height)));
  const nz = clamp01(p.noise / 100);
  for (let y = h - H; y < h; y++) {
    const t = (y - (h - H)) / H;
    const sh = p.amount * (0.3 + 0.7 * t) * (1 + gauss3(0, y, p.seed) * 0.3);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) d[i + c] = sample(src, w, h, x - sh, y, 4, c);
      if (hash3(x >> 1, y, p.seed + 4) < nz * t) { const v = hash3(x, y, p.seed) * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    }
  }
}

// ---- texto del timecode con una fuente de píxeles propia (5×7) ----
const FONT: Record<string, string> = {
  '0': '01110100011001110101110011000101110', '1': '00100011000010000100001000010001110', '2': '01110100010000100010001000100011111',
  '3': '11111000100010000010000011000101110', '4': '00010001100101010010111110001000010', '5': '11111100001111000001000011000101110',
  '6': '00110010001000011110100011000101110', '7': '11111000010001000100010000100001000', '8': '01110100011000101110100011000101110',
  '9': '01110100011000101111000010001001100', ':': '00000011000110000000011000110000000', '.': '00000000000000000000000000110001100',
  '/': '00001000010001000100010001000010000', '-': '00000000000000011111000000000000000', ' ': '00000000000000000000000000000000000',
  'A': '01110100011000111111100011000110001', 'B': '11110100011000111110100011000111110', 'C': '01110100011000010000100001000101110',
  'D': '11100100101000110001100011001011100', 'E': '11111100001000011110100001000011111', 'F': '11111100001000011110100001000010000',
  'G': '01110100011000010111100011000101111', 'H': '10001100011000111111100011000110001', 'I': '01110001000010000100001000010001110',
  'J': '00111000100001000010000101001001100', 'K': '10001100101010011000101001001010001', 'L': '10000100001000010000100001000011111',
  'M': '10001110111010110101100011000110001', 'N': '10001100011100110101100111000110001', 'O': '01110100011000110001100011000101110',
  'P': '11110100011000111110100001000010000', 'Q': '01110100011000110001101011001001101', 'R': '11110100011000111110101001001010001',
  'S': '01111100001000001110000010000111110', 'T': '11111001000010000100001000010000100', 'U': '10001100011000110001100011000101110',
  'V': '10001100011000110001100010101000100', 'W': '10001100011000110101101011010101010', 'X': '10001100010101000100010101000110001',
  'Y': '10001100011000101010001000010000100', 'Z': '11111000010001000100010001000011111', '>': '10000110001110011110111001100010000',
  '|': '00100001000010000100001000010000100', '[': '01110010000100001000010000100001110', ']': '01110000100001000010000100001001110',
};
export function drawPixelText(img: Px, text: string, x0: number, y0: number, scale: number, rgb: [number, number, number], shadow = true) {
  const { width: w, height: h, data: d } = img;
  const put = (x: number, y: number, c: [number, number, number], a: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    d[i] = c[0] * a + d[i] * (1 - a); d[i + 1] = c[1] * a + d[i + 1] * (1 - a); d[i + 2] = c[2] * a + d[i + 2] * (1 - a);
    d[i + 3] = Math.max(d[i + 3], 255 * a);
  };
  const s = Math.max(1, Math.round(scale));
  let cx = x0;
  for (const ch of text.toUpperCase()) {
    const g = FONT[ch] ?? FONT[' '];
    for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 5; gx++) {
      if (g[gy * 5 + gx] !== '1') continue;
      for (let yy = 0; yy < s; yy++) for (let xx = 0; xx < s; xx++) {
        if (shadow) put(cx + gx * s + xx + s, y0 + gy * s + yy + s, [0, 0, 0], 0.6);
      }
    }
    for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 5; gx++) {
      if (g[gy * 5 + gx] !== '1') continue;
      for (let yy = 0; yy < s; yy++) for (let xx = 0; xx < s; xx++) put(cx + gx * s + xx, y0 + gy * s + yy, rgb, 1);
    }
    cx += 6 * s;
  }
  return cx - x0;
}
export const pixelTextWidth = (text: string, scale: number) => text.length * 6 * Math.max(1, Math.round(scale));

/** Rótulo de cámara/vídeo (PLAY, REC, fecha y contador) dibujado con fuente de píxeles. */
export function timecode(img: Px, p: { label: string; date: string; time: string; size: number; color: string; margin: number; corner: 'tl' | 'tr' | 'bl' | 'br'; split: boolean }) {
  const { width: w, height: h } = img;
  const s = Math.max(1, Math.round(p.size));
  const rgb = rgbOf(p.color || '#ffffff');
  const m = Math.round(p.margin);
  const line = 9 * s;
  const top = [p.label].filter(Boolean), bottom = [p.time, p.date].filter(Boolean);
  const place = (lines: string[], corner: string) => {
    lines.forEach((t, k) => {
      const tw = pixelTextWidth(t, s);
      const x = corner.endsWith('r') ? w - m - tw : m;
      const y = corner.startsWith('t') ? m + k * line : h - m - (lines.length - k) * line + 2 * s;
      drawPixelText(img, t, x, y, s, rgb);
    });
  };
  if (p.split) { place(top, p.corner.startsWith('t') ? p.corner : 't' + p.corner[1]); place(bottom, p.corner.startsWith('b') ? p.corner : 'b' + p.corner[1]); }
  else place([...top, ...bottom], p.corner);
}

// ======================= CRT =======================

/** Líneas de barrido CRT: perfil suave, más finas en las zonas oscuras (el haz se ensancha con la luz). */
export function crtScanlines(img: Px, p: { intensity: number; spacing: number; thickness: number; response: number }) {
  const { width: w, height: h, data: d } = img;
  const sp = Math.max(1.5, p.spacing), k = clamp01(p.intensity / 100), th = clamp01(p.thickness / 100), resp = clamp01(p.response / 100);
  for (let y = 0; y < h; y++) {
    const ph = ((y + 0.5) % sp) / sp; // 0..1 dentro de cada línea
    const dist = Math.abs(ph - 0.5) * 2; // 0 en el centro del haz
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const l = luma(d[i], d[i + 1], d[i + 2]) / 255;
      const beam = th * (1 - resp) + th * resp * (0.5 + l); // grosor del haz según el brillo
      const v = 1 - k * smooth(beam * 0.6, beam * 0.6 + 0.35, dist);
      d[i] *= v; d[i + 1] *= v; d[i + 2] *= v;
    }
  }
}

/** Máscara de fósforo RGB (tríadas en tresbolillo) o rejilla de apertura (franjas verticales). */
export function phosphorMask(img: Px, p: { type: 'shadow' | 'slot' | 'grille'; size: number; intensity: number; brightness: number }) {
  const { width: w, height: h, data: d } = img;
  const S = Math.max(1, p.size), k = clamp01(p.intensity / 100), gain = 1 + p.brightness / 100;
  const lo = 1 - k;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let col = x / S;
    if (p.type === 'shadow') col += Math.floor(y / S) % 2 ? 1.5 : 0; // filas alternas desplazadas
    const c = Math.floor(col) % 3;
    let rowGap = 1;
    if (p.type === 'slot') { const cell = Math.floor(col / 3); const yy = (y + (cell % 2 ? S * 1.5 : 0)) % (S * 3); rowGap = yy < S * 0.4 ? lo : 1; }
    if (p.type === 'shadow') { const fy = (y % S) / S; rowGap = 1 - k * 0.5 * smooth(0.6, 1, Math.abs(fy - 0.5) * 2); }
    const i = (y * w + x) * 4;
    for (let ch = 0; ch < 3; ch++) d[i + ch] = clamp(d[i + ch] * (ch === c ? 1 : lo) * rowGap * gain);
  }
}

/** Curvatura de pantalla: abombado, esquinas redondeadas y viñeta. */
export function screenCurvature(img: Px, p: { amount: number; corner: number; vignette: number; border: string }) {
  const { width: w, height: h, data: d } = img;
  const src = new Uint8ClampedArray(d);
  const k = p.amount / 100 * 0.35;
  const cr = clamp01(p.corner / 100) * 0.25;
  const vig = clamp01(p.vignette / 100);
  const bc = rgbOf(p.border || '#000000');
  const px = new Float32Array(4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let u = (x + 0.5) / w * 2 - 1, v = (y + 0.5) / h * 2 - 1;
    const r2 = u * u + v * v;
    u *= 1 + k * r2 * 0.5 * (1 + v * v * 0.3); v *= 1 + k * r2 * 0.5 * (1 + u * u * 0.3);
    const i = (y * w + x) * 4;
    // esquinas redondeadas (distancia a un rectángulo redondeado)
    const qx = Math.max(Math.abs(u) - (1 - cr), 0), qy = Math.max(Math.abs(v) - (1 - cr), 0);
    const outside = Math.hypot(qx, qy) - cr;
    const edge = smooth(-0.004, 0.004, outside);
    if (edge >= 1) { d[i] = bc[0]; d[i + 1] = bc[1]; d[i + 2] = bc[2]; d[i + 3] = 255; continue; }
    samplePremul(src, w, h, (u + 1) / 2 * w - 0.5, (v + 1) / 2 * h - 0.5, px);
    const a = px[3];
    let r = a > 0.01 ? px[0] / a : 0, g = a > 0.01 ? px[1] / a : 0, b = a > 0.01 ? px[2] / a : 0;
    const vg = 1 - vig * Math.pow(Math.min(1, (u * u * 0.8 + v * v) / 1.6), 1.5);
    r *= vg; g *= vg; b *= vg;
    d[i] = r + (bc[0] - r) * edge; d[i + 1] = g + (bc[1] - g) * edge; d[i + 2] = b + (bc[2] - b) * edge;
    d[i + 3] = a + (255 - a) * edge;
  }
}

/** Distorsión de barril (positivo) o de cojín (negativo). */
export function barrelDistortion(img: Px, p: { amount: number; cx: number; cy: number; zoom: number }) {
  const { width: w, height: h, data: d } = img;
  const src = new Uint8ClampedArray(d);
  const k = p.amount / 100 * 0.5, z = Math.max(0.2, p.zoom / 100);
  const cx = p.cx * w, cy = p.cy * h, R = Math.hypot(w, h) / 2;
  const px = new Float32Array(4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x - cx) / R, dy = (y - cy) / R;
    const f = (1 + k * (dx * dx + dy * dy)) / z;
    samplePremul(src, w, h, cx + dx * f * R, cy + dy * f * R, px);
    const i = (y * w + x) * 4;
    if (px[3] > 0.01) { d[i] = px[0] / px[3]; d[i + 1] = px[1] / px[3]; d[i + 2] = px[2] / px[3]; }
    d[i + 3] = px[3];
  }
}

/** Parpadeo de pantalla (estático): variación de brillo y una banda que «rueda». */
export function screenFlicker(img: Px, p: { amount: number; band: number; position: number; seed: number }) {
  const { width: w, height: h, data: d } = img;
  const g = 1 + (hash3(0, 0, p.seed) - 0.5) * p.amount / 100 * 0.6;
  const yc = (p.position / 100) * h, bh = Math.max(1, (p.band / 100) * h);
  for (let y = 0; y < h; y++) {
    const t = Math.exp(-(((y - yc) / bh) ** 2));
    const k = g * (1 + t * p.amount / 100 * 0.35);
    for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; d[i] = clamp(d[i] * k); d[i + 1] = clamp(d[i + 1] * k); d[i + 2] = clamp(d[i + 2] * k); }
  }
}

/** Distorsión de sincronía horizontal: las líneas se tuercen en una curva que se amortigua. */
export function hsyncDistortion(img: Px, p: { amount: number; frequency: number; position: number; decay: number; seed: number }) {
  const { width: w, height: h, data: d } = img;
  const src = new Uint8ClampedArray(d);
  const y0 = (p.position / 100) * h, dec = Math.max(1, (p.decay / 100) * h);
  const px = new Float32Array(4);
  for (let y = 0; y < h; y++) {
    const t = Math.max(0, y - y0);
    const env = y < y0 ? 0 : Math.exp(-t / dec);
    const s = p.amount * env * Math.sin(t / h * p.frequency * Math.PI * 2 + p.seed) + p.amount * 0.15 * env * gauss3(0, y, p.seed);
    if (!s) continue;
    for (let x = 0; x < w; x++) {
      samplePremul(src, w, h, x - s, y, px);
      const i = (y * w + x) * 4;
      if (px[3] > 0.01) { d[i] = px[0] / px[3]; d[i + 1] = px[1] / px[3]; d[i + 2] = px[2] / px[3]; }
      d[i + 3] = px[3];
    }
  }
}

/** Nitidez de tubo: negativo = haz suave (desenfoque horizontal), positivo = realce. */
export function crtSharpness(img: Px, p: { sharpness: number; radius: number }) {
  const { width: w, height: h, data: d } = img;
  const n = w * h, r = Math.max(1, Math.round(p.radius));
  const k = p.sharpness / 100;
  for (let c = 0; c < 3; c++) {
    const ch = new Float32Array(n);
    for (let j = 0; j < n; j++) ch[j] = d[j * 4 + c];
    const bl = new Float32Array(ch);
    // solo horizontal: el haz recorre la línea
    for (let y = 0; y < h; y++) {
      const row = bl.subarray(y * w, y * w + w);
      boxBlurChannel(row, w, 1, r);
    }
    for (let j = 0; j < n; j++) d[j * 4 + c] = clamp(k < 0 ? ch[j] + (bl[j] - ch[j]) * -k : ch[j] + (ch[j] - bl[j]) * k);
  }
}

export { blurFloat };
