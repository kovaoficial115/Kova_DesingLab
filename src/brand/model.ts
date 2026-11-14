// Biblioteca de marca: kits con colores, tipografías, estilos de texto, logotipos, iconos y normas
// de uso. El kit oficial de KOVA viene incluido (solo lectura); el usuario puede crear los suyos,
// duplicar el oficial para ampliarlo, e importar o exportar kits como archivo .json.
// Funciones puras (se prueban sin navegador).

import type { TextStyle, TextStyleProps } from '../core/types';
import { TEXT_STYLE_KEYS } from '../core/types';

export interface BrandColor {
  id: string;
  name: string;
  hex: string;
  /** valores de referencia del manual (texto tal como aparecen) */
  rgb?: string;
  cmyk?: string;
  role?: string;
}

export interface BrandFont {
  family: string;
  /** usos según el manual */
  role: string;
  weights: number[];
  /** tipografía incluida en la app (se instala en la biblioteca de fuentes con un clic) */
  bundled?: string;
  license?: string;
}

export type AssetKind = 'logo' | 'mark' | 'icon' | 'graphic';

export interface BrandAsset {
  id: string;
  name: string;
  kind: AssetKind;
  svg: string;
  w: number;
  h: number;
  /** usa `currentColor`: se puede colocar en cualquier color de la paleta */
  recolor: boolean;
}

export interface BrandRules {
  /** el logotipo principal solo se usa sobre este fondo */
  logoBackground?: string | null;
  /** tamaño mínimo del logotipo: px en digital, mm en impresión */
  minWidthPx?: number | null;
  minWidthMm?: number | null;
  /** área de protección como fracción del ancho del logotipo (X = ancho / 11 → 1/11) */
  clearSpace?: number | null;
  /** el logotipo solo va en las cuatro esquinas */
  cornersOnly?: boolean;
  /** normas en texto, tal como las recoge el manual */
  notes: string[];
}

export interface BrandKit {
  id: string;
  name: string;
  /** kit incluido en la app (no se edita: se duplica) */
  builtin?: boolean;
  source?: string;
  colors: BrandColor[];
  fonts: BrandFont[];
  styles: TextStyle[];
  assets: BrandAsset[];
  rules: BrandRules;
}

export const KIT_FORMAT = 'kova-brand-kit';

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : null);
export const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

export function sanitizeStyleProps(raw: any): TextStyleProps {
  const out: any = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k of TEXT_STYLE_KEYS) {
    const v = raw[k];
    if (v === undefined || v === null) continue;
    if (k === 'fontFamily' && typeof v === 'string' && v.trim()) out[k] = v.slice(0, 200);
    else if ((k === 'italic' || k === 'caps' || k === 'underline') && typeof v === 'boolean') out[k] = v;
    else if (k === 'color' && isHex(v)) out[k] = v.toLowerCase();
    else if (k === 'align' && ['left', 'center', 'right', 'justify-left', 'justify-center', 'justify-right', 'justify'].includes(v)) out[k] = v;
    else if (k === 'fontSize' && num(v) && v > 0 && v <= 5000) out[k] = v;
    else if (k === 'fontWeight' && num(v) && v >= 100 && v <= 1000) out[k] = Math.round(v);
    else if (k === 'lineHeight' && num(v) && v > 0 && v <= 10) out[k] = v;
    else if ((k === 'letterSpacing' || k === 'paraSpacing') && num(v) !== null && Math.abs(v) <= 5000) out[k] = v;
  }
  return out;
}

export function sanitizeStyle(raw: any): TextStyle | null {
  if (!raw || typeof raw !== 'object' || !str(raw.id) || !str(raw.name)) return null;
  return { id: str(raw.id, 80), name: str(raw.name, 80), ...(str(raw.role) ? { role: str(raw.role) } : {}), ...(str(raw.kit) ? { kit: str(raw.kit, 80) } : {}), props: sanitizeStyleProps(raw.props) };
}

export function sanitizeStyles(raw: unknown): TextStyle[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: TextStyle[] = [];
  for (const r of raw) { const s = sanitizeStyle(r); if (s && !seen.has(s.id)) { seen.add(s.id); out.push(s); } }
  return out;
}

