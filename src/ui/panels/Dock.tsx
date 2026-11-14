import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, GripVertical, X, Palette, SlidersHorizontal, Layers, History, Frame, Settings2, Plus, Trash2, Copy, FileUp, Smartphone, Stamp } from 'lucide-react';
import { SocialPanel } from '../../social/ui/SocialPanel';
import { BrandPanel } from '../../brand/ui/BrandPanel';
import { useStore, set, jumpHistory, commit } from '../../core/store';
import type { PanelId } from '../../core/store';
import type { Doc } from '../../core/types';
import { LayersPanel } from './LayersPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { AdjustmentsPanel } from './AdjustmentsPanel';
import { ColorPanel } from './ColorPanel';
import * as A from '../../core/actions';
import { fromPx, uid } from '../../core/util';
import { Seg, Check, Select } from '../components/controls';
import { cmsState, hasIcc, loadIccProfile, unloadIccProfile, setCmsOptions } from '../../engine/cms';
import { pickFiles } from '../../io/fileOps';
import { toast } from '../../core/store';

const meta: Record<PanelId, { title: string; icon: any }> = {
  color: { title: 'Color', icon: Palette },
  properties: { title: 'Propiedades', icon: Settings2 },
  adjustments: { title: 'Ajustes', icon: SlidersHorizontal },
  layers: { title: 'Capas', icon: Layers },
  history: { title: 'Historial', icon: History },
  artboards: { title: 'Mesas de trabajo', icon: Frame },
  channels: { title: 'Canales y color', icon: Palette },
  social: { title: 'Redes sociales', icon: Smartphone },
  brand: { title: 'Marca', icon: Stamp },
};

function HistoryPanel({ doc }: { doc: Doc }) {
  const items = [...doc.past.map(p => ({ label: p.label, kind: 'past' })), { label: doc.lastLabel, kind: 'current' }, ...doc.future.map(f => ({ label: f.label, kind: 'future' }))];
  return (
    <div className="col" style={{ gap: 1, maxHeight: 260, overflowY: 'auto' }}>
      {items.map((it, i) => (
        <div key={i} className={'hist-item ' + it.kind} onClick={() => jumpHistory(i)}>
          <History size={12} /><span className="grow">{it.label}</span>
        </div>
      ))}
      <div className="tiny muted" style={{ marginTop: 4 }}>{doc.past.length} pasos · máx. 60</div>
    </div>
  );
}

const PRESETS = [
  { name: 'Pecho A4', w: 21, h: 29.7 }, { name: 'Pecho 28×35', w: 28, h: 35 }, { name: 'Espalda 30×40', w: 30, h: 40 },
  { name: 'Bolsillo 10×10', w: 10, h: 10 }, { name: 'Manga 8×30', w: 8, h: 30 }, { name: 'Gorra 12×6', w: 12, h: 6 },
];

function ArtboardsPanel({ doc }: { doc: Doc }) {
  const s = doc.state;
  const unit = useStore(x => x.unit);
  return (
    <>
      <div className="col" style={{ gap: 2 }}>
        {s.artboards.map(ab => (
          <div key={ab.id} className={'hist-item' + (ab.id === s.activeArtboardId ? ' current' : '')} onClick={() => A.setActiveArtboard(ab.id)}
            onDoubleClick={() => A.fitToScreen(ab)}>
            <Frame size={12} />
            <span className="grow">{ab.name}</span>
            <span className="tiny muted mono">{fromPx(ab.w, unit, ab.dpi).toFixed(1)}×{fromPx(ab.h, unit, ab.dpi).toFixed(1)}</span>
            <button className="icon-btn sm" title="Duplicar mesa" onClick={e => { e.stopPropagation(); A.addArtboard({ ...ab, id: uid('ab'), name: ab.name + ' copia', x: ab.x + ab.w + 200 }); }}><Copy size={11} /></button>
            <button className="icon-btn sm" title="Eliminar mesa" onClick={e => { e.stopPropagation(); A.deleteArtboard(ab.id); }}><Trash2 size={11} /></button>
          </div>
        ))}
      </div>
      <button className="btn sm" onClick={() => A.addArtboard()}><Plus size={12} />Nueva mesa</button>
      <div className="section-title">Tamaños DTF habituales (cm)</div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
        {PRESETS.map(p => (
          <button key={p.name} className="chip" style={{ cursor: 'pointer' }} onClick={() => {
            const ab = s.artboards.find(a => a.id === s.activeArtboardId)!;
            A.updateArtboard(ab.id, { w: Math.round((p.w / 2.54) * ab.dpi), h: Math.round((p.h / 2.54) * ab.dpi) }, 'Tamaño de mesa');
          }}>{p.name}</button>
        ))}
      </div>
      <div className="tiny muted">Doble clic en una mesa para encuadrarla. Exporta cada mesa por separado o todas a la vez.</div>
    </>
  );
}

