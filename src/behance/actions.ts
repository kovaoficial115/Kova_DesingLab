// Acciones de Behance Project Builder. Todas pasan por el historial (`commit`): se deshacen y
// rehacen como cualquier otra, y las secciones viajan en el .kova y en la colaboración.

import type { Artboard, Doc, DocState, Layer } from '../core/types';
import { set, commit, docState, toast } from '../core/store';
import { newArtboard, newDoc, descendants } from '../core/doc';
import { addDoc, cloneLayerDeep } from '../core/actions';
import { layerBounds, unionRect, uid, type Rect } from '../core/util';
import { fitWhenReady } from '../social/actions';
import {
  BEHANCE_WIDTH, SECTION_GAP, MAX_SECTIONS, clampSection, projectSections, restackPlan, inSection,
  type ArtboardBehance,
} from './model';

export interface NewProjectOptions {
  name: string;
  width?: number;
  sections: { name: string; h: number }[];
  continuous: boolean;
  background?: string | null;
}

const gapOf = (continuous: boolean) => (continuous ? 0 : SECTION_GAP);
const bounds = (l: Layer): Rect | null => (l.kind === 'group' ? null : layerBounds(l));
const shiftY = (l: Layer, dy: number): Layer => (l.kind === 'group' || !dy ? l : { ...l, y: l.y + dy });

function sectionArtboard(w: number, h: number, name: string, x: number, y: number, bg: string | null, b: ArtboardBehance): Artboard {
  return { ...newArtboard(w, clampSection(h), 72, name, x, y, bg), margin: 0, behance: b };
}

function buildSections(o: NewProjectOptions, x: number, y: number): Artboard[] {
  const pid = uid('bh');
  const w = Math.max(100, Math.round(o.width ?? BEHANCE_WIDTH));
  const bg = o.background === undefined ? '#ffffff' : o.background;
  const list = (o.sections.length ? o.sections : [{ name: 'Portada', h: 1000 }]).slice(0, MAX_SECTIONS);
  let cy = y;
  return list.map((s, i) => {
    const ab = sectionArtboard(w, s.h, s.name || `Sección ${i + 1}`, x, cy, bg, { project: pid, name: o.name || 'Proyecto Behance', index: i, continuous: o.continuous });
    cy += ab.h + gapOf(o.continuous);
    return ab;
  });
}

/** Documento nuevo con un proyecto de Behance. */
export function createBehanceDoc(o: NewProjectOptions) {
  const abs = buildSections(o, 0, 0);
  const d: Doc = newDoc(o.name || 'Proyecto Behance', abs[0].w, abs[0].h, 72, abs[0].background);
  d.state = { ...d.state, artboards: abs, activeArtboardId: abs[0].id };
  set({ unit: 'px' });
  addDoc(d, false);
  showPanel();
  fitWhenReady(abs[0]);
}

/** Proyecto nuevo en el documento abierto, a la derecha de todo. */
export function addBehanceProject(o: NewProjectOptions) {
  const st = docState();
  if (!st) return;
  const all = unionRect(st.artboards)!;
  const abs = buildSections(o, Math.round(all.x + all.w + 200), Math.round(all.y));
  commit(`Proyecto Behance: ${o.name}`, s => ({ ...s, artboards: [...s.artboards, ...abs], activeArtboardId: abs[0].id }));
  showPanel();
  fitWhenReady(abs[0]);
}

/** La mesa pasa a ser la primera sección (portada) de un proyecto nuevo. No cambia su tamaño. */
export function convertToProject(abId: string, name: string, continuous: boolean) {
  const st = docState();
  const ab = st?.artboards.find(a => a.id === abId);
  if (!st || !ab) return;
  if (ab.behance) return toast('Esta mesa ya es una sección de un proyecto', 'warn');
  const b: ArtboardBehance = { project: uid('bh'), name: name || 'Proyecto Behance', index: 0, continuous };
  commit('Convertir en proyecto Behance', s => ({ ...s, artboards: s.artboards.map(a => (a.id === abId ? { ...a, behance: b } : a)) }));
  showPanel();
}

function showPanel() {
  set(st => ({ panels: st.panels.map(p => (p.id === 'behance' ? { ...p, visible: true, collapsed: false } : p)) }));
}

/**
 * Reapila las secciones de un proyecto con el orden, altos y modo dados. El contenido de cada
 * sección la acompaña (según el modo que tenía antes); lo que hay debajo del proyecto en la misma
 * columna se aparta si el proyecto crece.
 */
