// Glitch y distorsión digital. Los desplazamientos van en px del contenido; el azar sale de la
// semilla del efecto (mismo resultado en pantalla y al exportar).

import { type Px, sample, samplePremul, rng, hash3, fbm, clamp, clamp01, DEG, luma, smooth, sobel, lumaPlane, blurFloat, gauss3 } from './core';

/** Reconstruye la imagen leyendo cada píxel de otra posición (bilineal, premultiplicado). */
function remap(img: Px, fn: (x: number, y: number, out: Float32Array) => void) {
  const { width: w, height: h, data: d } = img;
  const src = new Uint8ClampedArray(d);
  const pos = new Float32Array(2), px = new Float32Array(4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    fn(x, y, pos);
    samplePremul(src, w, h, pos[0], pos[1], px);
    const i = (y * w + x) * 4;
    if (px[3] > 0.01) { d[i] = px[0] / px[3]; d[i + 1] = px[1] / px[3]; d[i + 2] = px[2] / px[3]; }
    d[i + 3] = px[3];
  }
}
/** Lee un canal desde otra posición (bilineal). */
function shiftChannels(img: Px, offs: [number, number][], alphaMode: 'max' | 'keep' = 'max') {
  const { width: w, height: h, data: d } = img;
  const src = new Uint8ClampedArray(d);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    let a = src[i + 3];
    for (let c = 0; c < 3; c++) {
      const [dx, dy] = offs[c];
      if (!dx && !dy) continue;
      d[i + c] = sample(src, w, h, x - dx, y - dy, 4, c);
      if (alphaMode === 'max') a = Math.max(a, sample(src, w, h, x - dx, y - dy, 4, 3));
    }
    d[i + 3] = a;
  }
}

export function rgbSplit(img: Px, p: { rx: number; ry: number; gx: number; gy: number; bx: number; by: number }) {
  shiftChannels(img, [[p.rx, p.ry], [p.gx, p.gy], [p.bx, p.by]]);
}

export function channelOffset(img: Px, p: { channel: 'r' | 'g' | 'b'; dx: number; dy: number; wrap?: boolean }) {
  const { width: w, height: h, data: d } = img;
  const c = p.channel === 'g' ? 1 : p.channel === 'b' ? 2 : 0;
  const src = new Uint8ClampedArray(d);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let sx = x - p.dx, sy = y - p.dy;
    if (p.wrap) { sx = ((sx % w) + w) % w; sy = ((sy % h) + h) % h; }
    d[(y * w + x) * 4 + c] = sample(src, w, h, sx, sy, 4, c);
  }
}

/** Aberración cromática radial (crece hacia los bordes) o direccional. */
export function chromaticAberration(img: Px, p: { mode: 'radial' | 'directional'; amount: number; angle: number; cx: number; cy: number }) {
  const { width: w, height: h, data: d } = img;
  const src = new Uint8ClampedArray(d);
  if (p.mode === 'directional') {
    const dx = Math.cos(p.angle * DEG) * p.amount, dy = -Math.sin(p.angle * DEG) * p.amount;
    shiftChannels(img, [[dx, dy], [0, 0], [-dx, -dy]]);
    return;
  }
  const cx = p.cx * w, cy = p.cy * h;
  const maxR = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)) || 1;
  const k = p.amount / maxR;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const dx = x - cx, dy = y - cy;
    const s = k * Math.hypot(dx, dy) / maxR;
    d[i] = sample(src, w, h, cx + dx * (1 - s), cy + dy * (1 - s), 4, 0);
    d[i + 2] = sample(src, w, h, cx + dx * (1 + s), cy + dy * (1 + s), 4, 2);
    d[i + 3] = Math.max(src[i + 3], sample(src, w, h, cx + dx * (1 - s), cy + dy * (1 - s), 4, 3), sample(src, w, h, cx + dx * (1 + s), cy + dy * (1 + s), 4, 3));
  }
}

