// Fuentes de diseño para hoja DTF y mockups: mesas de documentos abiertos o archivos sueltos,
// siempre como bitmap recortado con su resolución física.

import type { Artboard, DocState } from '../core/types';
import { renderArtboard, rasterizeSvg } from '../core/render';
import { trimCanvas, uid } from '../core/util';
import { importFile } from './importers';
import { deserializeDoc } from './project';

export interface DesignSource { id: string; name: string; canvas: HTMLCanvasElement; dpi: number }

export async function sourceFromArtboard(state: DocState, ab: Artboard, name = ab.name): Promise<DesignSource | null> {
  const t = trimCanvas(await renderArtboard(state, ab, 1, { background: true }));
  return t ? { id: uid('src'), name, canvas: t.canvas, dpi: ab.dpi } : null;
}

export async function sourcesFromFile(f: File): Promise<DesignSource[]> {
  const r = await importFile(f, { pdfDpi: 300 });
  const wrap = (canvas: HTMLCanvasElement, dpi: number, name = r.name): DesignSource[] => {
    const t = trimCanvas(canvas);
    return t ? [{ id: uid('src'), name, canvas: t.canvas, dpi }] : [];
  };
  if (r.kind === 'raster') return wrap(r.canvas, r.dpi ?? 300);
  if (r.kind === 'vector') {
    // vectores: rasterizar a 300 ppp según su tamaño físico (96 ppp CSS si no lo declara)
    const k = 300 / (r.dpi ?? 96);
    return wrap(await rasterizeSvg(r.svg, Math.round(r.w * k), Math.round(r.h * k)), 300);
  }
  if (r.kind === 'pages') return r.pages.flatMap((p, i) => wrap(p, r.dpi, `${r.name} p${i + 1}`));
  if (r.kind === 'layers') {
    const ab: Artboard = { id: 'tmp', name: r.name, x: 0, y: 0, w: r.w, h: r.h, dpi: r.dpi ?? 300, background: null, margin: 0 };
    const st: DocState = { layers: r.layers, artboards: [ab], guides: [], selection: null, selectedLayerIds: [], activeArtboardId: ab.id };
    const s = await sourceFromArtboard(st, ab, r.name);
    return s ? [s] : [];
  }
  if (r.kind === 'project') {
    const doc = await deserializeDoc(await r.file.text());
    const out: DesignSource[] = [];
    for (const ab of doc.state.artboards) { const s = await sourceFromArtboard(doc.state, ab, `${doc.name} · ${ab.name}`); if (s) out.push(s); }
    return out;
  }
  return [];
}
