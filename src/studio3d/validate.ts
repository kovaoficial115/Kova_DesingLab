// Checklist de aceptación de modelos GLB (manual del Estudio 3D, sección 9).
// Un modelo con algún punto en «fail» no entra en la biblioteca: se informa, no se fuerza.

import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GarmentConfig, GarmentLicense } from './config';
import { licenseFromExtras } from './config';
import { uvOverlap, singleTile } from './uvOverlap';
import { PRINT_ZONES } from '../core/garment3d';

export const LIMITS = { triangles: 50_000, texturePx: 2048, minHeightM: 0.3, maxHeightM: 1.6, uvOverlapZone: 0.005, uvOverlapWhole: 0.02 } as const;

export type CheckStatus = 'ok' | 'warn' | 'fail';
export interface Check { id: string; label: string; status: CheckStatus; detail: string }
export interface MeshInfo { name: string; triangles: number; printable: boolean; hasUv: boolean }
export interface ValidationReport {
  accepted: boolean;
  checks: Check[];
  stats: { triangles: number; meshes: MeshInfo[]; sizeM: [number, number, number]; textureMax: number; license?: GarmentLicense };
}

const fmt = (n: number) => n.toLocaleString('es');
const meshName = (m: THREE.Object3D) => m.name || m.parent?.name || 'sin nombre';

/** Mallas de la prenda (no accesorios) según la configuración. */
export function isPrintable(m: THREE.Object3D, cfg: GarmentConfig) {
  const names = [m.name, m.parent?.name].filter(Boolean) as string[];
  if (names.some(n => cfg.accessoryMeshes.includes(n))) return false;
  return cfg.printableMeshes.length ? names.some(n => cfg.printableMeshes.includes(n)) : true;
}

