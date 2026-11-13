// Pinceles: ajustes por herramienta (pincel, borrador, restaurar), puntas (redonda, cuadrada,
// procedurales o hechas a partir de una imagen) y texturas. Una punta es una máscara: un lienzo
// blanco cuyo alfa dice cuánto pinta (o borra) cada punto. Al empezar un trazo se tiñe una sola vez
// («sello») y cada toque es un drawImage del sello: mucho más barato que un degradado por toque.

import { createCanvas, ctx2d } from '../core/util';
import { run, req, type DbSchema } from '../storage/idb';

export type BrushToolId = 'brush' | 'eraser' | 'restore';

export interface BrushSettings {
  size: number; // px de pantalla del documento (diámetro)
  hardness: number; // 0..1 (solo la punta redonda)
  opacity: number; // 0..1, máximo del trazo
  flow: number; // 0..1, cuánto deja cada toque
  spacing: number; // separación entre toques, en fracción del diámetro
  angle: number; // grados
  roundness: number; // 0.05..1 (1 = la punta tal cual)
  sizeJitter: number; // 0..1
  angleJitter: number; // 0..1 (1 = cualquier ángulo)
  scatter: number; // 0..2 diámetros
  pressure: boolean; // la presión del lápiz cambia el tamaño
  tip: string; // id de la punta
  texture: string | null; // id de la textura (null: sin textura)
  textureScale: number; // 0.05..10
  textureDepth: number; // 0..1
  textureInvert: boolean;
}

export const defaultBrush = (over: Partial<BrushSettings> = {}): BrushSettings => ({
  size: 40, hardness: 0.8, opacity: 1, flow: 1, spacing: 0.15, angle: 0, roundness: 1,
  sizeJitter: 0, angleJitter: 0, scatter: 0, pressure: true,
  tip: 'round', texture: null, textureScale: 1, textureDepth: 1, textureInvert: false, ...over,
});

export const defaultBrushes = (): Record<BrushToolId, BrushSettings> => ({
  brush: defaultBrush(),
  eraser: defaultBrush({ size: 60, hardness: 0.6 }),
  restore: defaultBrush({ size: 60, hardness: 0.6 }),
});

/** Completa ajustes guardados por una versión anterior (o dañados) con los valores por defecto. */
export function sanitizeBrushes(v: any): Record<BrushToolId, BrushSettings> {
  const d = defaultBrushes();
  if (!v || typeof v !== 'object') return d;
  for (const k of Object.keys(d) as BrushToolId[]) {
    const src = v[k];
    if (!src || typeof src !== 'object') continue;
    for (const key of Object.keys(d[k]) as (keyof BrushSettings)[]) {
      const val = src[key];
      if (val === undefined || (typeof val !== typeof d[k][key] && !(key === 'texture' && (val === null || typeof val === 'string')))) continue;
      (d[k] as any)[key] = val;
    }
  }
  return d;
}

// ---------- puntas y texturas ----------
export interface BrushImage {
  id: string;
  name: string;
  kind: 'tip' | 'texture';
  /** máscara: blanco con alfa (punta) o gris opaco donde blanco = pinta del todo (textura) */
  canvas: HTMLCanvasElement;
  builtin: boolean;
}

/** Generador pseudoaleatorio con semilla: las puntas procedurales salen siempre iguales. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

const TIP_RES = 256;

/** Punta redonda con borde suave: `hardness` es la parte del radio que pinta al 100 %. */
export function roundTip(hardness: number, res = TIP_RES): HTMLCanvasElement {
  const c = createCanvas(res, res), g = ctx2d(c), r = res / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  const h = Math.min(0.99, Math.max(0, hardness));
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(h, 'rgba(255,255,255,1)');
  // caída suave (no lineal) como la de Photoshop
  for (let i = 1; i <= 4; i++) { const t = i / 5; grad.addColorStop(h + (1 - h) * t, `rgba(255,255,255,${((1 - t) ** 2).toFixed(3)})`); }
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, res, res);
  return c;
}

