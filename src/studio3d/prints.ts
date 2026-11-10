// Estampados 2D → 3D. Cada zona recibe una mesa de trabajo del editor a su tamaño físico.
//  · Modo UV (preferente): el arte se pinta dentro del atlas de texturas de la tela, deformado
//    por triángulos para seguir el despliegue UV. Queda «impreso» en el tejido: misma luz y
//    pliegues, sin geometría extra.
//  · Modo calcomanía (respaldo): si la zona cruza una costura UV, sale de la malla o el
//    material no admite atlas, se proyecta con DecalGeometry.

import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import type { PrintZoneId, ZonePrint } from '../core/garment3d';
import type { ZoneDef } from './zones';
import { basisFor } from './zones';
import { Projector, type Hit } from './projector';
import { isFabric, blankTexture, type FabricMaterial } from './fabric';

export interface PreparedPrint {
  zone: ZoneDef;
  print: ZonePrint;
  /** arte ya renderizado (fondo transparente) */
  image: HTMLCanvasElement | ImageBitmap;
  /** tamaño físico de la mesa de trabajo, metros */
  sizeM: [number, number];
  /** parte con tinta del arte [s0, t0, s1, t1] (0..1); lo transparente no se estampa ni se analiza */
  ink?: [number, number, number, number];
}
export type PrintMode = 'uv' | 'decal' | 'none';
export interface PrintResult { zone: PrintZoneId; mode: PrintMode; reason?: string; overflow: boolean; /** tamaño de lo que se imprime (la parte con tinta), cm */ inkCm?: [number, number] }

/** Rectángulo del estampado en el plano de su zona (metros). */
export interface PrintFrame { cx: number; cy: number; w: number; h: number; angle: number }

/** Centro, tamaño y giro del estampado. `top` = borde superior de la prenda en el plano. */
export function printFrame(zone: ZoneDef, p: ZonePrint, sizeM: [number, number], top: number): PrintFrame {
  const zw = zone.sizeCm[0] / 100, zh = zone.sizeCm[1] / 100;
  const zx = zone.centerCm[0] / 100, zy = top - zone.centerCm[1] / 100;
  return {
    cx: zx + (p.x - 0.5) * zw, cy: zy + (0.5 - p.y) * zh,
    w: sizeM[0] * p.scale, h: sizeM[1] * p.scale,
    // en el editor el giro positivo es horario; en el plano (y hacia arriba) es negativo
    angle: -THREE.MathUtils.degToRad(p.rotation),
  };
}

/** Punto del plano para la coordenada (s, t) del arte: s hacia la derecha, t hacia abajo, 0..1. */
export function framePoint(f: PrintFrame, s: number, t: number): [number, number] {
  const lx = (s - 0.5) * f.w, ly = (0.5 - t) * f.h, c = Math.cos(f.angle), sn = Math.sin(f.angle);
  return [f.cx + lx * c - ly * sn, f.cy + lx * sn + ly * c];
}

/** Rectángulo de la parte con tinta, dentro del rectángulo completo del arte. */
export function inkFrame(f: PrintFrame, ink?: [number, number, number, number]): PrintFrame {
  if (!ink) return f;
  const [s0, t0, s1, t1] = ink;
  const [cx, cy] = framePoint(f, (s0 + s1) / 2, (t0 + t1) / 2);
  return { cx, cy, w: f.w * (s1 - s0), h: f.h * (t1 - t0), angle: f.angle };
}

/** Caja con tinta (alfa > 0) de un arte, en fracciones; null si está vacío. */
export function inkBox(alpha: (x: number, y: number) => number, w: number, h: number): [number, number, number, number] | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (alpha(x, y) > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : [x0 / w, y0 / h, (x1 + 1) / w, (y1 + 1) / h];
}

/** ¿El estampado se sale del área de impresión de la zona? */
export function overflows(zone: ZoneDef, f: PrintFrame, top: number) {
  const zw = zone.sizeCm[0] / 100, zh = zone.sizeCm[1] / 100, zx = zone.centerCm[0] / 100, zy = top - zone.centerCm[1] / 100;
  const tol = 0.002;
  return [[0, 0], [1, 0], [0, 1], [1, 1]].some(([s, t]) => {
    const [x, y] = framePoint(f, s, t);
    return Math.abs(x - zx) > zw / 2 + tol || Math.abs(y - zy) > zh / 2 + tol;
  });
}

