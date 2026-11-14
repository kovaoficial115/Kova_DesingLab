// Acciones de componentes y variantes vinculadas (la lógica de propagación está en links.ts).

import type { Layer } from './types';
import { commit, docState, toast } from './store';
import { layerBounds, unionRect } from './util';
import { subtree, makeVariant, variantRoots, variantLayers, resetVariant, masterRootOf, variantRootOf } from './links';

const boundsOf = (layers: Layer[]) => unionRect(layers.filter(l => l.kind !== 'group').map(layerBounds));

/** ¿Puede esta capa ser un componente? (no dentro de otro componente ni de una variante) */
export function canBeComponent(layers: Layer[], l: Layer) {
  if (l.component || l.link) return false;
  if (masterRootOf(layers, l)) return false;
  const byId = new Map(layers.map(x => [x.id, x]));
  for (let p = l.parentId ? byId.get(l.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) if (p.link) return false;
  return !subtree(layers, l.id).some(x => x.component || x.link);
}

export function makeComponent(id: string) {
  const st = docState();
  const l = st?.layers.find(x => x.id === id);
  if (!st || !l) return;
  if (!canBeComponent(st.layers, l)) { toast('Esa capa ya forma parte de un componente o de una variante.', 'warn'); return; }
  commit('Crear componente', s => ({ ...s, layers: s.layers.map(x => (x.id === id ? { ...x, component: { name: x.name } } : x)) }));
}

/** Nueva variante vinculada, a la derecha del componente (o de su última variante). */
export function createVariant(masterId: string) {
  const st = docState();
  const M = st?.layers.find(x => x.id === masterId);
  if (!st || !M?.component) return null;
  const sub = subtree(st.layers, masterId);
  const b = boundsOf(sub);
  if (!b) { toast('El componente está vacío.', 'warn'); return null; }
  const roots = variantRoots(st.layers, masterId);
  const gap = Math.max(40, Math.round(Math.min(b.w, b.h) * 0.2));
  const taken = [b, ...roots.map(r => boundsOf(variantLayers(st.layers, r))).filter((r): r is NonNullable<typeof r> => !!r)];
  const ab = st.artboards.find(a => b.x < a.x + a.w && b.x + b.w > a.x && b.y < a.y + a.h && b.y + b.h > a.y);
  const free = (x: number, y: number) => !taken.some(t => x < t.x + t.w + gap / 2 && x + b.w > t.x - gap / 2 && y < t.y + t.h + gap / 2 && y + b.h > t.y - gap / 2);
  // primer hueco libre dentro de la mesa: en filas, a la derecha y luego hacia abajo
  let dx = 0, dy = 0, found = false;
  if (ab) {
    const x0 = ab.x + Math.max(0, Math.min(b.x - ab.x, gap));
    for (let y = b.y; !found && y + b.h <= ab.y + ab.h; y += b.h + gap) {
      for (let x = y === b.y ? b.x : x0; x + b.w <= ab.x + ab.w; x += b.w + gap) if (free(x, y)) { dx = x - b.x; dy = y - b.y; found = true; break; }
    }
  }
  // sin hueco: a la derecha de lo que más a la derecha está
  if (!found) { dx = Math.max(...taken.map(t => t.x + t.w)) + gap - b.x; dy = 0; }
  const copies = makeVariant(st.layers, masterId, dx, dy, `${M.component.name} · variante ${roots.length + 1}`);
  // en el orden del documento los hijos van antes que su grupo: la raíz no es la primera copia
  const root = copies.find(c => c.link!.src === masterId)!;
  commit('Crear variante', s => {
    const layers = [...s.layers];
    // justo encima del componente (tras su capa más alta)
    const ids = new Set(subtree(s.layers, masterId).map(l => l.id));
    let at = 0;
    layers.forEach((l, i) => { if (ids.has(l.id)) at = i + 1; });
    layers.splice(at, 0, ...copies);
    return { ...s, layers, selectedLayerIds: [root.id] };
  });
  return root.id;
}

/** La variante deja de seguir al principal (queda como capas normales). */
export function detachVariant(rootId: string) {
  const st = docState();
  const R = st?.layers.find(x => x.id === rootId);
  if (!st || !R?.link) return;
  const ids = new Set(variantLayers(st.layers, R).map(l => l.id));
  commit('Desvincular variante', s => ({ ...s, layers: s.layers.map(l => (ids.has(l.id) ? { ...l, link: null } : l)) }));
}

/** Quita los cambios hechos en la variante: vuelve a ser igual que el principal (en su sitio). */
export function resetVariantAction(rootId: string) {
  const st = docState();
  const R = st?.layers.find(x => x.id === rootId);
  if (!st || !R?.link) return;
  commit('Restablecer variante', s => ({ ...s, layers: resetVariant(s.layers, s.layers.find(l => l.id === rootId)!) }));
}

/** Deja de ser componente: sus variantes se desvinculan. */
export function removeComponent(masterId: string) {
  commit('Quitar componente', s => ({
    ...s,
    layers: s.layers.map(l => (l.id === masterId ? { ...l, component: null } : l.link?.master === masterId ? { ...l, link: null } : l)),
  }));
}

export function renameComponent(masterId: string, name: string) {
  commit('Renombrar componente', s => ({ ...s, layers: s.layers.map(l => (l.id === masterId && l.component ? { ...l, component: { ...l.component, name } } : l)) }));
}

export { variantRoots, variantRootOf, masterRootOf };
