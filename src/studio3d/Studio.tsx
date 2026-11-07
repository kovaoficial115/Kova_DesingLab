import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Home as HomeIcon, Plus, Trash2, Box, Loader2, Crosshair, ExternalLink, ImageDown } from 'lucide-react';
import { useStore, set, get, toast } from '../core/store';
import { KovaK, BrandIcon } from '../ui/components/Brand';
import { Seg, ColorInput, Select, Slider, Check } from '../ui/components/controls';
import { GarmentViewer, VIEW_LABELS, LIGHT_LABELS, type ViewPreset, type LightPreset } from './viewer';
import { listGarments, removeGarment, garmentModel, updateGarmentConfig, addSampleGarment, type GarmentEntry } from './garments';
import { ImportGarmentDialog } from './ImportGarmentDialog';
import { ExportRenderDialog } from './ExportRenderDialog';
import { GARMENT3D_SCHEMA, type Garment3DData, type PrintZoneId, type ZonePrint } from '../core/garment3d';
import type { Doc } from '../core/types';
import { renderArtboard } from '../core/render';
import { zoneDefs, ZONE_LABELS, type ZoneDef } from './zones';
import { inkBox, type PreparedPrint, type PrintResult } from './prints';
import { FABRICS, FINISHES, SWATCHES, defaultFabric, isPreset, isFinish, type FabricSettings, type FabricPreset, type FabricFinish } from './fabric';
import { fabricOf } from './config';
import { platform } from '../platform';

