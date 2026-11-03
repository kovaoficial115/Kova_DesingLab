// Motor de sincronización entre el estado del editor (zustand, inmutable) y Liveblocks Storage.
//
// · Local → remoto: en cada fotograma con cambios se compara el documento con una «sombra»
//   (la última versión sincronizada de cada capa / mesa / guía) y solo se escriben las
//   propiedades que cambiaron. Los bitmaps se suben una vez como LiveFile.
// · Remoto → local: al cambiar Storage se reconstruyen solo los elementos cuyo JSON difiere de
//   la sombra; si hay un cambio local aún sin enviar en ese elemento, se conserva.
// · Deshacer/rehacer usan el historial de Liveblocks, que solo deshace los cambios propios.
//   Los arrastres y trazos se agrupan con history.pause()/resume().
// · Zoom, desplazamiento, selección de píxeles, capa seleccionada y mesa activa son locales.

import { LiveFile, LiveMap, LiveObject, type Room } from '@liveblocks/client';
import { generateNKeysBetween } from 'fractional-indexing';
import { useStore, get, set, patchRemote, isLive, collabHooks, toast, type AppState } from '../core/store';
import type { Artboard, CollabInfo, Doc, Guide, Layer } from '../core/types';
import { createCanvas, canvasToBlob, blobToCanvas } from '../core/util';
import { fontsForFamilies, installFontData, listFonts, type FontFormat, type StoredFont } from '../io/fonts';
import { thumbnail } from '../io/project';
import * as api from './api';
import {
  type FileRef, type LayerJSON, type Presence, type VersionJSON,
  readObject, toLsonObject, diff, isFileRef,
} from './schema';

type AnyRoom = Room<any, any, any, any>;
type Shadow<T> = { ref: T | null; json: any };
const INLINE_SVG = 60_000; // los SVG más grandes se guardan como archivo
const AUTO_VERSION_MS = 10 * 60_000;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const clone = <T>(v: T): T => (v == null ? v : JSON.parse(JSON.stringify(v)));

const ACTIVITY: Record<string, string> = {
  move: 'Moviendo', brush: 'Pintando', eraser: 'Borrando', restore: 'Restaurando', text: 'Escribiendo',
  shape: 'Dibujando una forma', crop: 'Recortando', gradient: 'Aplicando un degradado', fill: 'Rellenando',
  artboard: 'Editando mesas', marquee: 'Seleccionando', ellipseMarquee: 'Seleccionando', lasso: 'Seleccionando', wand: 'Seleccionando',
};

// ---------- información observable para la interfaz ----------
export interface SessionInfo { pendingUp: number; pendingDown: number; canUndo: boolean; canRedo: boolean; canWrite: boolean; lastSync: number }
const infoListeners = new Set<() => void>();
export const subscribeSessions = (f: () => void) => { infoListeners.add(f); return () => { infoListeners.delete(f); }; };
const emitInfo = () => infoListeners.forEach(f => f());

// ---------- archivos (bitmaps, SVG, tipografías) ----------
class AssetStore {
  readonly refs = new WeakMap<HTMLCanvasElement, FileRef>();
  private uploads = new WeakMap<HTMLCanvasElement, Promise<FileRef>>();
  private loaded = new Map<string, HTMLCanvasElement>();
  private placeholders = new Map<string, HTMLCanvasElement>();
  private loading = new Set<string>();
  private textRefs = new Map<string, FileRef>();
  private textUploads = new Map<string, Promise<FileRef>>();
  readonly textLoaded = new Map<string, string>();
  private fontUploads = new Map<string, Promise<FileRef>>();
  private fontRefs = new Map<string, FileRef>();
  inflight = new Set<Promise<unknown>>();
  pendingUp = 0;
  pendingDown = 0;
  constructor(private s: CollabSession) {}

  private track<T>(p: Promise<T>, dir: 'up' | 'down') {
    if (dir === 'up') this.pendingUp++; else this.pendingDown++;
    this.s.emit();
    this.inflight.add(p);
    p.finally(() => { this.inflight.delete(p); if (dir === 'up') this.pendingUp--; else this.pendingDown--; this.s.emit(); }).catch(() => {});
    return p;
  }

  /** Referencia del bitmap, o null si aún hay que subirlo (la promesa se añade a `waits`). */
  need(c: HTMLCanvasElement, waits: Promise<unknown>[]): FileRef | null {
    const r = this.refs.get(c);
    if (r) return r;
    let p = this.uploads.get(c);
    if (!p) {
      p = this.track((async () => {
        const blob = await canvasToBlob(c, 'image/png');
        const ref = await this.s.upload(blob, 'capa.png');
        this.refs.set(c, ref);
        this.loaded.set(ref.id, c);
        return ref;
      })(), 'up');
      p.catch(() => this.uploads.delete(c));
      this.uploads.set(c, p);
    }
    waits.push(p);
    return null;
  }
  needText(svg: string, waits: Promise<unknown>[]): FileRef | null {
    const r = this.textRefs.get(svg);
    if (r) return r;
    let p = this.textUploads.get(svg);
    if (!p) {
      p = this.track(this.s.upload(new Blob([svg], { type: 'image/svg+xml' }), 'vector.svg').then(ref => { this.textRefs.set(svg, ref); this.textLoaded.set(ref.id, svg); this.textUploads.delete(svg); return ref; }), 'up');
      p.catch(() => this.textUploads.delete(svg));
      this.textUploads.set(svg, p);
    }
    waits.push(p);
    return null;
  }
  needFont(f: StoredFont, waits: Promise<unknown>[]): FileRef | null {
    const r = this.fontRefs.get(f.id);
    if (r) return r;
    let p = this.fontUploads.get(f.id);
    if (!p) {
      p = this.track(this.s.upload(new Blob([f.data], { type: 'font/' + f.format }), `${f.family}.${f.format}`).then(ref => { this.fontRefs.set(f.id, ref); return ref; }), 'up');
      p.catch(() => this.fontUploads.delete(f.id));
      this.fontUploads.set(f.id, p);
    }
    waits.push(p);
    return null;
  }

