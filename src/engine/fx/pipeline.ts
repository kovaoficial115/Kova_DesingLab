// Pila de efectos: ejecuta en orden los ajustes clásicos y los efectos del registro, cada uno con
// su opacidad y su modo de fusión respecto a lo que había antes. Puro: worker, pruebas y LUTs.

import type { Px } from '../pixels';
import { runAdjustment } from '../pixels';
import { runFx, scaleParams } from './registry';
import { mixInto, type FxBlend } from './core';

export interface StackItem { type: string; params: any; opacity?: number; blend?: FxBlend | string }

/** `scale` < 1: vista previa reducida (los parámetros en px se reducen en la misma proporción). */
export function runStack(img: Px, items: StackItem[], scale = 1) {
  for (const a of items) {
    const op = typeof a.opacity === 'number' ? Math.max(0, Math.min(100, a.opacity)) : 100;
    if (op <= 0) continue;
    const blend = (a.blend || 'normal') as FxBlend;
    const before = op < 100 || blend !== 'normal' ? new Uint8ClampedArray(img.data) : null;
    const prm = scale !== 1 ? scaleParams(a.type, a.params ?? {}, scale) : (a.params ?? {});
    if (!runFx(img, a.type, prm)) runAdjustment(img, a.type, prm);
    if (before) mixInto(before, img.data, blend, op / 100);
  }
  return img;
}
