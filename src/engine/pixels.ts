// Procesamiento de píxeles puro (sin DOM). Se usa desde el hilo principal y desde el worker.
// Todas las funciones operan in-place sobre un buffer RGBA (Uint8ClampedArray).

export interface Px { data: Uint8ClampedArray; width: number; height: number }

const c255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

export function applyLut(img: Px, lr: Uint8Array, lg = lr, lb = lr) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lr[d[i]]; d[i + 1] = lg[d[i + 1]]; d[i + 2] = lb[d[i + 2]];
  }
}
function lutFrom(fn: (v: number) => number) {
  const l = new Uint8Array(256);
  for (let i = 0; i < 256; i++) l[i] = c255(Math.round(fn(i)));
  return l;
}

// ---------- Ajustes de punto ----------
export function brightnessContrast(img: Px, p: { brightness: number; contrast: number }) {
  const c = p.contrast * 2.55;
  const f = (259 * (c + 255)) / (255 * (259 - c));
  applyLut(img, lutFrom(v => f * (v + p.brightness - 128) + 128));
}

export function exposure(img: Px, p: { exposure: number; offset: number; gamma: number }) {
  const k = Math.pow(2, p.exposure);
  // trabajamos en luz lineal aproximada (sRGB gamma 2.2)
  applyLut(img, lutFrom(v => {
    let lin = Math.pow(v / 255, 2.2) * k + p.offset;
    lin = Math.max(0, lin);
    let out = Math.pow(lin, 1 / 2.2);
    out = Math.pow(Math.min(1, out), 1 / Math.max(0.01, p.gamma));
    return out * 255;
  }));
}

export function levelsLut(p: { inBlack: number; inWhite: number; gamma: number; outBlack: number; outWhite: number }) {
  const ib = p.inBlack, iw = Math.max(ib + 1, p.inWhite);
  return lutFrom(v => {
    let t = (v - ib) / (iw - ib);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    t = Math.pow(t, 1 / Math.max(0.01, p.gamma));
    return p.outBlack + t * (p.outWhite - p.outBlack);
  });
}
export function levels(img: Px, p: any) {
  const id = lutFrom(v => v);
  const master = levelsLut(p);
  const ch = p.channel || 'rgb';
  if (ch === 'rgb') applyLut(img, master);
  else applyLut(img, ch === 'r' ? master : id, ch === 'g' ? master : id, ch === 'b' ? master : id);
}

/** Spline cúbica monótona (Fritsch–Carlson) para curvas. */
export function curveLut(points: [number, number][]): Uint8Array {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) return lutFrom(v => v);
  const n = pts.length;
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const dx: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = xs[i + 1] - xs[i] || 1e-6; m[i] = (ys[i + 1] - ys[i]) / dx[i]; }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  t[n - 1] = m[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  return lutFrom(v => {
    if (v <= xs[0]) return ys[0];
    if (v >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && v > xs[i + 1]) i++;
    const h = dx[i], u = (v - xs[i]) / h;
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u;
    const h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
    return h00 * ys[i] + h10 * h * t[i] + h01 * ys[i + 1] + h11 * h * t[i + 1];
  });
}
export function curves(img: Px, p: { rgb: [number, number][]; r?: [number, number][]; g?: [number, number][]; b?: [number, number][] }) {
  const master = curveLut(p.rgb);
  const lr = p.r ? curveLut(p.r) : null, lg = p.g ? curveLut(p.g) : null, lb = p.b ? curveLut(p.b) : null;
  const R = new Uint8Array(256), G = new Uint8Array(256), B = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    R[i] = lr ? lr[master[i]] : master[i];
    G[i] = lg ? lg[master[i]] : master[i];
    B[i] = lb ? lb[master[i]] : master[i];
  }
  applyLut(img, R, G, B);
}

export function invert(img: Px) { applyLut(img, lutFrom(v => 255 - v)); }

export function threshold(img: Px, p: { level: number }) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = l >= p.level ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
}

export function posterize(img: Px, p: { levels: number }) {
  const n = Math.max(2, Math.round(p.levels));
  applyLut(img, lutFrom(v => Math.round(Math.round((v / 255) * (n - 1)) * (255 / (n - 1)))));
}

export function blackWhite(img: Px, p: { r?: number; g?: number; b?: number; tint?: string | null }) {
  const wr = p.r ?? 0.299, wg = p.g ?? 0.587, wb = p.b ?? 0.114;
  const sum = wr + wg + wb || 1;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = (wr * d[i] + wg * d[i + 1] + wb * d[i + 2]) / sum;
    d[i] = d[i + 1] = d[i + 2] = l;
  }
}

// HSL helpers
function rgb2hsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function hue2rgb(p: number, q: number, t: number) {
  if (t < 0) t += 1; if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255];
}

export function hueSaturation(img: Px, p: { hue: number; saturation: number; lightness: number; colorize?: boolean }) {
  const d = img.data;
  const dh = p.hue / 360, ds = p.saturation / 100, dl = p.lightness / 100;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    let [h, s, l] = rgb2hsl(d[i], d[i + 1], d[i + 2]);
    if (p.colorize) { h = (p.hue < 0 ? p.hue + 360 : p.hue) / 360; s = Math.max(0, Math.min(1, 0.25 + ds * 0.75)); }
    else {
      h = (h + dh) % 1; if (h < 0) h += 1;
      s = ds > 0 ? s + (1 - s) * ds * s ** 0.2 : s * (1 + ds);
      s = s < 0 ? 0 : s > 1 ? 1 : s;
    }
    l = dl > 0 ? l + (1 - l) * dl : l * (1 + dl);
    const [r, g, b] = hsl2rgb(h, s, l);
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
}