  /** Bitmap de un archivo: el real si ya se descargó, si no un marcador del mismo tamaño. */
  canvas(ref: FileRef, w: number, h: number, prev?: HTMLCanvasElement | null): HTMLCanvasElement {
    if (prev && this.refs.get(prev)?.id === ref.id) return prev;
    const got = this.loaded.get(ref.id);
    if (got) return got;
    let ph = this.placeholders.get(ref.id);
    if (!ph) {
      ph = createCanvas(Math.max(1, w), Math.max(1, h));
      this.refs.set(ph, ref);
      this.placeholders.set(ref.id, ph);
    }
    this.load(ref);
    return ph;
  }
  isPlaceholder(c: HTMLCanvasElement | null | undefined) { return !!c && this.placeholders.get(this.refs.get(c)?.id ?? '') === c; }
  real(id: string) { return this.loaded.get(id); }
  text(ref: FileRef): string {
    const got = this.textLoaded.get(ref.id);
    if (got != null) return got;
    const ph = `<svg xmlns="http://www.w3.org/2000/svg" data-kova-pending="${ref.id}"/>`;
    this.textRefs.set(ph, ref);
    if (!this.loading.has(ref.id)) {
      this.loading.add(ref.id);
      this.track(this.fetchBlob(ref).then(b => b.text()).then(t => { this.textRefs.set(t, ref); this.textLoaded.set(ref.id, t); this.s.onAssetLoaded(); }), 'down').catch(e => console.warn(e));
    }
    return ph;
  }
  private load(ref: FileRef) {
    if (this.loading.has(ref.id)) return;
    this.loading.add(ref.id);
    this.track((async () => {
      const c = await blobToCanvas(await this.fetchBlob(ref));
      this.refs.set(c, ref);
      this.loaded.set(ref.id, c);
      this.s.onAssetLoaded();
    })(), 'down').catch(e => { this.loading.delete(ref.id); console.warn('No se pudo descargar', ref.id, e); });
  }
  /** false cuando el almacenamiento de archivos no admite CORS: se descarga vía el servidor. */
  private direct = true;
  async fetchBlob(ref: FileRef): Promise<Blob> {
    let last: unknown;
    for (let i = 0; i < 5; i++) {
      try {
        if (this.direct) {
          const url = await this.s.room.getFileUrl(ref.id);
          let r: Response;
          try { r = await fetch(url); }
          catch (e) { this.direct = false; throw e; } // error de red o CORS → usar el servidor
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return await r.blob();
        }
        return await api.fetchRoomFile(this.s.room.id, ref.id);
      } catch (e) { last = e; if (this.direct) await sleep(800 * (i + 1)); else if (i) await sleep(800 * i); }
    }
    throw last;
  }
}

// ---------- conversión capa ↔ JSON ----------
const SCALARS = ['name', 'kind', 'visible', 'locked', 'opacity', 'blend', 'x', 'y', 'rotation', 'scaleX', 'scaleY', 'parentId', 'clip', 'maskEnabled'] as const;

function layerJSON(l: Layer, a: AssetStore, waits: Promise<unknown>[]): LayerJSON {
  const ref = (c: HTMLCanvasElement) => a.need(c, waits);
  const canvas = l.canvas ? ref(l.canvas) : null;
  const origin = !l.origin ? null : l.origin === l.canvas ? 'same' : ref(l.origin);
  const mask = l.mask ? ref(l.mask) : null;
  let svg: string | null = null, svgFile: FileRef | null = null;
  if (l.vector) { if (l.vector.svg.length <= INLINE_SVG) svg = l.vector.svg; else svgFile = a.needText(l.vector.svg, waits); }
  return {
    name: l.name, kind: l.kind, visible: l.visible, locked: l.locked, opacity: l.opacity, blend: l.blend,
    x: l.x, y: l.y, rotation: l.rotation, scaleX: l.scaleX, scaleY: l.scaleY, parentId: l.parentId ?? null, clip: !!l.clip,
    adjustments: l.adjustments ?? [], maskEnabled: l.maskEnabled !== false,
    text: l.text ?? null, shape: l.shape ?? null,
    vw: l.vector?.w ?? 0, vh: l.vector?.h ?? 0, svg, svgFile,
    canvas, cw: l.canvas?.width ?? 0, ch: l.canvas?.height ?? 0,
    origin, ow: origin && origin !== 'same' ? l.origin!.width : 0, oh: origin && origin !== 'same' ? l.origin!.height : 0,
    mask, mw: l.mask?.width ?? 0, mh: l.mask?.height ?? 0,
    z: '',
  };
}

