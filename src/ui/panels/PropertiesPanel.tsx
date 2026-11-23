import React, { useState } from 'react';
import { FlipHorizontal2, FlipVertical2, RotateCw, RotateCcw, Link, Unlink, AlignHorizontalSpaceAround, AlignVerticalSpaceAround, AlertTriangle, Bold, Italic, Underline, Strikethrough } from 'lucide-react';
import { useStore, live, finishLive, get, liveBaseState } from '../../core/store';
import type { Doc, Layer, Artboard, TextAlign, ShapeProps as ShapeData } from '../../core/types';
import { NumberField, Select, Check, ColorInput, Seg } from '../components/controls';
import { GradientEditor } from '../components/GradientEditor';
import { DEFAULT_STROKE_STYLE, defaultGradient, ARROW_HEADS, ARROW_LABELS, lineBoxHeight, lineThickness, type ArrowHead, type StrokeStyle, type DashKind, type StrokeAlign } from '../../core/paint';
import { fromPx, toPx, layerSize, layerBounds, layerPivot, placeAtPivot, unionRect } from '../../core/util';
import { groupTarget, hasEditableCrop } from '../../tools/tools';
import { scalePatch, rotatePatch, applyPatches } from '../../core/groupTransform';
import * as A from '../../core/actions';
import { AlignIcon } from '../Chrome';
import { FontPicker } from '../components/FontPicker';
import { RunStyleBar } from '../components/RunStyleBar';
import { adjustRuns } from '../../core/textruns';
import { runCommand } from '../commands';
import { TextStyleRow, TextPathProps, VariantProps, BrandAssetProps } from './LinkedProps';

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
      const c = layerPivot(ll);
      return { scaleX: sx * Math.sign(ll.scaleX || 1), scaleY: sy * Math.sign(ll.scaleY || 1), ...placeAtPivot(ll, c.x, c.y, sx, sy) };
    });
    if (c) finishLive('Tamaño de capa');
  };
  const ppi = l.kind === 'raster' ? ab.dpi / Math.max(Math.abs(l.scaleX), Math.abs(l.scaleY)) : null;
  const st = ppi ? ppiStatus(ppi) : null;
  return (
    <>
      <div className="row">
        <span className="chip">{{ raster: 'Píxeles', text: 'Texto', shape: 'Forma', vector: 'Vector', group: 'Grupo', adjust: 'Capa de ajuste' }[l.kind]}</span>
        <span className="small grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{multi ? `${doc.state.selectedLayerIds.length} capas` : l.name}</span>
      </div>
      {(multi || l.kind === 'group') && <GroupTransformProps doc={doc} ab={ab} />}
      {!multi && l.kind !== 'group' && <>
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
        {l.kind === 'raster' && l.canvas && (
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm" disabled={l.locked} onClick={() => runCommand('layer.cropImage')} title="Recorte no destructivo: la imagen original se conserva y puedes volver a ajustarlo">{hasEditableCrop(l) ? 'Editar recorte' : 'Recortar imagen'}</button>
            {hasEditableCrop(l) && <button className="btn sm" disabled={l.locked} onClick={() => runCommand('layer.uncropImage')} title="Vuelve a mostrar la imagen completa">Quitar recorte</button>}
            {hasEditableCrop(l) && <span className="tiny muted">{l.crop!.w}×{l.crop!.h} de {l.cropSource?.canvas.width}×{l.cropSource?.canvas.height} px</span>}
          </div>
        )}
        <div className="tiny muted">Caja: {fromPx(b.w, get().unit, ab.dpi).toFixed(2)} × {fromPx(b.h, get().unit, ab.dpi).toFixed(2)} {get().unit} · contenido {Math.round(w)}×{Math.round(h)} px</div>
      </>}
      {l.kind === 'text' && l.text && <TextProps l={l} doc={doc} />}
      {l.kind === 'shape' && l.shape && <ShapeProps l={l} doc={doc} />}
      {l.kind === 'vector' && (
        <div className="row"><button className="btn sm" onClick={() => runCommand('layer.rasterize')}>Rasterizar</button><span className="tiny muted">Vector editable; se exporta nativo a SVG.</span></div>
      )}
      {l.brand && <BrandAssetProps l={l} />}
      <VariantProps l={l} doc={doc} />
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
      <AlignSection doc={doc} multi={multi} />
    </>
  );
}

