import React, { useEffect, useRef, useState } from 'react';
import { Plus, Copy, Trash2, GripVertical, Eye, Download, Shuffle, Table2, Unlink, Images, Smartphone } from 'lucide-react';
import { useStore, set, activeLayer } from '../../core/store';
import type { Artboard, Doc } from '../../core/types';
import * as A from '../../core/actions';
import { Check, Select, NumberField } from '../../ui/components/controls';
import { openDialog } from '../../ui/commands';
import { allFormats, aspectLabel, PLATFORMS, type SocialFormat } from '../presets';
import { seriesArtboards, SERIES_LABEL } from '../model';
import { ADAPT_MODES, type AdaptMode } from '../adapt';
import { MAX_SLIDES } from '../carousel';
import * as S from '../actions';
import { thumbFor } from './thumbs';

/** <select> de formatos agrupados por plataforma. */
export function FormatSelect({ value, onChange, formats, placeholder }: { value: string; onChange: (f: SocialFormat) => void; formats: SocialFormat[]; placeholder?: string }) {
  return (
    <select className="select" value={value} onChange={e => { const f = formats.find(x => x.id === e.target.value); if (f) onChange(f); }} style={{ width: '100%' }}>
      {placeholder && <option value="" disabled>{placeholder}</option>}
      {PLATFORMS.map(p => {
        const list = formats.filter(f => f.platform === p.id);
        return list.length ? (
          <optgroup key={p.id} label={p.name}>
            {list.map(f => <option key={f.id} value={f.id}>{f.name} · {f.w}×{f.h}</option>)}
          </optgroup>
        ) : null;
      })}
    </select>
  );
}

/** Campo de texto que guarda (con historial) al salir o con Intro, no en cada tecla. */
export function CommitInput({ value, onCommit, ...rest }: { value: string; onCommit: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const done = () => { if (v !== value) onCommit(v); };
  return <input {...rest} className={'input ' + (rest.className ?? '')} value={v} onChange={e => setV(e.target.value)} onBlur={done}
    onKeyDown={e => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } else if (e.key === 'Escape') { setV(value); } }} />;
}

export function Thumb({ doc, ab, max = 96, style }: { doc: Doc; ab: Artboard; max?: number; style?: React.CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let on = true;
    thumbFor(doc.state, ab, max).then(c => {
      const el = ref.current;
      if (!on || !el) return;
      el.width = c.width; el.height = c.height;
      const g = el.getContext('2d')!;
      g.clearRect(0, 0, c.width, c.height);
      g.drawImage(c, 0, 0);
    });
    return () => { on = false; };
  }, [doc.state.layers, ab.x, ab.y, ab.w, ab.h, ab.background, max]);
  return <canvas ref={ref} className="social-thumb" style={{ aspectRatio: `${ab.w} / ${ab.h}`, ...style }} />;
}

