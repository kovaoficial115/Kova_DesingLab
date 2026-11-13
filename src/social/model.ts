// Datos de Social Design Studio dentro del documento (funciones puras, sin DOM).
//
//  - Artboard.social: formato de la mesa y, si es una diapositiva, la serie a la que pertenece.
//    Vive en el estado del documento: entra en deshacer/rehacer, en el .kova y en la colaboración.
//  - Doc.social: perfil para las vistas previas y planes del feed. Sección `social` del .kova.

import type { Artboard } from '../core/types';
import { findFormat, fileKeyFrom, type SocialFormat, type UserFormats } from './presets';

export type SeriesKind = 'carousel' | 'continuous' | 'highlights';

export interface SeriesRef {
  id: string;
  kind: SeriesKind;
  name: string;
  /** posición dentro de la serie, desde 0 */
  index: number;
}

export interface ArtboardSocial {
  /** id del formato (ig-post-portrait, yt-thumb…) */
  preset: string;
  series?: SeriesRef;
  /** nombre visible de una portada de destacada («DROP 01») */
  label?: string;
}

export interface FeedPlan {
  id: string;
  name: string;
  /** ids de mesa en el orden del feed: la primera es la publicación más reciente */
  order: string[];
  updated: number;
}

export interface SocialProfile {
  username: string;
  displayName: string;
  bio: string;
}

export interface DocSocial {
  profile: SocialProfile;
  plans: FeedPlan[];
  /** plan que muestran el perfil y el planificador */
  activePlan?: string;
}

export const SERIES_LABEL: Record<SeriesKind, string> = {
  carousel: 'Carrusel',
  continuous: 'Carrusel continuo',
  highlights: 'Destacadas',
};

const str = (v: unknown, max: number, def = '') => (typeof v === 'string' ? v.slice(0, max) : def);

export function sanitizeArtboardSocial(v: any): ArtboardSocial | undefined {
  if (!v || typeof v !== 'object' || typeof v.preset !== 'string' || !v.preset) return undefined;
  const out: ArtboardSocial = { preset: v.preset.slice(0, 60) };
  const s = v.series;
  if (s && typeof s === 'object' && typeof s.id === 'string' && (s.kind === 'carousel' || s.kind === 'continuous' || s.kind === 'highlights')) {
    out.series = { id: s.id.slice(0, 60), kind: s.kind, name: str(s.name, 80, SERIES_LABEL[s.kind as SeriesKind]), index: Number.isFinite(s.index) ? Math.max(0, Math.floor(s.index)) : 0 };
  }
  if (typeof v.label === 'string') out.label = v.label.slice(0, 40);
  return out;
}

export const emptyDocSocial = (): DocSocial => ({ profile: { username: '', displayName: '', bio: '' }, plans: [] });

/** Valida la sección `social` de un .kova. Devuelve null si no se puede usar. */
export function sanitizeDocSocial(v: any): DocSocial | null {
  if (!v || typeof v !== 'object') return null;
  const p = v.profile && typeof v.profile === 'object' ? v.profile : {};
  const out: DocSocial = {
    profile: { username: str(p.username, 60), displayName: str(p.displayName, 80), bio: str(p.bio, 300) },
    plans: [],
  };
  if (Array.isArray(v.plans)) {
    for (const pl of v.plans) {
      if (!pl || typeof pl.id !== 'string' || !Array.isArray(pl.order)) continue;
      out.plans.push({ id: pl.id.slice(0, 60), name: str(pl.name, 80, 'Plan'), order: pl.order.filter((x: unknown) => typeof x === 'string').slice(0, 500), updated: typeof pl.updated === 'number' ? pl.updated : 0 });
    }
  }
  if (typeof v.activePlan === 'string' && out.plans.some(p => p.id === v.activePlan)) out.activePlan = v.activePlan;
  return out;
}

// ---------- consultas sobre las mesas ----------
export const isSocial = (ab: Artboard) => !!ab.social?.preset;

