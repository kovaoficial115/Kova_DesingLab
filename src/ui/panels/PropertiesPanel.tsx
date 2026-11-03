import React, { useState } from 'react';
import { FlipHorizontal2, FlipVertical2, RotateCw, RotateCcw, Link, Unlink, AlignHorizontalSpaceAround, AlignVerticalSpaceAround, AlertTriangle, Bold, Italic, AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import { useStore, live, finishLive, get } from '../../core/store';
import type { Doc, Layer, Artboard } from '../../core/types';
import { NumberField, Select, Seg, Check, ColorInput } from '../components/controls';
import { fromPx, toPx, layerSize, layerBounds } from '../../core/util';
import * as A from '../../core/actions';
import { AlignIcon, FONTS } from '../Chrome';
import { runCommand } from '../commands';

const liveLayer = (id: string, patch: Partial<Layer> | ((l: Layer) => Partial<Layer>)) =>
  live(s => ({ ...s, layers: s.layers.map(l => (l.id === id ? { ...l, ...(typeof patch === 'function' ? patch(l) : patch) } : l)) }));

export function UnitField(p: { label: string; px: number; dpi: number; onPx: (v: number, commit: boolean) => void; min?: number; title?: string }) {
  const unit = useStore(s => s.unit);
  const v = fromPx(p.px, unit, p.dpi);
  const digits = unit === 'px' ? 0 : unit === 'mm' ? 1 : 2;
  return <NumberField label={p.label} value={v} digits={digits} suffix={unit} step={unit === 'px' ? 1 : unit === 'mm' ? 1 : 0.1} title={p.title}
    min={p.min} onChange={x => p.onPx(toPx(x, unit, p.dpi), false)} onCommit={x => p.onPx(toPx(x, unit, p.dpi), true)} />;
}

export function ppiStatus(ppi: number) {
  if (ppi >= 280) return { cls: 'ok', text: 'Óptima' };
  if (ppi >= 200) return { cls: 'warn', text: 'Aceptable' };
  return { cls: 'danger', text: 'Baja' };
}

function LayerProps({ l, ab, doc }: { l: Layer; ab: Artboard; doc: Doc }) {
  const [linked, setLinked] = useState(true);
  const { w, h } = layerSize(l);
  const dw = w * Math.abs(l.scaleX), dh = h * Math.abs(l.scaleY);
  const b = layerBounds(l);
  const multi = doc.state.selectedLayerIds.length > 1;
  const setX = (v: number, c: boolean) => { liveLayer(l.id, { x: v + ab.x }); if (c) finishLive('Posición X'); };
  const setY = (v: number, c: boolean) => { liveLayer(l.id, { y: v + ab.y }); if (c) finishLive('Posición Y'); };
  const setSize = (nw: number | null, nh: number | null, c: boolean) => {
    liveLayer(l.id, ll => {
      const sz = layerSize(ll);
      let sx = Math.abs(ll.scaleX), sy = Math.abs(ll.scaleY);
      if (nw != null) { const k = nw / sz.w; if (linked) sy *= k / sx; sx = k; }
      if (nh != null) { const k = nh / sz.h; if (linked) sx *= k / sy; sy = k; }
      const cx = ll.x + (sz.w * Math.abs(ll.scaleX)) / 2, cy = ll.y + (sz.h * Math.abs(ll.scaleY)) / 2;
      return { scaleX: sx * Math.sign(ll.scaleX || 1), scaleY: sy * Math.sign(ll.scaleY || 1), x: cx - (sz.w * sx) / 2, y: cy - (sz.h * sy) / 2 };
    });
    if (c) finishLive('Tamaño de capa');
  };
  const ppi = l.kind === 'raster' ? ab.dpi / Math.max(Math.abs(l.scaleX), Math.abs(l.scaleY)) : null;
  const st = ppi ? ppiStatus(ppi) : null;
  return (
    <>
      <div className="row">
        <span className="chip">{{ raster: 'Píxeles', text: 'Texto', shape: 'Forma', vector: 'Vector', group: 'Grupo' }[l.kind]}</span>
        <span className="small grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{multi ? `${doc.state.selectedLayerIds.length} capas` : l.name}</span>
      </div>
      {l.kind !== 'group' && <>
        <div className="grid2">
          <UnitField label="X" px={l.x - ab.x} dpi={ab.dpi} onPx={setX} />
          <UnitField label="Y" px={l.y - ab.y} dpi={ab.dpi} onPx={setY} />
        </div>
        <div className="row">
          <div className="grid2 grow">
            <UnitField label="An" px={dw} dpi={ab.dpi} min={0.01} onPx={(v, c) => setSize(v, null, c)} />
            <UnitField label="Al" px={dh} dpi={ab.dpi} min={0.01} onPx={(v, c) => setSize(null, v, c)} />
          </div>
          <button className={'icon-btn sm' + (linked ? ' active' : '')} title="Mantener proporción" onClick={() => setLinked(!linked)}>{linked ? <Link size={12} /> : <Unlink size={12} />}</button>
        </div>
        <div className="row">
          <NumberField label="∠" value={l.rotation} digits={1} suffix="°" min={-360} max={360} width={96}
            onChange={v => liveLayer(l.id, { rotation: v })} onCommit={v => { liveLayer(l.id, { rotation: v }); finishLive('Rotar'); }} />
          <div className="grow" />
          <button className="icon-btn sm" title="Rotar 90° antihorario" onClick={() => A.rotateLayers(-90)}><RotateCcw size={13} /></button>
          <button className="icon-btn sm" title="Rotar 90° horario" onClick={() => A.rotateLayers(90)}><RotateCw size={13} /></button>
          <button className="icon-btn sm" title="Voltear horizontal" onClick={() => A.flipLayers('h')}><FlipHorizontal2 size={13} /></button>
          <button className="icon-btn sm" title="Voltear vertical" onClick={() => A.flipLayers('v')}><FlipVertical2 size={13} /></button>
        </div>
        {ppi != null && st && (
          <div className="row small" style={{ justifyContent: 'space-between' }}>
            <span className="muted">Resolución efectiva</span>
            <span className={'chip ' + st.cls}>{Math.round(ppi)} ppp · {st.text}</span>
          </div>
        )}
        {ppi != null && ppi < 200 && <div className="row tiny" style={{ color: 'var(--warn)' }}><AlertTriangle size={12} />A este tamaño la imagen puede verse pixelada al imprimir.</div>}
        {l.kind === 'raster' && (Math.abs(Math.abs(l.scaleX) - 1) > 0.001 || Math.abs(Math.abs(l.scaleY) - 1) > 0.001) && (
          <button className="btn sm" onClick={() => runCommand('layer.resample')} title="Convierte la escala en píxeles reales">Remuestrear a {Math.round(dw)}×{Math.round(dh)} px</button>
        )}
        <div className="tiny muted">Caja: {fromPx(b.w, get().unit, ab.dpi).toFixed(2)} × {fromPx(b.h, get().unit, ab.dpi).toFixed(2)} {get().unit} · contenido {Math.round(w)}×{Math.round(h)} px</div>
      </>}
      {l.kind === 'text' && l.text && <TextProps l={l} />}
      {l.kind === 'shape' && l.shape && <ShapeProps l={l} />}
      {l.kind === 'vector' && (
        <div className="row"><button className="btn sm" onClick={() => runCommand('layer.rasterize')}>Rasterizar</button><span className="tiny muted">Vector editable; se exporta nativo a SVG.</span></div>
      )}
      {l.mask && (
        <>
          <div className="section-title">Máscara de capa</div>
          <div className="row">
            <Check checked={l.maskEnabled} onChange={v => A.updateLayer(l.id, { maskEnabled: v }, 'Activar máscara')} label="Activa" />
            <div className="grow" />
            <button className="btn sm" onClick={() => runCommand('layer.maskApply')}>Aplicar</button>
            <button className="btn sm" onClick={() => runCommand('layer.maskDelete')}>Eliminar</button>
          </div>
        </>
      )}
      <div className="section-title">Alinear {multi ? 'selección' : 'a la mesa'}</div>
      <div className="row" style={{ gap: 2 }}>
        {(['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'] as const).map(k => (
          <button key={k} className="icon-btn" title={k} onClick={() => A.alignLayers(k, multi ? 'selection' : 'artboard')}><AlignIcon kind={k} /></button>
        ))}
        <div className="vsep" />
        <button className="icon-btn" title="Distribuir horizontalmente" disabled={doc.state.selectedLayerIds.length < 3} onClick={() => A.distributeLayers('h')}><AlignHorizontalSpaceAround size={14} /></button>
        <button className="icon-btn" title="Distribuir verticalmente" disabled={doc.state.selectedLayerIds.length < 3} onClick={() => A.distributeLayers('v')}><AlignVerticalSpaceAround size={14} /></button>
      </div>
      {multi && <button className="btn sm" onClick={() => ['hcenter', 'vcenter'].forEach(k => A.alignLayers(k as any, 'artboard'))}>Centrar selección en la mesa</button>}
    </>
  );
}

function TextProps({ l }: { l: Layer }) {
  const t = l.text!;
  const up = (p: Partial<typeof t>, c = true) => { liveLayer(l.id, x => ({ text: { ...x.text!, ...p }, name: p.text !== undefined ? p.text.split('\n')[0].slice(0, 24) || 'Texto' : x.name })); if (c) finishLive('Texto'); };
  return (
    <>
      <div className="section-title">Texto</div>
      <textarea className="input" rows={2} value={t.text} onChange={e => up({ text: e.target.value }, false)} onBlur={() => finishLive('Editar texto')} onKeyDown={e => e.stopPropagation()} />
      <Select value={t.fontFamily} onChange={v => up({ fontFamily: v })} options={FONTS.map(f => ({ value: f, label: f.split(',')[0] }))} />
      <div className="row">
        <NumberField label="T" value={t.fontSize} min={1} max={5000} digits={0} suffix="px" onChange={v => up({ fontSize: v }, false)} onCommit={v => up({ fontSize: v })} />
        <Select value={String(t.fontWeight) as any} width={90} onChange={v => up({ fontWeight: +v })} options={[100, 200, 300, 400, 500, 600, 700, 800, 900].map(w => ({ value: String(w), label: String(w) }))} />
        <button className={'icon-btn sm' + (t.fontWeight >= 700 ? ' active' : '')} onClick={() => up({ fontWeight: t.fontWeight >= 700 ? 400 : 700 })}><Bold size={12} /></button>
        <button className={'icon-btn sm' + (t.italic ? ' active' : '')} onClick={() => up({ italic: !t.italic })}><Italic size={12} /></button>
      </div>
      <div className="row">
        <ColorInput value={t.color} onChange={v => up({ color: v }, false)} onCommit={() => finishLive('Color de texto')} />
        <Seg value={t.align} onChange={v => up({ align: v })} options={[{ value: 'left', label: <AlignLeft size={12} /> }, { value: 'center', label: <AlignCenter size={12} /> }, { value: 'right', label: <AlignRight size={12} /> }]} />
      </div>
      <div className="grid2">
        <NumberField label="↕" value={t.lineHeight} min={0.5} max={4} step={0.05} digits={2} onChange={v => up({ lineHeight: v }, false)} onCommit={v => up({ lineHeight: v })} title="Interlineado" />
        <NumberField label="↔" value={t.letterSpacing} min={-200} max={500} digits={0} suffix="px" onChange={v => up({ letterSpacing: v }, false)} onCommit={v => up({ letterSpacing: v })} title="Espaciado" />
      </div>
      <div className="row">
        <span className="small muted">Contorno</span>
        <ColorInput value={t.strokeColor} onChange={v => up({ strokeColor: v }, false)} onCommit={() => finishLive('Contorno de texto')} />
        <NumberField label="px" value={t.strokeWidth} min={0} max={200} digits={0} onChange={v => up({ strokeWidth: v }, false)} onCommit={v => up({ strokeWidth: v })} />
      </div>
    </>
  );
}

function ShapeProps({ l }: { l: Layer }) {
  const s = l.shape!;
  const up = (p: Partial<typeof s>, c = true) => { liveLayer(l.id, x => ({ shape: { ...x.shape!, ...p } })); if (c) finishLive('Forma'); };
  return (
    <>
      <div className="section-title">Forma</div>
      <div className="row">
        <Check checked={!!s.fill} onChange={v => up({ fill: v ? get().fg : null })} label="Relleno" />
        {s.fill && <ColorInput value={s.fill} onChange={v => up({ fill: v }, false)} onCommit={() => finishLive('Relleno')} />}
        <div className="grow" />
        <Check checked={!!s.stroke} onChange={v => up({ stroke: v ? get().bg : null })} label="Trazo" />
        {s.stroke && <ColorInput value={s.stroke} onChange={v => up({ stroke: v }, false)} onCommit={() => finishLive('Trazo')} />}
      </div>
      <div className="grid2">
        <NumberField label="Trazo" value={s.strokeWidth} min={0} max={1000} digits={0} suffix="px" onChange={v => up({ strokeWidth: v }, false)} onCommit={v => up({ strokeWidth: v })} />
        {s.shape === 'rect' && <NumberField label="Radio" value={s.radius} min={0} max={5000} digits={0} suffix="px" onChange={v => up({ radius: v }, false)} onCommit={v => up({ radius: v })} />}
      </div>
    </>
  );
}

export function ArtboardProps({ ab }: { ab: Artboard }) {
  const upd = (p: Partial<Artboard>, c = true) => {
    live(s => ({ ...s, artboards: s.artboards.map(a => (a.id === ab.id ? { ...a, ...p } : a)) }));
    if (c) finishLive('Mesa de trabajo');
  };
  return (
    <>
      <div className="row"><span className="chip accent">Mesa</span>
        <input className="input" value={ab.name} onChange={e => upd({ name: e.target.value }, false)} onBlur={() => finishLive('Renombrar mesa')} onKeyDown={e => e.stopPropagation()} /></div>
      <div className="grid2">
        <UnitField label="An" px={ab.w} dpi={ab.dpi} min={1} onPx={(v, c) => upd({ w: Math.max(1, Math.round(v)) }, c)} />
        <UnitField label="Al" px={ab.h} dpi={ab.dpi} min={1} onPx={(v, c) => upd({ h: Math.max(1, Math.round(v)) }, c)} />
      </div>
      <div className="grid2">
        <NumberField label="ppp" value={ab.dpi} min={1} max={2400} digits={0} onCommit={v => A.imageSize(ab.w, ab.h, v, false)} onChange={() => {}} title="Cambia la resolución de impresión sin remuestrear" />
        <UnitField label="Margen" px={ab.margin} dpi={ab.dpi} min={0} onPx={(v, c) => upd({ margin: Math.max(0, Math.round(v)) }, c)} title="Zona de seguridad" />
      </div>
      <div className="row">
        <Check checked={ab.background == null} onChange={v => upd({ background: v ? null : '#ffffff' })} label="Fondo transparente" />
        <div className="grow" />
        {ab.background && <ColorInput value={ab.background} onChange={v => upd({ background: v }, false)} onCommit={() => finishLive('Fondo de mesa')} />}
      </div>
      <div className="tiny muted">{ab.w}×{ab.h} px · {(ab.w / ab.dpi * 2.54).toFixed(2)}×{(ab.h / ab.dpi * 2.54).toFixed(2)} cm a {ab.dpi} ppp</div>
      <div className="row">
        <button className="btn sm grow" onClick={() => runCommand('image.size')}>Tamaño de imagen…</button>
        <button className="btn sm grow" onClick={() => runCommand('image.canvas')}>Tamaño de lienzo…</button>
      </div>
    </>
  );
}

export function PropertiesPanel({ doc }: { doc: Doc }) {
  const s = doc.state;
  const ab = s.artboards.find(a => a.id === s.activeArtboardId) ?? s.artboards[0];
  const l = s.layers.find(x => x.id === s.selectedLayerIds[s.selectedLayerIds.length - 1]);
  if (!l) return <ArtboardProps ab={ab} />;
  return <LayerProps l={l} ab={ab} doc={doc} />;
}
