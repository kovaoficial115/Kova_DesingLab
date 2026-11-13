// Exportación real por formato: cada uno con sus características (alfa, DPI, CMYK, capas, vectores).

import type { Artboard, DocState, Layer } from '../core/types';
import { canvasToBlob, ctx2d, layerMatrix, layerSize, textLayout, decorationLines, createCanvas, getImageData } from '../core/util';
import { platform } from '../platform';
import { renderArtboard, processedContent, ensureProcessed, renderLayerAlone } from '../core/render';
import { childrenOf } from '../core/doc';
import { pngSetDpi, jpegSetDpi, encodeTiff, encodeBmp } from './binary';
import { rgbaToCmyk, cmsState, hasIcc } from '../engine/cms';
import { fontFaceCss } from './fonts';

export type ExportFormat = 'png' | 'jpg' | 'webp' | 'tiff' | 'tiff-cmyk' | 'bmp' | 'svg' | 'pdf' | 'psd';

export interface ExportOptions {
  format: ExportFormat;
  dpi: number; // DPI de salida
  quality: number; // 0..1
  background: 'transparent' | 'white' | 'artboard';
  filename: string;
}

export const formatInfo: Record<ExportFormat, { label: string; ext: string; alpha: boolean; note: string }> = {
  png: { label: 'PNG (transparencia)', ext: 'png', alpha: true, note: 'Sin pérdida, alfa completo y DPI incrustado (pHYs). Recomendado para DTF.' },
  jpg: { label: 'JPG', ext: 'jpg', alpha: false, note: 'Con pérdida, sin transparencia. DPI en cabecera JFIF.' },
  webp: { label: 'WEBP', ext: 'webp', alpha: true, note: 'Compresión moderna con alfa. No guarda DPI.' },
  tiff: { label: 'TIFF RGB(A)', ext: 'tif', alpha: true, note: 'Sin compresión, alfa no asociado, DPI incrustado.' },
  'tiff-cmyk': { label: 'TIFF CMYK', ext: 'tif', alpha: false, note: 'Separación CMYK real; incrusta el perfil ICC si hay uno cargado.' },
  bmp: { label: 'BMP 32 bits', ext: 'bmp', alpha: true, note: 'Sin compresión con canal alfa.' },
  svg: { label: 'SVG', ext: 'svg', alpha: true, note: 'Vectores, textos y formas nativos; los rasters se incrustan.' },
  pdf: { label: 'PDF', ext: 'pdf', alpha: true, note: 'Página al tamaño físico de la mesa con la imagen a la resolución de salida.' },
  psd: { label: 'PSD (capas)', ext: 'psd', alpha: true, note: 'Conserva capas, grupos, opacidad y modos de fusión.' },
};

export async function rasterFor(state: DocState, ab: Artboard, o: ExportOptions) {
  const scale = o.dpi / ab.dpi;
  const c = await renderArtboard(state, ab, scale, { background: o.background === 'artboard' });
  const needFill = o.background === 'white' || !formatInfo[o.format].alpha;
  if (!needFill) return c;
  const out = createCanvas(c.width, c.height);
  const g = ctx2d(out);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, out.width, out.height);
  g.drawImage(c, 0, 0);
  return out;
}

