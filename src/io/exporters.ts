// Exportación real por formato: cada uno con sus características (alfa, DPI, CMYK, capas, vectores).

import type { Artboard, DocState, Layer } from '../core/types';
import { canvasToBlob, ctx2d, layerMatrix, layerSize, textLayout, decorationLines, createCanvas, getImageData } from '../core/util';
import { platform } from '../platform';
import { renderArtboard, processedContent, ensureProcessed, renderLayerAlone } from '../core/render';
import { childrenOf } from '../core/doc';
import { pngSetDpi, jpegSetDpi, encodeTiff, encodeBmp } from './binary';
import { rgbaToCmyk, cmsState, hasIcc } from '../engine/cms';
import { fontFaceCss } from './fonts';
import { svgGradientDef, dashArray, polygonPoints, lineGeometry, lineThickness, DEFAULT_STROKE_STYLE } from '../core/paint';

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
      // el SVG no tiene degradados angulares: esas capas se exportan como imagen
      const needsRaster = l.adjustments.some(a => a.enabled) || (l.mask && l.maskEnabled) || l.clip || l.shape?.fillGradient?.type === 'conic' || l.text?.gradient?.type === 'conic';
      const gid = `g-${l.id.replace(/[^\w-]/g, '')}`;
      parts.push(`<g transform="${tf}"${op}${blend}>`);
      if (!needsRaster && l.kind === 'vector' && l.vector) {
        // el <svg> raíz puede traer su propio tamaño: se quita para no repetir atributos (XML inválido)
        const svg = l.vector.svg.replace(/^\s*<\?xml[^>]*>/, '').replace(/<svg\b[^>]*>/, tag =>
          tag.replace(/\s(?:x|y|width|height)\s*=\s*(?:"[^"]*"|'[^']*')/g, '').replace(/^<svg/, `<svg x="0" y="0" width="${w}" height="${h}"`));
        parts.push(svg);
      } else if (!needsRaster && l.kind === 'text' && l.text) {
        const t = l.text;
        const gdef = t.gradient ? svgGradientDef(gid, t.gradient, w, h) : null;
        if (gdef) parts.push(`<defs>${gdef}</defs>`);
        const tfill = gdef ? `url(#${gid})` : t.color;
        // misma disposición que en pantalla: las líneas (ya cortadas y alineadas) empiezan en (ox, oy)
        const { ox, oy, base, lines, glyphs, pieces } = textLayout(t);
        const deco = decorationLines(t, base);
        const stroke = t.strokeWidth > 0 ? ` stroke="${t.strokeColor}" stroke-width="${t.strokeWidth * 2}" paint-order="stroke" stroke-linejoin="round"` : '';
        if (glyphs) {
          // texto en trayectoria: una letra por elemento, girada como en pantalla
          parts.push(`<g font-family="${esc(t.fontFamily)}" font-size="${t.fontSize}" font-weight="${t.fontWeight}"${t.italic ? ' font-style="italic"' : ''} fill="${tfill}"${stroke}>`);
          for (const q of glyphs) {
            if (!q.ch.trim()) continue;
            const x = +(ox + q.x).toFixed(2), y = +(oy + q.y).toFixed(2), deg = +((q.a * 180) / Math.PI).toFixed(3);
            parts.push(`<text x="${+(x - q.w / 2).toFixed(2)}" y="${y}" transform="rotate(${deg} ${x} ${y})">${esc(q.ch)}</text>`);
          }
          parts.push('</g></g>');
          continue;
        }
        parts.push(`<text xml:space="preserve" font-family="${esc(t.fontFamily)}" font-size="${t.fontSize}" font-weight="${t.fontWeight}"${t.italic ? ' font-style="italic"' : ''} letter-spacing="${t.letterSpacing}" fill="${tfill}"${stroke}>`);
        if (pieces) lines.forEach((ln, i) => {
          // fragmentos con otro estilo: un <tspan> por trozo con su tipografía y color
          const y = oy + ln.y + base;
          for (const p of pieces[i]) {
            if (!p.text) continue;
            const attrs = `${p.fontFamily !== t.fontFamily ? ` font-family="${esc(p.fontFamily)}"` : ''}${p.fontWeight !== t.fontWeight ? ` font-weight="${p.fontWeight}"` : ''}${p.italic !== t.italic ? ` font-style="${p.italic ? 'italic' : 'normal'}"` : ''}${p.color ? ` fill="${p.color}"` : ''}`;
            parts.push(`<tspan x="${+(ox + p.x).toFixed(2)}" y="${y}"${attrs}>${esc(p.text)}</tspan>`);
          }
        });
        else for (const ln of lines) {
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
          for (const dy of ys) parts.push(`<rect x="${ox + ln.x}" y="${oy + ln.y + dy}" width="${ln.width}" height="${deco.thickness}" fill="${tfill}"${stroke}/>`);
        }
      } else if (!needsRaster && l.kind === 'shape' && l.shape) {
        const s = l.shape;
        const ss = s.strokeStyle ?? DEFAULT_STROKE_STYLE;
        const sw = s.stroke ? s.strokeWidth : 0;
        const gdef = s.fillGradient ? svgGradientDef(gid, s.fillGradient, w, h) : null;
        if (gdef) parts.push(`<defs>${gdef}</defs>`);
        const fill = gdef ? `url(#${gid})` : s.fill || 'none';
        const lw = sw;
        const dash = dashArray(ss.dash, lw);
        const strokeAttrs = s.stroke
          ? ` stroke="${s.stroke}" stroke-width="${lw}"${ss.dash === 'dotted' ? ' stroke-linecap="round"' : ss.cap !== 'butt' ? ` stroke-linecap="${ss.cap}"` : ''}${ss.join !== 'miter' ? ` stroke-linejoin="${ss.join}"` : ''}${dash.length ? ` stroke-dasharray="${dash.map(v => +v.toFixed(3)).join(' ')}"` : ''}${ss.opacity < 1 ? ` stroke-opacity="${ss.opacity}"` : ''}`
          : '';
        // mismo dibujo que en pantalla: relleno hasta donde indique la posición del contorno, contorno a sw/2 del borde
        const fi = ss.align === 'outside' ? sw : ss.align === 'inside' ? 0 : sw / 2;
        const geom = (inset: number) => {
          if (s.shape === 'ellipse') return `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${Math.max(0.5, w / 2 - inset)}" ry="${Math.max(0.5, h / 2 - inset)}"`;
          if (s.shape === 'polygon' || s.shape === 'star') {
            const pts = polygonPoints(s.sides ?? (s.shape === 'star' ? 5 : 6), w, h, inset, s.shape === 'star' ? s.inner ?? 0.5 : undefined);
            return `<polygon points="${pts.map(p => `${+p.x.toFixed(3)},${+p.y.toFixed(3)}`).join(' ')}"`;
          }
          const r = Math.max(0, s.radius + (s.radius > 0 ? sw / 2 - inset : 0));
          return `<rect x="${inset}" y="${inset}" width="${Math.max(1, w - 2 * inset)}" height="${Math.max(1, h - 2 * inset)}" rx="${r}"`;
        };
        if (s.shape === 'line') {
          const t = lineThickness(s);
          const cap: CanvasLineCap = ss.dash === 'dotted' ? 'round' : ss.cap;
          const L = lineGeometry(w, h, t, s.arrowStart, s.arrowEnd, cap);
          const col = s.stroke || s.fill || '#ffffff';
          const f3 = (v: number) => +v.toFixed(3);
          const d = dashArray(ss.dash, t);
          const seg: string[] = [];
          if (L.x2 > L.x1) seg.push(`<line x1="${f3(L.x1)}" y1="${f3(L.y)}" x2="${f3(L.x2)}" y2="${f3(L.y)}" stroke="${col}" stroke-width="${t}"${cap !== 'butt' ? ` stroke-linecap="${cap}"` : ''}${d.length ? ` stroke-dasharray="${d.map(f3).join(' ')}"` : ''}/>`);
          for (const p of L.heads) {
            if (p.kind === 'circle') seg.push(`<circle cx="${f3(p.cx)}" cy="${f3(p.cy)}" r="${f3(p.r)}" fill="${col}"/>`);
            else if (p.kind === 'fill') seg.push(`<polygon points="${p.pts.map(q => `${f3(q.x)},${f3(q.y)}`).join(' ')}" fill="${col}"/>`);
            else seg.push(`<polyline points="${p.pts.map(q => `${f3(q.x)},${f3(q.y)}`).join(' ')}" fill="none" stroke="${col}" stroke-width="${t}" stroke-linejoin="round" stroke-linecap="round"/>`);
          }
          parts.push(ss.opacity < 1 ? `<g opacity="${ss.opacity}">${seg.join('')}</g>` : seg.join(''));
        } else if (fi === sw / 2) parts.push(`${geom(sw / 2)} fill="${fill}"${strokeAttrs}/>`);
        else {
          if (fill !== 'none') parts.push(`${geom(fi)} fill="${fill}"/>`);
          if (strokeAttrs) parts.push(`${geom(sw / 2)} fill="none"${strokeAttrs}/>`);
        }
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
      // las capas de ajuste de KOVA no tienen equivalente en PSD: su efecto va en la imagen compuesta
      if (l.kind === 'adjust') continue;
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