function procedural(id: string): HTMLCanvasElement {
  const res = TIP_RES, c = createCanvas(res, res), g = ctx2d(c), r = res / 2;
  g.fillStyle = '#fff';
  const rand = rng(id.split('').reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7));
  if (id === 'square') g.fillRect(0, 0, res, res);
  else if (id === 'spray') {
    // aerógrafo: gotas pequeñas más densas en el centro
    for (let i = 0; i < 900; i++) {
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * rand() * r * 0.98;
      g.globalAlpha = 0.5 + rand() * 0.5;
      g.beginPath(); g.arc(r + Math.cos(a) * d, r + Math.sin(a) * d, 1 + rand() * 2.2, 0, Math.PI * 2); g.fill();
    }
  } else if (id === 'chalk') {
    // tiza: redonda con huecos de grano
    g.beginPath(); g.arc(r, r, r * 0.92, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 2600; i++) {
      g.globalAlpha = 0.3 + rand() * 0.7;
      g.fillRect(rand() * res, rand() * res, 1 + rand() * 3, 1 + rand() * 3);
    }
  } else if (id === 'grunge') {
    // manchas irregulares: varias gotas de tamaños distintos
    for (let i = 0; i < 70; i++) {
      const a = rand() * Math.PI * 2, d = Math.pow(rand(), 0.7) * r * 0.75, rr = 4 + rand() * r * 0.32;
      g.globalAlpha = 0.35 + rand() * 0.65;
      g.beginPath(); g.ellipse(r + Math.cos(a) * d, r + Math.sin(a) * d, rr, rr * (0.4 + rand() * 0.6), rand() * Math.PI, 0, Math.PI * 2); g.fill();
    }
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 1600; i++) { g.globalAlpha = rand(); g.fillRect(rand() * res, rand() * res, 1 + rand() * 4, 1 + rand() * 4); }
  } else if (id === 'bristle') {
    // cerdas: trazos finos paralelos con huecos
    for (let i = 0; i < 46; i++) {
      const x = r + (rand() - 0.5) * res * 0.9, w = 1.5 + rand() * 4, h = res * (0.5 + rand() * 0.45);
      g.globalAlpha = 0.45 + rand() * 0.55;
      g.fillRect(x - w / 2, r - h / 2, w, h);
    }
  } else if (id === 'splatter') {
    // salpicadura: una mancha central y gotas alrededor
    g.beginPath(); g.arc(r, r, r * 0.38, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 60; i++) {
      const a = rand() * Math.PI * 2, d = r * (0.35 + rand() * 0.6), rr = 2 + rand() * 9 * (1 - d / r);
      g.beginPath(); g.arc(r + Math.cos(a) * d, r + Math.sin(a) * d, Math.max(1, rr), 0, Math.PI * 2); g.fill();
    }
  }
  return c;
}

function proceduralTexture(id: string): HTMLCanvasElement {
  // texturas en gris opaco que repiten sin costuras (se trabaja «envolviendo» los bordes)
  const res = 256, c = createCanvas(res, res), g = ctx2d(c);
  const rand = rng(id.length * 977 + id.charCodeAt(0));
  g.fillStyle = '#fff'; g.fillRect(0, 0, res, res);
  const wrap = (fn: (dx: number, dy: number) => void) => { for (const dx of [-res, 0, res]) for (const dy of [-res, 0, res]) fn(dx, dy); };
  if (id === 'tex-grain') {
    const img = g.getImageData(0, 0, res, res), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const v = rand() < 0.45 ? 40 + rand() * 120 : 255; d[i] = d[i + 1] = d[i + 2] = v; }
    g.putImageData(img, 0, 0);
  } else if (id === 'tex-distress') {
    // desgaste: grietas y huecos como un estampado vintage
    g.fillStyle = '#000';
    for (let i = 0; i < 260; i++) {
      const x = rand() * res, y = rand() * res, rr = 1 + Math.pow(rand(), 3) * 16;
      g.globalAlpha = 0.5 + rand() * 0.5;
      wrap((dx, dy) => { g.beginPath(); g.ellipse(x + dx, y + dy, rr, rr * (0.3 + rand() * 0.7), rand() * Math.PI, 0, Math.PI * 2); g.fill(); });
    }
    g.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      let x = rand() * res, y = rand() * res;
      const pts: [number, number][] = [[x, y]];
      for (let k = 0; k < 7; k++) { x += (rand() - 0.5) * 34; y += (rand() - 0.5) * 34; pts.push([x, y]); }
      g.lineWidth = 0.6 + rand() * 1.6; g.globalAlpha = 0.6 + rand() * 0.4; g.strokeStyle = '#000';
      wrap((dx, dy) => { g.beginPath(); pts.forEach(([px, py], j) => (j ? g.lineTo(px + dx, py + dy) : g.moveTo(px + dx, py + dy))); g.stroke(); });
    }
  } else if (id === 'tex-canvas') {
    // tela: trama de hilos
    const img = g.getImageData(0, 0, res, res), d = img.data;
    for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
      const v = 0.55 + 0.25 * Math.sin((x / res) * Math.PI * 2 * 32) * Math.sin((y / res) * Math.PI * 2 * 32) + 0.2 * rand();
      const o = (y * res + x) * 4; d[o] = d[o + 1] = d[o + 2] = Math.max(0, Math.min(255, v * 255));
    }
    g.putImageData(img, 0, 0);
  } else if (id === 'tex-halftone') {
    // puntos de semitono
    g.fillStyle = '#000';
    const step = 16;
    for (let y = 0; y < res; y += step) for (let x = 0; x < res; x += step) { g.beginPath(); g.arc(x + step / 2, y + step / 2, step * 0.36, 0, Math.PI * 2); g.fill(); }
  }
  return c;
}

