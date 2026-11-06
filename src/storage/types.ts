// Interfaz común de almacenamiento. Los módulos de la app usan `storage` (src/storage) y no
// saben qué motor hay debajo: hoy IndexedDB en el navegador; en escritorio, archivos en disco
// a través del Platform Adapter con IndexedDB como caché (fase 8).

export type ProjectBucket = 'projects' | 'autosave';

/** Proyecto guardado en la biblioteca local (el .kova completo como texto + metadatos). */
export interface ProjectRecord {
  id: string;
  name: string;
  updated: number;
  thumb: string;
  w: number;
  h: number;
  dpi: number;
  size: number;
  data: string;
  /** SHA-256 de `data` para validar la integridad al leer (registros antiguos no lo tienen). */
  hash?: string;
  /** versión de esquema .kova de `data` (registros antiguos: 1). */
  schema?: number;
}
export type ProjectMeta = Omit<ProjectRecord, 'data'>;

export type AssetType = 'model' | 'texture' | 'image' | 'thumbnail' | 'material' | 'garment' | 'other';

/** Archivo binario de la biblioteca de activos, deduplicado por su hash SHA-256. */
export interface AssetRecord {
  hash: string;
  type: AssetType;
  name: string;
  mime: string;
  size: number;
  created: number;
  meta?: Record<string, unknown>;
  blob: Blob;
}
export type AssetMeta = Omit<AssetRecord, 'blob'>;

export type BackupReason = 'pre-migration' | 'previous';
/** Copia de respaldo de un proyecto (antes de migrar su formato o antes de sobrescribirlo). */
export interface BackupRecord {
  key: string;
  id: string;
  name: string;
  reason: BackupReason;
  created: number;
  schema: number;
  data: string;
}
export type BackupMeta = Omit<BackupRecord, 'data'>;

export interface FontRecord {
  id: string;
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  format: 'truetype' | 'opentype' | 'woff' | 'woff2';
  data: ArrayBuffer;
  source: 'upload' | 'google' | 'fontsource' | 'project';
  license?: string;
  added: number;
}

export interface ProjectStore {
  list(bucket?: ProjectBucket): Promise<ProjectMeta[]>;
  /** Lee y valida el registro; si está dañado intenta su copia anterior. */
  get(id: string, bucket?: ProjectBucket): Promise<ProjectRecord | undefined>;
  put(rec: Omit<ProjectRecord, 'hash'>, bucket?: ProjectBucket): Promise<ProjectRecord>;
  delete(id: string, bucket?: ProjectBucket): Promise<void>;
}

export interface AssetStore {
  /** Guarda un archivo; si ya existe uno idéntico (mismo hash) devuelve el existente. */
  put(blob: Blob, info: { type: AssetType; name: string; meta?: Record<string, unknown> }): Promise<AssetMeta>;
  get(hash: string): Promise<AssetRecord | undefined>;
  list(type?: AssetType): Promise<AssetMeta[]>;
  delete(hash: string): Promise<void>;
}

export interface BackupStore {
  list(id?: string): Promise<BackupMeta[]>;
  get(key: string): Promise<BackupRecord | undefined>;
  /** Guarda una copia; con `keepExisting` no reemplaza una copia previa con la misma clave. */
  put(rec: BackupRecord, keepExisting?: boolean): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface FontStore {
  all(): Promise<FontRecord[]>;
  put(f: FontRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface StorageEstimate { usage: number; quota: number; persisted: boolean }

export interface StorageEngine {
  readonly projects: ProjectStore;
  readonly assets: AssetStore;
  readonly backups: BackupStore;
  readonly fonts: FontStore;
  /** Versión del esquema de la base de datos local. */
  readonly schemaVersion: number;
  estimate(): Promise<StorageEstimate | null>;
  /** Pide al navegador que no borre los datos ante falta de espacio. */
  persist(): Promise<boolean>;
}

/** Error de integridad: el registro existe pero su contenido no coincide con su hash. */
export class IntegrityError extends Error {
  constructor(message: string) { super(message); this.name = 'IntegrityError'; }
}
