// Color Lab: ajustes de color por píxel (no dependen de los vecinos), por eso también se pueden
// «hornear» en una LUT .cube.

import { type Px, clamp, clamp01, luma, smooth, parseHex } from './core';

// ---------- conversión HSL ----------
function rgb2hsl(r: number, g: number, b: number, o: number[]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  o[0] = h; o[1] = s; o[2] = l;
}
function hue2(p: number, q: number, t: number) {
  if (t < 0) t += 1; if (t > 1) t -= 1;
  return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
}
function hsl2rgb(h: number, s: number, l: number, o: number[]) {
  h = (((h % 360) + 360) % 360) / 360;
  if (s <= 0) { o[0] = o[1] = o[2] = l * 255; return; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  o[0] = hue2(p, q, h + 1 / 3) * 255; o[1] = hue2(p, q, h) * 255; o[2] = hue2(p, q, h - 1 / 3) * 255;
}
/** Color de un tono (0..360) con saturación 1, para virados y ruedas. */
export function hueColor(h: number): [number, number, number] { const o = [0, 0, 0]; hsl2rgb(h, 1, 0.5, o); return [o[0] / 255, o[1] / 255, o[2] / 255]; }

// ---------- básico (como el panel Básico de un revelador) ----------
export interface BasicParams {
  exposure: number; brightness: number; contrast: number; gamma: number;
  highlights: number; shadows: number; whites: number; blacks: number;
  temperature: number; tint: number; hue: number; saturation: number; vibrance: number;
}
export function toneLut(p: Partial<BasicParams>) {
  const lut = new Float32Array(256);
  const ex = Math.pow(2, p.exposure ?? 0), br = (p.brightness ?? 0) / 100, ct = (p.contrast ?? 0) / 100, gm = Math.max(0.05, p.gamma ?? 1);
  const hi = (p.highlights ?? 0) / 100, sh = (p.shadows ?? 0) / 100, wh = (p.whites ?? 0) / 100, bk = (p.blacks ?? 0) / 100;
  for (let i = 0; i < 256; i++) {
    let v = i / 255;
    // exposición en luz lineal aproximada
    v = Math.pow(Math.min(1, Math.pow(v, 2.2) * ex), 1 / 2.2);
    // negros y blancos: mueven los extremos
    v = v + bk * 0.25 * (1 - v) ** 3 + wh * 0.25 * v ** 3;
    // sombras y luces: recuperan o hunden cada mitad sin tocar los extremos
    v = v + sh * 0.45 * v * (1 - v) * (1 - v) * 2.2 + hi * 0.45 * v * v * (1 - v) * 2.2;
    v = v + br * 0.5 * v * (1 - v) * 2;
    // contraste en S alrededor del medio
    if (ct) { const c = clamp01(v); v = c + ct * (c - 0.5) * (1 - Math.abs(c - 0.5) * 2) * 1.2 + ct * 0.15 * (c - 0.5); }
    v = Math.pow(clamp01(v), 1 / gm);
    lut[i] = clamp01(v) * 255;
  }
  return lut;
}
export function colorBasic(img: Px, p: BasicParams) {
  const d = img.data;
  const lut = toneLut(p);
  const temp = (p.temperature ?? 0) / 100, tint = (p.tint ?? 0) / 100;
  const kr = 1 + temp * 0.18 + tint * 0.06, kg = 1 - tint * 0.14, kb = 1 - temp * 0.22 + tint * 0.06;
  const sat = 1 + (p.saturation ?? 0) / 100, vib = (p.vibrance ?? 0) / 100, hue = p.hue ?? 0;
  const hsl = [0, 0, 0], o = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] * kr, g = d[i + 1] * kg, b = d[i + 2] * kb;
    // tono: por luminancia conservando el color
    const l0 = luma(r, g, b);
    const l1 = lut[clamp(Math.round(l0), 0, 255)];
    if (l0 > 0.5) { const k = l1 / l0; r *= k; g *= k; b *= k; } else { r = g = b = l1; }
    // saturación e intensidad (la intensidad protege lo ya saturado)
    const l = luma(r, g, b);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const s0 = mx ? (mx - mn) / mx : 0;
    const k = sat * (1 + vib * (1 - s0) * (vib > 0 ? 1.2 : 1));
    r = l + (r - l) * k; g = l + (g - l) * k; b = l + (b - l) * k;
    if (hue) { rgb2hsl(clamp(r), clamp(g), clamp(b), hsl); hsl2rgb(hsl[0] + hue, hsl[1], hsl[2], o); r = o[0]; g = o[1]; b = o[2]; }
    d[i] = clamp(r); d[i + 1] = clamp(g); d[i + 2] = clamp(b);
  }
}