function layerFromJSON(id: string, j: LayerJSON, a: AssetStore, prev?: Layer, only?: string[]): Layer {
  const L: any = prev ? { ...prev } : { id, collapsed: false };
  const has = (...k: string[]) => !only || k.some(x => only.includes(x));
  for (const k of SCALARS) if (has(k)) L[k] = (j as any)[k];
  if (has('adjustments')) L.adjustments = clone(j.adjustments ?? []);
  if (has('text')) L.text = j.text ? clone(j.text) : undefined;
  if (has('shape')) L.shape = j.shape ? clone(j.shape) : undefined;
  if (has('vw', 'vh', 'svg', 'svgFile', 'kind')) L.vector = j.kind === 'vector' ? { w: j.vw, h: j.vh, svg: j.svg ?? (j.svgFile ? a.text(j.svgFile) : '') } : undefined;
  if (has('canvas', 'cw', 'ch')) L.canvas = j.canvas ? a.canvas(j.canvas, j.cw, j.ch, prev?.canvas) : undefined;
  if (has('origin', 'ow', 'oh', 'canvas')) L.origin = j.origin === 'same' ? L.canvas : isFileRef(j.origin) ? a.canvas(j.origin, j.ow, j.oh, prev?.origin) : undefined;
  if (has('mask', 'mw', 'mh')) L.mask = j.mask ? a.canvas(j.mask, j.mw, j.mh, prev?.mask) : null;
  return L as Layer;
}
function plainFromJSON<T>(id: string, j: any, prev?: T, only?: string[]): T {
  const { z: _z, ...rest } = j;
  if (prev && only) {
    const out: any = { ...prev };
    for (const k of only) if (k !== 'z') out[k] = rest[k];
    return out;
  }
  return { id, ...rest } as T;
}
const artboardJSON = (a: Artboard) => ({ name: a.name, x: a.x, y: a.y, w: a.w, h: a.h, dpi: a.dpi, background: a.background ?? null, margin: a.margin ?? 0, z: '' });
const guideJSON = (g: Guide) => ({ axis: g.axis, pos: g.pos });

/** Claves fraccionarias mínimas para que el orden por `z` coincida con el orden local. */
export function computeZ(ids: string[], cur: (id: string) => string | undefined): Map<string, string> {
  const n = ids.length;
  const zs = ids.map(cur);
  // subsecuencia creciente más larga: esas capas conservan su clave
  const tails: number[] = [];
  const prev = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const z = zs[i];
    if (!z) continue;
    let lo = 0, hi = tails.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (zs[tails[m]]! < z) lo = m + 1; else hi = m; }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const keep = new Set<number>();
  for (let k = tails.length ? tails[tails.length - 1] : -1; k >= 0; k = prev[k]) keep.add(k);
  const out = new Map<string, string>();
  let last: string | null = null;
  for (let i = 0; i < n;) {
    if (keep.has(i)) { last = zs[i]!; i++; continue; }
    let j = i;
    while (j < n && !keep.has(j)) j++;
    const keys = generateNKeysBetween(last, j < n ? zs[j]! : null, j - i);
    for (let t = 0; t < keys.length; t++) out.set(ids[i + t], keys[t]);
    last = keys[keys.length - 1];
    i = j;
  }
  return out;
}

// ---------- sesión por documento ----------
export class CollabSession {
  readonly docId: string;
  readonly room: AnyRoom;
  root: LiveObject<any> | null = null;
  readonly assets: AssetStore;
  info: SessionInfo = { pendingUp: 0, pendingDown: 0, canUndo: false, canRedo: false, canWrite: false, lastSync: 0 };
  private sh = {
    layers: new Map<string, Shadow<Layer>>(), artboards: new Map<string, Shadow<Artboard>>(), guides: new Map<string, Shadow<Guide>>(),
    name: '', colorMode: '',
  };
  private ready = false;
  private disposed = false;
  private paused = false;
  private flushQueued = false;
  private applyQueued = false;
  private raf = 0;
  private unsubs: Array<() => void> = [];
  private fontsSeen = new Set<string>();
  private lastPresence = '';
  private changedSinceVersion = false;
  private versionTimer: any = null;
  private canWrite = false;
  private accessRetry: ReturnType<typeof setInterval> | undefined;

  constructor(docId: string, room: AnyRoom) {
    this.docId = docId;
    this.room = room;
    this.assets = new AssetStore(this);
  }