export function validateGarment(gltf: GLTF, cfg: GarmentConfig): ValidationReport {
  const checks: Check[] = [];
  const meshes: MeshInfo[] = [];
  const printable: THREE.Mesh[] = [];
  let textureMax = 0, triangles = 0;
  const textures = new Set<THREE.Texture>();
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry;
    const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    const p = isPrintable(m, cfg);
    triangles += tris;
    meshes.push({ name: meshName(m), triangles: tris, printable: p, hasUv: !!g.attributes.uv });
    if (p) printable.push(m);
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) for (const v of Object.values(mat ?? {})) if (v && (v as THREE.Texture).isTexture) textures.add(v as THREE.Texture);
  });
  for (const t of textures) { const im = t.image as { width?: number; height?: number } | undefined; textureMax = Math.max(textureMax, im?.width ?? 0, im?.height ?? 0); }

  // 1. triángulos
  checks.push({ id: 'triangles', label: `Máximo ${fmt(LIMITS.triangles)} triángulos`, status: triangles <= LIMITS.triangles ? 'ok' : 'fail',
    detail: triangles <= LIMITS.triangles ? `${fmt(triangles)} triángulos.` : `${fmt(triangles)} triángulos (${(triangles / LIMITS.triangles).toFixed(1)}× el límite). Reduce la malla en Blender (Decimate) antes de importarla.` });

  // 2. texturas
  checks.push({ id: 'textures', label: `Texturas de ${LIMITS.texturePx} px o menos`, status: textureMax <= LIMITS.texturePx ? 'ok' : 'fail',
    detail: textures.size ? `${textures.size} textura(s), la mayor de ${textureMax} px.` : 'Sin texturas.' });

  // 3. escala real y 4. origen
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3()).multiplyScalar(cfg.unitScale);
  const center = box.getCenter(new THREE.Vector3()).multiplyScalar(cfg.unitScale);
  const h = size.y;
  const scaleOk = h >= LIMITS.minHeightM && h <= LIMITS.maxHeightM;
  checks.push({ id: 'scale', label: 'Escala real en metros', status: scaleOk ? 'ok' : 'fail',
    detail: scaleOk ? `Alto ${(h * 100).toFixed(0)} cm · ancho ${(size.x * 100).toFixed(0)} cm.`
      : `Mide ${h.toFixed(2)} unidades de alto: no es una prenda en metros. Escálala en Blender o indica «unitScale» en su garment.json (unitScale ≈ ${(0.7 / (h / cfg.unitScale)).toPrecision(2)} para ~70 cm).` });
  const off = center.length(); // también la altura: muchos modelos vienen colocados sobre un cuerpo
  checks.push({ id: 'origin', label: 'Origen centrado', status: off <= Math.max(0.05, size.x * 0.1) ? 'ok' : 'warn',
    detail: off <= Math.max(0.05, size.x * 0.1) ? 'Centrado.' : `Desplazado ${(off * 100).toFixed(0)} cm del origen. El visor lo centra al cargar; conviene corregirlo en Blender.` });

  // 5. mallas separadas
  const acc = meshes.filter(m => !m.printable);
  checks.push({ id: 'meshes', label: 'Prenda separada de accesorios', status: printable.length ? (meshes.length > 1 && !cfg.printableMeshes.length && !cfg.accessoryMeshes.length ? 'warn' : 'ok') : 'fail',
    detail: !printable.length ? 'Ninguna malla de la configuración existe en el modelo.'
      : meshes.length === 1 ? 'Una sola malla.'
      : cfg.printableMeshes.length || cfg.accessoryMeshes.length ? `${printable.length} malla(s) de prenda, ${acc.length} accesorio(s).`
      : `${meshes.length} mallas y la configuración no indica cuál es la prenda: se tratan todas como prenda (${meshes.map(m => m.name).join(', ')}).` });

  // 6. UV
  const noUv = printable.filter(m => !m.geometry.attributes.uv);
  if (noUv.length) checks.push({ id: 'uv', label: 'UV sin solapes en zonas imprimibles', status: 'fail', detail: `Sin coordenadas UV: ${noUv.map(meshName).join(', ')}.` });
  else if (triangles > LIMITS.triangles * 4) checks.push({ id: 'uv', label: 'UV sin solapes en zonas imprimibles', status: 'warn', detail: 'No analizado: el modelo es demasiado pesado.' });
  else {
    const zones = PRINT_ZONES.filter(z => cfg.zones[z]?.uv);
    const results: string[] = [];
    let status: CheckStatus = 'ok';
    const regions: [string, [number, number, number, number], number][] = zones.length ? zones.map(z => [z, cfg.zones[z]!.uv!, LIMITS.uvOverlapZone]) : [['todo el UV', [0, 0, 1, 1], LIMITS.uvOverlapWhole]];
    for (const [name, region, limit] of regions) {
      // todas las mallas imprimibles comparten el mismo atlas de impresión
      const uv: number[] = [], idx: number[] = [], pos: number[] = [];
      const v3 = new THREE.Vector3();
      for (const m of printable) {
        const g = m.geometry, base = uv.length / 2, a = g.attributes.uv, pa = g.attributes.position;
        m.updateWorldMatrix(true, false);
        // posiciones en metros reales (la escala del modelo se corrige con unitScale)
        for (let i = 0; i < pa.count; i++) { v3.fromBufferAttribute(pa, i).applyMatrix4(m.matrixWorld).multiplyScalar(cfg.unitScale); pos.push(v3.x, v3.y, v3.z); }
        // UV desplazadas a otra casilla (textura en repetición): se analizan en 0..1
        const tile = singleTile(a.array.length === a.count * 2 ? a.array : Array.from({ length: a.count * 2 }, (_, k) => (k & 1 ? a.getY(k >> 1) : a.getX(k >> 1)))) ?? [0, 0];
        for (let i = 0; i < a.count; i++) uv.push(a.getX(i) - tile[0], a.getY(i) - tile[1]);
        if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
        else for (let i = 0; i < a.count; i++) idx.push(base + i);
      }
      const r = uvOverlap(uv, idx, region, 512, { positions: pos, thicknessM: 0.03 });
      if (r.overlap > limit) status = zones.length ? 'fail' : 'warn';
      if (r.coverage < 0.02) {
        // sin cobertura no se ha medido nada: no se puede dar por bueno
        status = 'fail';
        results.push(`${name}: la malla apenas ocupa el atlas (${(r.coverage * 100).toFixed(1)} %), UV fuera de 0–1`);
      } else results.push(`${name}: ${(r.overlap * 100).toFixed(1)} % solapado, ${(r.coverage * 100).toFixed(0)} % del atlas ocupado`
        + (r.shell > 0.01 ? ` (el ${(r.shell * 100).toFixed(0)} % lo comparten el exterior y el interior de la tela: es normal en prendas con grosor)` : ''));
    }
    checks.push({ id: 'uv', label: 'UV sin solapes en zonas imprimibles', status,
      detail: results.join(' · ') + (zones.length ? '' : '. Cada estampado comprueba al aplicarse que su zona cae en una sola isla UV.') });
  }

  // 7. licencia
  const license = cfg.license ?? licenseFromExtras(gltf.asset?.extras);
  checks.push({ id: 'license', label: 'Licencia que permite usarlo', status: license ? (license.redistributable ? 'ok' : 'warn') : 'fail',
    detail: !license ? 'El modelo no declara licencia. Indícala en su garment.json («license») antes de usarlo.'
      : `${license.name}${license.author ? ' · ' + license.author : ''}.` + (license.redistributable ? ' Se puede publicar con atribución.' : ' No permite redistribuir el archivo: solo se guarda en la biblioteca local de este equipo.') });

  return { accepted: !checks.some(c => c.status === 'fail'), checks, stats: { triangles, meshes, sizeM: [size.x, size.y, size.z], textureMax, license } };
}
