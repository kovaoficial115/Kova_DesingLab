// Importación: PNG, JPG, WEBP, BMP, GIF, SVG, TIFF (UTIF), PSD con capas (ag-psd), PDF (pdf.js) y .kova.

import type { BlendMode, Layer } from '../core/types';
import { blobToCanvas, createCanvas, ctx2d, cloneCanvas } from '../core/util';
import { rasterLayer, groupLayer, vectorLayer } from '../core/doc';
import { pngReadDpi, jpegReadDpi } from './binary';

export type ImportResult =
  | { kind: 'raster'; name: string; canvas: HTMLCanvasElement; dpi: number | null }
  | { kind: 'vector'; name: string; svg: string; w: number; h: number; dpi: number | null }
  | { kind: 'layers'; name: string; layers: Layer[]; w: number; h: number; dpi: number | null }
  | { kind: 'pages'; name: string; pages: HTMLCanvasElement[]; dpi: number }
  | { kind: 'project'; name: string; file: File };

export const ACCEPT = '.png,.jpg,.jpeg,.webp,.bmp,.gif,.svg,.tif,.tiff,.psd,.pdf,.kova,image/*,application/pdf';

const ext = (n: string) => n.toLowerCase().split('.').pop() || '';
const baseName = (n: string) => n.replace(/\.[^.]+$/, '');

export async function importFile(file: File, opts: { pdfDpi?: number } = {}): Promise<ImportResult> {
  const e = ext(file.name);
  const name = baseName(file.name);
  if (e === 'kova' || e === 'json') return { kind: 'project', name, file };
  if (e === 'svg' || file.type === 'image/svg+xml') return importSvg(await file.text(), name);
  if (e === 'tif' || e === 'tiff') return importTiff(new Uint8Array(await file.arrayBuffer()), name);
  if (e === 'psd') return importPsd(await file.arrayBuffer(), name);
  if (e === 'pdf' || file.type === 'application/pdf') return importPdf(await file.arrayBuffer(), name, opts.pdfDpi ?? 300);
  const head = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
  const dpi = pngReadDpi(head) ?? jpegReadDpi(head);
  const canvas = await blobToCanvas(file);
  return { kind: 'raster', name, canvas, dpi };
}

export function importSvg(text: string, name: string): ImportResult {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.nodeName.toLowerCase() !== 'svg') throw new Error('SVG no válido');
  const toPx = (v: string | null): { px: number; physical: boolean } | null => {
    if (!v) return null;
    const m = v.trim().match(/^([\d.]+)\s*(px|pt|mm|cm|in|%)?$/);
    if (!m || m[2] === '%') return null;
    const n = parseFloat(m[1]);
    const u = m[2] || 'px';
    const f: Record<string, number> = { px: 1, pt: 96 / 72, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };
    return { px: n * f[u], physical: u !== 'px' };
  };
  const vb = svg.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
  let w = toPx(svg.getAttribute('width')), h = toPx(svg.getAttribute('height'));
  const vw = vb?.[2] || 1000, vh = vb?.[3] || 1000;
  if (!w && !h) { w = { px: vw, physical: false }; h = { px: vh, physical: false }; }
  else if (!w) w = { px: (h!.px * vw) / vh, physical: h!.physical };
  else if (!h) h = { px: (w.px * vh) / vw, physical: w.physical };
  if (!vb) svg.setAttribute('viewBox', `0 0 ${w!.px} ${h!.px}`);
  svg.setAttribute('width', String(w!.px));
  svg.setAttribute('height', String(h!.px));
  svg.setAttribute('preserveAspectRatio', 'none');
  if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const out = new XMLSerializer().serializeToString(svg);
  // unidades físicas → el tamaño se expresa a 96 ppp; el llamador lo adapta al DPI de la mesa
  return { kind: 'vector', name, svg: out, w: w!.px, h: h!.px, dpi: w!.physical ? 96 : null };
}

export async function importTiff(buf: Uint8Array, name: string): Promise<ImportResult> {
  const UTIF: any = (await import('utif')).default ?? (await import('utif'));
  const ifds = UTIF.decode(buf);
  if (!ifds.length) throw new Error('TIFF sin imágenes');
  const ifd = ifds[0];
  UTIF.decodeImage(buf, ifd, ifds);
  const rgba = UTIF.toRGBA8(ifd);
  const w = ifd.width, h = ifd.height;
  const c = createCanvas(w, h);
  ctx2d(c).putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, w * h * 4), w, h), 0, 0);
  let dpi: number | null = null;
  const xr = ifd.t282?.[0];
  if (xr) {
    const v = Array.isArray(xr) ? xr[0] / (xr[1] || 1) : xr;
    dpi = ifd.t296?.[0] === 3 ? Math.round(v * 2.54) : Math.round(v);
  }
  return { kind: 'raster', name, canvas: c, dpi };
}

const psdBlend: Record<string, BlendMode> = {
  normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten',
  'color dodge': 'color-dodge', 'color burn': 'color-burn', 'hard light': 'hard-light', 'soft light': 'soft-light',
  difference: 'difference', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity',
};

export async function importPsd(buf: ArrayBuffer, name: string): Promise<ImportResult> {
  const { readPsd } = await import('ag-psd');
  const psd: any = readPsd(buf, { skipThumbnail: true });
  const layers: Layer[] = [];
  const walk = (children: any[], parentId: string | null) => {
    for (const ch of children) {
      if (ch.children) {
        const g = { ...groupLayer(ch.name || 'Grupo'), parentId, visible: !ch.hidden, opacity: ch.opacity ?? 1, blend: psdBlend[ch.blendMode] ?? 'source-over', collapsed: !ch.opened };
        layers.push(g);
        walk(ch.children, g.id);
      } else if (ch.canvas && ch.canvas.width > 0 && ch.canvas.height > 0) {
        const l = rasterLayer(cloneCanvas(ch.canvas), ch.name || 'Capa', ch.left ?? 0, ch.top ?? 0);
        layers.push({ ...l, parentId, visible: !ch.hidden, opacity: ch.opacity ?? 1, blend: psdBlend[ch.blendMode] ?? 'source-over', clip: !!ch.clipping });
      }
    }
  };
  if (psd.children?.length) walk(psd.children, null);
  else if (psd.canvas) layers.push(rasterLayer(cloneCanvas(psd.canvas), 'Fondo', 0, 0));
  const res = psd.imageResources?.resolutionInfo;
  let dpi: number | null = null;
  if (res?.horizontalResolution) dpi = Math.round(res.horizontalResolutionUnit === 'PPCM' ? res.horizontalResolution * 2.54 : res.horizontalResolution);
  return { kind: 'layers', name, layers, w: psd.width, h: psd.height, dpi };
}

export async function importPdf(buf: ArrayBuffer, name: string, dpi: number): Promise<ImportResult> {
  const pdfjs: any = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages: HTMLCanvasElement[] = [];
  const count = Math.min(pdf.numPages, 20);
  for (let i = 1; i <= count; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: dpi / 72 });
    const c = createCanvas(viewport.width, viewport.height);
    await page.render({ canvasContext: ctx2d(c), viewport, background: 'rgba(0,0,0,0)' }).promise;
    pages.push(c);
  }
  return { kind: 'pages', name, pages, dpi };
}

export function svgLayerFrom(r: Extract<ImportResult, { kind: 'vector' }>, targetDpi: number) {
  const scale = r.dpi ? targetDpi / r.dpi : 1;
  const l = vectorLayer(r.svg, r.w, r.h, r.name);
  return { ...l, scaleX: scale, scaleY: scale };
}