// ---------- HSL por rangos ----------
export const HSL_RANGES = [
  { k: 'red', label: 'Rojos', h: 0 }, { k: 'orange', label: 'Naranjas', h: 30 }, { k: 'yellow', label: 'Amarillos', h: 60 },
  { k: 'green', label: 'Verdes', h: 120 }, { k: 'aqua', label: 'Aguamarinas', h: 180 }, { k: 'blue', label: 'Azules', h: 230 },
  { k: 'purple', label: 'Morados', h: 275 }, { k: 'magenta', label: 'Magentas', h: 320 },
] as const;
export function hslRanges(img: Px, p: Record<string, number>) {
  const d = img.data;
  const hsl = [0, 0, 0], o = [0, 0, 0];
  const R = HSL_RANGES.map(r => ({ h: r.h, dh: p['h_' + r.k] ?? 0, ds: (p['s_' + r.k] ?? 0) / 100, dl: (p['l_' + r.k] ?? 0) / 100 }));
  if (R.every(r => !r.dh && !r.ds && !r.dl)) return;
  for (let i = 0; i < d.length; i += 4) {
    rgb2hsl(d[i], d[i + 1], d[i + 2], hsl);
    if (hsl[1] < 0.01) continue;
    let dh = 0, ds = 0, dl = 0, wt = 0;
    for (const r of R) {
      let dist = Math.abs(hsl[0] - r.h); if (dist > 180) dist = 360 - dist;
      const wgt = dist >= 45 ? 0 : 0.5 + 0.5 * Math.cos((dist / 45) * Math.PI);
      if (!wgt) continue;
      dh += r.dh * wgt; ds += r.ds * wgt; dl += r.dl * wgt; wt += wgt;
    }
    if (!wt) continue;
    const sw = Math.min(1, hsl[1] * 3); // los grises casi no cambian
    const s = clamp01(hsl[1] * (1 + ds));
    const l = clamp01(hsl[2] + dl * 0.5 * sw * (dl > 0 ? 1 - hsl[2] : hsl[2]) * 2);
    hsl2rgb(hsl[0] + dh * sw, s, l, o);
    d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2];
  }
}

// ---------- balance de color ----------
const zone = (l: number) => ({ s: 1 - smooth(0.05, 0.55, l), h: smooth(0.45, 0.95, l), m: 1 - Math.abs(l - 0.5) * 2 });
export function colorBalance(img: Px, p: Record<string, number | boolean>) {
  const d = img.data;
  const v = (k: string) => (Number(p[k]) || 0) / 100;
  const S = [v('s_cr'), v('s_mg'), v('s_yb')], M = [v('m_cr'), v('m_mg'), v('m_yb')], H = [v('h_cr'), v('h_mg'), v('h_yb')];
  const keep = p.preserve !== false;
  for (let i = 0; i < d.length; i += 4) {
    const r0 = d[i], g0 = d[i + 1], b0 = d[i + 2];
    const l = luma(r0, g0, b0) / 255, z = zone(l);
    const cr = S[0] * z.s + M[0] * z.m + H[0] * z.h, mg = S[1] * z.s + M[1] * z.m + H[1] * z.h, yb = S[2] * z.s + M[2] * z.m + H[2] * z.h;
    let r = r0 + cr * 80 - mg * 20 - yb * 20, g = g0 + mg * 80 - cr * 20 - yb * 20, b = b0 + yb * 80 - cr * 20 - mg * 20;
    if (keep) { const l1 = luma(r, g, b), k = l1 > 0.5 ? (l * 255) / l1 : 1; r *= k; g *= k; b *= k; }
    d[i] = clamp(r); d[i + 1] = clamp(g); d[i + 2] = clamp(b);
  }
}

