// Biblioteca de efectos: lo que se aplica con un clic (efectos sueltos y preajustes), los preajustes
// del usuario (guardados en este equipo e importables/exportables) y las acciones sobre la pila.

import { useSyncExternalStore } from 'react';
import type { Adjustment, DocState, Layer } from '../core/types';
import { commit, live, cancelLive, finishLive, docState, activeDoc, activeArtboard, toast, set, get } from '../core/store';
import { adjustLayer } from '../core/doc';
import { newAdjustmentLayer } from '../core/adjustLayers';
import { adjustmentDefaults } from '../core/actions';
import { layerContent } from '../core/render';
import { layerSize, uid, getImageData, createCanvas, ctx2d } from '../core/util';
import { FX, FX_LIST, type FxCat, scaleParams } from '../engine/fx/registry';
import { BUILTIN_PRESETS, type FxPreset, type PresetCat, type PresetItem, PRESET_CATS } from '../engine/fx/presets';
import { parseCube, encodeLut, cubeText, type Lut3D } from '../engine/fx/color';
import { runOp } from '../engine/workerClient';
import { pickFiles } from '../io/fileOps';
import { platform } from '../platform';

export const REF_SIDE = 1080;

// ---------------- elementos de la biblioteca ----------------
export interface FxItem { key: string; type: string; label: string; cat: FxCat; desc: string; params?: Record<string, any>; classic?: boolean }

const extra: FxItem[] = [
  { key: 'gaussian', type: 'blur', label: 'Desenfoque gaussiano', cat: 'blur', desc: 'El desenfoque clásico, suave y uniforme.', classic: true },
  { key: 'tapeGrain', type: 'noise', label: 'Grano de cinta', cat: 'vhs', desc: 'Ruido analógico estirado en horizontal.', params: { kind: 'analog', amount: 16, size: 1.5, mono: false } },
  { key: 'crtBloom', type: 'bloom', label: 'Bloom CRT', cat: 'crt', desc: 'El brillo que se derrama en un tubo.', params: { threshold: 55, softness: 35, radius: 18, intensity: 55 } },
  { key: 'apertureGrille', type: 'phosphorMask', label: 'Rejilla de apertura', cat: 'crt', desc: 'Franjas verticales RGB (Trinitron).', params: { type: 'grille', size: 1.5, intensity: 40 } },
  { key: 'crtBarrel', type: 'barrel', label: 'Distorsión de barril', cat: 'crt', desc: 'El abombado del cristal.', params: { amount: 25 } },
  { key: 'chromaticFringing', type: 'chromaticAberration', label: 'Franjas cromáticas', cat: 'crt', desc: 'Bordes de color hacia las esquinas.', params: { mode: 'radial', amount: 4 } },
  { key: 'glitchPixelate', type: 'pixelate', label: 'Pixelado', cat: 'glitch', desc: 'Bloques de tamaño configurable.' },
  { key: 'glitchWave', type: 'wave', label: 'Onda', cat: 'glitch', desc: 'Distorsión senoidal.' },
  { key: 'glitchDisplace', type: 'displacement', label: 'Desplazamiento digital', cat: 'glitch', desc: 'Deformación con un mapa de desplazamiento.' },
  { key: 'digitalNoiseTex', type: 'noise', label: 'Ruido digital', cat: 'texture', desc: 'Píxeles de ruido en bloques.', params: { kind: 'digital', amount: 18, size: 2, mono: false } },
  ...(['curves', 'levels', 'exposure', 'brightnessContrast', 'hueSaturation', 'vibrance', 'gradientMap', 'colorize', 'blackWhite', 'posterize', 'threshold', 'invert'] as const)
    .map(t => ({ key: 'classic:' + t, type: t, label: adjustmentDefaults[t].label, cat: 'color' as FxCat, desc: 'Ajuste clásico.', classic: true })),
];
export const FX_ITEMS: FxItem[] = [...FX_LIST.map(d => ({ key: d.id, type: d.id, label: d.label, cat: d.cat, desc: d.desc })), ...extra];

