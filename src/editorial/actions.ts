// Acciones editoriales sobre el documento (pasan por el historial).

import type { Layer } from '../core/types';
import { commit, docState, toast } from '../core/store';
import { layerBounds, unionRect } from '../core/util';
import { subtree, makeVariant, variantRoots } from '../core/links';
import type { LayoutGrid } from './layout';

/** Pone (o quita, con null) la retícula de maquetación en las mesas indicadas. */
export function setLayout(abIds: string[], layout: LayoutGrid | null, label = 'Retícula de maquetación') {
  const ids = new Set(abIds);
  commit(label, s => ({ ...s, artboards: s.artboards.map(a => (ids.has(a.id) ? { ...a, layout: layout ? { ...layout, margins: { ...layout.margins } } : null } : a)) }));
}

const boundsOf = (layers: Layer[]) => unionRect(layers.filter(l => l.kind !== 'group').map(layerBounds));

/**
 * Coloca una variante vinculada del componente en cada mesa indicada, en la misma posición
 * relativa que el principal tiene en su mesa (ajustada para que quepa si la mesa es más pequeña).
 * Las variantes siguen al principal como las demás.
 */
export function placeVariantOnArtboards(masterId: string, abIds: string[]): string[] {
  const st = docState();
  const M = st?.layers.find(x => x.id === masterId);
  if (!st || !M?.component) return [];
  const b = boundsOf(subtree(st.layers, masterId));
  if (!b) { toast('El componente está vacío.', 'warn'); return []; }
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const home = st.artboards.find(a => cx >= a.x && cx <= a.x + a.w && cy >= a.y && cy <= a.y + a.h) ?? st.artboards.find(a => a.id === st.activeArtboardId)!;
  const targets = st.artboards.filter(a => abIds.includes(a.id) && a.id !== home.id);
  if (!targets.length) { toast('Elige otra mesa distinta de la del componente', 'warn'); return []; }
  let n = variantRoots(st.layers, masterId).length;
  const all: Layer[] = [];
  const roots: string[] = [];
  for (const ab of targets) {
    // misma posición relativa; si no cabe, se acerca al borde para quedar dentro
    let x = ab.x + (b.x - home.x), y = ab.y + (b.y - home.y);
    x = Math.min(Math.max(x, ab.x), ab.x + Math.max(0, ab.w - b.w));
    y = Math.min(Math.max(y, ab.y), ab.y + Math.max(0, ab.h - b.h));
    const copies = makeVariant(st.layers, masterId, x - b.x, y - b.y, `${M.component.name} · ${ab.name}`);
    n++;
    all.push(...copies);
    roots.push(copies.find(c => c.link!.src === masterId)!.id);
  }
  commit(targets.length === 1 ? `Variante en «${targets[0].name}»` : `Variantes en ${targets.length} mesas`, s => {
    const layers = [...s.layers];
    const ids = new Set(subtree(s.layers, masterId).map(l => l.id));
    let at = 0;
    layers.forEach((l, i) => { if (ids.has(l.id)) at = i + 1; });
    layers.splice(at, 0, ...all);
    return { ...s, layers, selectedLayerIds: roots };
  });
  toast(`${roots.length} variante(s) vinculada(s) colocada(s); siguen los cambios del componente`, 'ok');
  return roots;
}