function ChannelsPanel({ doc }: { doc: Doc }) {
  const channelView = useStore(s => s.channelView);
  const proof = useStore(s => s.proof);
  const [, force] = useState(0);
  useEffect(() => { const f = () => force(x => x + 1); cmsState.listeners.add(f); return () => { cmsState.listeners.delete(f); }; }, []);
  return (
    <>
      <div className="section-title">Ver canal</div>
      <Seg value={channelView} onChange={v => set({ channelView: v })} full options={[{ value: 'all', label: 'Todo' }, { value: 'r', label: 'R' }, { value: 'g', label: 'G' }, { value: 'b', label: 'B' }, { value: 'alpha', label: 'α' }]} />
      <Seg value={channelView} onChange={v => set({ channelView: v })} full options={[{ value: 'c', label: 'C' }, { value: 'm', label: 'M' }, { value: 'y', label: 'Y' }, { value: 'k', label: 'K' }]} />
      <Check checked={proof} onChange={v => set({ proof: v })} label="Prueba de color CMYK en pantalla" />
      <div className="section-title">Perfil de salida</div>
      <div className="card" style={{ padding: 8 }}>
        <div className="small" style={{ fontWeight: 500 }}>{hasIcc() ? cmsState.profileName : 'Sin perfil ICC'}</div>
        <div className="tiny muted">{hasIcc() ? 'Conversión real con LittleCMS (WASM).' : 'Conversión por fórmula con GCR y límite de tinta: aproximada, no representa el gamut de tu impresora.'}</div>
        <div className="row" style={{ marginTop: 6 }}>
          <button className="btn sm" onClick={async () => {
            const [f] = await pickFiles(false, '.icc,.icm');
            if (!f) return;
            try { await loadIccProfile(new Uint8Array(await f.arrayBuffer()), f.name); toast('Perfil ICC cargado', 'ok'); useStore.setState(s => ({ renderTick: s.renderTick + 1 })); }
            catch (e: any) { toast(e.message, 'error'); }
          }}><FileUp size={12} />Cargar perfil CMYK (.icc)</button>
          {hasIcc() && <button className="btn sm ghost" onClick={() => { unloadIccProfile(); useStore.setState(s => ({ renderTick: s.renderTick + 1 })); }}>Quitar</button>}
        </div>
      </div>
      {hasIcc() ? (
        <div className="grid2">
          <Select value={String(cmsState.intent) as any} onChange={v => { setCmsOptions({ intent: +v }); useStore.setState(s => ({ renderTick: s.renderTick + 1 })); }}
            options={[{ value: '0', label: 'Perceptual' }, { value: '1', label: 'Colorim. relativo' }, { value: '2', label: 'Saturación' }, { value: '3', label: 'Colorim. absoluto' }]} />
          <Check checked={cmsState.bpc} onChange={v => { setCmsOptions({ bpc: v }); useStore.setState(s => ({ renderTick: s.renderTick + 1 })); }} label="Compensar punto negro" />
        </div>
      ) : (
        <button className="btn sm" onClick={() => set({ dialog: { type: 'color-settings' } })}>GCR y límite de tinta…</button>
      )}
      <span className="tiny muted">Documento en modo {doc.colorMode}. Separaciones reales: DTF → Separación de canales.</span>
    </>
  );
}

