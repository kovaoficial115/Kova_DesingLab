import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Home as HomeIcon, Plus, Trash2, Box, Loader2, ExternalLink, ImageDown, Undo2, Redo2, Magnet, RotateCw, RotateCcw, FlipHorizontal2,
  Eye, EyeOff, Lock, Unlock, Keyboard, PanelLeftClose, PanelLeftOpen, Scan, Focus,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
} from 'lucide-react';
import { useStore, set, get, toast } from '../core/store';
import { KovaK, BrandIcon } from '../ui/components/Brand';
import { Seg, ColorInput, Select, Slider, Check, NumberField } from '../ui/components/controls';
import { GarmentViewer, VIEW_LABELS, LIGHT_LABELS, type ViewPreset, type LightPreset, type PrintInteraction } from './viewer';
import { listGarments, removeGarment, garmentModel, updateGarmentConfig, addSampleGarment, type GarmentEntry } from './garments';
import { ImportGarmentDialog } from './ImportGarmentDialog';
import { ExportRenderDialog } from './ExportRenderDialog';
import { GARMENT3D_SCHEMA, type Garment3DData, type PrintZoneId, type ZonePrint } from '../core/garment3d';
import type { Doc } from '../core/types';
import { renderArtboard } from '../core/render';
import { zoneDefs, ZONE_LABELS, type ZoneDef } from './zones';
import { align, applyPreset, inkBoxCm, inkCenterTo, measures, nudge, presets, setInkWidth, snap, type ArtInfo, type HAlign, type VAlign } from './placement';
import { UndoStack } from './history';
import { QUALITY_LABELS, QUALITY_HINTS, isQuality, type QualityMode } from './quality';
import { inkBox, type PreparedPrint, type PrintResult } from './prints';
import { FABRICS, FINISHES, SWATCHES, defaultFabric, isPreset, isFinish, type FabricSettings, type FabricPreset, type FabricFinish } from './fabric';
import { fabricOf } from './config';
import { platform } from '../platform';

// preferencias del estudio (solo interfaz): LocalStorage
const PREFS = 'kova.studio';
interface StudioPrefs { garment?: string; light: LightPreset; bg: string | null; quality: QualityMode; snap: boolean; lib: boolean }
const DEFAULT_PREFS: StudioPrefs = { light: 'studio', bg: null, quality: 'adaptive', snap: true, lib: true };
const loadPrefs = (): StudioPrefs => {
  try {
    const p = { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS) || '{}') };
    if (!isQuality(p.quality)) p.quality = 'adaptive';
    return p;
  } catch { return { ...DEFAULT_PREFS }; }
};
const savePrefs = (p: StudioPrefs) => { try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch { /* sin almacenamiento */ } };

const IN_PER_M = 0.0254;
const cmOf = (px: number, dpi: number) => (px / dpi) * 2.54;
/** máximo del lado del arte renderizado para la prenda (px) */
const ART_PX = 2048;

interface Art { image: HTMLCanvasElement; ink: [number, number, number, number] | null }
/** Renderiza la mesa de trabajo y mide su caja con tinta (sobre una copia reducida). */
async function renderArt(state: Doc['state'], ab: Doc['state']['artboards'][number]): Promise<Art> {
  const image = await renderArtboard(state, ab, Math.min(1, ART_PX / Math.max(ab.w, ab.h)), { background: false });
  const k = Math.min(1, 256 / Math.max(image.width, image.height));
  const w = Math.max(1, Math.round(image.width * k)), h = Math.max(1, Math.round(image.height * k));
  const small = document.createElement('canvas');
  small.width = w; small.height = h;
  const g = small.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(image, 0, 0, w, h);
  const a = g.getImageData(0, 0, w, h).data;
  const box = inkBox((x, y) => a[(y * w + x) * 4 + 3], w, h);
  // un píxel de margen: la copia reducida puede recortar bordes finos
  const ink = box && ([Math.max(0, box[0] - 1 / w), Math.max(0, box[1] - 1 / h), Math.min(1, box[2] + 1 / w), Math.min(1, box[3] + 1 / h)] as [number, number, number, number]);
  return { image, ink };
}

/** Tela guardada en el documento → ajustes del visor. */
const fabricFromDoc = (g: Garment3DData): FabricSettings => ({
  color: g.color,
  preset: isPreset(g.material.preset) ? g.material.preset : 'cotton',
  roughness: g.material.roughness,
  normalScale: g.material.normalScale,
  finish: isFinish(g.material.finish) ? g.material.finish : 'plain',
});

/** Lo que deshace el estudio: tela, color y estampados del documento (la prenda elegida no). */
type Snap = Pick<Garment3DData, 'color' | 'material' | 'zones'> | null;
const snapOf = (d?: Doc): Snap => (d?.garment3d ? { color: d.garment3d.color, material: d.garment3d.material, zones: d.garment3d.zones } : null);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
type Ink = [number, number, number, number];

/** El arte de una mesa tal como lo mide la colocación: cm a escala 1 y caja con tinta (reflejada si va en espejo). */
function artInfo(ab: Doc['state']['artboards'][number], ink: Ink | undefined, flip?: boolean): ArtInfo {
  const k = ink ?? [0, 0, 1, 1];
  return { wCm: cmOf(ab.w, ab.dpi), hCm: cmOf(ab.h, ab.dpi), ink: flip ? [1 - k[2], k[1], 1 - k[0], k[3]] : k };
}

/** Copia reflejada del arte (una por imagen). */
const mirrors = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
function mirrored(img: HTMLCanvasElement) {
  let m = mirrors.get(img);
  if (!m) {
    m = document.createElement('canvas');
    m.width = img.width; m.height = img.height;
    const g = m.getContext('2d')!;
    g.setTransform(-1, 0, 0, 1, img.width, 0);
    g.drawImage(img, 0, 0);
    mirrors.set(img, m);
  }
  return m;
}

