import React, { useState } from 'react';
import { Plus, Copy, Trash2, GripVertical, Eye, Download, ChevronUp, ChevronDown, Unlink, LayoutGrid } from 'lucide-react';
import { useStore, set } from '../../core/store';
import type { Doc } from '../../core/types';
import * as A from '../../core/actions';
import { Check, Seg, NumberField, ColorInput } from '../../ui/components/controls';
import { openDialog } from '../../ui/commands';
import { Thumb, CommitInput } from '../../social/ui/SocialPanel';
import { listProjects, SECTION_PRESETS, MAX_SECTIONS, MIN_SECTION, MAX_SECTION, presetHeight, BEHANCE_GUIDE } from '../model';
import * as B from '../actions';

export function BehancePanel({ doc }: { doc: Doc }) {
  const s = doc.state;
  const guides = useStore(x => x.behanceGuides);
  const projects = listProjects(s.artboards);
  const active = s.artboards.find(a => a.id === s.activeArtboardId);
  const [pick, setPick] = useState<string | null>(null);
  const proj = projects.find(p => p.id === active?.behance?.project) ?? projects.find(p => p.id === pick) ?? projects[0];
  const [drag, setDrag] = useState<string | null>(null);
  const [preset, setPreset] = useState('h1800');
  if (!proj) return <div className="tiny muted">El documento no tiene proyectos de Behance.</div>;
  const list = proj.sections;
  const width = list[0].w;
  const cur = list.find(a => a.id === active?.id) ?? null;
  const total = list.reduce((n, a) => n + a.h, 0);
  const presetH = (id: string) => presetHeight(SECTION_PRESETS.find(p => p.id === id)!, width);
  const curPreset = cur ? SECTION_PRESETS.find(p => presetHeight(p, width) === cur.h)?.id ?? 'custom' : 'custom';

  return (
    <>
      {projects.length > 1 && (
        <select className="select" value={proj.id} onChange={e => { const p = projects.find(x => x.id === e.target.value); if (p) { setPick(p.id); A.setActiveArtboard(p.sections[0].id); } }} style={{ width: '100%' }} aria-label="Proyecto">
          {projects.map(p => <option key={p.id} value={p.id}>{p.name} · {p.sections.length} secciones</option>)}
        </select>
      )}
      <CommitInput value={proj.name} onCommit={v => B.renameProject(proj.id, v || 'Proyecto Behance')} aria-label="Nombre del proyecto" />
      <div className="row" style={{ gap: 6 }}>
        <span className="label">Modo</span>
        <Seg value={proj.continuous ? 'c' : 's'} onChange={v => B.setContinuous(proj.id, v === 'c')} options={[
          { value: 'c', label: 'Continuo', title: 'Secciones pegadas: se diseña como una sola página vertical y los elementos pueden cruzar de una sección a otra' },
          { value: 's', label: 'Separado', title: 'Secciones con hueco entre ellas en el lienzo (el hueco no se exporta)' },
        ]} />
      </div>
      <div className="row" style={{ gap: 6 }}>
        <span className="label">Ancho</span>
        <NumberField value={width} onChange={() => {}} onCommit={v => B.setProjectWidth(proj.id, v)} min={100} max={6000} digits={0} suffix="px" width={96}
          title="Ancho común de todas las secciones. Behance muestra el contenido a 1400 px y recomienda subir 2800 px o menos" />
        <span className="tiny muted mono grow" style={{ textAlign: 'right' }}>{width}×{total}</span>
      </div>
      {width !== BEHANCE_GUIDE.displayWidth && width !== BEHANCE_GUIDE.displayWidth * 2 && (
        <div className="tiny muted">Behance muestra el contenido a {BEHANCE_GUIDE.displayWidth} px de ancho; al exportar puedes elegir la resolución (×2 = 2800 px).</div>
      )}
      <Check checked={guides} onChange={v => set({ behanceGuides: v })} label="Guías de sección (no se exportan)" />

      <div className="section-title">Secciones · {list.length}</div>
      <div className="col slide-list" style={{ gap: 3, maxHeight: 320 }}>
        {list.map((a, i) => (
          <div key={a.id} className={'slide-row' + (a.id === active?.id ? ' current' : '') + (drag && drag !== a.id ? ' drop' : '')}
            draggable onDragStart={e => { setDrag(a.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/section', a.id); }}
            onDragEnd={() => setDrag(null)}
            onDragOver={e => { if (drag) e.preventDefault(); }}
            onDrop={e => { e.preventDefault(); if (drag && drag !== a.id) B.moveSection(drag, i); setDrag(null); }}
            onClick={() => A.setActiveArtboard(a.id)} onDoubleClick={() => A.fitToScreen(a)} title={`${a.w}×${a.h} · Clic: seleccionar · Doble clic: encuadrar · Arrastra para reordenar`}>
            <GripVertical size={12} className="muted" />
            <span className="tiny mono muted" style={{ width: 16 }}>{String(i + 1).padStart(2, '0')}</span>
            <Thumb doc={doc} ab={a} max={72} style={{ width: 22, height: 22, aspectRatio: 'auto', objectFit: 'cover', objectPosition: 'top', flex: 'none' }} />
            <CommitInput className="grow" value={a.name} onClick={e => e.stopPropagation()} onCommit={v => B.renameSection(a.id, v)} aria-label={`Nombre de la sección ${i + 1}`} />
            <button className="icon-btn sm" title="Subir" disabled={i === 0} onClick={e => { e.stopPropagation(); B.moveSection(a.id, i - 1); }}><ChevronUp size={11} /></button>
            <button className="icon-btn sm" title="Bajar" disabled={i === list.length - 1} onClick={e => { e.stopPropagation(); B.moveSection(a.id, i + 1); }}><ChevronDown size={11} /></button>
            <button className="icon-btn sm" title="Duplicar sección con su contenido" disabled={list.length >= MAX_SECTIONS} onClick={e => { e.stopPropagation(); B.duplicateSection(a.id); }}><Copy size={11} /></button>
            <button className="icon-btn sm" title="Eliminar sección y su contenido" onClick={e => { e.stopPropagation(); B.deleteSection(a.id); }}><Trash2 size={11} /></button>
          </div>
        ))}
      </div>

      {cur && (
        <>
          <div className="section-title">«{cur.name}»</div>
          <div className="row" style={{ gap: 6 }}>
            <span className="label">Alto</span>
            <select className="select grow" value={curPreset} onChange={e => { if (e.target.value !== 'custom') B.setSectionHeight(cur.id, presetH(e.target.value)); }} aria-label="Preset de alto">
              {SECTION_PRESETS.map(p => <option key={p.id} value={p.id}>{p.name} · {width}×{presetHeight(p, width)}</option>)}
              <option value="custom">Personalizado</option>
            </select>
            <NumberField value={cur.h} onChange={() => {}} onCommit={v => B.setSectionHeight(cur.id, v)} min={MIN_SECTION} max={MAX_SECTION} digits={0} suffix="px" width={88} />
          </div>
        </>
      )}

      <div className="row" style={{ gap: 6 }}>
        <select className="select grow" value={preset} onChange={e => setPreset(e.target.value)} aria-label="Alto de la sección nueva">
          {SECTION_PRESETS.map(p => <option key={p.id} value={p.id}>{p.name} · {width}×{presetHeight(p, width)}</option>)}
        </select>
        <button className="btn sm" disabled={list.length >= MAX_SECTIONS} onClick={() => B.addSection(proj.id, presetH(preset), undefined, cur?.id)} title={cur ? `Añade una sección vacía debajo de «${cur.name}»` : 'Añade una sección vacía al final'}>
          <Plus size={12} />Sección
        </button>
      </div>
      <div className="tiny muted">Los altos son presets de diseño de KOVA, no formatos oficiales de Behance. Cada sección puede tener su propio alto.</div>
      <div className="row" style={{ gap: 6 }}>
        <span className="label">Fondo común</span>
        <ColorInput value={list[0].background ?? '#ffffff'} onChange={() => {}} onCommit={v => B.setProjectBackground(proj.id, v)} title="Aplica el mismo fondo a todas las secciones" />
        <button className="btn sm ghost" onClick={() => B.setProjectBackground(proj.id, null)} title="Secciones transparentes (al exportar en JPG se rellenan de blanco)">Sin fondo</button>
      </div>

      <div className="section-title">Producción</div>
      <div className="col" style={{ gap: 4 }}>
        <button className="btn sm" onClick={() => openDialog('editorial-layout')} title="Márgenes, columnas, filas y línea base para todas las secciones; guías de composición"><LayoutGrid size={12} />Retícula y composición…</button>
        <button className="btn sm" onClick={() => openDialog('behance-preview', { project: proj.id })}><Eye size={12} />Vista previa de Behance…</button>
        <button className="btn sm primary" onClick={() => openDialog('behance-export', { project: proj.id })}><Download size={12} />Exportar para Behance…</button>
        <button className="btn sm" onClick={() => openDialog('behance-new', { mode: 'add' })}><Plus size={12} />Otro proyecto en este documento…</button>
        <button className="btn sm ghost" onClick={() => B.dissolveProject(proj.id)} title="Las secciones vuelven a ser mesas normales; no se borra nada"><Unlink size={12} />Deshacer proyecto</button>
      </div>
    </>
  );
}
