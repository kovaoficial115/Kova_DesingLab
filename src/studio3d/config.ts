// Configuración de una prenda 3D (garment.json). Añadir una prenda nueva = modelo GLB + este
// archivo, sin tocar el código. Las zonas que no se indiquen toman los valores de su categoría.

import type { PrintZoneId } from '../core/garment3d';
import { PRINT_ZONES } from '../core/garment3d';
import { isPreset, type FabricPreset } from './fabric';

export const CONFIG_SCHEMA = 1;

export type ZoneView = 'front' | 'back' | 'left' | 'right';
export const ZONE_VIEWS: readonly ZoneView[] = ['front', 'back', 'left', 'right'];

export interface ZoneConfig {
  /** tamaño físico del área de impresión en la prenda, cm [ancho, alto] */
  sizeCm: [number, number];
  /** desde dónde se proyecta el estampado */
  view?: ZoneView;
  /** centro del área: [cm a la derecha del eje vertical visto desde `view`, cm por debajo del borde superior] */
  centerCm?: [number, number];
  /** opcional: rectángulo UV fijo [u0, v0, u1, v1] (0..1, v hacia abajo como la imagen).
   *  Si falta, la correspondencia con el atlas UV se calcula sobre la malla. */
  uv?: [number, number, number, number];
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
  /** false = ignorar la textura de color del modelo (p. ej. una cuadrícula de prueba UV) y usar solo el color de tela */
  useBaseColorMap?: boolean;
  /** tela por defecto de esta prenda */
  fabric?: FabricPreset;
}

/** Tela habitual de cada categoría. */
export const CATEGORY_FABRIC: Record<GarmentConfig['category'], FabricPreset> = {
  tshirt: 'cotton', hoodie: 'fleece', sport: 'polyester', crop: 'cotton', longsleeve: 'cotton', other: 'cotton',
};
export const fabricOf = (c: GarmentConfig): FabricPreset => c.fabric ?? CATEGORY_FABRIC[c.category] ?? 'cotton';

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
  const category: GarmentConfig['category'] = /hood|sudad/i.test(n) ? 'hoodie' : /long.?sleeve|manga.?larga/i.test(n) ? 'longsleeve' : /crop/i.test(n) ? 'crop'
    : /jersey|sport|deport|soccer|futbol|fútbol/i.test(n) ? 'sport' : /t.?shirt|camis|tee|polo/i.test(n) ? 'tshirt' : 'other';
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
    const uv = c.uv, size = c.sizeCm, center = c.centerCm;
    const num = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
    const okSize = Array.isArray(size) && size.length === 2 && size.every((n: unknown) => num(n) && (n as number) > 0 && (n as number) < 200);
    const okUv = uv === undefined || (Array.isArray(uv) && uv.length === 4 && uv.every((n: unknown) => num(n) && (n as number) >= 0 && (n as number) <= 1) && uv[2] > uv[0] && uv[3] > uv[1]);
    const okCenter = center === undefined || (Array.isArray(center) && center.length === 2 && center.every((n: unknown) => num(n) && Math.abs(n as number) < 300));
    const okView = c.view === undefined || ZONE_VIEWS.includes(c.view);
    if (okSize && okUv && okCenter && okView) {
      zones[z] = {
        sizeCm: [size[0], size[1]],
        ...(c.view ? { view: c.view as ZoneView } : {}),
        ...(center ? { centerCm: [center[0], center[1]] as [number, number] } : {}),
        ...(uv ? { uv: [uv[0], uv[1], uv[2], uv[3]] as [number, number, number, number] } : {}),
      };
    } else errors.push(`Zona «${z}» inválida: sizeCm es [ancho, alto] en cm; view, centerCm [x, y] en cm y uv [u0,v0,u1,v1] entre 0 y 1 son opcionales.`);
  }
  if (r.fabric !== undefined && !isPreset(r.fabric)) errors.push('fabric debe ser cotton, fleece o polyester.');
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
      ...(r.useBaseColorMap === false ? { useBaseColorMap: false } : {}),
      ...(isPreset(r.fabric) ? { fabric: r.fabric } : {}),
    },
    errors,
  };
}