/** Franjas horizontales (o columnas) desplazadas al azar; opcionalmente con separación RGB. */
export function sliceGlitch(img: Px, p: { vertical?: boolean; amount: number; bands: number; height: number; rgb: number; seed: number }) {
  const { width: w, height: h, data: d } = img;
  const src = new Uint8ClampedArray(d);
  const R = rng(p.seed * 31 + (p.vertical ? 7 : 3));
  const len = p.vertical ? w : h;
  const shift = new Float32Array(len), split = new Float32Array(len);
  const n = Math.max(0, Math.round(p.bands));
  for (let k = 0; k < n; k++) {
    const start = Math.floor(R() * len), bh = Math.max(1, Math.round((0.15 + R() * 0.85) * p.height));
    const s = (R() * 2 - 1) * p.amount, sp = (R() * 2 - 1) * p.rgb;
    for (let t = start; t < Math.min(len, start + bh); t++) { shift[t] += s; split[t] += sp; }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = p.vertical ? x : y;
    const s = shift[t], sp = split[t];
    if (!s && !sp) continue;
    const i = (y * w + x) * 4;
    for (let c = 0; c < 4; c++) {
      const o = c === 0 ? s + sp : c === 2 ? s - sp : s;
      let sx = p.vertical ? x : x - o, sy = p.vertical ? y - o : y;
      sx = ((Math.round(sx) % w) + w) % w; sy = ((Math.round(sy) % h) + h) % h; // las franjas «dan la vuelta» como en una señal rota
      d[i + c] = src[(sy * w + sx) * 4 + c];
    }
  }
}

/** Ordenación de píxeles: dentro de cada tramo que cumple el umbral, los píxeles se ordenan por la clave. */
export function pixelSort(img: Px, p: { direction: 'horizontal' | 'vertical'; key: 'luma' | 'hue' | 'saturation' | 'r' | 'g' | 'b'; lower: number; upper: number; reverse: boolean; maxLength: number; randomness: number; seed: number }) {
  const { width: w, height: h, data: d } = img;
  const vert = p.direction === 'vertical';
  const lines = vert ? w : h, len = vert ? h : w;
  const keyOf = (i: number) => {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    switch (p.key) {
      case 'r': return r; case 'g': return g; case 'b': return b;
      case 'saturation': { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx ? ((mx - mn) / mx) * 255 : 0; }
      case 'hue': {
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
        if (!c) return 0;
        let hh = mx === r ? ((g - b) / c) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4;
        return ((hh * 60 + 360) % 360) / 360 * 255;
      }
      default: return luma(r, g, b);
    }
  };
  const lo = Math.min(p.lower, p.upper), hi = Math.max(p.lower, p.upper);
  const R = rng(p.seed * 17 + 5);
  const maxL = Math.max(2, Math.round(p.maxLength || len));
  const idx = new Int32Array(len), keys = new Float32Array(len), buf = new Uint8ClampedArray(len * 4);
  for (let L = 0; L < lines; L++) {
    if (p.randomness > 0 && R() * 100 < p.randomness * 0.5) continue; // algunas líneas quedan sin ordenar
    let t = 0;
    while (t < len) {
      const at = (k: number) => (vert ? k * w + L : L * w + k) * 4;
      // inicio de un tramo dentro del umbral
      while (t < len && !(keyOf(at(t)) >= lo && keyOf(at(t)) <= hi && d[at(t) + 3] > 0)) t++;
      const s0 = t;
      const lim = Math.min(len, s0 + Math.round(maxL * (p.randomness > 0 ? 0.4 + R() * 0.6 : 1)));
      while (t < lim && keyOf(at(t)) >= lo && keyOf(at(t)) <= hi && d[at(t) + 3] > 0) t++;
      const n = t - s0;
      if (n > 1) {
        for (let k = 0; k < n; k++) { idx[k] = k; keys[k] = keyOf(at(s0 + k)); const o = at(s0 + k); buf.set(d.subarray(o, o + 4), k * 4); }
        const view = Array.from(idx.subarray(0, n)).sort((a, b) => (p.reverse ? keys[b] - keys[a] : keys[a] - keys[b]));
        for (let k = 0; k < n; k++) { const o = at(s0 + k), j = view[k] * 4; d[o] = buf[j]; d[o + 1] = buf[j + 1]; d[o + 2] = buf[j + 2]; d[o + 3] = buf[j + 3]; }
      }
      if (t === s0) t++;
    }
  }
}