export const labelOf = (a: Pick<Adjustment, 'type' | 'name'>) => a.name || FX[a.type]?.label || (adjustmentDefaults as any)[a.type]?.label || 'Efecto de otra versión';
export const defaultsOf = (type: string): Record<string, any> => structuredClone(FX[type]?.defaults ?? (adjustmentDefaults as any)[type]?.params ?? {});
export const isKnown = (type: string) => !!FX[type] || type in adjustmentDefaults;

// ---------------- favoritos y preajustes del usuario ----------------
const PKEY = 'kova.fx.presets', FKEY = 'kova.fx.favs';
function load<T>(k: string, def: T): T { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? def; } catch { return def; } }
let userPresets: FxPreset[] = typeof localStorage !== 'undefined' ? load<FxPreset[]>(PKEY, []).map(sanitizePreset).filter((p): p is FxPreset => !!p) : [];
let favs: string[] = typeof localStorage !== 'undefined' ? load<string[]>(FKEY, []) : [];
const subs = new Set<() => void>();
let snap = { presets: [...BUILTIN_PRESETS, ...userPresets], user: userPresets, favs };
function emit() { snap = { presets: [...BUILTIN_PRESETS, ...userPresets], user: userPresets, favs }; subs.forEach(f => f()); }
function persist() {
  try { localStorage.setItem(PKEY, JSON.stringify(userPresets)); localStorage.setItem(FKEY, JSON.stringify(favs)); }
  catch { toast('No queda espacio en este equipo para guardar los preajustes (las LUT ocupan mucho).', 'error'); }
}
export function useFxLibrary() { return useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f); }; }, () => snap); }
export const allPresets = () => snap.presets;

export function toggleFav(key: string) {
  favs = favs.includes(key) ? favs.filter(k => k !== key) : [...favs, key];
  persist(); emit();
}

function sanitizePreset(p: any): FxPreset | null {
  if (!p || typeof p !== 'object' || !Array.isArray(p.items)) return null;
  const items: PresetItem[] = p.items
    .filter((it: any) => it && typeof it.type === 'string' && it.params && typeof it.params === 'object')
    .map((it: any) => ({
      type: it.type, params: JSON.parse(JSON.stringify(it.params)),
      ...(typeof it.opacity === 'number' ? { opacity: Math.max(0, Math.min(100, it.opacity)) } : {}),
      ...(typeof it.blend === 'string' ? { blend: it.blend } : {}),
      ...(it.enabled === false ? { enabled: false } : {}),
      ...(typeof it.name === 'string' ? { name: it.name.slice(0, 80) } : {}),
    }));
  if (!items.length) return null;
  const cat = PRESET_CATS.some(c => c.id === p.cat) ? p.cat : 'custom';
  return { id: typeof p.id === 'string' && !p.id.startsWith('kova:') ? p.id : uid('fxp'), name: String(p.name || 'Preajuste').slice(0, 80), cat, desc: typeof p.desc === 'string' ? p.desc.slice(0, 300) : undefined, items, ref: typeof p.ref === 'number' && p.ref > 0 ? p.ref : REF_SIDE };
}

export function savePreset(p: FxPreset) {
  userPresets = userPresets.some(x => x.id === p.id) ? userPresets.map(x => (x.id === p.id ? p : x)) : [...userPresets, p];
  persist(); emit();
}
export function renamePreset(id: string, name: string) { const p = userPresets.find(x => x.id === id); if (p) savePreset({ ...p, name: name.trim() || p.name }); }
export function deletePreset(id: string) { userPresets = userPresets.filter(x => x.id !== id); favs = favs.filter(k => k !== 'preset:' + id); persist(); emit(); }
export function duplicatePreset(p: FxPreset) { const c: FxPreset = { ...structuredClone({ ...p, builtin: undefined }), id: uid('fxp'), name: `${p.name} (copia)`, cat: p.builtin ? 'custom' : p.cat }; delete c.builtin; savePreset(c); return c; }

// ---------------- resolución ----------------
/** Lado corto del contenido que procesan los efectos de la capa. */
function contentSide(l: Layer) {
  const c = layerContent(l);
  if (c) return Math.min(c.width, c.height);
  const s = layerSize(l);
  return Math.min(s.w, s.h) || REF_SIDE;
}
/** Factor para pasar valores pensados a 1080 px a la resolución de esta capa. */
export const refScale = (l: Layer, ref = REF_SIDE) => Math.max(0.2, Math.min(8, contentSide(l) / ref));

