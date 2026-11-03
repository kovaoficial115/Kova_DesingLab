// Gestión de color. Con un perfil ICC CMYK cargado se usa LittleCMS (WASM) para conversiones
// reales sRGB → CMYK y prueba en pantalla. Sin perfil, se usa la conversión por fórmula
// (engine/color.ts) y la interfaz lo indica explícitamente.

import { rgbToCmykFormula, cmykToRgbFormula, defaultCmyk, type CmykSettings } from './color';

let lcms: any = null;
let constants: any = null;
let srgb = 0;
let cmykProfile = 0;
let toCmyk = 0;
let toRgb = 0;
let lut: Uint8Array | null = null; // LUT 3D 33³ sRGB → prueba sRGB
let lutKey = '';

export const cmsState = {
  profileName: null as string | null,
  profileBytes: null as Uint8Array | null,
  intent: 1, // 0 perceptual, 1 colorimétrico relativo, 2 saturación, 3 absoluto
  bpc: true,
  formula: { ...defaultCmyk } as CmykSettings,
  listeners: new Set<() => void>(),
};
const notify = () => cmsState.listeners.forEach(f => f());

async function ensureLcms() {
  if (lcms) return lcms;
  const mod: any = await import('lcms-wasm');
  const wasmUrl = (await import('lcms-wasm/dist/lcms.wasm?url')).default;
  lcms = await mod.instantiate({ locateFile: () => wasmUrl });
  constants = mod;
  srgb = lcms.cmsCreate_sRGBProfile();
  return lcms;
}

function rebuildTransforms() {
  if (!lcms || !cmykProfile) return;
  if (toCmyk) lcms.cmsDeleteTransform(toCmyk);
  if (toRgb) lcms.cmsDeleteTransform(toRgb);
  const flags = cmsState.bpc ? constants.cmsFLAGS_BLACKPOINTCOMPENSATION : 0;
  toCmyk = lcms.cmsCreateTransform(srgb, constants.TYPE_RGB_8, cmykProfile, constants.TYPE_CMYK_8, cmsState.intent, flags);
  toRgb = lcms.cmsCreateTransform(cmykProfile, constants.TYPE_CMYK_8, srgb, constants.TYPE_RGB_8, cmsState.intent, flags);
  lut = null;
}

export async function loadIccProfile(bytes: Uint8Array, fileName: string) {
  await ensureLcms();
  const prof = lcms.cmsOpenProfileFromMem(bytes, bytes.byteLength);
  if (!prof) throw new Error('No se pudo leer el perfil ICC');
  const space = lcms.cmsGetColorSpaceASCII(prof);
  if (!String(space).toUpperCase().includes('CMYK')) { lcms.cmsCloseProfile(prof); throw new Error(`El perfil es ${space}; se necesita un perfil CMYK`); }
  if (cmykProfile) lcms.cmsCloseProfile(cmykProfile);
  cmykProfile = prof;
  const desc = lcms.cmsGetProfileInfoASCII(prof, constants.cmsInfoDescription, 'en', 'US');
  cmsState.profileName = desc || fileName;
  cmsState.profileBytes = bytes;
  rebuildTransforms();
  try { localStorage.setItem('kova.icc', JSON.stringify({ name: fileName, data: btoa(String.fromCharCode(...bytes)) })); } catch { /* perfil grande: no se guarda */ }
  notify();
}
export function unloadIccProfile() {
  if (lcms && cmykProfile) lcms.cmsCloseProfile(cmykProfile);
  cmykProfile = 0; toCmyk = 0; toRgb = 0; lut = null;
  cmsState.profileName = null; cmsState.profileBytes = null;
  try { localStorage.removeItem('kova.icc'); } catch { /* */ }
  notify();
}
export async function restoreIccProfile() {
  try {
    const raw = localStorage.getItem('kova.icc');
    if (!raw) return;
    const { name, data } = JSON.parse(raw);
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    await loadIccProfile(bytes, name);
  } catch (e) { console.warn('No se pudo restaurar el perfil ICC', e); }
}
export function setCmsOptions(o: Partial<{ intent: number; bpc: boolean; formula: CmykSettings }>) {
  Object.assign(cmsState, o);
  rebuildTransforms();
  lut = null;
  notify();
}
export const hasIcc = () => !!toCmyk;

/** RGBA → planos CMYK entrelazados (0..255 = 0..100 %). */
export function rgbaToCmyk(rgba: Uint8ClampedArray): Uint8Array {
  const n = rgba.length / 4;
  if (toCmyk) {
    const rgb = new Uint8Array(n * 3);
    for (let j = 0; j < n; j++) { rgb[j * 3] = rgba[j * 4]; rgb[j * 3 + 1] = rgba[j * 4 + 1]; rgb[j * 3 + 2] = rgba[j * 4 + 2]; }
    const CH = 1 << 20; // por bloques para no agotar memoria WASM
    const out = new Uint8Array(n * 4);
    for (let s = 0; s < n; s += CH) {
      const cnt = Math.min(CH, n - s);
      out.set(lcms.cmsDoTransform(toCmyk, rgb.subarray(s * 3, (s + cnt) * 3), cnt), s * 4);
    }
    return out;
  }
  const out = new Uint8Array(n * 4);
  for (let j = 0; j < n; j++) {
    const [c, m, y, k] = rgbToCmykFormula(rgba[j * 4], rgba[j * 4 + 1], rgba[j * 4 + 2], cmsState.formula);
    out[j * 4] = c * 255; out[j * 4 + 1] = m * 255; out[j * 4 + 2] = y * 255; out[j * 4 + 3] = k * 255;
  }
  return out;
}