/** Mesas de una serie, en orden. */
export function seriesArtboards(artboards: Artboard[], seriesId: string): Artboard[] {
  return artboards.filter(a => a.social?.series?.id === seriesId).sort((a, b) => a.social!.series!.index - b.social!.series!.index);
}

/** Series del documento con sus mesas en orden. */
export function listSeries(artboards: Artboard[]) {
  const map = new Map<string, { ref: SeriesRef; slides: Artboard[] }>();
  for (const a of artboards) {
    const s = a.social?.series;
    if (!s) continue;
    if (!map.has(s.id)) map.set(s.id, { ref: s, slides: [] });
    map.get(s.id)!.slides.push(a);
  }
  for (const v of map.values()) v.slides.sort((a, b) => a.social!.series!.index - b.social!.series!.index);
  return [...map.values()];
}

/**
 * Elementos del feed (lo que aparece en la cuadrícula del perfil): cada mesa social de publicación,
 * portada de Reel o vídeo suelta, y cada carrusel una sola vez (por su primera diapositiva).
 * Las historias, destacadas, perfiles, miniaturas y banners no van a la cuadrícula.
 */
export function feedItems(artboards: Artboard[], user?: UserFormats): Artboard[] {
  const seen = new Set<string>();
  const out: Artboard[] = [];
  for (const a of artboards) {
    const f = findFormat(a.social?.preset, user);
    if (!f) continue;
    const s = a.social!.series;
    if (s?.kind === 'highlights') continue;
    if (s) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      out.push(seriesArtboards(artboards, s.id)[0]);
      continue;
    }
    if (FEED_KEYS.has(f.fileKey) || f.platform === 'custom' || f.user) out.push(a);
  }
  return out;
}
const FEED_KEYS = new Set(['instagram_feed', 'instagram_feed_3x4', 'instagram_square', 'instagram_carousel', 'instagram_reel', 'instagram_reel_cover']);

/** Ordena los elementos del feed según un plan; los que el plan no conoce van al principio (los más nuevos). */
export function applyPlan(items: Artboard[], plan?: FeedPlan | null): Artboard[] {
  if (!plan) return items;
  const pos = new Map(plan.order.map((id, i) => [id, i]));
  const known = items.filter(a => pos.has(a.id)).sort((a, b) => pos.get(a.id)! - pos.get(b.id)!);
  return [...items.filter(a => !pos.has(a.id)), ...known];
}

// ---------- nombres de archivo ----------
export interface NameInput {
  ab: Artboard;
  format: SocialFormat | null;
  ext: string;
  /** número de diapositiva (desde 1) dentro de una serie */
  slide?: number;
  /** total de diapositivas, para decidir los dígitos */
  total?: number;
}

/**
 * instagram_feed_1080x1350.png, instagram_carousel_01.png, instagram_highlight_cover_drop_01.png…
 * Las mesas sin formato social usan su nombre.
 */
export function exportFileName({ ab, format, ext, slide, total }: NameInput): string {
  if (!format) return `${fileKeyFrom(ab.name)}_${ab.w}x${ab.h}.${ext}`;
  const s = ab.social?.series;
  if (s && slide) {
    const digits = Math.max(2, String(total ?? slide).length);
    const n = String(slide).padStart(digits, '0');
    if (s.kind === 'highlights') return `${format.fileKey}_${n}${ab.social?.label ? '_' + fileKeyFrom(ab.social.label) : ''}.${ext}`;
    const key = s.kind === 'continuous' || format.carousel ? (format.fileKey.endsWith('_carousel') ? format.fileKey : `${format.platform}_carousel`) : format.fileKey;
    return `${key}_${n}.${ext}`;
  }
  return `${format.fileKey}_${ab.w}x${ab.h}.${ext}`;
}

/** Evita nombres repetidos dentro de una exportación: nombre.png, nombre_2.png… */
export function uniqueNames(names: string[]): string[] {
  const used = new Map<string, number>();
  return names.map(n => {
    const c = used.get(n) ?? 0;
    used.set(n, c + 1);
    if (!c) return n;
    const dot = n.lastIndexOf('.');
    return `${n.slice(0, dot)}_${c + 1}${n.slice(dot)}`;
  });
}
