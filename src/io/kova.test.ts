import { describe, it, expect } from 'vitest';
import { parseKova, buildKova, downgradeToV1, validateKova, KOVA_SCHEMA, KovaFormatError } from './kova';
import { sanitizeGarment3D } from '../core/garment3d';

// .kova tal como lo escribe la versión publicada (formato 1)
const v1 = () => ({
  format: 'kova-designlab', version: 1, id: 'doc_1', name: 'Camiseta', colorMode: 'RGB', createdAt: 1700000000000,
  state: {
    layers: [{ id: 'l1', name: 'Logo', kind: 'raster', canvas: 'a1', mask: 'a2' }],
    artboards: [{ id: 'ab1', name: 'Pecho', x: 0, y: 0, w: 100, h: 100, dpi: 300, background: null, margin: 0 }],
    guides: [], selectedLayerIds: [], activeArtboardId: 'ab1',
  },
  assets: { a1: 'data:image/png;base64,AAAA', a2: 'data:image/png;base64,BBBB' },
  fonts: [],
});
const garment = { schema: 1, model: { source: 'catalog', id: 'oversize-tee' }, color: '#00001f', material: { preset: 'cotton', roughness: 0.8, normalScale: 1 }, zones: { front: { artboardId: 'ab1', x: 0.5, y: 0.4, scale: 1, rotation: 0 } } };
const HASH = 'a'.repeat(64);

describe('formato .kova', () => {
  it('abre un v1 sin cambios en su contenido y lo lleva a la versión actual', () => {
    const p = parseKova(JSON.stringify(v1()));
    expect(p.sourceVersion).toBe(1);
    expect(p.file.version).toBe(KOVA_SCHEMA);
    expect(p.newer).toBe(false);
    expect(p.warnings).toEqual([]);
    expect(p.extra).toEqual({});
    expect(p.file.state).toEqual(v1().state);
    expect(p.file.assets).toEqual(v1().assets);
    expect(p.file.garment3d).toBeUndefined();
  });

  it('un v1 sin campo version se trata como v1', () => {
    const { version: _v, ...noVersion } = v1();
    expect(parseKova(noVersion).sourceVersion).toBe(1);
  });

  it('rechaza archivos que no son proyectos o están dañados', () => {
    expect(() => parseKova('{no es json')).toThrow(KovaFormatError);
    expect(() => parseKova({ format: 'otro' })).toThrow('no reconocido');
    expect(validateKova({ ...v1(), state: { ...v1().state, artboards: [] } })).toContain('El documento no tiene mesas de trabajo.');
    const sinImagen = v1(); delete (sinImagen.assets as any).a2;
    expect(() => parseKova(sinImagen)).toThrow(/Faltan imágenes de 1 capa/);
  });

  it('lee y valida la sección garment3d y los modelos embebidos', () => {
    const p = parseKova({ ...v1(), version: 2, garment3d: garment, models3d: { [HASH]: { name: 'mio.glb', mime: 'model/gltf-binary', data: 'data:model/gltf-binary;base64,Z2xURg==' } } });
    expect(p.file.garment3d?.model).toEqual({ source: 'catalog', id: 'oversize-tee' });
    expect(p.file.garment3d?.zones.front?.artboardId).toBe('ab1');
    expect(Object.keys(p.file.models3d!)).toEqual([HASH]);
  });

  it('una sección 3D inválida no impide abrir y se conserva para no perderla', () => {
    const p = parseKova({ ...v1(), version: 2, garment3d: { model: 'roto' } });
    expect(p.file.garment3d).toBeUndefined();
    expect(p.warnings[0]).toMatch(/3D/);
    expect(p.extra.garment3d).toEqual({ model: 'roto' });
  });

  it('un archivo de una versión futura se abre, avisa y conserva lo desconocido al guardar', () => {
    const p = parseKova({ ...v1(), version: 7, futuro: { x: 1 } });
    expect(p.newer).toBe(true);
    expect(p.warnings[0]).toMatch(/más nueva/);
    expect(p.extra).toEqual({ futuro: { x: 1 } });
    const out = buildKova(p.file, p.extra, Math.max(KOVA_SCHEMA, p.sourceVersion));
    expect(out.version).toBe(7);
    expect(out.futuro).toEqual({ x: 1 });
  });

  it('las secciones desconocidas no pueden pisar las conocidas', () => {
    const out = buildKova(parseKova(v1()).file, { name: 'pirata', format: 'x' });
    expect(out.name).toBe('Camiseta');
    expect(out.format).toBe('kova-designlab');
  });

  it('v1 → v2 → v1 es reversible sin pérdidas', () => {
    const v2 = buildKova({ ...parseKova(v1()).file, garment3d: sanitizeGarment3D(garment)! });
    expect(v2.version).toBe(2);
    expect(v2.app?.name).toBe('KOVA Design Lab');
    const back = downgradeToV1(JSON.parse(JSON.stringify(v2)));
    expect(back).toEqual(v1());
  });
});

describe('garment3d', () => {
  it('normaliza valores fuera de rango y descarta modelos sin referencia válida', () => {
    const g = sanitizeGarment3D({ ...garment, color: 'rojo', zones: { front: { artboardId: 'ab1', x: 3, y: -1, scale: -2, rotation: 'x' }, pierna: {} } })!;
    expect(g.color).toBe('#ffffff'); // sin color válido: el propio del modelo, sin teñir
    expect(g.zones.front).toEqual({ artboardId: 'ab1', x: 1, y: 0, scale: 1, rotation: 0 });
    expect(Object.keys(g.zones)).toEqual(['front']);
    expect(sanitizeGarment3D({ ...garment, model: { source: 'asset', hash: 'corto' } })).toBeNull();
    expect(sanitizeGarment3D(null)).toBeNull();
  });
});