export const BUILTIN_TIPS: { id: string; name: string }[] = [
  { id: 'round', name: 'Redonda' }, { id: 'square', name: 'Cuadrada' }, { id: 'spray', name: 'Aerógrafo' },
  { id: 'chalk', name: 'Tiza' }, { id: 'grunge', name: 'Grunge' }, { id: 'bristle', name: 'Cerdas' }, { id: 'splatter', name: 'Salpicadura' },
];
export const BUILTIN_TEXTURES: { id: string; name: string }[] = [
  { id: 'tex-distress', name: 'Desgaste' }, { id: 'tex-grain', name: 'Grano' }, { id: 'tex-canvas', name: 'Tela' }, { id: 'tex-halftone', name: 'Semitono' },
];

// ---------- biblioteca (integradas + las que sube la persona) ----------
const builtinCache = new Map<string, BrushImage>();
const custom = new Map<string, BrushImage>();
const listeners = new Set<() => void>();
let version = 0;
export const onBrushLibrary = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const brushLibraryVersion = () => version;
const changed = () => { version++; listeners.forEach(f => f()); };

export function getBrushImage(id: string | null | undefined): BrushImage | null {
  if (!id) return null;
  const c = custom.get(id);
  if (c) return c;
  let b = builtinCache.get(id);
  if (b) return b;
  const tip = BUILTIN_TIPS.find(t => t.id === id);
  const tex = BUILTIN_TEXTURES.find(t => t.id === id);
  if (!tip && !tex) return null;
  b = tip
    ? { id, name: tip.name, kind: 'tip', canvas: id === 'round' ? roundTip(1) : procedural(id), builtin: true }
    : { id, name: tex!.name, kind: 'texture', canvas: proceduralTexture(id), builtin: true };
  builtinCache.set(id, b);
  return b;
}

export function listBrushImages(kind: 'tip' | 'texture'): BrushImage[] {
  const base = (kind === 'tip' ? BUILTIN_TIPS : BUILTIN_TEXTURES).map(t => getBrushImage(t.id)!);
  return [...base, ...[...custom.values()].filter(c => c.kind === kind)];
}

/**
 * Convierte una imagen en máscara. Si la imagen tiene transparencia, manda el alfa; si es opaca,
 * lo oscuro pinta (como al definir un pincel en Photoshop). Las puntas se recortan a su contenido.
 */