function TextProps({ l, doc }: { l: Layer; doc: Doc }) {
  const t = l.text!;
  const up = (p: Partial<typeof t>, c = true) => { liveLayer(l.id, x => ({ text: { ...x.text!, ...p }, name: p.text !== undefined ? p.text.split('\n')[0].slice(0, 24) || 'Texto' : x.name })); if (c) finishLive('Texto'); };
  const [sel, setSel] = useState<[number, number]>([0, 0]);
  const readSel = (e: React.SyntheticEvent<HTMLTextAreaElement>) => setSel([e.currentTarget.selectionStart, e.currentTarget.selectionEnd]);
  return (
    <>
      <div className="section-title">Texto</div>
      <TextStyleRow l={l} doc={doc} />
      <textarea className="input" rows={2} value={t.text} onChange={e => { up({ text: e.target.value, runs: adjustRuns(t.runs, t.text, e.target.value) }, false); readSel(e); }}
        onSelect={readSel} onBlur={() => finishLive('Editar texto')} onKeyDown={e => e.stopPropagation()} />
      <RunStyleBar t={t} sel={sel} onRuns={(runs, c) => { up({ runs }, false); if (c) finishLive(c); }} />
      <FontPicker value={t.fontFamily} onChange={v => up({ fontFamily: v })} width="100%" />
      <div className="row">
        <NumberField label="T" value={t.fontSize} min={1} max={5000} digits={0} suffix="px" onChange={v => up({ fontSize: v }, false)} onCommit={v => up({ fontSize: v })} />
        <Select value={String(t.fontWeight) as any} width={90} onChange={v => up({ fontWeight: +v })} options={[100, 200, 300, 400, 500, 600, 700, 800, 900].map(w => ({ value: String(w), label: String(w) }))} />
        <button className={'icon-btn sm' + (t.fontWeight >= 700 ? ' active' : '')} onClick={() => up({ fontWeight: t.fontWeight >= 700 ? 400 : 700 })}><Bold size={12} /></button>
        <button className={'icon-btn sm' + (t.italic ? ' active' : '')} onClick={() => up({ italic: !t.italic })}><Italic size={12} /></button>
      </div>
      <div className="row">
        {!t.gradient && <ColorInput value={t.color} onChange={v => up({ color: v }, false)} onCommit={() => finishLive('Color de texto')} />}
        <Seg<'solid' | 'gradient'> value={t.gradient ? 'gradient' : 'solid'} onChange={v => { up({ gradient: v === 'gradient' ? defaultGradient(t.color, get().bg) : null }, false); finishLive(v === 'gradient' ? 'Texto degradado' : 'Texto de un color'); }}
          options={[{ value: 'solid', label: 'Color' }, { value: 'gradient', label: 'Degradado' }]} />
        <div className="grow" />
        <button className={'icon-btn sm txt-opt' + (t.caps ? ' active' : '')} title="Todo mayúsculas" onClick={() => up({ caps: !t.caps })}>TT</button>
        <button className={'icon-btn sm' + (t.underline ? ' active' : '')} title="Subrayado" onClick={() => up({ underline: !t.underline })}><Underline size={12} /></button>
        <button className={'icon-btn sm' + (t.strike ? ' active' : '')} title="Tachado" onClick={() => up({ strike: !t.strike })}><Strikethrough size={12} /></button>
      </div>
      {t.gradient && <GradientEditor value={t.gradient} editKey={{ layerId: l.id, target: 'text' }}
        onChange={(g, c) => { up({ gradient: g, color: g.stops[0]?.color ?? t.color }, false); if (c) finishLive('Degradado del texto'); }} />}
      <div className="grid2">
        <NumberField label="↕" value={t.lineHeight} min={0.5} max={4} step={0.05} digits={2} onChange={v => up({ lineHeight: v }, false)} onCommit={v => up({ lineHeight: v })} title="Interlineado" />
        <NumberField label="↔" value={t.letterSpacing} min={-200} max={500} digits={0} suffix="px" onChange={v => up({ letterSpacing: v }, false)} onCommit={v => up({ letterSpacing: v })} title="Espaciado" />
      </div>
      <div className="row">
        <span className="small muted">Contorno</span>
        <ColorInput value={t.strokeColor} onChange={v => up({ strokeColor: v }, false)} onCommit={() => finishLive('Contorno de texto')} />
        <NumberField label="px" value={t.strokeWidth} min={0} max={200} digits={0} onChange={v => up({ strokeWidth: v }, false)} onCommit={v => up({ strokeWidth: v })} />
      </div>
      <ParagraphProps l={l} up={up} />
      <TextPathProps l={l} doc={doc} />
    </>
  );
}

