import React, { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Trash2, ChevronUp, ChevronDown, Check as CheckIcon, Sun, Contrast, Droplet, Palette, SunMedium, Spline, BarChart3, Blend, Layers2, SquareSplitHorizontal, Waves, Focus, Sparkle, PaintBucket, Rainbow, ArrowLeftRight } from 'lucide-react';
import { live, finishLive, commit } from '../../core/store';
import type { Adjustment, AdjustmentType, Doc, Layer } from '../../core/types';
import * as A from '../../core/actions';
import { Slider, Check, Seg } from '../components/controls';
import { curveLut } from '../../engine/pixels';
import { runOp } from '../../engine/workerClient';
import { layerContent } from '../../core/render';
import { getImageData } from '../../core/util';
import { KOVA } from '../theme';
import { ColorField } from '../components/ColorField';

const icons: Record<AdjustmentType, any> = {
  brightnessContrast: Sun, levels: BarChart3, curves: Spline, exposure: SunMedium, vibrance: Droplet, hueSaturation: Palette,
  blackWhite: Blend, invert: Layers2, threshold: SquareSplitHorizontal, posterize: Contrast, blur: Waves, sharpen: Focus, denoise: Sparkle,
  colorize: PaintBucket, gradientMap: Rainbow,
};

// el selector de color avisa en cada movimiento: se ve en vivo y se guarda un solo paso de historial al parar
const colorCommit = new Map<string, ReturnType<typeof setTimeout>>();
function setColor(layerId: string, adjId: string, params: any) {
  setParams(layerId, adjId, params);
  clearTimeout(colorCommit.get(adjId));
  colorCommit.set(adjId, setTimeout(() => { colorCommit.delete(adjId); finishLive('Editar color'); }, 400));
}
function C(p: { l: Layer; a: Adjustment; k: string; label: string }) {
  return <ColorField label={p.label} value={p.a.params[p.k]} onChange={v => setColor(p.l.id, p.a.id, { [p.k]: v })} />;
}

function setParams(layerId: string, adjId: string, params: any, commitIt = false) {
  live(s => ({ ...s, layers: s.layers.map(l => (l.id === layerId ? { ...l, adjustments: l.adjustments.map(a => (a.id === adjId ? { ...a, params: { ...a.params, ...params } } : a)) } : l)) }));
  if (commitIt) finishLive('Editar ajuste');
}

function S(p: { l: Layer; a: Adjustment; k: string; label: string; min: number; max: number; step?: number; digits?: number; suffix?: string }) {
  return <Slider label={p.label} value={p.a.params[p.k]} min={p.min} max={p.max} step={p.step} digits={p.digits} suffix={p.suffix}
    onChange={v => setParams(p.l.id, p.a.id, { [p.k]: v })} onCommit={v => setParams(p.l.id, p.a.id, { [p.k]: v }, true)} />;
}

