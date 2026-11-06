// Punto de entrada del Platform Adapter. Toda la app importa `platform` desde aquí.
import type { PlatformKind } from './types';
import { webPlatform } from './web';

export type * from './types';

/** Detecta si la app corre dentro de la versión de escritorio (Tauri 2) o en un navegador. */
export function detectPlatform(): PlatformKind {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window ? 'desktop' : 'web';
}

// La implementación de escritorio llega en la fase 8; hasta entonces todo usa la web,
// que también funciona dentro de WKWebView (sin File System Access: descarga).
export const platform = webPlatform;
