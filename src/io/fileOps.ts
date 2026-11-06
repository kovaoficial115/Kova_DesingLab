import { importFile, svgLayerFrom, ACCEPT, type ImportResult } from './importers';
import { deserializeDoc, saveProjectFile, saveToLibrary, deleteFromLibrary, listLibrary } from './project';
import { newDoc, rasterLayer, fitIn, vectorLayer } from '../core/doc';
import { addDoc, insertLayers, addImageLayer } from '../core/actions';
import { activeDoc, activeArtboard, get, set, toast, withBusy } from '../core/store';
import { newArtboard } from '../core/doc';
import type { Doc, Layer } from '../core/types';
import { debounce } from '../core/util';
import { platform } from '../platform';

/** Pide archivos al usuario (por defecto, todo lo que la app sabe abrir). */
export function pickFiles(multiple = true, accept = ACCEPT): Promise<File[]> {
  return platform.openFiles({ multiple, accept });
}

function docFromImport(r: ImportResult): Doc | null {
  const dpi = ('dpi' in r && r.dpi) || 300;
  if (r.kind === 'raster') {
    const d = newDoc(r.name, r.canvas.width, r.canvas.height, dpi);
    const l = rasterLayer(r.canvas, r.name, 0, 0);
    d.state = { ...d.state, layers: [l], selectedLayerIds: [l.id] };
    return d;
  }
  if (r.kind === 'vector') {
    const d = newDoc(r.name, r.w * (r.dpi ? 300 / r.dpi : 1), r.h * (r.dpi ? 300 / r.dpi : 1), 300);
    const l = svgLayerFrom(r, 300);
    d.state = { ...d.state, layers: [l], selectedLayerIds: [l.id] };
    return d;
  }
  if (r.kind === 'layers') {
    const d = newDoc(r.name, r.w, r.h, dpi);
    d.state = { ...d.state, layers: r.layers, selectedLayerIds: r.layers.length ? [r.layers[r.layers.length - 1].id] : [] };
    return d;
  }
  if (r.kind === 'pages') {
    const d = newDoc(r.name, r.pages[0].width, r.pages[0].height, r.dpi);
    const artboards = r.pages.map((p, i) => i === 0 ? d.state.artboards[0] : newArtboard(p.width, p.height, r.dpi, `Página ${i + 1}`, i * (r.pages[0].width + 200), 0));
    artboards[0] = { ...artboards[0], name: 'Página 1' };
    const layers: Layer[] = r.pages.map((p, i) => rasterLayer(p, `Página ${i + 1}`, artboards[i].x, artboards[i].y));
    d.state = { ...d.state, artboards, layers, selectedLayerIds: [layers[0].id] };
    return d;
  }
  return null;
}

/** Abre archivos como documentos nuevos. */
export async function openFiles(files: File[]) {
  for (const f of files) {
    await withBusy(`Abriendo ${f.name}…`, async () => {
      const r = await importFile(f);
      if (r.kind === 'project') {
        const doc = await deserializeDoc(await r.file.text());
        if (get().docs.some(d => d.id === doc.id)) doc.id = doc.id + '_' + Date.now().toString(36);
        addDoc(doc);
        return;
      }
      const d = docFromImport(r);
      if (d) addDoc(d);
      if (r.kind === 'raster' && !r.dpi) toast(`${f.name}: sin DPI en el archivo, se asumió 300 ppp`, 'info');
    });
  }
}

/** Coloca archivos como capas en el documento activo (o abre uno nuevo si no hay). */
export async function placeFiles(files: File[], at?: { x: number; y: number }) {
  if (!activeDoc()) return openFiles(files);
  const ab = activeArtboard()!;
  for (const f of files) {
    await withBusy(`Colocando ${f.name}…`, async () => {
      const r = await importFile(f, { pdfDpi: ab.dpi });
      if (r.kind === 'project') return openFiles([f]);
      if (r.kind === 'raster') {
        // conservar tamaño físico si el archivo trae DPI
        const s = r.dpi ? ab.dpi / r.dpi : 1;
        let l = rasterLayer(r.canvas, r.name);
        l = { ...l, scaleX: s, scaleY: s };
        l = fitIn(l, ab);
        if (at) l = { ...l, x: at.x - (r.canvas.width * l.scaleX) / 2, y: at.y - (r.canvas.height * l.scaleY) / 2 };
        insertLayers([l], 'Colocar imagen');
      } else if (r.kind === 'vector') {
        insertLayers([fitIn(svgLayerFrom(r, ab.dpi), ab)], 'Colocar SVG');
      } else if (r.kind === 'layers') {
        const ox = ab.x, oy = ab.y;
        insertLayers(r.layers.map(l => ({ ...l, x: l.x + ox, y: l.y + oy })), 'Colocar PSD');
      } else if (r.kind === 'pages') {
        insertLayers(r.pages.map((p, i) => fitIn(rasterLayer(p, `${r.name} p${i + 1}`), ab)), 'Colocar PDF');
      }
    });
  }
}

export async function pasteImageBlob(blob: Blob) {
  const { blobToCanvas } = await import('../core/util');
  const c = await blobToCanvas(blob);
  if (!activeDoc()) {
    const d = docFromImport({ kind: 'raster', name: 'Pegado', canvas: c, dpi: 300 });
    if (d) addDoc(d);
    return;
  }
  addImageLayer(c, 'Pegado', { fit: false });
}

export function pasteSvgText(svg: string) {
  const ab = activeArtboard();
  if (!ab) return;
  import('./importers').then(m => {
    const r = m.importSvg(svg, 'SVG pegado');
    if (r.kind === 'vector') insertLayers([fitIn(vectorLayer(r.svg, r.w, r.h, r.name), ab)], 'Pegar SVG');
  });
}

export async function saveProject(saveAs = false) {
  const d = activeDoc();
  if (!d) return;
  await withBusy('Guardando proyecto…', async () => {
    const handle = await saveProjectFile(d, saveAs);
    if (handle === null) return;
    await saveToLibrary(d);
    set(s => ({ docs: s.docs.map(x => (x.id === d.id ? { ...x, dirty: false, fileHandle: handle || x.fileHandle } : x)) }));
    await deleteFromLibrary(d.id, 'autosave');
    toast('Proyecto guardado', 'ok');
  });
}
export async function saveToBrowserLibrary() {
  const d = activeDoc();
  if (!d) return;
  await withBusy('Guardando en la biblioteca…', async () => {
    await saveToLibrary(d);
    set(s => ({ docs: s.docs.map(x => (x.id === d.id ? { ...x, dirty: false } : x)) }));
    toast('Guardado en la biblioteca local', 'ok');
  });
}

// ---------- guardado automático ----------
let autosaveRunning = false;
const autosave = debounce(async () => {
  if (autosaveRunning) return;
  autosaveRunning = true;
  try {
    // los documentos compartidos se guardan en Liveblocks
    for (const d of get().docs) if (d.dirty && !d.collab) await saveToLibrary(d, 'autosave');
  } catch (e) { console.warn('Autoguardado falló', e); }
  autosaveRunning = false;
}, 4000);

export function startAutosave() {
  let prevDocs = get().docs;
  return import('../core/store').then(({ useStore }) => useStore.subscribe(s => {
    if (s.docs !== prevDocs) { prevDocs = s.docs; autosave(); }
  }));
}
export async function discardAutosave(id: string) { await deleteFromLibrary(id, 'autosave'); }
export async function listRecovery() {
  try { return await listLibrary('autosave'); } catch { return []; }
}