  doc(): Doc | undefined { return get().docs.find(d => d.id === this.docId); }
  private setCollab(p: Partial<CollabInfo>) {
    set(s => ({ docs: s.docs.map(d => (d.id === this.docId && d.collab ? { ...d, collab: { ...d.collab, ...p } } : d)) }));
  }
  emit() {
    const self = this.room.getSelf();
    if (self) this.canWrite = self.canWrite;
    this.info = {
      pendingUp: this.assets.pendingUp, pendingDown: this.assets.pendingDown,
      canUndo: this.room.history.canUndo(), canRedo: this.room.history.canRedo(), canWrite: this.canWrite, lastSync: this.info.lastSync,
    };
    emitInfo();
  }
  // se lee en vivo: tras un cambio de rol Liveblocks entrega el nuevo `self` después del evento 'status'
  // (sin conexión no hay `self`: vale el último permiso conocido, para poder seguir editando offline)
  get writable() {
    const self = this.room.getSelf();
    return (self ? self.canWrite : this.canWrite) && this.doc()?.collab?.role !== 'viewer';
  }

  async start() {
    try {
      this.setCollab({ status: 'connecting', error: undefined });
      const { root } = await this.room.getStorage();
      if (this.disposed) return;
      this.root = root;
      this.emit();
      this.unsubs.push(
        this.room.subscribe(root, () => this.scheduleApply(), { isDeep: true }),
        useStore.subscribe((s, p) => this.onStore(s, p)),
        this.room.subscribe('history', () => this.emit()),
        // al confirmarse los cambios propios se reconcilia de nuevo (resolución de conflictos)
        this.room.subscribe('storage-status', (st: string) => { if (st === 'synchronized') this.scheduleApply(); this.emit(); }),
        this.room.subscribe('status', () => { this.emit(); this.pushPresence(true); }),
        this.room.events.self.subscribe(() => { const was = this.canWrite; this.emit(); if (this.canWrite !== was) this.scheduleApply(); }),
        this.room.subscribe('event', ({ event }: any) => this.onEvent(event)),
        this.room.subscribe('error', (err: any) => this.onError(err)),
      );
      const meta = root.get('meta') as LiveObject<any> | undefined;
      if (meta?.get('ready')) this.apply(true);
      else if (this.doc()?.collab?.seed && this.room.getSelf()?.canWrite) await this.seed();
      else this.setCollab({ status: 'waiting' });
      this.versionTimer = setInterval(() => this.autoVersion(), AUTO_VERSION_MS);
      this.pushPresence(true);
    } catch (e: any) {
      console.error(e);
      this.setCollab({ status: 'error', error: e?.message || 'No se pudo cargar el documento compartido' });
    }
  }

  dispose() {
    this.disposed = true;
    this.cancelTick();
    clearInterval(this.versionTimer);
    clearInterval(this.accessRetry);
    if (this.paused) { try { this.room.history.resume(); } catch { /* sala cerrada */ } }
    this.unsubs.forEach(u => u());
    this.unsubs = [];
  }

  /** Sube el documento local a una sala recién creada. */
  private async seed() {
    const d = this.doc()!;
    this.setCollab({ status: 'uploading', progress: 'Preparando…' });
    const waits: Promise<unknown>[] = [];
    for (const l of d.state.layers) layerJSON(l, this.assets, waits);
    const fams = d.state.layers.filter(l => l.kind === 'text' && l.text).map(l => l.text!.fontFamily);
    for (const f of fontsForFamilies(fams)) this.assets.needFont(f, waits);
    let done = 0;
    const total = waits.length;
    if (total) this.setCollab({ progress: `Subiendo imágenes 0/${total}` });
    await Promise.all(waits.map(p => p.then(() => { done++; this.setCollab({ progress: `Subiendo imágenes ${done}/${total}` }); })));
    if (this.disposed) return;
    this.ready = true;
    this.flush();
    (this.root!.get('meta') as LiveObject<any>).update({ name: d.name, colorMode: d.colorMode, ready: true });
    this.room.history.clear(); // la carga inicial no se puede «deshacer»
    this.setCollab({ status: 'ready', seed: false, progress: undefined });
    this.emit();
  }

  /** Para salas que quedaron sin documento (p. ej. se cerró la pestaña durante la subida). */
  startEmpty() {
    if (!this.root || !this.writable) return;
    this.ready = true;
    this.flush();
    (this.root.get('meta') as LiveObject<any>).update({ name: this.doc()?.name || 'Proyecto', colorMode: this.doc()?.colorMode || 'RGB', ready: true });
    this.room.history.clear();
    this.setCollab({ status: 'ready' });
  }

  // ---------- planificación ----------
  private schedule() {
    if (this.raf || this.disposed) return;
    // requestAnimationFrame puede no dispararse nunca (pestaña en segundo plano o ventana tapada,
    // aunque diga estar visible): se usa el primero que llegue entre el fotograma y un temporizador
    let t = 0, f = 0;
    const tick = () => {
      cancelAnimationFrame(f); clearTimeout(t);
      this.raf = 0;
      this.tick();
    };
    f = requestAnimationFrame(tick);
    t = setTimeout(tick, 50) as unknown as number;
    this.raf = t || 1;
    this.cancelTick = () => { cancelAnimationFrame(f); clearTimeout(t); };
  }
  private cancelTick = () => {};
  private tick() {
    {
      // primero se envían los cambios locales (diferencias contra la sombra, sin pisar claves ajenas)
      // y luego se integran los remotos; al revés, un reordenado local sin enviar se perdería
      if (this.flushQueued) this.flush();
      if (this.applyQueued) this.apply();
    }
  }
  scheduleFlush() { this.flushQueued = true; this.schedule(); }
  scheduleApply() { this.applyQueued = true; this.schedule(); }
  flushNow() { this.flush(); if (this.applyQueued) this.apply(); }