function restack(s: DocState, projectId: string, list: Artboard[], continuous: boolean, top?: number): DocState {
  const old = projectSections(s.artboards, projectId);
  const ref = old[0] ?? list[0];
  if (!ref) return s;
  const wasContinuous = old[0]?.behance?.continuous ?? continuous;
  const x0 = ref.x, y0 = top ?? Math.min(...(old.length ? old : list).map(a => a.y));
  const oldBottom = old.length ? Math.max(...old.map(a => a.y + a.h)) : y0;
  const plan = restackPlan(old, list.map(a => ({ id: a.id, h: a.h })), y0, gapOf(continuous), s.layers, bounds, wasContinuous);
  let layers = s.layers.map(l => shiftY(l, plan.shifts.get(l.id) ?? 0));
  const name = list[0]?.behance?.name ?? old[0]?.behance?.name ?? 'Proyecto Behance';
  const ids = new Set(list.map(a => a.id));
  let others = s.artboards.filter(a => !ids.has(a.id) && a.behance?.project !== projectId);
  // si el proyecto crece, lo de debajo (en su columna) baja lo mismo
  const delta = plan.bottom - oldBottom;
  const colW = Math.max(...list.map(a => a.w), ...old.map(a => a.w));
  if (delta > 0 && old.length) {
    const below = others.filter(a => a.y >= oldBottom - 1 && a.x < x0 + colW && a.x + a.w > x0);
    if (below.length) {
      const moved = new Set(plan.shifts.keys());
      layers = layers.map(l => {
        const b = bounds(l);
        if (!b || moved.has(l.id)) return l;
        return below.some(a => inSection(a, b, false)) ? shiftY(l, delta) : l;
      });
      const bid = new Set(below.map(a => a.id));
      others = others.map(a => (bid.has(a.id) ? { ...a, y: a.y + delta } : a));
    }
  }
  const sections = list.map((a, i) => ({ ...a, x: x0, y: plan.ys.get(a.id)!, margin: 0, behance: { project: projectId, name, index: i, continuous } }));
  // las secciones se quedan juntas en el orden de las mesas (como las ve el panel Mesas)
  const firstIdx = s.artboards.findIndex(a => a.behance?.project === projectId);
  const artboards = [...others];
  artboards.splice(firstIdx < 0 ? artboards.length : Math.min(firstIdx, artboards.length), 0, ...sections);
  return { ...s, layers, artboards };
}

function projectOf(abId: string) {
  const st = docState();
  const ab = st?.artboards.find(a => a.id === abId);
  if (!st || !ab?.behance) return null;
  return { st, ab, pid: ab.behance.project, list: projectSections(st.artboards, ab.behance.project), continuous: ab.behance.continuous };
}

/** Añade una sección vacía después de `afterId` (o al final). */
export function addSection(projectId: string, h: number, name?: string, afterId?: string) {
  const st = docState();
  if (!st) return;
  const list = projectSections(st.artboards, projectId);
  if (!list.length) return;
  if (list.length >= MAX_SECTIONS) return toast(`Un proyecto admite hasta ${MAX_SECTIONS} secciones`, 'warn');
  const at = afterId ? list.findIndex(a => a.id === afterId) + 1 : list.length;
  const prev = list[Math.max(0, at - 1)];
  const nab = sectionArtboard(prev.w, h, name || `Sección ${list.length + 1}`, prev.x, prev.y, prev.background, { ...prev.behance! });
  const order = [...list.slice(0, at), nab, ...list.slice(at)];
  commit('Añadir sección', s => ({ ...restack(s, projectId, order, prev.behance!.continuous), activeArtboardId: nab.id }));
  return nab;
}

/** Duplica una sección con su contenido justo debajo de ella. */
export function duplicateSection(abId: string) {
  const p = projectOf(abId);
  if (!p) return;
  if (p.list.length >= MAX_SECTIONS) return toast(`Un proyecto admite hasta ${MAX_SECTIONS} secciones`, 'warn');
  const { ab, list, pid, continuous } = p;
  const at = list.findIndex(a => a.id === abId) + 1;
  const nab: Artboard = { ...ab, id: uid('ab'), name: `${ab.name} copia` };
  const order = [...list.slice(0, at), nab, ...list.slice(at)];
  commit('Duplicar sección', s => {
    // copias de lo que pertenece a la sección (los grupos se copian enteros)
    const tops = s.layers.filter(l => {
      if (l.parentId) return false;
      const rs = (l.kind === 'group' ? descendants(s.layers, l.id).filter(d => d.kind !== 'group') : [l]).map(layerBounds).filter(b => b.w > 0 && b.h > 0);
      const b = unionRect(rs);
      return !!b && inSection(ab, b, continuous);
    });
    const next = restack(s, pid, order, continuous);
    const newY = next.artboards.find(a => a.id === nab.id)!.y;
    const copies = tops.flatMap(l => cloneLayerDeep(l, s.layers, null).map(c => shiftY({ ...c, name: c.name.replace(/ copia$/, '') }, newY - ab.y)));
    return { ...next, layers: [...next.layers, ...copies], activeArtboardId: nab.id };
  });
}