export async function exportArtboard(state: DocState, ab: Artboard, o: ExportOptions): Promise<Blob> {
  switch (o.format) {
    case 'png': {
      const c = await rasterFor(state, ab, o);
      const blob = await canvasToBlob(c, 'image/png');
      return new Blob([pngSetDpi(new Uint8Array(await blob.arrayBuffer()), o.dpi)], { type: 'image/png' });
    }
    case 'jpg': {
      const c = await rasterFor(state, ab, o);
      const blob = await canvasToBlob(c, 'image/jpeg', o.quality);
      return new Blob([jpegSetDpi(new Uint8Array(await blob.arrayBuffer()), o.dpi)], { type: 'image/jpeg' });
    }
    case 'webp': {
      const c = await rasterFor(state, ab, o);
      const blob = await canvasToBlob(c, 'image/webp', o.quality);
      if (blob.type !== 'image/webp') throw new Error('Este navegador no puede codificar WEBP');
      return blob;
    }
    case 'tiff': {
      const c = await rasterFor(state, ab, o);
      const img = getImageData(c);
      const hasAlpha = o.background === 'transparent';
      let px: Uint8Array;
      if (hasAlpha) px = new Uint8Array(img.data.buffer);
      else {
        px = new Uint8Array(c.width * c.height * 3);
        for (let j = 0, i = 0; i < img.data.length; i += 4) { px[j++] = img.data[i]; px[j++] = img.data[i + 1]; px[j++] = img.data[i + 2]; }
      }
      return new Blob([encodeTiff(px, c.width, c.height, hasAlpha ? 'rgba' : 'rgb', o.dpi)], { type: 'image/tiff' });
    }
    case 'tiff-cmyk': {
      const c = await rasterFor(state, ab, { ...o, background: o.background === 'transparent' ? 'white' : o.background });
      const img = getImageData(c);
      const cmyk = rgbaToCmyk(img.data);
      return new Blob([encodeTiff(cmyk, c.width, c.height, 'cmyk', o.dpi, hasIcc() ? cmsState.profileBytes : null)], { type: 'image/tiff' });
    }
    case 'bmp': {
      const c = await rasterFor(state, ab, o);
      return new Blob([encodeBmp(getImageData(c).data, c.width, c.height, o.dpi)], { type: 'image/bmp' });
    }
    case 'svg': return new Blob([await buildSvg(state, ab)], { type: 'image/svg+xml' });
    case 'pdf': {
      const { jsPDF } = await import('jspdf');
      const c = await rasterFor(state, ab, o);
      const wmm = (ab.w / ab.dpi) * 25.4, hmm = (ab.h / ab.dpi) * 25.4;
      const pdf = new jsPDF({ unit: 'mm', format: [wmm, hmm], orientation: wmm > hmm ? 'landscape' : 'portrait', compress: true });
      pdf.addImage(c, 'PNG', 0, 0, wmm, hmm, undefined, 'FAST');
      pdf.setProperties({ title: o.filename, creator: 'Kova_DesignLab' });
      return pdf.output('blob');
    }
    case 'psd': return new Blob([await buildPsd(state, ab, o.dpi)], { type: 'image/vnd.adobe.photoshop' });
  }
}

export async function exportAndDownload(state: DocState, abs: Artboard[], o: ExportOptions) {
  for (const ab of abs) {
    const blob = await exportArtboard(state, ab, o);
    const suffix = abs.length > 1 ? `-${ab.name.replace(/[^\w-]+/g, '_')}` : '';
    const name = `${o.filename}${suffix}.${formatInfo[o.format].ext}`;
    // con una sola mesa se ofrece elegir la ubicación; con varias, se descargan todas
    const r = await platform.saveFile(blob, { suggestedName: name, pick: abs.length === 1 });
    if (r.status === 'cancelled') return false;
  }
  return true;
}

