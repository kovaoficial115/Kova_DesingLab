// Modos de vista: pantalla completa, enfoque (paneles ocultos) y presentación (solo el diseño).
// La presentación no toca el documento: guarda la vista (zoom y desplazamiento) y la devuelve al salir.

import { get, set, getView, setView, activeDoc, toast } from '../core/store';
import type { View } from '../core/types';
import { fitToScreen } from '../core/actions';
import { platform } from '../platform';

let saved: { docId: string; view: View; compare: boolean; artboardId: string; enteredFullscreen: boolean } | null = null;

/** Refleja el estado real (también si se sale con la tecla del sistema). */
export async function syncFullscreen() {
  const on = await platform.isFullscreen();
  if (on !== get().fullscreen) set({ fullscreen: on });
  return on;
}
if (typeof document !== 'undefined') {
  document.addEventListener('fullscreenchange', () => { void syncFullscreen(); });
  window.addEventListener('resize', () => { void syncFullscreen(); });
}

/** Pide la pantalla completa sin quedarse esperando si el entorno no la concede nunca. */
const requestFullscreen = (on: boolean) =>
  Promise.race([platform.setFullscreen(on), new Promise<boolean>(r => setTimeout(() => r(!on), 1500))]);

export async function toggleFullscreen() {
  const want = !get().fullscreen;
  const on = await requestFullscreen(want);
  set({ fullscreen: on });
  if (on !== want) toast(want ? 'Este entorno no permite la pantalla completa' : 'No se pudo salir de la pantalla completa', 'warn');
}

const nextFrame = () => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));

/** Entra en presentación: oculta toda la interfaz y ajusta la mesa activa a la ventana. */
export async function enterPresentation() {
  const d = activeDoc();
  if (!d || get().presenting) return;
  saved = { docId: d.id, view: { ...getView(d.id) }, compare: get().compare, artboardId: d.state.activeArtboardId, enteredFullscreen: false };
  set({ presenting: true, gradientEdit: null, compare: false, peekOriginal: false });
  await nextFrame();
  // ajusta y sigue ajustando al cambiar el tamaño de la ventana (p. ej. al pasar a pantalla completa)
  fitToScreen();
  if (!get().fullscreen) {
    // sin bloquear: algunos navegadores no responden nunca si no permiten la pantalla completa
    const on = await requestFullscreen(true);
    if (on) { set({ fullscreen: true }); if (saved) saved.enteredFullscreen = true; }
  }
  toast(d.state.artboards.length > 1 ? 'Presentación · ← → cambia de mesa · Esc para salir' : 'Presentación · Esc para salir', 'info');
}

/** Sale de la presentación y devuelve la vista, la mesa activa y la pantalla como estaban. */
export async function exitPresentation() {
  if (!get().presenting) return;
  const s = saved;
  saved = null;
  set({ presenting: false, compare: s?.compare ?? false });
  if (s?.enteredFullscreen) set({ fullscreen: await requestFullscreen(false) });
  const d = activeDoc();
  if (s && d && d.id === s.docId) {
    if (d.state.artboards.some(a => a.id === s.artboardId) && d.state.activeArtboardId !== s.artboardId) {
      set(st => ({ docs: st.docs.map(x => (x.id === d.id ? { ...x, state: { ...x.state, activeArtboardId: s.artboardId } } : x)) }));
    }
    await nextFrame();
    setView(s.view, d.id);
  }
}

/** Mesa anterior o siguiente durante la presentación (sin historial: solo cambia qué se ve). */
export function presentStep(dir: 1 | -1) {
  const d = activeDoc();
  if (!d || !get().presenting) return;
  const abs = [...d.state.artboards].sort((a, b) => (a.y - b.y) || (a.x - b.x));
  if (abs.length < 2) return;
  const i = abs.findIndex(a => a.id === d.state.activeArtboardId);
  const next = abs[(i + dir + abs.length) % abs.length];
  set(st => ({ docs: st.docs.map(x => (x.id === d.id ? { ...x, state: { ...x.state, activeArtboardId: next.id } } : x)) }));
  fitToScreen();
}

/** Teclas durante la presentación: Esc sale, flechas/espacio cambian de mesa; el resto no edita nada. */
export function presentationKey(e: KeyboardEvent): boolean {
  if (!get().presenting) return false;
  e.preventDefault();
  if (e.key === 'Escape') void exitPresentation();
  else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') presentStep(1);
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') presentStep(-1);
  return true;
}