// ---------------- aplicar ----------------
const targets = (s: DocState) => s.layers.filter(l => s.selectedLayerIds.includes(l.id) && l.kind !== 'group');
function needLayers(): Layer[] | null {
  const s = docState();
  if (!s) return null;
  const ls = targets(s);
  if (!ls.length) { toast('Selecciona una o más capas (no grupos) para aplicar efectos', 'warn'); return null; }
  return ls;
}
function openStack(layerId: string, adjId: string) {
  set(st => ({ fxFocus: { layerId, adjId }, panels: st.panels.map(p => (p.id === 'adjustments' ? { ...p, visible: true, collapsed: false } : p)) }));
}
function itemsFor(l: Layer, items: PresetItem[], ref: number): Adjustment[] {
  const k = refScale(l, ref);
  return items.map(it => ({
    id: uid('adj'), type: it.type, enabled: it.enabled !== false,
    params: scaleParams(it.type, { ...defaultsOf(it.type), ...structuredClone(it.params) }, k),
    ...(typeof it.opacity === 'number' && it.opacity < 100 ? { opacity: it.opacity } : {}),
    ...(it.blend && it.blend !== 'normal' ? { blend: it.blend } : {}),
    ...(it.name ? { name: it.name } : {}),
  }));
}

/** Añade un efecto (con sus valores por defecto, ajustados a la resolución) a las capas seleccionadas. */
export function addEffect(item: Pick<FxItem, 'type' | 'label' | 'params'>) {
  const ls = needLayers();
  if (!ls) return;
  const added = new Map<string, Adjustment[]>();
  for (const l of ls) added.set(l.id, itemsFor(l, [{ type: item.type, params: item.params ?? {} }], REF_SIDE));
  commit(`Efecto: ${item.label}`, s => ({ ...s, layers: s.layers.map(l => (added.has(l.id) ? { ...l, adjustments: [...l.adjustments, ...added.get(l.id)!] } : l)) }));
  const last = ls[ls.length - 1];
  openStack(last.id, added.get(last.id)![0].id);
}

/** Aplica un preajuste: sus efectos se añaden a la pila (o la reemplazan). */
export function applyPreset(p: FxPreset, mode: 'append' | 'replace' = 'append', preview = false) {
  const s = docState();
  if (!s) return;
  const ls = targets(s);
  if (!ls.length) { if (!preview) toast('Selecciona una o más capas para aplicar el preajuste', 'warn'); return; }
  const fn = (st: DocState) => ({ ...st, layers: st.layers.map(l => {
    if (!ls.some(x => x.id === l.id)) return l;
    const items = itemsFor(l, p.items, p.ref ?? REF_SIDE);
    return { ...l, adjustments: mode === 'replace' ? items : [...l.adjustments, ...items] };
  }) });
  if (preview) { live(fn); return; }
  commit(`Preajuste: ${p.name}`, fn);
  const l = docState()!.layers.find(x => x.id === ls[ls.length - 1].id);
  const first = l?.adjustments[mode === 'replace' ? 0 : l.adjustments.length - p.items.length];
  if (l && first) openStack(l.id, first.id);
  toast(`«${p.name}»: ${p.items.length} efecto${p.items.length === 1 ? '' : 's'} editable${p.items.length === 1 ? '' : 's'} en Ajustes`, 'ok');
}

/** Crea una capa de ajuste (encima de la capa activa; con la selección como máscara) con un
 *  preajuste o un efecto: así actúan sobre todo lo de debajo sin tocar ninguna capa. */
export function applyAsAdjustmentLayer(src: { preset: FxPreset } | { item: Pick<FxItem, 'type' | 'label' | 'params'> }) {
  const ab = activeArtboard();
  if (!ab) return;
  const probe = adjustLayer(ab.w, ab.h, ab.x, ab.y);
  const adjustments = 'preset' in src
    ? itemsFor(probe, src.preset.items, src.preset.ref ?? REF_SIDE)
    : itemsFor(probe, [{ type: src.item.type, params: src.item.params ?? {} }], REF_SIDE);
  const name = 'preset' in src ? src.preset.name : src.item.label;
  const l = newAdjustmentLayer({ quiet: true, name, adjustments });
  if (l && adjustments[0]) openStack(l.id, adjustments[0].id);
  if (l) toast(`Capa de ajuste «${name}»: actúa sobre lo de debajo${l.mask ? ' (solo en la selección)' : ''}`, 'ok');
}