export function imageToMask(src: CanvasImageSource & { width: number; height: number }, kind: 'tip' | 'texture', maxSide = 512): HTMLCanvasElement {
  const k = Math.min(1, maxSide / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * k)), h = Math.max(1, Math.round(src.height * k));
  const c = createCanvas(w, h), g = ctx2d(c);
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, h);
  const img = g.getImageData(0, 0, w, h), d = img.data;
  let transparent = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) transparent++;
  const useAlpha = transparent > (w * h) / 100;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
    // cuánto pinta este píxel (0..1)
    const v = useAlpha ? (d[i + 3] / 255) * (kind === 'texture' ? lum : 1) : 1 - lum;
    if (kind === 'tip') {
      d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(v * 255);
      if (d[i + 3] > 8) { const x = p % w, y = (p / w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    } else {
      // textura: gris opaco, blanco = pinta del todo (lo oscuro de la imagen deja huecos)
      const t = useAlpha ? v : lum;
      d[i] = d[i + 1] = d[i + 2] = Math.round(t * 255); d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  if (kind === 'texture' || x1 < 0) return c;
  // recorte cuadrado centrado en el contenido (la punta se escala por su lado mayor)
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, side = Math.max(cw, ch);
  const out = createCanvas(side, side);
  ctx2d(out).drawImage(c, x0, y0, cw, ch, (side - cw) / 2, (side - ch) / 2, cw, ch);
  return out;
}

// persistencia de las puntas y texturas propias (IndexedDB; la imagen ya procesada, en PNG)
const BRUSH_DB: DbSchema = { name: 'kova-brushes', migrations: { 1: db => { db.createObjectStore('images', { keyPath: 'id' }); } } };

async function canvasFromBlob(b: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(b);
  const c = createCanvas(bmp.width, bmp.height);
  ctx2d(c).drawImage(bmp, 0, 0);
  bmp.close?.();
  return c;
}

let loaded: Promise<void> | null = null;
/** Carga una vez las puntas y texturas guardadas en este navegador. */
export function loadBrushLibrary(): Promise<void> {
  if (loaded) return loaded;
  loaded = (async () => {
    try {
      const rows = await run(BRUSH_DB, 'images', 'readonly', tx => req(tx.objectStore('images').getAll())) as { id: string; name: string; kind: 'tip' | 'texture'; png: Blob }[];
      for (const r of rows) {
        try { custom.set(r.id, { id: r.id, name: r.name, kind: r.kind, canvas: await canvasFromBlob(r.png), builtin: false }); } catch { /* imagen dañada: se ignora */ }
      }
      changed();
    } catch { /* sin IndexedDB (navegación privada): solo las integradas */ }
  })();
  return loaded;
}

/** Crea una punta o textura a partir de un archivo de imagen y la guarda. */
export async function addBrushImage(file: File, kind: 'tip' | 'texture'): Promise<BrushImage> {
  const bmp = await createImageBitmap(file);
  const canvas = imageToMask(bmp, kind);
  bmp.close?.();
  const id = `${kind}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const name = file.name.replace(/\.[^.]+$/, '').slice(0, 40) || (kind === 'tip' ? 'Punta' : 'Textura');
  const item: BrushImage = { id, name, kind, canvas, builtin: false };
  custom.set(id, item);
  changed();
  try {
    const png: Blob = await new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('PNG'))), 'image/png'));
    await run(BRUSH_DB, 'images', 'readwrite', tx => req(tx.objectStore('images').put({ id, name, kind, png })));
  } catch { /* se queda solo para esta sesión */ }
  return item;
}

export async function removeBrushImage(id: string) {
  custom.delete(id);
  changed();
  try { await run(BRUSH_DB, 'images', 'readwrite', tx => req(tx.objectStore('images').delete(id))); } catch { /* nada */ }
}

// ---------- sellos y texturas listos para pintar ----------
/** Sello teñido para un trazo: la punta (o la redonda con la dureza pedida) en el color dado. */
export function makeStamp(b: BrushSettings, color: string, diameter: number): HTMLCanvasElement {
  // resolución: la del diámetro (sin pasar de 1024 ni bajar de 8); las puntas de imagen no
  // ganan nada por encima de su propia resolución
  const cap = b.tip === 'round' ? 1024 : Math.max(256, getBrushImage(b.tip)?.canvas.width ?? 256);
  const res = Math.max(8, Math.min(cap, 1024, Math.ceil(diameter)));
  const tip = b.tip === 'round' ? roundTip(b.hardness, res) : getBrushImage(b.tip)?.canvas ?? roundTip(b.hardness, res);
  const c = createCanvas(res, res), g = ctx2d(c);
  g.imageSmoothingQuality = 'high';
  g.drawImage(tip, 0, 0, res, res);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, res, res);
  return c;
}

/** Textura convertida en alfa (blanco opaco = deja pasar todo), con profundidad e inversión. */
export function makeTextureMask(b: BrushSettings): HTMLCanvasElement | null {
  const t = getBrushImage(b.texture);
  if (!t) return null;
  const src = t.canvas;
  const c = createCanvas(src.width, src.height), g = ctx2d(c);
  g.drawImage(src, 0, 0);
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
  const depth = Math.max(0, Math.min(1, b.textureDepth));
  for (let i = 0; i < d.length; i += 4) {
    let v = d[i] / 255;
    if (b.textureInvert) v = 1 - v;
    const a = 1 - depth * (1 - v);
    d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(a * 255);
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Posiciones de los toques entre dos puntos, con el resto de distancia que queda para el siguiente. */
export function dabPositions(from: { x: number; y: number }, to: { x: number; y: number }, step: number, carry: number) {
  const out: { x: number; y: number }[] = [];
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  if (dist === 0) return { points: out, carry };
  let d = step - carry;
  while (d <= dist) { const t = d / dist; out.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }); d += step; }
  return { points: out, carry: dist - (d - step) };
}
