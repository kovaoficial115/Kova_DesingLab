// Biblioteca de prendas: cada prenda es un activo «garment» (su garment.json) que apunta a un
// activo «model» (el GLB). Ambos viven en el StorageEngine, deduplicados por hash.

import { storage, type AssetMeta } from '../storage';
import { parseConfig, defaultConfig, type GarmentConfig, type GarmentLicense } from './config';
import { loadGlb, disposeObject } from './loader';
import { validateGarment, type ValidationReport } from './validate';

export interface GarmentEntry {
  /** hash del activo de configuración */
  id: string;
  modelHash: string;
  config: GarmentConfig;
  triangles: number;
  sizeM: [number, number, number];
  license?: GarmentLicense;
  added: number;
}

interface GarmentMeta { modelHash: string; config: GarmentConfig; triangles: number; sizeM: [number, number, number]; license?: GarmentLicense }

const toEntry = (a: AssetMeta): GarmentEntry | null => {
  const m = a.meta as unknown as GarmentMeta | undefined;
  return m?.modelHash && m.config ? { id: a.hash, modelHash: m.modelHash, config: m.config, triangles: m.triangles, sizeM: m.sizeM, license: m.license, added: a.created } : null;
};

export async function listGarments(): Promise<GarmentEntry[]> {
  return (await storage.assets.list('garment')).map(toEntry).filter((e): e is GarmentEntry => !!e);
}

export async function readConfigFile(file: File | null | undefined, glbName: string) {
  if (!file) return { config: defaultConfig(glbName), errors: [] as string[] };
  try { return parseConfig(JSON.parse(await file.text()), glbName); }
  catch { return { config: defaultConfig(glbName), errors: ['garment.json no es JSON válido.'] }; }
}

/** Analiza un GLB con su configuración sin guardarlo. */
export async function inspectGarment(glb: Blob, config: GarmentConfig): Promise<ValidationReport> {
  const gltf = await loadGlb(glb);
  try { return validateGarment(gltf, config); } finally { disposeObject(gltf.scene); }
}

/** Añade a la biblioteca una prenda que pasó la validación. */
export async function addGarment(glb: Blob, config: GarmentConfig, report: ValidationReport): Promise<GarmentEntry> {
  if (!report.accepted) throw new Error('El modelo no cumple la lista de aceptación.');
  const model = await storage.assets.put(new Blob([glb], { type: 'model/gltf-binary' }), { type: 'model', name: `${config.name}.glb`, meta: { garmentId: config.id } });
  const license = config.license ?? report.stats.license;
  const meta: GarmentMeta = { modelHash: model.hash, config: { ...config, ...(license ? { license } : {}) }, triangles: report.stats.triangles, sizeM: report.stats.sizeM, license };
  const a = await storage.assets.put(new Blob([JSON.stringify(meta.config, null, 2)], { type: 'application/json' }), { type: 'garment', name: config.name, meta: meta as unknown as Record<string, unknown> });
  return toEntry(a)!;
}

/**
 * Prenda de ejemplo incluida con la app (public/garments): «T-Shirt Low Poly» de Chirag.Vijay,
 * CC-BY-4.0, simplificada para KOVA. Pasa por la misma validación que cualquier importación.
 */
export async function addSampleGarment(): Promise<GarmentEntry> {
  const base = new URL('garments/', document.baseURI);
  const [glbRes, cfgRes] = await Promise.all([fetch(new URL('camiseta-basica.glb', base)), fetch(new URL('camiseta-basica.garment.json', base))]);
  if (!glbRes.ok || !cfgRes.ok) throw new Error('No se pudo descargar la prenda de ejemplo.');
  const glb = await glbRes.blob();
  const { config } = parseConfig(await cfgRes.json(), 'camiseta-basica.glb');
  return addGarment(glb, config, await inspectGarment(glb, config));
}

/** Quita la prenda; el GLB se borra si ninguna otra prenda lo usa. */
export async function removeGarment(e: GarmentEntry) {
  await storage.assets.delete(e.id);
  const others = await listGarments();
  if (!others.some(g => g.modelHash === e.modelHash)) await storage.assets.delete(e.modelHash);
}

export async function garmentModel(e: GarmentEntry): Promise<Blob> {
  const rec = await storage.assets.get(e.modelHash);
  if (!rec) throw new Error(`Falta el modelo de «${e.config.name}» en la biblioteca.`);
  return rec.blob;
}

/** Cambia la configuración de una prenda de la biblioteca (el modelo no se toca). */
export async function updateGarmentConfig(e: GarmentEntry, patch: Partial<GarmentConfig>): Promise<GarmentEntry> {
  const config: GarmentConfig = { ...e.config, ...patch };
  const meta: GarmentMeta = { modelHash: e.modelHash, config, triangles: e.triangles, sizeM: e.sizeM, license: e.license };
  const a = await storage.assets.put(new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' }), { type: 'garment', name: config.name, meta: meta as unknown as Record<string, unknown> });
  if (a.hash !== e.id) await storage.assets.delete(e.id); // la configuración anterior deja de existir
  return toEntry(a)!;
}