  private onStore(s: AppState, p: AppState) {
    if (s.docs !== p.docs) {
      const d = s.docs.find(x => x.id === this.docId);
      if (d !== p.docs.find(x => x.id === this.docId)) this.scheduleFlush();
    }
    if (s.cursor !== p.cursor || s.tool !== p.tool || s.docs !== p.docs || s.activeDocId !== p.activeDocId || s.screen !== p.screen) this.pushPresence();
  }

  private pushPresence(force = false) {
    const s = get();
    const d = this.doc();
    if (!d) return;
    const active = s.activeDocId === this.docId && s.screen === 'editor';
    const pr: Partial<Presence> = {
      cursor: active && s.cursor ? { x: Math.round(s.cursor.x), y: Math.round(s.cursor.y) } : null,
      selection: d.state.selectedLayerIds,
      artboard: d.state.activeArtboardId,
      tool: active ? s.tool : null,
      activity: active && isLive(this.docId) ? ACTIVITY[s.tool] ?? 'Editando' : null,
    };
    const key = JSON.stringify(pr);
    if (!force && key === this.lastPresence) return;
    this.lastPresence = key;
    this.room.updatePresence(pr);
  }

  // ---------- local → Storage ----------
  flush() {
    this.flushQueued = false;
    const root = this.root, d = this.doc();
    if (!root || !d || !this.ready || this.disposed || !this.writable) return;
    const live = isLive(this.docId);
    if (live && !this.paused) { this.room.history.pause(); this.paused = true; }
    const waits: Promise<unknown>[] = [];
    let wrote = false;
    this.room.batch(() => {
      const meta = root.get('meta') as LiveObject<any>;
      if (d.name !== this.sh.name) { meta.set('name', d.name); this.sh.name = d.name; wrote = true; }
      if (d.colorMode !== this.sh.colorMode) { meta.set('colorMode', d.colorMode); this.sh.colorMode = d.colorMode; wrote = true; }
      wrote = this.flushCollection(root.get('layers'), d.state.layers, this.sh.layers, (l, w) => layerJSON(l, this.assets, w), true, waits) || wrote;
      wrote = this.flushCollection(root.get('artboards'), d.state.artboards, this.sh.artboards, a => artboardJSON(a), true, waits) || wrote;
      wrote = this.flushCollection(root.get('guides'), d.state.guides, this.sh.guides, g => guideJSON(g), false, waits) || wrote;
      this.flushFonts(root.get('fonts'), d.state.layers, waits);
    });
    if (!live && this.paused) { this.room.history.resume(); this.paused = false; }
    if (waits.length) Promise.allSettled(waits).then(() => this.scheduleFlush());
    if (wrote) { this.changedSinceVersion = true; this.info = { ...this.info, lastSync: Date.now() }; }
    if (d.dirty) set(s => ({ docs: s.docs.map(x => (x.id === this.docId ? { ...x, dirty: false } : x)) }));
    this.emit();
  }

  private flushCollection<T extends { id: string }>(
    map: LiveMap<string, LiveObject<any>>, items: T[], shadow: Map<string, Shadow<T>>,
    toJSON: (it: T, waits: Promise<unknown>[]) => any, ordered: boolean, waits: Promise<unknown>[],
  ) {
    let wrote = false;
    const zs = ordered ? computeZ(items.map(i => i.id), id => shadow.get(id)?.json.z) : null;
    const present = new Set<string>();
    for (const it of items) {
      present.add(it.id);
      const sh = shadow.get(it.id);
      const newZ = zs?.get(it.id);
      if (sh && sh.ref === it && newZ === undefined) continue;
      const w: Promise<unknown>[] = [];
      const json = toJSON(it, w);
      if (w.length) { waits.push(...w); continue; } // se envía cuando terminen de subirse sus bitmaps
      if (ordered) json.z = newZ ?? sh?.json.z;
      const lo = map.get(it.id);
      if (!sh || !lo) { map.set(it.id, new LiveObject(toLsonObject(json))); wrote = true; }
      else {
        const ch = diff(sh.json, json);
        if (ch) { lo.update(toLsonObject(ch)); wrote = true; }
      }
      shadow.set(it.id, { ref: it, json });
    }
    for (const id of [...shadow.keys()]) {
      if (present.has(id)) continue;
      if (map.has(id)) { map.delete(id); wrote = true; }
      shadow.delete(id);
    }
    return wrote;
  }

  private flushFonts(map: LiveMap<string, LiveObject<any>> | undefined, layers: Layer[], waits: Promise<unknown>[]) {
    if (!map) return;
    const fams = layers.filter(l => l.kind === 'text' && l.text).map(l => l.text!.fontFamily);
    if (!fams.length) return;
    for (const f of fontsForFamilies(fams)) {
      const key = `${f.family}|${f.weight}|${f.style}`.slice(0, 120);
      if (map.has(key)) continue;
      const ref = this.assets.needFont(f, waits);
      if (ref) {
        map.set(key, new LiveObject({ family: f.family, weight: f.weight, style: f.style, format: f.format, license: f.license ?? null, file: new LiveFile(ref) }));
        this.fontsSeen.add(key);
      }
    }
  }

