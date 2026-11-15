// Behance Project Builder: datos y cálculos puros (sin DOM).
//
// Un proyecto es un grupo de mesas de trabajo («secciones») con el mismo ancho, apiladas en
// vertical en el orden de lectura. Cada sección guarda en `Artboard.behance` el proyecto al que
// pertenece y su posición; el nombre de la sección es el de la mesa. Así entra en deshacer/rehacer,
// en el .kova y en la colaboración igual que las series de Social Design Studio.
//
//  - Modo continuo: las secciones van pegadas (sin hueco). Un elemento puede cruzar el límite y
//    sale repartido entre las dos imágenes; las guías de sección solo se ven en pantalla.
//  - Modo separado: hay un hueco entre secciones en el lienzo (no se exporta).
//
// Las medidas son PRESETS DE DISEÑO de KOVA, no formatos oficiales de Behance. Lo que sí sale de
// la ayuda de Behance (help.behance.net, consultada en noviembre de 2026) está en BEHANCE_GUIDE.

import type { Artboard } from '../core/types';
import { fileKeyFrom } from '../social/presets';

export interface ArtboardBehance {
  /** id del proyecto (todas sus secciones lo comparten) */
  project: string;
  /** nombre del proyecto */
  name: string;
  /** posición de la sección, desde 0 */
  index: number;
  /** secciones pegadas, sin hueco en el lienzo */
  continuous: boolean;
}

/** Ancho de diseño por defecto: el ancho al que Behance muestra el contenido del proyecto. */
export const BEHANCE_WIDTH = 1400;
/** Hueco entre secciones en el lienzo, en modo separado (no se exporta). */
export const SECTION_GAP = 120;
export const MAX_SECTIONS = 60;
export const MIN_SECTION = 100;
export const MAX_SECTION = 12000;

/**
 * Lo que dice la ayuda de Behance (no son límites de KOVA):
 *  - imágenes JPG (recomendado), PNG o GIF; 2800 px de ancho o menos y menos de 10 MB
 *  - lo que mide menos de 1400 px de ancho se muestra a su tamaño con márgenes a los lados
 *  - más de 50 MB o más de 32 megapíxeles por imagen puede fallar al subir
 *  - PDF, PSD, TIFF y DOC no se admiten como contenido del proyecto
 *  - portada: mínimo 808×632 px (se muestra a 202×158 y se recorta en Behance)
 */
export const BEHANCE_GUIDE = {
  displayWidth: 1400,
  maxRecommendedWidth: 2800,
  recommendedBytes: 10 * 1024 * 1024,
  maxBytes: 50 * 1024 * 1024,
  maxPixels: 32_000_000,
  cover: { w: 808, h: 632, displayW: 202, displayH: 158 },
};

export interface SectionPreset { id: string; name: string; h: number }
/** Presets de diseño (alto con el ancho común del proyecto). Editables: se puede usar cualquier alto. */
export const SECTION_PRESETS: SectionPreset[] = [
  { id: 'h1000', name: 'Horizontal', h: 1000 },
  { id: 'h1800', name: 'Vertical', h: 1800 },
  { id: 'h2400', name: 'Alta', h: 2400 },
  { id: 'h3000', name: 'Muy alta', h: 3000 },
  { id: 'h4000', name: 'Extra alta', h: 4000 },
];
/** Alto de un preset para otro ancho de proyecto (misma proporción que con 1400). */
export const presetHeight = (p: SectionPreset, width: number) => Math.round((p.h * width) / BEHANCE_WIDTH);

/** Estructura de ejemplo de una presentación (se puede editar todo después). */
export const TEMPLATE_SECTIONS: { name: string; h: number }[] = [
  { name: 'Portada', h: 1000 },
  { name: 'Introducción', h: 1800 },
  { name: 'Concepto', h: 1800 },
  { name: 'Moodboard', h: 2400 },
  { name: 'Proceso creativo', h: 3000 },
  { name: 'Desarrollo', h: 2400 },
  { name: 'Mockups', h: 3000 },
  { name: 'Resultado final', h: 2400 },
  { name: 'Créditos', h: 1000 },
];

export const clampSection = (h: number) => Math.max(MIN_SECTION, Math.min(MAX_SECTION, Math.round(h) || MIN_SECTION));

// ---------- secciones ----------
export interface BehanceProject { id: string; name: string; continuous: boolean; sections: Artboard[] }

/** Secciones de un proyecto en orden. */
export function projectSections(artboards: Artboard[], projectId: string): Artboard[] {
  return artboards.filter(a => a.behance?.project === projectId).sort((a, b) => a.behance!.index - b.behance!.index || a.y - b.y);
}

