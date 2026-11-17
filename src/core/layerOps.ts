// Avisos antes de operaciones de capas que no se pueden editar después (combinar, acoplar).
import type { Layer } from './types';
import { descendants } from './doc';

/** Lo editable que se pierde al convertir esas capas (y sus hijas) en píxeles. Vacío = nada que avisar. */
export function editableLoss(layers: Layer[], ids: string[]): string[] {
  const set = new Set<string>();
  ids.forEach(id => { set.add(id); descendants(layers, id).forEach(d => set.add(d.id)); });
  const ls = layers.filter(l => set.has(l.id));
  const out: string[] = [];
  const n = (k: (l: Layer) => boolean) => ls.filter(k).length;
  const add = (c: number, one: string, many: string) => { if (c) out.push(c === 1 ? one : `${c} ${many}`); };
  add(n(l => l.kind === 'text'), 'un texto editable', 'textos editables');
  add(n(l => l.kind === 'shape'), 'una forma editable', 'formas editables');
  add(n(l => l.kind === 'vector'), 'un vector', 'vectores');
  add(n(l => l.kind === 'adjust'), 'una capa de ajuste', 'capas de ajuste');
  add(n(l => l.kind !== 'adjust' && l.adjustments.some(a => a.enabled)), 'efectos no destructivos', 'capas con efectos no destructivos');
  add(n(l => !!l.mask), 'una máscara', 'máscaras');
  add(n(l => !!l.crop), 'un recorte no destructivo', 'recortes no destructivos');
  add(n(l => !!l.component || !!l.link), 'un componente o variante vinculada', 'componentes o variantes vinculadas');
  return out;
}

export function mergeWarningText(what: string, loss: string[]): string {
  return `${what} convierte en píxeles: ${loss.join(', ')}. Dejarán de ser editables por separado.\n\nPuedes deshacerlo con ⌘Z / Ctrl+Z.`;
}
