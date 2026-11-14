// Variantes vinculadas (componentes). Un componente principal es una capa o un grupo marcado con
// `component`; sus variantes son copias cuyas capas llevan `link` (principal y capa de origen).
//
// Tras cada cambio del documento, `syncLinks(antes, después)` lleva a las variantes lo que cambió
// en el principal. La regla es la de las sustituciones de Figma o InDesign, sin guardar una lista
// aparte: una propiedad de la variante sigue al principal mientras valga lo mismo que valía en el
// principal; si la variante la cambió (otro texto, otro color), se conserva. La geometría se lleva
// como diferencia (lo que se movió, giró o escaló el elemento del principal), así cada variante
// mantiene su sitio. Mover el componente entero no mueve sus variantes.
//
// Funciones puras sobre DocState: se prueban sin navegador.

import type { DocState, Layer } from './types';
import { uid } from './util';

const PLAIN_KEYS = ['visible', 'opacity', 'blend', 'clip', 'maskEnabled', 'kind', 'canvas', 'origin', 'mask', 'vector', 'adjustments', 'brand'] as const;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
/** Igualdad para propiedades: los bitmaps por referencia, el resto por valor. */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == b;
  if (typeof HTMLCanvasElement !== 'undefined' && (a instanceof HTMLCanvasElement || b instanceof HTMLCanvasElement)) return false;
  if (!isObj(a) || !isObj(b)) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Capa y todos sus descendientes (orden del documento). */
export function subtree(layers: Layer[], rootId: string): Layer[] {
  const ids = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const l of layers) if (l.parentId && ids.has(l.parentId) && !ids.has(l.id)) { ids.add(l.id); grew = true; }
  }
  return layers.filter(l => ids.has(l.id));
}

/** Capas de la variante con raíz `root` que siguen al principal `master`. */
export function variantLayers(layers: Layer[], root: Layer): Layer[] {
  const m = root.link?.master;
  return subtree(layers, root.id).filter(l => l.link?.master === m);
}

/** Raíces de las variantes de un principal. */
export function variantRoots(layers: Layer[], masterId: string): Layer[] {
  return layers.filter(l => l.link?.master === masterId && l.link.src === masterId);
}

