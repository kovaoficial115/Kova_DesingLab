// Fragmentos de un texto con estilo propio (tipografía, peso, cursiva y color distintos del resto).
// Cada fragmento cubre [start, end) del texto (índices UTF-16, como los de un <textarea>); no se
// solapan y van ordenados. Lo que no define un fragmento se hereda del texto. Funciones puras.

export interface TextRun {
  start: number;
  end: number;
  color?: string;
  fontFamily?: string;
  fontWeight?: number;
  italic?: boolean;
}
export type RunStyle = Omit<TextRun, 'start' | 'end'>;
/** Cambio de estilo: `null` quita esa propiedad del fragmento (vuelve a la del texto). */
export type RunPatch = { [K in keyof RunStyle]?: RunStyle[K] | null };

const KEYS: (keyof RunStyle)[] = ['color', 'fontFamily', 'fontWeight', 'italic'];
const HEX = /^#[0-9a-f]{6}$/i;

const styleOf = (r: RunStyle): RunStyle => {
  const o: RunStyle = {};
  for (const k of KEYS) if (r[k] !== undefined && r[k] !== null) (o as any)[k] = r[k];
  return o;
};
const sameStyle = (a: RunStyle, b: RunStyle) => KEYS.every(k => a[k] === b[k]);
const isEmpty = (r: RunStyle) => KEYS.every(k => r[k] === undefined);

/** Ordena, recorta al texto, quita lo vacío y lo solapado, y une fragmentos contiguos iguales. */
export function normalizeRuns(runs: readonly TextRun[] | undefined, len: number): TextRun[] {
  if (!runs?.length) return [];
  const out: TextRun[] = [];
  let edge = 0;
  for (const r of [...runs].sort((a, b) => a.start - b.start)) {
    const start = Math.max(edge, Math.max(0, Math.min(len, Math.round(r.start))));
    const end = Math.max(0, Math.min(len, Math.round(r.end)));
    const st = styleOf(r);
    if (end <= start || isEmpty(st)) continue;
    const prev = out[out.length - 1];
    if (prev && prev.end === start && sameStyle(prev, st)) prev.end = end;
    else out.push({ start, end, ...st });
    edge = end;
  }
  return out;
}

/** Estilo propio del carácter en `i` (vacío si no está en ningún fragmento). */
export function styleAt(runs: readonly TextRun[], i: number): RunStyle {
  const r = runs.find(x => x.start <= i && i < x.end);
  return r ? styleOf(r) : {};
}

/** Aplica `patch` a [start, end) respetando el resto de estilos de cada trozo. */
export function applyRunStyle(runs: readonly TextRun[] | undefined, start: number, end: number, patch: RunPatch, len: number): TextRun[] {
  const base = normalizeRuns(runs, len);
  const a = Math.max(0, Math.min(len, Math.min(start, end))), b = Math.max(0, Math.min(len, Math.max(start, end)));
  if (b <= a) return base;
  const cuts = new Set<number>([a, b]);
  for (const r of base) { cuts.add(r.start); cuts.add(r.end); }
  const pts = [...cuts].sort((x, y) => x - y);
  const out: TextRun[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const s = pts[i], e = pts[i + 1];
    let st = styleAt(base, s);
    if (s >= a && e <= b) {
      st = { ...st };
      for (const k of KEYS) if (k in patch) { const v = patch[k]; if (v === null || v === undefined) delete st[k]; else (st as any)[k] = v; }
    }
    if (!isEmpty(st)) out.push({ start: s, end: e, ...st });
  }
  return normalizeRuns(out, len);
}

/**
 * Ajusta los fragmentos tras editar el texto (de `before` a `after`): lo que va detrás del cambio se
 * desplaza, lo borrado desaparece y lo que se escribe justo al final de un fragmento lo continúa.
 */
export function adjustRuns(runs: readonly TextRun[] | undefined, before: string, after: string): TextRun[] | undefined {
  if (!runs?.length) return runs as TextRun[] | undefined;
  let a = 0;
  const max = Math.min(before.length, after.length);
  while (a < max && before[a] === after[a]) a++;
  let sfx = 0;
  while (sfx < max - a && before[before.length - 1 - sfx] === after[after.length - 1 - sfx]) sfx++;
  const oldE = before.length - sfx, newE = after.length - sfx, delta = newE - oldE;
  const map = (p: number, isEnd: boolean) => (p < a ? p : p >= oldE ? p + delta : isEnd ? newE : a);
  const out = runs.map(r => ({ ...r, start: map(r.start, false), end: map(r.end, true) }));
  const n = normalizeRuns(out, after.length);
  return n.length ? n : undefined;
}

/** Trozos de `text` (que empieza en `start` del texto completo) separados por los fragmentos. */
export function splitByRuns(text: string, start: number, runs: readonly TextRun[]): { text: string; start: number; style: RunStyle }[] {
  if (!runs.length || !text) return [{ text, start, style: {} }];
  const end = start + text.length;
  const cuts = new Set<number>([start, end]);
  for (const r of runs) { if (r.start > start && r.start < end) cuts.add(r.start); if (r.end > start && r.end < end) cuts.add(r.end); }
  const pts = [...cuts].sort((x, y) => x - y);
  const out: { text: string; start: number; style: RunStyle }[] = [];
  for (let i = 0; i < pts.length - 1; i++) out.push({ text: text.slice(pts[i] - start, pts[i + 1] - start), start: pts[i], style: styleAt(runs, pts[i]) });
  return out;
}

/** Saneado al abrir archivos de cualquier origen. */
export function sanitizeRuns(v: unknown, len: number): TextRun[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const ok = v.slice(0, 2000).filter(r => r && typeof r === 'object' && Number.isFinite(r.start) && Number.isFinite(r.end)).map((r: any) => {
    const o: TextRun = { start: r.start, end: r.end };
    if (typeof r.color === 'string' && HEX.test(r.color)) o.color = r.color;
    if (typeof r.fontFamily === 'string' && r.fontFamily.length < 200 && !/[;{}<>]/.test(r.fontFamily)) o.fontFamily = r.fontFamily;
    if (Number.isFinite(r.fontWeight) && r.fontWeight >= 100 && r.fontWeight <= 1000) o.fontWeight = Math.round(r.fontWeight);
    if (typeof r.italic === 'boolean') o.italic = r.italic;
    return o;
  });
  const n = normalizeRuns(ok, len);
  return n.length ? n : undefined;
}