/** Proyectos del documento, en el orden en que aparece su primera sección. */
export function listProjects(artboards: Artboard[]): BehanceProject[] {
  const out: BehanceProject[] = [];
  for (const a of artboards) {
    const b = a.behance;
    if (!b || out.some(p => p.id === b.project)) continue;
    const sections = projectSections(artboards, b.project);
    out.push({ id: b.project, name: sections[0].behance!.name, continuous: sections[0].behance!.continuous, sections });
  }
  return out;
}

/** Y de cada sección apilada desde y0. */
export function sectionPositions(heights: number[], y0: number, gap: number): number[] {
  const out: number[] = [];
  let y = y0;
  for (const h of heights) { out.push(y); y += h + gap; }
  return out;
}

export interface Box { x: number; y: number; w: number; h: number }
const contains = (r: Box, b: Box, tol = 0.5) => b.x >= r.x - tol && b.y >= r.y - tol && b.x + b.w <= r.x + r.w + tol && b.y + b.h <= r.y + r.h + tol;
const centerIn = (r: Box, b: Box) => { const cx = b.x + b.w / 2, cy = b.y + b.h / 2; return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h; };

/**
 * ¿Pertenece una caja a la sección? Separado: si su centro está dentro. Continuo: solo si está
 * entera dentro; lo que cruza un límite es del proyecto y se queda donde está al reordenar.
 */
export const inSection = (section: Box, b: Box, continuous: boolean) => (continuous ? contains(section, b) : centerIn(section, b));

/**
 * Reapila secciones en un orden y con unos altos nuevos. Devuelve la nueva Y de cada sección y
 * el desplazamiento vertical de cada elemento (los de cada sección se mueven con ella).
 */
export function restackPlan<L extends { id: string }>(
  sections: (Box & { id: string })[], order: { id: string; h: number }[], y0: number, gap: number,
  items: L[], boundsOf: (l: L) => Box | null, continuous: boolean,
): { ys: Map<string, number>; shifts: Map<string, number>; bottom: number } {
  const ys = new Map<string, number>();
  const pos = sectionPositions(order.map(o => o.h), y0, gap);
  order.forEach((o, i) => ys.set(o.id, pos[i]));
  const shifts = new Map<string, number>();
  const byId = new Map(sections.map(s => [s.id, s]));
  for (const it of items) {
    const b = boundsOf(it);
    if (!b) continue;
    for (const o of order) {
      const s = byId.get(o.id);
      if (!s || !inSection(s, b, continuous)) continue;
      const dy = ys.get(o.id)! - s.y;
      if (dy) shifts.set(it.id, dy);
      break;
    }
  }
  const last = order.length - 1;
  const bottom = last >= 0 ? pos[last] + order[last].h : y0;
  return { ys, shifts, bottom };
}

/** Elementos que cruzan el límite entre dos secciones (se verán partidos en imágenes separadas). */
export function crossingItems<L>(sections: Box[], items: L[], boundsOf: (l: L) => Box | null): { item: L; at: number }[] {
  const out: { item: L; at: number }[] = [];
  for (const it of items) {
    const b = boundsOf(it);
    if (!b || b.w <= 0 || b.h <= 0) continue;
    for (let i = 0; i < sections.length - 1; i++) {
      const cut = sections[i].y + sections[i].h;
      // solo cuenta si el elemento cae en la columna del proyecto y pasa de verdad al otro lado
      if (b.x + b.w <= sections[i].x || b.x >= sections[i].x + sections[i].w) continue;
      if (b.y < cut - 1 && b.y + b.h > cut + 1 && b.y + b.h > sections[i + 1].y + 1) { out.push({ item: it, at: i }); break; }
    }
  }
  return out;
}

// ---------- imagen continua por segmentos ----------
export interface Piece { section: number; y0: number; y1: number }
export interface Segment { pieces: Piece[]; h: number }

/**
 * Reparte el proyecto apilado (altos ya a la escala de salida) en segmentos de como mucho maxH px.
 * Se corta preferentemente entre secciones; una sección más alta que maxH se parte por dentro.
 */
export function planSegments(heights: number[], maxH: number): Segment[] {
  maxH = Math.max(1, Math.floor(maxH));
  const segs: Segment[] = [];
  let cur: Segment = { pieces: [], h: 0 };
  const push = () => { if (cur.pieces.length) segs.push(cur); cur = { pieces: [], h: 0 }; };
  heights.forEach((H, i) => {
    let y = 0;
    while (y < H) {
      const room = maxH - cur.h;
      const rest = H - y;
      // una sección que cabe entera en un segmento nuevo no se parte
      if (rest > room && rest <= maxH && cur.h > 0) { push(); continue; }
      const take = Math.min(rest, room);
      cur.pieces.push({ section: i, y0: y, y1: y + take });
      cur.h += take;
      y += take;
      if (cur.h >= maxH) push();
    }
  });
  push();
  return segs;
}

export type OutExt = 'jpg' | 'png' | 'webp';

