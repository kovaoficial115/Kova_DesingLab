// Composición de párrafos: corta el texto en líneas que caben en el cuadro, las alinea y las
// justifica. Pura (recibe la función que mide): se usa al dibujar, al exportar a SVG y en tests.

import type { TextAlign } from './types';

export interface FlowInput {
  text: string;
  fontSize: number;
  lineHeight: number;
  align: TextAlign;
  /** margen interior (px) a cada lado: el mismo de siempre, strokeWidth + 2 */
  pad: number;
  box?: { w: number; h: number } | null;
  paraSpacing?: number;
  indent?: number;
}

export interface FlowLine {
  text: string;
  /** borde izquierdo del avance del texto, dentro de la caja de las líneas */
  x: number;
  /** línea superior del renglón (línea base 'top' del canvas) */
  y: number;
  /** ancho de la línea tal como se dibuja (justificada: el del hueco que ocupa) */
  width: number;
  /** justificada: posición x (relativa a `x`) de cada palabra */
  words?: { text: string; x: number }[];
  /** con `measureAt`: cada palabra con su posición en el texto y su x (relativa a `x`) */
  segs?: { text: string; start: number; x: number }[];
}

export interface Flow { lines: FlowLine[]; bw: number; bh: number }

interface Tok { text: string; start: number }
type MeasureAt = (s: string, start: number) => number;

/** Corta una palabra que no cabe ni sola en una línea, por caracteres. */
function splitLong(word: Tok, avail: number, measure: MeasureAt): Tok[] {
  const out: Tok[] = [];
  let cur = '', at = word.start, pos = word.start;
  for (const ch of Array.from(word.text)) {
    if (cur && measure(cur + ch, at) > avail) { out.push({ text: cur, start: at }); cur = ch; at = pos; } else cur += ch;
    pos += ch.length;
  }
  if (cur) out.push({ text: cur, start: at });
  return out;
}

/** Líneas (como listas de palabras) de un párrafo que caben en `avail` (la primera en `availFirst`). */
function wrap(para: string, paraStart: number, availFirst: number, avail: number, measure: MeasureAt, space: number): Tok[][] {
  if (!para.trim()) return [[]];
  const lines: Tok[][] = [];
  let cur: Tok[] = [], curW = 0;
  const room = () => (lines.length ? avail : availFirst);
  for (const m of para.matchAll(/[^ ]+/g)) {
    const raw: Tok = { text: m[0], start: paraStart + m.index! };
    const ww = measure(raw.text, raw.start);
    if (cur.length && curW + space + ww <= room()) { cur.push(raw); curW += space + ww; continue; }
    if (cur.length) { lines.push(cur); cur = []; curW = 0; }
    if (ww <= room()) { cur = [raw]; curW = ww; continue; }
    // palabra más larga que la línea: se parte
    const parts = splitLong(raw, room(), measure);
    for (let i = 0; i < parts.length - 1; i++) lines.push([parts[i]]);
    cur = [parts[parts.length - 1]]; curW = measure(cur[0].text, cur[0].start);
  }
  if (cur.length) lines.push(cur);
  return lines;
}

/** Alineación de la última línea de un párrafo (o de cualquier línea sin justificar). */
function plainAlign(a: TextAlign): 'left' | 'center' | 'right' {
  if (a === 'center' || a === 'justify-center') return 'center';
  if (a === 'right' || a === 'justify-right') return 'right';
  return 'left';
}

/**
 * `measure` mide con la tipografía del texto. Con `measureAt` (texto con fragmentos de otra
 * tipografía) cada palabra se mide según su posición y las líneas traen `segs`.
 */