export const GRID = 16;

/** Muestras (GRID+1)² sobre el arte. */
export function sampleFrame(proj: Projector, f: PrintFrame, n = GRID): (Hit | null)[] {
  const out: (Hit | null)[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) out.push(proj.sample(...framePoint(f, i / n, j / n)));
  return out;
}

/** Decide si la rejilla puede ir al atlas UV: toda sobre la prenda, una sola malla y material,
 *  UV dentro de 0..1 y sin saltos (costuras) entre muestras vecinas. */
export function classify(samples: (Hit | null)[], f: PrintFrame, n = GRID): { ok: true; mesh: number; material: number; tile: [number, number] } | { ok: false; reason: string } {
  const first = samples[0];
  if (samples.some(s => !s)) return { ok: false, reason: 'El estampado se sale de la prenda.' };
  if (!first?.uv) return { ok: false, reason: 'La malla no tiene UV.' };
  if (samples.some(s => s!.mesh !== first.mesh || s!.material !== first.material)) return { ok: false, reason: 'Cruza dos mallas o materiales.' };
  if (samples.some(s => !s!.uv)) return { ok: false, reason: 'La malla no tiene UV.' };
  // todo el estampado debe caer en la misma casilla UV (0..1 o desplazada con textura en repetición)
  const e = 1e-4, tile: [number, number] = [Math.floor(first.uv[0] + e), Math.floor(first.uv[1] + e)];
  if (samples.some(s => s!.uv![0] < tile[0] - e || s!.uv![0] > tile[0] + 1 + e || s!.uv![1] < tile[1] - e || s!.uv![1] > tile[1] + 1 + e)) return { ok: false, reason: 'El estampado cruza el borde del atlas UV.' };
  // escala UV/plano en cada arista de la rejilla; una costura aparece como un salto brusco
  const dx = f.w / n, dy = f.h / n, ratios: number[] = [];
  const at = (i: number, j: number) => samples[j * (n + 1) + i]!.uv!;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    if (i < n) ratios.push(Math.hypot(at(i + 1, j)[0] - at(i, j)[0], at(i + 1, j)[1] - at(i, j)[1]) / dx);
    if (j < n) ratios.push(Math.hypot(at(i, j + 1)[0] - at(i, j)[0], at(i, j + 1)[1] - at(i, j)[1]) / dy);
  }
  const sorted = [...ratios].sort((a, b) => a - b), med = sorted[sorted.length >> 1];
  if (!(med > 0)) return { ok: false, reason: 'UV degenerado en la zona.' };
  if (ratios.some(r => r > med * 3 || r < med / 3)) return { ok: false, reason: 'La zona cruza una costura UV.' };
  return { ok: true, mesh: first.mesh, material: first.material, tile };
}

type P2 = [number, number];
/** Transformación afín (para setTransform) que lleva el triángulo `s` sobre el triángulo `d`. */
export function triangleTransform(s: [P2, P2, P2], d: [P2, P2, P2]): [number, number, number, number, number, number] | null {
  const [[x0, y0], [x1, y1], [x2, y2]] = s, [[u0, v0], [u1, v1], [u2, v2]] = d;
  const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(det) < 1e-12) return null;
  const a = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / det;
  const c = ((u2 - u0) * (x1 - x0) - (u1 - u0) * (x2 - x0)) / det;
  const b = ((v1 - v0) * (y2 - y0) - (v2 - v0) * (y1 - y0)) / det;
  const dd = ((v2 - v0) * (x1 - x0) - (v1 - v0) * (x2 - x0)) / det;
  return [a, b, c, dd, u0 - a * x0 - c * y0, v0 - b * x0 - dd * y0];
}

