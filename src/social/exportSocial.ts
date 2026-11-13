// Exportación para redes: lista de mesas en orden, nombres por plataforma, comprobaciones, ZIP y
// PDF de varias páginas (carruseles de documento). Lo que no es redes usa los exportadores comunes.

import { zipSync } from 'fflate';
import type { Artboard, DocState } from '../core/types';
import { layerBounds, canvasToBlob } from '../core/util';
import { isEffectivelyVisible } from '../core/doc';
import { exportArtboard, rasterFor, type ExportFormat } from '../io/exporters';
import { findFormat, fileKeyFrom, type UserFormats } from './presets';
import { exportFileName, listSeries, uniqueNames } from './model';
import { checkArtboard, type CheckLayer, type Issue } from './validate';

export type SocialExt = 'png' | 'jpg' | 'webp' | 'pdf' | 'svg';
export const EXT_FORMAT: Record<SocialExt, ExportFormat> = { png: 'png', jpg: 'jpg', webp: 'webp', pdf: 'pdf', svg: 'svg' };

export interface ExportItem { ab: Artboard; slide?: number; total?: number; group: string }

/** Mesas sociales en orden: cada serie con sus diapositivas y después las sueltas. */
export function exportItems(state: DocState, includePlain = false): ExportItem[] {
  const out: ExportItem[] = [];
  const series = listSeries(state.artboards);
  for (const s of series) s.slides.forEach((ab, i) => out.push({ ab, slide: i + 1, total: s.slides.length, group: s.ref.id }));
  for (const ab of state.artboards) {
    if (ab.social?.series) continue;
    if (!ab.social?.preset && !includePlain) continue;
    out.push({ ab, group: ab.id });
  }
  return out;
}

export function itemName(it: ExportItem, ext: string, user?: UserFormats) {
  return exportFileName({ ab: it.ab, format: findFormat(it.ab.social?.preset, user), ext, slide: it.slide, total: it.total });
}
/**
 * Nombres de una exportación. Con varias series, cada una va en su carpeta del ZIP
 * (drop_junio/instagram_carousel_01.png) o con su nombre delante si son archivos sueltos.
 */
export function itemNames(items: ExportItem[], ext: string, user?: UserFormats, folders = true) {
  const series = new Set(items.map(it => it.ab.social?.series?.id).filter(Boolean));
  return uniqueNames(items.map(it => {
    const base = itemName(it, ext, user);
    const ser = it.ab.social?.series;
    if (!ser || series.size < 2) return base;
    return folders ? `${fileKeyFrom(ser.name)}/${base}` : `${fileKeyFrom(ser.name)}_${base}`;
  }));
}

// ---------- tipografías ----------
const fontCache = new Map<string, boolean>();
/** ¿Está instalada la familia? Se compara su medida con la de las genéricas de respaldo. */
export function fontAvailable(family: string): boolean {
  const fam = family.split(',')[0].trim().replace(/^["']|["']$/g, '');
  if (!fam || /^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i.test(fam)) return true;
  if (fontCache.has(fam)) return fontCache.get(fam)!;
  const g = document.createElement('canvas').getContext('2d')!;
  const probe = 'mmmmmmmmmmlliWWQ@#0123456789';
  let ok = false;
  for (const base of ['monospace', 'serif', 'sans-serif']) {
    g.font = `72px ${base}`;
    const a = g.measureText(probe).width;
    g.font = `72px "${fam}", ${base}`;
    if (g.measureText(probe).width !== a) { ok = true; break; }
  }
  fontCache.set(fam, ok);
  return ok;
}

/** Comprobaciones de una mesa a la escala y formato de salida. */
export function checkItem(state: DocState, it: ExportItem, scale: number, ext: string, user?: UserFormats): Issue[] {
  const ab = it.ab;
  const layers: CheckLayer[] = [];
  for (const l of state.layers) {
    if (l.kind === 'group' || !isEffectivelyVisible(state.layers, l)) continue;
    const b = layerBounds(l);
    if (!(b.w > 0 && b.h > 0)) continue;
    layers.push({
      name: l.name, kind: l.kind, bounds: b,
      upscale: l.kind === 'raster' ? Math.max(Math.abs(l.scaleX), Math.abs(l.scaleY)) : undefined,
      font: l.text?.fontFamily, fontMissing: l.kind === 'text' && l.text ? !fontAvailable(l.text.fontFamily) : false,
    });
  }
  const neighbors = ab.social?.series?.kind === 'continuous'
    ? state.artboards.filter(a => a.id !== ab.id && a.social?.series?.id === ab.social!.series!.id)
    : undefined;
  return checkArtboard({ ab, format: findFormat(ab.social?.preset, user), layers, scale, ext, neighbors });
}

export interface RenderOpts { ext: SocialExt; scale: number; quality: number; transparent: boolean }

export async function renderItem(state: DocState, it: ExportItem, o: RenderOpts): Promise<Blob> {
  return exportArtboard(state, it.ab, {
    format: EXT_FORMAT[o.ext], dpi: it.ab.dpi * o.scale, quality: o.quality,
    background: o.transparent && (o.ext === 'png' || o.ext === 'webp') ? 'transparent' : 'artboard', filename: it.ab.name,
  });
}

/** Un PDF con una página por diapositiva (al tamaño en píxeles de cada mesa a 72 ppp = 1 pt/px). */
export async function renderPdfPages(state: DocState, items: ExportItem[], o: RenderOpts, title: string, onProgress?: (i: number) => void, cancelled?: () => boolean): Promise<Blob | null> {
  const { jsPDF } = await import('jspdf');
  let pdf: InstanceType<typeof jsPDF> | null = null;
  for (let i = 0; i < items.length; i++) {
    if (cancelled?.()) return null;
    onProgress?.(i);
    const ab = items[i].ab;
    const c = await rasterFor(state, ab, { format: 'jpg', dpi: ab.dpi * o.scale, quality: o.quality, background: 'artboard', filename: '' });
    const w = ab.w, h = ab.h;
    const orientation = w > h ? 'landscape' : 'portrait';
    if (!pdf) pdf = new jsPDF({ unit: 'pt', format: [w, h], orientation, compress: true });
    else pdf.addPage([w, h], orientation);
    const jpg = await canvasToBlob(c, 'image/jpeg', o.quality);
    pdf.addImage(new Uint8Array(await jpg.arrayBuffer()), 'JPEG', 0, 0, w, h, undefined, 'FAST');
  }
  if (!pdf) return null;
  pdf.setProperties({ title, creator: 'KOVA Design Lab' });
  return pdf.output('blob');
}

/** ZIP sin recomprimir (las imágenes ya están comprimidas). */
export async function buildZip(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.name] = new Uint8Array(await f.blob.arrayBuffer());
  return new Blob([zipSync(entries, { level: 0 })], { type: 'application/zip' });
}
