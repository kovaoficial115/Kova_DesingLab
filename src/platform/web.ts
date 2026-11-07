// Implementación web del Platform Adapter: selector de archivos, File System Access donde exista
// (Chrome/Edge) y descarga como respaldo (Safari, Firefox).
import type { PlatformAdapter, SaveFileOptions, SaveResult, SaveTarget } from './types';

function download(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

const hasSavePicker = () => typeof window !== 'undefined' && 'showSaveFilePicker' in window;

async function writeHandle(handle: any, blob: Blob) {
  const w = await handle.createWritable();
  await w.write(blob);
  await w.close();
}

async function saveFile(blob: Blob, o: SaveFileOptions): Promise<SaveResult> {
  if (hasSavePicker() && (o.pick || o.target)) {
    try {
      let handle: any = o.target ?? null;
      if (!handle) {
        const types = o.filters?.map(f => ({ description: f.name, accept: { [f.mime || 'application/octet-stream']: f.extensions.map(e => '.' + e) } }));
        handle = await (window as any).showSaveFilePicker({ suggestedName: o.suggestedName, ...(types ? { types } : {}) });
      }
      await writeHandle(handle, blob);
      return { status: 'saved', target: handle as SaveTarget };
    } catch (e: any) {
      if (e?.name === 'AbortError') return { status: 'cancelled' };
      // permiso revocado u otro fallo del selector: se entrega como descarga
    }
  }
  download(blob, o.suggestedName);
  return { status: 'downloaded' };
}

function openFiles({ multiple = true, accept = '' } = {}): Promise<File[]> {
  return new Promise(res => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.multiple = multiple;
    inp.onchange = () => res(Array.from(inp.files || []));
    inp.addEventListener('cancel', () => res([]));
    inp.click();
  });
}

export const webPlatform: PlatformAdapter = {
  kind: 'web',
  capabilities: { get saveToLocation() { return hasSavePicker(); } },
  openFiles,
  saveFile,
  droppedFiles: dt => Array.from(dt?.files ?? []),
  confirm: async message => window.confirm(message),
  guardClose(shouldWarn) {
    const before = (e: BeforeUnloadEvent) => { if (shouldWarn()) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  },
};