  // ---------- Storage → local ----------
  apply(full = false) {
    this.applyQueued = false;
    const root = this.root;
    const d = this.doc();
    if (!root || !d || this.disposed) return;
    const meta = root.get('meta') as LiveObject<any> | undefined;
    if (!this.ready) {
      if (!meta?.get('ready')) return;
      this.ready = true;
      full = true;
    }
    this.syncFonts(root.get('fonts'));
    const st = d.state;
    const layers = this.applyCollection(root.get('layers'), st.layers, this.sh.layers, (id, j, prev, only) => layerFromJSON(id, j, this.assets, prev, only), true, full);
    const artboards = this.applyCollection(root.get('artboards'), st.artboards, this.sh.artboards, plainFromJSON as any, true, full);
    const guides = this.applyCollection(root.get('guides'), st.guides, this.sh.guides, plainFromJSON as any, false, full);
    const name = meta?.get('name') || d.name;
    const colorMode = meta?.get('colorMode') || d.colorMode;
    const metaChanged = name !== this.sh.name || colorMode !== this.sh.colorMode;
    this.sh.name = name; this.sh.colorMode = colorMode;
    if (!layers && !artboards && !guides && !metaChanged && !full) return;
    this.changedSinceVersion = true;
    patchRemote(this.docId, s => {
      const L = (layers ?? s.layers) as Layer[];
      const A = (artboards ?? s.artboards) as Artboard[];
      const ids = new Set(L.map(l => l.id));
      const abIds = new Set(A.map(a => a.id));
      return {
        ...s, layers: L, artboards: A.length ? A : s.artboards, guides: (guides ?? s.guides) as Guide[],
        selectedLayerIds: full ? [] : s.selectedLayerIds.filter(id => ids.has(id)),
        activeArtboardId: abIds.has(s.activeArtboardId) ? s.activeArtboardId : A[0]?.id ?? s.activeArtboardId,
        ...(full ? { selection: null } : {}),
      };
    }, doc => ({
      ...doc, name, colorMode, dirty: false,
      ...(full ? { past: [], future: [], lastLabel: 'Documento compartido' } : {}),
      collab: doc.collab && doc.collab.status !== 'ready' ? { ...doc.collab, status: 'ready', progress: undefined } : doc.collab,
    }));
    if (full && get().activeDocId === this.docId) import('../core/actions').then(m => requestAnimationFrame(() => m.fitToScreen()));
  }

