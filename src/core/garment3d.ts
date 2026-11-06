// Datos del Estudio 3D que viajan dentro del .kova (sección opcional `garment3d`).
// Tipos compartidos entre el formato de archivo, el almacenamiento y el visor 3D.

export const GARMENT3D_SCHEMA = 1;

export const PRINT_ZONES = ['front', 'back', 'sleeveLeft', 'sleeveRight', 'neck'] as const;
export type PrintZoneId = (typeof PRINT_ZONES)[number];

/** Estampado aplicado a una zona: el arte sale de una mesa de trabajo del propio documento. */
export interface ZonePrint {
  artboardId: string | null;
  /** posición del centro dentro de la zona, 0..1 */
  x: number;
  y: number;
  /** 1 = tamaño físico real de la mesa sobre la prenda */
  scale: number;
  /** grados */
  rotation: number;
}

export type GarmentModelRef =
  | { source: 'catalog'; id: string; version?: number }    // prenda incluida en la app
  | { source: 'asset'; hash: string; name: string; config?: Record<string, unknown> }; // GLB importado + su garment.json

export interface GarmentMaterial { preset: string; roughness: number; normalScale: number }
export interface GarmentCamera { position: [number, number, number]; target: [number, number, number]; fov: number }
export interface GarmentLighting { preset: string; background: string | null }

export interface Garment3DData {
  schema: number;
  model: GarmentModelRef;
  color: string;
  material: GarmentMaterial;
  zones: Partial<Record<PrintZoneId, ZonePrint>>;
  camera?: GarmentCamera;
  lighting?: GarmentLighting;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(isNum);

/** Valida la sección 3D de un archivo. Devuelve null si no se puede usar (el resto del proyecto se abre igual). */
export function sanitizeGarment3D(raw: unknown): Garment3DData | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  const m = r.model;
  let model: GarmentModelRef | null = null;
  if (m?.source === 'catalog' && typeof m.id === 'string') model = { source: 'catalog', id: m.id, ...(isNum(m.version) ? { version: m.version } : {}) };
  else if (m?.source === 'asset' && typeof m.hash === 'string' && /^[0-9a-f]{64}$/.test(m.hash)) model = { source: 'asset', hash: m.hash, name: String(m.name ?? 'Modelo'), ...(m.config && typeof m.config === 'object' && !Array.isArray(m.config) ? { config: m.config } : {}) };
  if (!model) return null;
  const zones: Garment3DData['zones'] = {};
  for (const z of PRINT_ZONES) {
    const p = r.zones?.[z];
    if (!p || typeof p !== 'object') continue;
    zones[z] = {
      artboardId: typeof p.artboardId === 'string' ? p.artboardId : null,
      x: isNum(p.x) ? Math.min(1, Math.max(0, p.x)) : 0.5,
      y: isNum(p.y) ? Math.min(1, Math.max(0, p.y)) : 0.5,
      scale: isNum(p.scale) && p.scale > 0 ? p.scale : 1,
      rotation: isNum(p.rotation) ? p.rotation : 0,
    };
  }
  const mat = r.material ?? {};
  return {
    schema: isNum(r.schema) ? r.schema : GARMENT3D_SCHEMA,
    model,
    color: typeof r.color === 'string' && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : '#f0e7de',
    material: { preset: typeof mat.preset === 'string' ? mat.preset : 'cotton', roughness: isNum(mat.roughness) ? mat.roughness : 0.85, normalScale: isNum(mat.normalScale) ? mat.normalScale : 1 },
    zones,
    ...(r.camera && isVec3(r.camera.position) && isVec3(r.camera.target) && isNum(r.camera.fov) ? { camera: { position: r.camera.position, target: r.camera.target, fov: r.camera.fov } } : {}),
    ...(r.lighting && typeof r.lighting.preset === 'string' ? { lighting: { preset: r.lighting.preset, background: typeof r.lighting.background === 'string' ? r.lighting.background : null } } : {}),
  };
}
