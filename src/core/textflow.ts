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
}

export interface Flow { lines: FlowLine[]; bw: number; bh: number }

const SPACES = / +/;

/** Corta una palabra que no cabe ni sola en una línea, por caracteres. */
function splitLong(word: string, avail: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const ch of Array.from(word)) {
    if (cur && measure(cur + ch) > avail) { out.push(cur); cur = ch; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** Líneas de un párrafo que caben en `avail` (la primera en `availFirst`). */
function wrap(para: string, availFirst: number, avail: number, measure: (s: string) => number): string[] {
  if (!para.trim()) return [''];
  const space = measure(' ');
  const lines: string[] = [];
  let cur: string[] = [], curW = 0;
  const room = () => (lines.length ? avail : availFirst);
  for (const raw of para.split(SPACES)) {
    if (!raw) continue;
    const ww = measure(raw);
    if (cur.length && curW + space + ww <= room()) { cur.push(raw); curW += space + ww; continue; }
    if (cur.length) { lines.push(cur.join(' ')); cur = []; curW = 0; }
    if (ww <= room()) { cur = [raw]; curW = ww; continue; }
    // palabra más larga que la línea: se parte
    const parts = splitLong(raw, room(), measure);
    for (let i = 0; i < parts.length - 1; i++) lines.push(parts[i]);
    cur = [parts[parts.length - 1]]; curW = measure(cur[0]);
  }
  if (cur.length) lines.push(cur.join(' '));
  return lines;
}

/** Alineación de la última línea de un párrafo (o de cualquier línea sin justificar). */
function plainAlign(a: TextAlign): 'left' | 'center' | 'right' {
  if (a === 'center' || a === 'justify-center') return 'center';
  if (a === 'right' || a === 'justify-right') return 'right';
  return 'left';
}

export function flowText(t: FlowInput, measure: (s: string) => number): Flow {
  const adv = t.fontSize * t.lineHeight;
  const pad = t.pad, indent = Math.max(0, t.indent ?? 0), paraGap = Math.max(0, t.paraSpacing ?? 0);
  const box = t.box && t.box.w > 0 ? t.box : null;
  const paras = t.text.split('\n');
  const justify = t.align.startsWith('justify');
  // líneas de cada párrafo (sin cuadro: un párrafo = una línea)
  const inner = box ? Math.max(1, box.w - 2 * pad) : Infinity;
  const blocks = paras.map(p => (box ? wrap(p, Math.max(1, inner - indent), inner, measure) : [p]));
  const widths = blocks.map(ls => ls.map(ln => (ln ? measure(ln) : 0)));
  // como antes: un texto vacío ocupa al menos un espacio
  const maxW = Math.max(measure(" "), ...blocks.flatMap((ls, i) => ls.map((_, j) => widths[i][j] + (j === 0 ? indent : 0))));
  const bw = box ? box.w : Math.ceil(maxW + 2 * pad);
  const lines: FlowLine[] = [];
  let row = 0;
  blocks.forEach((ls, pi) => {
    ls.forEach((text, li) => {
      const first = li === 0, last = li === ls.length - 1;
      const x0 = pad + (first ? indent : 0), x1 = bw - pad, room = x1 - x0, w = widths[pi][li];
      const y = pad + row * adv + pi * paraGap + (t.fontSize * (t.lineHeight - 1)) / 2;
      row++;
      const words = text.split(SPACES).filter(Boolean);
      const spread = box && justify && words.length > 1 && (!last || t.align === 'justify') && room > w;
      if (spread) {
        // reparte el sobrante entre los huecos entre palabras
        const ww = words.map(measure), total = ww.reduce((a, b) => a + b, 0);
        const gap = (room - total) / (words.length - 1);
        let cx = 0;
        const placed = words.map((wd, k) => { const at = cx; cx += ww[k] + gap; return { text: wd, x: at }; });
        lines.push({ text, x: x0, y, width: room, words: placed });
        return;
      }
      const a = plainAlign(t.align);
      const x = a === 'left' ? x0 : a === 'center' ? x0 + (room - w) / 2 : x1 - w;
      lines.push({ text, x, y, width: w });
    });
  });
  const contentH = Math.ceil(row * adv + (paras.length - 1) * paraGap + 2 * pad);
  const bh = box ? Math.max(Math.ceil(box.h), contentH) : contentH;
  return { lines, bw, bh };
}
