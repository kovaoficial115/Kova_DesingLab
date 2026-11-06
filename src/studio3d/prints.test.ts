import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Projector } from './projector';
import { basisFor, zoneDefs, type ZoneDef } from './zones';
import { printFrame, framePoint, overflows, sampleFrame, classify, triangleTransform, inkBox, inkFrame, atlasFootprint, MIN_ATLAS_PX } from './prints';
import { singleTile } from './uvOverlap';
import { defaultConfig } from './config';

const plane = (w: number, h: number, z = 0) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial());
  m.position.z = z;
  m.updateMatrixWorld(true);
  return m;
};

describe('Projector', () => {
  it('devuelve la UV del punto proyectado y null fuera de la malla', () => {
    const p = new Projector([plane(1, 1)], basisFor('front'));
    const c = p.sample(0, 0)!;
    expect(c.uv![0]).toBeCloseTo(0.5); expect(c.uv![1]).toBeCloseTo(0.5);
    const q = p.sample(0.25, 0.25)!;
    expect(q.uv![0]).toBeCloseTo(0.75); expect(q.uv![1]).toBeCloseTo(0.75);
    expect(p.sample(2, 2)).toBeNull();
  });
  it('elige la superficie más cercana a quien mira', () => {
    const front = new Projector([plane(1, 1, -0.1), plane(1, 1, 0.1)], basisFor('front'));
    expect(front.sample(0, 0)!.mesh).toBe(1);
    const back = new Projector([plane(1, 1, -0.1), plane(1, 1, 0.1)], basisFor('back'));
    expect(back.sample(0, 0)!.mesh).toBe(0);
  });
});