const SHORTCUTS: [string, string][] = [
  ['Arrastrar sobre la prenda', 'Girar · sobre un estampado: moverlo'],
  ['Alt + arrastrar estampado', 'Mover sin ajuste magnético'],
  ['Rueda · clic derecho o Mayús + arrastrar', 'Acercar · desplazar'],
  ['Doble clic', 'Encuadrar la prenda'],
  ['1 · 2 · 3 · 4 · 5', 'Frontal · trasera · izquierda · derecha · ¾'],
  ['F', 'Encuadrar'],
  ['P', 'Vista plana (sin perspectiva)'],
  ['R', 'Giro automático'],
  ['M', 'Ajuste magnético'],
  ['Flechas (Mayús)', 'Mover el estampado 0,5 cm (5 cm)'],
  ['H · L', 'Ocultar · bloquear el estampado'],
  ['Supr', 'Quitar el estampado'],
  ['⌘/Ctrl + Z · ⇧⌘/Ctrl + Y', 'Deshacer · rehacer'],
  ['Esc', 'Quitar la selección'],
];

const CAT: Record<string, string> = { tshirt: 'Camiseta', hoodie: 'Hoodie', sport: 'Deportiva', crop: 'Crop', longsleeve: 'Manga larga', other: 'Prenda' };

