import React, { useEffect, useRef, useState } from 'react';
import {
  Eye, EyeOff, Lock, Unlock, Plus, Trash2, FolderPlus, Copy, ChevronRight, ChevronDown, Folder, Type, Shapes, PenTool, CornerLeftDown, Component, Pilcrow, Spline,
  SquareDashedBottom, SlidersHorizontal, Link2,
} from 'lucide-react';
import { useStore, docState, live, finishLive } from '../../core/store';
import type { Doc, DocState, Layer, BlendMode } from '../../core/types';
import { processedContent, layerContent, mipFor } from '../../core/render';
import { childrenOf } from '../../core/doc';
import * as A from '../../core/actions';
import { Select, NumberField } from '../components/controls';
import { openDialog } from '../commands';
import { KOVA } from '../theme';

const setSelOpacity = (v: number) => (st: DocState): DocState => ({ ...st, layers: st.layers.map(x => (st.selectedLayerIds.includes(x.id) ? { ...x, opacity: v / 100 } : x)) });

export const blendModes: { value: BlendMode; label: string }[] = [
  { value: 'source-over', label: 'Normal' }, { value: 'multiply', label: 'Multiplicar' }, { value: 'screen', label: 'Trama' },
  { value: 'overlay', label: 'Superponer' }, { value: 'darken', label: 'Oscurecer' }, { value: 'lighten', label: 'Aclarar' },
  { value: 'color-dodge', label: 'Sobreexponer color' }, { value: 'color-burn', label: 'Subexponer color' }, { value: 'hard-light', label: 'Luz fuerte' },
  { value: 'soft-light', label: 'Luz suave' }, { value: 'difference', label: 'Diferencia' }, { value: 'exclusion', label: 'Exclusión' },
  { value: 'hue', label: 'Tono' }, { value: 'saturation', label: 'Saturación' }, { value: 'color', label: 'Color' }, { value: 'luminosity', label: 'Luminosidad' },
];

function Thumb({ l, mask }: { l: Layer; mask?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const tick = useStore(s => s.renderTick);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const src = mask ? l.mask : l.kind === 'raster' ? l.canvas : processedContent(l) ?? layerContent(l);
    const g = c.getContext('2d')!;
    const S = 56;
    c.width = S; c.height = S;
    g.clearRect(0, 0, S, S);
    if (!src) return;
    const k = Math.min(S / src.width, S / src.height);
    const w = src.width * k, h = src.height * k;
    g.imageSmoothingQuality = 'low';
    // desde la reducción más pequeña que sirva: reducir un bitmap de decenas de megapíxeles a 56 px
    // costaba decenas de milisegundos por capa en cada repintado
    g.drawImage(mipFor(src, k), (S - w) / 2, (S - h) / 2, w, h);
  }, [l.canvas, l.mask, l.text, l.shape, l.vector, tick, mask]);
  return <canvas ref={ref} style={{ width: 28, height: 28 }} />;
}

function kindIcon(l: Layer) {
  if (l.kind === 'text') return <Type size={11} />;
  if (l.kind === 'shape') return <Shapes size={11} />;
  if (l.kind === 'vector') return <PenTool size={11} />;
  return null;
}

