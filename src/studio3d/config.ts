// Configuración de una prenda 3D (garment.json). Añadir una prenda nueva = modelo GLB + este
// archivo, sin tocar el código. Los rectángulos de zona se usan en la fase 5 (estampados).

import type { PrintZoneId } from '../core/garment3d';
import { PRINT_ZONES } from '../core/garment3d';

export const CONFIG_SCHEMA = 1;

export interface ZoneConfig {
  /** rectángulo en el espacio UV de impresión: [u0, v0, u1, v1] (0..1) */
  uv: [number, number, number, number];
  /** tamaño físico máximo de impresión en la prenda, cm */
  sizeCm: [number, number];
}

export interface GarmentLicense {
  name: string;
  author?: string;
  source?: string;
  /** se puede publicar el archivo (repositorio/web). Si es false, solo vive en la biblioteca local. */
  redistributable: boolean;
}

export interface GarmentConfig {
  schema: number;
  id: string;
  name: string;
  category: 'tshirt' | 'hoodie' | 'sport' | 'crop' | 'longsleeve' | 'other';
  /** metros por unidad del modelo (1 si ya viene en metros) */
  unitScale: number;
  /** mallas que forman la prenda imprimible; vacío = todas salvo accesorios */
  printableMeshes: string[];
  /** maniquí, cordones, etiquetas… (se muestran pero no reciben estampado) */
  accessoryMeshes: string[];
  zones: Partial<Record<PrintZoneId, ZoneConfig>>;
  license?: GarmentLicense;
}

const REDISTRIBUTABLE = /^(cc0|cc-by(?!-n[cd])|cc-by-4|cc-by-sa|public domain|mit)/i;
/** Licencia leída de los metadatos que Sketchfab (y otros) guardan en asset.extras. */
export function licenseFromExtras(extras: any): GarmentLicense | undefined {
  if (!extras || typeof extras.license !== 'string') return undefined;
  const name = extras.license.replace(/\s*\(https?:[^)]*\)\s*$/, '').trim();
  return {
    name,
    author: typeof extras.author === 'string' ? extras.author.replace(/\s*\(https?:[^)]*\)\s*$/, '') : undefined,
    source: typeof extras.source === 'string' ? extras.source : undefined,
    redistributable: REDISTRIBUTABLE.test(name) && !/\bN[CD]\b/i.test(name),
  };
}

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'prenda';

/** Configuración por defecto para un GLB sin garment.json. */
export function defaultConfig(name: string): GarmentConfig {
  const n = name.replace(/\.(glb|gltf)$/i, '').replace(/[_-]+/g, ' ').trim();
  const category: GarmentConfig['category'] = /hood|sudad/i.test(n) ? 'hoodie' : /t.?shirt|camis|tee/i.test(n) ? 'tshirt' : 'other';
  return { schema: CONFIG_SCHEMA, id: slug(n), name: n.charAt(0).toUpperCase() + n.slice(1), category, unitScale: 1, printableMeshes: [], accessoryMeshes: [], zones: {} };
}

/** Lee un garment.json; los campos ausentes o inválidos toman el valor por defecto. */
export function parseConfig(raw: unknown, fallbackName: string): { config: GarmentConfig; errors: string[] } {
  const base = defaultConfig(fallbackName);
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') return { config: base, errors: ['La configuración no es un objeto JSON.'] };
  const r = raw as Record<string, any>;
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const zones: GarmentConfig['zones'] = {};
  for (const z of PRINT_ZONES) {
    const c = r.zones?.[z];
    if (!c) continue;
    const uv = c.uv, size = c.sizeCm;
    const okUv = Array.isArray(uv) && uv.length === 4 && uv.every((n: unknown) => typeof n === 'number' && n >= 0 && n <= 1) && uv[2] > uv[0] && uv[3] > uv[1];
    const okSize = Array.isArray(size) && size.length === 2 && size.every((n: unknown) => typeof n === 'number' && n > 0 && n < 200);
    if (okUv && okSize) zones[z] = { uv: [uv[0], uv[1], uv[2], uv[3]], sizeCm: [size[0], size[1]] };
    else errors.push(`Zona «${z}» inválida: uv debe ser [u0,v0,u1,v1] entre 0 y 1 y sizeCm [ancho, alto] en cm.`);
  }
  const unitScale = typeof r.unitScale === 'number' && r.unitScale > 0 ? r.unitScale : base.unitScale;
  if (r.unitScale !== undefined && unitScale !== r.unitScale) errors.push('unitScale debe ser un número mayor que 0.');
  const lic = r.license && typeof r.license.name === 'string'
    ? { name: r.license.name, author: r.license.author, source: r.license.source, redistributable: r.license.redistributable === true }
    : undefined;
  return {
    config: {
      schema: CONFIG_SCHEMA,
      id: typeof r.id === 'string' && r.id ? slug(r.id) : base.id,
      name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : base.name,
      category: ['tshirt', 'hoodie', 'sport', 'crop', 'longsleeve', 'other'].includes(r.category) ? r.category : base.category,
      unitScale,
      printableMeshes: strs(r.printableMeshes),
      accessoryMeshes: strs(r.accessoryMeshes),
      zones,
      ...(lic ? { license: lic } : {}),
    },
    errors,
  };
}