/** Elimina una sección con su contenido; las de debajo suben. */
export function deleteSection(abId: string) {
  const p = projectOf(abId);
  if (!p) return;
  if (p.st.artboards.length < 2) return toast('El documento necesita al menos una mesa de trabajo', 'warn');
  const { ab, list, pid, continuous } = p;
  commit('Eliminar sección', s => {
    const own = new Set(s.layers.filter(l => { const b = bounds(l); return !!b && inSection(ab, b, continuous); }).map(l => l.id));
    let layers = s.layers.filter(l => !own.has(l.id));
    layers = layers.filter(l => l.kind !== 'group' || descendants(s.layers, l.id).length === 0 || descendants(layers, l.id).length > 0);
    const rest = list.filter(a => a.id !== abId);
    const base: DocState = { ...s, layers, artboards: s.artboards.filter(a => a.id !== abId), selectedLayerIds: s.selectedLayerIds.filter(id => !own.has(id)) };
    if (!rest.length) return { ...base, activeArtboardId: base.artboards[0].id };
    // se reapila desde la Y de la primera sección original
    const next = restack(base, pid, rest, continuous, list[0].y);
    const i = list.findIndex(a => a.id === abId);
    return { ...next, activeArtboardId: rest[Math.max(0, i - 1)].id };
  });
}

/** Mueve una sección a otra posición: su contenido la acompaña. */
export function moveSection(abId: string, toIndex: number) {
  const p = projectOf(abId);
  if (!p) return;
  const from = p.list.findIndex(a => a.id === abId);
  toIndex = Math.max(0, Math.min(p.list.length - 1, toIndex));
  if (from === toIndex) return;
  const order = [...p.list];
  const [x] = order.splice(from, 1);
  order.splice(toIndex, 0, x);
  commit('Reordenar secciones', s => restack(s, p.pid, order, p.continuous));
}

/** Cambia el alto de una sección; las de debajo se recolocan. */
export function setSectionHeight(abId: string, h: number) {
  const p = projectOf(abId);
  if (!p) return;
  h = clampSection(h);
  if (h === p.ab.h) return;
  commit(`Alto de sección: ${h}`, s => restack(s, p.pid, p.list.map(a => (a.id === abId ? { ...a, h } : a)), p.continuous));
}

/** Modo continuo (secciones pegadas) o separado (con hueco en el lienzo). */
export function setContinuous(projectId: string, continuous: boolean) {
  const st = docState();
  const list = st ? projectSections(st.artboards, projectId) : [];
  if (!list.length || list[0].behance!.continuous === continuous) return;
  commit(continuous ? 'Proyecto continuo' : 'Proyecto por secciones', s => restack(s, projectId, list, continuous));
}

/** Ancho común de todas las secciones (no escala el contenido). */
export function setProjectWidth(projectId: string, w: number) {
  const st = docState();
  const list = st ? projectSections(st.artboards, projectId) : [];
  w = Math.max(100, Math.min(MAX_SECTION_W, Math.round(w)));
  if (!list.length || list.every(a => a.w === w)) return;
  commit(`Ancho del proyecto: ${w}`, s => restack(s, projectId, list.map(a => ({ ...a, w })), list[0].behance!.continuous));
}
const MAX_SECTION_W = 6000;

export function renameProject(projectId: string, name: string) {
  commit('Renombrar proyecto', s => ({ ...s, artboards: s.artboards.map(a => (a.behance?.project === projectId ? { ...a, behance: { ...a.behance, name } } : a)) }));
}

export function renameSection(abId: string, name: string) {
  if (!name.trim()) return;
  commit('Renombrar sección', s => ({ ...s, artboards: s.artboards.map(a => (a.id === abId ? { ...a, name: name.trim() } : a)) }));
}

/** Mismo fondo en todas las secciones. */
export function setProjectBackground(projectId: string, background: string | null) {
  commit('Fondo del proyecto', s => ({ ...s, artboards: s.artboards.map(a => (a.behance?.project === projectId ? { ...a, background } : a)) }));
}

/** Las secciones vuelven a ser mesas normales (no se borra nada). */
export function dissolveProject(projectId: string) {
  commit('Deshacer proyecto Behance', s => ({ ...s, artboards: s.artboards.map(a => (a.behance?.project === projectId ? { ...a, behance: null } : a)) }));
}