function LayerRow({ l, depth, doc, drop, setDrop }: { l: Layer; depth: number; doc: Doc; drop: { id: string; pos: string } | null; setDrop: (d: any) => void }) {
  const [editing, setEditing] = useState(false);
  const sel = doc.state.selectedLayerIds.includes(l.id);
  const target = useStore(s => s.opts.brushTarget);
  const cls = ['layer-row', sel ? 'sel' : '', !l.visible ? 'hidden-layer' : '', drop?.id === l.id ? `drop-${drop.pos}` : ''].join(' ');
  return (
    <div className={cls} style={{ paddingLeft: 6 + depth * 16 }} draggable={!editing}
      onClick={e => A.toggleSelectLayer(l.id, e.metaKey || e.ctrlKey, e.shiftKey)}
      onDoubleClick={() => setEditing(true)}
      onDragStart={e => { e.dataTransfer.setData('text/kova-layer', l.id); e.dataTransfer.effectAllowed = 'move'; }}
      onDragOver={e => {
        if (!e.dataTransfer.types.includes('text/kova-layer')) return;
        e.preventDefault();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const t = (e.clientY - r.top) / r.height;
        const pos = l.kind === 'group' && t > 0.3 && t < 0.7 ? 'inside' : t < 0.5 ? 'above' : 'below';
        if (drop?.id !== l.id || drop.pos !== pos) setDrop({ id: l.id, pos });
      }}
      onDragLeave={() => setDrop(null)}
      onDrop={e => {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/kova-layer');
        setDrop(null);
        if (id && drop) A.moveLayer(id, l.id, drop.pos as any);
      }}
    >
      <button className="icon-btn sm" title={l.visible ? 'Ocultar' : 'Mostrar'} onClick={e => { e.stopPropagation(); A.updateLayer(l.id, { visible: !l.visible }, l.visible ? 'Ocultar capa' : 'Mostrar capa'); }}>
        {l.visible ? <Eye size={13} /> : <EyeOff size={13} />}
      </button>
      {l.clip && <CornerLeftDown size={12} className="muted" />}
      {l.kind === 'group' ? (
        <>
          <button className="icon-btn sm" onClick={e => { e.stopPropagation(); A.updateLayer(l.id, { collapsed: !l.collapsed }, 'Plegar grupo'); }}>
            {l.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          </button>
          <Folder size={15} className="muted" />
        </>
      ) : (
        <div className="thumb" title="Ctrl/⌘+clic: cargar selección" onClick={e => { if (e.metaKey || e.ctrlKey) { e.stopPropagation(); A.selectLayerAlpha(l.id); } else if (l.mask) useStore.setState(s => ({ opts: { ...s.opts, brushTarget: 'pixels' } })); }}
          style={sel && l.mask && target === 'pixels' ? { boxShadow: '0 0 0 2px ' + KOVA.red } : undefined}>
          <Thumb l={l} />
        </div>
      )}
      {l.mask && (
        <>
          <Link2 size={10} className="muted" />
          <div className="thumb mask" title="Máscara (Mayús+clic: activar/desactivar)" style={{ opacity: l.maskEnabled ? 1 : 0.35, boxShadow: sel && target === 'mask' ? '0 0 0 2px ' + KOVA.red : undefined }}
            onClick={e => { e.stopPropagation(); if (e.shiftKey) A.updateLayer(l.id, { maskEnabled: !l.maskEnabled }, 'Activar máscara'); else { A.selectLayers([l.id]); useStore.setState(s => ({ opts: { ...s.opts, brushTarget: 'mask' } })); } }}>
            <Thumb l={l} mask />
          </div>
        </>
      )}
      <div className="name">
        {editing ? (
          <input className="input" autoFocus defaultValue={l.name} onClick={e => e.stopPropagation()}
            onBlur={e => { A.updateLayer(l.id, { name: e.target.value || l.name }, 'Renombrar capa'); setEditing(false); }}
            onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(false); }} />
        ) : (
          <div className="row" style={{ gap: 5 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name}</span>
            {kindIcon(l)}
            {l.component && <span className="layer-badge" title={`Componente principal «${l.component.name}»`}><Component size={11} /></span>}
            {l.link && l.link.src === l.link.master && <span className="layer-badge" title="Variante vinculada"><Link2 size={11} /></span>}
            {l.text?.styleId && <span className="layer-badge muted" title="Con estilo de texto vinculado" style={{ color: 'var(--muted)' }}><Pilcrow size={10} /></span>}
            {l.text?.path && <span className="layer-badge" title="Texto en trayectoria" style={{ color: 'var(--muted)' }}><Spline size={10} /></span>}
            {l.adjustments.length > 0 && <span title={`${l.adjustments.length} ajustes`}><SlidersHorizontal size={11} className="muted" /></span>}
          </div>
        )}
        {(l.opacity < 1 || l.blend !== 'source-over') && <div className="meta">{Math.round(l.opacity * 100)}% · {blendModes.find(b => b.value === l.blend)?.label}</div>}
      </div>
      <button className="icon-btn sm" style={{ opacity: l.locked ? 1 : 0.35 }} title={l.locked ? 'Desbloquear' : 'Bloquear'} onClick={e => { e.stopPropagation(); A.updateLayer(l.id, { locked: !l.locked }, l.locked ? 'Desbloquear' : 'Bloquear'); }}>
        {l.locked ? <Lock size={12} /> : <Unlock size={12} />}
      </button>
    </div>
  );
}

