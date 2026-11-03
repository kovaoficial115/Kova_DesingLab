import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

/** Campo numérico con arrastre sobre la etiqueta (scrub), flechas y Enter. */
export function NumberField(props: {
  value: number; onChange: (v: number) => void; onCommit?: (v: number) => void; label?: React.ReactNode; suffix?: string;
  min?: number; max?: number; step?: number; digits?: number; width?: number | string; title?: string; disabled?: boolean;
}) {
  const { value, onChange, label, suffix, min = -Infinity, max = Infinity, step = 1, digits = 2, width, title, disabled } = props;
  const commit = props.onCommit ?? onChange;
  const fmt = (v: number) => (Number.isFinite(v) ? String(+v.toFixed(digits)) : '');
  const [text, setText] = useState(fmt(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(fmt(value)); }, [value, digits]);
  const clampV = (v: number) => Math.min(max, Math.max(min, v));
  const apply = () => {
    let v: number;
    try { v = Function(`"use strict";return (${text.replace(/,/g, '.')})`)(); } catch { v = parseFloat(text); }
    if (Number.isFinite(v)) { const c = clampV(v); commit(c); setText(fmt(c)); } else setText(fmt(value));
  };
  const onScrub = (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    const sx = e.clientX, v0 = value;
    let last = v0;
    const move = (ev: PointerEvent) => {
      const mult = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      last = clampV(+(v0 + Math.round((ev.clientX - sx) / 2) * step * mult).toFixed(digits));
      onChange(last);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); commit(last); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div className="num" style={{ width, opacity: disabled ? 0.5 : 1 }} title={title}>
      {label != null && <span className="lbl" onPointerDown={onScrub}>{label}</span>}
      <input
        value={text} disabled={disabled}
        onFocus={e => { focused.current = true; e.target.select(); }}
        onBlur={() => { focused.current = false; apply(); }}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === 'Enter') { apply(); (e.target as HTMLInputElement).blur(); }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const c = clampV(+(value + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)).toFixed(digits));
            commit(c); setText(fmt(c));
          }
          if (e.key === 'Escape') { setText(fmt(value)); (e.target as HTMLInputElement).blur(); }
        }}
      />
      {suffix && <span className="suffix">{suffix}</span>}
    </div>
  );
}

/** Deslizador con etiqueta y valor editable. onCommit se llama al soltar. */
export function Slider(props: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; onCommit?: (v: number) => void;
  suffix?: string; digits?: number; hint?: string;
}) {
  const { label, value, min, max, step = 1, onChange, onCommit, suffix, digits = 0, hint } = props;
  return (
    <div className="col" style={{ gap: 2 }} title={hint}>
      <div className="row">
        <span className="small muted grow">{label}</span>
        <NumberField value={value} onChange={onChange} onCommit={v => { onChange(v); onCommit?.(v); }} min={min} max={max} step={step} digits={digits} suffix={suffix} width={74} />
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        onPointerUp={e => onCommit?.(parseFloat((e.target as HTMLInputElement).value))}
        onKeyDown={e => e.stopPropagation()} />
    </div>
  );
}

export function Select<T extends string>(props: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; width?: number | string; title?: string }) {
  return (
    <select className="input" style={{ width: props.width }} value={props.value} title={props.title}
      onChange={e => props.onChange(e.target.value as T)} onKeyDown={e => e.stopPropagation()}>
      {props.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Seg<T extends string>(props: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode; title?: string }[]; full?: boolean }) {
  return (
    <div className={'seg' + (props.full ? ' full' : '')}>
      {props.options.map(o => (
        <button key={o.value} className={o.value === props.value ? 'on' : ''} title={o.title} onClick={() => props.onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Check(props: { checked: boolean; onChange: (v: boolean) => void; label: React.ReactNode; title?: string }) {
  return (
    <label className="row small" style={{ cursor: 'pointer', gap: 7 }} title={props.title}>
      <input type="checkbox" checked={props.checked} onChange={e => props.onChange(e.target.checked)} />
      <span>{props.label}</span>
    </label>
  );
}

export function Modal(props: { title: React.ReactNode; icon?: React.ReactNode; onClose: () => void; width?: number | string; children: React.ReactNode; footer?: React.ReactNode; height?: number | string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); props.onClose(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [props.onClose]);
  return (
    <div className="modal-back" onPointerDown={e => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div className="modal" style={{ width: props.width ?? 460, height: props.height }} onKeyDown={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{props.icon}{props.title}</h3>
          <button className="icon-btn" onClick={props.onClose} title="Cerrar (Esc)"><X size={16} /></button>
        </div>
        <div className="modal-body" style={{ flex: 1 }}>{props.children}</div>
        {props.footer && <div className="modal-foot">{props.footer}</div>}
      </div>
    </div>
  );
}

export function ColorInput(props: { value: string; onChange: (v: string) => void; onCommit?: (v: string) => void; title?: string }) {
  return <input type="color" value={props.value} title={props.title}
    onChange={e => props.onChange(e.target.value)}
    onBlur={e => props.onCommit?.(e.target.value)} />;
}

/** Vista previa de un canvas escalado dentro de una caja. */
export function CanvasPreview(props: { canvas: HTMLCanvasElement | null; className?: string; style?: React.CSSProperties; pixelated?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = '';
    if (props.canvas) {
      const c = props.canvas;
      c.style.maxWidth = '100%'; c.style.maxHeight = '100%'; c.style.display = 'block';
      c.style.imageRendering = props.pixelated ? 'pixelated' : 'auto';
      el.appendChild(c);
    }
  }, [props.canvas, props.pixelated]);
  return <div ref={ref} className={props.className} style={{ display: 'grid', placeItems: 'center', ...props.style }} />;
}
