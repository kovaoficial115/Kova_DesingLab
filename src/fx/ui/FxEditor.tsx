// Editor de parámetros generado desde el registro de efectos: cada efecto muestra solo sus
// controles. Los cambios se ven en vivo y quedan como un solo paso de historial al soltar.

import React, { useEffect, useRef, useState } from 'react';
import { Dice5, Crosshair, FileUp } from 'lucide-react';
import type { Adjustment, Layer } from '../../core/types';
import { set, useStore } from '../../core/store';
import { Slider, Select, Check, Seg, NumberField } from '../../ui/components/controls';
import { ColorField } from '../../ui/components/ColorField';
import { type FxDef, type ParamDef } from '../../engine/fx/registry';
import { FX_BLENDS } from '../../engine/fx/core';
import { hueColor } from '../../engine/fx/color';
import { parseCube, encodeLut } from '../../engine/fx/color';
import { pickFiles } from '../../io/fileOps';
import { toast } from '../../core/store';
import { setAdjParams, setAdjProps, finishAdjLive } from '../lib';

// el selector de color avisa en cada movimiento: un solo paso de historial al parar
const colorTimers = new Map<string, ReturnType<typeof setTimeout>>();
function liveThenCommit(key: string, run: () => void) {
  run();
  clearTimeout(colorTimers.get(key));
  colorTimers.set(key, setTimeout(() => { colorTimers.delete(key); finishAdjLive(); }, 400));
}

function Control({ l, a, p }: { l: Layer; a: Adjustment; p: ParamDef }) {
  const v = a.params[p.k];
  const setLive = (patch: Record<string, any>) => setAdjParams(l.id, a.id, patch, true);
  const setNow = (patch: Record<string, any>) => setAdjParams(l.id, a.id, patch);
  switch (p.type) {
    case 'range':
      return <Slider label={p.label} hint={p.tip} value={typeof v === 'number' ? v : p.min} min={p.min} max={p.max} step={p.step ?? 1} digits={p.digits ?? 0} suffix={p.unit ? ` ${p.unit}`.replace(' %', '%') : undefined}
        onChange={x => setLive({ [p.k]: x })} onCommit={x => { setLive({ [p.k]: x }); finishAdjLive(); }} />;
    case 'color':
      return <ColorField label={p.label} value={String(v ?? '#ffffff')} onChange={x => liveThenCommit(a.id + p.k, () => setLive({ [p.k]: x }))} />;
    case 'select':
      return p.options.length <= 3
        ? <div className="col" style={{ gap: 3 }}><span className="small muted">{p.label}</span><Seg full value={String(v)} onChange={x => setNow({ [p.k]: x })} options={p.options} /></div>
        : <div className="row"><span className="small muted grow">{p.label}</span><Select value={String(v)} onChange={x => setNow({ [p.k]: x })} options={p.options} width={150} /></div>;
    case 'bool':
      return <Check checked={!!v} onChange={x => setNow({ [p.k]: x })} label={p.label} title={p.tip} />;
    case 'seed':
      return (
        <div className="row" title={p.tip}>
          <span className="small muted grow">{p.label}</span>
          <NumberField value={Number(v) || 0} min={0} max={99999} step={1} digits={0} width={74} onChange={x => setLive({ [p.k]: x })} onCommit={x => { setLive({ [p.k]: x }); finishAdjLive(); }} />
          <button className="icon-btn sm" title="Otra semilla al azar" onClick={() => setNow({ [p.k]: Math.floor(Math.random() * 99999) })}><Dice5 size={13} /></button>
        </div>
      );
    case 'text':
      return <TextParam label={p.label} value={String(v ?? '')} onCommit={x => setNow({ [p.k]: x })} />;
    case 'point':
      return <PointParam l={l} a={a} kx={p.kx} ky={p.ky} label={p.label} tip={p.tip} />;
  }
}