/** Corrupción de datos: bloques copiados de otro sitio, canales cambiados y bits rotos. */
export function dataCorruption(img: Px, p: { amount: number; block: number; shift: number; channels: number; bits: number; seed: number }) {
  const { width: w, height: h, data: d } = img;
  const src = new Uint8ClampedArray(d);
  const R = rng(p.seed * 13 + 1);
  const n = Math.round(p.amount);
  for (let k = 0; k < n; k++) {
    const bw = Math.max(2, Math.round(p.block * (0.5 + R() * 2.5))), bh = Math.max(1, Math.round(p.block * (0.2 + R() * 0.9)));
    const x0 = Math.floor(R() * w), y0 = Math.floor(R() * h);
    const sx = Math.round((R() * 2 - 1) * p.shift), sy = Math.round((R() * 2 - 1) * p.shift * 0.25);
    const swap = R() * 100 < p.channels ? Math.floor(R() * 5) + 1 : 0;
    const flip = R() * 100 < p.bits ? 1 + Math.floor(R() * 4) : 0;
    for (let y = y0; y < Math.min(h, y0 + bh); y++) for (let x = x0; x < Math.min(w, x0 + bw); x++) {
      const xx = ((x + sx) % w + w) % w, yy = ((y + sy) % h + h) % h;
      const i = (y * w + x) * 4, j = (yy * w + xx) * 4;
      let r = src[j], g = src[j + 1], b = src[j + 2];
      if (swap === 1) [r, g] = [g, r]; else if (swap === 2) [g, b] = [b, g]; else if (swap === 3) [r, b] = [b, r]; else if (swap === 4) [r, g, b] = [g, b, r]; else if (swap === 5) [r, g, b] = [255 - r, g, 255 - b];
      if (flip) { const m = (1 << (8 - flip)) - 1; r &= ~m & 255; g &= ~m & 255; b &= ~m & 255; }
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = Math.max(src[i + 3], src[j + 3]);
    }
  }
}

/** Desplazamiento digital: cada píxel se mueve según un mapa (ruido fractal o la propia luminancia). */
export function displacement(img: Px, p: { amount: number; scale: number; source: 'noise' | 'luma'; angle: number; seed: number }) {
  const { width: w, height: h } = img;
  const sc = Math.max(2, p.scale);
  let L: Float32Array | null = null;
  if (p.source === 'luma') { L = lumaPlane(img); blurFloat(L, w, h, Math.max(1, sc / 8)); }
  const ca = Math.cos(p.angle * DEG), sa = -Math.sin(p.angle * DEG);
  remap(img, (x, y, o) => {
    if (L) {
      const v = (L[y * w + x] / 255 - 0.5) * 2 * p.amount;
      o[0] = x + ca * v; o[1] = y + sa * v;
    } else {
      const vx = (fbm(x, y, sc, p.seed * 3 + 1, 3) - 0.5) * 2 * p.amount, vy = (fbm(x, y, sc, p.seed * 3 + 2, 3) - 0.5) * 2 * p.amount;
      o[0] = x + vx; o[1] = y + vy;
    }
  });
}

/** Distorsión de onda (senoidal) en X e Y. */
export function waveDistortion(img: Px, p: { ampX: number; wavelengthX: number; ampY: number; wavelengthY: number; phase: number }) {
  const lx = Math.max(2, p.wavelengthX), ly = Math.max(2, p.wavelengthY), ph = p.phase * DEG;
  remap(img, (x, y, o) => {
    o[0] = x + p.ampX * Math.sin((2 * Math.PI * y) / lx + ph);
    o[1] = y + p.ampY * Math.sin((2 * Math.PI * x) / ly + ph);
  });
}