// ---------- SVG ----------
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function buildSvg(state: DocState, ab: Artboard) {
  await ensureProcessed(state.layers);
  const wmm = (ab.w / ab.dpi) * 25.4, hmm = (ab.h / ab.dpi) * 25.4;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${wmm.toFixed(3)}mm" height="${hmm.toFixed(3)}mm" viewBox="${ab.x} ${ab.y} ${ab.w} ${ab.h}">`);
  const css = fontFaceCss(state.layers.filter(l => l.kind === 'text' && l.text).map(l => l.text!.fontFamily));
  if (css) parts.push(`<defs><style>${css}</style></defs>`);
  if (ab.background) parts.push(`<rect x="${ab.x}" y="${ab.y}" width="${ab.w}" height="${ab.h}" fill="${ab.background}"/>`);
  const walk = async (list: Layer[]) => {
    for (const l of list) {
      if (!l.visible) continue;
      const blend = l.blend !== 'source-over' ? ` style="mix-blend-mode:${l.blend}"` : '';
      const op = l.opacity < 1 ? ` opacity="${l.opacity}"` : '';
      if (l.kind === 'group') {
        parts.push(`<g id="${esc(l.name)}"${op}${blend}>`);
        await walk(childrenOf(state.layers, l.id));
        parts.push('</g>');
        continue;
      }
      const m = layerMatrix(l);
      const tf = `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`;
      const { w, h } = layerSize(l);
      const needsRaster = l.adjustments.some(a => a.enabled) || (l.mask && l.maskEnabled) || l.clip;
      parts.push(`<g transform="${tf}"${op}${blend}>`);
      if (!needsRaster && l.kind === 'vector' && l.vector) {
        parts.push(l.vector.svg.replace(/^<\?xml[^>]*>/, '').replace(/<svg/, `<svg x="0" y="0" width="${w}" height="${h}"`));
      } else if (!needsRaster && l.kind === 'text' && l.text) {
        const t = l.text;
        // misma disposición que en pantalla: las líneas (ya cortadas y alineadas) empiezan en (ox, oy)
        const { ox, oy, base, lines } = textLayout(t);
        const deco = decorationLines(t, base);
        const stroke = t.strokeWidth > 0 ? ` stroke="${t.strokeColor}" stroke-width="${t.strokeWidth * 2}" paint-order="stroke" stroke-linejoin="round"` : '';
        parts.push(`<text xml:space="preserve" font-family="${esc(t.fontFamily)}" font-size="${t.fontSize}" font-weight="${t.fontWeight}"${t.italic ? ' font-style="italic"' : ''} letter-spacing="${t.letterSpacing}" fill="${t.color}"${stroke}>`);
        for (const ln of lines) {
          if (!ln.text) continue;
          const y = oy + ln.y + base;
          if (ln.words) for (const wd of ln.words) parts.push(`<tspan x="${ox + ln.x + wd.x}" y="${y}">${esc(wd.text)}</tspan>`);
          else parts.push(`<tspan x="${ox + ln.x}" y="${y}">${esc(ln.text)}</tspan>`);
        }
        parts.push('</text>');
        // subrayado y tachado: rectángulos del mismo color (y contorno) que el texto
        for (const ln of lines) {
          if (!ln.text) continue;
          const ys = [t.underline ? deco.underline : null, t.strike ? deco.strike : null].filter((v): v is number => v !== null);
          for (const dy of ys) parts.push(`<rect x="${ox + ln.x}" y="${oy + ln.y + dy}" width="${ln.width}" height="${deco.thickness}" fill="${t.color}"${stroke}/>`);
        }
      } else if (!needsRaster && l.kind === 'shape' && l.shape) {
        const s = l.shape;
        const sw = s.stroke ? s.strokeWidth : 0;
        const fill = s.fill && s.shape !== 'line' ? s.fill : 'none';
        const stroke = s.stroke || s.shape === 'line' ? ` stroke="${s.stroke || s.fill}" stroke-width="${s.shape === 'line' ? s.h : sw}"` : '';
        if (s.shape === 'ellipse') parts.push(`<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2 - sw / 2}" ry="${h / 2 - sw / 2}" fill="${fill}"${stroke}/>`);
        else if (s.shape === 'line') parts.push(`<line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}"${stroke}/>`);
        else parts.push(`<rect x="${sw / 2}" y="${sw / 2}" width="${w - sw}" height="${h - sw}" rx="${s.radius}" fill="${fill}"${stroke}/>`);
      } else {
        const src = processedContent(l);
        if (src) {
          const blob = await canvasToBlob(src, 'image/png');
          const url = await new Promise<string>(r => { const fr = new FileReader(); fr.onload = () => r(fr.result as string); fr.readAsDataURL(blob); });
          parts.push(`<image width="${w}" height="${h}" preserveAspectRatio="none" href="${url}"/>`);
        }
      }
      parts.push('</g>');
    }
  };
  await walk(childrenOf(state.layers, null));
  parts.push('</svg>');
  return parts.join('\n');
}

// ---------- PSD ----------
const psdBlendOut: Record<string, string> = {
  'source-over': 'normal', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten',
  'color-dodge': 'color dodge', 'color-burn': 'color burn', 'hard-light': 'hard light', 'soft-light': 'soft light',
  difference: 'difference', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity',
};

async function buildPsd(state: DocState, ab: Artboard, dpi: number): Promise<ArrayBuffer> {
  const { writePsd } = await import('ag-psd');
  const scale = dpi / ab.dpi;
  const W = Math.round(ab.w * scale), H = Math.round(ab.h * scale);
  const walk = async (list: Layer[]): Promise<any[]> => {
    const out: any[] = [];
    for (const l of list) {
      if (l.kind === 'group') {
        out.push({ name: l.name, hidden: !l.visible, opacity: l.opacity, blendMode: psdBlendOut[l.blend], opened: !l.collapsed, children: await walk(childrenOf(state.layers, l.id)) });
        continue;
      }
      const { canvas, bounds } = await renderLayerAlone({ ...state, layers: state.layers.map(x => (x.id === l.id ? { ...x, opacity: 1, blend: 'source-over', visible: true, parentId: null, clip: false } : x)) }, { ...l, opacity: 1, visible: true, parentId: null, clip: false }, scale);
      out.push({
        name: l.name, hidden: !l.visible, opacity: l.opacity, blendMode: psdBlendOut[l.blend], clipping: l.clip,
        left: Math.round((bounds.x - ab.x) * scale), top: Math.round((bounds.y - ab.y) * scale), canvas,
      });
    }
    return out;
  };
  const children = await walk(childrenOf(state.layers, null));
  const composite = await renderArtboard(state, ab, scale, { background: true });
  const psd: any = {
    width: W, height: H, children, canvas: composite,
    imageResources: { resolutionInfo: { horizontalResolution: dpi, horizontalResolutionUnit: 'PPI', widthUnit: 'Centimeters', verticalResolution: dpi, verticalResolutionUnit: 'PPI', heightUnit: 'Centimeters' } },
  };
  return writePsd(psd, { generateThumbnail: true });
}
