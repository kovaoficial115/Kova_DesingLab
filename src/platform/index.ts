// Punto de entrada del Platform Adapter. Toda la app importa `platform` desde aquí.
import type { PlatformAdapter, PlatformKind } from './types';
import { webPlatform } from './web';

export type * from './types';

/** Detecta si la app corre dentro de la versión de escritorio (Tauri 2) o en un navegador. */
export function detectPlatform(): PlatformKind {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window ? 'desktop' : 'web';
}

const kind = detectPlatform();
let impl: PlatformAdapter = webPlatform;
// el código de Tauri solo se descarga en escritorio: la web no lo carga nunca
const ready: Promise<void> = kind === 'desktop'
  ? import('./desktop').then(m => { impl = m.desktopPlatform; })
  : Promise.resolve();

export const platform: PlatformAdapter = {
  kind,
  capabilities: { get saveToLocation() { return kind === 'desktop' || impl.capabilities.saveToLocation; } },
  openFiles: async o => { await ready; return impl.openFiles(o); },
  saveFile: async (data, o) => { await ready; return impl.saveFile(data, o); },
  droppedFiles: dt => impl.droppedFiles(dt),
};
