// Operaciones sobre toda la biblioteca: exportar todos los proyectos, importar una copia
// y gestionar las copias de respaldo.

import { storage, sha256 } from '../storage';
import { platform } from '../platform';
import { buildArchive, readArchive, type ArchiveEntry } from './archive';
import { parseKova } from './kova';
import { deserializeDoc, saveToLibrary } from './project';
import { uid } from '../core/util';

const stamp = () => new Date().toISOString().slice(0, 10);

/** Todos los proyectos de la biblioteca local en un .zip. Devuelve cuántos se exportaron (null si se canceló). */
export async function exportAllProjects(): Promise<number | null> {
  const metas = await storage.projects.list();
  if (!metas.length) return 0;
  const entries: ArchiveEntry[] = [];
  for (const m of metas) {
    const rec = await storage.projects.get(m.id);
    if (rec) entries.push({ id: rec.id, name: rec.name, updated: rec.updated, data: rec.data });
  }
  const zip = buildArchive(entries);
  const r = await platform.saveFile(new Blob([zip], { type: 'application/zip' }), {
    suggestedName: `kova-proyectos-${stamp()}.zip`, pick: true,
    filters: [{ name: 'Copia de proyectos KOVA', extensions: ['zip'], mime: 'application/zip' }],
  });
  return r.status === 'cancelled' ? null : entries.length;
}

export interface ImportReport { added: number; skipped: number; copies: number; failed: { name: string; error: string }[] }

/** Importa un .zip de proyectos a la biblioteca. Nunca sobrescribe: si ya existe un proyecto
 *  distinto con el mismo id, se importa como copia. */
export async function importProjectsArchive(file: File): Promise<ImportReport> {
  const { entries } = readArchive(new Uint8Array(await file.arrayBuffer()));
  const report: ImportReport = { added: 0, skipped: 0, copies: 0, failed: [] };
  for (const e of entries) {
    try {
      parseKova(e.data); // valida antes de tocar nada
      const doc = await deserializeDoc(e.data);
      const existing = await storage.projects.get(doc.id).catch(() => undefined);
      if (existing) {
        if (existing.data === e.data || (existing.hash && existing.hash === await sha256(e.data))) { report.skipped++; continue; }
        doc.id = uid('doc');
        doc.name = `${doc.name} (importado)`;
        report.copies++;
      }
      await saveToLibrary(doc);
      report.added++;
    } catch (err) {
      report.failed.push({ name: e.name, error: (err as Error).message });
    }
  }
  return report;
}

export const reasonLabel = (r: string) => (r === 'pre-migration' ? 'Antes de actualizar el formato' : 'Versión anterior');
