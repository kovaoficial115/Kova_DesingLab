import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { fabricHeight, cmPerUv, defaultFabric, FABRICS, makeFabricMaterial, applyFabric, isFabric } from './fabric';
import { defaultConfig, parseConfig, fabricOf } from './config';
import { zoneDefs } from './zones';

describe('tela', () => {
  it('los tejidos se repiten sin costura (los bordes casan)', () => {
    for (const p of ['jersey', 'fleece', 'mesh'] as const) {
      const h = fabricHeight(p), n = Math.sqrt(h.length);
      let edge = 0;
      for (let i = 0; i < n; i++) edge = Math.max(edge, Math.abs(h[i] - h[(n - 1) * n + i]), Math.abs(h[i * n] - h[i * n + n - 1]));
      // la diferencia entre bordes opuestos es la de dos píxeles vecinos, no un salto
      expect(edge).toBeLessThan(0.35);
      expect(Math.max(...h)).toBeGreaterThan(Math.min(...h));
    }
  });
  it('mide los cm de tela por unidad UV', () => {
    // plano de 50 cm con UV 0..1 → 50 cm por unidad UV
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5));
    m.updateMatrixWorld(true);
    expect(cmPerUv([m])).toBeCloseTo(50, 1);
  });
  it('convierte el material conservando sus texturas y aplica la tela', () => {
    const map = new THREE.Texture();
    const src = new THREE.MeshStandardMaterial({ map, roughness: 0.3 });
    const f = makeFabricMaterial(src);
    expect(isFabric(f)).toBe(true);
    expect(f.map).toBe(map);
    applyFabric(f, { ...defaultFabric('fleece'), color: '#1d1d20', finish: 'heather' }, 60);
    expect(f.roughness).toBeCloseTo(FABRICS.fleece.roughness);
    expect(f.sheen).toBeCloseTo(FABRICS.fleece.sheen);
    expect(f.color.getHexString()).toBe('1d1d20');
    expect(f.userData.kovaFabric.kHeather.value).toBe(1);
    // 60 cm por unidad UV / 3 cm por repetición de felpa = 20 repeticiones
    expect(f.userData.kovaFabric.kDetailRepeat.value.x).toBeCloseTo(20);
    // sin la textura de color del modelo (cuadrícula de prueba)
    expect(makeFabricMaterial(new THREE.MeshStandardMaterial({ map: new THREE.Texture() }), false).map).toBeNull();
  });
});

describe('prendas por configuración', () => {
  it('cada categoría trae su tela y sus zonas sin tocar el código', () => {
    expect(fabricOf(defaultConfig('hoodie.glb'))).toBe('fleece');
    expect(fabricOf(defaultConfig('camiseta deportiva sport.glb'))).toBe('polyester');
    expect(defaultConfig('crop top.glb').category).toBe('crop');
    expect(defaultConfig('long sleeve tee.glb').category).toBe('longsleeve');
    const sleeve = zoneDefs(defaultConfig('long sleeve tee.glb')).find(z => z.id === 'sleeveLeft')!;
    expect(sleeve.sizeCm[1]).toBeGreaterThan(30);
    const { config, errors } = parseConfig({ name: 'Regular', category: 'tshirt', fabric: 'polyester', useBaseColorMap: false }, 'x.glb');
    expect(errors).toEqual([]);
    expect(config.fabric).toBe('polyester');
    expect(config.useBaseColorMap).toBe(false);
    expect(parseConfig({ fabric: 'seda' }, 'x.glb').errors.length).toBe(1);
  });
});