// preferencias del estudio (solo interfaz): LocalStorage
const PREFS = 'kova.studio';
interface StudioPrefs { garment?: string; light: LightPreset; bg: string | null }
const loadPrefs = (): StudioPrefs => { try { return { light: 'studio', bg: null, ...JSON.parse(localStorage.getItem(PREFS) || '{}') }; } catch { return { light: 'studio', bg: null }; } };
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
  const [activeZone, setActiveZone] = useState<PrintZoneId>('front');
  // tela cuando no hay documento abierto (con documento se guarda en su .kova)
  const [localFabric, setLocalFabric] = useState<FabricSettings | null>(null);
  // arte renderizado por mesa de trabajo; se invalida cuando cambia el documento
  const artCache = useRef<{ state: unknown; map: Map<string, Promise<Art>> }>({ state: null, map: new Map() });
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
    viewer.current = v;
    (window as any).__kovaViewer = v; // diagnóstico
    // si el visor se vuelve a crear con una prenda ya elegida (recarga en caliente), se recarga en él
    if (currentRef.current) select(currentRef.current, false);
    return () => { v.dispose(); viewer.current = null; delete (window as any).__kovaViewer; };
  }, []);

  useEffect(() => { viewer.current?.setLighting(prefs.light); }, [prefs.light]);
  useEffect(() => { viewer.current?.setBackground(prefs.bg); }, [prefs.bg]);

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
    lighting: { preset: prefs.light, background: prefs.bg },
    };
  };

  /** Guarda en el documento activo qué prenda usa (sección garment3d del .kova). */
  const linkToDoc = (g: GarmentEntry) => {
    const id = get().activeDocId;
    if (!id) return;
    set(s => ({ docs: s.docs.map(d => d.id !== id ? d : { ...d, dirty: true, garment3d: garmentData(g, d) }) }));
  };

  /** Cambia (o quita, con null) el estampado de una zona del documento activo. */
  const updateZone = (z: PrintZoneId, patch: Partial<ZonePrint> | null) => {
    const id = get().activeDocId, g = current;
    if (!id || !g) return;
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
  const updateFabric = (patch: Partial<FabricSettings>) => {
    const id = get().activeDocId, g = current;
    if (!g) return;
    if (!id) { setLocalFabric(prev => ({ ...(prev ?? defaultFabric(fabricOf(g.config))), ...patch })); return; }
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
            if (!ink) { empty.push({ zone: def.id, mode: 'none', reason: 'La mesa de trabajo está vacía.', overflow: false }); continue; }
            list.push({ zone: def, print: p, image, ink, sizeM: [(ab.w / ab.dpi) * IN_PER_M, (ab.h / ab.dpi) * IN_PER_M] });
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

  const lic = current?.license ?? current?.config.license;
  return (
    <div className="studio">
      <header className="studio-bar">
        <button className="brand" onClick={() => set({ screen: 'home' })} title="Menú principal" aria-label="KOVA Design Lab · menú principal">
          <KovaK size={24} title="" /><span className="brand-name">Estudio 3D</span>
        </button>
        {doc ? <span className="chip" title="Documento activo: su arte se aplicará a la prenda">{doc.name}</span> : <span className="tiny muted">Sin documento abierto</span>}
        <div className="grow" />
        <button className="btn sm primary" disabled={!current || loading || lost} title="Exportar imagen PNG o video giratorio" onClick={() => setExporting(true)}><ImageDown size={13} /><span className="btn-label">Exportar render</span></button>
        <button className="icon-btn" title="Menú principal" aria-label="Menú principal" onClick={() => set({ screen: 'home' })}><HomeIcon size={15} /></button>
        <button className="btn sm" disabled={!get().docs.length} onClick={() => set({ screen: 'editor' })}><ArrowLeft size={13} /><span className="btn-label">Editor 2D</span></button>
      </header>

      <div className="studio-body">
        <aside className="panel studio-side" aria-label="Biblioteca de prendas">
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
        </aside>

        <section className="studio-stage" aria-label="Visor 3D">
          <div ref={stageRef} className="studio-viewport" />
          {!current && garments?.length === 0 && <div className="studio-overlay"><span className="small muted">Importa una prenda para verla en 3D</span></div>}
          {loading && <div className="studio-overlay"><Loader2 size={18} className="spin" /><span className="small">Cargando prenda…</span></div>}
          {lost && <div className="studio-overlay"><Loader2 size={18} className="spin" /><span className="small">Recuperando el visor 3D… tu trabajo no se ha perdido.</span></div>}
          {current && (
            <div className="quickbar studio-views" role="toolbar" aria-label="Vistas">
              {(Object.keys(VIEW_LABELS) as ViewPreset[]).map(v => <button key={v} className="btn sm" onClick={() => viewer.current?.setView(v)}>{VIEW_LABELS[v]}</button>)}
              <div className="vsep" />
              <button className="btn sm" title="Centrar" onClick={() => viewer.current?.setView('front')}><Crosshair size={13} /><span className="qb-label">Centrar</span></button>
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
            <div className="tiny muted">Arrastra para girar · rueda o pellizco para acercar · clic derecho o Mayús para desplazar.</div>
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
                  return (
                    <div key={def.id} className={'zone-card' + (open ? ' on' : '')}>
                      <button className="zone-head" aria-expanded={open} onClick={() => { setActiveZone(def.id); viewer.current?.setView(def.view); }}>
                        <span className="small grow" style={{ fontWeight: 600 }}>{ZONE_LABELS[def.id]}</span>
                        {ab && p ? (
                          <span className="chip" title={r?.reason} style={r?.mode === 'none' ? { color: 'var(--warn)' } : undefined}>
                            {!r ? '…' : r.mode === 'uv' ? 'Atlas UV' : r.mode === 'decal' ? 'Proyección' : 'Sin aplicar'}
                          </span>
                        ) : <span className="tiny muted">Vacía</span>}
                      </button>
                      {open && (
                        <div className="col" style={{ gap: 6, marginTop: 6 }}>
                          <Select value={ab ? ab.id : ''} onChange={v => chooseArt(def, v)} title={`Mesa de trabajo para ${ZONE_LABELS[def.id]}`}
                            options={[{ value: '', label: 'Sin estampado' }, ...doc.state.artboards.map(a => ({ value: a.id, label: a.name }))]} />
                          {ab && p && <>
                            <Slider label="Horizontal" value={Math.round(p.x * 100)} min={0} max={100} suffix="%" onChange={v => updateZone(def.id, { x: v / 100 })} />
                            <Slider label="Vertical" value={Math.round(p.y * 100)} min={0} max={100} suffix="%" onChange={v => updateZone(def.id, { y: v / 100 })} />
                            <Slider label="Escala" value={Math.round(p.scale * 100)} min={10} max={200} suffix="%" hint="100 % = tamaño real de la mesa de trabajo" onChange={v => updateZone(def.id, { scale: v / 100 })} />
                            <Slider label="Rotación" value={p.rotation} min={-180} max={180} suffix="°" onChange={v => updateZone(def.id, { rotation: v })} />
                            <div className="tiny muted">
                              {r?.inkCm ? <>Estampado {r.inkCm[0].toFixed(1)} × {r.inkCm[1].toFixed(1)} cm</> : <>Mesa {(cmOf(ab.w, ab.dpi) * p.scale).toFixed(1)} × {(cmOf(ab.h, ab.dpi) * p.scale).toFixed(1)} cm</>} · área de la zona {def.sizeCm[0]} × {def.sizeCm[1]} cm
                            </div>
                            {r?.overflow && <div className="tiny" style={{ color: 'var(--warn)' }}>Se sale del área de impresión de la zona.</div>}
                            {r?.mode === 'decal' && <div className="tiny muted">{r.reason} Se proyecta como calcomanía.</div>}
                            {r?.mode === 'none' && <div className="tiny" style={{ color: 'var(--warn)' }}>{r.reason}</div>}
                            <button className="btn sm ghost" onClick={() => updateZone(def.id, null)}>Quitar estampado</button>
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