// ---------- virado partido ----------
export function splitToning(img: Px, p: { hHue: number; hSat: number; sHue: number; sSat: number; balance: number }) {
  const d = img.data;
  const hc = hueColor(p.hHue), sc = hueColor(p.sHue);
  const hs = clamp01(p.hSat / 100), ss = clamp01(p.sSat / 100), bal = (p.balance ?? 0) / 100;
  for (let i = 0; i < d.length; i += 4) {
    const l = luma(d[i], d[i + 1], d[i + 2]) / 255;
    const wh = smooth(0.25 - bal * 0.25, 0.85 - bal * 0.25, l) * hs, ws = (1 - smooth(0.15 - bal * 0.25, 0.75 - bal * 0.25, l)) * ss;
    for (let c = 0; c < 3; c++) {
      const v = d[i + c] / 255;
      // luz suave hacia el color de cada zona
      const softTo = (a: number, b: number) => (b <= 0.5 ? a - (1 - 2 * b) * a * (1 - a) : a + (2 * b - 1) * (Math.sqrt(a) - a));
      const th = softTo(v, hc[c]), ts = softTo(v, sc[c]);
      d[i + c] = clamp((v + (th - v) * wh + (ts - v) * ws) * 255);
    }
  }
}

// ---------- ruedas de color (elevación, gamma, ganancia) ----------
function wheelVec(hue: number, amt: number): [number, number, number] {
  const c = hueColor(hue), m = (c[0] + c[1] + c[2]) / 3;
  return [(c[0] - m) * amt, (c[1] - m) * amt, (c[2] - m) * amt];
}
export function colorWheels(img: Px, p: Record<string, number>) {
  const d = img.data;
  const lift = wheelVec(p.liftHue ?? 0, (p.liftAmt ?? 0) / 100 * 0.25), gam = wheelVec(p.gammaHue ?? 0, (p.gammaAmt ?? 0) / 100 * 0.6), gain = wheelVec(p.gainHue ?? 0, (p.gainAmt ?? 0) / 100 * 0.35);
  const lL = (p.liftLum ?? 0) / 100 * 0.2, gL = (p.gammaLum ?? 0) / 100, gnL = (p.gainLum ?? 0) / 100 * 0.4;
  const lut: Float32Array[] = [0, 1, 2].map(c => {
    const t = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const v = i / 255;
      const g = (1 + gain[c] + gnL);
      const lf = lift[c] + lL;
      let o = (v * g) + lf * (1 - v);
      const gg = Math.max(0.1, 1 + gam[c] + gL * 0.6);
      o = Math.pow(clamp01(o), 1 / gg);
      t[i] = clamp01(o) * 255;
    }
    return t;
  });
  for (let i = 0; i < d.length; i += 4) { d[i] = lut[0][d[i]]; d[i + 1] = lut[1][d[i + 1]]; d[i + 2] = lut[2][d[i + 2]]; }
}

// ---------- color selectivo (relativo, como en las imprentas) ----------
export const SEL_RANGES = [
  { k: 'reds', label: 'Rojos' }, { k: 'yellows', label: 'Amarillos' }, { k: 'greens', label: 'Verdes' }, { k: 'cyans', label: 'Cianes' },
  { k: 'blues', label: 'Azules' }, { k: 'magentas', label: 'Magentas' }, { k: 'whites', label: 'Blancos' }, { k: 'neutrals', label: 'Neutros' }, { k: 'blacks', label: 'Negros' },
] as const;
export function selectiveColor(img: Px, p: Record<string, number | string>) {
  const d = img.data;
  const absolute = p.method === 'absolute';
  const adj = SEL_RANGES.map(r => ['c', 'm', 'y', 'k'].map(ch => (Number(p[`${r.k}_${ch}`]) || 0) / 100));
  if (adj.every(a => a.every(v => !v))) return;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), md = r + g + b - mx - mn;
    // cuánto pertenece el píxel a cada rango
    const w = new Array(9).fill(0);
    if (mx === r && mn === b) { w[0] = mx - md; w[1] = md - mn; } // rojos / amarillos
    else if (mx === r && mn === g) { w[0] = mx - md; w[5] = md - mn; }
    else if (mx === g && mn === b) { w[2] = mx - md; w[1] = md - mn; }
    else if (mx === g && mn === r) { w[2] = mx - md; w[3] = md - mn; }
    else if (mx === b && mn === r) { w[4] = mx - md; w[3] = md - mn; }
    else if (mx === b && mn === g) { w[4] = mx - md; w[5] = md - mn; }
    w[6] = Math.max(0, (mn - 0.5) * 2); w[8] = Math.max(0, (0.5 - mx) * 2); w[7] = 1 - Math.abs(mx + mn - 1);
    const out = [r, g, b];
    for (let k = 0; k < 9; k++) {
      if (!w[k]) continue;
      const [ac, am, ay, ak] = adj[k];
      if (!ac && !am && !ay && !ak) continue;
      for (let c = 0; c < 3; c++) {
        const ink = 1 - out[c]; // cian para R, magenta para G, amarillo para B
        const a = c === 0 ? ac : c === 1 ? am : ay;
        // relativo: el cambio es proporcional a la tinta que ya hay; absoluto: se suma tal cual
        const delta = (a + ak) * (absolute ? 1 : Math.max(ink, ak ? 0.25 : 0));
        out[c] = clamp01(out[c] - delta * w[k]);
      }
    }
    d[i] = out[0] * 255; d[i + 1] = out[1] * 255; d[i + 2] = out[2] * 255;
  }
}