describe('estampados', () => {
  const zone: ZoneDef = { id: 'front', view: 'front', centerCm: [0, 30], sizeCm: [30, 40] };
  it('coloca el arte a tamaño real dentro de su zona', () => {
    const f = printFrame(zone, { artboardId: 'a', x: 0.5, y: 0.5, scale: 1, rotation: 0 }, [0.2, 0.1], 0.5);
    expect(f.cx).toBeCloseTo(0); expect(f.cy).toBeCloseTo(0.2); expect(f.w).toBeCloseTo(0.2); expect(f.h).toBeCloseTo(0.1);
    expect(framePoint(f, 0, 0)[0]).toBeCloseTo(-0.1); expect(framePoint(f, 0, 0)[1]).toBeCloseTo(0.25);
    expect(overflows(zone, f, 0.5)).toBe(false);
    const big = printFrame(zone, { artboardId: 'a', x: 0.5, y: 0.5, scale: 2, rotation: 0 }, [0.2, 0.1], 0.5);
    expect(overflows(zone, big, 0.5)).toBe(true);
  });
  it('gira en sentido horario como el editor 2D', () => {
    const f = printFrame(zone, { artboardId: 'a', x: 0.5, y: 0.5, scale: 1, rotation: 90 }, [0.2, 0.1], 0.5);
    // la esquina superior izquierda pasa a la superior derecha
    const [x, y] = framePoint(f, 0, 0);
    expect(x).toBeCloseTo(0.05); expect(y).toBeCloseTo(0.3);
  });
  it('va al atlas UV si la zona cae en una sola isla', () => {
    const proj = new Projector([plane(1, 1)], basisFor('front'));
    const f = printFrame(zone, { artboardId: 'a', x: 0.5, y: 0.5, scale: 1, rotation: 0 }, [0.2, 0.2], 0.5);
    const c = classify(sampleFrame(proj, f), f);
    expect(c.ok).toBe(true);
  });
  it('detecta una costura UV y pide calcomanía', () => {
    // dos medias placas contiguas cuya UV salta de una isla a otra
    const left = plane(0.5, 1); left.position.x = -0.25; left.updateMatrixWorld(true);
    const right = plane(0.5, 1); right.position.x = 0.25; right.updateMatrixWorld(true);
    right.geometry.translate(0, 0, 0);
    const uv = right.geometry.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, 0.6 + uv.getX(i) * 0.3);
    const geo = left.geometry.clone();
    const luv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < luv.count; i++) luv.setX(i, luv.getX(i) * 0.3);
    left.geometry = geo;
    // misma malla para que no lo detecte como cambio de malla
    const merged = new THREE.Mesh(mergeTwo(left, right), new THREE.MeshStandardMaterial());
    merged.updateMatrixWorld(true);
    const proj = new Projector([merged], basisFor('front'));
    const f = printFrame(zone, { artboardId: 'a', x: 0.5, y: 0.5, scale: 1, rotation: 0 }, [0.3, 0.2], 0.5);
    const c = classify(sampleFrame(proj, f), f);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toMatch(/costura/);
  });
  it('si se sale de la prenda no usa el atlas', () => {
    const proj = new Projector([plane(0.1, 0.1)], basisFor('front'));
    const f = printFrame(zone, { artboardId: 'a', x: 0.5, y: 0.5, scale: 1, rotation: 0 }, [0.3, 0.3], 0.2);
    const c = classify(sampleFrame(proj, f), f);
    expect(c.ok).toBe(false);
  });
  it('triangleTransform lleva cada vértice a su destino', () => {
    const m = triangleTransform([[0, 0], [10, 0], [0, 10]], [[5, 5], [5, 25], [-15, 5]])!;
    const ap = (x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    expect(ap(0, 0)).toEqual([5, 5]);
    expect(ap(10, 0)[0]).toBeCloseTo(5); expect(ap(10, 0)[1]).toBeCloseTo(25);
    expect(ap(0, 10)[0]).toBeCloseTo(-15); expect(ap(0, 10)[1]).toBeCloseTo(5);
  });
  it('acepta UV desplazadas a otra casilla (textura en repetición) e indica cuál', () => {
    const m = plane(1, 1);
    const uv = m.geometry.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.9 + 2.05);
    const proj = new Projector([m], basisFor('front'));
    const f = printFrame(zone, { artboardId: 'a', x: 0.5, y: 0.5, scale: 1, rotation: 0 }, [0.2, 0.2], 0.5);
    const c = classify(sampleFrame(proj, f), f);
    expect(c.ok && c.tile).toEqual([2, 0]);
    expect(singleTile(Array.from(uv.array as Float32Array))).toEqual([2, 0]);
    expect(singleTile([0.2, 0.2, 1.4, 0.5])).toBeNull();
  });
  it('solo analiza y estampa la parte con tinta del arte', () => {
    const px = new Uint8Array(10 * 10); px[3 * 10 + 4] = 255; px[6 * 10 + 7] = 255;
    expect(inkBox((x, y) => px[y * 10 + x], 10, 10)).toEqual([0.4, 0.3, 0.8, 0.7]);
    expect(inkBox(() => 0, 4, 4)).toBeNull();
    const f = printFrame(zone, { artboardId: 'a', x: 0.5, y: 0.5, scale: 1, rotation: 0 }, [0.2, 0.2], 0.5);
    const g = inkFrame(f, [0.5, 0, 1, 0.5]);
    expect(g.w).toBeCloseTo(0.1); expect(g.h).toBeCloseTo(0.1);
    expect(g.cx).toBeCloseTo(0.05); expect(g.cy).toBeCloseTo(0.25);
  });
  it('mide cuántos píxeles de atlas ocupa un estampado para no pixelarlo', () => {
    // 4 cm de manga en un atlas de 2048 a ~15 px/cm: no llega al mínimo → calcomanía
    expect(atlasFootprint([[0.5, 0.5], [0.53, 0.5], [0.5, 0.52]], 2048, 2048)).toBeCloseTo(61.4, 0);
    expect(atlasFootprint([[0.5, 0.5], [0.53, 0.5]], 2048, 2048)).toBeLessThan(MIN_ATLAS_PX);
    // 12 cm de pecho: ~185 px → atlas
    expect(atlasFootprint([[0.2, 0.2], [0.29, 0.29]], 2048, 2048)).toBeGreaterThan(MIN_ATLAS_PX);
  });
  it('las zonas de un garment.json sustituyen a las de su categoría', () => {
    const cfg = defaultConfig('hoodie.glb');
    cfg.zones.front = { sizeCm: [20, 20], centerCm: [0, 40] };
    const z = zoneDefs(cfg).find(d => d.id === 'front')!;
    expect(z.sizeCm).toEqual([20, 20]); expect(z.centerCm).toEqual([0, 40]); expect(z.view).toBe('front');
  });
});

function mergeTwo(a: THREE.Mesh, b: THREE.Mesh) {
  const ga = a.geometry.clone().applyMatrix4(a.matrixWorld), gb = b.geometry.clone().applyMatrix4(b.matrixWorld);
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (const g of [ga, gb]) {
    const base = pos.length / 3, p = g.attributes.position, u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); uv.push(u.getX(i), u.getY(i)); }
    for (let i = 0; i < g.index!.count; i++) idx.push(base + g.index!.getX(i));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
