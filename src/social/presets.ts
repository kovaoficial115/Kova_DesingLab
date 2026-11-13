// Formatos de redes sociales: tamaños, zonas seguras y guías. Funciones puras (sin DOM).
//
// Las medidas de las zonas seguras son recomendaciones prácticas (la interfaz de cada app cambia
// según el dispositivo); por eso los formatos se pueden editar y ampliar desde la app y las
// sobrescrituras del usuario se guardan aparte de estos valores de fábrica.

export type PlatformId = 'instagram' | 'tiktok' | 'youtube' | 'facebook' | 'pinterest' | 'custom';

export interface Insets { top: number; right: number; bottom: number; left: number }

export interface SocialFormat {
  id: string;
  platform: PlatformId;
  name: string;
  w: number;
  h: number;
  /** clave para el nombre de archivo exportado: instagram_feed, tiktok_cover… */
  fileKey: string;
  /** márgenes que la interfaz de la app puede tapar (px del formato) */
  safe?: Insets;
  /** zonas tapadas por la interfaz, para dibujarlas sombreadas (px) */
  ui?: { name: string; x: number; y: number; w: number; h: number }[];
  /** recorte circular (destacadas, perfil): diámetro visible y diámetro seguro, en px */
  circle?: { d: number; safe: number };
  /** recortes centrados con los que se muestra en otros sitios (cuadrícula del perfil…) */
  crops?: { name: string; w: number; h: number }[];
  /** se usa como diapositivas de un carrusel */
  carousel?: boolean;
  /** formato definido o modificado por el usuario */
  user?: boolean;
}

export const PLATFORMS: { id: PlatformId; name: string }[] = [
  { id: 'instagram', name: 'Instagram' },
  { id: 'tiktok', name: 'TikTok' },
  { id: 'youtube', name: 'YouTube' },
  { id: 'facebook', name: 'Facebook' },
  { id: 'pinterest', name: 'Pinterest' },
  { id: 'custom', name: 'Personalizado' },
];

const STORY_SAFE: Insets = { top: 250, right: 64, bottom: 340, left: 64 };
const storyUi = (w: number, h: number) => [
  { name: 'Perfil y barra de progreso', x: 0, y: 0, w, h: 250 },
  { name: 'Responder y reacciones', x: 0, y: h - 340, w, h: 340 },
];
const reelUi = (w: number, h: number) => [
  { name: 'Barra superior', x: 0, y: 0, w, h: 220 },
  { name: 'Descripción y audio', x: 0, y: h - 420, w: w - 150, h: 420 },
  { name: 'Botones', x: w - 150, y: h - 1000, w: 150, h: 1000 },
];
const margin = (w: number, h: number, f = 0.05): Insets => {
  const m = Math.round(Math.min(w, h) * f);
  return { top: m, right: m, bottom: m, left: m };
};
const GRID_34 = { name: 'Cuadrícula del perfil (3:4)', w: 1080, h: 1440 };

