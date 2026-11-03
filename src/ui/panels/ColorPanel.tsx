import React, { useEffect, useRef, useState } from 'react';
import { Plus, ScanSearch, Pipette } from 'lucide-react';
import { useStore, set, get, activeLayer, toast } from '../../core/store';
import { hexToRgb, rgbToHex, getImageData } from '../../core/util';
import { rgbToHsv, hsvToRgb } from '../../engine/color';
import { rgbToCmykColor, cmykToRgbColor, cmsState, hasIcc } from '../../engine/cms';
import { NumberField, Seg } from '../components/controls';
import { runOp } from '../../engine/workerClient';
import { processedContent } from '../../core/render';

function SVPicker({ hsv, onChange, onCommit }: { hsv: [number, number, number]; onChange: (h: [number, number, number]) => void; onCommit: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hueRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    c.width = 240; c.height = 150;
    const g = c.getContext('2d')!;
    const [r, gg, b] = hsvToRgb(hsv[0], 1, 1);
    const gx = g.createLinearGradient(0, 0, 240, 0);
    gx.addColorStop(0, '#fff'); gx.addColorStop(1, `rgb(${r},${gg},${b})`);
    g.fillStyle = gx; g.fillRect(0, 0, 240, 150);
    const gy = g.createLinearGradient(0, 0, 0, 150);
    gy.addColorStop(0, 'rgba(0,0,0,0)'); gy.addColorStop(1, '#000');
    g.fillStyle = gy; g.fillRect(0, 0, 240, 150);
  }, [hsv[0]]);
  useEffect(() => {
    const c = hueRef.current!;
    c.width = 240; c.height = 10;
    const g = c.getContext('2d')!;
    const gr = g.createLinearGradient(0, 0, 240, 0);
    for (let i = 0; i <= 6; i++) { const [r, gg, b] = hsvToRgb((i * 60) % 360, 1, 1); gr.addColorStop(i / 6, `rgb(${r},${gg},${b})`); }
    g.fillStyle = gr; g.fillRect(0, 0, 240, 10);
  }, []);
  const pick = (e: React.PointerEvent, el: HTMLElement, hue: boolean) => {
    const r = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    if (hue) onChange([Math.min(359.9, x * 360), hsv[1], hsv[2]]);
    else onChange([hsv[0], x, 1 - y]);
  };
  const bind = (hue: boolean) => ({
    onPointerDown: (e: React.PointerEvent) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); pick(e, e.currentTarget as HTMLElement, hue); },
    onPointerMove: (e: React.PointerEvent) => { if (e.buttons) pick(e, e.currentTarget as HTMLElement, hue); },
    onPointerUp: onCommit,
  });
  return (
    <div className="col" style={{ gap: 8 }}>
      <div style={{ position: 'relative' }}>
        <canvas ref={ref} style={{ width: '100%', height: 120, borderRadius: 8, display: 'block', cursor: 'crosshair', touchAction: 'none' }} {...bind(false)} />
        <div style={{ position: 'absolute', left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%`, width: 12, height: 12, marginLeft: -6, marginTop: -6, borderRadius: '50%', border: '2px solid #fff', boxShadow: '0 0 0 1px #000', pointerEvents: 'none' }} />
      </div>
      <div style={{ position: 'relative' }}>
        <canvas ref={hueRef} style={{ width: '100%', height: 10, borderRadius: 6, display: 'block', cursor: 'pointer', touchAction: 'none' }} {...bind(true)} />
        <div style={{ position: 'absolute', left: `${(hsv[0] / 360) * 100}%`, top: -2, width: 6, height: 14, marginLeft: -3, borderRadius: 3, border: '2px solid #fff', boxShadow: '0 0 0 1px #000', pointerEvents: 'none' }} />
      </div>
    </div>
  );
}

export function ColorPanel() {
  const fg = useStore(s => s.fg);
  const swatches = useStore(s => s.swatches);
  const [mode, setMode] = useState<'rgb' | 'cmyk' | 'hsb'>('rgb');
  const [hsv, setHsv] = useState<[number, number, number]>(() => rgbToHsv(...hexToRgb(fg)));
  const [dominant, setDominant] = useState<{ color: [number, number, number]; share: number }[]>([]);
  const [, force] = useState(0);
  useEffect(() => { const f = () => force(x => x + 1); cmsState.listeners.add(f); return () => { cmsState.listeners.delete(f); }; }, []);
  useEffect(() => {
    const cur = hsvToRgb(...hsv);
    if (rgbToHex(...cur) !== fg) setHsv(rgbToHsv(...hexToRgb(fg)));
  }, [fg]);
  const setHex = (h: string) => set({ fg: h });
  const [r, g, b] = hexToRgb(fg);
  const cmyk = rgbToCmykColor(r, g, b);
  const detect = async () => {
    const l = activeLayer();
    const src = l ? processedContent(l) : null;
    if (!src) return toast('Selecciona una capa', 'warn');
    const res = await runOp('dominant', getImageData(src), { k: 8 });
    setDominant(res.result);
  };
  useEffect(() => { const h = () => detect(); window.addEventListener('kova:dominant', h); return () => window.removeEventListener('kova:dominant', h); }, []);
  return (
    <>
      <SVPicker hsv={hsv} onChange={h => { setHsv(h); set({ fg: rgbToHex(...hsvToRgb(...h)) }); }} onCommit={() => {}} />
      <div className="row">
        <div style={{ width: 26, height: 26, borderRadius: 6, background: fg, border: '1px solid var(--border-2)', flexShrink: 0 }} />
        <input className="input mono" value={fg.toUpperCase()} onChange={e => /^#[0-9a-f]{6}$/i.test(e.target.value) && setHex(e.target.value.toLowerCase())} onKeyDown={e => e.stopPropagation()} style={{ width: 88 }} />
        <div className="grow" />
        <Seg value={mode} onChange={setMode} options={[{ value: 'rgb', label: 'RGB' }, { value: 'cmyk', label: 'CMYK' }, { value: 'hsb', label: 'HSB' }]} />
      </div>
      {mode === 'rgb' && <div className="grid3">
        {(['R', 'G', 'B'] as const).map((k, i) => (
          <NumberField key={k} label={k} value={[r, g, b][i]} min={0} max={255} digits={0}
            onChange={v => { const c = [r, g, b]; c[i] = v; setHex(rgbToHex(c[0], c[1], c[2])); }} />
        ))}
      </div>}
      {mode === 'cmyk' && <>
        <div className="grid2">
          {(['C', 'M', 'Y', 'K'] as const).map((k, i) => (
            <NumberField key={k} label={k} value={cmyk[i] * 100} min={0} max={100} digits={0} suffix="%"
              onChange={v => { const c = [...cmyk]; c[i] = v / 100; setHex(rgbToHex(...cmykToRgbColor(c[0], c[1], c[2], c[3]))); }} />
          ))}
        </div>
        <div className="tiny muted">{hasIcc() ? `Perfil: ${cmsState.profileName}` : 'Conversión por fórmula (sin perfil ICC). Carga un perfil en Canales y color.'} · TAC {Math.round((cmyk[0] + cmyk[1] + cmyk[2] + cmyk[3]) * 100)}%</div>
      </>}
      {mode === 'hsb' && <div className="grid3">
        <NumberField label="H" value={hsv[0]} min={0} max={359} digits={0} suffix="°" onChange={v => { const h: [number, number, number] = [v, hsv[1], hsv[2]]; setHsv(h); setHex(rgbToHex(...hsvToRgb(...h))); }} />
        <NumberField label="S" value={hsv[1] * 100} min={0} max={100} digits={0} onChange={v => { const h: [number, number, number] = [hsv[0], v / 100, hsv[2]]; setHsv(h); setHex(rgbToHex(...hsvToRgb(...h))); }} />
        <NumberField label="B" value={hsv[2] * 100} min={0} max={100} digits={0} onChange={v => { const h: [number, number, number] = [hsv[0], hsv[1], v / 100]; setHsv(h); setHex(rgbToHex(...hsvToRgb(...h))); }} />
      </div>}
      <div className="section-title">Muestras</div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
        {swatches.map((s, i) => (
          <div key={i} title={`${s} · Alt+clic para quitar`} onClick={e => { if (e.altKey) set({ swatches: swatches.filter((_, j) => j !== i) }); else setHex(s); }}
            style={{ width: 18, height: 18, borderRadius: 4, background: s, border: '1px solid var(--border-2)', cursor: 'pointer' }} />
        ))}
        <button className="icon-btn sm" title="Añadir color actual" onClick={() => set({ swatches: [...swatches, fg] })}><Plus size={12} /></button>
      </div>
      <div className="section-title" style={{ justifyContent: 'space-between' }}>
        <span>Colores del diseño</span>
        <button className="btn sm ghost" onClick={detect}><ScanSearch size={12} />Detectar</button>
      </div>
      {dominant.length > 0 && (
        <div className="col" style={{ gap: 3 }}>
          {dominant.map((d, i) => {
            const hex = rgbToHex(...d.color);
            const c = rgbToCmykColor(...d.color);
            return (
              <div key={i} className="row small" style={{ cursor: 'pointer' }} onClick={() => setHex(hex)}>
                <div style={{ width: 16, height: 16, borderRadius: 4, background: hex, border: '1px solid var(--border-2)' }} />
                <span className="mono tiny">{hex.toUpperCase()}</span>
                <span className="mono tiny muted grow">C{Math.round(c[0] * 100)} M{Math.round(c[1] * 100)} Y{Math.round(c[2] * 100)} K{Math.round(c[3] * 100)}</span>
                <span className="tiny muted">{Math.round(d.share * 100)}%</span>
              </div>
            );
          })}
          <button className="btn sm" onClick={() => set({ swatches: [...get().swatches, ...dominant.map(d => rgbToHex(...d.color))] })}><Pipette size={12} />Añadir a muestras</button>
        </div>
      )}
    </>
  );
}
