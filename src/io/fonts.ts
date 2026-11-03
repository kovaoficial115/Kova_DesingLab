// Tipografías del usuario: archivos subidos (TTF, OTF, WOFF, WOFF2 o ZIP como los de DaFont)
// y descargas del catálogo de Fontsource (incluye Google Fonts). Se guardan en IndexedDB,
// se registran con la API FontFace y viajan dentro de los proyectos .kova y los SVG exportados.

import { unzipSync } from 'fflate';
import { uid } from '../core/util';

export type FontFormat = 'truetype' | 'opentype' | 'woff' | 'woff2';
export interface StoredFont {
  id: string;
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  format: FontFormat;
  data: ArrayBuffer;
  source: 'upload' | 'google' | 'fontsource' | 'project';
  license?: string;
  added: number;
}
export type FontMeta = Omit<StoredFont, 'data'>;

export interface CatalogFont {
  id: string; family: string; category: string; weights: number[]; styles: string[];
  subsets: string[]; defSubset: string; license: string; type: 'google' | 'other'; variable: boolean;
}

// ---------- estado observable ----------
const fonts = new Map<string, StoredFont>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => { version++; listeners.forEach(f => f()); };
export function subscribeFonts(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }
export const fontsVersion = () => version;
export function listFonts(): FontMeta[] {
  return [...fonts.values()].map(({ data: _d, ...m }) => m).sort((a, b) => a.family.localeCompare(b.family) || a.weight - b.weight);
}
export function customFamilies(): string[] { return [...new Set([...fonts.values()].map(f => f.family))].sort((a, b) => a.localeCompare(b)); }
export function hasFamily(family: string) { return [...fonts.values()].some(f => f.family === family); }

