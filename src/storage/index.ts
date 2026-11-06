// Motor de almacenamiento del navegador (IndexedDB). Implementa StorageEngine.
//
// Base `kova-designlab`:
//   v1  projects, autosave                 (existían antes de la fase 3; no se tocan)
//   v2  assets   (archivos por hash SHA-256, índice por tipo)
//       backups  (copias antes de migrar o sobrescribir, índice por proyecto)
//       meta     (versión de esquema y registro de migraciones)
// Base `kova-fonts` (v1): tipografías del usuario. Se mantiene aparte para no mover datos.

import { openDb, req, run, latestVersion, type DbSchema } from './idb';
import { sha256 } from './hash';
import { IntegrityError } from './types';
import type {
  StorageEngine, ProjectBucket, ProjectRecord, ProjectMeta, AssetRecord, AssetMeta, AssetType,
  BackupRecord, BackupMeta, FontRecord, StorageEstimate,
} from './types';

export * from './types';
export { sha256 } from './hash';

let blockedHandler: (() => void) | null = null;
/** La app muestra un aviso si otra pestaña antigua bloquea la actualización de la base. */
export function onStorageBlocked(fn: () => void) { blockedHandler = fn; }

export const MAIN_DB: DbSchema = {
  name: 'kova-designlab',
  onBlocked: () => blockedHandler?.(),
  migrations: {
    1: db => {
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('autosave')) db.createObjectStore('autosave', { keyPath: 'id' });
    },
    2: (db, tx) => {
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'hash' }).createIndex('type', 'type');
      if (!db.objectStoreNames.contains('backups')) db.createObjectStore('backups', { keyPath: 'key' }).createIndex('id', 'id');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      tx.objectStore('meta').put({ key: 'migration:2', at: Date.now(), note: 'Almacenes de activos, copias de respaldo y metadatos' });
    },
  },
};

const FONTS_DB: DbSchema = {
  name: 'kova-fonts',
  migrations: { 1: db => { if (!db.objectStoreNames.contains('fonts')) db.createObjectStore('fonts', { keyPath: 'id' }); } },
};

const stripData = <T extends { data: unknown }>({ data: _d, ...m }: T) => m;
const stripBlob = ({ blob: _b, ...m }: AssetRecord): AssetMeta => m;

const backups = {
  async list(id?: string): Promise<BackupMeta[]> {
    const all = await run(MAIN_DB, 'backups', 'readonly', tx => {
      const s = tx.objectStore('backups');
      return req<BackupRecord[]>(id ? s.index('id').getAll(id) : s.getAll());
    });
    return all.map(stripData).sort((a, b) => b.created - a.created);
  },
  get: (key: string) => run(MAIN_DB, 'backups', 'readonly', tx => req<BackupRecord | undefined>(tx.objectStore('backups').get(key))),
  async put(rec: BackupRecord, keepExisting = false) {
    await run(MAIN_DB, 'backups', 'readwrite', async tx => {
      const s = tx.objectStore('backups');
      if (keepExisting && await req(s.getKey(rec.key)) !== undefined) return;
      await req(s.put(rec));
    });
  },
  delete: async (key: string) => { await run(MAIN_DB, 'backups', 'readwrite', tx => req(tx.objectStore('backups').delete(key))); },
};