/** Líneas desplazadas en una zona: como una señal que se tuerce en una franja de la imagen. */
export function scanlineDisplace(img: Px, p: { amount: number; frequency: number; start: number; end: number; noise: number; seed: number }) {
  const { width: w, height: h } = img;
  const y0 = Math.min(p.start, p.end) / 100 * h, y1 = Math.max(p.start, p.end) / 100 * h;
  const fade = Math.max(1, (y1 - y0) * 0.15);
  const nz = clamp01(p.noise / 100);
  const freq = Math.max(0.1, p.frequency);
  remap(img, (x, y, o) => {
    const inside = smooth(y0 - fade, y0 + fade, y) * (1 - smooth(y1 - fade, y1 + fade, y));
    const s = (Math.sin((y / h) * freq * Math.PI * 2) * (1 - nz) + (hash3(0, y, p.seed) * 2 - 1) * nz) * p.amount * inside;
    o[0] = x - s; o[1] = y;
  });
}

/** Artefactos de compresión (estilo datamosh): bloques arrastrados y croma cuantizado por bloques. */
export function datamosh(img: Px, p: { block: number; amount: number; smear: number; angle: number; quantize: number; seed: number }) {
  const { width: w, height: h, data: d } = img;
  const B = Math.max(2, Math.round(p.block));
  const src = new Uint8ClampedArray(d);
  const R = rng(p.seed * 11 + 3);
  const cols = Math.ceil(w / B), rows = Math.ceil(h / B);
  const ca = Math.cos(p.angle * DEG), sa = -Math.sin(p.angle * DEG);
  const q = Math.max(1, Math.round(p.quantize));
  for (let by = 0; by < rows; by++) for (let bx = 0; bx < cols; bx++) {
    const roll = R();
    const smearIt = roll * 100 < p.amount;
    const quant = q > 1 && R() * 100 < p.amount * 1.5;
    if (!smearIt && !quant) continue;
    // vector de movimiento «equivocado»: el bloque se rellena con lo que había más atrás
    const dist = smearIt ? p.smear * (0.3 + R() * 0.7) : 0;
    let mr = 0, mg = 0, mb = 0, cnt = 0;
    if (quant) for (let y = by * B; y < Math.min(h, by * B + B); y++) for (let x = bx * B; x < Math.min(w, bx * B + B); x++) { const i = (y * w + x) * 4; mr += src[i]; mg += src[i + 1]; mb += src[i + 2]; cnt++; }
    if (cnt) { mr /= cnt; mg /= cnt; mb /= cnt; }
    for (let y = by * B; y < Math.min(h, by * B + B); y++) for (let x = bx * B; x < Math.min(w, bx * B + B); x++) {
      const i = (y * w + x) * 4;
      let r = src[i], g = src[i + 1], b = src[i + 2], a = src[i + 3];
      if (smearIt) {
        const sx = clamp(Math.round(x - ca * dist), 0, w - 1), sy = clamp(Math.round(y - sa * dist), 0, h - 1);
        const j = (sy * w + sx) * 4; r = src[j]; g = src[j + 1]; b = src[j + 2]; a = Math.max(a, src[j + 3]);
      }
      if (quant && cnt) {
        // conserva el brillo del píxel y aplana el color del bloque, cuantizado
        const l = luma(r, g, b), ml = luma(mr, mg, mb);
        const step = 256 / (q + 1);
        r = Math.round((l + (mr - ml)) / step) * step; g = Math.round((l + (mg - ml)) / step) * step; b = Math.round((l + (mb - ml)) / step) * step;
      }
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
    }
  }
}

/** Interferencia de señal: bandas de brillo, líneas de ruido y un leve tirón horizontal. */
export function signalInterference(img: Px, p: { amount: number; bands: number; frequency: number; noise: number; roll: number; shift: number; seed: number }) {
  const { width: w, height: h, data: d } = img;
  const src = new Uint8ClampedArray(d);
  const amt = clamp01(p.amount / 100), nz = clamp01(p.noise / 100);
  const freq = Math.max(1, p.frequency);
  for (let y = 0; y < h; y++) {
    const t = y / h;
    const band = Math.sin((t * p.bands + p.roll / 100) * Math.PI * 2) * 0.5 + 0.5;
    const fine = Math.sin(t * freq * Math.PI * 2) * 0.5 + 0.5;
    const lineNoise = hash3(1, y, p.seed);
    const sh = Math.round((lineNoise - 0.5) * 2 * p.shift * band * amt);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const j = (y * w + clamp(x - sh, 0, w - 1)) * 4;
      const n = (hash3(x, y, p.seed + 9) - 0.5) * 255 * nz * band;
      const k = 1 + amt * (band * 0.35 - 0.15 + fine * 0.12);
      d[i] = clamp(src[j] * k + n); d[i + 1] = clamp(src[j + 1] * k + n); d[i + 2] = clamp(src[j + 2] * k + n);
      d[i + 3] = src[j + 3];
    }
  }
}