export function flowText(t: FlowInput, measure: (s: string) => number, measureAt?: MeasureAt): Flow {
  const adv = t.fontSize * t.lineHeight;
  const pad = t.pad, indent = Math.max(0, t.indent ?? 0), paraGap = Math.max(0, t.paraSpacing ?? 0);
  const box = t.box && t.box.w > 0 ? t.box : null;
  const paras = t.text.split('\n');
  const justify = t.align.startsWith('justify');
  const m: MeasureAt = measureAt ?? (s => measure(s));
  const space = measure(' ');
  // líneas de cada párrafo (sin cuadro: un párrafo = una línea)
  const inner = box ? Math.max(1, box.w - 2 * pad) : Infinity;
  let at = 0;
  const blocks: Tok[][][] = paras.map(p => {
    const start = at;
    at += p.length + 1;
    if (box) return wrap(p, start, Math.max(1, inner - indent), inner, m, space);
    return [[{ text: p, start }]];
  });
  const textOf = (ls: Tok[]) => (box ? ls.map(k => k.text).join(' ') : ls[0]?.text ?? '');
  // ancho de una línea: de una vez (respeta el interletraje) o, con fragmentos, palabra a palabra
  const segsOf = (ls: Tok[]) => {
    if (!box) {
      // sin cuadro la línea es el párrafo tal cual (con sus espacios): un trozo por palabra
      const p = ls[0];
      if (!p?.text) return [];
      const out: { text: string; start: number; x: number }[] = [];
      let x = 0, last = 0;
      for (const w of p.text.matchAll(/[^ ]+/g)) {
        x += (w.index! - last) * space;
        out.push({ text: w[0], start: p.start + w.index!, x });
        x += m(w[0], p.start + w.index!);
        last = w.index! + w[0].length;
      }
      return out;
    }
    let x = 0;
    return ls.map((k, i) => { if (i) x += space; const at2 = x; x += m(k.text, k.start); return { text: k.text, start: k.start, x: at2 }; });
  };
  const widthOf = (ls: Tok[]) => {
    const text = textOf(ls);
    if (!text) return 0;
    if (!measureAt) return measure(text);
    const sg = segsOf(ls), lastSeg = sg[sg.length - 1];
    if (!lastSeg) return text.length * space;
    const tail = box ? 0 : (ls[0].text.length - (lastSeg.start - ls[0].start) - lastSeg.text.length) * space;
    return lastSeg.x + m(lastSeg.text, lastSeg.start) + tail;
  };
  const widths = blocks.map(ls => ls.map(widthOf));
  // como antes: un texto vacío ocupa al menos un espacio
  const maxW = Math.max(space, ...blocks.flatMap((ls, i) => ls.map((_, j) => widths[i][j] + (j === 0 ? indent : 0))));
  const bw = box ? box.w : Math.ceil(maxW + 2 * pad);
  const lines: FlowLine[] = [];
  let row = 0;
  blocks.forEach((ls, pi) => {
    ls.forEach((toks, li) => {
      const text = textOf(toks);
      const first = li === 0, last = li === ls.length - 1;
      const x0 = pad + (first ? indent : 0), x1 = bw - pad, room = x1 - x0, w = widths[pi][li];
      const y = pad + row * adv + pi * paraGap + (t.fontSize * (t.lineHeight - 1)) / 2;
      row++;
      const words = box ? toks : [];
      const spread = box && justify && words.length > 1 && (!last || t.align === 'justify') && room > w;
      if (spread) {
        // reparte el sobrante entre los huecos entre palabras
        const ww = words.map(k => m(k.text, k.start)), total = ww.reduce((a, b) => a + b, 0);
        const gap = (room - total) / (words.length - 1);
        let cx = 0;
        const placed = words.map((wd, k) => { const at2 = cx; cx += ww[k] + gap; return { text: wd.text, start: wd.start, x: at2 }; });
        lines.push({ text, x: x0, y, width: room, words: placed.map(({ text, x }) => ({ text, x })), ...(measureAt ? { segs: placed } : {}) });
        return;
      }
      const a = plainAlign(t.align);
      const x = a === 'left' ? x0 : a === 'center' ? x0 + (room - w) / 2 : x1 - w;
      lines.push({ text, x, y, width: w, ...(measureAt ? { segs: segsOf(toks) } : {}) });
    });
  });
  const contentH = Math.ceil(row * adv + (paras.length - 1) * paraGap + 2 * pad);
  const bh = box ? Math.max(Math.ceil(box.h), contentH) : contentH;
  return { lines, bw, bh };
}
