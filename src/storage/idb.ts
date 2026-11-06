// Acceso a IndexedDB con migraciones versionadas. Cada migración solo AÑADE almacenes o índices:
// nunca borra ni reescribe datos existentes, así una base antigua se abre sin pérdidas.

export type Migration = (db: IDBDatabase, tx: IDBTransaction) => void;

export interface DbSchema {
  name: string;
  /** migrations[n] lleva la base de la versión n-1 a la n (la 1 crea la base). */
  migrations: Record<number, Migration>;
  onBlocked?: () => void;
}

export const latestVersion = (s: DbSchema) => Math.max(...Object.keys(s.migrations).map(Number));

const connections = new Map<string, Promise<IDBDatabase>>();

/** Conexión única por base (antes se abría una por operación). */
export function openDb(schema: DbSchema): Promise<IDBDatabase> {
  let p = connections.get(schema.name);
  if (p) return p;
  p = new Promise<IDBDatabase>((resolve, reject) => {
    const version = latestVersion(schema);
    const r = indexedDB.open(schema.name, version);
    r.onupgradeneeded = e => {
      const db = r.result, tx = r.transaction!;
      for (let v = e.oldVersion + 1; v <= version; v++) schema.migrations[v]?.(db, tx);
    };
    r.onblocked = () => schema.onBlocked?.();
    r.onsuccess = () => {
      const db = r.result;
      // otra pestaña con una versión más nueva pide actualizar: cerrar para no bloquearla
      db.onversionchange = () => { db.close(); connections.delete(schema.name); };
      db.onclose = () => connections.delete(schema.name);
      resolve(db);
    };
    r.onerror = () => { connections.delete(schema.name); reject(r.error); };
  });
  connections.set(schema.name, p);
  return p;
}

export function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

/** Ejecuta `fn` en una transacción y espera a que se confirme (no solo a que acabe la petición). */
export async function run<T>(schema: DbSchema, stores: string | string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => Promise<T> | T): Promise<T> {
  const db = await openDb(schema);
  const tx = db.transaction(stores, mode);
  const done = new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error ?? new Error('Transacción cancelada')); });
  const out = await fn(tx);
  await done;
  return out;
}