/** Eco de contornos: los bordes se repiten desplazados y cada copia se apaga un poco más. */
export function edgeEcho(img: Px, p: { copies: number; distance: number; angle: number; decay: number; color: string; useColor: boolean; threshold: number }) {
  const { width: w, height: h, data: d } = img;
  const L = lumaPlane(img);
  const E = sobel(L, w, h);
  const th = clamp01(p.threshold / 100);
  for (let j = 0; j < E.length; j++) E[j] = smooth(th, Math.min(1, th + 0.25), E[j]) * (d[j * 4 + 3] / 255);
  const n = Math.max(1, Math.round(p.copies));
  const dx = Math.cos(p.angle * DEG) * p.distance, dy = -Math.sin(p.angle * DEG) * p.distance;
  const hex = String(p.color || '#ffffff').replace('#', '');
  const cr = parseInt(hex.slice(0, 2), 16) || 0, cg = parseInt(hex.slice(2, 4), 16) || 0, cb = parseInt(hex.slice(4, 6), 16) || 0;
  const src = new Uint8ClampedArray(d);
  const dec = clamp01(p.decay / 100);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    let lr = 0, lg = 0, lb = 0;
    for (let k = 1; k <= n; k++) {
      const e = sample(E, w, h, x - dx * k, y - dy * k);
      if (e <= 0.01) continue;
      const f = e * Math.pow(1 - dec, k - 1);
      if (p.useColor) { lr += cr * f; lg += cg * f; lb += cb * f; }
      else { const si = (clamp(Math.round(y - dy * k), 0, h - 1) * w + clamp(Math.round(x - dx * k), 0, w - 1)) * 4; lr += src[si] * f; lg += src[si + 1] * f; lb += src[si + 2] * f; }
    }
    if (!lr && !lg && !lb) continue;
    const a = d[i + 3] / 255;
    d[i] = clamp(d[i] * a + lr); d[i + 1] = clamp(d[i + 1] * a + lg); d[i + 2] = clamp(d[i + 2] * a + lb);
    d[i + 3] = Math.max(d[i + 3], clamp(Math.max(lr, lg, lb)));
  }
}

/** Pixelado: promedio por celda (o el píxel central). */
export function pixelate(img: Px, p: { size: number; mode: 'average' | 'nearest' }) {
  const { width: w, height: h, data: d } = img;
  const S = Math.max(1, Math.round(p.size));
  if (S <= 1) return;
  for (let by = 0; by < h; by += S) for (let bx = 0; bx < w; bx += S) {
    const x1 = Math.min(w, bx + S), y1 = Math.min(h, by + S);
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    if (p.mode === 'nearest') {
      const i = (Math.min(h - 1, by + (S >> 1)) * w + Math.min(w - 1, bx + (S >> 1))) * 4;
      r = d[i]; g = d[i + 1]; b = d[i + 2]; a = d[i + 3]; n = 1;
    } else {
      for (let y = by; y < y1; y++) for (let x = bx; x < x1; x++) { const i = (y * w + x) * 4; const k = d[i + 3]; r += d[i] * k; g += d[i + 1] * k; b += d[i + 2] * k; a += k; n++; }
      if (a > 0) { r /= a; g /= a; b /= a; } a /= n; n = 1;
    }
    for (let y = by; y < y1; y++) for (let x = bx; x < x1; x++) { const i = (y * w + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a; }
  }
}

export { gauss3 };
