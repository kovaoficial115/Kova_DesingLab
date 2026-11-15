import React, { useState } from 'react';
import { LayoutGrid as LayoutIcon, Link2, Link2Off, RotateCw } from 'lucide-react';
import { useStore, useActiveDoc, set } from '../../core/store';
import { Modal, NumberField, Check, Seg, Select } from '../../ui/components/controls';
import { LAYOUT_PRESETS, COMPOSITIONS, presetLayout, emptyLayout, contentBox, columnBands, hasLayout, type LayoutGrid, type CompositionKind } from '../layout';
import { setLayout } from '../actions';

type Scope = 'active' | 'project' | 'all';

export function LayoutDialog({ onClose }: { onClose: () => void }) {
  const doc = useActiveDoc();
  const showLayout = useStore(s => s.showLayout);
  const composition = useStore(s => s.composition);
  const compositionAll = useStore(s => s.compositionAll);
  const ab = doc?.state.artboards.find(a => a.id === doc.state.activeArtboardId) ?? doc?.state.artboards[0];
  const [g, setG] = useState<LayoutGrid>(() => (ab && hasLayout(ab.layout) ? { ...ab.layout, margins: { ...ab.layout.margins } } : ab ? presetLayout('c12', ab.w, ab.h) : emptyLayout()));
  const [linked, setLinked] = useState(() => { const m = g.margins; return m.top === m.right && m.right === m.bottom && m.bottom === m.left; });
  const [scope, setScope] = useState<Scope>(ab?.behance ? 'project' : 'active');
  if (!doc || !ab) return null;

  const targets = scope === 'active' ? [ab] : scope === 'project' && ab.behance ? doc.state.artboards.filter(a => a.behance?.project === ab.behance!.project) : doc.state.artboards;
  const up = (p: Partial<LayoutGrid>) => setG(x => ({ ...x, ...p }));
  const margin = (k: keyof LayoutGrid['margins']) => (v: number) => setG(x => ({ ...x, margins: linked ? { top: v, right: v, bottom: v, left: v } : { ...x.margins, [k]: v } }));
  const c = contentBox(ab, g);
  const cols = columnBands(ab, g);
  const colW = cols.length ? cols[0].b - cols[0].a : 0;
  const apply = () => { setLayout(targets.map(a => a.id), g, targets.length > 1 ? `Retícula en ${targets.length} mesas` : 'Retícula de maquetación'); set({ showLayout: true }); onClose(); };

  return (
    <Modal title="Retícula y composición" icon={<LayoutIcon size={16} />} onClose={onClose} width={520}
      footer={<>
        <button className="btn ghost" disabled={!targets.some(a => a.layout)} onClick={() => { setLayout(targets.map(a => a.id), null, 'Quitar retícula'); onClose(); }}>Quitar retícula</button>
        <div className="spacer" />
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" onClick={apply}>Aplicar a {targets.length === 1 ? `«${ab.name.slice(0, 20)}»` : `${targets.length} mesas`}</button>
      </>}>
      <div className="section-title">Retícula de maquetación</div>
      <div className="row" style={{ gap: 6 }}>
        <span className="label">Partir de</span>
        <select className="select grow" value="" onChange={e => { if (e.target.value) { const p = presetLayout(e.target.value, ab.w, ab.h); setG(p); setLinked(true); } }} aria-label="Retícula de partida">
          <option value="">Elegir retícula…</option>
          {LAYOUT_PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <span className="label">Márgenes</span>
        <NumberField label="Sup" value={g.margins.top} onChange={margin('top')} min={0} digits={0} width={74} />
        {!linked && <>
          <NumberField label="Der" value={g.margins.right} onChange={margin('right')} min={0} digits={0} width={74} />
          <NumberField label="Inf" value={g.margins.bottom} onChange={margin('bottom')} min={0} digits={0} width={74} />
          <NumberField label="Izq" value={g.margins.left} onChange={margin('left')} min={0} digits={0} width={74} />
        </>}
        <button className="icon-btn sm" title={linked ? 'Márgenes iguales (clic para separarlos)' : 'Márgenes distintos (clic para igualarlos)'} onClick={() => { if (!linked) margin('top')(g.margins.top); setLinked(!linked); }}>
          {linked ? <Link2 size={13} /> : <Link2Off size={13} />}
        </button>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <span className="label">Columnas</span>
        <NumberField value={g.columns} onChange={v => up({ columns: Math.round(v) })} min={0} max={48} digits={0} width={70} />
        <NumberField label="Medianil" value={g.gutter} onChange={v => up({ gutter: v })} min={0} digits={0} suffix="px" width={120} />
      </div>
      <div className="row" style={{ gap: 6 }}>
        <span className="label">Filas</span>
        <NumberField value={g.rows} onChange={v => up({ rows: Math.round(v) })} min={0} max={48} digits={0} width={70} />
        <NumberField label="Separación" value={g.rowGutter} onChange={v => up({ rowGutter: v })} min={0} digits={0} suffix="px" width={130} />
      </div>
      <div className="row" style={{ gap: 6 }}>
        <span className="label">Línea base</span>
        <NumberField value={g.baseline} onChange={v => up({ baseline: v })} min={0} max={500} digits={1} suffix="px" width={100} title="Cada cuántos px (0 = sin línea base). Útil para alinear textos de varias columnas" />
      </div>
      <div className="tiny muted">
        Zona de contenido {Math.round(c.w)}×{Math.round(c.h)} px{cols.length ? ` · columnas de ${colW.toFixed(1)} px` : ''}{colW < 0 || (g.columns > 0 && !cols.length) ? ' · los medianiles no caben' : ''}. Lo que mueves se ajusta a márgenes, columnas, filas y línea base mientras la retícula está visible. No se exporta.
      </div>
      <div className="row" style={{ gap: 6 }}>
        <span className="label">Aplicar en</span>
        <Seg<Scope> value={scope} onChange={setScope} options={[
          { value: 'active', label: 'Esta mesa' },
          ...(ab.behance ? [{ value: 'project' as Scope, label: 'Secciones del proyecto' }] : []),
          { value: 'all', label: `Todas (${doc.state.artboards.length})` },
        ]} />
      </div>
      <Check checked={showLayout} onChange={v => set({ showLayout: v })} label="Mostrar la retícula (y ajustar a ella)" />

      <div className="section-title">Guías de composición (solo en pantalla)</div>
      <div className="row" style={{ gap: 6 }}>
        <Select<string> value={composition ?? ''} onChange={v => set({ composition: (v || null) as CompositionKind | null })}
          options={[{ value: '', label: 'Ninguna' }, ...COMPOSITIONS.map(x => ({ value: x.id, label: x.name }))]} />
        {composition === 'spiral' && <button className="btn sm" onClick={() => set(s => ({ compositionTurn: (s.compositionTurn + 1) % 4 }))}><RotateCw size={12} />Girar</button>}
      </div>
      <Check checked={compositionAll} onChange={v => set({ compositionAll: v })} label="En todas las mesas (si no, solo en la activa)" />
    </Modal>
  );
}