export function SocialPanel({ doc }: { doc: Doc }) {
  const s = doc.state;
  const user = useStore(x => x.socialFormats);
  const guides = useStore(x => x.socialGuides);
  const ab = s.artboards.find(a => a.id === s.activeArtboardId) ?? s.artboards[0];
  const formats = allFormats(user);
  const f = S.formatOf(ab);
  const [mode, setMode] = useState<AdaptMode>('fit');
  const [slides, setSlides] = useState(3);
  const [continuous, setContinuous] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const sg = (k: keyof typeof guides) => (v: boolean) => set(x => ({ socialGuides: { ...x.socialGuides, [k]: v } }));
  const ser = ab?.social?.series;
  const list = ser ? seriesArtboards(s.artboards, ser.id) : [];
  const layer = activeLayer();
  const socialCount = s.artboards.filter(a => a.social?.preset).length;

  if (!ab) return null;
  return (
    <>
      {!f ? (
        <>
          <div className="tiny muted">«{ab.name}» no tiene formato de redes. Asígnale uno (el contenido se adapta) o crea una mesa nueva.</div>
          <FormatSelect value="" placeholder="Asignar formato…" formats={formats} onChange={nf => S.setArtboardFormat(ab.id, nf, mode)} />
          <div className="row"><span className="label">Contenido</span><Select value={mode} onChange={setMode} options={ADAPT_MODES.map(m => ({ value: m.id, label: m.name }))} /></div>
        </>
      ) : (
        <>
          <div className="row" style={{ gap: 6 }}>
            <span className="chip">{PLATFORMS.find(p => p.id === f.platform)?.name}</span>
            <b className="small grow">{f.name}</b>
            <span className="tiny muted mono">{ab.w}×{ab.h} · {aspectLabel(ab.w, ab.h)}</span>
          </div>
          {(ab.w !== f.w || ab.h !== f.h) && <div className="tiny" style={{ color: 'var(--warn)' }}>La mesa mide {ab.w}×{ab.h}; el formato pide {f.w}×{f.h}.</div>}
          <FormatSelect value={f.id} formats={formats} onChange={nf => S.setArtboardFormat(ab.id, nf, mode)} />
          <div className="row"><span className="label">Al cambiar</span><Select value={mode} onChange={setMode} options={ADAPT_MODES.map(m => ({ value: m.id, label: m.name }))} title={ADAPT_MODES.find(m => m.id === mode)?.hint} /></div>
          <div className="section-title">Guías (no se exportan)</div>
          <div className="grid2">
            <Check checked={guides.safe} onChange={sg('safe')} label="Zona segura" />
            <Check checked={guides.ui} onChange={sg('ui')} label="Interfaz de la app" title={f.ui ? undefined : 'Este formato no tiene zonas de interfaz'} />
            <Check checked={guides.circle} onChange={sg('circle')} label="Recorte circular" title={f.circle ? undefined : 'Solo en destacadas y perfiles'} />
            <Check checked={guides.thirds} onChange={sg('thirds')} label="Tercios" />
            <Check checked={guides.crops} onChange={sg('crops')} label="Recortes (perfil)" title={f.crops ? undefined : 'Este formato no tiene recortes alternativos'} />
            <Check checked={guides.numbers} onChange={sg('numbers')} label="Numeración" />
          </div>

          {ser ? (
            <>
              <div className="section-title">{SERIES_LABEL[ser.kind]} · {list.length} {ser.kind === 'highlights' ? 'portadas' : 'diapositivas'}</div>
              <CommitInput value={ser.name} onCommit={v => S.renameSeries(ser.id, v)} aria-label="Nombre de la serie" />
              <div className="col slide-list" style={{ gap: 3 }}>
                {list.map((a, i) => (
                  <div key={a.id} className={'slide-row' + (a.id === ab.id ? ' current' : '') + (drag && drag !== a.id ? ' drop' : '')}
                    draggable onDragStart={e => { setDrag(a.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/slide', a.id); }}
                    onDragEnd={() => setDrag(null)}
                    onDragOver={e => { if (drag) e.preventDefault(); }}
                    onDrop={e => { e.preventDefault(); if (drag && drag !== a.id) S.moveSlide(drag, i); setDrag(null); }}
                    onClick={() => A.setActiveArtboard(a.id)} onDoubleClick={() => A.fitToScreen(a)}>
                    <GripVertical size={12} className="muted" />
                    <span className="tiny mono muted" style={{ width: 16 }}>{i + 1}</span>
                    <Thumb doc={doc} ab={a} max={72} style={{ width: 30 }} />
                    {ser.kind === 'highlights'
                      ? <CommitInput className="grow" value={a.social?.label ?? ''} placeholder={`Destacada ${i + 1}`} onClick={e => e.stopPropagation()} onCommit={v => S.setSlideLabel(a.id, v)} aria-label={`Nombre de la destacada ${i + 1}`} />
                      : <span className="grow small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>}
                    <button className="icon-btn sm" title="Mover a la izquierda" disabled={i === 0} onClick={e => { e.stopPropagation(); S.moveSlide(a.id, i - 1); }}>‹</button>
                    <button className="icon-btn sm" title="Mover a la derecha" disabled={i === list.length - 1} onClick={e => { e.stopPropagation(); S.moveSlide(a.id, i + 1); }}>›</button>
                    <button className="icon-btn sm" title="Duplicar diapositiva" onClick={e => { e.stopPropagation(); S.addSlide(a.id, true); }}><Copy size={11} /></button>
                    <button className="icon-btn sm" title="Eliminar diapositiva y su contenido" onClick={e => { e.stopPropagation(); S.deleteSlide(a.id); }}><Trash2 size={11} /></button>
                  </div>
                ))}
              </div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
                <button className="btn sm" disabled={list.length >= MAX_SLIDES} onClick={() => S.addSlide(list[list.length - 1].id)}><Plus size={12} />{ser.kind === 'highlights' ? 'Portada' : 'Diapositiva'}</button>
                <button className="btn sm ghost" onClick={() => S.leaveSeries(ab.id)} title="Esta mesa deja de formar parte de la serie"><Unlink size={12} />Separar</button>
              </div>
              {ser.kind === 'continuous' && <div className="tiny muted">Carrusel continuo: las diapositivas están pegadas y lo que cruza un corte sale en las dos. Al reordenar, lo que cruza un corte se queda en su sitio.</div>}
            </>
          ) : (
            <>
              <div className="section-title">Carrusel</div>
              <div className="row">
                <span className="label">Diapositivas</span>
                <NumberField value={slides} onChange={v => setSlides(Math.round(v))} min={2} max={MAX_SLIDES} digits={0} />
              </div>
              <Check checked={continuous} onChange={setContinuous} label="Continuo (panorámico, sin huecos)" />
              <button className="btn sm" onClick={() => S.makeCarousel(ab.id, slides, continuous)}><Images size={12} />Convertir en carrusel</button>
            </>
          )}
        </>
      )}

      {layer && layer.kind !== 'group' && (
        <button className="btn sm ghost" title="Escala la capa a la altura del formato y la reparte en diapositivas pegadas"
          onClick={() => S.panoramaFromLayer(layer.id, f?.carousel ? f : formats.find(x => x.id === 'ig-carousel')!)}>
          <Images size={12} />Panorama desde «{layer.name.slice(0, 18)}»
        </button>
      )}

      <div className="section-title">Producción</div>
      <div className="col" style={{ gap: 4 }}>
        <button className="btn sm" onClick={() => openDialog('social-new', { mode: 'add' })}><Plus size={12} />Añadir formato o serie…</button>
        <button className="btn sm" disabled={!f} onClick={() => openDialog('social-adapt')}><Shuffle size={12} />Adaptar a otros formatos…</button>
        <button className="btn sm" disabled={!socialCount} onClick={() => openDialog('social-preview')}><Smartphone size={12} />Vista previa y planificador…</button>
        <button className="btn sm" onClick={() => openDialog('social-batch')}><Table2 size={12} />Plantilla con variables (CSV/JSON)…</button>
        <button className="btn sm primary" disabled={!socialCount} onClick={() => openDialog('social-export')}><Download size={12} />Exportar para redes…</button>
      </div>
      {!socialCount && <div className="tiny muted"><Eye size={11} style={{ verticalAlign: -1 }} /> La vista previa y la exportación para redes se activan cuando el documento tiene mesas con formato de redes.</div>}
    </>
  );
}