export function Dock({ doc, drawer = false, open = false }: { doc: Doc; drawer?: boolean; open?: boolean }) {
  const panels = useStore(s => s.panels);
  const width = useStore(s => s.rightWidth);
  // el panel de redes aparece en el espacio «Redes» o cuando el documento tiene mesas sociales
  const workspace = useStore(s => s.workspace);
  const socialDoc = workspace === 'social' || doc.state.artboards.some(a => a.social?.preset);
  const [dragId, setDragId] = useState<PanelId | null>(null);
  const [overId, setOverId] = useState<PanelId | null>(null);
  const toggle = (id: PanelId, patch: Partial<{ visible: boolean; collapsed: boolean }>) => set(s => ({ panels: s.panels.map(p => (p.id === id ? { ...p, ...patch } : p)) }));
  const reorder = (from: PanelId, to: PanelId) => set(s => {
    const arr = [...s.panels];
    const i = arr.findIndex(p => p.id === from), j = arr.findIndex(p => p.id === to);
    const [p] = arr.splice(i, 1);
    arr.splice(j, 0, p);
    return { panels: arr };
  });
  const startResize = (e: React.PointerEvent) => {
    const sx = e.clientX, w0 = width;
    const mv = (ev: PointerEvent) => set({ rightWidth: Math.max(240, Math.min(520, w0 - (ev.clientX - sx))) });
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  const body = (id: PanelId) => {
    switch (id) {
      case 'color': return <ColorPanel />;
      case 'properties': return <PropertiesPanel doc={doc} />;
      case 'adjustments': return <AdjustmentsPanel doc={doc} />;
      case 'layers': return <LayersPanel doc={doc} />;
      case 'history': return <HistoryPanel doc={doc} />;
      case 'artboards': return <ArtboardsPanel doc={doc} />;
      case 'channels': return <ChannelsPanel doc={doc} />;
      case 'social': return <SocialPanel doc={doc} />;
      case 'brand': return <BrandPanel doc={doc} />;
    }
  };
  return (
    <div className={'dock' + (drawer ? ' drawer' : '') + (open ? ' open' : '')} style={drawer ? undefined : { width }}
      role={drawer ? 'dialog' : undefined} aria-label={drawer ? 'Paneles' : undefined} aria-hidden={drawer && !open ? true : undefined}>
      {drawer ? (
        <div className="dock-head">
          <span className="grow">Paneles</span>
          <button className="icon-btn sm" title="Cerrar paneles" aria-label="Cerrar paneles" onClick={() => set({ dockOpen: false })}><X size={13} /></button>
        </div>
      ) : <div className="dock-resizer" onPointerDown={startResize} title="Arrastra para cambiar el ancho" />}
      {panels.filter(p => p.visible && (p.id !== 'social' || socialDoc)).map(p => {
        const M = meta[p.id];
        return (
          <div key={p.id} className={'panel' + (p.id === 'layers' && !p.collapsed ? ' fill' : '') + (overId === p.id && dragId !== p.id ? ' drag-over' : '')}
            onDragOver={e => { if (dragId) { e.preventDefault(); setOverId(p.id); } }}
            onDrop={e => { e.preventDefault(); if (dragId && dragId !== p.id) reorder(dragId, p.id); setDragId(null); setOverId(null); }}>
            <div className="panel-head" role="button" tabIndex={0} aria-expanded={!p.collapsed}
              onClick={() => toggle(p.id, { collapsed: !p.collapsed })}
              onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); toggle(p.id, { collapsed: !p.collapsed }); } }}>
              <span className="grip" draggable onDragStart={e => { setDragId(p.id); e.dataTransfer.setData('text/panel', p.id); }} onDragEnd={() => { setDragId(null); setOverId(null); }} onClick={e => e.stopPropagation()} title="Arrastra para reordenar">
                <GripVertical size={13} />
              </span>
              <span className="title"><M.icon size={13} />{M.title}</span>
              {p.collapsed ? <ChevronRight size={14} className="muted" /> : <ChevronDown size={14} className="muted" />}
              <button className="icon-btn sm" title="Ocultar panel (Ventana para mostrar)" aria-label={`Ocultar ${M.title}`} onClick={e => { e.stopPropagation(); toggle(p.id, { visible: false }); }}><X size={12} /></button>
            </div>
            {!p.collapsed && <div className="panel-body">{body(p.id)}</div>}
          </div>
        );
      })}
    </div>
  );
}
void commit;
