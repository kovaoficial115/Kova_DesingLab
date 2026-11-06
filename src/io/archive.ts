// Copia de todos los proyectos en un solo .zip (funciones puras, sin DOM).
// Sirve como copia de seguridad y para pasar los proyectos de la web a la app de escritorio,
// que no puede leer el almacenamiento del navegador.

import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';

export const ARCHIVE_FORMAT = 'kova-designlab-archive';
export const ARCHIVE_VERSION = 1;

export interface ArchiveEntry { id: string; name: string; updated: number; data: string }
export interface ArchiveManifest {
  format: typeof ARCHIVE_FORMAT;
  version: number;
  created: number;
  projects: { id: string; name: string; updated: number; file: string }[];
}

const safe = (s: string) => s.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().slice(0, 80) || 'proyecto';

export function buildArchive(entries: ArchiveEntry[], created = Date.now()): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  const projects: ArchiveManifest['projects'] = [];
  for (const e of entries) {
    let file = `proyectos/${safe(e.name)}.kova`;
    for (let i = 2; used.has(file); i++) file = `proyectos/${safe(e.name)} (${i}).kova`;
    used.add(file);
    files[file] = strToU8(e.data);
    projects.push({ id: e.id, name: e.name, updated: e.updated, file });
  }
  const manifest: ArchiveManifest = { format: ARCHIVE_FORMAT, version: ARCHIVE_VERSION, created, projects };
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  // los PNG embebidos ya están comprimidos: nivel bajo para no gastar tiempo
  return zipSync(files, { level: 1 });
}

/** Lee un .zip de proyectos (con o sin manifest: también vale un zip con .kova sueltos). */
export function readArchive(bytes: Uint8Array): { entries: ArchiveEntry[]; manifest: ArchiveManifest | null } {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes); } catch { throw new Error('El archivo no es un .zip válido.'); }
  let manifest: ArchiveManifest | null = null;
  if (files['manifest.json']) {
    try {
      const m = JSON.parse(strFromU8(files['manifest.json']));
      if (m?.format === ARCHIVE_FORMAT) manifest = m;
    } catch { /* manifest dañado: se usan los .kova que haya */ }
  }
  const byFile = new Map(manifest?.projects.map(p => [p.file, p]) ?? []);
  const entries: ArchiveEntry[] = [];
  for (const [path, data] of Object.entries(files)) {
    if (!path.toLowerCase().endsWith('.kova') || path.includes('__MACOSX/')) continue;
    const m = byFile.get(path);
    const name = m?.name ?? path.split('/').pop()!.replace(/\.kova$/i, '');
    entries.push({ id: m?.id ?? '', name, updated: m?.updated ?? 0, data: strFromU8(data) });
  }
  return { entries, manifest };
}
