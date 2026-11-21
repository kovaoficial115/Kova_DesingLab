import { describe, it, expect, vi, beforeEach } from 'vitest';

// ag-psd simulado: se comprueba qué se le pide leer y cómo responde el importador si falta memoria
const calls: any[] = [];
let behaviour: (opts: any) => any = () => ({});
vi.mock('ag-psd', () => ({ readPsd: (_buf: ArrayBuffer, opts: any) => { calls.push(opts); return behaviour(opts); } }));

const fakeCanvas = (w: number, h: number) => ({ width: w, height: h }) as unknown as HTMLCanvasElement;
const { importPsd } = await import('./importers');
const buf = new ArrayBuffer(8);

beforeEach(() => { calls.length = 0; });

describe('importar PSD', () => {
  it('por capas: no lee la imagen combinada, ni miniatura, ni archivos incrustados, y no copia los lienzos', async () => {
    const c = fakeCanvas(100, 50);
    behaviour = () => ({ width: 2000, height: 1000, children: [{ name: 'Logo', canvas: c, left: 10, top: 20, opacity: 0.5, blendMode: 'multiply' }] });
    const r: any = await importPsd(buf, 'a');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ skipCompositeImageData: true, skipThumbnail: true, skipLinkedFilesData: true });
    expect(r.layers).toHaveLength(1);
    expect(r.layers[0].canvas).toBe(c);
    expect(r.layers[0]).toMatchObject({ x: 10, y: 20, opacity: 0.5, blend: 'multiply', name: 'Logo' });
    expect(r.note).toBeUndefined();
  });
  it('PSD acoplado (sin capas): lee solo la imagen combinada', async () => {
    const comp = fakeCanvas(300, 200);
    behaviour = o => (o.skipLayerImageData ? { width: 300, height: 200, canvas: comp } : { width: 300, height: 200 });
    const r: any = await importPsd(buf, 'b');
    expect(calls).toHaveLength(2);
    expect(r.layers).toHaveLength(1);
    expect(r.layers[0].canvas).toBe(comp);
    expect(r.note).toBeUndefined();
  });
  it('sin memoria para las capas: se abre acoplado y avisa', async () => {
    const comp = fakeCanvas(8000, 6000);
    behaviour = o => { if (!o.skipLayerImageData) throw new RangeError('Cannot allocate a buffer of this size'); return { width: 8000, height: 6000, canvas: comp }; };
    const r: any = await importPsd(buf, 'grande.psd');
    expect(r.layers).toHaveLength(1);
    expect(r.layers[0].canvas).toBe(comp);
    expect(r.note).toMatch(/acoplado/);
  });
  it('sin memoria ni para la imagen combinada: error claro en español', async () => {
    behaviour = () => { throw new RangeError('Cannot allocate a buffer of this size'); };
    await expect(importPsd(buf, 'enorme.psd')).rejects.toThrow(/demasiado grande/);
  });
  it('otros errores no se disfrazan de falta de memoria', async () => {
    behaviour = () => { throw new Error('Invalid signature'); };
    await expect(importPsd(buf, 'x.psd')).rejects.toThrow('Invalid signature');
  });
});
