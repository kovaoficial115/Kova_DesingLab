// Zonas de impresión de una prenda: dónde está cada área (en cm, medida sobre la prenda real)
// y desde qué lado se proyecta. Cada categoría trae sus medidas habituales de DTF; el
// garment.json de un modelo puede corregir cualquiera de ellas.

import * as THREE from 'three';
import type { PrintZoneId } from '../core/garment3d';
import { PRINT_ZONES } from '../core/garment3d';
import type { GarmentConfig, ZoneView } from './config';

export const ZONE_LABELS: Record<PrintZoneId, string> = {
  front: 'Frente', back: 'Espalda', sleeveLeft: 'Manga izquierda', sleeveRight: 'Manga derecha', neck: 'Cuello',
};

export interface ZoneDef {
  id: PrintZoneId;
  view: ZoneView;
  /** [cm a la derecha del eje (visto desde `view`), cm por debajo del borde superior de la prenda] */
  centerCm: [number, number];
  sizeCm: [number, number];
  uv?: [number, number, number, number];
}

type Defaults = Record<PrintZoneId, Omit<ZoneDef, 'id'>>;

// La prenda mira hacia +Z (convención glTF). «Izquierda» es la del que la lleva puesta,
// que vista de frente queda a la derecha de la pantalla (+X).
const TSHIRT: Defaults = {
  front: { view: 'front', centerCm: [0, 34], sizeCm: [32, 40] }, // empieza bajo la caída del cuello delantero
  back: { view: 'back', centerCm: [0, 30], sizeCm: [34, 42] },
  neck: { view: 'back', centerCm: [0, 6], sizeCm: [9, 6] },
  // la cara exterior de la manga mira hacia el lado: se proyecta desde el costado
  sleeveLeft: { view: 'right', centerCm: [0, 17], sizeCm: [9, 9] },
  sleeveRight: { view: 'left', centerCm: [0, 17], sizeCm: [9, 9] },
};
const HOODIE: Defaults = {
  // la abertura de la capucha baja hasta ~30 cm y el bolsillo empieza hacia los 48 cm
  front: { view: 'front', centerCm: [0, 41], sizeCm: [28, 18] },
  // la capucha cuelga sobre la espalda hasta ~40 cm
  back: { view: 'back', centerCm: [0, 55], sizeCm: [32, 26] },
  neck: { view: 'back', centerCm: [0, 30], sizeCm: [9, 6] },
  // brazos en cruz: la cara delantera del brazo, cerca del hombro
  sleeveLeft: { view: 'front', centerCm: [38, 33], sizeCm: [10, 8] },
  sleeveRight: { view: 'front', centerCm: [-38, 33], sizeCm: [10, 8] },
};
// camiseta deportiva: dorsal grande en la espalda (nombre y número)
const SPORT: Defaults = {
  ...TSHIRT,
  front: { view: 'front', centerCm: [0, 30], sizeCm: [28, 30] },
  back: { view: 'back', centerCm: [0, 30], sizeCm: [32, 42] },
};
// crop: el cuerpo es más corto, las áreas también
const CROP: Defaults = {
  ...TSHIRT,
  front: { view: 'front', centerCm: [0, 25], sizeCm: [26, 18] },
  back: { view: 'back', centerCm: [0, 23], sizeCm: [28, 20] },
};
// manga larga: el estampado de manga corre a lo largo del brazo
const LONGSLEEVE: Defaults = {
  ...TSHIRT,
  sleeveLeft: { view: 'right', centerCm: [0, 38], sizeCm: [8, 34] },
  sleeveRight: { view: 'left', centerCm: [0, 38], sizeCm: [8, 34] },
};
const BY_CATEGORY: Partial<Record<GarmentConfig['category'], Defaults>> = { hoodie: HOODIE, sport: SPORT, crop: CROP, longsleeve: LONGSLEEVE };

export function zoneDefs(cfg: GarmentConfig): ZoneDef[] {
  const d = BY_CATEGORY[cfg.category] ?? TSHIRT;
  return PRINT_ZONES.map(id => {
    const o = cfg.zones[id];
    return { id, ...d[id], ...(o ? { sizeCm: o.sizeCm, ...(o.view ? { view: o.view } : {}), ...(o.centerCm ? { centerCm: o.centerCm } : {}), ...(o.uv ? { uv: o.uv } : {}) } : {}) };
  });
}
export const zoneDef = (cfg: GarmentConfig, id: PrintZoneId) => zoneDefs(cfg).find(z => z.id === id)!;

/** Ejes del plano de proyección: `right` y `up` sobre el plano, `toward` apunta hacia quien mira. */
export interface Basis { right: THREE.Vector3; up: THREE.Vector3; toward: THREE.Vector3 }
export function basisFor(view: ZoneView): Basis {
  const toward = new THREE.Vector3(...({ front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0] } as const)[view]);
  const up = new THREE.Vector3(0, 1, 0);
  // right = adelante × arriba, con adelante = −toward
  const right = toward.clone().negate().cross(up).normalize();
  return { right, up, toward };
}