/** Pinta el arte en el atlas siguiendo la rejilla de UV (dos triángulos por celda). */
export function paintWarp(g: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, uvs: P2[], W: number, H: number, flipY: boolean, n = GRID, ink: [number, number, number, number] = [0, 0, 1, 1]) {
  const iw = img.width, ih = img.height, [s0, t0, s1, t1] = ink;
  const px = (k: number): P2 => [uvs[k][0] * W, (flipY ? 1 - uvs[k][1] : uvs[k][1]) * H];
  const src = (i: number, j: number): P2 => [(s0 + (s1 - s0) * (i / n)) * iw, (t0 + (t1 - t0) * (j / n)) * ih];
  const tri = (s: [P2, P2, P2], d: [P2, P2, P2]) => {
    const m = triangleTransform(s, d);
    if (!m) return;
    // se agranda el recorte medio píxel para que no se vean juntas entre triángulos
    const cx = (d[0][0] + d[1][0] + d[2][0]) / 3, cy = (d[0][1] + d[1][1] + d[2][1]) / 3;
    g.save();
    g.beginPath();
    d.forEach(([x, y], k) => {
      const l = Math.hypot(x - cx, y - cy) || 1, e = 0.75 / l;
      const X = x + (x - cx) * e, Y = y + (y - cy) * e;
      if (k) g.lineTo(X, Y); else g.moveTo(X, Y);
    });
    g.closePath();
    g.clip();
    g.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    g.drawImage(img, 0, 0);
    g.restore();
  };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k00 = j * (n + 1) + i, k10 = k00 + 1, k01 = k00 + n + 1, k11 = k01 + 1;
    tri([src(i, j), src(i + 1, j), src(i, j + 1)], [px(k00), px(k10), px(k01)]);
    tri([src(i + 1, j), src(i + 1, j + 1), src(i, j + 1)], [px(k10), px(k11), px(k01)]);
  }
}

// ---------------- capa de estampados en la escena ----------------

const MAX_ATLAS = 4096;
/** por debajo de estos píxeles de atlas el estampado se vería pixelado: mejor calcomanía */
export const MIN_ATLAS_PX = 128;

