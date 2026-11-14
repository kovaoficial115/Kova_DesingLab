// Kits de marca guardados en este equipo (localStorage). El oficial de KOVA va siempre primero y
// no se guarda: viene con la app.

import { useSyncExternalStore } from 'react';
import { KOVA_KIT, KOVA_KIT_ID } from './kova';
import { sanitizeKit, type BrandKit } from './model';
import { uid } from '../core/util';

const KEY = 'kova.brands';
const ACTIVE = 'kova.brand.active';

function load(): BrandKit[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw.map(sanitizeKit).filter((k): k is BrandKit => !!k && k.id !== KOVA_KIT_ID) : [];
  } catch { return []; }
}

let user: BrandKit[] = typeof localStorage !== 'undefined' ? load() : [];
let all: BrandKit[] = [KOVA_KIT, ...user];
let active = (typeof localStorage !== 'undefined' && localStorage.getItem(ACTIVE)) || KOVA_KIT_ID;
const listeners = new Set<() => void>();
let snapshot = { kits: all, active };

function emit() {
  all = [KOVA_KIT, ...user];
  if (!all.some(k => k.id === active)) active = KOVA_KIT_ID;
  snapshot = { kits: all, active };
  listeners.forEach(f => f());
}
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(user)); }
  catch { throw new Error('No queda espacio en este equipo para guardar el kit (los SVG muy grandes ocupan mucho).'); }
}

export function subscribeKits(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }
export const kits = () => all;
export const getKit = (id: string | undefined | null) => all.find(k => k.id === id) ?? null;
export const activeKit = () => getKit(active) ?? KOVA_KIT;
export function setActiveKit(id: string) {
  active = id;
  try { localStorage.setItem(ACTIVE, id); } catch { /* sin almacenamiento */ }
  emit();
}
export function useKits() { return useSyncExternalStore(subscribeKits, () => snapshot); }

/** Guarda (o reemplaza) un kit del usuario. El oficial no se modifica. */
export function saveKit(k: BrandKit) {
  if (k.builtin || k.id === KOVA_KIT_ID) throw new Error('El kit oficial no se puede modificar: duplícalo para ampliarlo.');
  const prev = user;
  user = user.some(x => x.id === k.id) ? user.map(x => (x.id === k.id ? k : x)) : [...user, k];
  try { persist(); } catch (e) { user = prev; throw e; }
  emit();
}
export function updateKit(id: string, fn: (k: BrandKit) => BrandKit) {
  const k = user.find(x => x.id === id);
  if (!k) throw new Error('El kit oficial no se puede modificar: duplícalo para ampliarlo.');
  saveKit(fn(k));
}
export function deleteKit(id: string) {
  user = user.filter(k => k.id !== id);
  persist();
  emit();
}

/** Copia editable de un kit (los estilos cambian de identificador para no mezclarse). */
export function duplicateKit(id: string, name?: string): BrandKit {
  const src = getKit(id);
  if (!src) throw new Error('Kit no encontrado');
  const nid = uid('kit');
  const copy: BrandKit = {
    ...structuredClone({ ...src, builtin: undefined }),
    id: nid, name: name || `${src.name} (copia)`, builtin: undefined,
    styles: src.styles.map(s => ({ ...s, id: `${nid}:${s.id.split(':').pop()}`, kit: nid, props: { ...s.props } })),
  };
  delete (copy as any).builtin;
  saveKit(copy);
  return copy;
}

export function createKit(name: string): BrandKit {
  const k: BrandKit = { id: uid('kit'), name: name || 'Kit nuevo', colors: [], fonts: [], styles: [], assets: [], rules: { notes: [] } };
  saveKit(k);
  return k;
}

/** Un kit importado de archivo: si ya hay uno con el mismo id, se guarda como otro. */
export function addImportedKit(k: BrandKit): BrandKit {
  const kit = all.some(x => x.id === k.id) ? { ...k, id: uid('kit') } : k;
  saveKit({ ...kit, builtin: undefined });
  return kit;
}
