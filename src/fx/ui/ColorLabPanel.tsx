// Color Lab: los ajustes de color agrupados como en un revelador (Básico, Curvas, HSL, Ruedas,
// Equilibrio, Virado, Selectivo, LUT y looks). Cada pestaña edita el ajuste de ese tipo que ya
// tiene la capa (el último) o lo crea con un clic; todo sigue siendo parte de la pila de Ajustes.

import React, { useState } from 'react';
import { Plus, FileUp, FileDown, Eye, EyeOff } from 'lucide-react';
import type { Adjustment, Doc, Layer } from '../../core/types';
import { set } from '../../core/store';
import { fxDef, FX } from '../../engine/fx/registry';
import { Editor } from '../../ui/panels/AdjustmentsPanel';
import * as A from '../../core/actions';
import { FxParams, MixControls } from './FxEditor';
import { PresetGrid } from './EffectsPanel';
import { addEffect, importLut, exportColorAsCube, useFxLibrary, labelOf } from '../lib';

const TABS = [
  { id: 'colorBasic', label: 'Básico' }, { id: 'curves', label: 'Curvas' }, { id: 'hsl', label: 'HSL' }, { id: 'colorWheels', label: 'Ruedas' },
  { id: 'colorBalance', label: 'Equilibrio' }, { id: 'splitToning', label: 'Virado' }, { id: 'selectiveColor', label: 'Selectivo' },
  { id: 'gradientMap', label: 'Degradado' }, { id: 'lut', label: 'LUT' }, { id: 'looks', label: 'Looks' },
] as const;
type Tab = typeof TABS[number]['id'];

function AdjEditor({ l, a }: { l: Layer; a: Adjustment }) {
  const def = fxDef(a.type);
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="row">
        <span className="small grow" style={{ fontWeight: 600 }}>{labelOf(a)}</span>
        <button className="icon-btn sm" title="Activar/desactivar" onClick={() => A.toggleAdjustment(l.id, a.id)}>{a.enabled ? <Eye size={12} /> : <EyeOff size={12} />}</button>
      </div>
      {def ? <FxParams l={l} a={a} def={def} /> : <Editor l={l} a={a} />}
      <MixControls l={l} a={a} />
    </div>
  );
}

export function ColorLabPanel({ doc }: { doc: Doc }) {
  const s = doc.state;
  const l = s.layers.find(x => x.id === s.selectedLayerIds[s.selectedLayerIds.length - 1] && x.kind !== 'group') ?? null;
  const [tab, setTab] = useState<Tab>('colorBasic');
  const { presets } = useFxLibrary();
  // looks de color: preajustes cuyos efectos son todos de color (por píxel)
  const looks = presets.filter(p => p.items.every(it => FX[it.type]?.point || ['curves', 'levels', 'gradientMap', 'hueSaturation', 'vibrance', 'colorize', 'exposure', 'brightnessContrast', 'blackWhite'].includes(it.type)) || ['cinematic', 'cyberpunk', 'editorial'].includes(p.cat));
  const label = TABS.find(t => t.id === tab)!.label;
  const list = l ? l.adjustments.filter(a => a.type === tab) : [];
  const current = list[list.length - 1];
  const add = () => {
    if (!l) return;
    if (tab === 'curves' || tab === 'gradientMap') { A.addAdjustment(tab).then(a => { if (a) set({ fxFocus: { layerId: l.id, adjId: a.id } }); }); return; }
    addEffect({ type: tab, label: FX[tab]?.label ?? label });
  };
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="fx-chips">
        {TABS.map(t => <button key={t.id} className={'chip' + (tab === t.id ? ' on' : '')} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      {!l && <div className="tiny muted">Selecciona una capa (foto, texto, forma…) para corregir su color.</div>}
      {l && tab === 'looks' && <>
        <span className="tiny muted">Looks de color editables: al aplicarlos se añaden sus ajustes a la pila.</span>
        <PresetGrid presets={looks} layer={l} mode="append" />
      </>}
      {l && tab === 'lut' && <>
        <button className="btn sm" onClick={importLut}><FileUp size={12} />Importar LUT (.cube)…</button>
        {list.map(a => <div key={a.id} className="card" style={{ padding: 8 }}><AdjEditor l={l} a={a} /></div>)}
        {!list.length && <span className="tiny muted">Las LUT .cube (3D o 1D) se aplican con intensidad regulable y se combinan con el resto de ajustes. Se guardan dentro del .kova.</span>}
        <button className="btn sm" onClick={() => exportColorAsCube(l, l.name + ' color')} title="Convierte los ajustes de color de esta capa en una LUT para otros programas"><FileDown size={12} />Exportar el color como .cube</button>
      </>}
      {l && tab !== 'looks' && tab !== 'lut' && (current
        ? <div className="card" style={{ padding: 8 }}><AdjEditor l={l} a={current} /></div>
        : <button className="btn sm" onClick={add}><Plus size={12} />Añadir {label.toLowerCase()} a «{l.name}»</button>)}
      {l && list.length > 1 && tab !== 'lut' && <span className="tiny muted">La capa tiene {list.length} ajustes de este tipo: aquí se edita el último; el resto, en Ajustes.</span>}
      {l && <button className="btn sm" onClick={() => set(st => ({ panels: st.panels.map(p => (p.id === 'adjustments' ? { ...p, visible: true, collapsed: false } : p)) }))}>Ver la pila completa en Ajustes</button>}
    </div>
  );
}
