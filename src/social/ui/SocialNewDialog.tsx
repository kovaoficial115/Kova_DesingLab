import React, { useMemo, useState } from 'react';
import { Smartphone, RotateCcw, Trash2, ArrowLeftRight, Lock, Unlock } from 'lucide-react';
import { useStore, set, activeDoc, toast } from '../../core/store';
import { Modal, Seg, Select, NumberField, ColorInput, Check } from '../../ui/components/controls';
import { allFormats, aspectLabel, PLATFORMS, toPixels, fromPixels, fileKeyFrom, type PlatformId, type SocialFormat, type SizeUnit, type Insets } from '../presets';
import { MAX_SLIDES } from '../carousel';
import * as S from '../actions';
import { FormatSelect } from './SocialPanel';

type Tab = 'formats' | 'custom' | 'series' | 'edit';
type Bg = 'white' | 'black' | 'transparent' | 'custom';

const RATIOS: { value: string; label: string; r: number | null }[] = [
  { value: 'free', label: 'Libre', r: null }, { value: '1:1', label: '1:1', r: 1 }, { value: '4:5', label: '4:5', r: 4 / 5 }, { value: '3:4', label: '3:4', r: 3 / 4 },
  { value: '2:3', label: '2:3', r: 2 / 3 }, { value: '9:16', label: '9:16', r: 9 / 16 }, { value: '16:9', label: '16:9', r: 16 / 9 },
];

function FormatCard({ f, active, onClick }: { f: SocialFormat; active: boolean; onClick: () => void }) {
  const k = 34 / Math.max(f.w, f.h);
  return (
    <div className={'preset' + (active ? ' active' : '')} role="button" tabIndex={0} aria-pressed={active} onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}>
      <div className="shape"><div style={f.circle ? { width: 24, height: 24, borderRadius: '50%' } : { width: Math.max(6, f.w * k), height: Math.max(6, f.h * k) }} /></div>
      <div className="small" style={{ fontWeight: 600 }}>{f.name}</div>
      <div className="tiny muted">{f.w}×{f.h} px · {aspectLabel(f.w, f.h)}{f.user ? ' · editado' : ''}</div>
    </div>
  );
}

