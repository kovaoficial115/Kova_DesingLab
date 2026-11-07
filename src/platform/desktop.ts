// Implementación de escritorio (Tauri 2, macOS) del Platform Adapter: diálogos nativos de
// abrir/guardar y escritura directa en disco con los plugins dialog y fs. Solo se carga dentro
// de la app de escritorio (import dinámico), así que no pesa en la versión web.

import { open, save, confirm } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { PlatformAdapter, SaveFileOptions, SaveResult, SaveTarget, OpenFilesOptions } from './types';

/** Destino de guardado en escritorio: la ruta elegida en el diálogo nativo. */
type PathTarget = SaveTarget & { path: string };
const isPathTarget = (t: unknown): t is PathTarget => !!t && typeof (t as PathTarget).path === 'string';

// los tipos MIME del atributo `accept` se traducen a extensiones (el diálogo de macOS filtra por extensión)
const MIME_EXT: Record<string, string[]> = {
  'image/*': ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'svg', 'tif', 'tiff', 'avif', 'heic'],
  'application/pdf': ['pdf'],
  'application/json': ['json'],
  'application/zip': ['zip'],
  'model/gltf-binary': ['glb'],
};
const EXT_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp', gif: 'image/gif',
  svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff', avif: 'image/avif', heic: 'image/heic',
  pdf: 'application/pdf', json: 'application/json', zip: 'application/zip', glb: 'model/gltf-binary',
  kova: 'application/json', psd: 'image/vnd.adobe.photoshop', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
  mp4: 'video/mp4', webm: 'video/webm',
};

/** '.kova,image/*' → ['kova', 'png', 'jpg', …] (vacío = sin filtro). */
export function acceptToExtensions(accept: string): string[] {
  const out = new Set<string>();
  for (const raw of accept.split(',')) {
    const a = raw.trim().toLowerCase();
    if (!a) continue;
    if (a.startsWith('.')) out.add(a.slice(1));
    else (MIME_EXT[a] ?? []).forEach(e => out.add(e));
  }
  return [...out];
}

const baseName = (p: string) => p.split(/[\\/]/).pop() || p;
const extOf = (n: string) => (n.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '');
export const mimeOf = (name: string) => EXT_MIME[extOf(name)] ?? '';

async function openFiles({ multiple = true, accept = '' }: OpenFilesOptions = {}): Promise<File[]> {
  const extensions = acceptToExtensions(accept);
  const picked = await open({ multiple, directory: false, ...(extensions.length ? { filters: [{ name: 'Archivos compatibles', extensions }] } : {}) });
  if (!picked) return [];
  const paths = Array.isArray(picked) ? picked : [picked];
  return Promise.all(paths.map(async p => {
    const name = baseName(p);
    return new File([await readFile(p)], name, { type: mimeOf(name) });
  }));
}

async function saveFile(blob: Blob, o: SaveFileOptions): Promise<SaveResult> {
  // «Guardar» con destino conocido escribe sin preguntar; todo lo demás pasa por el diálogo nativo
  let path = isPathTarget(o.target) ? o.target.path : null;
  if (!path) {
    path = await save({ defaultPath: o.suggestedName, ...(o.filters?.length ? { filters: o.filters.map(f => ({ name: f.name, extensions: f.extensions })) } : {}) });
    if (!path) return { status: 'cancelled' };
  }
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  return { status: 'saved', target: { __saveTarget: true, path } as PathTarget };
}

export const desktopPlatform: PlatformAdapter = {
  kind: 'desktop',
  capabilities: { saveToLocation: true },
  openFiles,
  saveFile,
  // con dragDropEnabled: false en la ventana, WKWebView entrega los archivos como en el navegador
  droppedFiles: dt => Array.from(dt?.files ?? []),
  // WKWebView (wry) no implementa window.confirm(): devolvería «no» sin mostrar nada
  confirm: (message, o) => confirm(message, { title: 'KOVA Design Lab', kind: 'warning', okLabel: o?.okLabel ?? 'Aceptar', cancelLabel: 'Cancelar' }),
  // la ventana nativa no dispara beforeunload: se pregunta al pedir el cierre
  guardClose(shouldWarn) {
    let off: (() => void) | null = null, gone = false;
    getCurrentWindow().onCloseRequested(async e => {
      if (shouldWarn() && !(await desktopPlatform.confirm('Hay cambios sin guardar en un archivo. Se conservan en «Recuperación de sesión», pero ¿cerrar KOVA Design Lab de todos modos?', { okLabel: 'Cerrar' }))) e.preventDefault();
    }).then(u => { if (gone) u(); else off = u; });
    return () => { gone = true; off?.(); };
  },
};