  private applyCollection<T extends { id: string }>(
    map: LiveMap<string, LiveObject<any>> | undefined, local: T[], shadow: Map<string, Shadow<T>>,
    fromJSON: (id: string, json: any, prev?: T, only?: string[]) => T, ordered: boolean, full: boolean,
  ): T[] | null {
    if (!map) return null;
    if (full) shadow.clear();
    const localById = new Map(local.map(x => [x.id, x] as const));
    const remote: { id: string; json: any }[] = [];
    map.forEach((lo, id) => remote.push({ id, json: readObject(lo) }));
    if (ordered) remote.sort((a, b) => (a.json.z < b.json.z ? -1 : a.json.z > b.json.z ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const next = new Map<string, T>();
    const localDeleted = new Set<string>();
    for (const { id, json } of remote) {
      const cur = full ? undefined : localById.get(id);
      const sh = shadow.get(id);
      const ch = diff(sh?.json, json);
      if (!ch && cur) { next.set(id, cur); continue; }
      // borrado localmente y aún sin enviar: no resucitarlo (salvo que otra persona lo editara)
      if (!full && !cur && sh && !ch) { localDeleted.add(id); continue; }
      const localDirty = !!(cur && sh && cur !== sh.ref);
      const item = cur && sh && ch ? fromJSON(id, json, cur, Object.keys(ch)) : fromJSON(id, json, cur);
      shadow.set(id, { ref: localDirty ? sh!.ref : item, json });
      next.set(id, item);
    }
    // borrados remotos
    const removed = new Set<string>();
    for (const id of [...shadow.keys()]) if (!next.has(id) && !localDeleted.has(id)) { shadow.delete(id); removed.add(id); }
    let out: T[];
    if (ordered) {
      out = remote.map(r => next.get(r.id)!);
      // elementos locales nuevos que aún no se enviaron (p. ej. esperando la subida de su bitmap)
      if (!full) {
        local.forEach((x, i) => {
          if (next.has(x.id) || removed.has(x.id)) return;
          const before = i > 0 ? out.findIndex(o => o.id === local[i - 1].id) : -1;
          out.splice(before + 1, 0, x);
        });
      }
    } else {
      out = [];
      for (const x of local) { const n = next.get(x.id); if (n) out.push(n); else if (!full && !removed.has(x.id)) out.push(x); }
      for (const { id } of remote) if (!localById.has(id) || full) { const n = next.get(id)!; if (!out.includes(n)) out.push(n); }
    }
    const changed = out.length !== local.length || out.some((x, i) => x !== local[i]);
    return changed ? out : null;
  }

  private syncFonts(map: LiveMap<string, LiveObject<any>> | undefined) {
    if (!map) return;
    map.forEach((lo, key) => {
      if (this.fontsSeen.has(key)) return;
      this.fontsSeen.add(key);
      const j = readObject(lo);
      if (listFonts().some(f => f.family === j.family && f.weight === j.weight && f.style === j.style)) return;
      this.assets.fetchBlob(j.file).then(b => b.arrayBuffer())
        .then(buf => installFontData({ family: j.family, weight: j.weight, style: j.style, format: j.format as FontFormat, license: j.license ?? undefined }, buf))
        .catch(e => console.warn('No se pudo instalar la fuente', j.family, e));
    });
  }

  /** Al terminar una descarga, sustituye los marcadores por el bitmap real. */
  onAssetLoaded() {
    if (this.disposed) return;
    const swap = (c: HTMLCanvasElement | null | undefined) => {
      if (!c || !this.assets.isPlaceholder(c)) return c;
      const id = this.assets.refs.get(c)?.id;
      return (id && this.assets.real(id)) || c;
    };
    patchRemote(this.docId, s => {
      let changed = false;
      const layers = s.layers.map(l => {
        const canvas = swap(l.canvas) ?? undefined, origin = swap(l.origin) ?? undefined, mask = swap(l.mask) ?? null;
        let vector = l.vector;
        const m = vector?.svg.match(/data-kova-pending="([^"]+)"/);
        if (m && vector) { const t = this.assets.textLoaded.get(m[1]); if (t != null) vector = { ...vector, svg: t }; }
        if (canvas === l.canvas && origin === l.origin && mask === l.mask && vector === l.vector) return l;
        changed = true;
        const nl = { ...l, canvas, origin, mask, vector };
        const sh = this.sh.layers.get(l.id);
        if (sh && sh.ref === l) sh.ref = nl;
        return nl;
      });
      return changed ? { ...s, layers } : s;
    });
  }

  // ---------- historial ----------
  undo() {
    this.flushNow();
    if (!this.room.history.canUndo()) { toast('No hay cambios tuyos para deshacer', 'info', 1800); return; }
    this.room.history.undo();
    this.apply();
    set(s => ({
      docs: s.docs.map(d => {
        if (d.id !== this.docId || !d.past.length) return d;
        const prev = d.past[d.past.length - 1];
        return { ...d, past: d.past.slice(0, -1), future: [{ label: d.lastLabel, state: d.state, time: Date.now() }, ...d.future], lastLabel: prev.label };
      }),
    }));
  }
  redo() {
    this.flushNow();
    if (!this.room.history.canRedo()) return;
    this.room.history.redo();
    this.apply();
    set(s => ({
      docs: s.docs.map(d => {
        if (d.id !== this.docId || !d.future.length) return d;
        const nx = d.future[0];
        return { ...d, future: d.future.slice(1), past: [...d.past, { label: d.lastLabel, state: d.state, time: Date.now() }], lastLabel: nx.label };
      }),
    }));
  }

  // ---------- eventos ----------
  private async onEvent(event: any) {
    if (event?.type !== 'access-changed') return;
    const me = this.room.getSelf()?.id;
    if (event.userId !== me && event.userId !== '*') return;
    try {
      const info = await api.getRoom(this.room.id);
      const role = info.role ?? 'viewer';
      this.setCollab({ role });
      const writer = role !== 'viewer';
      toast(writer && !this.room.getSelf()?.canWrite
        ? `Ahora eres ${api.roleLabel(role)} en «${info.name}». La edición se activa en menos de un minuto.`
        : `Tu rol en «${info.name}» ahora es ${api.roleLabel(role)}`, 'info', 5000);
      this.room.reconnect();
      // Liveblocks tarda hasta ~1 min en aplicar un cambio de permisos en sus servidores:
      // al ascender, se reintenta la conexión hasta recibir el permiso de escritura.
      clearInterval(this.accessRetry);
      if (writer) {
        let tries = 0;
        this.accessRetry = setInterval(() => {
          if (this.disposed || this.doc()?.collab?.role === 'viewer' || this.room.getSelf()?.canWrite || ++tries > 9) { clearInterval(this.accessRetry); return; }
          this.room.reconnect();
        }, 10_000);
      }
    } catch (e: any) {
      if (e?.status === 403 || e?.status === 404) this.lostAccess();
    }
  }
  private onError(err: any) {
    const code = err?.context?.code ?? err?.code;
    console.warn('Liveblocks', code, err?.message);
    if (code === 4001 || code === 4006 || /access|denied|forbidden|not allowed/i.test(err?.message || '')) this.lostAccess();
  }
  private lostAccess() {
    const d = this.doc();
    if (!d?.collab) return;
    toast('Ya no tienes acceso a este proyecto compartido. Se conserva como copia local.', 'warn', 7000);
    set(s => ({ docs: s.docs.map(x => (x.id === this.docId ? { ...x, collab: undefined, dirty: true } : x)) }));
  }

  // ---------- subidas ----------
  async upload(blob: Blob, name: string): Promise<FileRef> {
    let delay = 1000;
    for (;;) {
      if (this.disposed) throw new Error('La sesión se cerró');
      try {
        const lf = await this.room.uploadFile(new File([blob], name, { type: blob.type || 'application/octet-stream' }));
        return { ...lf.data };
      } catch (e: any) {
        if (/permission|forbidden|read.?only|403/i.test(String(e?.message))) throw e;
        console.warn('Subida fallida; se reintentará', e);
        await sleep(delay);
        delay = Math.min(30_000, delay * 2);
      }
    }
  }
  async waitUploads() { while (this.assets.inflight.size) await Promise.allSettled([...this.assets.inflight]); }

  // ---------- versiones ----------
  async saveVersion(label: string, auto = false) {
    const root = this.root;
    const d = this.doc();
    if (!root || !d || !this.writable) throw new Error('Solo los editores pueden guardar versiones');
    this.flushNow();
    await this.waitUploads();
    this.flushNow();
    const dump = (m: LiveMap<string, LiveObject<any>>) => { const o: Record<string, any> = {}; m.forEach((lo, id) => { o[id] = readObject(lo); }); return o; };
    const snap = {
      format: 'kova-collab-version', v: 1,
      meta: { name: (root.get('meta') as LiveObject<any>).get('name'), colorMode: (root.get('meta') as LiveObject<any>).get('colorMode') },
      layers: dump(root.get('layers')), artboards: dump(root.get('artboards')), guides: dump(root.get('guides')),
    };
    const file = await this.upload(new Blob([JSON.stringify(snap)], { type: 'application/json' }), 'version.json');
    let thumb = '';
    try { thumb = await thumbnail(d, 96); } catch { /* sin miniatura */ }
    await api.saveVersion(this.room.id, { file, label, auto, thumb, layers: d.state.layers.length });
    this.changedSinceVersion = false;
  }
  async restoreVersion(v: VersionJSON) {
    const root = this.root;
    if (!root || !this.writable) throw new Error('Solo los editores pueden restaurar versiones');
    const snap = await (await this.assets.fetchBlob(v.file)).text().then(t => JSON.parse(t));
    if (snap?.format !== 'kova-collab-version') throw new Error('La versión está dañada');
    this.flushNow();
    const fill = (m: LiveMap<string, LiveObject<any>>, data: Record<string, any>) => {
      for (const k of [...m.keys()]) if (!(k in data)) m.delete(k);
      for (const [k, j] of Object.entries(data)) {
        const lo = m.get(k);
        if (!lo) m.set(k, new LiveObject(toLsonObject(j)));
        else { const ch = diff(readObject(lo), j); if (ch) lo.update(toLsonObject(ch)); }
      }
    };
    this.room.batch(() => {
      fill(root.get('layers'), snap.layers || {});
      fill(root.get('artboards'), snap.artboards || {});
      fill(root.get('guides'), snap.guides || {});
      (root.get('meta') as LiveObject<any>).update({ name: snap.meta?.name || 'Proyecto', colorMode: snap.meta?.colorMode || 'RGB' });
    });
    this.apply();
    set(s => ({ docs: s.docs.map(d => (d.id === this.docId ? { ...d, past: [...d.past, { label: d.lastLabel, state: d.state, time: Date.now() }], future: [], lastLabel: 'Restaurar versión' } : d)) }));
  }
  private async autoVersion() {
    if (!this.changedSinceVersion || !this.writable || !this.ready) return;
    // solo una persona (la conexión más antigua con permiso de escritura) guarda las automáticas
    const me = this.room.getSelf();
    if (!me || this.room.getOthers().some(o => o.canWrite && o.connectionId < me.connectionId)) return;
    try { await this.saveVersion('Guardado automático', true); } catch (e) { console.warn('Versión automática', e); }
  }
}

// ---------- registro ----------
const sessions = new Map<string, CollabSession>();
export const getSession = (docId: string | null | undefined) => (docId ? sessions.get(docId) : undefined);
export function attachSession(docId: string, room: AnyRoom) {
  const s = new CollabSession(docId, room);
  sessions.set(docId, s);
  s.start();
  emitInfo();
  return () => { s.dispose(); if (sessions.get(docId) === s) sessions.delete(docId); emitInfo(); };
}
/** true si quedan cambios sin enviar (para avisar antes de cerrar la pestaña). */
export function collabPending() {
  for (const s of sessions.values()) if (s.assets.pendingUp || s.room.getStorageStatus() === 'synchronizing') return true;
  return false;
}

const docOf = (id: string) => get().docs.find(d => d.id === id);
collabHooks.blocked = docId => {
  const d = docOf(docId);
  if (!d?.collab) return null;
  if (d.collab.status !== 'ready') return 'El documento compartido todavía se está cargando';
  const s = sessions.get(docId);
  if (d.collab.role === 'viewer' || (s && !s.writable)) return 'Solo lectura: tu rol en este proyecto es Lector';
  return null;
};
collabHooks.undo = docId => { if (!docOf(docId)?.collab) return false; sessions.get(docId)?.undo(); return true; };
collabHooks.redo = docId => { if (!docOf(docId)?.collab) return false; sessions.get(docId)?.redo(); return true; };

// depuración en desarrollo (no se incluye en la compilación de producción)
if (import.meta.env.DEV) (window as any).__kova = { sessions, store: useStore };