// ---------- LUT 3D ----------
export interface Lut3D { size: number; data: Float32Array } // r más rápido, luego g, luego b; valores 0..1

/** Lee un .cube (3D o 1D). Los 3D de más de 33 puntos se remuestrean a 33 para guardarlos ligeros. */
export function parseCube(text: string): { title: string; lut: Lut3D } {
  let size = 0, size1 = 0, title = '';
  let dmin = [0, 0, 0], dmax = [1, 1, 1];
  const vals: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const up = line.toUpperCase();
    if (up.startsWith('TITLE')) { title = line.replace(/^TITLE\s*/i, '').replace(/^"|"$/g, ''); continue; }
    if (up.startsWith('LUT_3D_SIZE')) { size = parseInt(line.split(/\s+/)[1], 10); continue; }
    if (up.startsWith('LUT_1D_SIZE')) { size1 = parseInt(line.split(/\s+/)[1], 10); continue; }
    if (up.startsWith('DOMAIN_MIN')) { dmin = line.split(/\s+/).slice(1, 4).map(Number); continue; }
    if (up.startsWith('DOMAIN_MAX')) { dmax = line.split(/\s+/).slice(1, 4).map(Number); continue; }
    if (/^[A-Z_]/.test(up)) continue; // otras palabras clave
    const nums = line.split(/\s+/).map(Number);
    if (nums.length >= 3 && nums.slice(0, 3).every(isFinite)) vals.push(nums[0], nums[1], nums[2]);
  }
  const norm = (v: number, c: number) => clamp01((v - dmin[c]) / ((dmax[c] - dmin[c]) || 1));
  if (size >= 2) {
    if (vals.length < size ** 3 * 3) throw new Error(`El archivo .cube está incompleto (${vals.length / 3} de ${size ** 3} entradas).`);
    const data = new Float32Array(size ** 3 * 3);
    for (let i = 0; i < data.length; i++) data[i] = norm(vals[i], i % 3);
    const lut = { size, data };
    return { title, lut: size > 33 ? resampleLut(lut, 33) : lut };
  }
  if (size1 >= 2) {
    if (vals.length < size1 * 3) throw new Error('El archivo .cube 1D está incompleto.');
    // una LUT 1D se convierte en 3D (cada canal por separado)
    const S = 33, data = new Float32Array(S ** 3 * 3);
    const at = (c: number, t: number) => { const f = t * (size1 - 1), i0 = Math.floor(f), i1 = Math.min(size1 - 1, i0 + 1); return norm(vals[i0 * 3 + c] + (vals[i1 * 3 + c] - vals[i0 * 3 + c]) * (f - i0), c); };
    for (let b = 0; b < S; b++) for (let g = 0; g < S; g++) for (let r = 0; r < S; r++) {
      const o = ((b * S + g) * S + r) * 3;
      data[o] = at(0, r / (S - 1)); data[o + 1] = at(1, g / (S - 1)); data[o + 2] = at(2, b / (S - 1));
    }
    return { title, lut: { size: S, data } };
  }
  throw new Error('No es un archivo .cube válido (falta LUT_3D_SIZE o LUT_1D_SIZE).');
}