const projects = {
  async list(bucket: ProjectBucket = 'projects'): Promise<ProjectMeta[]> {
    const all = await run(MAIN_DB, bucket, 'readonly', tx => req<ProjectRecord[]>(tx.objectStore(bucket).getAll()));
    return all.map(stripData).sort((a, b) => b.updated - a.updated);
  },
  async get(id: string, bucket: ProjectBucket = 'projects'): Promise<ProjectRecord | undefined> {
    const rec = await run(MAIN_DB, bucket, 'readonly', tx => req<ProjectRecord | undefined>(tx.objectStore(bucket).get(id)));
    if (!rec || !rec.hash || await sha256(rec.data) === rec.hash) return rec;
    // contenido dañado: se intenta la copia anterior
    const prev = bucket === 'projects' ? await backups.get(`${id}:previous`) : undefined;
    if (prev) return { ...rec, data: prev.data, schema: prev.schema, hash: undefined };
    throw new IntegrityError(`El proyecto «${rec.name}» está dañado y no tiene copia de respaldo.`);
  },
  async put(input: Omit<ProjectRecord, 'hash'>, bucket: ProjectBucket = 'projects'): Promise<ProjectRecord> {
    const rec: ProjectRecord = { ...input, hash: await sha256(input.data) };
    await run(MAIN_DB, bucket === 'projects' ? ['projects', 'backups'] : bucket, 'readwrite', async tx => {
      if (bucket === 'projects') {
        // la versión que se va a sobrescribir queda como copia «anterior»
        const old = await req<ProjectRecord | undefined>(tx.objectStore('projects').get(rec.id));
        if (old && old.data !== rec.data) {
          await req(tx.objectStore('backups').put({ key: `${old.id}:previous`, id: old.id, name: old.name, reason: 'previous', created: old.updated, schema: old.schema ?? 1, data: old.data } satisfies BackupRecord));
        }
      }
      await req(tx.objectStore(bucket).put(rec));
    });
    return rec;
  },
  async delete(id: string, bucket: ProjectBucket = 'projects') {
    await run(MAIN_DB, bucket, 'readwrite', tx => req(tx.objectStore(bucket).delete(id)));
  },
};

const assets = {
  async put(blob: Blob, info: { type: AssetType; name: string; meta?: Record<string, unknown> }): Promise<AssetMeta> {
    const hash = await sha256(blob);
    return run(MAIN_DB, 'assets', 'readwrite', async tx => {
      const s = tx.objectStore('assets');
      const existing = await req<AssetRecord | undefined>(s.get(hash));
      if (existing) return stripBlob(existing);
      const rec: AssetRecord = { hash, type: info.type, name: info.name, mime: blob.type || 'application/octet-stream', size: blob.size, created: Date.now(), meta: info.meta, blob };
      await req(s.put(rec));
      return stripBlob(rec);
    });
  },
  async get(hash: string) {
    const rec = await run(MAIN_DB, 'assets', 'readonly', tx => req<AssetRecord | undefined>(tx.objectStore('assets').get(hash)));
    if (rec && await sha256(rec.blob) !== rec.hash) throw new IntegrityError(`El archivo «${rec.name}» de la biblioteca está dañado.`);
    return rec;
  },
  async list(type?: AssetType): Promise<AssetMeta[]> {
    const all = await run(MAIN_DB, 'assets', 'readonly', tx => {
      const s = tx.objectStore('assets');
      return req<AssetRecord[]>(type ? s.index('type').getAll(type) : s.getAll());
    });
    return all.map(stripBlob).sort((a, b) => b.created - a.created);
  },
  delete: async (hash: string) => { await run(MAIN_DB, 'assets', 'readwrite', tx => req(tx.objectStore('assets').delete(hash))); },
};

const fonts = {
  all: () => run(FONTS_DB, 'fonts', 'readonly', tx => req<FontRecord[]>(tx.objectStore('fonts').getAll())),
  put: async (f: FontRecord) => { await run(FONTS_DB, 'fonts', 'readwrite', tx => req(tx.objectStore('fonts').put(f))); },
  delete: async (id: string) => { await run(FONTS_DB, 'fonts', 'readwrite', tx => req(tx.objectStore('fonts').delete(id))); },
};

export const storage: StorageEngine = {
  projects, assets, backups, fonts,
  schemaVersion: latestVersion(MAIN_DB),
  async estimate(): Promise<StorageEstimate | null> {
    if (!navigator.storage?.estimate) return null;
    const e = await navigator.storage.estimate();
    return { usage: e.usage ?? 0, quota: e.quota ?? 0, persisted: (await navigator.storage.persisted?.()) ?? false };
  },
  async persist() {
    try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
  },
};

/** Abre la base al iniciar para aplicar migraciones pendientes cuanto antes. */
export const initStorage = () => openDb(MAIN_DB).then(() => undefined);