export function SocialNewDialog({ onClose, mode: mode0, tab: tab0 }: { onClose: () => void; mode?: 'new' | 'add'; tab?: Tab }) {
  const user = useStore(s => s.socialFormats);
  const formats = useMemo(() => allFormats(user), [user]);
  const hasDoc = !!activeDoc();
  const [mode, setMode] = useState<'new' | 'add'>(hasDoc ? mode0 ?? 'new' : 'new');
  const [tab, setTab] = useState<Tab>(tab0 ?? 'formats');
  const [platform, setPlatform] = useState<PlatformId>('instagram');
  const [sel, setSel] = useState('ig-post-portrait');
  const [bg, setBg] = useState<Bg>('white');
  const [color, setColor] = useState('#f0e7de');
  const background = bg === 'transparent' ? null : bg === 'white' ? '#ffffff' : bg === 'black' ? '#000000' : color;

  // personalizado
  const [name, setName] = useState('Formato propio');
  const [unit, setUnit] = useState<SizeUnit>('px');
  const [ppi, setPpi] = useState(72);
  const [w, setW] = useState(1080);
  const [h, setH] = useState(1350);
  const [ratio, setRatio] = useState('free');
  const [lock, setLock] = useState(false);
  const [cPlatform, setCPlatform] = useState<PlatformId>('custom');
  const pxW = toPixels(w, unit, ppi), pxH = toPixels(h, unit, ppi);
  const r = RATIOS.find(x => x.value === ratio)?.r ?? null;
  const lockedRatio = r ?? (lock ? pxW / pxH : null);
  const setWidth = (v: number) => { setW(v); if (lockedRatio) setH(+(v / lockedRatio).toFixed(unit === 'px' ? 0 : 2)); };
  const setHeight = (v: number) => { setH(v); if (lockedRatio) setW(+(v * lockedRatio).toFixed(unit === 'px' ? 0 : 2)); };
  const changeUnit = (u: SizeUnit) => { setW(+fromPixels(pxW, u, ppi).toFixed(u === 'px' ? 0 : 2)); setH(+fromPixels(pxH, u, ppi).toFixed(u === 'px' ? 0 : 2)); setUnit(u); };

  // series
  const [kind, setKind] = useState<'carousel' | 'continuous' | 'highlights'>('carousel');
  const [serFormat, setSerFormat] = useState('ig-carousel');
  const [count, setCount] = useState(5);
  const [names, setNames] = useState('');

  const f = formats.find(x => x.id === sel);
  const create = (fmt: SocialFormat, o: S.NewSocialOptions = {}) => {
    if (mode === 'new') S.createSocialDoc(fmt, { background, ...o });
    else if (o.highlights) S.addHighlights(fmt, o.highlights, background);
    else {
      const ab = S.addFormatArtboard(fmt, background);
      if (ab && (o.slides ?? 1) > 1) S.makeCarousel(ab.id, o.slides!, !!o.continuous);
    }
    onClose();
  };

  const saveCustom = (): SocialFormat | null => {
    if (pxW < 16 || pxH < 16 || pxW > 20000 || pxH > 20000) { toast('Medidas fuera de rango (16–20000 px)', 'warn'); return null; }
    const existing = user.custom.find(c => c.w === pxW && c.h === pxH && c.name === name.trim());
    if (existing) return existing;
    const m = Math.round(Math.min(pxW, pxH) * 0.05);
    const nf: SocialFormat = {
      id: `user-${Date.now().toString(36)}`, platform: cPlatform, name: name.trim() || `${pxW}×${pxH}`, w: pxW, h: pxH,
      fileKey: fileKeyFrom(`${cPlatform === 'custom' ? 'personalizado' : cPlatform}_${name}`), safe: { top: m, right: m, bottom: m, left: m }, user: true,
    };
    set(s => ({ socialFormats: { ...s.socialFormats, custom: [...s.socialFormats.custom, nf] } }));
    return nf;
  };

  const body = () => {
    switch (tab) {
      case 'formats': return (
        <>
          <Seg value={platform} onChange={setPlatform} full options={PLATFORMS.filter(p => p.id !== 'custom' || user.custom.length).map(p => ({ value: p.id, label: p.name }))} />
          <div className="preset-grid">
            {formats.filter(x => x.platform === platform).map(x => <FormatCard key={x.id} f={x} active={x.id === sel} onClick={() => setSel(x.id)} />)}
          </div>
          {f?.circle && <div className="tiny muted">Formato con recorte circular: la guía muestra el círculo visible y el área segura.</div>}
        </>
      );
      case 'custom': return (
        <>
          <div className="row"><span className="label">Nombre</span><input className="input" value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="row"><span className="label">Plataforma</span><Select value={cPlatform} onChange={setCPlatform} options={PLATFORMS.map(p => ({ value: p.id, label: p.name }))} /></div>
          <div className="row">
            <span className="label">Ancho</span><NumberField value={w} onChange={setWidth} min={0.01} digits={unit === 'px' ? 0 : 2} />
            <button className="icon-btn" title={lock ? 'Proporción bloqueada' : 'Bloquear proporción'} aria-pressed={lock} onClick={() => setLock(!lock)}>{lock || r ? <Lock size={13} /> : <Unlock size={13} />}</button>
            <span className="label" style={{ textAlign: 'right' }}>Alto</span><NumberField value={h} onChange={setHeight} min={0.01} digits={unit === 'px' ? 0 : 2} />
          </div>
          <div className="row">
            <span className="label">Unidades</span><Select value={unit} onChange={changeUnit} options={[{ value: 'px', label: 'px' }, { value: 'cm', label: 'cm' }, { value: 'mm', label: 'mm' }, { value: 'in', label: 'in' }]} />
            <span className="label" style={{ textAlign: 'right' }}>Resolución</span><NumberField value={ppi} onChange={v => setPpi(Math.max(1, Math.round(v)))} min={1} max={2400} digits={0} suffix="ppp" />
          </div>
          <div className="row">
            <span className="label">Proporción</span>
            <Select value={ratio} onChange={v => { setRatio(v); const rr = RATIOS.find(x => x.value === v)?.r; if (rr) setH(+(w / rr).toFixed(unit === 'px' ? 0 : 2)); }} options={RATIOS.map(x => ({ value: x.value, label: x.label }))} />
            <button className="btn sm" title="Intercambiar ancho y alto" onClick={() => { setW(h); setH(w); const rr = RATIOS.find(x => x.value === ratio); if (rr?.r) { const inv = RATIOS.find(x => x.r && Math.abs(x.r - 1 / rr.r!) < 1e-3); setRatio(inv?.value ?? 'free'); } }}>
              <ArrowLeftRight size={12} />{pxW >= pxH ? 'Horizontal' : 'Vertical'}
            </button>
          </div>
          <div className="tiny muted">{pxW}×{pxH} px · {aspectLabel(pxW, pxH)} · {((pxW * pxH) / 1e6).toFixed(1)} MP. Se guarda en tus formatos para volver a usarlo.</div>
        </>
      );
      case 'series': return (
        <>
          <Seg value={kind} onChange={setKind} full options={[{ value: 'carousel', label: 'Carrusel' }, { value: 'continuous', label: 'Continuo' }, { value: 'highlights', label: 'Destacadas' }]} />
          {kind === 'highlights' ? (
            <>
              <div className="tiny muted">Una portada por línea. El nombre aparece bajo el círculo en la vista previa del perfil y en el archivo exportado.</div>
              <textarea className="input" rows={6} value={names} onChange={e => setNames(e.target.value)} placeholder={'DROP 01\nCOLECCIONES\nENVÍOS'} style={{ resize: 'vertical' }} />
              {!names.trim() && <div className="row"><span className="label">Portadas</span><NumberField value={count} onChange={v => setCount(Math.round(v))} min={1} max={MAX_SLIDES} digits={0} /></div>}
            </>
          ) : (
            <>
              <div className="row"><span className="label">Formato</span><div className="grow"><FormatSelect value={serFormat} formats={formats.filter(x => !x.circle)} onChange={x => setSerFormat(x.id)} /></div></div>
              <div className="row"><span className="label">Diapositivas</span><NumberField value={count} onChange={v => setCount(Math.round(v))} min={2} max={MAX_SLIDES} digits={0} /></div>
              <div className="tiny muted">{kind === 'continuous'
                ? 'Diapositivas pegadas sin hueco: una imagen o texto que cruza el corte continúa en la siguiente, y se exporta partido exactamente por los bordes.'
                : 'Diapositivas independientes en fila, numeradas y exportadas en orden.'}</div>
            </>
          )}
        </>
      );
      case 'edit': return <FormatEditor />;
    }
  };

  const go = () => {
    if (tab === 'formats') { if (f) create(f); return; }
    if (tab === 'custom') { const nf = saveCustom(); if (nf) create(nf); return; }
    if (tab === 'series') {
      if (kind === 'highlights') {
        const hf = formats.find(x => x.id === 'ig-highlight')!;
        const list = names.split('\n').map(x => x.trim()).filter(Boolean);
        const labels = list.length ? list : Array.from({ length: count }, (_, i) => `Destacada ${i + 1}`);
        create(hf, { highlights: labels.slice(0, MAX_SLIDES) });
      } else {
        const sf = formats.find(x => x.id === serFormat);
        if (sf) create(sf, { slides: count, continuous: kind === 'continuous' });
      }
    }
  };

  return (
    <Modal title="Social Design Studio" icon={<Smartphone size={16} />} onClose={onClose} width={640}
      footer={<>
        {hasDoc && tab !== 'edit' && <Seg value={mode} onChange={setMode} options={[{ value: 'new', label: 'Documento nuevo' }, { value: 'add', label: 'Añadir al abierto' }]} />}
        <div className="spacer" />
        <button className="btn" onClick={onClose}>{tab === 'edit' ? 'Cerrar' : 'Cancelar'}</button>
        {tab !== 'edit' && <button className="btn primary" onClick={go} disabled={tab === 'formats' && !f}>Crear</button>}
      </>}>
      <Seg value={tab} onChange={setTab} full options={[{ value: 'formats', label: 'Formatos' }, { value: 'custom', label: 'Personalizado' }, { value: 'series', label: 'Carrusel y destacadas' }, { value: 'edit', label: 'Editar formatos' }]} />
      {body()}
      {tab !== 'edit' && (
        <div className="row"><span className="label">Fondo</span>
          <Seg value={bg} onChange={setBg} options={[{ value: 'white', label: 'Blanco' }, { value: 'black', label: 'Negro' }, { value: 'transparent', label: 'Transparente' }, { value: 'custom', label: 'Color' }]} />
          {bg === 'custom' && <ColorInput value={color} onChange={setColor} />}
        </div>
      )}
    </Modal>
  );
}