export const BUILTIN_FORMATS: SocialFormat[] = [
  // Instagram
  { id: 'ig-post-portrait', platform: 'instagram', name: 'Publicación vertical', w: 1080, h: 1350, fileKey: 'instagram_feed', safe: margin(1080, 1350), crops: [{ name: 'Cuadrícula del perfil (3:4)', w: 1013, h: 1350 }] },
  { id: 'ig-post-34', platform: 'instagram', name: 'Publicación 3:4', w: 1080, h: 1440, fileKey: 'instagram_feed_3x4', safe: margin(1080, 1440), crops: [{ name: 'Feed 4:5', w: 1080, h: 1350 }] },
  { id: 'ig-post-square', platform: 'instagram', name: 'Publicación cuadrada', w: 1080, h: 1080, fileKey: 'instagram_square', safe: margin(1080, 1080), crops: [{ name: 'Cuadrícula del perfil (3:4)', w: 810, h: 1080 }] },
  { id: 'ig-carousel', platform: 'instagram', name: 'Carrusel (diapositiva)', w: 1080, h: 1350, fileKey: 'instagram_carousel', safe: margin(1080, 1350), carousel: true },
  { id: 'ig-story', platform: 'instagram', name: 'Historia', w: 1080, h: 1920, fileKey: 'instagram_story', safe: STORY_SAFE, ui: storyUi(1080, 1920) },
  { id: 'ig-reel', platform: 'instagram', name: 'Reel', w: 1080, h: 1920, fileKey: 'instagram_reel', safe: { top: 220, right: 150, bottom: 420, left: 64 }, ui: reelUi(1080, 1920) },
  { id: 'ig-reel-cover', platform: 'instagram', name: 'Portada de Reel', w: 1080, h: 1920, fileKey: 'instagram_reel_cover', safe: { top: 240, right: 64, bottom: 240, left: 64 }, crops: [GRID_34, { name: 'Feed 4:5', w: 1080, h: 1350 }] },
  { id: 'ig-highlight', platform: 'instagram', name: 'Portada de destacada', w: 1080, h: 1920, fileKey: 'instagram_highlight_cover', circle: { d: 1080, safe: 760 } },
  { id: 'ig-profile', platform: 'instagram', name: 'Imagen de perfil', w: 1080, h: 1080, fileKey: 'instagram_profile', circle: { d: 1080, safe: 860 } },
  // TikTok
  { id: 'tt-video', platform: 'tiktok', name: 'Video vertical', w: 1080, h: 1920, fileKey: 'tiktok_video', safe: { top: 160, right: 150, bottom: 480, left: 60 }, ui: [{ name: 'Pestañas', x: 0, y: 0, w: 1080, h: 160 }, { name: 'Descripción', x: 0, y: 1440, w: 930, h: 480 }, { name: 'Botones', x: 930, y: 700, w: 150, h: 1220 }] },
  { id: 'tt-cover', platform: 'tiktok', name: 'Portada', w: 1080, h: 1920, fileKey: 'tiktok_cover', safe: { top: 160, right: 64, bottom: 300, left: 64 }, crops: [GRID_34] },
  { id: 'tt-photo', platform: 'tiktok', name: 'Publicación de fotos', w: 1080, h: 1920, fileKey: 'tiktok_photo', safe: { top: 160, right: 150, bottom: 480, left: 60 }, carousel: true },
  // YouTube
  { id: 'yt-thumb', platform: 'youtube', name: 'Miniatura', w: 1280, h: 720, fileKey: 'youtube_thumbnail', safe: margin(1280, 720, 0.04), ui: [{ name: 'Duración', x: 1280 - 190, y: 720 - 90, w: 170, h: 70 }] },
  { id: 'yt-shorts', platform: 'youtube', name: 'Shorts', w: 1080, h: 1920, fileKey: 'youtube_shorts', safe: { top: 200, right: 150, bottom: 460, left: 64 }, ui: reelUi(1080, 1920) },
  { id: 'yt-banner', platform: 'youtube', name: 'Banner del canal', w: 2560, h: 1440, fileKey: 'youtube_banner', safe: { top: 508, right: 507, bottom: 509, left: 507 }, crops: [{ name: 'Escritorio', w: 2560, h: 423 }, { name: 'TV', w: 2560, h: 1440 }] },
  { id: 'yt-profile', platform: 'youtube', name: 'Imagen de perfil', w: 800, h: 800, fileKey: 'youtube_profile', circle: { d: 800, safe: 640 } },
  // Facebook
  { id: 'fb-post-square', platform: 'facebook', name: 'Publicación cuadrada', w: 1080, h: 1080, fileKey: 'facebook_square', safe: margin(1080, 1080) },
  { id: 'fb-post-portrait', platform: 'facebook', name: 'Publicación vertical', w: 1080, h: 1350, fileKey: 'facebook_portrait', safe: margin(1080, 1350) },
  { id: 'fb-story', platform: 'facebook', name: 'Historia', w: 1080, h: 1920, fileKey: 'facebook_story', safe: STORY_SAFE, ui: storyUi(1080, 1920) },
  { id: 'fb-reel', platform: 'facebook', name: 'Reel', w: 1080, h: 1920, fileKey: 'facebook_reel', safe: { top: 220, right: 150, bottom: 420, left: 64 }, ui: reelUi(1080, 1920) },
  { id: 'fb-cover', platform: 'facebook', name: 'Portada de página', w: 1640, h: 624, fileKey: 'facebook_cover', safe: { top: 40, right: 180, bottom: 40, left: 180 }, crops: [{ name: 'Móvil', w: 1280, h: 624 }] },
  // Pinterest
  { id: 'pin-vertical', platform: 'pinterest', name: 'Pin vertical', w: 1000, h: 1500, fileKey: 'pinterest_pin', safe: margin(1000, 1500) },
  { id: 'pin-square', platform: 'pinterest', name: 'Pin cuadrado', w: 1000, h: 1000, fileKey: 'pinterest_square', safe: margin(1000, 1000) },
];

// ---------- formatos editables ----------
export interface UserFormats {
  /** cambios sobre los formatos de fábrica (p. ej. si una plataforma cambia de tamaño) */
  overrides: Record<string, Partial<Pick<SocialFormat, 'name' | 'w' | 'h' | 'safe'>>>;
  /** formatos nuevos */
  custom: SocialFormat[];
}
export const emptyUserFormats = (): UserFormats => ({ overrides: {}, custom: [] });

const num = (v: unknown, min: number, max: number) => (typeof v === 'number' && isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : null);
function cleanInsets(v: any): Insets | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const t = num(v.top, 0, 20000), r = num(v.right, 0, 20000), b = num(v.bottom, 0, 20000), l = num(v.left, 0, 20000);
  return t === null || r === null || b === null || l === null ? undefined : { top: t, right: r, bottom: b, left: l };
}

