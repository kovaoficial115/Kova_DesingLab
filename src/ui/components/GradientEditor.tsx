// Editor de degradados: barra con puntos de color que se arrastran, añaden (clic en la barra) y
// quitan; color y opacidad de cada punto; tipo (lineal, radial, angular), ángulo, invertir,
// degradados guardados y edición directa sobre el lienzo.

import React, { useRef, useState } from 'react';
import { ArrowLeftRight, Trash2, Save, Move } from 'lucide-react';
import { NumberField, Seg, ColorInput } from './controls';
import {
  type Gradient, type GradientType, gradientCss, gradientAngle, withAngle, withType, addStop, removeStop, reverseGradient,
  BUILTIN_GRADIENTS, loadSavedGradients, saveGradients,
} from '../../core/paint';
import { useStore, set } from '../../core/store';

export function GradientEditor({ value: g, onChange, editKey }: {
  value: Gradient;
  /** cambio en vivo (commit=false) o definitivo (commit=true, una entrada de historial) */
  onChange: (g: Gradient, commit: boolean) => void;
  /** identifica el degradado para editarlo sobre el lienzo (capa y destino) */
  editKey?: { layerId: string; target: 'fill' | 'text' };
}) {
  const [sel, setSel] = useState(0);
  const [saved, setSaved] = useState<Gradient[]>(() => loadSavedGradients());
  const bar = useRef<HTMLDivElement>(null);
  const editing = useStore(s => s.gradientEdit);
  const onCanvas = !!editKey && editing?.layerId === editKey.layerId && editing.target === editKey.target;
  const i = Math.min(sel, g.stops.length - 1);
  const stop = g.stops[i];
  const posAt = (clientX: number) => { const r = bar.current!.getBoundingClientRect(); return Math.min(1, Math.max(0, (clientX - r.left) / r.width)); };
  const setStop = (patch: Partial<typeof stop>, commit: boolean) => onChange({ ...g, stops: g.stops.map((s, k) => (k === i ? { ...s, ...patch } : s)) }, commit);

  const dragStop = (k: number, e: React.PointerEvent) => {
    e.stopPropagation(); e.preventDefault();
    setSel(k);
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    let cur = g;
    const mv = (ev: PointerEvent) => { cur = { ...cur, stops: cur.stops.map((s, j) => (j === k ? { ...s, pos: posAt(ev.clientX) } : s)) }; onChange(cur, false); };
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); onChange(cur, true); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  };

  return (
    <div className="col grad-editor" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 6 }}>
        <Seg<GradientType> value={g.type} onChange={v => onChange(withType(g, v), true)} options={[
          { value: 'linear', label: 'Lineal' }, { value: 'radial', label: 'Radial' }, { value: 'conic', label: 'Angular', title: 'Cónico (en SVG se exporta como imagen)' },
        ]} />
        <div className="grow" />
        <button className="icon-btn sm" title="Invertir colores" onClick={() => onChange(reverseGradient(g), true)}><ArrowLeftRight size={13} /></button>
        {editKey && <button className={'icon-btn sm' + (onCanvas ? ' active' : '')} title="Ajustar el degradado sobre el lienzo (arrastra sus puntos)"
          onClick={() => set({ gradientEdit: onCanvas ? null : editKey })}><Move size={13} /></button>}
      </div>
      <div className="grad-bar" ref={bar} title="Clic para añadir un punto de color · arrastra los puntos · Supr para quitar el elegido"
        style={{ backgroundImage: `${gradientCss(g)}, repeating-conic-gradient(#888 0 25%, #ccc 0 50%)`, backgroundSize: 'auto, 10px 10px' }}
        tabIndex={0}
        onKeyDown={e => { if ((e.key === 'Delete' || e.key === 'Backspace') && g.stops.length > 2) { e.preventDefault(); e.stopPropagation(); onChange(removeStop(g, i), true); setSel(0); } }}
        onPointerDown={e => { const r = addStop(g, posAt(e.clientX)); onChange(r.g, true); setSel(r.index); }}>
        {g.stops.map((s, k) => (
          <div key={k} className={'grad-stop' + (k === i ? ' on' : '')} style={{ left: `${s.pos * 100}%`, background: s.color }}
            title={`${s.color} · ${Math.round(s.opacity * 100)} % · ${Math.round(s.pos * 100)} %`}
            onPointerDown={e => dragStop(k, e)} />
        ))}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <ColorInput value={stop.color} onChange={v => setStop({ color: v }, false)} onCommit={v => setStop({ color: v }, true)} title="Color del punto" />
        <NumberField label="Opac." value={Math.round(stop.opacity * 100)} min={0} max={100} digits={0} suffix="%" width={92}
          onChange={v => setStop({ opacity: v / 100 }, false)} onCommit={v => setStop({ opacity: v / 100 }, true)} />
        <NumberField label="Pos." value={Math.round(stop.pos * 100)} min={0} max={100} digits={0} suffix="%" width={86}
          onChange={v => setStop({ pos: v / 100 }, false)} onCommit={v => setStop({ pos: v / 100 }, true)} />
        <button className="icon-btn sm" title="Quitar este punto (quedan al menos dos)" disabled={g.stops.length <= 2}
          onClick={() => { onChange(removeStop(g, i), true); setSel(0); }}><Trash2 size={12} /></button>
      </div>
      {g.type !== 'radial' && (
        <NumberField label="Ángulo" value={gradientAngle(g)} min={-180} max={180} digits={0} suffix="°" width={120}
          onChange={v => onChange(withAngle(g, v), false)} onCommit={v => onChange(withAngle(g, v), true)} />
      )}
      <div className="grad-lib">
        {[...BUILTIN_GRADIENTS, ...saved].map((p, k) => (
          <button key={k} className="grad-swatch" title={k < BUILTIN_GRADIENTS.length ? 'Degradado de partida' : 'Guardado (clic derecho para borrarlo)'}
            style={{ backgroundImage: `${gradientCss(p, false)}, repeating-conic-gradient(#888 0 25%, #ccc 0 50%)`, backgroundSize: 'auto, 8px 8px' }}
            onClick={() => onChange({ ...p, stops: p.stops.map(s => ({ ...s })) }, true)}
            onContextMenu={e => { if (k < BUILTIN_GRADIENTS.length) return; e.preventDefault(); const next = saved.filter((_, j) => j !== k - BUILTIN_GRADIENTS.length); setSaved(next); saveGradients(next); }} />
        ))}
        <button className="icon-btn sm" title="Guardar este degradado" onClick={() => { const next = [...saved, { ...g, stops: g.stops.map(s => ({ ...s })) }]; setSaved(next); saveGradients(next); }}><Save size={12} /></button>
      </div>
    </div>
  );
}
