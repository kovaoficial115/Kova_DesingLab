import React, { useState } from 'react';
import { LayoutPanelTop, Plus, Trash2 } from 'lucide-react';
import { useActiveDoc } from '../../core/store';
import { Modal, Seg, Check, NumberField, ColorInput } from '../../ui/components/controls';
import { BEHANCE_WIDTH, SECTION_PRESETS, TEMPLATE_SECTIONS, MAX_SECTIONS, MIN_SECTION, MAX_SECTION, presetHeight } from '../model';
import * as B from '../actions';

type Start = 'template' | 'cover' | 'convert';

export function BehanceNewDialog({ onClose, mode = 'new' }: { onClose: () => void; mode?: 'new' | 'add' }) {
  const doc = useActiveDoc();
  const inDoc = mode === 'add' && !!doc;
  const active = doc?.state.artboards.find(a => a.id === doc.state.activeArtboardId);
  const [name, setName] = useState('Proyecto Behance');
  const [width, setWidth] = useState(BEHANCE_WIDTH);
  const [continuous, setContinuous] = useState(true);
  const [start, setStart] = useState<Start>('template');
  const [sections, setSections] = useState(() => TEMPLATE_SECTIONS.map(s => ({ ...s })));
  const [bg, setBg] = useState('#ffffff');
  const [transparent, setTransparent] = useState(false);

  const scaled = (h: number) => Math.round((h * width) / BEHANCE_WIDTH);
  const pickStart = (v: Start) => {
    setStart(v);
    if (v === 'template') setSections(TEMPLATE_SECTIONS.map(s => ({ ...s })));
    if (v === 'cover') setSections([{ name: 'Portada', h: 1000 }]);
  };
  const edit = (i: number, patch: Partial<{ name: string; h: number }>) => setSections(l => l.map((s, k) => (k === i ? { ...s, ...patch } : s)));

  const create = () => {
    if (start === 'convert' && active) {
      B.convertToProject(active.id, name, continuous);
    } else {
      const o = { name: name.trim() || 'Proyecto Behance', width, continuous, background: transparent ? null : bg, sections: sections.map(s => ({ name: s.name.trim(), h: scaled(s.h) })) };
      if (inDoc) B.addBehanceProject(o); else B.createBehanceDoc(o);
    }
    onClose();
  };

  return (
    <Modal title="Nuevo proyecto Behance" icon={<LayoutPanelTop size={16} />} onClose={onClose} width={560}
      footer={<>
        <span className="tiny muted grow">Medidas de diseño de KOVA (no son formatos oficiales de Behance). Todo se puede cambiar después.</span>
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" onClick={create} disabled={start !== 'convert' && !sections.length}>{inDoc ? 'Añadir' : 'Crear'}</button>
      </>}>
      <div className="col" style={{ gap: 10 }}>
        <div className="row"><span className="label" style={{ width: 90 }}>Nombre</span><input className="input grow" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.stopPropagation()} /></div>
        <div className="row" style={{ gap: 8 }}>
          <span className="label" style={{ width: 90 }}>Ancho</span>
          <Seg value={width === 1400 ? '1400' : width === 2800 ? '2800' : 'x'} onChange={v => { if (v !== 'x') setWidth(+v); }} options={[
            { value: '1400', label: '1400 px', title: 'El ancho al que Behance muestra el contenido' },
            { value: '2800', label: '2800 px', title: 'El máximo que recomienda Behance (doble densidad)' },
            { value: 'x', label: 'Otro' },
          ]} />
          <NumberField value={width} onChange={setWidth} min={100} max={6000} digits={0} suffix="px" width={96} />
        </div>
        <div className="tiny muted">Puedes diseñar a 1400 px y exportar a ×2 (2800 px): la exportación deja elegir la resolución.</div>
        <div className="row" style={{ gap: 8 }}>
          <span className="label" style={{ width: 90 }}>Modo</span>
          <Seg value={continuous ? 'c' : 's'} onChange={v => setContinuous(v === 'c')} options={[{ value: 'c', label: 'Continuo' }, { value: 's', label: 'Por secciones' }]} />
        </div>
        <div className="tiny muted">{continuous
          ? 'Continuo: las secciones van pegadas y se diseña como una sola presentación vertical; los elementos pueden cruzar de una sección a otra. Las guías de sección solo se ven en pantalla.'
          : 'Por secciones: cada sección es una mesa separada en el lienzo.'}</div>
        {start !== 'convert' && (
          <div className="row" style={{ gap: 8 }}>
            <span className="label" style={{ width: 90 }}>Fondo</span>
            <ColorInput value={bg} onChange={setBg} />
            <Check checked={transparent} onChange={setTransparent} label="Transparente" />
          </div>
        )}

        <div className="section-title">Empezar con</div>
        <Seg value={start} onChange={pickStart} full options={[
          { value: 'template', label: 'Estructura de presentación' },
          { value: 'cover', label: 'Solo portada' },
          ...(inDoc && active && !active.behance ? [{ value: 'convert' as Start, label: `Usar «${active.name.slice(0, 16)}»` }] : []),
        ]} />
        {start === 'convert' ? (
          <div className="tiny muted">La mesa «{active?.name}» ({active?.w}×{active?.h}) pasa a ser la primera sección del proyecto, sin cambiar su tamaño ni su contenido.</div>
        ) : (
          <div className="col" style={{ gap: 3, maxHeight: 260, overflowY: 'auto' }}>
            {sections.map((s, i) => (
              <div key={i} className="row" style={{ gap: 6 }}>
                <span className="tiny mono muted" style={{ width: 18 }}>{String(i + 1).padStart(2, '0')}</span>
                <input className="input grow" value={s.name} onChange={e => edit(i, { name: e.target.value })} onKeyDown={e => e.stopPropagation()} aria-label={`Nombre de la sección ${i + 1}`} />
                <select className="select" value={SECTION_PRESETS.find(p => p.h === s.h)?.id ?? 'custom'} onChange={e => { const p = SECTION_PRESETS.find(x => x.id === e.target.value); if (p) edit(i, { h: p.h }); }} aria-label="Alto">
                  {SECTION_PRESETS.map(p => <option key={p.id} value={p.id}>{width}×{presetHeight(p, width)}</option>)}
                  {!SECTION_PRESETS.some(p => p.h === s.h) && <option value="custom">{width}×{scaled(s.h)}</option>}
                </select>
                <NumberField value={scaled(s.h)} onChange={v => edit(i, { h: Math.round((v * BEHANCE_WIDTH) / width) })} min={MIN_SECTION} max={MAX_SECTION} digits={0} width={74} title="Alto personalizado" />
                <button className="icon-btn sm" title="Quitar" onClick={() => setSections(l => l.filter((_, k) => k !== i))}><Trash2 size={12} /></button>
              </div>
            ))}
            <button className="btn sm ghost" disabled={sections.length >= MAX_SECTIONS} onClick={() => setSections(l => [...l, { name: `Sección ${l.length + 1}`, h: 1800 }])}><Plus size={12} />Sección</button>
          </div>
        )}
      </div>
    </Modal>
  );
}
