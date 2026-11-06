// Proyección ortográfica sobre la prenda: para un punto del plano de una zona devuelve qué
// superficie queda delante (malla, material, UV y posición). Todos los rayos son paralelos, así
// que basta una rejilla 2D con los triángulos proyectados: rápido aunque se muevan los
// controles y sin depender de Raycaster (que recorrería las 50.000 caras en cada rayo).

import * as THREE from 'three';
import type { Basis } from './zones';

export interface Hit {
  mesh: number;
  material: number;
  uv: [number, number] | null;
  /** coordenada a lo largo de `toward` (mayor = más cerca de quien mira) */
  depth: number;
  point: THREE.Vector3;
}

const EPS = 1e-9;

export class Projector {
  readonly meshes: THREE.Mesh[];
  /** por triángulo: x0 y0 z0 x1 y1 z1 x2 y2 z2 en coordenadas del plano */
  private tri: Float32Array;
  private uv: Float32Array;
  private hasUv: Uint8Array;
  private meshOf: Uint16Array;
  private matOf: Uint16Array;
  private cells: Uint32Array[];
  private x0 = 0; private y0 = 0; private gw = 1; private gh = 1;

  constructor(meshes: THREE.Mesh[], readonly basis: Basis, private cell = 0.02) {
    this.meshes = meshes;
    let total = 0;
    for (const m of meshes) total += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3;
    this.tri = new Float32Array(total * 9);
    this.uv = new Float32Array(total * 6);
    this.hasUv = new Uint8Array(total);
    this.meshOf = new Uint16Array(total);
    this.matOf = new Uint16Array(total);
    const v = new THREE.Vector3();
    const { right, up, toward } = basis;
    let t = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    meshes.forEach((m, mi) => {
      m.updateWorldMatrix(true, false);
      const g = m.geometry, pos = g.attributes.position, uv = g.attributes.uv, idx = g.index;
      const n = (idx?.count ?? pos.count) / 3;
      for (let f = 0; f < n; f++, t++) {
        for (let k = 0; k < 3; k++) {
          const i = idx ? idx.getX(f * 3 + k) : f * 3 + k;
          v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
          const x = v.dot(right), y = v.dot(up);
          this.tri[t * 9 + k * 3] = x; this.tri[t * 9 + k * 3 + 1] = y; this.tri[t * 9 + k * 3 + 2] = v.dot(toward);
          if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
          if (uv) { this.uv[t * 6 + k * 2] = uv.getX(i); this.uv[t * 6 + k * 2 + 1] = uv.getY(i); }
        }
        this.hasUv[t] = uv ? 1 : 0;
        this.meshOf[t] = mi;
        this.matOf[t] = materialIndex(g, f);
      }
    });
    if (!total) { this.cells = [new Uint32Array(0)]; return; }
    this.x0 = minX; this.y0 = minY;
    this.gw = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
    this.gh = Math.max(1, Math.ceil((maxY - minY) / cell) + 1);
    // dos pasadas: contar y llenar (sin arrays dinámicos por celda)
    const count = new Uint32Array(this.gw * this.gh);
    const each = (fn: (c: number, t: number) => void) => {
      for (let i = 0; i < total; i++) {
        const o = i * 9, xs = [this.tri[o], this.tri[o + 3], this.tri[o + 6]], ys = [this.tri[o + 1], this.tri[o + 4], this.tri[o + 7]];
        const cx0 = this.cx(Math.min(...xs)), cx1 = this.cx(Math.max(...xs)), cy0 = this.cy(Math.min(...ys)), cy1 = this.cy(Math.max(...ys));
        for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) fn(cy * this.gw + cx, i);
      }
    };
    each(c => count[c]++);
    this.cells = Array.from(count, n => new Uint32Array(n));
    const fill = new Uint32Array(this.gw * this.gh);
    each((c, i) => { this.cells[c][fill[c]++] = i; });
  }

  private cx(x: number) { return Math.min(this.gw - 1, Math.max(0, Math.floor((x - this.x0) / this.cell))); }
  private cy(y: number) { return Math.min(this.gh - 1, Math.max(0, Math.floor((y - this.y0) / this.cell))); }

  /** Superficie más cercana a quien mira en el punto (x, y) del plano, o null si no hay prenda. */
  sample(x: number, y: number): Hit | null {
    const fx = (x - this.x0) / this.cell, fy = (y - this.y0) / this.cell;
    if (fx < 0 || fy < 0 || fx >= this.gw || fy >= this.gh) return null;
    const list = this.cells[Math.floor(fy) * this.gw + Math.floor(fx)];
    let best = -1, bestZ = -Infinity, b0 = 0, b1 = 0, b2 = 0;
    const T = this.tri;
    for (let k = 0; k < list.length; k++) {
      const i = list[k], o = i * 9;
      const ax = T[o], ay = T[o + 1], bx = T[o + 3], by = T[o + 4], cx = T[o + 6], cy = T[o + 7];
      const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(d) < EPS) continue; // triángulo de canto: no se ve
      const w0 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
      const w1 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
      const w2 = 1 - w0 - w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const z = w0 * T[o + 2] + w1 * T[o + 5] + w2 * T[o + 8];
      if (z > bestZ) { bestZ = z; best = i; b0 = w0; b1 = w1; b2 = w2; }
    }
    if (best < 0) return null;
    const u = this.uv, q = best * 6;
    const { right, up, toward } = this.basis;
    return {
      mesh: this.meshOf[best],
      material: this.matOf[best],
      uv: this.hasUv[best] ? [b0 * u[q] + b1 * u[q + 2] + b2 * u[q + 4], b0 * u[q + 1] + b1 * u[q + 3] + b2 * u[q + 5]] : null,
      depth: bestZ,
      point: right.clone().multiplyScalar(x).addScaledVector(up, y).addScaledVector(toward, bestZ),
    };
  }
}

function materialIndex(g: THREE.BufferGeometry, face: number) {
  if (!g.groups.length) return 0;
  const i = face * 3;
  for (const gr of g.groups) if (i >= gr.start && i < gr.start + gr.count) return gr.materialIndex ?? 0;
  return 0;
}