// iconos del panel Párrafo: cuatro renglones; la forma de la última línea dice cómo se alinea
const PARA_ALIGNS: { value: TextAlign; title: string }[] = [
  { value: 'left', title: 'Alinear a la izquierda' },
  { value: 'center', title: 'Centrar' },
  { value: 'right', title: 'Alinear a la derecha' },
  { value: 'justify-left', title: 'Justificar; última línea a la izquierda' },
  { value: 'justify-center', title: 'Justificar; última línea centrada' },
  { value: 'justify-right', title: 'Justificar; última línea a la derecha' },
  { value: 'justify', title: 'Justificar todo' },
];
function ParaIcon({ a }: { a: TextAlign }) {
  const full = 12, short = 7;
  const just = a.startsWith('justify');
  const rows = [0, 1, 2, 3].map(i => {
    const last = i === 3;
    const w = just ? (last && a !== 'justify' ? short : full) : i % 2 ? short + 2 : full;
    const side = a === 'justify' ? 'left' : a.endsWith('center') ? 'center' : a.endsWith('right') ? 'right' : 'left';
    const x = side === 'left' ? 2 : side === 'center' ? 2 + (full - w) / 2 : 2 + full - w;
    return <rect key={i} x={x} y={2.5 + i * 3.2} width={w} height={1.6} rx={0.6} />;
  });
  return <svg width={16} height={16} viewBox="0 0 16 16" fill="currentColor" aria-hidden>{rows}</svg>;
}

function ParagraphProps({ l, up }: { l: Layer; up: (p: Partial<NonNullable<Layer['text']>>, c?: boolean) => void }) {
  const t = l.text!;
  const box = t.box;
  return (
    <>
      <div className="section-title">Párrafo</div>
      <div className="para-aligns" role="radiogroup" aria-label="Alineación del párrafo">
        {PARA_ALIGNS.map(o => (
          <button key={o.value} role="radio" aria-checked={t.align === o.value} className={'icon-btn sm' + (t.align === o.value ? ' active' : '')} title={o.title + (!box && o.value.startsWith('justify') ? ' (justificar necesita un cuadro de texto)' : '')} onClick={() => up({ align: o.value })}>
            <ParaIcon a={o.value} />
          </button>
        ))}
      </div>
 {!t.path && <div className="grid2">
        <NumberField label="Sangría" value={t.indent ?? 0} min={0} max={5000} digits={0} suffix="px" onChange={v => up({ indent: v }, false)} onCommit={v => up({ indent: v })} title="Sangría de la primera línea de cada párrafo" />
        <NumberField label="Tras ¶" value={t.paraSpacing ?? 0} min={0} max={5000} digits={0} suffix="px" onChange={v => up({ paraSpacing: v }, false)} onCommit={v => up({ paraSpacing: v })} title="Espacio después de cada párrafo" />
      </div>}
      {t.path ? null : box ? (
        <>
          <div className="grid2">
            <NumberField label="An" value={box.w} min={8} max={100000} digits={0} suffix="px" onChange={v => up({ box: { ...box, w: Math.max(8, v) } }, false)} onCommit={v => up({ box: { ...box, w: Math.max(8, v) } })} title="Ancho del cuadro de texto" />
            <NumberField label="Al" value={box.h} min={0} max={100000} digits={0} suffix="px" onChange={v => up({ box: { ...box, h: Math.max(0, v) } }, false)} onCommit={v => up({ box: { ...box, h: Math.max(0, v) } })} title="Alto mínimo del cuadro (crece si el texto no cabe)" />
          </div>
          <button className="btn sm" onClick={() => A.textToPoint(l.id)} title="Cada línea del cuadro pasa a ser un renglón">Convertir en texto de punto</button>
        </>
      ) : (
        <button className="btn sm" onClick={() => A.textToBox(l.id)} title="El texto se ajusta al ancho del cuadro y se puede justificar">Convertir en cuadro de texto</button>
      )}
    </>
  );
}