/**
 * Alto máximo de un segmento: lo que cabe en 32 MP (límite de Behance por imagen) sin pasar de
 * 16 000 px (lienzos seguros en Safari/WebKit y Chrome) ni de 16 383 px (máximo de WebP).
 */
export function maxSegmentHeight(widthPx: number, ext: OutExt) {
  const byPixels = Math.floor(BEHANCE_GUIDE.maxPixels / Math.max(1, widthPx));
  return Math.max(1, Math.min(byPixels, 16000, ext === 'webp' ? 16383 : Infinity));
}

// ---------- comprobaciones ----------
export interface Check { level: 'error' | 'warn' | 'info' | 'ok'; text: string }

/** Comprueba una imagen de salida contra la guía de Behance. `bytes` es opcional (aún sin medir). */
export function checkOutput(w: number, h: number, ext: OutExt, bytes?: number): Check[] {
  const g = BEHANCE_GUIDE;
  const out: Check[] = [];
  const mp = (w * h) / 1e6;
  if (w * h > g.maxPixels) out.push({ level: 'error', text: `${mp.toFixed(1)} MP: Behance no admite más de 32 megapíxeles por imagen. Exporta por segmentos o baja la resolución.` });
  if (w > g.maxRecommendedWidth) out.push({ level: 'warn', text: `${w} px de ancho: Behance recomienda 2800 px o menos.` });
  else if (w < g.displayWidth) out.push({ level: 'info', text: `${w} px de ancho: Behance la mostrará a su tamaño, con márgenes a los lados (menos de 1400 px).` });
  if (bytes != null) {
    if (bytes > g.maxBytes) out.push({ level: 'error', text: `${fmtMB(bytes)}: más de 50 MB suele fallar al subir.` });
    else if (bytes > g.recommendedBytes) out.push({ level: 'warn', text: `${fmtMB(bytes)}: Behance recomienda menos de 10 MB. Baja la calidad o usa JPG.` });
  }
  if (ext === 'webp') out.push({ level: 'warn', text: 'WebP no figura entre los formatos que la ayuda de Behance recomienda (JPG, PNG o GIF).' });
  return out;
}

/** Portada: el recorte elegido tiene que llegar al mínimo de 808×632. */
export function checkCover(cropW: number, cropH: number): Check[] {
  const c = BEHANCE_GUIDE.cover;
  if (cropW < c.w || cropH < c.h) return [{ level: 'warn', text: `El recorte mide ${Math.round(cropW)}×${Math.round(cropH)} px; la portada necesita al menos ${c.w}×${c.h} px.` }];
  return [{ level: 'ok', text: `El recorte (${Math.round(cropW)}×${Math.round(cropH)} px) cumple el mínimo de ${c.w}×${c.h} px.` }];
}

/**
 * Recorte de la portada (proporción 808:632) dentro de una sección de w×h. `zoom` ≥ 1 acerca;
 * fx, fy (0..1) mueven el encuadre. Devuelve el rectángulo en px de la sección.
 */
export function coverCrop(w: number, h: number, zoom: number, fx: number, fy: number): Box {
  const ar = BEHANCE_GUIDE.cover.w / BEHANCE_GUIDE.cover.h;
  let cw = w, ch = w / ar;
  if (ch > h) { ch = h; cw = h * ar; }
  const z = Math.max(1, zoom);
  cw /= z; ch /= z;
  const cl = (v: number) => Math.max(0, Math.min(1, v));
  return { x: (w - cw) * cl(fx), y: (h - ch) * cl(fy), w: cw, h: ch };
}

/** Diferencia media (0..255) entre la última fila de una imagen y la primera de la siguiente. */
export function seamDifference(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  const n = Math.min(a.length, b.length);
  let sum = 0, cnt = 0;
  for (let i = 0; i < n; i += 4) {
    sum += (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
    cnt++;
  }
  return cnt ? sum / cnt : 0;
}

const fmtMB = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

// ---------- nombres ----------
const two = (n: number) => String(n).padStart(2, '0');
export function sectionFileName(project: string, index: number, section: string, ext: string) {
  return `${fileKeyFrom(project)}_${two(index + 1)}_${fileKeyFrom(section)}.${ext}`;
}
export function segmentFileName(project: string, i: number, n: number, ext: string) {
  return n > 1 ? `${fileKeyFrom(project)}_continuo_parte-${two(i + 1)}.${ext}` : `${fileKeyFrom(project)}_continuo.${ext}`;
}

// ---------- .kova ----------
export function sanitizeArtboardBehance(v: any): ArtboardBehance | undefined {
  if (!v || typeof v !== 'object' || typeof v.project !== 'string' || !v.project) return undefined;
  return {
    project: v.project.slice(0, 60),
    name: typeof v.name === 'string' ? v.name.slice(0, 120) : 'Proyecto Behance',
    index: Number.isFinite(v.index) ? Math.max(0, Math.floor(v.index)) : 0,
    continuous: !!v.continuous,
  };
}