export function vibrance(img: Px, p: { vibrance: number; saturation: number }) {
  const d = img.data;
  const v = p.vibrance / 100, s = p.saturation / 100;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const mx = Math.max(r, g, b), avg = (r + g + b) / 3;
    const sat = (mx - Math.min(r, g, b)) / 255;
    const amt = s + v * (1 - sat);
    d[i] = c255(r + (r - avg) * amt);
    d[i + 1] = c255(g + (g - avg) * amt);
    d[i + 2] = c255(b + (b - avg) * amt);
  }
}

// ---------- Filtros espaciales ----------
/** Desenfoque de caja separable sobre un canal Float32 (in-place). */
function boxBlurChannel(src: Float32Array, w: number, h: number, r: number) {
  if (r < 1) return;
  const tmp = new Float32Array(src.length);
  const iarr = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = src[row] * (r + 1);
    for (let k = 0; k < r; k++) acc += src[row + Math.min(k, w - 1)];
    for (let x = 0; x < w; x++) {
      acc += src[row + Math.min(x + r, w - 1)] - src[row + Math.max(x - r - 1, 0)];
      tmp[row + x] = acc * iarr;
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = tmp[x] * (r + 1);
    for (let k = 0; k < r; k++) acc += tmp[Math.min(k, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      acc += tmp[Math.min(y + r, h - 1) * w + x] - tmp[Math.max(y - r - 1, 0) * w + x];
      src[y * w + x] = acc * iarr;
    }
  }
}
function gaussBoxes(sigma: number, n = 3) {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const sizes: number[] = [];
  for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
  return sizes.map(s => (s - 1) / 2);
}
export function blurFloat(ch: Float32Array, w: number, h: number, radius: number) {
  if (radius <= 0) return;
  for (const r of gaussBoxes(radius / 2)) boxBlurChannel(ch, w, h, Math.round(r));
}

/** Desenfoque gaussiano (aprox. 3 cajas) con alfa premultiplicado para evitar halos. */
export function gaussianBlur(img: Px, p: { radius: number }) {
  const { width: w, height: h, data: d } = img;
  const n = w * h;
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), A = new Float32Array(n);
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    const a = d[i + 3] / 255;
    R[j] = d[i] * a; G[j] = d[i + 1] * a; B[j] = d[i + 2] * a; A[j] = d[i + 3];
  }
  for (const ch of [R, G, B, A]) blurFloat(ch, w, h, p.radius);
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    const a = A[j] / 255;
    if (a > 0.0001) { d[i] = R[j] / a; d[i + 1] = G[j] / a; d[i + 2] = B[j] / a; }
    d[i + 3] = A[j];
  }
}

export function unsharpMask(img: Px, p: { amount: number; radius: number; threshold: number }) {
  const { width: w, height: h, data: d } = img;
  const n = w * h;
  const L = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let j = 0; j < n; j++) { L[0][j] = d[j * 4]; L[1][j] = d[j * 4 + 1]; L[2][j] = d[j * 4 + 2]; }
  for (const ch of L) blurFloat(ch, w, h, p.radius);
  const amt = p.amount / 100;
  for (let j = 0; j < n; j++) {
    for (let c = 0; c < 3; c++) {
      const o = d[j * 4 + c];
      const diff = o - L[c][j];
      if (Math.abs(diff) >= p.threshold) d[j * 4 + c] = c255(o + diff * amt);
    }
  }
}

/** Reducción de ruido: mediana por canal (radio 1–3) mezclada con el original según intensidad. */
export function denoise(img: Px, p: { radius: number; strength: number }) {
  const { width: w, height: h, data: d } = img;
  const r = Math.max(1, Math.min(3, Math.round(p.radius)));
  const src = new Uint8ClampedArray(d);
  const size = (2 * r + 1) ** 2;
  const hist = new Uint16Array(256);
  const half = size >> 1;
  const k = (p.strength ?? 100) / 100;
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < h; y++) {
      hist.fill(0);
      // ventana inicial
      for (let dy = -r; dy <= r; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -r; dx <= r; dx++) {
          const xx = Math.min(w - 1, Math.max(0, dx));
          hist[src[(yy * w + xx) * 4 + c]]++;
        }
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
        for (; m < 256; m++) { cnt += hist[m]; if (cnt > half) break; }
        const i = (y * w + x) * 4 + c;
        d[i] = src[i] + (m - src[i]) * k;
      }
    }
  }
}

// ---------- Pipeline ----------
export function runAdjustment(img: Px, type: string, params: any) {
  switch (type) {
    case 'brightnessContrast': return brightnessContrast(img, params);
    case 'hueSaturation': return hueSaturation(img, params);
    case 'exposure': return exposure(img, params);
    case 'levels': return levels(img, params);
    case 'curves': return curves(img, params);
    case 'blackWhite': return blackWhite(img, params);
    case 'invert': return invert(img);
    case 'threshold': return threshold(img, params);
    case 'posterize': return posterize(img, params);
    case 'vibrance': return vibrance(img, params);
    case 'blur': return gaussianBlur(img, params);
    case 'sharpen': return unsharpMask(img, params);
    case 'denoise': return denoise(img, params);
  }
}

export function histogram(img: Px) {
  const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), l = new Uint32Array(256);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;
    r[d[i]]++; g[d[i + 1]]++; b[d[i + 2]]++;
    l[(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0]++;
  }
  return { r, g, b, l };
}