function ShapeProps({ l, doc }: { l: Layer; doc: Doc }) {
  const s = l.shape!;
  const ss = s.strokeStyle ?? DEFAULT_STROKE_STYLE;
  // con varias formas seleccionadas, los cambios se aplican a todas
  const ids = new Set(doc.state.layers.filter(x => x.kind === 'shape' && x.shape && doc.state.selectedLayerIds.includes(x.id)).map(x => x.id).concat(l.id));
  const n = ids.size;
  const up = (p: Partial<ShapeData> | ((x: ShapeData) => Partial<ShapeData>), c: boolean | string = true) => {
    live(st => ({ ...st, layers: st.layers.map(x => (ids.has(x.id) && x.shape ? { ...x, shape: { ...x.shape, ...(typeof p === 'function' ? p(x.shape) : p) } } : x)) }));
    if (c) finishLive(typeof c === 'string' ? c : n > 1 ? `Formas (${n})` : 'Forma');
  };
  const upStroke = (p: Partial<StrokeStyle>, c: boolean | string = 'Estilo del contorno') => up(x => ({ strokeStyle: { ...(x.strokeStyle ?? DEFAULT_STROKE_STYLE), ...p } }), c);
  const isLine = s.shape === 'line';
  // líneas: el grosor y las puntas cambian el alto de la caja; la línea se queda en su sitio (mismo centro)
  const upLine = (p: (x: ShapeData) => Partial<ShapeData>, c: boolean | string) => {
    live(st => ({ ...st, layers: st.layers.map(x => {
      if (!ids.has(x.id) || x.shape?.shape !== 'line') return x;
      const t = lineThickness(x.shape);
      const next = { ...x.shape, ...p(x.shape) };
      const nt = next.lineWeight ?? t;
      const h = lineBoxHeight(nt, next.arrowStart, next.arrowEnd);
      const heads = (next.arrowStart && next.arrowStart !== 'none') || (next.arrowEnd && next.arrowEnd !== 'none');
      const shape = { ...next, h, lineWeight: heads ? nt : undefined, arrowStart: next.arrowStart === 'none' ? undefined : next.arrowStart, arrowEnd: next.arrowEnd === 'none' ? undefined : next.arrowEnd };
      const pv = layerPivot(x);
      const nl = { ...x, shape };
      return { ...nl, ...placeAtPivot(nl, pv.x, pv.y) };
    }) }));
    if (c) finishLive(typeof c === 'string' ? c : 'Línea');
  };
  const fillMode = s.fillGradient ? 'gradient' : 'solid';
  return (
    <>
      <div className="section-title">{n > 1 ? `Forma · ${n} seleccionadas` : 'Forma'}</div>
      {!isLine && <>
        <div className="row">
          <Check checked={!!(s.fill || s.fillGradient)} onChange={v => up(v ? { fill: s.fill ?? get().fg } : { fill: null, fillGradient: null }, v ? 'Relleno' : 'Quitar relleno')} label="Relleno" />
          {(s.fill || s.fillGradient) && <Seg<'solid' | 'gradient'> value={fillMode} onChange={v => up(v === 'gradient'
            ? x => ({ fillGradient: defaultGradient(x.fill ?? get().fg, get().bg), fill: x.fill ?? get().fg })
            : { fillGradient: null }, v === 'gradient' ? 'Relleno degradado' : 'Relleno sólido')}
            options={[{ value: 'solid', label: 'Color' }, { value: 'gradient', label: 'Degradado' }]} />}
          <div className="grow" />
          {s.fill && !s.fillGradient && <ColorInput value={s.fill} onChange={v => up({ fill: v }, false)} onCommit={() => finishLive('Relleno')} />}
        </div>
        {s.fillGradient && <GradientEditor value={s.fillGradient} editKey={n === 1 ? { layerId: l.id, target: 'fill' } : undefined}
          onChange={(g, c) => up({ fillGradient: g, fill: g.stops[0]?.color ?? s.fill }, c ? 'Degradado' : false)} />}
      </>}
      <div className="row">
        <Check checked={!!s.stroke || isLine} onChange={v => { if (!isLine) up({ stroke: v ? s.stroke ?? get().bg : null }, v ? 'Contorno' : 'Quitar contorno'); }} label={isLine ? 'Línea' : 'Contorno'} />
        <div className="grow" />
        {(s.stroke || isLine) && <ColorInput value={s.stroke || s.fill || '#ffffff'} onChange={v => up({ stroke: v }, false)} onCommit={() => finishLive('Color del contorno')} />}
      </div>
      {(s.stroke || isLine) && <>
        <div className="grid2">
          {isLine && <NumberField label="Grosor" value={+lineThickness(s).toFixed(1)} min={0.5} max={1000} digits={1} suffix="px"
            onChange={v => upLine(() => ({ lineWeight: Math.max(0.5, v) }), false)} onCommit={v => upLine(() => ({ lineWeight: Math.max(0.5, v) }), 'Grosor de la línea')} />}
          {!isLine && <NumberField label="Grosor" value={s.strokeWidth} min={0} max={1000} digits={0} suffix="px" onChange={v => up({ strokeWidth: v }, false)} onCommit={v => up({ strokeWidth: v }, 'Grosor del contorno')} />}
          <NumberField label="Opac." value={Math.round(ss.opacity * 100)} min={0} max={100} digits={0} suffix="%" onChange={v => upStroke({ opacity: v / 100 }, false)} onCommit={v => upStroke({ opacity: v / 100 })} />
        </div>
        <div className="grid2">
          <Select<DashKind> value={ss.dash} onChange={v => upStroke({ dash: v })} title="Estilo del contorno"
            options={[{ value: 'solid', label: 'Continuo' }, { value: 'dashed', label: 'Discontinuo' }, { value: 'dotted', label: 'Punteado' }]} />
          {!isLine
            ? <Select<StrokeAlign> value={ss.align} onChange={v => upStroke({ align: v })} title="Posición del contorno respecto al relleno (la caja de la forma incluye el contorno)"
                options={[{ value: 'center', label: 'Centrado' }, { value: 'inside', label: 'Interior' }, { value: 'outside', label: 'Exterior' }]} />
            : <span />}
        </div>
        {isLine && <div className="grid2">
          <Select<ArrowHead> value={s.arrowStart ?? 'none'} onChange={v => upLine(() => ({ arrowStart: v }), 'Punta de la línea')} title="Punta en el inicio de la línea"
            options={ARROW_HEADS.map(v => ({ value: v, label: v === 'none' ? 'Inicio: nada' : `Inicio: ${ARROW_LABELS[v].toLowerCase()}` }))} />
          <Select<ArrowHead> value={s.arrowEnd ?? 'none'} onChange={v => upLine(() => ({ arrowEnd: v }), 'Punta de la línea')} title="Punta en el final de la línea"
            options={ARROW_HEADS.map(v => ({ value: v, label: v === 'none' ? 'Final: nada' : `Final: ${ARROW_LABELS[v].toLowerCase()}` }))} />
        </div>}
        {isLine && <button className="btn sm" title="Intercambia las puntas del inicio y del final"
          onClick={() => upLine(x => ({ arrowStart: x.arrowEnd ?? 'none', arrowEnd: x.arrowStart ?? 'none' }), 'Invertir flecha')}>Invertir sentido</button>}
        <div className="grid2">
          <Select<CanvasLineCap> value={ss.cap} onChange={v => upStroke({ cap: v })} title="Extremos de las líneas y de los trazos discontinuos"
            options={[{ value: 'butt', label: 'Extremo recto' }, { value: 'round', label: 'Extremo redondo' }, { value: 'square', label: 'Extremo cuadrado' }]} />
          <Select<CanvasLineJoin> value={ss.join} onChange={v => upStroke({ join: v })} title="Unión de las esquinas"
            options={[{ value: 'miter', label: 'Esquina en punta' }, { value: 'round', label: 'Esquina redonda' }, { value: 'bevel', label: 'Esquina biselada' }]} />
        </div>
      </>}
      <div className="grid2">
        {s.shape === 'rect' && <NumberField label="Radio" value={s.radius} min={0} max={5000} digits={0} suffix="px" onChange={v => up({ radius: v }, false)} onCommit={v => up({ radius: v }, 'Radio de las esquinas')} />}
        {(s.shape === 'polygon' || s.shape === 'star') && <NumberField label={s.shape === 'star' ? 'Puntas' : 'Lados'} value={s.sides ?? (s.shape === 'star' ? 5 : 6)} min={3} max={64} digits={0}
          onChange={v => up({ sides: Math.round(v) }, false)} onCommit={v => up({ sides: Math.round(v) }, s.shape === 'star' ? 'Puntas de la estrella' : 'Lados del polígono')} />}
        {s.shape === 'star' && <NumberField label="Interior" value={Math.round((s.inner ?? 0.5) * 100)} min={5} max={95} digits={0} suffix="%" title="Radio interior de la estrella"
          onChange={v => up({ inner: v / 100 }, false)} onCommit={v => up({ inner: v / 100 }, 'Forma de la estrella')} />}
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
        <button className="btn sm" title="Añade debajo de todo una forma del tamaño de la mesa con un degradado editable" onClick={() => A.addGradientBackground(ab.id)}>Fondo degradado</button>
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

const ALIGN_TITLES: Record<A.AlignKind, string> = { left: 'Alinear a la izquierda', hcenter: 'Centrar en horizontal', right: 'Alinear a la derecha', top: 'Alinear arriba', vcenter: 'Centrar en vertical', bottom: 'Alinear abajo' };

/** Alinear y distribuir (capas y grupos como bloque) a la selección, la mesa, sus márgenes o la primera seleccionada. */
/**
 * Posición, tamaño y giro de la selección como un bloque (varias capas o un grupo). Los valores
 * se calculan siempre desde el estado del inicio del gesto: arrastrar un campo no acumula errores.
 */
function GroupTransformProps({ doc, ab }: { doc: Doc; ab: Artboard }) {
  const [linked, setLinked] = useState(true);
  const [turn, setTurn] = useState(0);
  const gt = groupTarget();
  if (!gt) return null;
  const ids = new Set(gt.units.map(u => u.id));
  const b = gt.box;
  const apply = (fn: (units: Layer[], box: NonNullable<ReturnType<typeof unionRect>>) => Map<string, Partial<Layer>>, label: string, commit: boolean) => {
    const base = liveBaseState(doc.id) ?? doc.state;
    const units = base.layers.filter(l => ids.has(l.id));
    const box = unionRect(units.map(layerBounds));
    if (!box) return;
    const patches = fn(units, box);
    live(s => ({ ...s, layers: applyPatches(s.layers, patches) }));
    if (commit) finishLive(label);
  };
  const move = (dx: (box: { x: number }) => number, dy: (box: { y: number }) => number) => (units: Layer[], box: { x: number; y: number }) =>
    new Map(units.map(u => [u.id, { x: u.x + dx(box), y: u.y + dy(box) }]));
  const size = (w: number | null, h: number | null) => (units: Layer[], box: { x: number; y: number; w: number; h: number }) => {
    let rx = w != null ? Math.max(0.01, w / box.w) : 1, ry = h != null ? Math.max(0.01, h / box.h) : 1;
    if (linked) { if (w != null) ry = rx; else rx = ry; }
    return new Map(units.map(u => [u.id, scalePatch(u, { x: box.x, y: box.y }, rx, ry)]));
  };
  return (
    <>
      <div className="grid2">
        <UnitField label="X" px={b.x - ab.x} dpi={ab.dpi} onPx={(v, c) => apply(move(box => v + ab.x - box.x, () => 0), 'Mover selección', c)} />
        <UnitField label="Y" px={b.y - ab.y} dpi={ab.dpi} onPx={(v, c) => apply(move(() => 0, box => v + ab.y - box.y), 'Mover selección', c)} />
      </div>
      <div className="row">
        <div className="grid2 grow">
          <UnitField label="An" px={b.w} dpi={ab.dpi} min={0.01} onPx={(v, c) => apply(size(v, null), 'Escalar selección', c)} />
          <UnitField label="Al" px={b.h} dpi={ab.dpi} min={0.01} onPx={(v, c) => apply(size(null, v), 'Escalar selección', c)} />
        </div>
        <button className={'icon-btn sm' + (linked ? ' active' : '')} title="Mantener proporción" onClick={() => setLinked(!linked)}>{linked ? <Link size={12} /> : <Unlink size={12} />}</button>
      </div>
      <div className="row">
        <NumberField label="Girar" value={turn} digits={1} suffix="°" min={-360} max={360} width={110} title="Gira la selección entera alrededor de su centro"
          onChange={setTurn} onCommit={v => { if (v) apply(units => { const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 }; return new Map(units.map(u => [u.id, rotatePatch(u, c, v)])); }, 'Rotar selección', true); setTurn(0); }} />
        <div className="grow" />
        <button className="icon-btn sm" title="Rotar la selección 90° antihorario" onClick={() => apply(units => new Map(units.map(u => [u.id, rotatePatch(u, { x: b.x + b.w / 2, y: b.y + b.h / 2 }, -90)])), 'Rotar selección', true)}><RotateCcw size={13} /></button>
        <button className="icon-btn sm" title="Rotar la selección 90° horario" onClick={() => apply(units => new Map(units.map(u => [u.id, rotatePatch(u, { x: b.x + b.w / 2, y: b.y + b.h / 2 }, 90)])), 'Rotar selección', true)}><RotateCw size={13} /></button>
        <button className="icon-btn sm" title="Voltear horizontal (cada capa)" onClick={() => A.flipLayers('h')}><FlipHorizontal2 size={13} /></button>
        <button className="icon-btn sm" title="Voltear vertical (cada capa)" onClick={() => A.flipLayers('v')}><FlipVertical2 size={13} /></button>
      </div>
      <div className="tiny muted">{gt.units.length} capas como un bloque. En el lienzo, las asas de la caja escalan (Mayús: libre, Alt: desde el centro) y fuera de las esquinas giran.</div>
    </>
  );
}

function AlignSection({ doc, multi }: { doc: Doc; multi: boolean }) {
  const [to, setTo] = useState<A.AlignTarget>('selection');
  const [mode, setMode] = useState<'gap' | 'fixed' | 'centers'>('gap');
  const [gap, setGap] = useState(24);
  const ab = doc.state.artboards.find(a => a.id === doc.state.activeArtboardId);
  const target: A.AlignTarget = multi ? to : to === 'margins' ? 'margins' : 'artboard';
  const n = doc.state.selectedLayerIds.length;
  const need = mode === 'fixed' ? 2 : 3;
  return (
    <>
      <div className="section-title">Alinear</div>
      <Select<A.AlignTarget> value={multi ? to : to === 'margins' ? 'margins' : 'artboard'} onChange={setTo} title="Respecto a qué se alinea"
        options={[
          ...(multi ? [{ value: 'selection' as A.AlignTarget, label: 'A la selección' }, { value: 'key' as A.AlignTarget, label: 'A la primera seleccionada (objeto clave)' }] : []),
          { value: 'artboard', label: 'A la mesa' },
          { value: 'margins', label: ab?.layout ? 'A los márgenes de la retícula' : 'A los márgenes de la mesa' },
        ]} />
      <div className="row" style={{ gap: 2 }}>
        {(['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'] as const).map(k => (
          <button key={k} className="icon-btn" title={ALIGN_TITLES[k]} aria-label={ALIGN_TITLES[k]} onClick={() => A.alignLayers(k, target)}><AlignIcon kind={k} /></button>
        ))}
      </div>
      {multi && <button className="btn sm" title="Mueve la selección entera, sin cambiar su disposición" onClick={() => { A.alignLayers('hcenter', target === 'margins' ? 'margins' : 'artboard', true); A.alignLayers('vcenter', target === 'margins' ? 'margins' : 'artboard', true); }}>Centrar la selección en bloque</button>}
      <div className="section-title">Distribuir</div>
      <div className="row" style={{ gap: 4 }}>
        <Select<'gap' | 'fixed' | 'centers'> value={mode} onChange={setMode} options={[
          { value: 'gap', label: 'Mismo espacio' }, { value: 'fixed', label: 'Espacio fijo' }, { value: 'centers', label: 'Centros' },
        ]} title="Mismo espacio: entre la primera y la última. Espacio fijo: el que indiques. Centros: misma distancia entre centros" />
        {mode === 'fixed' && <NumberField value={gap} onChange={setGap} min={0} digits={0} suffix="px" width={74} />}
        <button className="icon-btn" title="Distribuir en horizontal" disabled={n < need} onClick={() => A.distributeLayers('h', mode, gap)}><AlignHorizontalSpaceAround size={14} /></button>
        <button className="icon-btn" title="Distribuir en vertical" disabled={n < need} onClick={() => A.distributeLayers('v', mode, gap)}><AlignVerticalSpaceAround size={14} /></button>
      </div>
      <div className="tiny muted">Los grupos se mueven como un bloque.{n < need ? ` Selecciona al menos ${need} capas o grupos para distribuir.` : ''}</div>
    </>
  );
}
