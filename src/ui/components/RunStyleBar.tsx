// Estilo de una parte del texto: tipografía, peso, cursiva y color de lo seleccionado en el editor.
import React from 'react';
import { Italic, RemoveFormatting } from 'lucide-react';
import type { TextProps } from '../../core/types';
import { applyRunStyle, normalizeRuns, styleAt, type RunPatch, type TextRun } from '../../core/textruns';
import { ColorInput, Select } from './controls';
import { FontPicker } from './FontPicker';

export function RunStyleBar({ t, sel, onRuns }: {
  t: TextProps;
  /** selección del área de texto [inicio, fin) */
  sel: [number, number];
  /** nuevos fragmentos; `commit` = nombre del paso del historial (false mientras se arrastra un color) */
  onRuns: (runs: TextRun[] | undefined, commit: string | false) => void;
}) {
  if (t.path) return null; // el texto en trayectoria lleva un único estilo
  const [a, b] = sel[0] <= sel[1] ? sel : [sel[1], sel[0]];
  const len = t.text.length;
  if (b <= a || a >= len) {
    return <div className="tiny muted" style={{ marginTop: 6 }}>Selecciona una parte del texto para cambiarle la tipografía o el color.</div>;
  }
  const runs = normalizeRuns(t.runs, len);
  const st = styleAt(runs, a);
  const apply = (patch: RunPatch, commit: string | false = 'Estilo de una parte del texto') => {
    const next = applyRunStyle(runs, a, b, patch, len);
    onRuns(next.length ? next : undefined, commit);
  };
  const touched = runs.some(r => r.start < b && r.end > a);
  return (
    <div style={{ marginTop: 6 }}>
      <div className="tiny muted" style={{ marginBottom: 4 }}>Selección ({b - a} caracteres)</div>
      <div className="row">
        <div className="grow"><FontPicker value={st.fontFamily ?? t.fontFamily} onChange={v => apply({ fontFamily: v === t.fontFamily ? null : v })} width="100%" /></div>
        <ColorInput value={st.color ?? t.color} title="Color de la selección"
          onChange={v => apply({ color: v }, false)} onCommit={v => apply({ color: v })} />
      </div>
      <div className="row" style={{ marginTop: 4 }}>
        <Select value={String(st.fontWeight ?? t.fontWeight) as any} width={90} title="Peso de la selección"
          onChange={v => apply({ fontWeight: +v === t.fontWeight ? null : +v })}
          options={[100, 200, 300, 400, 500, 600, 700, 800, 900].map(w => ({ value: String(w), label: String(w) }))} />
        <button className={'icon-btn sm' + ((st.italic ?? t.italic) ? ' active' : '')} title="Cursiva en la selección"
          onClick={() => { const v = !(st.italic ?? t.italic); apply({ italic: v === t.italic ? null : v }); }}><Italic size={12} /></button>
        <div className="grow" />
        <button className="btn sm" disabled={!touched} title="La selección vuelve a tener el estilo del resto del texto"
          onClick={() => apply({ fontFamily: null, color: null, fontWeight: null, italic: null })}><RemoveFormatting size={12} /> Quitar</button>
      </div>
    </div>
  );
}