function CurvesEditor({ l, a }: { l: Layer; a: Adjustment }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ch, setCh] = useState<'rgb' | 'r' | 'g' | 'b'>('rgb');
  const pts: [number, number][] = a.params[ch] ?? [[0, 0], [255, 255]];
  const drag = useRef<number | null>(null);
  const S = 220;
  useEffect(() => {
    const c = ref.current!;
    c.width = S * 2; c.height = S * 2;
    const g = c.getContext('2d')!;
    g.scale(2, 2);
    g.fillStyle = '#101013'; g.fillRect(0, 0, S, S);
    g.strokeStyle = '#26262c';
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo((i * S) / 4, 0); g.lineTo((i * S) / 4, S); g.moveTo(0, (i * S) / 4); g.lineTo(S, (i * S) / 4); g.stroke(); }
    g.strokeStyle = '#3a3a42'; g.beginPath(); g.moveTo(0, S); g.lineTo(S, 0); g.stroke();
    const lut = curveLut(pts);
    g.strokeStyle = ch === 'rgb' ? '#ededf0' : ch === 'r' ? '#ff5f57' : ch === 'g' ? '#5fd68a' : '#5a95ff';
    g.lineWidth = 1.5;
    g.beginPath();
    for (let i = 0; i < 256; i++) { const x = (i / 255) * S, y = S - (lut[i] / 255) * S; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
    g.fillStyle = '#fff';
    for (const [x, y] of pts) { g.beginPath(); g.arc((x / 255) * S, S - (y / 255) * S, 4, 0, Math.PI * 2); g.fill(); }
  }, [pts, ch]);
  const toVal = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return [Math.max(0, Math.min(255, ((e.clientX - r.left) / r.width) * 255)), Math.max(0, Math.min(255, (1 - (e.clientY - r.top) / r.height) * 255))] as [number, number];
  };
  return (
    <div className="col">
      <Seg value={ch} onChange={setCh} options={[{ value: 'rgb', label: 'RGB' }, { value: 'r', label: 'R' }, { value: 'g', label: 'G' }, { value: 'b', label: 'B' }]} full />
      <canvas ref={ref} style={{ width: '100%', aspectRatio: '1', borderRadius: 8, cursor: 'crosshair', touchAction: 'none' }}
        onPointerDown={e => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          const [x, y] = toVal(e);
          let idx = pts.findIndex(p => Math.hypot(p[0] - x, p[1] - y) < 12);
          let next = pts;
          if (idx < 0) { next = [...pts, [x, y] as [number, number]].sort((p, q) => p[0] - q[0]); idx = next.findIndex(p => p[0] === x && p[1] === y); }
          if (e.altKey && idx > 0 && idx < pts.length - 1) { next = pts.filter((_, i) => i !== idx); setParams(l.id, a.id, { [ch]: next }, true); return; }
          drag.current = idx;
          setParams(l.id, a.id, { [ch]: next });
        }}
        onPointerMove={e => {
          if (drag.current == null) return;
          const [x, y] = toVal(e);
          const i = drag.current;
          const next = pts.map((p, j) => (j === i ? [i === 0 ? 0 : i === pts.length - 1 ? 255 : x, y] : p)) as [number, number][];
          setParams(l.id, a.id, { [ch]: next });
        }}
        onPointerUp={() => { if (drag.current != null) { drag.current = null; finishLive('Curvas'); } }}
        onDoubleClick={() => setParams(l.id, a.id, { [ch]: [[0, 0], [255, 255]] }, true)}
      />
      <span className="tiny muted">Clic: añadir punto · Alt+clic: quitar · Doble clic: restablecer</span>
    </div>
  );
}

function LevelsEditor({ l, a }: { l: Layer; a: Adjustment }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hist, setHist] = useState<Uint32Array | null>(null);
  useEffect(() => {
    const src = layerContent(l);
    if (!src) return;
    runOp('histogram', getImageData(src)).then(r => setHist(r.result.l));
  }, [l.canvas]);
  useEffect(() => {
    const c = ref.current!;
    c.width = 512; c.height = 160;
    const g = c.getContext('2d')!;
    g.fillStyle = '#101013'; g.fillRect(0, 0, 512, 160);
    if (hist) {
      const mx = Math.max(...Array.from(hist).slice(2, 254)) || 1;
      g.fillStyle = '#8b8b93';
      for (let i = 0; i < 256; i++) { const h = Math.min(160, (hist[i] / mx) * 150); g.fillRect(i * 2, 160 - h, 2, h); }
    }
    g.fillStyle = KOVA.red;
    g.fillRect(a.params.inBlack * 2, 0, 2, 160); g.fillRect(a.params.inWhite * 2 - 2, 0, 2, 160);
  }, [hist, a.params.inBlack, a.params.inWhite]);
  return (
    <div className="col">
      <Seg value={a.params.channel ?? 'rgb'} onChange={v => setParams(l.id, a.id, { channel: v }, true)} full
        options={[{ value: 'rgb', label: 'RGB' }, { value: 'r', label: 'R' }, { value: 'g', label: 'G' }, { value: 'b', label: 'B' }]} />
      <canvas ref={ref} style={{ width: '100%', height: 80, borderRadius: 8 }} />
      <S l={l} a={a} k="inBlack" label="Entrada negro" min={0} max={254} />
      <S l={l} a={a} k="gamma" label="Gamma (medios)" min={0.1} max={5} step={0.01} digits={2} />
      <S l={l} a={a} k="inWhite" label="Entrada blanco" min={1} max={255} />
      <S l={l} a={a} k="outBlack" label="Salida negro" min={0} max={255} />
      <S l={l} a={a} k="outWhite" label="Salida blanco" min={0} max={255} />
    </div>
  );
}