export function cmykToRgbArr(cmyk: Uint8Array): Uint8Array {
  const n = cmyk.length / 4;
  if (toRgb) return lcms.cmsDoTransform(toRgb, cmyk, n);
  const out = new Uint8Array(n * 3);
  for (let j = 0; j < n; j++) {
    const [r, g, b] = cmykToRgbFormula(cmyk[j * 4] / 255, cmyk[j * 4 + 1] / 255, cmyk[j * 4 + 2] / 255, cmyk[j * 4 + 3] / 255);
    out[j * 3] = r; out[j * 3 + 1] = g; out[j * 3 + 2] = b;
  }
  return out;
}

export function rgbToCmykColor(r: number, g: number, b: number): [number, number, number, number] {
  const out = rgbaToCmyk(new Uint8ClampedArray([r, g, b, 255]));
  return [out[0] / 255, out[1] / 255, out[2] / 255, out[3] / 255];
}
export function cmykToRgbColor(c: number, m: number, y: number, k: number): [number, number, number] {
  const o = cmykToRgbArr(new Uint8Array([c * 255, m * 255, y * 255, k * 255]));
  return [o[0], o[1], o[2]];
}

const N = 33;
function ensureLut() {
  const key = `${cmsState.profileName}|${cmsState.intent}|${cmsState.bpc}|${cmsState.formula.gcr}|${cmsState.formula.tac}`;
  if (lut && key === lutKey) return lut;
  const rgba = new Uint8ClampedArray(N * N * N * 4);
  let i = 0;
  for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
    rgba[i++] = Math.round((r * 255) / (N - 1)); rgba[i++] = Math.round((g * 255) / (N - 1)); rgba[i++] = Math.round((b * 255) / (N - 1)); rgba[i++] = 255;
  }
  const back = cmykToRgbArr(rgbaToCmyk(rgba));
  lut = back;
  lutKey = key;
  return lut;
}

/** Prueba de color en pantalla (simula la salida CMYK) in-place; opcionalmente avisa de gamut. */
export function softProof(img: ImageData, gamutWarning = false) {
  const L = ensureLut();
  const d = img.data;
  const s = (N - 1) / 255;
  for (let i = 0; i < d.length; i += 4) {
    const fr = d[i] * s, fg = d[i + 1] * s, fb = d[i + 2] * s;
    const r0 = fr | 0, g0 = fg | 0, b0 = fb | 0;
    const r1 = Math.min(N - 1, r0 + 1), g1 = Math.min(N - 1, g0 + 1), b1 = Math.min(N - 1, b0 + 1);
    const tr = fr - r0, tg = fg - g0, tb = fb - b0;
    for (let c = 0; c < 3; c++) {
      const v = (r: number, g: number, b: number) => L[((b * N + g) * N + r) * 3 + c];
      const c00 = v(r0, g0, b0) * (1 - tr) + v(r1, g0, b0) * tr;
      const c10 = v(r0, g1, b0) * (1 - tr) + v(r1, g1, b0) * tr;
      const c01 = v(r0, g0, b1) * (1 - tr) + v(r1, g0, b1) * tr;
      const c11 = v(r0, g1, b1) * (1 - tr) + v(r1, g1, b1) * tr;
      const val = (c00 * (1 - tg) + c10 * tg) * (1 - tb) + (c01 * (1 - tg) + c11 * tg) * tb;
      if (gamutWarning) {
        if (Math.abs(val - d[i + c]) > 28) { d[i] = d[i + 1] = d[i + 2] = 128; break; }
      }
      d[i + c] = val;
    }
  }
}

/** Visualización de un canal individual (C, M, Y, K como tinta sobre blanco). */
export function channelView(img: ImageData, ch: 'c' | 'm' | 'y' | 'k' | 'r' | 'g' | 'b' | 'alpha') {
  const d = img.data;
  if (ch === 'r' || ch === 'g' || ch === 'b' || ch === 'alpha') {
    const o = ch === 'r' ? 0 : ch === 'g' ? 1 : ch === 'b' ? 2 : 3;
    for (let i = 0; i < d.length; i += 4) { const v = d[i + o]; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    return;
  }
  const cmyk = rgbaToCmyk(d);
  const idx = { c: 0, m: 1, y: 2, k: 3 }[ch];
  const tint = { c: [0, 174, 239], m: [236, 0, 140], y: [255, 242, 0], k: [0, 0, 0] }[ch];
  for (let j = 0, i = 0; i < d.length; i += 4, j++) {
    const v = (cmyk[j * 4 + idx] / 255) * (d[i + 3] / 255);
    d[i] = 255 + (tint[0] - 255) * v; d[i + 1] = 255 + (tint[1] - 255) * v; d[i + 2] = 255 + (tint[2] - 255) * v; d[i + 3] = 255;
  }
}

/** Cobertura total de tinta (TAC) por píxel: devuelve % de píxeles que exceden el límite. */
export function tacReport(rgba: Uint8ClampedArray, limit: number) {
  const cmyk = rgbaToCmyk(rgba);
  let over = 0, count = 0, max = 0;
  for (let j = 0; j < cmyk.length / 4; j++) {
    if (rgba[j * 4 + 3] < 16) continue;
    count++;
    const t = ((cmyk[j * 4] + cmyk[j * 4 + 1] + cmyk[j * 4 + 2] + cmyk[j * 4 + 3]) / 255) * 100;
    if (t > max) max = t;
    if (t > limit) over++;
  }
  return { overPct: count ? (over / count) * 100 : 0, max };
}
