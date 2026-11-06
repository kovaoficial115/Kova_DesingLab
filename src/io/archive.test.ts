import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { buildArchive, readArchive } from './archive';

describe('copia de todos los proyectos (.zip)', () => {
  it('ida y vuelta conserva id, nombre, fecha y contenido', () => {
    const entries = [
      { id: 'a', name: 'Camiseta / Pecho', updated: 1, data: '{"x":1}' },
      { id: 'b', name: 'Camiseta / Pecho', updated: 2, data: '{"x":2}' }, // mismo nombre de archivo
      { id: 'c', name: 'Hoodie ñ', updated: 3, data: '{"x":"ñ"}' },
    ];
    const { entries: out, manifest } = readArchive(buildArchive(entries, 99));
    expect(manifest?.created).toBe(99);
    expect(out.sort((x, y) => x.id.localeCompare(y.id))).toEqual(entries);
    expect(new Set(manifest!.projects.map(p => p.file)).size).toBe(3);
  });

  it('acepta un zip con .kova sueltos y sin manifest', () => {
    const zip = zipSync({ 'mis/diseño.kova': strToU8('{}'), '__MACOSX/mis/._diseño.kova': strToU8('x'), 'nota.txt': strToU8('x') });
    expect(readArchive(zip).entries).toEqual([{ id: '', name: 'diseño', updated: 0, data: '{}' }]);
  });

  it('un archivo que no es zip da un error claro', () => {
    expect(() => readArchive(strToU8('hola'))).toThrow('no es un .zip válido');
  });
});
