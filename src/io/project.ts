// Proyectos editables .kova (JSON con bitmaps PNG embebidos), biblioteca local en IndexedDB,
// guardado automático y recuperación ante cierres inesperados.

import type { Doc, DocState, Layer } from '../core/types';
import { canvasToBlob, blobToCanvas, uid, createCanvas, ctx2d } from '../core/util';
import { platform, type SaveTarget } from '../platform';
import { storage, type ProjectBucket, type ProjectRecord } from '../storage';
import { renderArtboard } from '../core/render';
import { embedFonts, installEmbedded } from './fonts';
import { parseKova, buildKova, KOVA_SCHEMA, KOVA_FORMAT, type EmbeddedModel } from './kova';

interface SerialLayer extends Omit<Layer, 'canvas' | 'origin' | 'mask'> { canvas?: string; origin?: string; mask?: string }

async function canvasToDataUrl(c: HTMLCanvasElement) {
  const blob = await canvasToBlob(c, 'image/png');
  return new Promise<string>(r => { const fr = new FileReader(); fr.onload = () => r(fr.result as string); fr.readAsDataURL(blob); });
}
async function dataUrlToCanvas(u: string) {
  const blob = await (await fetch(u)).blob();
  return blobToCanvas(blob);
}

const blobToDataUrl = (blob: Blob) => new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); });

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
  // un GLB propio viaja dentro del archivo para que el proyecto se abra en cualquier equipo
  let models3d: Record<string, EmbeddedModel> | undefined;
  const model = doc.garment3d?.model;
  if (model?.source === 'asset') {
    const rec = await storage.assets.get(model.hash);
    if (rec) models3d = { [rec.hash]: { name: rec.name, mime: rec.mime, data: await blobToDataUrl(rec.blob) } };
    else console.warn('Modelo 3D no encontrado en la biblioteca:', model.hash);
  }
  return JSON.stringify(buildKova({
    id: doc.id, name: doc.name, colorMode: doc.colorMode, createdAt: doc.createdAt,
    state: { ...st, layers }, assets,
    // tipografías del usuario usadas por los textos, para abrir el proyecto en otro equipo
    fonts: embedFonts(doc.state.layers.filter(l => l.kind === 'text' && l.text).map(l => l.text!.fontFamily)),
    ...(doc.garment3d ? { garment3d: doc.garment3d } : {}),
    ...(models3d ? { models3d } : {}),
  }, doc.kova?.extra, Math.max(KOVA_SCHEMA, doc.kova?.sourceVersion ?? 0)));
}

export interface OpenOptions {
  /** avisos no bloqueantes (sección 3D inválida, archivo de una versión más nueva…) */
  onWarning?: (msg: string) => void;
}

export async function deserializeDoc(json: string, opts: OpenOptions = {}): Promise<Doc> {
  const { file: data, extra, sourceVersion, warnings } = parseKova(json);
  warnings.forEach(w => (opts.onWarning ?? console.warn)(w));
  await installEmbedded(data.fonts as any);
  // modelos 3D embebidos → biblioteca de activos (deduplicados por hash)
  for (const [hash, m] of Object.entries(data.models3d ?? {})) {
    const blob = await (await fetch(m.data)).blob();
    const saved = await storage.assets.put(new Blob([blob], { type: m.mime }), { type: 'model', name: m.name });
    if (saved.hash !== hash) (opts.onWarning ?? console.warn)(`El modelo 3D «${m.name}» no coincide con su huella; se guardó como uno nuevo.`);
  }
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
  return {
    id: data.id || uid('doc'), name: data.name, colorMode: data.colorMode, state, past: [], future: [], lastLabel: 'Abrir proyecto', dirty: false, createdAt: data.createdAt,
    ...(data.garment3d ? { garment3d: data.garment3d } : {}),
    kova: { sourceVersion, ...(Object.keys(extra).length ? { extra } : {}) },
  };
}

/** Antes de que un proyecto de formato antiguo se guarde en el nuevo, conserva el original
 *  como copia de respaldo (una sola vez; la migración se puede deshacer restaurándola). */
export async function backupBeforeMigration(json: string) {
  let raw: any;
  try { raw = JSON.parse(json); } catch { return; }
  const from = raw?.version ?? 1;
  if (raw?.format !== KOVA_FORMAT || from >= KOVA_SCHEMA || typeof raw.id !== 'string') return;
  await storage.backups.put({ key: `${raw.id}:v${from}`, id: raw.id, name: String(raw.name ?? 'Proyecto'), reason: 'pre-migration', created: Date.now(), schema: from, data: json }, true);
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

// ---------- biblioteca local (StorageEngine) ----------
export type { ProjectMeta } from '../storage';
export type StoredProject = ProjectRecord;

export async function saveToLibrary(doc: Doc, store: ProjectBucket = 'projects') {
  const data = await serializeDoc(doc);
  const ab = doc.state.artboards[0];
  return storage.projects.put({ id: doc.id, name: doc.name, updated: Date.now(), thumb: await thumbnail(doc), w: ab.w, h: ab.h, dpi: ab.dpi, size: data.length, data, schema: KOVA_SCHEMA }, store);
}
export const listLibrary = (store: ProjectBucket = 'projects') => storage.projects.list(store);
export async function loadFromLibrary(id: string, store: ProjectBucket = 'projects', opts: OpenOptions = {}) {
  const rec = await storage.projects.get(id, store);
  if (!rec) throw new Error('Proyecto no encontrado');
  if ((rec.schema ?? 1) < KOVA_SCHEMA) await backupBeforeMigration(rec.data);
  return deserializeDoc(rec.data, opts);
}
export const deleteFromLibrary = (id: string, store: ProjectBucket = 'projects') => storage.projects.delete(id, store);

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
