// Selector de tipografía con búsqueda y vista previa: fuentes del usuario + fuentes predeterminadas.

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Plus, Search } from 'lucide-react';
import { set } from '../../core/store';
import { customFamilies, familyValue, fontsVersion, primaryFamily, subscribeFonts } from '../../io/fonts';

export const DEFAULT_FONTS = [
  'Inter, sans-serif', 'Arial, sans-serif', 'Helvetica, sans-serif', 'Impact, sans-serif', 'Georgia, serif', 'Times New Roman, serif',
  'Courier New, monospace', 'Verdana, sans-serif', 'Trebuchet MS, sans-serif', 'Arial Black, sans-serif', 'Futura, sans-serif',
  'Gill Sans, sans-serif', 'Didot, serif', 'Copperplate, serif', 'Brush Script MT, cursive', 'Marker Felt, fantasy', 'JetBrains Mono, monospace',
];

export function useFontsVersion() { return useSyncExternalStore(subscribeFonts, fontsVersion); }

export function FontPicker({ value, onChange, width }: { value: string; onChange: (v: string) => void; width?: number | string }) {
  const version = useFontsVersion();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number; maxH: number }>({ left: 0, top: 0, width: 260, maxH: 360 });
  const current = primaryFamily(value);

  const groups = useMemo(() => {
    const m = (s: string) => s.toLowerCase().includes(q.trim().toLowerCase());
    return [
      { title: 'Mis fuentes', items: customFamilies().filter(m).map(f => ({ label: f, value: familyValue(f) })) },
      { title: 'Predeterminadas', items: DEFAULT_FONTS.filter(f => m(primaryFamily(f))).map(f => ({ label: primaryFamily(f), value: f })) },
    ].filter(g => g.items.length);
  }, [q, open, version]);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const w = Math.max(r.width, 260);
    const left = Math.min(r.left, window.innerWidth - w - 8);
    const below = window.innerHeight - r.bottom - 12, above = r.top - 12;
    // abrir hacia arriba si no cabe debajo
    if (below < 300 && above > below) setPos({ left, bottom: window.innerHeight - r.top + 4, width: w, maxH: Math.min(420, above) });
    else setPos({ left, top: r.bottom + 4, width: w, maxH: Math.min(420, below) });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  }, [open]);

  const choose = (v: string) => { onChange(v); setOpen(false); setQ(''); };
  return (
    <>
      <button ref={btn} className="input font-trigger" style={{ width }} onClick={() => setOpen(o => !o)} title={current}>
        <span style={{ fontFamily: value, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current}</span>
        <ChevronDown size={13} className="muted" />
      </button>
      {open && createPortal(
        <div ref={pop} className="font-pop" style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.maxH }}
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') setOpen(false); }}>
          <div className="font-search"><Search size={13} className="muted" /><input autoFocus placeholder="Buscar fuente…" value={q} onChange={e => setQ(e.target.value)} /></div>
          <div className="font-list">
            {groups.map(g => (
              <div key={g.title}>
                <div className="section-title" style={{ padding: '6px 8px 2px' }}>{g.title}</div>
                {g.items.map(it => (
                  <button key={it.value} className={'font-item' + (it.label === current ? ' on' : '')} style={{ fontFamily: it.value }} onClick={() => choose(it.value)}>{it.label}</button>
                ))}
              </div>
            ))}
            {!groups.length && <div className="tiny muted" style={{ padding: 10 }}>Ninguna fuente coincide. Puedes descargarla de Google Fonts.</div>}
          </div>
          <button className="btn sm font-add" onClick={() => { setOpen(false); set({ dialog: { type: 'fonts', props: { query: q } } }); }}><Plus size={12} />Añadir fuentes (subir, Google Fonts, DaFont…)</button>
        </div>,
        document.body,
      )}
    </>
  );
}