function Editor({ l, a }: { l: Layer; a: Adjustment }) {
  switch (a.type) {
    case 'brightnessContrast': return <><S l={l} a={a} k="brightness" label="Brillo" min={-150} max={150} /><S l={l} a={a} k="contrast" label="Contraste" min={-100} max={100} /></>;
    case 'hueSaturation': return <>
      <S l={l} a={a} k="hue" label="Tono" min={-180} max={180} suffix="°" />
      <S l={l} a={a} k="saturation" label="Saturación" min={-100} max={100} />
      <S l={l} a={a} k="lightness" label="Luminosidad" min={-100} max={100} />
      <Check checked={!!a.params.colorize} onChange={v => setParams(l.id, a.id, { colorize: v }, true)} label="Colorear" />
    </>;
    case 'exposure': return <><S l={l} a={a} k="exposure" label="Exposición" min={-5} max={5} step={0.01} digits={2} /><S l={l} a={a} k="offset" label="Desplazamiento" min={-0.5} max={0.5} step={0.001} digits={3} /><S l={l} a={a} k="gamma" label="Corrección gamma" min={0.1} max={9.99} step={0.01} digits={2} /></>;
    case 'levels': return <LevelsEditor l={l} a={a} />;
    case 'curves': return <CurvesEditor l={l} a={a} />;
    case 'vibrance': return <><S l={l} a={a} k="vibrance" label="Intensidad" min={-100} max={100} /><S l={l} a={a} k="saturation" label="Saturación" min={-100} max={100} /></>;
    case 'blackWhite': return <><S l={l} a={a} k="r" label="Rojos" min={-1} max={2} step={0.01} digits={2} /><S l={l} a={a} k="g" label="Verdes" min={-1} max={2} step={0.01} digits={2} /><S l={l} a={a} k="b" label="Azules" min={-1} max={2} step={0.01} digits={2} /></>;
    case 'colorize': return <>
      <Seg value={a.params.mode ?? 'tint'} onChange={v => setParams(l.id, a.id, { mode: v }, true)} full options={[
        { value: 'tint', label: 'Teñir', title: 'Pone el color y conserva las luces y sombras de la imagen' },
        { value: 'fill', label: 'Rellenar', title: 'Todo de ese color: solo se conserva la forma (ideal para logos y semitonos)' },
      ]} />
      <C l={l} a={a} k="color" label="Color" />
      <S l={l} a={a} k="amount" label="Intensidad" min={0} max={100} suffix="%" />
      <span className="tiny muted">{(a.params.mode ?? 'tint') === 'tint' ? 'El negro puro sigue negro y el blanco sigue blanco. Para pasar un logo negro a otro color usa Rellenar.' : 'Pinta toda la capa del color; la transparencia no cambia.'}</span>
    </>;
    case 'gradientMap': return <>
      <C l={l} a={a} k="dark" label="Sombras" />
      <C l={l} a={a} k="light" label="Luces" />
      <button className="btn sm" onClick={() => setParams(l.id, a.id, { dark: a.params.light, light: a.params.dark }, true)}><ArrowLeftRight size={12} />Intercambiar</button>
      <S l={l} a={a} k="amount" label="Intensidad" min={0} max={100} suffix="%" />
      <span className="tiny muted">Cada tono de la imagen toma un color entre las sombras y las luces. Con los semitonos, los puntos heredan estos colores.</span>
    </>;
    case 'invert': return <span className="tiny muted">Invierte los canales RGB (el alfa se conserva).</span>;
    case 'threshold': return <S l={l} a={a} k="level" label="Nivel de umbral" min={1} max={255} />;
    case 'posterize': return <S l={l} a={a} k="levels" label="Niveles" min={2} max={64} />;
    case 'blur': return <S l={l} a={a} k="radius" label="Radio" min={0} max={200} step={0.5} digits={1} suffix="px" />;
    case 'sharpen': return <><S l={l} a={a} k="amount" label="Cantidad" min={0} max={500} suffix="%" /><S l={l} a={a} k="radius" label="Radio" min={0.2} max={50} step={0.1} digits={1} suffix="px" /><S l={l} a={a} k="threshold" label="Umbral" min={0} max={255} /></>;
    case 'denoise': return <><S l={l} a={a} k="radius" label="Radio" min={1} max={3} /><S l={l} a={a} k="strength" label="Intensidad" min={0} max={100} suffix="%" /></>;
  }
}