/** Estudio 3D: biblioteca de prendas, visor y escena. El arte sigue saliendo del editor 2D. */
export function Studio() {
  const doc = useStore(s => s.docs.find(d => d.id === s.activeDocId));
  const stageRef = useRef<HTMLDivElement>(null);
  const viewer = useRef<GarmentViewer | null>(null);
  const [garments, setGarments] = useState<GarmentEntry[] | null>(null);
  const [prefs, setPrefsState] = useState<StudioPrefs>(loadPrefs);
  const [current, setCurrent] = useState<GarmentEntry | null>(null);
  const currentRef = useRef<GarmentEntry | null>(null);
  currentRef.current = current;
  const [loading, setLoading] = useState(false);
  const [lost, setLost] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [addingSample, setAddingSample] = useState(false);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [results, setResults] = useState<Partial<Record<PrintZoneId, PrintResult>>>({});
  const [activeZone, setActiveZone] = useState<PrintZoneId | null>('front');
  const [flat, setFlatState] = useState(false);
  const [spin, setSpin] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  // caja con tinta de cada mesa de trabajo (la mide el renderizado del arte)
  const [inks, setInks] = useState<Record<string, Ink>>({});
  // deshacer / rehacer por documento
  const history = useRef(new Map<string, UndoStack<Snap>>());
  const [, setHistTick] = useState(0);
  const stackFor = (docId: string) => { let h = history.current.get(docId); if (!h) history.current.set(docId, (h = new UndoStack<Snap>())); return h; };
  // borrador del arrastre en curso: se guarda en el documento al soltar
  const dragDraft = useRef<{ zone: PrintZoneId; x: number; y: number } | null>(null);
  // tela cuando no hay documento abierto (con documento se guarda en su .kova)
  const [localFabric, setLocalFabric] = useState<FabricSettings | null>(null);
  // arte renderizado por mesa de trabajo; se invalida cuando cambia el documento
  const artCache = useRef<{ state: unknown; map: Map<string, Promise<Art>> }>({ state: null, map: new Map() });
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const inksRef = useRef(inks);
  inksRef.current = inks;
  const setPrefs = (p: Partial<StudioPrefs>) => setPrefsState(prev => { const n = { ...prev, ...p }; savePrefs(n); return n; });

  const refresh = () => listGarments().then(setGarments).catch(e => { toast(e.message, 'error'); setGarments([]); });
  useEffect(() => { refresh(); }, []);

  // un solo visor vivo mientras el estudio está abierto
  useEffect(() => {
    const v = new GarmentViewer(stageRef.current!, {
      onContextLost: () => setLost(true),
      onContextRestored: () => setLost(false),
      onError: e => toast('El visor 3D falló: ' + ((e as Error)?.message || e), 'error'),
    });
    v.setLighting(prefs.light);
    v.setBackground(prefs.bg);
    v.setQuality(prefs.quality);
    // el visor llama siempre a la versión más reciente de los manejadores (sin cierres viejos)
    v.setInteraction({
      canDrag: z => ix.current.canDrag(z), select: z => ix.current.select(z),
      drag: (z, x, y, s) => ix.current.drag(z, x, y, s), end: z => ix.current.end(z),
    });
    viewer.current = v;
    (window as any).__kovaViewer = v; // diagnóstico
    // si el visor se vuelve a crear con una prenda ya elegida (recarga en caliente), se recarga en él
    if (currentRef.current) select(currentRef.current, false);
    return () => { v.dispose(); viewer.current = null; delete (window as any).__kovaViewer; };
  }, []);

  useEffect(() => { viewer.current?.setLighting(prefs.light); }, [prefs.light]);
  useEffect(() => { viewer.current?.setBackground(prefs.bg); }, [prefs.bg]);
  useEffect(() => { viewer.current?.setQuality(prefs.quality); }, [prefs.quality]);

  // prenda inicial: la del documento activo, si no la última usada
  useEffect(() => {
    if (!garments || current) return;
    const m = doc?.garment3d?.model;
    const fromDoc = m?.source === 'asset' ? garments.find(g => g.modelHash === m.hash) : undefined;
    const pick = fromDoc ?? garments.find(g => g.id === prefs.garment) ?? garments[0];
    if (pick) select(pick, false);
  }, [garments]);

  const select = async (g: GarmentEntry, link = true) => {
    setCurrent(g);
    setPrefs({ garment: g.id });
    setLoading(true);
    setLoadedId(null);
    try { if (await viewer.current?.setGarment(await garmentModel(g), g.config)) setLoadedId(g.id); }
    catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
    if (link) linkToDoc(g);
  };

  /** Sección garment3d del documento para la prenda `g` (conserva lo que ya tuviera). */
  const garmentData = (g: GarmentEntry, d: Doc): Garment3DData => {
    const f = defaultFabric(fabricOf(g.config));
    return {
    schema: GARMENT3D_SCHEMA,
    model: { source: 'asset', hash: g.modelHash, name: g.config.name, config: g.config as unknown as Record<string, unknown> },
    color: d.garment3d?.color ?? localFabric?.color ?? f.color,
    material: d.garment3d?.material ?? (localFabric ? { preset: localFabric.preset, roughness: localFabric.roughness, normalScale: localFabric.normalScale, finish: localFabric.finish } : { preset: f.preset, roughness: f.roughness, normalScale: f.normalScale, finish: f.finish }),
    zones: d.garment3d?.zones ?? {},
    lighting: { preset: prefsRef.current.light, background: prefsRef.current.bg },
    };
  };

  /** Guarda en el documento activo qué prenda usa (sección garment3d del .kova). */
  const linkToDoc = (g: GarmentEntry) => {
    const id = get().activeDocId;
    if (!id) return;
    set(s => ({ docs: s.docs.map(d => d.id !== id ? d : { ...d, dirty: true, garment3d: garmentData(g, d) }) }));
  };

  /** Guarda el estado 3D actual del documento para poder deshacer el cambio que viene. */
  const record = (id: string, key?: string) => {
    stackFor(id).record(snapOf(get().docs.find(d => d.id === id)), key);
    setHistTick(t => t + 1);
  };

  /** Deshace (o rehace) el último cambio 3D del documento activo. */
  const stepHistory = (dir: 'undo' | 'redo') => {
    const id = get().activeDocId, g = currentRef.current;
    if (!id || !g) return;
    const d = get().docs.find(x => x.id === id), h = stackFor(id);
    const snapBack = dir === 'undo' ? h.undo(snapOf(d)) : h.redo(snapOf(d));
    if (snapBack === undefined) return;
    set(s => ({ docs: s.docs.map(x => (x.id !== id ? x : { ...x, dirty: true, garment3d: snapBack ? { ...(x.garment3d ?? garmentData(g, x)), ...snapBack } : undefined })) }));
    setHistTick(t => t + 1);
  };

  /** Cambia (o quita, con null) el estampado de una zona del documento activo. `key` funde cambios seguidos al deshacer. */
  const updateZone = (z: PrintZoneId, patch: Partial<ZonePrint> | null, key?: string) => {
    const id = get().activeDocId, g = currentRef.current;
    if (!id || !g) return;
    record(id, key);
    set(s => ({
      docs: s.docs.map(d => {
        if (d.id !== id) return d;
        const g3 = d.garment3d && d.garment3d.model.source === 'asset' && d.garment3d.model.hash === g.modelHash ? d.garment3d : garmentData(g, d);
        const zones = { ...g3.zones };
        if (patch === null) delete zones[z];
        else zones[z] = { ...(zones[z] ?? { artboardId: null, x: 0.5, y: 0.5, scale: 1, rotation: 0 }), ...patch };
        return { ...d, dirty: true, garment3d: { ...g3, zones } };
      }),
    }));
  };

  // tela visible: la del documento, la elegida sin documento o la habitual de la prenda
  const fabric: FabricSettings | null = doc?.garment3d ? fabricFromDoc(doc.garment3d) : localFabric ?? (current ? defaultFabric(fabricOf(current.config)) : null);
  const fabricKey = fabric ? JSON.stringify(fabric) : '';
  useEffect(() => { if (fabric && loadedId) viewer.current?.setFabric(fabric); }, [fabricKey, loadedId]);

  /** Cambia la tela: en el documento activo si lo hay; si no, solo en el estudio. */
  // siempre sobre el estado más reciente: dos cambios seguidos no deben pisarse
  const updateFabric = (patch: Partial<FabricSettings>, key?: string) => {
    const id = get().activeDocId, g = currentRef.current;
    if (!g) return;
    if (!id) { setLocalFabric(prev => ({ ...(prev ?? defaultFabric(fabricOf(g.config))), ...patch })); return; }
    record(id, key ?? 'fabric:' + Object.keys(patch).join());
    set(s => ({
      docs: s.docs.map(d => {
        if (d.id !== id) return d;
        const g3 = d.garment3d ?? garmentData(g, d);
        const next = { ...fabricFromDoc(g3), ...patch };
        return { ...d, dirty: true, garment3d: { ...g3, color: next.color, material: { preset: next.preset, roughness: next.roughness, normalScale: next.normalScale, finish: next.finish } } };
      }),
    }));
  };

  /** Asigna una mesa de trabajo a la zona: tamaño real, centrada y pegada al borde superior. */
  const chooseArt = (def: ZoneDef, abId: string) => {
    const ab = abId ? doc?.state.artboards.find(a => a.id === abId) : undefined;
    if (!ab) { updateZone(def.id, null); return; }
    setActiveZone(def.id);
    const w = cmOf(ab.w, ab.dpi), h = cmOf(ab.h, ab.dpi);
    const scale = Math.min(1, def.sizeCm[0] / w, def.sizeCm[1] / h);
    updateZone(def.id, { artboardId: ab.id, x: 0.5, y: Math.min(0.5, (h * scale) / 2 / def.sizeCm[1]), scale, rotation: 0 });
  };

  // estampados: arte de las mesas de trabajo → zonas de la prenda
  const zones = doc?.garment3d?.zones;
  useEffect(() => {
    const v = viewer.current;
    if (!v || !current || loadedId !== current.id) return;
    let alive = true;
    const t = setTimeout(async () => {
      const list: PreparedPrint[] = [], empty: PrintResult[] = [];
      try {
        if (doc && zones) {
          if (artCache.current.state !== doc.state) artCache.current = { state: doc.state, map: new Map() };
          for (const def of zoneDefs(current.config)) {
            const p = zones[def.id];
            const ab = p?.artboardId ? doc.state.artboards.find(a => a.id === p.artboardId) : undefined;
            if (!p || !ab) continue;
            let art = artCache.current.map.get(ab.id);
            if (!art) { art = renderArt(doc.state, ab); artCache.current.map.set(ab.id, art); }
            const { image, ink } = await art;
            if (ink && inksRef.current[ab.id]?.join() !== ink.join()) setInks(prev => ({ ...prev, [ab.id]: ink }));
            if (!ink) { empty.push({ zone: def.id, mode: 'none', reason: 'La mesa de trabajo está vacía.', overflow: false }); continue; }
            if (p.hidden) { empty.push({ zone: def.id, mode: 'none', reason: 'Oculto: no se ve en el visor ni en los renders.', overflow: false }); continue; }
            const info = artInfo(ab, ink, p.flipX);
            list.push({ zone: def, print: p, image: p.flipX ? mirrored(image) : image, ink: info.ink, sizeM: [(ab.w / ab.dpi) * IN_PER_M, (ab.h / ab.dpi) * IN_PER_M] });
          }
        }
        if (!alive) return;
        const r = [...v.setPrints(list), ...empty];
        setResults(Object.fromEntries(r.map(x => [x.zone, x])));
      } catch (e: any) { if (alive) toast('No se pudo aplicar el estampado: ' + (e?.message || e), 'error'); }
    }, 60);
    return () => { alive = false; clearTimeout(t); };
  }, [doc?.state, zones, current?.id, loadedId]);

  const remove = async (g: GarmentEntry) => {
    if (!(await platform.confirm(`¿Quitar «${g.config.name}» de la biblioteca? Los proyectos que la usan la conservan dentro del .kova.`, { okLabel: 'Quitar' }))) return;
    await removeGarment(g);
    if (current?.id === g.id) setCurrent(null);
    refresh();
  };

  /** Zona, estampado, mesa y medidas del arte de una zona del documento activo (o null si está vacía). */
  const zoneCtx = (z: PrintZoneId) => {
    const g = currentRef.current, d = get().docs.find(x => x.id === get().activeDocId);
    const p = d?.garment3d?.zones[z];
    const ab = p?.artboardId ? d!.state.artboards.find(a => a.id === p.artboardId) : undefined;
    if (!g || !p || !ab) return null;
    const def = zoneDefs(g.config).find(x => x.id === z)!;
    return { def, p, ab, art: artInfo(ab, inksRef.current[ab.id], p.flipX) };
  };

  /** Gira manteniendo en su sitio el centro de lo impreso. */
  const rotateTo = (z: PrintZoneId, deg: number, key = 'rotate:' + z) => {
    const c = zoneCtx(z);
    if (!c) return;
    const rotation = ((((deg + 180) % 360) + 360) % 360) - 180;
    const b = inkBoxCm(c.def, c.p, c.art), next = { ...c.p, rotation };
    updateZone(z, { rotation, ...inkCenterTo(c.def, next, c.art, b.cx, b.cy) }, key);
  };
  /** Espejo horizontal: lo impreso no se mueve de sitio. */
  const toggleFlip = (z: PrintZoneId) => {
    const c = zoneCtx(z);
    if (!c) return;
    const b = inkBoxCm(c.def, c.p, c.art), next = { ...c.p, flipX: !c.p.flipX };
    updateZone(z, { flipX: next.flipX || undefined, ...inkCenterTo(c.def, next, artInfo(c.ab, inksRef.current[c.ab.id], next.flipX), b.cx, b.cy) });
  };
  const toggleFlag = (z: PrintZoneId, flag: 'hidden' | 'locked') => {
    const c = zoneCtx(z);
    if (c) updateZone(z, { [flag]: c.p[flag] ? undefined : true });
  };
  const nudgeZone = (z: PrintZoneId, dx: number, dy: number) => {
    const c = zoneCtx(z);
    if (!c) return;
    if (c.p.locked) { toast('El estampado está bloqueado (L para desbloquear).', 'warn'); return; }
    updateZone(z, nudge(c.def, c.p, dx, dy), 'nudge:' + z);
  };

  // manejadores del arrastre directo sobre la prenda
  const ix = useRef<PrintInteraction>({ canDrag: () => false, select: () => {}, drag: () => {}, end: () => {} });
  ix.current = {
    canDrag: z => { const c = zoneCtx(z); return !!c && !c.p.locked; },
    select: z => { setActiveZone(z); document.getElementById('zone-card-' + z)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); },
    drag: (z, x, y, snapOn) => {
      const c = zoneCtx(z), v = viewer.current;
      if (!c || !v) return;
      let next = { ...c.p, x: clamp01(x), y: clamp01(y) };
      if (snapOn && prefsRef.current.snap) {
        const r = snap(c.def, next, c.art);
        next = { ...next, x: r.x, y: r.y };
        v.setGuides(r.guides);
      } else v.setGuides([]);
      dragDraft.current = { zone: z, x: next.x, y: next.y };
      v.previewPrint(z, next);
    },
    end: z => {
      const d = dragDraft.current;
      dragDraft.current = null;
      if (!d || d.zone !== z) return;
      updateZone(z, { x: d.x, y: d.y }, 'drag:' + z);
      const id = get().activeDocId;
      if (id) stackFor(id).seal(); // el próximo arrastre es otro paso de deshacer
    },
  };

  // contorno de la zona activa sobre la prenda
  const activeDef = current && activeZone ? zoneDefs(current.config).find(z => z.id === activeZone) ?? null : null;
  useEffect(() => { viewer.current?.setSelection(doc && loadedId && activeDef ? activeDef : null); }, [activeZone, loadedId, current?.id, !!doc]);

  const setFlat = (on: boolean) => { viewer.current?.setFlat(on); setFlatState(on); };
  const setSpinning = (on: boolean) => { viewer.current?.setAutoRotate(on); setSpin(on); };

  // atajos de teclado del estudio (el editor 2D no está montado mientras tanto)
  const keys = useRef((_e: KeyboardEvent) => {});
  keys.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (document.querySelector('.modal') || exporting || importing) return;
    const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase(), v = viewer.current;
    if (mod && k === 'z') { e.preventDefault(); stepHistory(e.shiftKey ? 'redo' : 'undo'); return; }
    if (mod && k === 'y') { e.preventDefault(); stepHistory('redo'); return; }
    if (mod || e.altKey) return;
    const views: ViewPreset[] = ['front', 'back', 'left', 'right', 'threeQuarter'];
    if (/^[1-5]$/.test(e.key)) { v?.setView(views[+e.key - 1]); return; }
    if (k === 'f') { v?.fitView(); return; }
    if (k === 'p') { setFlat(!flat); return; }
    if (k === 'r') { setSpinning(!spin); return; }
    if (k === 'm') { setPrefs({ snap: !prefsRef.current.snap }); toast(prefsRef.current.snap ? 'Ajuste magnético desactivado' : 'Ajuste magnético activado', 'ok'); return; }
    if (e.key === '?') { setShowKeys(x => !x); return; }
    if (e.key === 'Escape') { if (showKeys) setShowKeys(false); else setActiveZone(null); return; }
    const z = activeZone;
    if (!z || !zoneCtx(z)) return;
    if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const d = e.shiftKey ? 5 : 0.5;
      nudgeZone(z, e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); updateZone(z, null); toast(`Estampado quitado de ${ZONE_LABELS[z]} (⌘/Ctrl+Z para deshacer)`, 'ok'); return; }
    if (k === 'h') { toggleFlag(z, 'hidden'); return; }
    if (k === 'l') { toggleFlag(z, 'locked'); return; }
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const hist = doc ? history.current.get(doc.id) : undefined;
  const lic = current?.license ?? current?.config.license;
  return (
    <div className="studio">
      <header className="studio-bar">
        <button className="brand" onClick={() => set({ screen: 'home' })} title="Menú principal" aria-label="KOVA Design Lab · menú principal">
          <KovaK size={24} title="" /><span className="brand-name">Estudio 3D</span>
        </button>
        <button className="icon-btn" title={prefs.lib ? 'Ocultar la biblioteca (más espacio para el visor)' : 'Mostrar la biblioteca de prendas'} aria-label="Biblioteca de prendas" aria-pressed={prefs.lib}
          onClick={() => setPrefs({ lib: !prefs.lib })}>{prefs.lib ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}</button>
        {doc ? <span className="chip" title="Documento activo: su arte se aplicará a la prenda">{doc.name}</span> : <span className="tiny muted">Sin documento abierto</span>}
        <div className="grow" />
        <button className="icon-btn" title="Deshacer (⌘/Ctrl+Z)" aria-label="Deshacer" disabled={!hist?.canUndo} onClick={() => stepHistory('undo')}><Undo2 size={15} /></button>
        <button className="icon-btn" title="Rehacer (⇧⌘Z / Ctrl+Y)" aria-label="Rehacer" disabled={!hist?.canRedo} onClick={() => stepHistory('redo')}><Redo2 size={15} /></button>
        <button className="btn sm primary" disabled={!current || loading || lost} title="Exportar imagen PNG o video giratorio" onClick={() => setExporting(true)}><ImageDown size={13} /><span className="btn-label">Exportar render</span></button>
        <button className="icon-btn" title="Menú principal" aria-label="Menú principal" onClick={() => set({ screen: 'home' })}><HomeIcon size={15} /></button>
        <button className="btn sm" disabled={!get().docs.length} onClick={() => set({ screen: 'editor' })}><ArrowLeft size={13} /><span className="btn-label">Editor 2D</span></button>
      </header>

      <div className={'studio-body' + (prefs.lib ? '' : ' no-lib')}>
        {prefs.lib && <aside className="panel studio-side" aria-label="Biblioteca de prendas">
          <div className="panel-head" style={{ cursor: 'default' }}><span className="title"><Box size={13} />Prendas</span>
            <button className="icon-btn sm" title="Importar prenda (GLB)" aria-label="Importar prenda" onClick={() => setImporting(true)}><Plus size={13} /></button>
          </div>
          <div className="panel-body studio-list">
            {garments === null ? <span className="tiny muted">Cargando…</span> : garments.length === 0 ? (
              <div className="studio-empty">
                <BrandIcon name="orbit" size={40} style={{ color: 'var(--accent)' }} />
                <span className="small">Aún no hay prendas.</span>
                <span className="tiny muted">Importa un GLB de Blender, Sketchfab o CGTrader. Se valida antes de guardarlo.</span>
                <button className="btn primary sm" disabled={addingSample} onClick={async () => {
                  setAddingSample(true);
                  try { const g = await addSampleGarment(); await refresh(); select(g); }
                  catch (e: any) { toast(e?.message || String(e), 'error'); }
                  finally { setAddingSample(false); }
                }}>{addingSample ? <Loader2 size={12} className="spin" /> : <Box size={12} />}Usar camiseta de ejemplo</button>
                <button className="btn sm" onClick={() => setImporting(true)}><Plus size={12} />Importar prenda</button>
              </div>
            ) : garments.map(g => (
              <div key={g.id} role="button" tabIndex={0} className={'garment-row' + (current?.id === g.id ? ' on' : '')}
                onClick={() => select(g)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(g); } }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.config.name}</div>
                  <div className="tiny muted">{CAT[g.config.category] ?? 'Prenda'} · {g.triangles.toLocaleString('es')} triáng.</div>
                </div>
                {g.license && !g.license.redistributable && <span className="chip" title="Licencia sin redistribución: solo en este equipo">Local</span>}
                <button className="icon-btn sm" title="Quitar de la biblioteca" aria-label={`Quitar ${g.config.name}`} onClick={e => { e.stopPropagation(); remove(g); }}><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
        </aside>}

        <section className="studio-stage" aria-label="Visor 3D">
          <div ref={stageRef} className="studio-viewport" />
          {!current && garments?.length === 0 && <div className="studio-overlay"><span className="small muted">Importa una prenda para verla en 3D</span></div>}
          {loading && <div className="studio-overlay"><Loader2 size={18} className="spin" /><span className="small">Cargando prenda…</span></div>}
          {lost && <div className="studio-overlay"><Loader2 size={18} className="spin" /><span className="small">Recuperando el visor 3D… tu trabajo no se ha perdido.</span></div>}
          {current && (
            <div className="quickbar studio-views" role="toolbar" aria-label="Vistas">
              {(Object.keys(VIEW_LABELS) as ViewPreset[]).map((v, i) => <button key={v} className="btn sm" title={`${VIEW_LABELS[v]} (${i + 1})`} onClick={() => viewer.current?.setView(v)}>{VIEW_LABELS[v]}</button>)}
              <div className="vsep" />
              <button className="icon-btn sm" title="Encuadrar la prenda (F o doble clic)" aria-label="Encuadrar" onClick={() => viewer.current?.fitView()}><Focus size={14} /></button>
              <button className={'icon-btn sm' + (flat ? ' active' : '')} title="Vista plana, casi sin perspectiva: para comprobar medidas y simetría (P)" aria-label="Vista plana" aria-pressed={flat} onClick={() => setFlat(!flat)}><Scan size={14} /></button>
              <button className={'icon-btn sm' + (spin ? ' active' : '')} title="Giro automático (R)" aria-label="Giro automático" aria-pressed={spin} onClick={() => setSpinning(!spin)}><RotateCw size={14} /></button>
              <button className={'icon-btn sm' + (prefs.snap ? ' active' : '')} title="Ajuste magnético al centro y bordes del área al arrastrar (M; Alt lo suspende)" aria-label="Ajuste magnético" aria-pressed={prefs.snap} onClick={() => setPrefs({ snap: !prefs.snap })}><Magnet size={14} /></button>
              <button className={'icon-btn sm' + (showKeys ? ' active' : '')} title="Atajos de teclado (?)" aria-label="Atajos de teclado" aria-pressed={showKeys} onClick={() => setShowKeys(!showKeys)}><Keyboard size={14} /></button>
            </div>
          )}
          {showKeys && (
            <div className="studio-keys card" role="dialog" aria-label="Atajos del Estudio 3D">
              <div className="row"><b className="small grow">Atajos del Estudio 3D</b><button className="icon-btn sm" aria-label="Cerrar" onClick={() => setShowKeys(false)}>×</button></div>
              <dl>{SHORTCUTS.map(([k, d]) => <React.Fragment key={k}><dt>{k}</dt><dd>{d}</dd></React.Fragment>)}</dl>
            </div>
          )}
        </section>

        <aside className="panel studio-side" aria-label="Escena">
          <div className="panel-head" style={{ cursor: 'default' }}><span className="title">Escena</span></div>
          <div className="panel-body">
            <div className="section-title">Iluminación</div>
            <Seg full value={prefs.light} onChange={v => setPrefs({ light: v })} options={(Object.keys(LIGHT_LABELS) as LightPreset[]).map(l => ({ value: l, label: LIGHT_LABELS[l] }))} />
            <div className="section-title">Fondo</div>
            <div className="row">
              <Seg value={prefs.bg ? 'color' : 'none'} onChange={v => setPrefs({ bg: v === 'none' ? null : prefs.bg ?? '#00001f' })} options={[{ value: 'none', label: 'Transparente' }, { value: 'color', label: 'Color' }]} />
              {prefs.bg && <ColorInput value={prefs.bg} onChange={c => setPrefs({ bg: c })} title="Color de fondo" />}
            </div>
            <div className="tiny muted">Arrastra para girar o, sobre un estampado, para moverlo · rueda para acercar · clic derecho o Mayús para desplazar · doble clic para encuadrar.</div>
            <div className="section-title">Calidad del visor</div>
            <Select value={prefs.quality} onChange={(v: QualityMode) => setPrefs({ quality: v })} title={QUALITY_HINTS[prefs.quality]}
              options={(Object.keys(QUALITY_LABELS) as QualityMode[]).map(q => ({ value: q, label: QUALITY_LABELS[q] }))} />
            <div className="tiny muted">{QUALITY_HINTS[prefs.quality]}. Los renders exportados siempre salen a máxima calidad.</div>
            {current && <>
              <div className="section-title">Prenda</div>
              <div className="card col" style={{ gap: 4, padding: 8 }}>
                <div className="small" style={{ fontWeight: 600 }}>{current.config.name}</div>
                <div className="tiny muted">{(current.sizeM[0] * 100).toFixed(0)} × {(current.sizeM[1] * 100).toFixed(0)} cm · {current.triangles.toLocaleString('es')} triángulos</div>
                {lic && <div className="tiny muted">{lic.name}{lic.author ? ` · ${lic.author}` : ''}</div>}
                {lic?.source && <a className="tiny" href={lic.source} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--accent-hover)' }}>Fuente del modelo <ExternalLink size={10} /></a>}
                {lic && !lic.redistributable && <div className="tiny" style={{ color: 'var(--warn)' }}>Licencia sin redistribución: no se publica con la app.</div>}
                <Check checked={current.config.useBaseColorMap !== false} title="Desactívala si el modelo trae una cuadrícula de prueba UV en lugar de su color"
                  label="Textura de color del modelo" onChange={async v => {
                    try {
                      const g = await updateGarmentConfig(current, { useBaseColorMap: v });
                      await refresh();
                      select(g, !!doc?.garment3d);
                    } catch (e: any) { toast(e.message, 'error'); }
                  }} />
              </div>
              {fabric && <>
                <div className="section-title">Material</div>
                <Seg full value={fabric.preset} onChange={(v: FabricPreset) => updateFabric({ preset: v, roughness: FABRICS[v].roughness, normalScale: FABRICS[v].normalScale })}
                  options={(Object.keys(FABRICS) as FabricPreset[]).map(p => ({ value: p, label: FABRICS[p].label, title: FABRICS[p].hint }))} />
                <div className="row" style={{ flexWrap: 'wrap', gap: 6 }} role="group" aria-label="Color de la tela">
                  {SWATCHES.map(c => (
                    <button key={c.hex} className={'swatch-btn' + (fabric.color.toLowerCase() === c.hex ? ' on' : '')} style={{ background: c.hex }}
                      title={c.name} aria-label={`Tela ${c.name}`} aria-pressed={fabric.color.toLowerCase() === c.hex} onClick={() => updateFabric({ color: c.hex })} />
                  ))}
                  <ColorInput value={fabric.color} onChange={c => updateFabric({ color: c })} title="Otro color de tela" />
                  <button className={'chip' + (fabric.color.toLowerCase() === '#ffffff' ? ' on' : '')} style={{ cursor: 'pointer' }} title="Sin teñir: el color propio del modelo" onClick={() => updateFabric({ color: '#ffffff' })}>Sin teñir</button>
                </div>
                <div className="small muted">Acabado</div>
                <Seg full value={fabric.finish} onChange={(v: FabricFinish) => updateFabric({ finish: v })} options={(Object.keys(FINISHES) as FabricFinish[]).map(f => ({ value: f, label: FINISHES[f] }))} />
                <Slider label="Rugosidad" value={Math.round(fabric.roughness * 100)} min={20} max={100} suffix="%" hint="Más alta = más mate" onChange={v => updateFabric({ roughness: v / 100 })} />
                <Slider label="Relieve del tejido" value={Math.round(fabric.normalScale * 100)} min={0} max={200} suffix="%" hint="Intensidad del punto, la felpa o la malla" onChange={v => updateFabric({ normalScale: v / 100 })} />
              </>}
              <div className="section-title">Estampados</div>
              {!doc ? <div className="tiny muted">Abre o crea un documento en el editor 2D: sus mesas de trabajo se estampan en la prenda.</div>
                : zoneDefs(current.config).map(def => {
                  const p = zones?.[def.id], r = results[def.id], open = activeZone === def.id;
                  const ab = p?.artboardId ? doc.state.artboards.find(a => a.id === p.artboardId) : undefined;
                  const art = ab && p ? artInfo(ab, inks[ab.id], p.flipX) : null;
                  const m = art && p ? measures(def, p, art) : null;
                  const box = art && p ? inkBoxCm(def, p, art) : null;
                  const alignTo = (h: HAlign | null, v: VAlign | null) => art && p && updateZone(def.id, align(def, p, art, h, v), 'align:' + def.id);
                  return (
                    <div key={def.id} id={'zone-card-' + def.id} className={'zone-card' + (open ? ' on' : '')}>
                      <button className="zone-head" aria-expanded={open} onClick={() => { setActiveZone(open ? null : def.id); if (!open) viewer.current?.setView(def.view); }}>
                        <span className="small grow" style={{ fontWeight: 600 }}>{ZONE_LABELS[def.id]}</span>
                        {p?.locked && <Lock size={11} aria-label="Bloqueado" />}
                        {ab && p ? (
                          p.hidden ? <span className="chip">Oculto</span> :
                          <span className="chip" title={r?.reason} style={r?.mode === 'none' ? { color: 'var(--warn)' } : undefined}>
                            {!r ? '…' : r.mode === 'uv' ? 'Atlas UV' : r.mode === 'decal' ? 'Proyección' : 'Sin aplicar'}
                          </span>
                        ) : <span className="tiny muted">Vacía</span>}
                      </button>
                      {open && (
                        <div className="col" style={{ gap: 6, marginTop: 6 }}>
                          <Select value={ab ? ab.id : ''} onChange={v => chooseArt(def, v)} title={`Mesa de trabajo para ${ZONE_LABELS[def.id]}`}
                            options={[{ value: '', label: 'Sin estampado' }, ...doc.state.artboards.map(a => ({ value: a.id, label: a.name }))]} />
                          {ab && p && art && m && box && <>
                            <div className="row" style={{ flexWrap: 'wrap', gap: 4 }} role="group" aria-label="Colocación rápida">
                              {presets(def).map(pr => (
                                <button key={pr.id} className="chip" style={{ cursor: 'pointer' }} title={pr.title} disabled={p.locked}
                                  onClick={() => updateZone(def.id, applyPreset(def, p, art, pr.id))}>{pr.label}</button>
                              ))}
                            </div>
                            <div className="row zone-align" role="group" aria-label="Alinear en el área de impresión">
                              <button className="icon-btn sm" title="Alinear a la izquierda del área" aria-label="Alinear a la izquierda" disabled={p.locked} onClick={() => alignTo('left', null)}><AlignStartVertical size={13} /></button>
                              <button className="icon-btn sm" title="Centrar en horizontal" aria-label="Centrar en horizontal" disabled={p.locked} onClick={() => alignTo('center', null)}><AlignCenterVertical size={13} /></button>
                              <button className="icon-btn sm" title="Alinear a la derecha del área" aria-label="Alinear a la derecha" disabled={p.locked} onClick={() => alignTo('right', null)}><AlignEndVertical size={13} /></button>
                              <div className="vsep" />
                              <button className="icon-btn sm" title="Alinear arriba del área" aria-label="Alinear arriba" disabled={p.locked} onClick={() => alignTo(null, 'top')}><AlignStartHorizontal size={13} /></button>
                              <button className="icon-btn sm" title="Centrar en vertical" aria-label="Centrar en vertical" disabled={p.locked} onClick={() => alignTo(null, 'middle')}><AlignCenterHorizontal size={13} /></button>
                              <button className="icon-btn sm" title="Alinear abajo del área" aria-label="Alinear abajo" disabled={p.locked} onClick={() => alignTo(null, 'bottom')}><AlignEndHorizontal size={13} /></button>
                            </div>
                            <div className="zone-fields">
                              <NumberField label="Ancho" suffix="cm" digits={1} step={0.1} min={0.5} max={def.sizeCm[0] * 3} value={m.width} disabled={p.locked}
                                title="Ancho de lo impreso (la parte con tinta). Conserva el centro y la distancia al borde superior"
                                onChange={w => updateZone(def.id, setInkWidth(def, p, art, w), 'width:' + def.id)} />
                              <NumberField label="Giro" suffix="°" digits={0} step={1} min={-180} max={180} value={p.rotation} disabled={p.locked}
                                title="Giro alrededor del centro de lo impreso" onChange={d => rotateTo(def.id, d)} />
                              <NumberField label="Centro" suffix="cm" digits={1} step={0.1} value={m.fromCenter} disabled={p.locked}
                                title="Desplazamiento del centro de lo impreso respecto al eje del área (positivo = a la derecha, visto desde su lado)"
                                onChange={x => updateZone(def.id, inkCenterTo(def, p, art, def.sizeCm[0] / 2 + x, box.cy), 'x:' + def.id)} />
                              <NumberField label="Arriba" suffix="cm" digits={1} step={0.1} value={m.fromTop} disabled={p.locked}
                                title="Distancia del borde superior de lo impreso al inicio del área de impresión"
                                onChange={y => updateZone(def.id, inkCenterTo(def, p, art, box.cx, y + box.h / 2), 'y:' + def.id)} />
                            </div>
                            <Slider label="Escala" value={Math.round(p.scale * 100)} min={10} max={200} suffix="%" hint="100 % = tamaño real de la mesa de trabajo"
                              onChange={v => !p.locked && updateZone(def.id, { scale: v / 100 }, 'scale:' + def.id)} />
                            <div className="row zone-tools" role="group" aria-label="Herramientas del estampado">
                              <button className="icon-btn sm" title="Girar 90° a la izquierda" aria-label="Girar 90° a la izquierda" disabled={p.locked} onClick={() => rotateTo(def.id, p.rotation - 90, undefined)}><RotateCcw size={13} /></button>
                              <button className="icon-btn sm" title="Girar 90° a la derecha" aria-label="Girar 90° a la derecha" disabled={p.locked} onClick={() => rotateTo(def.id, p.rotation + 90, undefined)}><RotateCw size={13} /></button>
                              <button className={'icon-btn sm' + (p.flipX ? ' active' : '')} title="Espejo horizontal" aria-label="Espejo horizontal" aria-pressed={!!p.flipX} disabled={p.locked} onClick={() => toggleFlip(def.id)}><FlipHorizontal2 size={13} /></button>
                              <div className="grow" />
                              <button className={'icon-btn sm' + (p.hidden ? ' active' : '')} title={p.hidden ? 'Mostrar (H)' : 'Ocultar en el visor y en los renders (H)'} aria-label={p.hidden ? 'Mostrar estampado' : 'Ocultar estampado'} aria-pressed={!!p.hidden} onClick={() => toggleFlag(def.id, 'hidden')}>{p.hidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>
                              <button className={'icon-btn sm' + (p.locked ? ' active' : '')} title={p.locked ? 'Desbloquear (L)' : 'Bloquear: no se mueve al arrastrar ni con las flechas (L)'} aria-label={p.locked ? 'Desbloquear estampado' : 'Bloquear estampado'} aria-pressed={!!p.locked} onClick={() => toggleFlag(def.id, 'locked')}>{p.locked ? <Lock size={13} /> : <Unlock size={13} />}</button>
                              <button className="icon-btn sm" title="Quitar el estampado (Supr)" aria-label="Quitar estampado" onClick={() => updateZone(def.id, null)}><Trash2 size={13} /></button>
                            </div>
                            <div className="tiny muted">
                              Impreso {m.width.toFixed(1)} × {m.height.toFixed(1)} cm · área de la zona {def.sizeCm[0]} × {def.sizeCm[1]} cm
                            </div>
                            {r?.overflow && !p.hidden && <div className="tiny" style={{ color: 'var(--warn)' }}>Se sale del área de impresión de la zona.</div>}
                            {r?.mode === 'decal' && <div className="tiny muted">{r.reason} Se proyecta como calcomanía.</div>}
                            {r?.mode === 'none' && !p.hidden && <div className="tiny" style={{ color: 'var(--warn)' }}>{r.reason}</div>}
                          </>}
                        </div>
                      )}
                    </div>
                  );
                })}
            </>}
          </div>
        </aside>
      </div>
      {exporting && viewer.current && current && <ExportRenderDialog viewer={viewer.current} name={doc ? `${doc.name} - ${current.config.name}` : current.config.name} background={prefs.bg} onClose={() => setExporting(false)} />}
      {importing && <ImportGarmentDialog onClose={() => setImporting(false)} onAdded={g => { refresh(); select(g); }} />}
    </div>
  );
}
