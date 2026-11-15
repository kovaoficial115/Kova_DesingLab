// Exportación para Behance: secciones sueltas, imagen continua por segmentos y PDF de
// presentación. Cada imagen se renderiza por separado para no pasar de los límites de lienzo del
// navegador (y de la memoria de un equipo de 8 GB).

import type { Artboard, DocState } from '../core/types';
import { canvasToBlob, createCanvas, ctx2d } from '../core/util';
import { exportArtboard, rasterFor } from '../io/exporters';
import { renderPdfPages } from '../social/exportSocial';
import { planSegments, sectionFileName, segmentFileName, type OutExt, type Segment } from './model';

export interface OutOpts { ext: OutExt; scale: number; quality: number }

const MIME: Record<OutExt, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const outW = (ab: Artboard, scale: number) => Math.max(1, Math.round(ab.w * scale));
const outH = (ab: Artboard, scale: number) => Math.max(1, Math.round(ab.h * scale));

export interface Output {
  key: string;
  name: string;
  w: number;
  h: number;
  /** secciones que entran (para la miniatura y las comprobaciones) */
  sections: Artboard[];
  render: () => Promise<Blob>;
}

/** Una imagen por sección. Las transparencias se rellenan de blanco en JPG. */
export function sectionOutputs(state: DocState, project: string, sections: Artboard[], o: OutOpts): Output[] {
  return sections.map(ab => ({
    key: `s:${ab.id}`,
    name: sectionFileName(project, ab.behance?.index ?? 0, ab.name, o.ext),
    w: outW(ab, o.scale), h: outH(ab, o.scale), sections: [ab],
    render: () => exportArtboard(state, ab, { format: o.ext, dpi: ab.dpi * o.scale, quality: o.quality, background: 'artboard', filename: ab.name }),
  }));
}

/** Segmentos de la imagen continua: las secciones elegidas una debajo de otra, sin huecos. */
export function segmentPlan(sections: Artboard[], scale: number, maxH: number): Segment[] {
  return planSegments(sections.map(a => outH(a, scale)), maxH);
}

export function segmentOutputs(state: DocState, project: string, sections: Artboard[], o: OutOpts, maxH: number): Output[] {
  if (!sections.length) return [];
  const segs = segmentPlan(sections, o.scale, maxH);
  const W = Math.max(...sections.map(a => outW(a, o.scale)));
  return segs.map((seg, i) => ({
    key: `g:${i}:${seg.pieces.map(p => `${sections[p.section].id}:${p.y0}-${p.y1}`).join(',')}`,
    name: segmentFileName(project, i, segs.length, o.ext),
    w: W, h: seg.h,
    sections: [...new Set(seg.pieces.map(p => sections[p.section]))],
    render: () => renderSegment(state, sections, seg, o, W),
  }));
}

/** Renderiza un segmento trozo a trozo (cada trozo es una parte de una sección). */
async function renderSegment(state: DocState, sections: Artboard[], seg: Segment, o: OutOpts, W: number): Promise<Blob> {
  const out = createCanvas(W, seg.h);
  const g = ctx2d(out);
  if (o.ext === 'jpg') { g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, seg.h); }
  let dy = 0;
  for (const p of seg.pieces) {
    const ab = sections[p.section];
    const k = outH(ab, o.scale) / ab.h;
    const part: Artboard = { ...ab, y: ab.y + p.y0 / k, h: (p.y1 - p.y0) / k };
    const c = await rasterFor(state, part, { format: 'png', dpi: ab.dpi * o.scale, quality: o.quality, background: 'artboard', filename: '' });
    const w = outW(ab, o.scale);
    g.drawImage(c, 0, 0, c.width, c.height, Math.round((W - w) / 2), dy, w, p.y1 - p.y0);
    dy += p.y1 - p.y0;
  }
  const blob = await canvasToBlob(out, MIME[o.ext], o.ext === 'png' ? undefined : o.quality);
  // se libera la memoria del lienzo grande cuanto antes
  out.width = out.height = 1;
  return blob;
}

/** PDF de presentación: una página por sección (Behance no admite PDF como contenido). */
export function sectionsPdf(state: DocState, sections: Artboard[], o: OutOpts, title: string, onProgress?: (i: number) => void, cancelled?: () => boolean) {
  return renderPdfPages(state, sections.map(ab => ({ ab, group: ab.behance?.project ?? ab.id })), { ext: 'jpg', scale: o.scale, quality: o.quality, transparent: false }, title, onProgress, cancelled);
}