/** Valor de `fontFamily` para una familia (entre comillas para que el shorthand de canvas la acepte). */
export function familyValue(family: string, fallback = 'sans-serif') { return `"${family.replace(/"/g, '')}", ${fallback}`; }
/** Primera familia de un valor CSS `font-family`, sin comillas. */
export function primaryFamily(value: string) { return value.split(',')[0].trim().replace(/^["']|["']$/g, ''); }

// ---------- IndexedDB ----------
const DB = 'kova-fonts', STORE = 'fonts';
function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((res, rej) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

// ---------- registro en el documento ----------
const faces = new Map<string, FontFace>();
async function register(f: StoredFont) {
  const face = new FontFace(f.family, f.data, { weight: String(f.weight), style: f.style });
  await face.load();
  document.fonts.add(face);
  faces.set(f.id, face);
}

/** Carga al iniciar todas las fuentes guardadas. */
export async function restoreFonts() {
  try {
    const all = await tx<StoredFont[]>('readonly', s => s.getAll() as IDBRequest<StoredFont[]>);
    for (const f of all) {
      try { await register(f); fonts.set(f.id, f); } catch (e) { console.warn('No se pudo cargar la fuente', f.family, e); }
    }
    if (all.length) emit();
  } catch (e) { console.warn('Biblioteca de fuentes no disponible', e); }
}

/** Instala una fuente recibida de otro participante (colaboración). */
export async function installFontData(f: { family: string; weight: number; style: 'normal' | 'italic'; format: FontFormat; license?: string }, data: ArrayBuffer) {
  if ([...fonts.values()].some(x => x.family === f.family && x.weight === f.weight && x.style === f.style)) return;
  await addFont({ ...f, data, source: 'project' });
  emit();
}
async function addFont(f: Omit<StoredFont, 'id' | 'added'>): Promise<StoredFont> {
  // misma familia + peso + estilo → se reemplaza
  const prev = [...fonts.values()].find(x => x.family === f.family && x.weight === f.weight && x.style === f.style);
  const full: StoredFont = { ...f, id: prev?.id ?? uid('font'), added: Date.now() };
  if (prev) { const old = faces.get(prev.id); if (old) document.fonts.delete(old); }
  await register(full);
  fonts.set(full.id, full);
  await tx('readwrite', s => s.put(full));
  return full;
}

export async function deleteFamily(family: string) {
  for (const f of [...fonts.values()].filter(x => x.family === family)) {
    const face = faces.get(f.id); if (face) document.fonts.delete(face);
    faces.delete(f.id); fonts.delete(f.id);
    await tx('readwrite', s => s.delete(f.id));
  }
  emit();
}

// ---------- lectura de la tabla 'name' y 'OS/2' (TTF/OTF/WOFF) ----------
const tag = (v: DataView, o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));

async function inflate(data: Uint8Array) {
  const ds = new DecompressionStream('deflate');
  return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer());
}

/** Devuelve las tablas pedidas de un sfnt o WOFF; null si el formato no se puede leer (WOFF2). */
async function readTables(buf: ArrayBuffer, wanted: string[]): Promise<Record<string, DataView> | null> {
  const v = new DataView(buf);
  const sig = tag(v, 0);
  const out: Record<string, DataView> = {};
  if (sig === 'wOFF') {
    const n = v.getUint16(12);
    for (let i = 0; i < n; i++) {
      const o = 44 + i * 20, t = tag(v, o);
      if (!wanted.includes(t)) continue;
      const off = v.getUint32(o + 4), comp = v.getUint32(o + 8), orig = v.getUint32(o + 12);
      const raw = new Uint8Array(buf, off, comp);
      const bytes = comp < orig ? await inflate(raw) : raw.slice();
      out[t] = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    return out;
  }
  if (sig === 'wOF2') return null;
  const n = v.getUint16(4);
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16, t = tag(v, o);
    if (wanted.includes(t)) out[t] = new DataView(buf, v.getUint32(o + 8), v.getUint32(o + 12));
  }
  return out;
}

function nameString(name: DataView, ids: number[]): string | null {
  const count = name.getUint16(2), strOff = name.getUint16(4);
  for (const want of ids) {
    let best: string | null = null;
    for (let i = 0; i < count; i++) {
      const o = 6 + i * 12;
      const platform = name.getUint16(o), enc = name.getUint16(o + 2), lang = name.getUint16(o + 4), id = name.getUint16(o + 6);
      if (id !== want) continue;
      const len = name.getUint16(o + 8), off = strOff + name.getUint16(o + 10);
      let s = '';
      if (platform === 3 || platform === 0) { for (let j = 0; j + 1 < len; j += 2) s += String.fromCharCode(name.getUint16(off + j)); }
      else if (platform === 1 && enc === 0) { for (let j = 0; j < len; j++) s += String.fromCharCode(name.getUint8(off + j)); }
      if (!s) continue;
      if (platform === 3 && lang === 0x409) return s; // inglés (Windows): el preferido
      best ??= s;
    }
    if (best) return best;
  }
  return null;
}

const STYLE_WORDS: [RegExp, number][] = [
  [/thin|hairline/i, 100], [/extra.?light|ultra.?light/i, 200], [/light/i, 300], [/medium/i, 500],
  [/semi.?bold|demi.?bold/i, 600], [/extra.?bold|ultra.?bold/i, 800], [/black|heavy/i, 900], [/bold/i, 700],
];
function guessFromName(fileName: string) {
  const base = fileName.replace(/\.[^.]+$/, '');
  let weight = 400;
  for (const [re, w] of STYLE_WORDS) if (re.test(base)) { weight = w; break; }
  const italic = /italic|oblique/i.test(base);
  const family = base.replace(/[-_ ](thin|hairline|extra.?light|ultra.?light|light|regular|book|normal|medium|semi.?bold|demi.?bold|extra.?bold|ultra.?bold|bold|black|heavy|italic|oblique)+$/gi, '')
    .replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim() || base;
  return { family, weight, italic };
}

async function describe(buf: ArrayBuffer, fileName: string) {
  const guess = guessFromName(fileName);
  try {
    const t = await readTables(buf, ['name', 'OS/2']);
    if (!t) return guess;
    const family = t.name ? nameString(t.name, [16, 1]) : null; // familia tipográfica, o familia
    const weight = t['OS/2'] ? t['OS/2'].getUint16(4) : guess.weight;
    const italic = t['OS/2'] ? (t['OS/2'].getUint16(62) & 1) === 1 : guess.italic;
    return { family: family?.trim() || guess.family, weight: weight >= 1 && weight <= 1000 ? weight : guess.weight, italic };
  } catch { return guess; }
}

const FORMATS: Record<string, FontFormat> = { ttf: 'truetype', otf: 'opentype', woff: 'woff', woff2: 'woff2' };
const extOf = (n: string) => n.toLowerCase().split('.').pop() || '';
export const FONT_ACCEPT = '.ttf,.otf,.woff,.woff2,.zip';

/** Importa archivos de fuente o ZIP (p. ej. de DaFont). Devuelve las familias añadidas. */
export async function importFontFiles(files: File[]): Promise<{ added: string[]; skipped: string[] }> {
  const entries: { name: string; data: ArrayBuffer }[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    const ext = extOf(f.name);
    if (ext === 'zip') {
      const zip = unzipSync(new Uint8Array(await f.arrayBuffer()));
      for (const [path, bytes] of Object.entries(zip)) {
        const name = path.split('/').pop()!;
        if (path.startsWith('__MACOSX') || name.startsWith('.')) continue;
        if (FORMATS[extOf(name)]) entries.push({ name, data: bytes.slice().buffer });
      }
    } else if (FORMATS[ext]) entries.push({ name: f.name, data: await f.arrayBuffer() });
    else skipped.push(f.name);
  }
  // si un ZIP trae la misma fuente en varios formatos, quedarse con OTF/TTF (se leen sus metadatos)
  const rank: Record<string, number> = { otf: 0, ttf: 1, woff: 2, woff2: 3 };
  const best = new Map<string, { name: string; data: ArrayBuffer }>();
  for (const e of entries) {
    const key = e.name.replace(/\.[^.]+$/, '').toLowerCase();
    const cur = best.get(key);
    if (!cur || rank[extOf(e.name)] < rank[extOf(cur.name)]) best.set(key, e);
  }
  const added = new Set<string>();
  for (const e of best.values()) {
    try {
      const d = await describe(e.data, e.name);
      await addFont({ family: d.family, weight: d.weight, style: d.italic ? 'italic' : 'normal', format: FORMATS[extOf(e.name)], data: e.data, source: 'upload' });
      added.add(d.family);
    } catch { skipped.push(e.name); }
  }
  emit();
  return { added: [...added], skipped };
}

// ---------- catálogo de Fontsource (incluye todo Google Fonts) ----------
let catalogPromise: Promise<CatalogFont[]> | null = null;
export function loadCatalog(): Promise<CatalogFont[]> {
  catalogPromise ??= fetch('https://api.fontsource.org/v1/fonts')
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((list: CatalogFont[]) => list.filter(f => f.category !== 'icons').sort((a, b) => a.family.localeCompare(b.family)))
    .catch(e => { catalogPromise = null; throw e; });
  return catalogPromise;
}

const subsetFor = (f: CatalogFont) => (f.subsets.includes('latin') ? 'latin' : f.defSubset);
export const fontFileUrl = (f: CatalogFont, weight: number, style: string) =>
  `https://cdn.jsdelivr.net/fontsource/fonts/${f.id}@latest/${subsetFor(f)}-${weight}-${style}.woff2`;

/** Fuente de vista previa (solo para pintar el nombre en la lista; no se guarda). */
const previews = new Map<string, Promise<string>>();
export function previewFamily(f: CatalogFont): Promise<string> {
  let p = previews.get(f.id);
  if (!p) {
    const name = `kova-preview-${f.id}`;
    const w = f.weights.includes(400) ? 400 : f.weights[0];
    p = new FontFace(name, `url(${fontFileUrl(f, w, f.styles.includes('normal') ? 'normal' : f.styles[0])})`, { weight: String(w) })
      .load().then(face => { document.fonts.add(face); return name; });
    previews.set(f.id, p);
  }
  return p;
}

export async function downloadCatalogFont(f: CatalogFont, weights: number[], italic: boolean) {
  const styles = ['normal', ...(italic && f.styles.includes('italic') ? ['italic'] : [])].filter(s => f.styles.includes(s));
  for (const w of weights) for (const st of styles) {
    const r = await fetch(fontFileUrl(f, w, st));
    if (!r.ok) throw new Error(`No se pudo descargar ${f.family} ${w}`);
    await addFont({ family: f.family, weight: w, style: st as 'normal' | 'italic', format: 'woff2', data: await r.arrayBuffer(), source: f.type === 'google' ? 'google' : 'fontsource', license: f.license });
  }
  emit();
}

// ---------- incrustación en proyectos y SVG ----------
function toBase64(buf: ArrayBuffer) {
  const b = new Uint8Array(buf); let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(s: string) { const bin = atob(s); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b.buffer; }

export interface EmbeddedFont { family: string; weight: number; style: 'normal' | 'italic'; format: FontFormat; data: string; license?: string }

/** Fuentes del usuario usadas por estos valores de font-family. */
export function fontsForFamilies(values: string[]): StoredFont[] {
  const fams = new Set(values.map(primaryFamily));
  return [...fonts.values()].filter(f => fams.has(f.family));
}
export function embedFonts(values: string[]): EmbeddedFont[] {
  return fontsForFamilies(values).map(f => ({ family: f.family, weight: f.weight, style: f.style, format: f.format, data: toBase64(f.data), license: f.license }));
}
/** Registra (y guarda) las fuentes incluidas en un proyecto que aún no estén instaladas. */
export async function installEmbedded(list: EmbeddedFont[] | undefined) {
  if (!list?.length) return;
  for (const e of list) {
    if ([...fonts.values()].some(f => f.family === e.family && f.weight === e.weight && f.style === e.style)) continue;
    try { await addFont({ family: e.family, weight: e.weight, style: e.style, format: e.format, data: fromBase64(e.data), source: 'project', license: e.license }); } catch { /* fuente dañada: se usa la alternativa */ }
  }
  emit();
}
/** Reglas @font-face con los datos incrustados, para SVG autónomos. */
export function fontFaceCss(values: string[]) {
  return fontsForFamilies(values).map(f =>
    `@font-face{font-family:"${f.family}";font-weight:${f.weight};font-style:${f.style};src:url(data:font/${f.format === 'truetype' ? 'ttf' : f.format === 'opentype' ? 'otf' : f.format};base64,${toBase64(f.data)}) format("${f.format}");}`).join('');
}