export function LayersPanel({ doc }: { doc: Doc }) {
  const [drop, setDrop] = useState<{ id: string; pos: string } | null>(null);
  const s = doc.state;
  const act = s.layers.find(l => l.id === s.selectedLayerIds[s.selectedLayerIds.length - 1]);
  const rows: React.ReactNode[] = [];
  const walk = (pid: string | null, depth: number) => {
    const kids = childrenOf(s.layers, pid).slice().reverse();
    for (const l of kids) {
      rows.push(<LayerRow key={l.id} l={l} depth={depth} doc={doc} drop={drop} setDrop={setDrop} />);
      if (l.kind === 'group' && !l.collapsed) walk(l.id, depth + 1);
    }
  };
  walk(null, 0);
  const [opacity, setOpacity] = useState(act ? act.opacity * 100 : 100);
  useEffect(() => { if (act) setOpacity(Math.round(act.opacity * 100)); }, [act?.id, act?.opacity]);
  return (
    <>
      <div className="row">
        <div className="grow">
          <Select value={act?.blend ?? 'source-over'} onChange={v => act && A.updateLayers(docState()!.selectedLayerIds, () => ({ blend: v }), 'Modo de fusión')} options={blendModes} />
        </div>
        <NumberField label="Op." value={opacity} min={0} max={100} digits={0} suffix="%" width={92}
          onChange={v => { setOpacity(v); if (act) live(setSelOpacity(v)); }}
          onCommit={v => { if (act) { live(setSelOpacity(v)); finishLive('Opacidad'); } }} />
      </div>
      <div className="layers-list">
        {rows.length ? rows : <div className="muted small" style={{ padding: 16, textAlign: 'center' }}>Sin capas. Arrastra imágenes al lienzo o usa Archivo → Colocar.</div>}
      </div>
      <div className="row" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 6, margin: '0 -4px' }}>
        <div className="row" style={{ gap: 2 }}>
          <button className="icon-btn sm" title="Máscara de capa (desde selección)" disabled={!act} onClick={() => A.selectionToMask()}><SquareDashedBottom size={13} /></button>
          <button className="icon-btn sm" title="Máscara de recorte" disabled={!act} onClick={() => A.toggleClip()}><CornerLeftDown size={13} /></button>
          <button className="icon-btn sm" title="Ajustes" disabled={!act} onClick={() => useStore.setState(st => ({ panels: st.panels.map(p => (p.id === 'adjustments' ? { ...p, visible: true, collapsed: false } : p)) }))}><SlidersHorizontal size={13} /></button>
          <button className="icon-btn sm" title="Contorno / silueta" disabled={!act} onClick={() => openDialog('outline')}><Shapes size={13} /></button>
        </div>
        <div className="row" style={{ gap: 2 }}>
          <button className="icon-btn sm" title="Agrupar (Ctrl/⌘+G)" disabled={!act} onClick={() => A.groupSelected()}><FolderPlus size={13} /></button>
          <button className="icon-btn sm" title="Duplicar (Ctrl/⌘+J)" disabled={!act} onClick={() => A.duplicateSelectedLayers()}><Copy size={13} /></button>
          <button className="icon-btn sm" title="Nueva capa" onClick={() => A.newEmptyLayer()}><Plus size={13} /></button>
          <button className="icon-btn sm" title="Eliminar capa" disabled={!act} onClick={() => A.deleteSelectedLayers()}><Trash2 size={13} /></button>
        </div>
      </div>
    </>
  );
}
