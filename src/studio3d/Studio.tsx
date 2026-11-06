import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Home as HomeIcon, Plus, Trash2, Box, Loader2, Crosshair, ExternalLink } from 'lucide-react';
import { useStore, set, get, toast } from '../core/store';
import { KovaK, BrandIcon } from '../ui/components/Brand';
import { Seg, ColorInput } from '../ui/components/controls';
import { GarmentViewer, VIEW_LABELS, LIGHT_LABELS, type ViewPreset, type LightPreset } from './viewer';
import { listGarments, removeGarment, garmentModel, type GarmentEntry } from './garments';
import { ImportGarmentDialog } from './ImportGarmentDialog';
import { GARMENT3D_SCHEMA } from '../core/garment3d';

// preferencias del estudio (solo interfaz): LocalStorage
const PREFS = 'kova.studio';
interface StudioPrefs { garment?: string; light: LightPreset; bg: string | null }
const loadPrefs = (): StudioPrefs => { try { return { light: 'studio', bg: null, ...JSON.parse(localStorage.getItem(PREFS) || '{}') }; } catch { return { light: 'studio', bg: null }; } };
const savePrefs = (p: StudioPrefs) => { try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch { /* sin almacenamiento */ } };

const CAT: Record<string, string> = { tshirt: 'Camiseta', hoodie: 'Hoodie', sport: 'Deportiva', crop: 'Crop', longsleeve: 'Manga larga', other: 'Prenda' };

/** Estudio 3D: biblioteca de prendas, visor y escena. El arte sigue saliendo del editor 2D. */
export function Studio() {
  const doc = useStore(s => s.docs.find(d => d.id === s.activeDocId));
  const stageRef = useRef<HTMLDivElement>(null);
  const viewer = useRef<GarmentViewer | null>(null);
  const [garments, setGarments] = useState<GarmentEntry[] | null>(null);
  const [prefs, setPrefsState] = useState<StudioPrefs>(loadPrefs);
  const [current, setCurrent] = useState<GarmentEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [lost, setLost] = useState(false);
  const [importing, setImporting] = useState(false);
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
    try { await viewer.current?.setGarment(await garmentModel(g), g.config); }
    catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
    if (link) linkToDoc(g);
  };

  /** Guarda en el documento activo qué prenda usa (sección garment3d del .kova). */
  const linkToDoc = (g: GarmentEntry) => {
    const id = get().activeDocId;
    if (!id) return;
    set(s => ({
      docs: s.docs.map(d => d.id !== id ? d : {
        ...d, dirty: true,
        garment3d: {
          schema: GARMENT3D_SCHEMA,
          model: { source: 'asset', hash: g.modelHash, name: g.config.name, config: g.config as unknown as Record<string, unknown> },
          color: d.garment3d?.color ?? '#f0e7de',
          material: d.garment3d?.material ?? { preset: 'cotton', roughness: 0.85, normalScale: 1 },
          zones: d.garment3d?.zones ?? {},
          lighting: { preset: prefs.light, background: prefs.bg },
        },
      }),
    }));
  };

  const remove = async (g: GarmentEntry) => {
    if (!confirm(`¿Quitar «${g.config.name}» de la biblioteca? Los proyectos que la usan la conservan dentro del .kova.`)) return;
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
                <button className="btn primary sm" onClick={() => setImporting(true)}><Plus size={12} />Importar prenda</button>
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
              </div>
              <div className="tiny muted">Los estampados por zona llegan en la siguiente fase.</div>
            </>}
          </div>
        </aside>
      </div>
      {importing && <ImportGarmentDialog onClose={() => setImporting(false)} onAdded={g => { refresh(); select(g); }} />}
    </div>
  );
}