/** Lee formatos guardados (de localStorage o de otra versión) descartando lo que no sea válido. */
export function sanitizeUserFormats(v: any): UserFormats {
  const out = emptyUserFormats();
  if (!v || typeof v !== 'object') return out;
  if (v.overrides && typeof v.overrides === 'object') {
    for (const [id, o] of Object.entries<any>(v.overrides)) {
      if (!BUILTIN_FORMATS.some(f => f.id === id) || !o || typeof o !== 'object') continue;
      const p: UserFormats['overrides'][string] = {};
      if (typeof o.name === 'string' && o.name.trim()) p.name = o.name.trim().slice(0, 60);
      const w = num(o.w, 16, 20000), h = num(o.h, 16, 20000);
      if (w) p.w = w;
      if (h) p.h = h;
      const s = cleanInsets(o.safe);
      if (s) p.safe = s;
      if (Object.keys(p).length) out.overrides[id] = p;
    }
  }
  if (Array.isArray(v.custom)) {
    for (const c of v.custom) {
      const w = num(c?.w, 16, 20000), h = num(c?.h, 16, 20000);
      if (!w || !h || typeof c.id !== 'string' || !c.id.startsWith('user-')) continue;
      const platform = PLATFORMS.some(p => p.id === c.platform) ? c.platform : 'custom';
      out.custom.push({
        id: c.id.slice(0, 60), platform, name: typeof c.name === 'string' && c.name.trim() ? c.name.trim().slice(0, 60) : `${w}×${h}`,
        w, h, fileKey: fileKeyFrom(typeof c.fileKey === 'string' ? c.fileKey : `${platform}_${c.name ?? 'formato'}`),
        safe: cleanInsets(c.safe) ?? margin(w, h), carousel: !!c.carousel, user: true,
      });
    }
  }
  return out;
}

/** Clave segura para nombres de archivo: minúsculas, sin acentos ni espacios. */
export function fileKeyFrom(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'formato';
}

/** Todos los formatos vigentes: los de fábrica con los cambios del usuario y los propios. */
export function allFormats(user: UserFormats = emptyUserFormats()): SocialFormat[] {
  const base = BUILTIN_FORMATS.map(f => {
    const o = user.overrides[f.id];
    if (!o) return f;
    const w = o.w ?? f.w, h = o.h ?? f.h;
    // si cambian las medidas, las guías se escalan con el formato
    const kx = w / f.w, ky = h / f.h;
    const scaleIns = (s?: Insets) => s && { top: Math.round(s.top * ky), right: Math.round(s.right * kx), bottom: Math.round(s.bottom * ky), left: Math.round(s.left * kx) };
    return {
      ...f, ...o, w, h, user: true,
      safe: o.safe ?? scaleIns(f.safe),
      ui: f.ui?.map(u => ({ ...u, x: Math.round(u.x * kx), y: Math.round(u.y * ky), w: Math.round(u.w * kx), h: Math.round(u.h * ky) })),
      circle: f.circle && { d: Math.round(f.circle.d * Math.min(kx, ky)), safe: Math.round(f.circle.safe * Math.min(kx, ky)) },
      crops: f.crops?.map(c => ({ ...c, w: Math.round(c.w * kx), h: Math.round(c.h * ky) })),
    };
  });
  return [...base, ...user.custom];
}

export function findFormat(id: string | undefined, user?: UserFormats): SocialFormat | null {
  if (!id) return null;
  return allFormats(user).find(f => f.id === id) ?? null;
}

/** Zona segura (rectángulo dentro del formato) para unas medidas reales de mesa. */
export function safeRect(f: SocialFormat, w = f.w, h = f.h) {
  const kx = w / f.w, ky = h / f.h;
  const s = f.safe ?? { top: 0, right: 0, bottom: 0, left: 0 };
  return { x: s.left * kx, y: s.top * ky, w: w - (s.left + s.right) * kx, h: h - (s.top + s.bottom) * ky };
}

/** Proporción reducida: 1080×1350 → «4:5». */
export function aspectLabel(w: number, h: number) {
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
  const d = g(Math.round(w), Math.round(h)) || 1;
  const a = Math.round(w) / d, b = Math.round(h) / d;
  if (a <= 50 && b <= 50) return `${a}:${b}`;
  const r = w / h;
  return r >= 1 ? `${r.toFixed(2)}:1` : `1:${(1 / r).toFixed(2)}`;
}

// ---------- medidas personalizadas ----------
export type SizeUnit = 'px' | 'cm' | 'mm' | 'in';
/** Convierte una medida física a píxeles. Los ppp no cambian los píxeles de una medida en px. */
export function toPixels(v: number, unit: SizeUnit, ppi: number) {
  switch (unit) {
    case 'px': return Math.round(v);
    case 'cm': return Math.round((v / 2.54) * ppi);
    case 'mm': return Math.round((v / 25.4) * ppi);
    case 'in': return Math.round(v * ppi);
  }
}
export function fromPixels(px: number, unit: SizeUnit, ppi: number) {
  switch (unit) {
    case 'px': return px;
    case 'cm': return (px / ppi) * 2.54;
    case 'mm': return (px / ppi) * 25.4;
    case 'in': return px / ppi;
  }
}
