// Portapapeles de objetos: copia capas editables (texto, formas, vectores, imágenes, grupos,
// máscaras, efectos) sin rasterizarlas. Funciones puras: el clonado de lienzos se inyecta.

import type { Layer } from './types';

export interface LayerClip {
  /** capas copiadas en orden del documento (abajo → arriba); las raíces llevan parentId null */
  layers: Layer[];
  /** ids de las raíces (capas o grupos seleccionados que no están dentro de otro seleccionado) */
  roots: string[];
}

const childrenMap = (layers: Layer[]) => {
  const m = new Map<string, Layer[]>();
  for (const l of layers) if (l.parentId) { const a = m.get(l.parentId); if (a) a.push(l); else m.set(l.parentId, [l]); }
  return m;
};

/**
 * Reúne la selección para el portapapeles: cada capa seleccionada con todo su contenido (si es un
 * grupo), sin duplicar las que ya van dentro de un grupo seleccionado. Respeta el orden de capas.
 */
export function collectClip(layers: Layer[], selectedIds: string[], cloneCanvas: (c: HTMLCanvasElement) => HTMLCanvasElement = c => c): LayerClip | null {
  const sel = new Set(selectedIds.filter(id => layers.some(l => l.id === id)));
  if (!sel.size) return null;
  const byId = new Map(layers.map(l => [l.id, l]));
  const inSelectedAncestor = (l: Layer) => {
    for (let p = l.parentId ? byId.get(l.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) if (sel.has(p.id)) return true;
    return false;
  };
  const roots = layers.filter(l => sel.has(l.id) && !inSelectedAncestor(l)).map(l => l.id);
  const kids = childrenMap(layers);
  const take = new Set<string>();
  const walk = (id: string) => { take.add(id); for (const c of kids.get(id) ?? []) walk(c.id); };
  roots.forEach(walk);
  const rootSet = new Set(roots);
  const out = layers.filter(l => take.has(l.id)).map(l => snapshot({ ...l, parentId: rootSet.has(l.id) ? null : l.parentId }, cloneCanvas));
  return { layers: out, roots };
}

/** Copia independiente de los píxeles (contenido, máscara y original para restaurar). */
function snapshot(l: Layer, cloneCanvas: (c: HTMLCanvasElement) => HTMLCanvasElement): Layer {
  return {
    ...l,
    ...(l.canvas ? { canvas: cloneCanvas(l.canvas) } : {}),
    ...(l.origin ? { origin: cloneCanvas(l.origin) } : {}),
    ...(l.mask ? { mask: cloneCanvas(l.mask) } : {}),
    adjustments: l.adjustments.map(a => ({ ...a, params: structuredCloneSafe(a.params) })),
  };
}
const structuredCloneSafe = <T,>(v: T): T => { try { return structuredClone(v); } catch { return v; } };

export interface InstantiateOptions {
  /** desplazamiento aplicado a todas las capas */
  dx: number;
  dy: number;
  /** genera ids nuevos */
  newId: () => string;
  /** padre en el que se insertan las raíces */
  parentId: string | null;
  /** ids de las capas del documento destino (para conservar vínculos con componentes que existan) */
  existingIds: Set<string>;
  cloneCanvas?: (c: HTMLCanvasElement) => HTMLCanvasElement;
}

/**
 * Crea instancias nuevas del portapapeles: ids únicos, grupos reconstruidos con sus hijos,
 * posiciones relativas conservadas (más el desplazamiento) y lienzos independientes.
 * Las copias de un componente principal pasan a ser capas normales; las de una variante siguen
 * vinculadas si su componente existe en el documento destino.
 */
export function instantiateClip(clip: LayerClip, o: InstantiateOptions): { layers: Layer[]; roots: string[] } {
  const idMap = new Map<string, string>();
  for (const l of clip.layers) idMap.set(l.id, o.newId());
  const clone = o.cloneCanvas ?? (c => c);
  const layers = clip.layers.map(l => {
    const n = snapshot(l, clone);
    const keepLink = !!l.link && o.existingIds.has(l.link.master) && !idMap.has(l.link.master);
    return {
      ...n,
      id: idMap.get(l.id)!,
      parentId: l.parentId ? idMap.get(l.parentId) ?? o.parentId : o.parentId,
      x: l.x + o.dx,
      y: l.y + o.dy,
      component: null,
      link: keepLink ? l.link : null,
    } as Layer;
  });
  return { layers, roots: clip.roots.map(id => idMap.get(id)!) };
}

/** Texto que se deja en el portapapeles del sistema: el contenido de los textos, si los hay. */
export function clipText(clip: LayerClip): string {
  const texts = clip.layers.filter(l => l.kind === 'text' && l.text?.text).map(l => l.text!.text);
  if (texts.length) return texts.join('\n');
  const n = clip.roots.length;
  return `KOVA Design Lab · ${n} objeto${n === 1 ? '' : 's'}`;
}
