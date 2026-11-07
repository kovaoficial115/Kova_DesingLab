import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { resolveRenderSize, smallerSize, tileGrid, blitTile, fitDistance, boxCorners, videoFormat, tileSide } from './render';

const M2 = { maxTextureSize: 16384, maxRenderbufferSize: 16384 };

describe('resolución de exportación', () => {
  it('respeta lo pedido si el equipo llega', () => {
    expect(resolveRenderSize(4096, M2)).toEqual({ side: 4096 });
    expect(resolveRenderSize(1080, { maxTextureSize: 4096, maxRenderbufferSize: 4096 })).toEqual({ side: 1080 });
  });
  it('baja al tamaño estándar que cabe y explica por qué', () => {
    const r = resolveRenderSize(4096, { maxTextureSize: 3000, maxRenderbufferSize: 3000 });
    expect(r.side).toBe(2048);
    expect(r.reason).toMatch(/2048 px.*4096 px.*3000/);
    const low = resolveRenderSize(4096, { ...M2, deviceMemoryGb: 2 });
    expect(low.side).toBe(2048);
    expect(low.reason).toMatch(/memoria/);
    // ni siquiera 1080: se usa el propio límite
    expect(resolveRenderSize(1080, { maxTextureSize: 1024, maxRenderbufferSize: 1024 }).side).toBe(1024);
  });
  it('nunca pasa de 4096 y reintenta hacia abajo', () => {
    expect(resolveRenderSize(8192, M2).side).toBe(4096);
    expect(smallerSize(4096)).toBe(2048);
    expect(smallerSize(2048)).toBe(1080);
    expect(smallerSize(1080)).toBeNull();
  });
});

describe('mosaicos', () => {
  it('cubre la imagen sin huecos ni solapes', () => {
    for (const [W, H, max] of [[4096, 4096, 2048], [1080, 1080, 2048], [3000, 1000, 1024]] as const) {
      const tiles = tileGrid(W, H, max);
      expect(tiles.every(t => t.w <= max && t.h <= max)).toBe(true);
      expect(tiles.reduce((a, t) => a + t.w * t.h, 0)).toBe(W * H);
    }
    expect(tileGrid(4096, 4096, 2048)).toHaveLength(4);
    expect(tileSide({ maxTextureSize: 16384, maxRenderbufferSize: 1024 })).toBe(1024);
  });
  it('voltea las filas de la GPU y las coloca en su sitio', () => {
    const W = 4, dst = new Uint8ClampedArray(W * 4 * 4);
    // mosaico 2×2 en (2, 1); la GPU entrega primero la fila de abajo
    const src = new Uint8Array([1, 1, 1, 1, 2, 2, 2, 2, /* arriba */ 3, 3, 3, 3, 4, 4, 4, 4]);
    blitTile(src, { x: 2, y: 1, w: 2, h: 2 }, dst, W);
    const at = (x: number, y: number) => dst[(y * W + x) * 4];
    expect([at(2, 1), at(3, 1), at(2, 2), at(3, 2)]).toEqual([3, 4, 1, 2]);
    expect(at(0, 0)).toBe(0);
  });
});

describe('encuadre', () => {
  it('aleja la cámara lo justo para que la prenda quepa con margen', () => {
    const box = new THREE.Box3(new THREE.Vector3(-0.3, -0.4, -0.1), new THREE.Vector3(0.3, 0.4, 0.1));
    const pts = boxCorners(box, new THREE.Vector3());
    const d = fitDistance(pts, new THREE.Vector3(0, 0, 1), 30, 1, 0.1);
    // la altura (0.4) manda: la esquina delantera a 0.1 de profundidad
    const tan = Math.tan(THREE.MathUtils.degToRad(15)) * 0.9;
    expect(d).toBeCloseTo(0.1 + 0.4 / tan, 5);
    // cada esquina queda dentro del encuadre
    const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    cam.position.set(0, 0, d); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    for (const p of pts) { const s = p.clone().project(cam); expect(Math.abs(s.x)).toBeLessThanOrEqual(0.9 + 1e-6); expect(Math.abs(s.y)).toBeLessThanOrEqual(0.9 + 1e-6); }
    // de perfil con imagen apaisada el ancho (0.2) ya no manda: más cerca
    expect(fitDistance(pts, new THREE.Vector3(1, 0, 0), 30, 1, 0.1)).toBeLessThan(d + 0.3);
  });
});

describe('video', () => {
  it('prefiere MP4 y cae a WebM', () => {
    expect(videoFormat(t => t.startsWith('video/mp4'))).toEqual({ mime: 'video/mp4;codecs=avc1', ext: 'mp4' });
    expect(videoFormat(t => t === 'video/webm;codecs=vp9')).toEqual({ mime: 'video/webm;codecs=vp9', ext: 'webm' });
    expect(videoFormat(() => false)).toBeNull();
  });
});