/** Lado mayor (px) que ocupa en el atlas el estampado cuyas UV son `uvs`. */
export function atlasFootprint(uvs: P2[], W: number, H: number) {
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (const [u, v] of uvs) { if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
  return Math.max((u1 - u0) * W, (v1 - v0) * H);
}

/** capa de estampados de un material de tela: un lienzo transparente del tamaño del atlas */
interface Composite { material: FabricMaterial; tex: THREE.CanvasTexture }
/** lienzo y textura que se reutilizan entre aplicaciones (arrastrar un estampado repinta decenas de veces por segundo) */
interface Atlas { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture }

/**
 * Polilíneas sobre la superficie de la prenda que siguen un contorno del plano de la zona
 * (puntos cada `stepM`, levantados `lift` hacia quien mira). Se cortan donde no hay tela.
 */
export function surfacePolylines(proj: Projector, corners: P2[], closed = true, stepM = 0.008, lift = 0.0025): THREE.Vector3[][] {
  const out: THREE.Vector3[][] = [];
  let cur: THREE.Vector3[] = [];
  const pts = closed ? [...corners, corners[0]] : corners;
  for (let e = 0; e < pts.length - 1; e++) {
    const [ax, ay] = pts[e], [bx, by] = pts[e + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / stepM));
    for (let i = e ? 1 : 0; i <= n; i++) {
      const t = i / n, h = proj.sample(ax + (bx - ax) * t, ay + (by - ay) * t);
      if (!h) { if (cur.length > 1) out.push(cur); cur = []; continue; }
      cur.push(h.point.clone().addScaledVector(proj.basis.toward, lift));
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/** Aplica estampados a una prenda cargada y los retira sin dejar nada en la GPU. */
export class PrintLayer {
  private projectors = new Map<string, Projector>();
  private decals: THREE.Mesh[] = [];
  private composites: Composite[] = [];
  private atlases = new Map<FabricMaterial, Atlas>();
  /** borde superior de la prenda en el plano de proyección (m) */
  readonly top: number = 0;

  constructor(private scene: THREE.Object3D, private meshes: THREE.Mesh[], private renderer: THREE.WebGLRenderer) {
    const box = new THREE.Box3();
    meshes.forEach(m => box.expandByObject(m));
    this.top = box.max.y;
  }

  projector(zone: ZoneDef) {
    let p = this.projectors.get(zone.view);
    if (!p) { p = new Projector(this.meshes, basisFor(zone.view)); this.projectors.set(zone.view, p); }
    return p;
  }

  /**
   * `atlas`: lado mínimo del lienzo al pintar (los renders de alta resolución lo suben a 4096).
   * Qué estampado va al atlas y cuál a calcomanía se decide siempre con el tamaño normal, para que
   * el render coincida con lo que se ve en el visor.
   */
  apply(list: PreparedPrint[], o: { atlas?: number } = {}): PrintResult[] {
    this.clear();
    const results: PrintResult[] = [];
    const byMaterial = new Map<FabricMaterial, { p: PreparedPrint; uvs: P2[] }[]>();
    for (const p of list) {
      // solo cuenta la parte con tinta: los márgenes transparentes de la mesa no se estampan
      const f = inkFrame(printFrame(p.zone, p.print, p.sizeM, this.top), p.ink);
      const overflow = overflows(p.zone, f, this.top);
      const proj = this.projector(p.zone);
      let mode: PrintMode = 'none', reason: string | undefined;
      if (p.zone.uv) {
        // rectángulo UV fijo del garment.json: el área de la zona va entera a ese rectángulo
        const [u0, v0, u1, v1] = p.zone.uv, zw = p.zone.sizeCm[0] / 100, zh = p.zone.sizeCm[1] / 100;
        const zx = p.zone.centerCm[0] / 100, zy = this.top - p.zone.centerCm[1] / 100;
        const center = proj.sample(zx, zy);
        const mat = center && this.material(center);
        if (mat) {
          const uvs: P2[] = [];
          for (let j = 0; j <= GRID; j++) for (let i = 0; i <= GRID; i++) {
            const [x, y] = framePoint(f, i / GRID, j / GRID);
            uvs.push([u0 + ((x - zx) / zw + 0.5) * (u1 - u0), v0 + (0.5 - (y - zy) / zh) * (v1 - v0)]);
          }
          push(byMaterial, mat, { p, uvs });
          mode = 'uv';
        } else reason = 'La zona no cae sobre la prenda.';
      } else {
        const samples = sampleFrame(proj, f);
        const c = classify(samples, f);
        const mat = c.ok ? this.material(samples[0]!) : null;
        // la capa de estampados se repite en todas las casillas: una casilla desplazada equivale a 0..1
        const tileOk = c.ok;
        const uvs = c.ok ? samples.map(s => [s!.uv![0] - c.tile[0], s!.uv![1] - c.tile[1]] as P2) : [];
        const [W, H] = mat ? this.atlasSize(mat) : [0, 0];
        const sharp = c.ok && atlasFootprint(uvs, W, H) >= MIN_ATLAS_PX;
        if (c.ok && mat && tileOk && sharp) { push(byMaterial, mat, { p, uvs }); mode = 'uv'; }
        else {
          reason = !c.ok ? c.reason : !mat ? 'El material no admite atlas.' : !tileOk ? 'UV fuera del atlas (0–1).' : 'En el atlas UV se vería pixelado (zona pequeña).';
          mode = this.decal(p, f, samples) ? 'decal' : 'none';
          if (mode === 'none') reason = 'El estampado no cae sobre la prenda.';
        }
      }
      results.push({ zone: p.zone.id, mode, ...(reason ? { reason } : {}), overflow, inkCm: [f.w * 100, f.h * 100] });
    }
    for (const [mat, items] of byMaterial) this.paint(mat, items, o.atlas);
    // los atlas que ya no se usan se liberan (16 MB por lienzo de 2048 px)
    for (const [mat, a] of this.atlases) if (!byMaterial.has(mat)) { a.tex.dispose(); this.atlases.delete(mat); }
    return results;
  }

  /** Material de tela de la cara tocada (los de accesorios no reciben estampado en el atlas). */
  private material(h: Hit): FabricMaterial | null {
    const m = this.meshes[h.mesh].material;
    const mat = Array.isArray(m) ? m[h.material] : m;
    return isFabric(mat) ? mat : null;
  }

  /** Tamaño del atlas compuesto para un material: el de la tela, subido al menos a 2048 px. */
  private atlasSize(material: FabricMaterial, min = 2048): [number, number] {
    const img = material.map?.image as { width: number; height: number } | undefined;
    const limit = Math.min(MAX_ATLAS, this.renderer.capabilities.maxTextureSize);
    const side = Math.min(limit, Math.max(min, img ? Math.max(img.width, img.height) : 0));
    if (!img) return [side, side];
    const k = side / Math.max(img.width, img.height);
    return [Math.round(img.width * k), Math.round(img.height * k)];
  }

  private paint(material: FabricMaterial, items: { p: PreparedPrint; uvs: P2[] }[], min?: number) {
    const [W, H] = this.atlasSize(material, min);
    let a = this.atlases.get(material);
    if (!a || a.canvas.width !== W || a.canvas.height !== H) {
      a?.tex.dispose();
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const tex = new THREE.CanvasTexture(canvas);
      tex.flipY = false;
      tex.premultiplyAlpha = true; // bordes limpios al filtrar un lienzo transparente
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      a = { canvas, tex };
      this.atlases.set(material, a);
    }
    const g = a.canvas.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    g.imageSmoothingQuality = 'high'; // el arte suele reducirse mucho al entrar en el atlas
    // la capa se muestrea con la UV tal cual (flipY desactivado: v = 0 es la fila superior)
    for (const { p, uvs } of items) paintWarp(g, p.image as any, uvs, W, H, false, GRID, p.ink);
    // misma textura y mismo tamaño: la GPU la actualiza sin volver a reservar memoria
    const tex = a.tex;
    tex.needsUpdate = true;
    const u = material.userData.kovaFabric;
    u.kPrintMap.value = tex;
    u.kPrintOn.value = 1;
    this.composites.push({ material, tex });
  }

  private decal(p: PreparedPrint, f: PrintFrame, samples: (Hit | null)[]) {
    const proj = this.projector(p.zone);
    const center = proj.sample(f.cx, f.cy) ?? samples.find(s => s) ?? null;
    if (!center) return false;
    const { right, up, toward } = basisFor(p.zone.view);
    const c = Math.cos(f.angle), s = Math.sin(f.angle);
    const r = right.clone().multiplyScalar(c).addScaledVector(up, s);
    const u = up.clone().multiplyScalar(c).addScaledVector(right, -s);
    const orient = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, u, toward));
    const tex = new THREE.CanvasTexture(p.image as any);
    tex.colorSpace = THREE.SRGBColorSpace;
    if (p.ink) {
      // la calcomanía cubre solo la caja con tinta: la textura se recorta igual (flipY: v hacia arriba)
      const [s0, t0, s1, t1] = p.ink;
      tex.repeat.set(s1 - s0, t1 - t0);
      tex.offset.set(s0, 1 - t1);
    }
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.75, metalness: 0 });
    // profundidad proporcional al estampado: abarca la curvatura de la tela sin alcanzar
    // lo que hay detrás (la espalda, o el costado bajo una manga)
    const size = new THREE.Vector3(f.w, f.h, THREE.MathUtils.clamp(0.3 * Math.min(f.w, f.h), 0.03, 0.1));
    const pos = center.point.clone();
    let any = false;
    for (const mesh of proj.meshes) {
      const geo = new DecalGeometry(mesh, pos, orient, size);
      if (!geo.attributes.position?.count) { geo.dispose(); continue; }
      const d = new THREE.Mesh(geo, any ? mat.clone() : mat);
      d.renderOrder = 1;
      d.name = `estampado:${p.zone.id}`;
      this.scene.add(d);
      this.decals.push(d);
      any = true;
    }
    if (!any) { tex.dispose(); mat.dispose(); }
    return any;
  }

  /** Quita todo lo aplicado y devuelve los materiales a su estado original. */
  clear() {
    for (const d of this.decals) {
      this.scene.remove(d);
      d.geometry.dispose();
      const m = d.material as THREE.MeshStandardMaterial;
      m.map?.dispose(); m.dispose();
    }
    this.decals = [];
    for (const c of this.composites) {
      const u = c.material.userData.kovaFabric;
      // de vuelta a la textura vacía (el lienzo se conserva para la próxima aplicación)
      if (u.kPrintMap.value === c.tex) { u.kPrintMap.value = blankTexture(); u.kPrintOn.value = 0; }
    }
    this.composites = [];
  }

  dispose() {
    this.clear();
    for (const a of this.atlases.values()) a.tex.dispose();
    this.atlases.clear();
    this.projectors.clear();
  }
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); }