/** Raíz de la variante a la que pertenece una capa (o null). */
export function variantRootOf(layers: Layer[], l: Layer): Layer | null {
  if (!l.link) return null;
  let cur: Layer | undefined = l;
  const byId = new Map(layers.map(x => [x.id, x]));
  while (cur) {
    if (cur.link?.master === l.link.master && cur.link.src === l.link.master) return cur;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return null;
}

/** Componente principal al que pertenece una capa (ella misma o un antepasado con `component`). */
export function masterRootOf(layers: Layer[], l: Layer): Layer | null {
  const byId = new Map(layers.map(x => [x.id, x]));
  let cur: Layer | undefined = l;
  while (cur) {
    if (cur.component) return cur;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return null;
}

/** Sigue un valor del principal si la variante no lo cambió. */
function follow<T>(inst: T, before: T, after: T): { v: T; changed: boolean } {
  if (same(before, after) || !same(inst, before)) return { v: inst, changed: false };
  return { v: after, changed: true };
}

function followObject<T extends object>(inst: T | undefined, before: T | undefined, after: T | undefined): { v: T | undefined; changed: boolean } {
  if (!inst || !before || !after) return follow(inst, before, after);
  const out: any = { ...inst };
  let changed = false;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    const r = follow((inst as any)[k], (before as any)[k], (after as any)[k]);
    if (r.changed) { changed = true; if (r.v === undefined) delete out[k]; else out[k] = r.v; }
  }
  return { v: changed ? out : inst, changed };
}

interface Geo { dx: number; dy: number; dr: number; ksx: number; ksy: number }

/** Lleva a `inst` lo que cambió entre `before` y `after` (capas del principal). */
export function followLayer(inst: Layer, before: Layer, after: Layer, opts: { root: boolean; geometry: boolean }): Layer {
  let out: Layer = inst;
  const put = (k: string, v: unknown) => { if (out === inst) out = { ...inst }; (out as any)[k] = v; };
  for (const k of PLAIN_KEYS) {
    const r = follow((inst as any)[k], (before as any)[k], (after as any)[k]);
    if (r.changed) put(k, r.v);
  }
  if (!opts.root) { const r = follow(inst.name, before.name, after.name); if (r.changed) put('name', r.v); }
  for (const k of ['text', 'shape'] as const) {
    const r = followObject(inst[k] as any, before[k] as any, after[k] as any);
    if (r.changed) put(k, r.v);
  }
  if (opts.geometry) {
    const g: Geo = {
      dx: opts.root ? 0 : after.x - before.x, dy: opts.root ? 0 : after.y - before.y,
      dr: after.rotation - before.rotation,
      ksx: before.scaleX ? after.scaleX / before.scaleX : 1, ksy: before.scaleY ? after.scaleY / before.scaleY : 1,
    };
    if (g.dx) put('x', out.x + g.dx);
    if (g.dy) put('y', out.y + g.dy);
    if (g.dr) put('rotation', out.rotation + g.dr);
    if (g.ksx !== 1 && isFinite(g.ksx)) put('scaleX', out.scaleX * g.ksx);
    if (g.ksy !== 1 && isFinite(g.ksy)) put('scaleY', out.scaleY * g.ksy);
  }
  return out;
}

/** ¿Se movió el componente entero (todas sus capas con la misma traslación, sin girar ni escalar)? */
function wholeMove(oldSub: Layer[], newSub: Layer[], prevById: Map<string, Layer>): boolean {
  let d: [number, number] | null = null;
  for (const n of newSub) {
    if (n.kind === 'group') continue;
    const o = prevById.get(n.id);
    if (!o) return false;
    if (o.rotation !== n.rotation || o.scaleX !== n.scaleX || o.scaleY !== n.scaleY) return false;
    const dd: [number, number] = [n.x - o.x, n.y - o.y];
    if (!d) d = dd;
    else if (Math.abs(d[0] - dd[0]) > 1e-6 || Math.abs(d[1] - dd[1]) > 1e-6) return false;
  }
  void oldSub;
  return !!d && (d[0] !== 0 || d[1] !== 0);
}

/**
 * Propaga a las variantes los cambios de sus principales entre `prev` y `next`.
 * Devuelve `next` sin tocar si no hay nada que propagar.
 */
export function syncLinks(prev: DocState, next: DocState): DocState {
  if (prev === next || prev.layers === next.layers) return next;
  if (!next.layers.some(l => l.component)) return next;
  if (!next.layers.some(l => l.link)) return next;
  const prevById = new Map(prev.layers.map(l => [l.id, l]));
  let layers = next.layers;
  let touched = false;
  for (const M of next.layers.filter(l => l.component)) {
    const oldM = prevById.get(M.id);
    if (!oldM?.component) continue; // componente recién creado: nada que llevar
    const newSub = subtree(next.layers, M.id);
    const oldSub = subtree(prev.layers, M.id);
    const changed = newSub.length !== oldSub.length || newSub.some((l, i) => prevById.get(l.id) !== l || oldSub[i]?.id !== l.id);
    if (!changed) continue;
    const roots = variantRoots(layers, M.id);
    if (!roots.length) continue;
    const geometry = !(M.kind === 'group' && wholeMove(oldSub, newSub, prevById));
    const oldIds = new Set(oldSub.map(l => l.id));
    const newIds = new Set(newSub.map(l => l.id));
    const masterIndex = new Map(newSub.map((l, i) => [l.id, i]));
    for (const R of roots) {
      const inst = variantLayers(layers, R);
      const bySrc = new Map(inst.map(l => [l.link!.src, l]));
      // desplazamiento de la variante respecto al principal (para colocar capas nuevas)
      let dx = 0, dy = 0;
      for (const o of oldSub) {
        const i = bySrc.get(o.id);
        if (i && o.kind !== 'group') { dx = i.x - o.x; dy = i.y - o.y; break; }
      }
      const repl = new Map<string, Layer>();
      const kill = new Set<string>();
      const added: Layer[] = [];
      // capas que siguen existiendo: propiedades y geometría
      for (const m of newSub) {
        const i = bySrc.get(m.id), o = prevById.get(m.id);
        if (i && o && oldIds.has(m.id)) {
          const f = followLayer(i, o, m, { root: m.id === M.id, geometry });
          if (f !== i) repl.set(i.id, f);
        }
      }
      // capas nuevas del principal → copias nuevas en la variante (las que la variante borró a
      // propósito no se vuelven a crear: solo las que no existían antes en el principal)
      const idMap = new Map<string, string>([[M.id, R.id]]);
      for (const l of inst) idMap.set(l.link!.src, l.id);
      for (const m of newSub) {
        if (oldIds.has(m.id) || bySrc.has(m.id)) continue;
        const id = uid('ly');
        idMap.set(m.id, id);
        added.push({ ...m, id, component: null, link: { master: M.id, src: m.id }, x: m.x + dx, y: m.y + dy, parentId: null });
      }
      for (const a of added) {
        const pm = newSub.find(m => m.id === a.link!.src)!.parentId;
        a.parentId = (pm && idMap.get(pm)) || R.id;
      }
      // capas que el principal ya no tiene
      for (const l of inst) if (l.id !== R.id && !newIds.has(l.link!.src)) for (const d of subtree(layers, l.id)) kill.add(d.id);
      if (!repl.size && !added.length && !kill.size) continue;
      touched = true;
      let arr = layers.filter(l => !kill.has(l.id)).map(l => repl.get(l.id) ?? l);
      if (added.length) {
        // se insertan junto a la raíz y luego se ordenan como en el principal
        const at = arr.findIndex(l => l.id === R.id);
        arr.splice(Math.max(0, at), 0, ...added);
        const inR = new Set(subtree(arr, R.id).map(x => x.id));
        const members = arr.map((l, i) => ({ l, i })).filter(x => x.l.link?.master === M.id && inR.has(x.l.id));
        const slots = members.map(x => x.i);
        const sorted = members.map(x => x.l).sort((a, b) => (masterIndex.get(a.link!.src) ?? 0) - (masterIndex.get(b.link!.src) ?? 0));
        arr = [...arr];
        slots.forEach((slot, k) => { arr[slot] = sorted[k]; });
      }
      layers = arr;
    }
  }
  if (!touched) return next;
  const ids = new Set(layers.map(l => l.id));
  return { ...next, layers, selectedLayerIds: next.selectedLayerIds.filter(id => ids.has(id)) };
}

/** Copias vinculadas del componente `master` (capas nuevas, sin insertar), desplazadas (dx, dy). */
export function makeVariant(layers: Layer[], masterId: string, dx: number, dy: number, name: string): Layer[] {
  const sub = subtree(layers, masterId);
  const ids = new Map(sub.map(l => [l.id, uid('ly')]));
  return sub.map(l => ({
    ...l,
    id: ids.get(l.id)!,
    name: l.id === masterId ? name : l.name,
    parentId: l.id === masterId ? l.parentId : ids.get(l.parentId!) ?? l.parentId,
    component: null,
    link: { master: masterId, src: l.id },
    x: l.x + dx, y: l.y + dy,
  }));
}

/** Propiedades de una capa de variante que difieren del principal (para mostrar sustituciones). */
export function overrides(inst: Layer, src: Layer): string[] {
  const out: string[] = [];
  if (inst.text && src.text) for (const k of new Set([...Object.keys(inst.text), ...Object.keys(src.text)])) {
    if (!same((inst.text as any)[k], (src.text as any)[k])) out.push(k === 'text' ? 'texto' : k);
  }
  if (inst.shape && src.shape) for (const k of Object.keys(src.shape)) if (!same((inst.shape as any)[k], (src.shape as any)[k])) out.push(k);
  for (const k of ['visible', 'opacity', 'blend', 'vector', 'canvas', 'brand'] as const) if (!same(inst[k], src[k])) out.push(k);
  return out;
}

/** Devuelve la variante a los valores del principal (conserva su posición). */
export function resetVariant(layers: Layer[], root: Layer): Layer[] {
  const byId = new Map(layers.map(l => [l.id, l]));
  const inst = variantLayers(layers, root);
  // desplazamiento actual de la variante: el de su primera capa con posición
  let dx = 0, dy = 0;
  for (const l of inst) {
    const m = byId.get(l.link!.src);
    if (m && m.kind !== 'group') { dx = l.x - m.x; dy = l.y - m.y; break; }
  }
  const repl = new Map<string, Layer>();
  for (const l of inst) {
    const m = byId.get(l.link!.src);
    if (!m) continue;
    const isRoot = l.id === root.id;
    repl.set(l.id, {
      ...m, id: l.id, parentId: l.parentId, link: l.link, component: null, locked: l.locked, collapsed: l.collapsed,
      name: isRoot ? l.name : m.name,
      x: isRoot && m.kind !== 'group' ? l.x : m.x + dx, y: isRoot && m.kind !== 'group' ? l.y : m.y + dy,
    });
  }
  return layers.map(l => repl.get(l.id) ?? l);
}