function TextParam({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const [t, setT] = useState(value);
  useEffect(() => setT(value), [value]);
  return (
    <div className="row"><span className="small muted grow">{label}</span>
      <input className="input" style={{ width: 150 }} value={t} maxLength={40} onChange={e => setT(e.target.value)}
        onBlur={() => t !== value && onCommit(t)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    </div>
  );
}

function PointParam({ l, a, kx, ky, label, tip }: { l: Layer; a: Adjustment; kx: string; ky: string; label: string; tip?: string }) {
  const focus = useStore(s => s.fxFocus);
  const on = focus?.layerId === l.id && focus.adjId === a.id;
  const x = Math.round((a.params[kx] ?? 0.5) * 1000) / 10, y = Math.round((a.params[ky] ?? 0.5) * 1000) / 10;
  return (
    <div className="col" style={{ gap: 4 }}>
      <div className="row" title={tip}>
        <span className="small muted grow">{label}</span>
        <NumberField value={x} min={0} max={100} step={0.5} digits={1} suffix="%" width={64} onChange={v => setAdjParams(l.id, a.id, { [kx]: v / 100 }, true)} onCommit={v => { setAdjParams(l.id, a.id, { [kx]: v / 100 }, true); finishAdjLive(); }} />
        <NumberField value={y} min={0} max={100} step={0.5} digits={1} suffix="%" width={64} onChange={v => setAdjParams(l.id, a.id, { [ky]: v / 100 }, true)} onCommit={v => { setAdjParams(l.id, a.id, { [ky]: v / 100 }, true); finishAdjLive(); }} />
        <button className={'icon-btn sm' + (on ? ' on' : '')} title="Mostrar el centro en el lienzo para arrastrarlo" onClick={() => set({ fxFocus: on ? null : { layerId: l.id, adjId: a.id } })}><Crosshair size={13} /></button>
      </div>
      {on && <span className="tiny muted">Arrastra el punto rojo sobre el lienzo para mover el centro.</span>}
    </div>
  );
}

/** Rueda de color: el ángulo es el tono y la distancia al centro, la cantidad. */
function Wheel({ hue, amt, onChange, onCommit }: { hue: number; amt: number; onChange: (h: number, a: number) => void; onCommit: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const S = 112;
  useEffect(() => {
    const c = ref.current!;
    c.width = S * 2; c.height = S * 2;
    const g = c.getContext('2d')!;
    g.scale(2, 2);
    const r = S / 2 - 4;
    const img = g.createImageData(S * 2, S * 2);
    for (let y = 0; y < S * 2; y++) for (let x = 0; x < S * 2; x++) {
      const dx = x / 2 - S / 2, dy = y / 2 - S / 2, d = Math.hypot(dx, dy);
      if (d > r) continue;
      const h = (Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360, col = hueColor(h), t = d / r;
      const i = (y * S * 2 + x) * 4;
      img.data[i] = (0.5 + (col[0] - 0.5) * t) * 255; img.data[i + 1] = (0.5 + (col[1] - 0.5) * t) * 255; img.data[i + 2] = (0.5 + (col[2] - 0.5) * t) * 255; img.data[i + 3] = 255;
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.putImageData(img, 0, 0);
    g.scale(2, 2);
    const px = S / 2 + Math.cos(hue * Math.PI / 180) * r * amt / 100, py = S / 2 - Math.sin(hue * Math.PI / 180) * r * amt / 100;
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(px, py, 5, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = '#000'; g.lineWidth = 1; g.beginPath(); g.arc(px, py, 6.5, 0, Math.PI * 2); g.stroke();
  }, [hue, amt]);
  const pick = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const dx = e.clientX - r.left - r.width / 2, dy = e.clientY - r.top - r.height / 2;
    const h = Math.round((Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360);
    const a = Math.round(Math.min(100, (Math.hypot(dx, dy) / (r.width / 2 - 4)) * 100));
    onChange(h, a);
  };
  return <canvas ref={ref} style={{ width: S, height: S, cursor: 'crosshair', touchAction: 'none', borderRadius: '50%' }}
    onPointerDown={e => { (e.target as HTMLElement).setPointerCapture(e.pointerId); pick(e); }}
    onPointerMove={e => { if (e.buttons) pick(e); }} onPointerUp={onCommit} onDoubleClick={() => { onChange(hue, 0); onCommit(); }}
    title="Arrastra: tono y cantidad · Doble clic: neutro" />;
}

function WheelsEditor({ l, a }: { l: Layer; a: Adjustment }) {
  const zones = [['lift', 'Sombras'], ['gamma', 'Medios'], ['gain', 'Luces']] as const;
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        {zones.map(([z, label]) => (
          <div key={z} className="col" style={{ alignItems: 'center', gap: 4 }}>
            <span className="tiny muted">{label}</span>
            <div style={{ transform: 'scale(.72)', transformOrigin: 'top center', height: 82 }}>
              <Wheel hue={a.params[z + 'Hue'] ?? 0} amt={a.params[z + 'Amt'] ?? 0} onChange={(h, am) => setAdjParams(l.id, a.id, { [z + 'Hue']: h, [z + 'Amt']: am }, true)} onCommit={finishAdjLive} />
            </div>
          </div>
        ))}
      </div>
      {zones.map(([z, label]) => (
        <Slider key={z} label={`${label}: luminosidad`} value={a.params[z + 'Lum'] ?? 0} min={-100} max={100}
          onChange={x => setAdjParams(l.id, a.id, { [z + 'Lum']: x }, true)} onCommit={x => { setAdjParams(l.id, a.id, { [z + 'Lum']: x }, true); finishAdjLive(); }} />
      ))}
    </div>
  );
}

function LutEditor({ l, a, def }: { l: Layer; a: Adjustment; def: FxDef }) {
  const replace = async () => {
    const [f] = await pickFiles(false, '.cube');
    if (!f) return;
    try {
      const { title, lut } = parseCube(await f.text());
      setAdjParams(l.id, a.id, { name: title || f.name.replace(/\.cube$/i, ''), size: lut.size, data: encodeLut(lut) });
    } catch (e: any) { toast(e.message || String(e), 'error'); }
  };
  return (
    <>
      <div className="row"><span className="small grow" style={{ fontWeight: 500 }}>{a.params.name || 'Sin LUT'}</span><span className="tiny muted">{a.params.size ? `${a.params.size}³` : ''}</span></div>
      {def.params.map(p => <Control key={p.k} l={l} a={a} p={p} />)}
      <button className="btn sm" onClick={replace}><FileUp size={12} />Cambiar archivo .cube…</button>
    </>
  );
}

/** Parámetros de un efecto del registro (agrupados si tiene muchos). */
export function FxParams({ l, a, def }: { l: Layer; a: Adjustment; def: FxDef }) {
  const groups = [...new Set(def.params.map(p => p.group).filter(Boolean))] as string[];
  const [group, setGroup] = useState(groups[0] ?? '');
  if (def.ui === 'wheels') return <WheelsEditor l={l} a={a} />;
  if (def.ui === 'lut') return <LutEditor l={l} a={a} def={def} />;
  const visible = def.params.filter(p => !p.when || p.when({ ...def.defaults, ...a.params }));
  // muchos grupos (HSL, color selectivo, equilibrio): se elige uno y se ven sus controles
  if (groups.length > 2 || def.ui === 'balance') {
    return (
      <>
        {visible.filter(p => !p.group).map(p => <Control key={p.k} l={l} a={a} p={p} />)}
        {groups.length <= 4
          ? <Seg full value={group} onChange={setGroup} options={groups.map(g => ({ value: g, label: g }))} />
          : <div className="fx-chips">{groups.map(g => <button key={g} className={'chip' + (g === group ? ' on' : '')} onClick={() => setGroup(g)}>{g}</button>)}</div>}
        {visible.filter(p => p.group === group).map(p => <Control key={p.k} l={l} a={a} p={{ ...p, label: p.label.replace(`${group}: `, '') }} />)}
      </>
    );
  }
  return (
    <>
      {groups.length ? groups.map(g => (
        <React.Fragment key={g}>
          <div className="fx-group">{g}</div>
          {visible.filter(p => p.group === g).map(p => <Control key={p.k} l={l} a={a} p={p} />)}
        </React.Fragment>
      )) : null}
      {visible.filter(p => !p.group).map(p => <Control key={p.k} l={l} a={a} p={p} />)}
    </>
  );
}

/** Opacidad y modo de fusión del efecto respecto a lo que hay debajo en la pila (todos los efectos). */
export function MixControls({ l, a }: { l: Layer; a: Adjustment }) {
  return (
    <div className="fx-mix">
      <Slider label="Opacidad del efecto" value={a.opacity ?? 100} min={0} max={100} suffix="%"
        onChange={x => setAdjProps(l.id, a.id, { opacity: x }, true)} onCommit={x => { setAdjProps(l.id, a.id, { opacity: x }, true); finishAdjLive(); }} />
      <div className="row"><span className="small muted grow">Fusión</span>
        <Select value={(a.blend ?? 'normal') as string} onChange={v => setAdjProps(l.id, a.id, { blend: v === 'normal' ? undefined : v })} options={FX_BLENDS.map(b => ({ value: b.value as string, label: b.label }))} width={150} />
      </div>
    </div>
  );
}