/** Un SVG aceptable para la biblioteca: sin scripts, manejadores de eventos ni recursos externos. */
export function cleanSvg(svg: string): string | null {
  if (typeof svg !== 'string' || svg.length > 2_000_000 || !/<svg[\s>]/i.test(svg)) return null;
  if (/<script|<foreignObject|\son[a-z]+\s*=|javascript:/i.test(svg)) return null;
  // referencias a archivos externos (las internas «#id» y los datos incrustados sí valen)
  if (/(?:href|src)\s*=\s*["'](?!#|data:)/i.test(svg)) return null;
  return svg.replace(/^\s*<\?xml[^>]*>\s*/i, '');
}

/** Tamaño de un SVG: atributos width/height o, si faltan, el viewBox. */
export function svgSize(svg: string): { w: number; h: number } | null {
  const tag = svg.match(/<svg[^>]*>/i)?.[0] ?? '';
  const attr = (n: string) => { const m = tag.match(new RegExp(`\\s${n}\\s*=\\s*["']([\\d.]+)(px)?["']`, 'i')); return m ? parseFloat(m[1]) : null; };
  const vb = tag.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  const w = attr('width') ?? (vb ? parseFloat(vb[1]) : null), h = attr('height') ?? (vb ? parseFloat(vb[2]) : null);
  return w && h ? { w, h } : null;
}

export function sanitizeAsset(raw: any): BrandAsset | null {
  if (!raw || typeof raw !== 'object') return null;
  const svg = cleanSvg(raw.svg);
  if (!svg || !str(raw.id) || !str(raw.name)) return null;
  const size = num(raw.w) && num(raw.h) ? { w: raw.w, h: raw.h } : svgSize(svg);
  if (!size || size.w <= 0 || size.h <= 0) return null;
  const kind: AssetKind = ['logo', 'mark', 'icon', 'graphic'].includes(raw.kind) ? raw.kind : 'graphic';
  return { id: str(raw.id, 80), name: str(raw.name, 80), kind, svg, w: size.w, h: size.h, recolor: !!raw.recolor && /currentColor/.test(svg) };
}

export function sanitizeKit(raw: any): BrandKit | null {
  if (!raw || typeof raw !== 'object' || !str(raw.id) || !str(raw.name)) return null;
  const colors: BrandColor[] = (Array.isArray(raw.colors) ? raw.colors : []).filter((c: any) => c && isHex(c.hex)).map((c: any) => ({
    id: str(c.id, 80) || c.hex.toLowerCase(), name: str(c.name, 80) || c.hex.toUpperCase(), hex: c.hex.toLowerCase(),
    ...(str(c.rgb) ? { rgb: str(c.rgb) } : {}), ...(str(c.cmyk) ? { cmyk: str(c.cmyk) } : {}), ...(str(c.role) ? { role: str(c.role) } : {}),
  }));
  const fonts: BrandFont[] = (Array.isArray(raw.fonts) ? raw.fonts : []).filter((f: any) => f && str(f.family)).map((f: any) => ({
    family: str(f.family, 120), role: str(f.role), weights: (Array.isArray(f.weights) ? f.weights : [400]).filter((w: any) => num(w)).slice(0, 9),
    ...(str(f.bundled) ? { bundled: str(f.bundled, 40) } : {}), ...(str(f.license) ? { license: str(f.license, 300) } : {}),
  }));
  const r = raw.rules && typeof raw.rules === 'object' ? raw.rules : {};
  const rules: BrandRules = {
    logoBackground: isHex(r.logoBackground) ? r.logoBackground.toLowerCase() : null,
    minWidthPx: num(r.minWidthPx), minWidthMm: num(r.minWidthMm),
    clearSpace: num(r.clearSpace) && r.clearSpace > 0 && r.clearSpace < 1 ? r.clearSpace : null,
    cornersOnly: !!r.cornersOnly,
    notes: (Array.isArray(r.notes) ? r.notes : []).map((n: unknown) => str(n, 500)).filter(Boolean).slice(0, 40),
  };
  return {
    id: str(raw.id, 80), name: str(raw.name, 80), ...(str(raw.source) ? { source: str(raw.source, 200) } : {}),
    colors, fonts, styles: sanitizeStyles(raw.styles),
    assets: (Array.isArray(raw.assets) ? raw.assets : []).map(sanitizeAsset).filter((a: BrandAsset | null): a is BrandAsset => !!a),
    rules,
  };
}

/** Archivo de intercambio de un kit. */
export function exportKit(k: BrandKit): string {
  const { builtin: _b, ...rest } = k;
  return JSON.stringify({ format: KIT_FORMAT, version: 1, kit: rest }, null, 2);
}
export function importKit(json: string): BrandKit {
  let raw: any;
  try { raw = JSON.parse(json); } catch { throw new Error('El archivo no es un kit de marca válido (JSON dañado).'); }
  if (raw?.format !== KIT_FORMAT) throw new Error('El archivo no es un kit de marca de KOVA.');
  const kit = sanitizeKit(raw.kit);
  if (!kit) throw new Error('El kit de marca está incompleto.');
  return kit;
}

/** Color de un SVG recoloreable. */
export function colorizeSvg(svg: string, color: string) { return svg.replace(/currentColor/g, color); }

/** Ancho mínimo del logotipo en px de una mesa: el mayor entre el mínimo digital y el impreso. */
export function minLogoWidth(rules: BrandRules, dpi: number): number {
  const px = rules.minWidthPx ?? 0;
  const mm = rules.minWidthMm ? (rules.minWidthMm / 25.4) * dpi : 0;
  return Math.max(px, mm);
}

// ---------- estilos de texto ----------

/** Aplica las propiedades que define un estilo (las demás no se tocan). */
export function applyStyleProps<T extends object>(t: T, props: TextStyleProps): T {
  const out: any = { ...t };
  for (const k of TEXT_STYLE_KEYS) if (props[k] !== undefined) out[k] = props[k];
  return out;
}

/** Propiedades en las que un texto se aparta de su estilo. */
export function styleOverrides(t: Record<string, any>, props: TextStyleProps): string[] {
  return TEXT_STYLE_KEYS.filter(k => props[k] !== undefined && t[k] !== props[k]);
}

/**
 * Al cambiar un estilo, cada texto vinculado recibe los valores nuevos en las propiedades que no
 * había cambiado a mano (las que coincidían con el estilo anterior).
 */
export function restyle<T extends Record<string, any>>(t: T, before: TextStyleProps, after: TextStyleProps): T {
  let out: any = t;
  for (const k of TEXT_STYLE_KEYS) {
    const nv = after[k];
    if (nv === undefined || nv === before[k]) continue;
    if (before[k] !== undefined && t[k] !== before[k]) continue; // sustitución del usuario
    if (out === t) out = { ...t };
    out[k] = nv;
  }
  return out;
}

/** Propiedades de estilo de un texto (para crear un estilo a partir de una capa). */
export function styleFromText(t: Record<string, any>): TextStyleProps {
  return sanitizeStyleProps(Object.fromEntries(TEXT_STYLE_KEYS.map(k => [k, t[k]])));
}
