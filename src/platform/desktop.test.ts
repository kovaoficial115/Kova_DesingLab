import { describe, it, expect } from 'vitest';
import { acceptToExtensions, mimeOf } from './desktop';

describe('adaptador de escritorio', () => {
  it('traduce el filtro accept del navegador a extensiones del diálogo de macOS', () => {
    expect(acceptToExtensions('.glb,.json,model/gltf-binary,application/json')).toEqual(['glb', 'json']);
    expect(acceptToExtensions('.kova,image/*')).toEqual(expect.arrayContaining(['kova', 'png', 'jpg', 'svg', 'tif']));
    expect(acceptToExtensions('')).toEqual([]);
    expect(acceptToExtensions('.ICC, .icm')).toEqual(['icc', 'icm']);
  });
  it('deduce el tipo MIME por la extensión (readFile no lo trae)', () => {
    expect(mimeOf('logo.SVG')).toBe('image/svg+xml');
    expect(mimeOf('proyecto.kova')).toBe('application/json');
    expect(mimeOf('sin-extension')).toBe('');
  });
});
