import type { Artboard, Doc, DocState, Layer, TextProps, ShapeProps } from './types';
import { uid, createCanvas, layerSize } from './util';

export function newArtboard(w: number, h: number, dpi: number, name = 'Mesa 1', x = 0, y = 0, background: string | null = null): Artboard {
  return { id: uid('ab'), name, x, y, w: Math.round(w), h: Math.round(h), dpi, background, margin: Math.round(dpi * 0.2) };
}

export function baseLayer(kind: Layer['kind'], name: string): Layer {
  return {
    id: uid('ly'), name, kind, visible: true, locked: false, opacity: 1, blend: 'source-over',
    x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, parentId: null, clip: false,
    adjustments: [], mask: null, maskEnabled: true,
  };
}

export function rasterLayer(canvas: HTMLCanvasElement, name = 'Capa', x = 0, y = 0): Layer {
  return { ...baseLayer('raster', name), canvas, origin: canvas, x, y };
}

export function emptyRaster(w: number, h: number, name: string, x = 0, y = 0) {
  return rasterLayer(createCanvas(w, h), name, x, y);
}

export const defaultText = (color = '#ffffff', size = 120): TextProps => ({
  text: 'KOVA', fontFamily: 'Inter, sans-serif', fontSize: size, fontWeight: 700, italic: false, color,
  align: 'left', lineHeight: 1.15, letterSpacing: 0, strokeColor: '#000000', strokeWidth: 0,
});

export function textLayer(t: TextProps, x: number, y: number): Layer {
  return { ...baseLayer('text', t.text.slice(0, 24) || 'Texto'), text: t, x, y };
}

export function shapeLayer(s: ShapeProps, x: number, y: number): Layer {
  return { ...baseLayer('shape', s.shape === 'ellipse' ? 'Elipse' : s.shape === 'line' ? 'Línea' : 'Rectángulo'), shape: s, x, y };
}

export function vectorLayer(svg: string, w: number, h: number, name = 'Vector', x = 0, y = 0): Layer {
  return { ...baseLayer('vector', name), vector: { svg, w, h }, x, y };
}

export function groupLayer(name = 'Grupo'): Layer {
  return { ...baseLayer('group', name) };
}

export function newDoc(name: string, w: number, h: number, dpi: number, background: string | null = null): Doc {
  const ab = newArtboard(w, h, dpi, 'Mesa 1', 0, 0, background);
  const state: DocState = { layers: [], artboards: [ab], guides: [], selection: null, selectedLayerIds: [], activeArtboardId: ab.id };
  return { id: uid('doc'), name, colorMode: 'RGB', state, past: [], future: [], lastLabel: 'Nuevo documento', dirty: false, createdAt: Date.now() };
}

/** Centra una capa en una mesa de trabajo. */
export function centerIn(l: Layer, ab: Artboard): Layer {
  const { w, h } = layerSize(l);
  return { ...l, x: ab.x + (ab.w - w * Math.abs(l.scaleX)) / 2, y: ab.y + (ab.h - h * Math.abs(l.scaleY)) / 2 };
}

/** Escala una capa para que quepa en la mesa (solo si es más grande). */
export function fitIn(l: Layer, ab: Artboard, margin = 0): Layer {
  const { w, h } = layerSize(l);
  const s = Math.min(1, (ab.w - margin * 2) / w, (ab.h - margin * 2) / h);
  return centerIn({ ...l, scaleX: s, scaleY: s }, ab);
}

// Árbol de capas
export function childrenOf(layers: Layer[], parentId: string | null) {
  return layers.filter(l => l.parentId === parentId);
}
export function descendants(layers: Layer[], id: string): Layer[] {
  const out: Layer[] = [];
  const walk = (pid: string) => { for (const l of layers) if (l.parentId === pid) { out.push(l); if (l.kind === 'group') walk(l.id); } };
  walk(id);
  return out;
}
export function isEffectivelyVisible(layers: Layer[], l: Layer): boolean {
  let cur: Layer | undefined = l;
  while (cur) {
    if (!cur.visible) return false;
    cur = cur.parentId ? layers.find(x => x.id === cur!.parentId) : undefined;
  }
  return true;
}
export function isEffectivelyLocked(layers: Layer[], l: Layer): boolean {
  let cur: Layer | undefined = l;
  while (cur) {
    if (cur.locked) return true;
    cur = cur.parentId ? layers.find(x => x.id === cur!.parentId) : undefined;
  }
  return false;
}
