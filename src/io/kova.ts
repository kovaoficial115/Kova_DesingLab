// Formato de proyecto .kova: versiones, migraciones y validación (funciones puras, sin DOM).
//
//  v1  { format, version: 1, id, name, colorMode, createdAt, state, assets, fonts }
//  v2  v1 + `app` (quién lo escribió) + secciones opcionales:
//        garment3d  configuración del Estudio 3D
//        models3d   GLB propios embebidos, por hash: { name, mime, data: dataURL }
//      Un v1 es un v2 válido sin secciones nuevas: migrar solo cambia el número de versión.
//  v3  v2 + Social Design Studio:
//        social                 perfil de las vistas previas y planes del feed
//        state.artboards[].social  formato de redes y serie (carrusel, destacadas) de cada mesa
//      Un v2 es un v3 válido sin mesas sociales.
//  Las secciones desconocidas (archivos de versiones futuras) se conservan al volver a guardar.

import { sanitizeGarment3D, type Garment3DData } from '../core/garment3d';
import { sanitizeArtboardSocial, sanitizeDocSocial, type DocSocial } from '../social/model';

export const KOVA_FORMAT = 'kova-designlab';
export const KOVA_SCHEMA = 3;

export interface EmbeddedModel { name: string; mime: string; data: string }

export interface KovaFile {
  format: typeof KOVA_FORMAT;
  version: number;
  app?: { name: string; schema: number };
  id: string;
  name: string;
  colorMode: 'RGB' | 'CMYK';
  createdAt: number;
  state: any;
  assets: Record<string, string>;
  fonts?: unknown[];
  garment3d?: Garment3DData;
  models3d?: Record<string, EmbeddedModel>;
  social?: DocSocial;
}

const KNOWN_KEYS = new Set(['format', 'version', 'app', 'id', 'name', 'colorMode', 'createdAt', 'state', 'assets', 'fonts', 'garment3d', 'models3d', 'social']);

export interface ParsedKova {
  file: KovaFile;
  /** versión con la que se escribió el archivo */
  sourceVersion: number;
  /** escrito por una versión más nueva de la app */
  newer: boolean;
  /** secciones que esta versión no conoce: se reescriben tal cual al guardar */
  extra: Record<string, unknown>;
  warnings: string[];
}

export class KovaFormatError extends Error {
  constructor(message: string) { super(message); this.name = 'KovaFormatError'; }
}

/** Errores que impiden abrir el archivo. */
export function validateKova(raw: any): string[] {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') return ['El archivo no contiene un proyecto.'];
  if (raw.format !== KOVA_FORMAT) return ['Archivo de proyecto no reconocido.'];
  const v = raw.version ?? 1;
  if (typeof v !== 'number' || v < 1 || !Number.isInteger(v)) errors.push('Versión de formato inválida.');
  const st = raw.state;
  if (!st || typeof st !== 'object') return [...errors, 'Falta el contenido del documento.'];
  if (!Array.isArray(st.layers)) errors.push('La lista de capas está dañada.');
  if (!Array.isArray(st.artboards) || st.artboards.length === 0) errors.push('El documento no tiene mesas de trabajo.');
  const assets = raw.assets && typeof raw.assets === 'object' ? raw.assets : {};
  if (Array.isArray(st.layers)) {
    const missing = new Set<string>();
    for (const l of st.layers) for (const k of ['canvas', 'origin', 'mask']) {
      const ref = l?.[k];
      if (typeof ref === 'string' && typeof assets[ref] !== 'string') missing.add(l.name ?? l.id ?? '?');
    }
    if (missing.size) errors.push(`Faltan imágenes de ${missing.size} capa(s): ${[...missing].slice(0, 3).join(', ')}.`);
  }
  return errors;
}