/** Edición de formatos: medidas y zona segura de los de fábrica (restaurables) y de los propios. */
function FormatEditor() {
  const user = useStore(s => s.socialFormats);
  const formats = allFormats(user);
  const [id, setId] = useState(formats[0].id);
  const f = formats.find(x => x.id === id) ?? formats[0];
  const builtin = !f.id.startsWith('user-');
  const patch = (p: Partial<Pick<SocialFormat, 'name' | 'w' | 'h' | 'safe'>>) => set(s => {
    const uf = s.socialFormats;
    if (builtin) return { socialFormats: { ...uf, overrides: { ...uf.overrides, [f.id]: { ...uf.overrides[f.id], ...p } } } };
    return { socialFormats: { ...uf, custom: uf.custom.map(c => (c.id === f.id ? { ...c, ...p } : c)) } };
  });
  const safe: Insets = f.safe ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const setSafe = (k: keyof Insets) => (v: number) => patch({ safe: { ...safe, [k]: Math.max(0, Math.round(v)) } });
  return (
    <>
      <div className="tiny muted">Si una plataforma cambia sus medidas, ajústalas aquí: los cambios se guardan en este equipo y las guías del visor se actualizan.</div>
      <FormatSelect value={f.id} formats={formats} onChange={x => setId(x.id)} />
      <div className="row"><span className="label">Nombre</span><input className="input" value={f.name} onChange={e => patch({ name: e.target.value })} /></div>
      <div className="row">
        <span className="label">Ancho</span><NumberField value={f.w} onChange={v => patch({ w: Math.max(16, Math.round(v)) })} min={16} max={20000} digits={0} suffix="px" />
        <span className="label" style={{ textAlign: 'right' }}>Alto</span><NumberField value={f.h} onChange={v => patch({ h: Math.max(16, Math.round(v)) })} min={16} max={20000} digits={0} suffix="px" />
      </div>
      <div className="section-title">Zona segura (px desde cada borde)</div>
      <div className="grid2">
        <div className="row"><span className="label">Arriba</span><NumberField value={safe.top} onChange={setSafe('top')} min={0} digits={0} /></div>
        <div className="row"><span className="label">Abajo</span><NumberField value={safe.bottom} onChange={setSafe('bottom')} min={0} digits={0} /></div>
        <div className="row"><span className="label">Izquierda</span><NumberField value={safe.left} onChange={setSafe('left')} min={0} digits={0} /></div>
        <div className="row"><span className="label">Derecha</span><NumberField value={safe.right} onChange={setSafe('right')} min={0} digits={0} /></div>
      </div>
      <div className="row">
        {builtin ? (
          <button className="btn sm" disabled={!user.overrides[f.id]} onClick={() => set(s => { const o = { ...s.socialFormats.overrides }; delete o[f.id]; return { socialFormats: { ...s.socialFormats, overrides: o } }; })}><RotateCcw size={12} />Restablecer valores de fábrica</button>
        ) : (
          <button className="btn sm" onClick={() => { set(s => ({ socialFormats: { ...s.socialFormats, custom: s.socialFormats.custom.filter(c => c.id !== f.id) } })); setId(formats[0].id); }}><Trash2 size={12} />Eliminar formato propio</button>
        )}
        <span className="tiny muted grow">{f.w}×{f.h} · {aspectLabel(f.w, f.h)} · archivo «{f.fileKey}»</span>
      </div>
      <div className="tiny muted">Las mesas que ya usan este formato conservan su tamaño; cámbialo desde el panel Redes para adaptarlas.</div>
      {!builtin && <Check checked={!!f.carousel} label="Usar como diapositiva de carrusel (nombres de archivo _carousel_01…)"
        onChange={v => set(s => ({ socialFormats: { ...s.socialFormats, custom: s.socialFormats.custom.map(c => (c.id === f.id ? { ...c, carousel: v } : c)) } }))} />}
    </>
  );
}
