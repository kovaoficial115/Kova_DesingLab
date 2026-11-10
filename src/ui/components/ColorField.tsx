import React, { useEffect, useState } from 'react';
import { useStore } from '../../core/store';

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
/** Normaliza '#abc' / 'abc' / '#aabbcc' a '#aabbcc' (o null si no es un color). */
export function normalizeHex(v: string): string | null {
  const m = HEX.exec(v.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, c => c + c) : m[1];
  return '#' + h.toLowerCase();
}

/**
 * Cualquier color: selector del sistema, código hexadecimal y, opcionalmente, las muestras
 * guardadas y el color frontal para elegir con un clic.
 */
export function ColorField(props: { label?: React.ReactNode; value: string; onChange: (v: string) => void; swatches?: boolean; title?: string }) {
  const fg = useStore(s => s.fg);
  const saved = useStore(s => s.swatches);
  const [text, setText] = useState(props.value);
  useEffect(() => setText(props.value), [props.value]);
  const commitText = () => {
    const h = normalizeHex(text);
    if (h) props.onChange(h); else setText(props.value);
  };
  const quick = [...new Set([fg, ...saved].map(c => normalizeHex(c)).filter(Boolean) as string[])];
  return (
    <div className="color-field">
      <div className="row">
        {props.label && <span className="label">{props.label}</span>}
        <input type="color" value={normalizeHex(props.value) ?? '#000000'} title={props.title ?? 'Elegir color'} onChange={e => props.onChange(e.target.value)} />
        <input className="input hex" value={text} spellCheck={false} maxLength={7} aria-label="Código de color"
          onChange={e => setText(e.target.value)} onBlur={commitText}
          onKeyDown={e => { if (e.key === 'Enter') { commitText(); (e.target as HTMLInputElement).blur(); } }} />
      </div>
      {props.swatches !== false && (
        <div className="color-swatches">
          {quick.map((c, i) => (
            <button key={c} type="button" className={'sw' + (c === normalizeHex(props.value) ? ' on' : '')} style={{ background: c }}
              title={i === 0 && c === normalizeHex(fg) ? `Color frontal ${c}` : c} onClick={() => props.onChange(c)} />
          ))}
        </div>
      )}
    </div>
  );
}