// vista previa al pasar el ratón: un cambio en vivo que se descarta al salir
let previewing = false;
export function previewPreset(p: FxPreset | null, mode: 'append' | 'replace' = 'append') {
  const id = get().activeDocId;
  if (!id) return;
  if (previewing) { cancelLive(id); previewing = false; }
  if (p && !get().peekOriginal) { applyPreset(p, mode, true); previewing = true; }
}
export function endPreview() { if (previewing) { const id = get().activeDocId; if (id) cancelLive(id); previewing = false; } }
export function commitPreviewAs(p: FxPreset, mode: 'append' | 'replace' = 'append') { endPreview(); applyPreset(p, mode); }

/** Guarda la pila de la capa como preajuste propio (los px se guardan a la escala de referencia). */
export function presetFromLayer(l: Layer, name: string, cat: PresetCat = 'custom'): FxPreset | null {
  if (!l.adjustments.length) { toast('La capa no tiene efectos que guardar', 'warn'); return null; }
  const k = 1 / refScale(l);
  return {
    id: uid('fxp'), name: name.trim() || 'Mi preajuste', cat, ref: REF_SIDE,
    items: l.adjustments.map(a => ({
      type: a.type, params: scaleParams(a.type, structuredClone(a.params), k),
      ...(typeof a.opacity === 'number' ? { opacity: a.opacity } : {}), ...(a.blend ? { blend: a.blend } : {}),
      ...(a.enabled ? {} : { enabled: false }), ...(a.name ? { name: a.name } : {}),
    })),
  };
}

// ---------------- importar / exportar ----------------
const FORMAT = 'kova-fx-presets';
export function exportPresets(list: FxPreset[]) {
  const json = JSON.stringify({ format: FORMAT, version: 1, app: 'KOVA Design Lab', presets: list.map(p => ({ ...p, builtin: undefined })) }, null, 1);
  const name = list.length === 1 ? list[0].name : 'preajustes';
  return platform.saveFile(new Blob([json], { type: 'application/json' }), { suggestedName: `${name.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/gi, '-')}.kova-efectos.json` });
}
/** Lee un archivo de preajustes; los tipos de efecto que esta versión no conoce se descartan. */
export function parsePresetFile(text: string): { presets: FxPreset[]; skipped: number } {
  let data: any;
  try { data = JSON.parse(text); } catch { throw new Error('El archivo no es JSON válido.'); }
  const raw = data?.format === FORMAT && Array.isArray(data.presets) ? data.presets : data?.items ? [data] : null;
  if (!raw) throw new Error('No es un archivo de preajustes de KOVA.');
  let skipped = 0;
  const presets = raw.map((p: any) => {
    const s = sanitizePreset({ ...p, id: undefined });
    if (!s) { skipped++; return null; }
    const known = s.items.filter(it => isKnown(it.type));
    skipped += s.items.length - known.length;
    return known.length ? { ...s, items: known } : null;
  }).filter(Boolean) as FxPreset[];
  return { presets, skipped };
}
export async function importPresets() {
  const [f] = await pickFiles(false, '.json,application/json');
  if (!f) return;
  try {
    const { presets, skipped } = parsePresetFile(await f.text());
    if (!presets.length) { toast('El archivo no contiene preajustes que esta versión pueda usar', 'warn'); return; }
    presets.forEach(savePreset);
    toast(`${presets.length} preajuste${presets.length === 1 ? '' : 's'} importado${presets.length === 1 ? '' : 's'}${skipped ? ` (${skipped} efecto${skipped === 1 ? '' : 's'} desconocido${skipped === 1 ? '' : 's'} omitido${skipped === 1 ? '' : 's'})` : ''}`, 'ok');
  } catch (e: any) { toast(e.message || String(e), 'error'); }
}