/** Lee, valida y lleva a la versión actual. Lanza KovaFormatError si no se puede abrir. */
export function parseKova(input: string | object): ParsedKova {
  let raw: any;
  try { raw = typeof input === 'string' ? JSON.parse(input) : input; } catch { throw new KovaFormatError('El archivo .kova está dañado (no es JSON válido).'); }
  const errors = validateKova(raw);
  if (errors.length) throw new KovaFormatError(errors.join(' '));
  const sourceVersion: number = raw.version ?? 1;
  const warnings: string[] = [];
  const newer = sourceVersion > KOVA_SCHEMA;
  if (newer) warnings.push(`Este proyecto se creó con una versión más nueva de KOVA Design Lab (formato ${sourceVersion}). Las partes que esta versión no conoce se conservan al guardar.`);
  const extra: Record<string, unknown> = {};
  for (const k of Object.keys(raw)) if (!KNOWN_KEYS.has(k)) extra[k] = raw[k];
  let garment3d: Garment3DData | undefined;
  if (raw.garment3d !== undefined) {
    garment3d = sanitizeGarment3D(raw.garment3d) ?? undefined;
    if (!garment3d) { warnings.push('La configuración 3D del proyecto no es válida y se ignoró.'); extra.garment3d = raw.garment3d; }
  }
  const models3d: Record<string, EmbeddedModel> = {};
  if (raw.models3d && typeof raw.models3d === 'object') {
    for (const [hash, m] of Object.entries<any>(raw.models3d)) {
      if (/^[0-9a-f]{64}$/.test(hash) && typeof m?.data === 'string' && m.data.startsWith('data:')) models3d[hash] = { name: String(m.name ?? 'Modelo'), mime: String(m.mime ?? 'model/gltf-binary'), data: m.data };
      else warnings.push('Se ignoró un modelo 3D embebido dañado.');
    }
  }
  let social: DocSocial | undefined;
  if (raw.social !== undefined) {
    social = sanitizeDocSocial(raw.social) ?? undefined;
    if (!social) { warnings.push('Los datos de redes sociales del proyecto no son válidos y se ignoraron.'); extra.social = raw.social; }
  }
  // formato de redes de cada mesa: lo que no se entienda se quita (la mesa se abre como una mesa normal)
  let state = raw.state;
  if (raw.state.artboards.some((a: any) => a?.social !== undefined)) {
    let dropped = 0;
    state = {
      ...raw.state,
      artboards: raw.state.artboards.map((a: any) => {
        if (a?.social === undefined || a.social === null) return a;
        const so = sanitizeArtboardSocial(a.social);
        if (!so) { dropped++; const { social: _s, ...rest } = a; return rest; }
        return { ...a, social: so };
      }),
    };
    if (dropped) warnings.push(`Se ignoró el formato de redes de ${dropped} mesa(s) porque estaba dañado.`);
  }
  const file: KovaFile = {
    format: KOVA_FORMAT,
    version: Math.max(sourceVersion, KOVA_SCHEMA),
    app: raw.app,
    id: raw.id,
    name: typeof raw.name === 'string' ? raw.name : 'Sin título',
    colorMode: raw.colorMode === 'CMYK' ? 'CMYK' : 'RGB',
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    state,
    assets: raw.assets ?? {},
    fonts: Array.isArray(raw.fonts) ? raw.fonts : [],
    ...(garment3d ? { garment3d } : {}),
    ...(Object.keys(models3d).length ? { models3d } : {}),
    ...(social ? { social } : {}),
  };
  return { file, sourceVersion, newer, extra, warnings };
}

/** Objeto listo para JSON.stringify: secciones conocidas + las desconocidas que traía el archivo. */
export function buildKova(file: Omit<KovaFile, 'format' | 'version' | 'app'>, extra: Record<string, unknown> = {}, version = KOVA_SCHEMA): KovaFile & Record<string, unknown> {
  return { ...extra, ...file, format: KOVA_FORMAT, version, app: { name: 'KOVA Design Lab', schema: KOVA_SCHEMA } };
}

/** Conversión inversa a v1 (para abrirlo en versiones anteriores de la app): quita lo que v1 no conoce. */
export function downgradeToV1(file: KovaFile & Record<string, unknown>) {
  const { garment3d: _g, models3d: _m, social: _s, app: _a, ...rest } = file;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) if (KNOWN_KEYS.has(k)) out[k] = v;
  const st = out.state as any;
  if (st && Array.isArray(st.artboards)) out.state = { ...st, artboards: st.artboards.map(({ social: _x, ...a }: any) => a) };
  return { ...out, format: KOVA_FORMAT, version: 1 };
}
