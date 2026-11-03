// Modelo del documento compartido en Liveblocks Storage.
//
//   root
//   ├─ meta       LiveObject { name, colorMode, ready }
//   ├─ layers     LiveMap<id, LiveObject<LayerJSON>>   orden: clave fraccionaria `z` (+ id)
//   ├─ artboards  LiveMap<id, LiveObject<ArtboardJSON>>
//   ├─ guides     LiveMap<id, LiveObject<GuideJSON>>
//   ├─ fonts      LiveMap<clave, LiveObject<FontJSON>>  tipografías propias usadas por los textos
//   └─ versions   LiveList<LiveObject<VersionJSON>>     instantáneas (las escribe el servidor)
//
// Cada propiedad es un registro independiente, así que dos personas que cambian propiedades
// distintas de la misma capa no se pisan; en la misma propiedad gana el último cambio.
// Los píxeles NO viajan por Storage: cada bitmap (capa, máscara, original para restaurar) y
// cada SVG grande es un LiveFile inmutable que se sube una vez y se referencia por id.

import { LiveFile, LiveList, LiveMap, LiveObject } from '@liveblocks/client';

export interface FileRef { id: string; name: string; size: number; mimeType: string }

export interface LayerJSON {
  name: string; kind: string; visible: boolean; locked: boolean; opacity: number; blend: string;
  x: number; y: number; rotation: number; scaleX: number; scaleY: number;
  parentId: string | null; clip: boolean; adjustments: any[]; maskEnabled: boolean;
  text: any | null; shape: any | null;
  vw: number; vh: number; svg: string | null; svgFile: FileRef | null;
  canvas: FileRef | null; cw: number; ch: number;
  origin: FileRef | 'same' | null; ow: number; oh: number;
  mask: FileRef | null; mw: number; mh: number;
  z: string;
}
export const FILE_KEYS = ['svgFile', 'canvas', 'origin', 'mask'] as const;

export interface ArtboardJSON { name: string; x: number; y: number; w: number; h: number; dpi: number; background: string | null; margin: number; z: string }
export interface GuideJSON { axis: 'x' | 'y'; pos: number }
export interface FontJSON { family: string; weight: number; style: 'normal' | 'italic'; format: string; license: string | null; file: FileRef }
export interface VersionJSON { id: string; label: string; auto: boolean; at: number; by: string; byName: string; layers: number; thumb: string; file: FileRef }

export interface Presence {
  [k: string]: any;
  cursor: { x: number; y: number } | null;
  selection: string[];
  artboard: string | null;
  tool: string | null;
  activity: string | null;
  view: { x: number; y: number; w: number; h: number } | null;
}

export const initialPresence: Presence = { cursor: null, selection: [], artboard: null, tool: null, activity: null, view: null };

export function initialStorage() {
  return {
    meta: new LiveObject({ name: '', colorMode: 'RGB', ready: false }),
    layers: new LiveMap<string, LiveObject<any>>(),
    artboards: new LiveMap<string, LiveObject<any>>(),
    guides: new LiveMap<string, LiveObject<any>>(),
    fonts: new LiveMap<string, LiveObject<any>>(),
    versions: new LiveList<LiveObject<any>>([]),
  };
}

// ---------- conversión Storage ↔ JSON plano ----------
export const isFileRef = (v: any): v is FileRef => !!v && typeof v === 'object' && typeof v.id === 'string' && typeof v.mimeType === 'string';

/** Lee un LiveObject a JSON plano (LiveFile → FileRef). */
export function readObject(lo: LiveObject<any>): any {
  const out: any = {};
  for (const k of lo.keys()) {
    const v = lo.get(k);
    out[k] = v instanceof LiveFile ? { ...v.data } : v;
  }
  return out;
}
/** Valor apto para Storage (FileRef → LiveFile nuevo: un nodo no puede tener dos padres). */
export function toLson(v: any) {
  return isFileRef(v) ? new LiveFile({ id: v.id, name: v.name, size: v.size, mimeType: v.mimeType }) : v;
}
export function toLsonObject(o: any) {
  const out: any = {};
  for (const k in o) out[k] = toLson(o[k]);
  return out;
}

/** Igualdad de valores JSON (los archivos se comparan por id). */
export function same(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == b;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (isFileRef(a) || isFileRef(b)) return isFileRef(a) && isFileRef(b) && a.id === b.id;
  return JSON.stringify(a) === JSON.stringify(b);
}
export function diff(prev: any, next: any): Record<string, any> | null {
  let out: Record<string, any> | null = null;
  for (const k in next) if (!prev || !same(prev[k], next[k])) (out ??= {})[k] = next[k];
  return out;
}