// ---------------- LUT ----------------
/** Importa una LUT .cube y la añade como efecto a las capas seleccionadas. */
export async function importLut() {
  if (!needLayers()) return;
  const [f] = await pickFiles(false, '.cube');
  if (!f) return;
  try {
    const { title, lut } = parseCube(await f.text());
    const name = title || f.name.replace(/\.cube$/i, '');
    addEffect({ type: 'lut', label: `LUT ${name}`, params: { name, size: lut.size, data: encodeLut(lut), amount: 100 } });
    toast(`LUT «${name}» aplicada (${lut.size}³). Ajusta su intensidad en Ajustes.`, 'ok');
  } catch (e: any) { toast(e.message || String(e), 'error'); }
}

/** Hornea los ajustes de color (por píxel) de la capa en una LUT .cube de 33 puntos. */
export async function exportColorAsCube(l: Layer, name: string) {
  const point = l.adjustments.filter(a => a.enabled && (FX[a.type]?.point || ['brightnessContrast', 'hueSaturation', 'exposure', 'levels', 'curves', 'blackWhite', 'invert', 'threshold', 'posterize', 'vibrance', 'colorize', 'gradientMap'].includes(a.type)));
  if (!point.length) { toast('La capa no tiene ajustes de color que se puedan convertir en LUT', 'warn'); return; }
  const skipped = l.adjustments.filter(a => a.enabled).length - point.length;
  const S = 33, n = S ** 3;
  const W = 33 * 33, H = 33;
  const c = createCanvas(W, H);
  const img = ctx2d(c).createImageData(W, H);
  for (let i = 0; i < n; i++) {
    const r = i % S, g = Math.floor(i / S) % S, b = Math.floor(i / (S * S));
    const o = i * 4;
    img.data[o] = Math.round((r / (S - 1)) * 255); img.data[o + 1] = Math.round((g / (S - 1)) * 255); img.data[o + 2] = Math.round((b / (S - 1)) * 255); img.data[o + 3] = 255;
  }
  const res = await runOp('adjust', img, { adjustments: point.map(a => ({ type: a.type, params: a.params, opacity: a.opacity, blend: a.blend })) });
  const out = res.image!.data;
  const lut: Lut3D = { size: S, data: new Float32Array(n * 3) };
  for (let i = 0; i < n; i++) { lut.data[i * 3] = out[i * 4] / 255; lut.data[i * 3 + 1] = out[i * 4 + 1] / 255; lut.data[i * 3 + 2] = out[i * 4 + 2] / 255; }
  await platform.saveFile(new Blob([cubeText(lut, name)], { type: 'text/plain' }), { suggestedName: `${name.replace(/[^\w\-áéíóúñ ]+/gi, '').trim() || 'color'}.cube` });
  if (skipped) toast(`Se omitieron ${skipped} efecto${skipped === 1 ? '' : 's'} que no son de color (desenfoques, ruido…): una LUT solo guarda color`, 'info');
  void getImageData;
}

// ---------------- operaciones en la pila ----------------
const mapAdj = (layerId: string, fn: (list: Adjustment[]) => Adjustment[]) => (s: DocState) => ({ ...s, layers: s.layers.map(l => (l.id === layerId ? { ...l, adjustments: fn(l.adjustments) } : l)) });

