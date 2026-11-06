// Platform Adapter: única puerta de la app hacia el sistema de archivos.
// Ningún módulo usa directamente <input type=file>, descargas, File System Access ni APIs nativas:
// todo pasa por aquí. Web hoy; escritorio (Tauri 2, plugins dialog y fs) en la fase 8.

export type PlatformKind = 'web' | 'desktop';

/** Destino de guardado reutilizable (opaco para la app): permite «Guardar» sin volver a preguntar. */
export type SaveTarget = { readonly __saveTarget: true } & object;

export interface FileFilter {
  /** Texto que ve el usuario, p. ej. «Proyecto Kova». */
  name: string;
  /** Extensiones sin punto: ['kova']. */
  extensions: string[];
  /** Tipo MIME asociado (lo usa el selector del navegador). */
  mime?: string;
}

export interface OpenFilesOptions {
  multiple?: boolean;
  /** Filtro estilo atributo `accept` de HTML: '.kova,image/*'. */
  accept?: string;
}

export interface SaveFileOptions {
  suggestedName: string;
  /** Mostrar el selector nativo para elegir ubicación si la plataforma lo permite. */
  pick?: boolean;
  /** Destino de un guardado anterior: se sobrescribe sin preguntar. */
  target?: SaveTarget | null;
  filters?: FileFilter[];
}

export type SaveResult =
  | { status: 'saved'; target: SaveTarget }   // escrito en una ubicación elegida (reutilizable)
  | { status: 'downloaded' }                  // entregado como descarga del navegador
  | { status: 'cancelled' };                  // el usuario cerró el selector

export interface PlatformCapabilities {
  /** Puede escribir en una ubicación elegida y volver a guardar en ella. */
  saveToLocation: boolean;
}

export interface PlatformAdapter {
  readonly kind: PlatformKind;
  readonly capabilities: PlatformCapabilities;
  /** Pide archivos al usuario. Devuelve [] si cancela. */
  openFiles(o?: OpenFilesOptions): Promise<File[]>;
  /** Guarda o descarga un archivo. */
  saveFile(data: Blob, o: SaveFileOptions): Promise<SaveResult>;
  /** Archivos soltados en un evento de arrastrar (Finder / escritorio). */
  droppedFiles(dt: DataTransfer | null): File[];
}
