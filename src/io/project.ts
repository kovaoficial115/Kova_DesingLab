// Proyectos editables .kova (JSON con bitmaps PNG embebidos), biblioteca local en IndexedDB,
// guardado automático y recuperación ante cierres inesperados.

import type { Doc, DocState, Layer } from '../core/types';
import { canvasToBlob, blobToCanvas, uid, createCanvas, ctx2d } from '../core/util';
import { platform, type SaveTarget } from '../platform';
import { renderArtboard } from '../core/render';
import { embedFonts, installEmbedded } from './fonts';

interface SerialLayer extends Omit<Layer, 'canvas' | 'origin' | 'mask'> { canvas?: string; origin?: string; mask?: string }

async function canvasToDataUrl(c: HTMLCanvasElement) {
  const blob = await canvasToBlob(c, 'image/png');
  return new Promise<string>(r => { const fr = new FileReader(); fr.onload = () => r(fr.result as string); fr.readAsDataURL(blob); });
}
async function dataUrlToCanvas(u: string) {
  const blob = await (await fetch(u)).blob();
  return blobToCanvas(blob);
}

export async function serializeDoc(doc: Doc): Promise<string> {
  const assets: Record<string, string> = {};
  const ids = new Map<HTMLCanvasElement, string>();
  const ref = async (c?: HTMLCanvasElement | null) => {
    if (!c) return undefined;
    let id = ids.get(c);
    if (!id) { id = uid('a'); ids.set(c, id); assets[id] = await canvasToDataUrl(c); }
    return id;
  };
  const layers: SerialLayer[] = [];
  for (const l of doc.state.layers) {
    const { canvas, origin, mask, ...rest } = l;
    layers.push({ ...rest, canvas: await ref(canvas), origin: origin && origin !== canvas ? await ref(origin) : undefined, mask: await ref(mask) });
  }
  const { selection: _sel, ...st } = doc.state;
  return JSON.stringify({
    format: 'kova-designlab', version: 1, id: doc.id, name: doc.name, colorMode: doc.colorMode, createdAt: doc.createdAt,
    state: { ...st, layers }, assets,
    // tipografías del usuario usadas por los textos, para abrir el proyecto en otro equipo
    fonts: embedFonts(doc.state.layers.filter(l => l.kind === 'text' && l.text).map(l => l.text!.fontFamily)),
  });
}

export async function deserializeDoc(json: string): Promise<Doc> {
  const data = JSON.parse(json);
  if (data.format !== 'kova-designlab') throw new Error('Archivo de proyecto no reconocido');
  await installEmbedded(data.fonts);
  const cache = new Map<string, HTMLCanvasElement>();
  const get = async (id?: string) => {
    if (!id) return undefined;
    if (!cache.has(id)) cache.set(id, await dataUrlToCanvas(data.assets[id]));
    return cache.get(id)!;
  };
  const layers: Layer[] = [];
  for (const l of data.state.layers as SerialLayer[]) {
    const canvas = await get(l.canvas);
    layers.push({ ...(l as any), canvas, origin: (await get(l.origin)) ?? canvas, mask: (await get(l.mask)) ?? null });
  }
  const state: DocState = { ...data.state, layers, selection: null };
  return { id: data.id || uid('doc'), name: data.name, colorMode: data.colorMode || 'RGB', state, past: [], future: [], lastLabel: 'Abrir proyecto', dirty: false, createdAt: data.createdAt || Date.now() };
}

export async function thumbnail(doc: Doc, max = 320) {
  const ab = doc.state.artboards.find(a => a.id === doc.state.activeArtboardId) ?? doc.state.artboards[0];
  const scale = Math.min(1, max / Math.max(ab.w, ab.h));
  const c = await renderArtboard(doc.state, ab, scale);
  const out = createCanvas(c.width, c.height);
  const g = ctx2d(out);
  g.fillStyle = ab.background || '#26262b';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(c, 0, 0);
  return out.toDataURL('image/jpeg', 0.8);
}

// ---------- IndexedDB ----------
const DB = 'kova-designlab';
function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('autosave')) db.createObjectStore('autosave', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export interface ProjectMeta { id: string; name: string; updated: number; thumb: string; w: number; h: number; dpi: number; size: number }
export interface StoredProject extends ProjectMeta { data: string }

export async function saveToLibrary(doc: Doc, store: 'projects' | 'autosave' = 'projects') {
  const data = await serializeDoc(doc);
  const ab = doc.state.artboards[0];
  const rec: StoredProject = { id: doc.id, name: doc.name, updated: Date.now(), thumb: await thumbnail(doc), w: ab.w, h: ab.h, dpi: ab.dpi, size: data.length, data };
  await tx(store, 'readwrite', s => s.put(rec));
  return rec;
}
export async function listLibrary(store: 'projects' | 'autosave' = 'projects'): Promise<ProjectMeta[]> {
  const all = await tx<StoredProject[]>(store, 'readonly', s => s.getAll() as IDBRequest<StoredProject[]>);
  return all.map(({ data: _d, ...m }) => m).sort((a, b) => b.updated - a.updated);
}
export async function loadFromLibrary(id: string, store: 'projects' | 'autosave' = 'projects') {
  const rec = await tx<StoredProject>(store, 'readonly', s => s.get(id) as IDBRequest<StoredProject>);
  if (!rec) throw new Error('Proyecto no encontrado');
  return deserializeDoc(rec.data);
}
export async function deleteFromLibrary(id: string, store: 'projects' | 'autosave' = 'projects') {
  await tx(store, 'readwrite', s => s.delete(id));
}

// ---------- archivo en disco ----------
/** Guarda el .kova. Devuelve el destino (para el próximo «Guardar»), null si se canceló
 *  o undefined si se entregó como descarga. */
export async function saveProjectFile(doc: Doc, saveAs = false): Promise<SaveTarget | null | undefined> {
  const json = await serializeDoc(doc);
  const blob = new Blob([json], { type: 'application/json' });
  const r = await platform.saveFile(blob, {
    suggestedName: `${doc.name}.kova`, pick: true, target: saveAs ? null : doc.fileHandle,
    filters: [{ name: 'Proyecto Kova', extensions: ['kova'], mime: 'application/json' }],
  });
  return r.status === 'saved' ? r.target : r.status === 'cancelled' ? null : undefined;
}