export function duplicateAdj(layerId: string, adjId: string) {
  const copyId = uid('adj');
  commit('Duplicar efecto', mapAdj(layerId, list => list.flatMap(a => (a.id === adjId ? [a, { ...structuredClone(a), id: copyId }] : [a]))));
  set({ fxFocus: { layerId, adjId: copyId } });
}
export function resetAdj(layer: Layer, adjId: string) {
  const a = layer.adjustments.find(x => x.id === adjId);
  if (!a) return;
  const params = FX[a.type] ? scaleParams(a.type, defaultsOf(a.type), refScale(layer)) : defaultsOf(a.type);
  // las LUT conservan su tabla: solo vuelve la intensidad
  const keep = a.type === 'lut' ? { name: a.params.name, size: a.params.size, data: a.params.data } : {};
  commit('Restablecer efecto', mapAdj(layer.id, list => list.map(x => (x.id === adjId ? { ...x, params: { ...params, ...keep }, opacity: undefined, blend: undefined } : x))));
}
export function moveAdj(layerId: string, from: number, to: number) {
  commit('Reordenar efectos', mapAdj(layerId, list => {
    const arr = [...list];
    const [it] = arr.splice(from, 1);
    arr.splice(Math.max(0, Math.min(arr.length, to)), 0, it);
    return arr;
  }));
}
export function setAdjProps(layerId: string, adjId: string, patch: Partial<Pick<Adjustment, 'opacity' | 'blend' | 'name'>>, isLive = false) {
  const fn = mapAdj(layerId, list => list.map(a => (a.id === adjId ? { ...a, ...patch } : a)));
  if (isLive) live(fn); else commit('Editar efecto', fn);
}
export function setAdjParams(layerId: string, adjId: string, params: Record<string, any>, isLive = false) {
  const fn = mapAdj(layerId, list => list.map(a => (a.id === adjId ? { ...a, params: { ...a.params, ...params } } : a)));
  if (isLive) live(fn); else commit('Editar efecto', fn);
}
export const finishAdjLive = () => finishLive('Editar efecto');
export function clearStack(layerId: string) { commit('Quitar todos los efectos', mapAdj(layerId, () => [])); }

// ---------------- miniaturas de preajustes ----------------
const thumbCache = new Map<string, string>();
/** Miniatura del preajuste sobre una muestra de la capa (o una imagen de prueba). */
export async function presetThumb(p: FxPreset, src: HTMLCanvasElement | null, srcKey: string, size = 112): Promise<string> {
  const key = `${srcKey}|${p.id}|${JSON.stringify(p.items).length}`;
  const hit = thumbCache.get(key);
  if (hit) return hit;
  const base = src ?? sampleImage(size);
  const k = Math.min(1, size / Math.max(base.width, base.height));
  const w = Math.max(1, Math.round(base.width * k)), h = Math.max(1, Math.round(base.height * k));
  const c = createCanvas(w, h);
  const g = ctx2d(c);
  g.imageSmoothingQuality = 'high';
  g.drawImage(base, 0, 0, w, h);
  const img = getImageData(c);
  const scale = Math.min(w, h) / (p.ref ?? REF_SIDE);
  const res = await runOp('adjust', img, { adjustments: p.items.filter(i => i.enabled !== false).map(i => ({ type: i.type, params: scaleParams(i.type, { ...defaultsOf(i.type), ...i.params }, scale), opacity: i.opacity, blend: i.blend })) });
  ctx2d(c).putImageData(res.image!, 0, 0);
  const url = c.toDataURL('image/jpeg', 0.82);
  thumbCache.set(key, url);
  if (thumbCache.size > 400) thumbCache.delete(thumbCache.keys().next().value!);
  return url;
}
let sample: HTMLCanvasElement | null = null;
/** Imagen de prueba procedural (degradados, luces y una silueta) para ver los preajustes sin capa. */
function sampleImage(size: number) {
  if (sample) return sample;
  const s = Math.max(96, size);
  const c = createCanvas(s, Math.round(s * 1.25));
  const g = ctx2d(c);
  const bg = g.createLinearGradient(0, 0, 0, c.height);
  bg.addColorStop(0, '#2a3346'); bg.addColorStop(0.55, '#7a5a4a'); bg.addColorStop(1, '#14161c');
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  const sun = g.createRadialGradient(c.width * 0.72, c.height * 0.28, 2, c.width * 0.72, c.height * 0.28, c.width * 0.4);
  sun.addColorStop(0, 'rgba(255,240,210,1)'); sun.addColorStop(0.2, 'rgba(255,190,120,.7)'); sun.addColorStop(1, 'rgba(255,190,120,0)');
  g.fillStyle = sun; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#e9d6c4';
  g.beginPath(); g.ellipse(c.width * 0.4, c.height * 0.45, c.width * 0.17, c.width * 0.22, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#1d2230';
  g.beginPath(); g.moveTo(c.width * 0.08, c.height); g.quadraticCurveTo(c.width * 0.4, c.height * 0.55, c.width * 0.75, c.height); g.fill();
  g.fillStyle = '#d21625'; g.fillRect(c.width * 0.62, c.height * 0.7, c.width * 0.22, c.height * 0.12);
  sample = c;
  return c;
}

export { activeDoc };
