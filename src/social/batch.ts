// Generación por lotes: una plantilla (mesa) con {{variables}} en textos y huecos de imagen,
// rellenada con cada fila de un CSV/JSON. Trabaja sobre copias temporales del estado.

import type { Artboard, DocState, Layer } from '../core/types';
import { createCanvas, ctx2d, layerBounds, layerSize, unionRect, uid } from '../core/util';
import { commit } from '../core/store';
import { cloneLayerDeep, fitToScreen } from '../core/actions';
import { topItemsIn } from './actions';
import { invalidateLayer } from '../core/render';
import { descendants } from '../core/doc';
import { findVars, fillVars, normKey, type Row } from './variables';

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export interface TemplateInfo {
  /** variables de los textos */
  textVars: string[];
  /** capas de imagen cuyo nombre es {{variable}}: se sustituyen por la imagen de esa columna */
  imageSlots: { layerId: string; name: string; varName: string }[];
  textLayers: string[];
}

/** Capas de la mesa (también las de dentro de grupos). */
function layersIn(st: DocState, ab: Artboard): Layer[] {
  return st.layers.filter(l => {
    if (l.kind === 'group') return descendants(st.layers, l.id).some(d => d.kind !== 'group' && overlaps(layerBounds(d), ab));
    return overlaps(layerBounds(l), ab);
  });
}

export function analyzeTemplate(st: DocState, ab: Artboard): TemplateInfo {
  const vars = new Set<string>();
  const imageSlots: TemplateInfo['imageSlots'] = [];
  const textLayers: string[] = [];
  for (const l of layersIn(st, ab)) {
    if (l.kind === 'text' && l.text) {
      const v = findVars(l.text.text);
      if (v.length) { textLayers.push(l.id); v.forEach(x => vars.add(x)); }
    }
    if (l.kind === 'raster') {
      const v = findVars(l.name);
      if (v.length) imageSlots.push({ layerId: l.id, name: l.name, varName: v[0] });
    }
  }
  return { textVars: [...vars], imageSlots, textLayers };
}

/** Imagen dibujada cubriendo un lienzo de w×h (recorte centrado). */
function coverCanvas(img: CanvasImageSource & { width: number; height: number }, w: number, h: number) {
  const c = createCanvas(w, h);
  const g = ctx2d(c);
  const k = Math.max(w / img.width, h / img.height);
  const dw = img.width * k, dh = img.height * k;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return c;
}

/** Busca la imagen de una fila por nombre de archivo (con o sin extensión, sin distinguir mayúsculas). */
export function matchImage(value: string, images: Map<string, HTMLCanvasElement>): HTMLCanvasElement | null {
  if (!value) return null;
  const v = normKey(value.split(/[\\/]/).pop()!);
  return images.get(v) ?? images.get(v.replace(/\.[a-z0-9]+$/, '')) ?? null;
}
export const imageKey = (filename: string) => normKey(filename);

const TEMP = '~lote';
/**
 * Estado temporal con la fila aplicada. Las capas cambiadas llevan un id propio del lote para no
 * pisar las cachés de render del documento.
 */
export function applyRow(st: DocState, info: TemplateInfo, row: Row, images: Map<string, HTMLCanvasElement>): { state: DocState; missing: string[] } {
  const missing: string[] = [];
  const texts = new Set(info.textLayers);
  const slots = new Map(info.imageSlots.map(s => [s.layerId, s]));
  const rename = new Map<string, string>();
  const layers = st.layers.map(l => {
    if (texts.has(l.id) && l.text) {
      for (const v of findVars(l.text.text)) if (!(v in row) && v !== 'fecha') missing.push(v);
      rename.set(l.id, l.id + TEMP);
      return { ...l, id: l.id + TEMP, text: { ...l.text, text: fillVars(l.text.text, row) } };
    }
    const s = slots.get(l.id);
    if (s && l.canvas) {
      const img = matchImage(row[s.varName] ?? '', images);
      if (!img) { missing.push(`${s.varName} (imagen «${row[s.varName] ?? ''}»)`); return l; }
      const { w, h } = layerSize(l);
      const c = coverCanvas(img, w, h);
      rename.set(l.id, l.id + TEMP);
      return { ...l, id: l.id + TEMP, canvas: c, origin: c, adjustments: l.adjustments };
    }
    return l;
  });
  // los hijos de un grupo siguen apuntando a su padre (que no cambia de id)
  const fixed = rename.size ? layers.map(l => (l.parentId && rename.has(l.parentId) ? { ...l, parentId: rename.get(l.parentId)! } : l)) : layers;
  return { state: { ...st, layers: fixed, selection: null }, missing: [...new Set(missing)] };
}

/** Libera las cachés de render de las capas temporales del lote. */
export function releaseBatch(info: TemplateInfo) {
  for (const id of [...info.textLayers, ...info.imageSlots.map(s => s.layerId)]) invalidateLayer(id + TEMP);
}

/**
 * Crea en el documento una mesa por fila (debajo de la plantilla, en filas de hasta 5) con copias
 * editables de las capas ya rellenadas.
 */
export function createRowArtboards(st0: DocState, ab: Artboard, info: TemplateInfo, rows: Row[], images: Map<string, HTMLCanvasElement>, names: string[]) {
  const per = 5, gap = Math.round(Math.max(80, ab.w * 0.12));
  const all = unionRect(st0.artboards)!;
  const y0 = Math.round(all.y + all.h + gap * 2);
  const created: Artboard[] = [];
  commit(`Generar ${rows.length} diseño(s)`, st => {
    let layers = [...st.layers];
    rows.forEach((row, i) => {
      const x = ab.x + (i % per) * (ab.w + gap), y = y0 + Math.floor(i / per) * (ab.h + gap);
      const dx = x - ab.x, dy = y - ab.y;
      const filled = applyRow(st, info, row, images).state;
      for (const { layer } of topItemsIn(filled, ab)) {
        const copies = cloneLayerDeep(layer, filled.layers, null).map(c => ({
          ...(c.kind === 'group' ? c : { ...c, x: c.x + dx, y: c.y + dy }),
          name: c.name.replace(/ copia$/, ''),
        }));
        layers.push(...copies);
      }
      created.push({ ...ab, id: uid('ab'), name: names[i] ?? `${ab.name} ${i + 1}`, x, y, social: ab.social ? { preset: ab.social.preset } : ab.social });
    });
    return { ...st, layers, artboards: [...st.artboards, ...created], activeArtboardId: created[0]?.id ?? st.activeArtboardId };
  });
  releaseBatch(info);
  if (created.length) requestAnimationFrame(() => fitToScreen(unionRect(created)!));
  return created;
}