export function AdjustmentsPanel({ doc }: { doc: Doc }) {
  const s = doc.state;
  const l = s.layers.find(x => x.id === s.selectedLayerIds[s.selectedLayerIds.length - 1]);
  const [open, setOpen] = useState<string | null>(null);
  const types = Object.keys(A.adjustmentDefaults) as AdjustmentType[];
  const move = (i: number, d: number) => {
    if (!l) return;
    const arr = [...l.adjustments];
    const j = i + d;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    commit('Reordenar ajustes', st => ({ ...st, layers: st.layers.map(x => (x.id === l.id ? { ...x, adjustments: arr } : x)) }));
  };
  return (
    <>
      <div className="row" style={{ flexWrap: 'wrap', gap: 2 }}>
        {types.map(t => { const Ic = icons[t]; return (
          <button key={t} className="icon-btn" title={A.adjustmentDefaults[t].label} disabled={!l || l.kind === 'group'}
            onClick={async () => { const a = await A.addAdjustment(t); if (a) setOpen(a.id); }}><Ic size={15} /></button>
        ); })}
      </div>
      {!l && <div className="tiny muted">Selecciona una capa para añadir ajustes no destructivos.</div>}
      {l && !l.adjustments.length && <div className="tiny muted">Los ajustes se aplican sin modificar los píxeles originales. Puedes editarlos, ocultarlos o reordenarlos en cualquier momento.</div>}
      {l && l.adjustments.map((a, i) => {
        const Ic = icons[a.type];
        const isOpen = open === a.id;
        return (
          <div key={a.id} className="card" style={{ padding: 8 }}>
            <div className="row" style={{ cursor: 'pointer' }} onClick={() => setOpen(isOpen ? null : a.id)}>
              <Ic size={14} />
              <span className="grow small" style={{ fontWeight: 500, opacity: a.enabled ? 1 : 0.5 }}>{A.adjustmentDefaults[a.type].label}</span>
              <button className="icon-btn sm" onClick={e => { e.stopPropagation(); move(i, 1); }} title="Subir"><ChevronUp size={12} /></button>
              <button className="icon-btn sm" onClick={e => { e.stopPropagation(); move(i, -1); }} title="Bajar"><ChevronDown size={12} /></button>
              <button className="icon-btn sm" onClick={e => { e.stopPropagation(); A.toggleAdjustment(l.id, a.id); }} title="Activar/desactivar">{a.enabled ? <Eye size={12} /> : <EyeOff size={12} />}</button>
              <button className="icon-btn sm" onClick={e => { e.stopPropagation(); A.removeAdjustment(l.id, a.id); }} title="Eliminar"><Trash2 size={12} /></button>
            </div>
            {isOpen && <div className="col" style={{ marginTop: 8 }}><Editor l={l} a={a} /></div>}
          </div>
        );
      })}
      {l && l.adjustments.length > 0 && (
        <button className="btn sm" onClick={() => A.applyAdjustments()}><CheckIcon size={12} />Aplicar ajustes a los píxeles</button>
      )}
    </>
  );
}