export function sampleLut(l: Lut3D, r: number, g: number, b: number, o: number[]) {
  const S = l.size, m = S - 1;
  const fr = clamp01(r) * m, fg = clamp01(g) * m, fb = clamp01(b) * m;
  const r0 = Math.min(m - 1, Math.floor(fr)), g0 = Math.min(m - 1, Math.floor(fg)), b0 = Math.min(m - 1, Math.floor(fb));
  const tr = fr - r0, tg = fg - g0, tb = fb - b0;
  const D = l.data;
  for (let c = 0; c < 3; c++) {
    const at = (ri: number, gi: number, bi: number) => D[((bi * S + gi) * S + ri) * 3 + c];
    const c00 = at(r0, g0, b0) * (1 - tr) + at(r0 + 1, g0, b0) * tr;
    const c10 = at(r0, g0 + 1, b0) * (1 - tr) + at(r0 + 1, g0 + 1, b0) * tr;
    const c01 = at(r0, g0, b0 + 1) * (1 - tr) + at(r0 + 1, g0, b0 + 1) * tr;
    const c11 = at(r0, g0 + 1, b0 + 1) * (1 - tr) + at(r0 + 1, g0 + 1, b0 + 1) * tr;
    o[c] = (c00 * (1 - tg) + c10 * tg) * (1 - tb) + (c01 * (1 - tg) + c11 * tg) * tb;
  }
}
export function resampleLut(l: Lut3D, S: number): Lut3D {
  const data = new Float32Array(S ** 3 * 3), o = [0, 0, 0];
  for (let b = 0; b < S; b++) for (let g = 0; g < S; g++) for (let r = 0; r < S; r++) {
    sampleLut(l, r / (S - 1), g / (S - 1), b / (S - 1), o);
    data.set(o, ((b * S + g) * S + r) * 3);
  }
  return { size: S, data };
}

/** LUT ↔ texto base64 (8 bits por valor) para guardarla en los parámetros del efecto. */
export function encodeLut(l: Lut3D): string {
  const u = new Uint8Array(l.data.length);
  for (let i = 0; i < u.length; i++) u[i] = Math.round(clamp01(l.data[i]) * 255);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
export function decodeLut(b64: string, size: number): Lut3D | null {
  try {
    const s = atob(b64);
    if (s.length !== size ** 3 * 3) return null;
    const data = new Float32Array(s.length);
    for (let i = 0; i < s.length; i++) data[i] = s.charCodeAt(i) / 255;
    return { size, data };
  } catch { return null; }
}
const lutCache = new Map<string, Lut3D | null>();
export function applyLut3D(img: Px, p: { data: string; size: number; amount: number }) {
  if (!p.data || !p.size) return;
  const key = p.size + ':' + p.data.length + ':' + p.data.slice(0, 64) + p.data.slice(-64);
  let l = lutCache.get(key);
  if (l === undefined) { l = decodeLut(p.data, p.size); lutCache.set(key, l); if (lutCache.size > 8) lutCache.delete(lutCache.keys().next().value!); }
  if (!l) return;
  const k = clamp01((p.amount ?? 100) / 100);
  const d = img.data, o = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) {
    sampleLut(l, d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, o);
    d[i] += (o[0] * 255 - d[i]) * k; d[i + 1] += (o[1] * 255 - d[i + 1]) * k; d[i + 2] += (o[2] * 255 - d[i + 2]) * k;
  }
}

/** Escribe una LUT como .cube (para usarla en otros programas). */
export function cubeText(l: Lut3D, title: string) {
  const lines = [`TITLE "${title.replace(/"/g, "'")}"`, `# Creado con KOVA Design Lab`, `LUT_3D_SIZE ${l.size}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
  for (let i = 0; i < l.data.length; i += 3) lines.push(`${l.data[i].toFixed(6)} ${l.data[i + 1].toFixed(6)} ${l.data[i + 2].toFixed(6)}`);
  return lines.join('\n') + '\n';
}

export { parseHex };
