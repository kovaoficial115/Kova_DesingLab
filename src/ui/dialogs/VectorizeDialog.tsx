import React, { useEffect, useMemo, useState } from 'react';
import { ScanLine, Download } from 'lucide-react';
import { Modal, Slider, Seg, Check, ColorInput } from '../components/controls';
import { activeLayer, withBusy, toast, commit } from '../../core/store';
import { bakedLayerCanvas } from '../../core/render';
import { cloneCanvas, getImageData, layerSize, downloadBlob, hexToRgb, uid } from '../../core/util';
import { runOp } from '../../engine/workerClient';
import type { Layer } from '../../core/types';

const PRESETS = {
  logo: { label: 'Logotipo', colors: 6, precision: 70, smooth: 0, omit: 8, bw: false },
  illustration: { label: 'Ilustración', colors: 16, precision: 60, smooth: 1, omit: 10, bw: false },
  type: { label: 'Tipografía', colors: 2, precision: 90, smooth: 0, omit: 4, bw: true },
  bw: { label: 'Blanco y negro', colors: 2, precision: 75, smooth: 0, omit: 8, bw: true },
  detail: { label: 'Detallado', colors: 32, precision: 85, smooth: 0, omit: 2, bw: false },
} as const;

export function VectorizeDialog({ onClose }: { onClose: () => void }) {
  const layer = activeLayer();
  const [src, setSrc] = useState<HTMLCanvasElement | null>(null);
  const [preset, setPreset] = useState<keyof typeof PRESETS>('logo');
  const [colors, setColors] = useState(6);
  const [precision, setPrecision] = useState(70);
  const [smooth, setSmooth] = useState(0);
  const [omit, setOmit] = useState(8);
  const [bw, setBw] = useState(false);
  const [threshold, setThreshold] = useState(128);
  const [bwColor, setBwColor] = useState('#000000');
  const [removeBg, setRemoveBg] = useState(true);
  const [maxSize, setMaxSize] = useState(1600);
  const [svg, setSvg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hideSource, setHideSource] = useState(true);
  const [view, setView] = useState<'result' | 'split'>('result');

  useEffect(() => {
    if (!layer) return;
    bakedLayerCanvas(layer).then(b => { if (b) { const { w, h } = layerSize(layer); setSrc(cloneCanvas(b, w, h)); } });
  }, []);
  const applyPreset = (k: keyof typeof PRESETS) => {
    const p = PRESETS[k];
    setPreset(k); setColors(p.colors); setPrecision(p.precision); setSmooth(p.smooth); setOmit(p.omit); setBw(p.bw);
  };
  const work = useMemo(() => {
    if (!src) return null;
    const k = Math.min(1, maxSize / Math.max(src.width, src.height));
    return k < 1 ? cloneCanvas(src, src.width * k, src.height * k) : src;
  }, [src, maxSize]);

  const trace = async () => {
    if (!work) return null;
    const img = getImageData(work);
    const d = img.data;
    if (bw) {
      // binarizar: tinta donde la luminancia es menor que el umbral
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const ink = d[i + 3] > 127 && l < threshold;
        d[i] = d[i + 1] = d[i + 2] = ink ? 0 : 255; d[i + 3] = ink ? 255 : 0;
      }
    }
    // precision 0..100 → umbrales de línea/curva 4..0.1
    const t = 4 - (precision / 100) * 3.9;
    const opts: any = {
      ltres: t, qtres: t, pathomit: omit, rightangleenhance: true, colorsampling: 2, numberofcolors: bw ? 2 : colors,
      mincolorratio: 0, colorquantcycles: 3, blurradius: smooth, blurdelta: 20, strokewidth: 0, linefilter: smooth > 0,
      scale: 1, roundcoords: 2, viewbox: true, desc: false, layering: 0,
    };
    if (bw) opts.pal = [{ r: 0, g: 0, b: 0, a: 255 }, { r: 255, g: 255, b: 255, a: 0 }];
    const r = await runOp('vectorize', img, opts);
    let out: string = r.result;
    // quitar trazados totalmente transparentes y, opcionalmente, el color de fondo dominante
    out = out.replace(/<path[^>]*opacity="0"[^>]*\/>/g, '');
    if (bw) out = out.replace(/fill="rgb\(0,0,0\)"/g, `fill="${bwColor}"`);
    else if (removeBg) {
      const fills = [...out.matchAll(/<path[^>]*fill="(rgb\([^)]+\))"[^>]*d="([^"]*)"/g)];
      const area = new Map<string, number>();
      for (const m of fills) area.set(m[1], (area.get(m[1]) ?? 0) + m[2].length);
      const corner = getImageData(work).data;
      const bgc = `rgb(${corner[0]},${corner[1]},${corner[2]})`;
      if (corner[3] > 200) {
        // eliminar trazados del color más parecido al de la esquina
        let best = '', bd = Infinity;
        for (const k of area.keys()) {
          const [rr, gg, bb] = k.match(/\d+/g)!.map(Number);
          const dd = (rr - corner[0]) ** 2 + (gg - corner[1]) ** 2 + (bb - corner[2]) ** 2;
          if (dd < bd) { bd = dd; best = k; }
        }
        if (best && bd < 900) out = out.replace(new RegExp(`<path[^>]*fill="${best.replace(/[()]/g, '\\$&')}"[^>]*/>`, 'g'), '');
        void bgc;
      }
    }
    return out;
  };

  useEffect(() => {
    if (!work) return;
    const tm = setTimeout(async () => { setBusy(true); try { setSvg(await trace()); } finally { setBusy(false); } }, 250);
    return () => clearTimeout(tm);
  }, [work, colors, precision, smooth, omit, bw, threshold, bwColor, removeBg]);

  const stats = useMemo(() => {
    if (!svg) return null;
    const paths = (svg.match(/<path/g) || []).length;
    const nodes = (svg.match(/[MLQ] /g) || []).length;
    return { paths, nodes, kb: svg.length / 1024 };
  }, [svg]);
  const svgUrl = useMemo(() => (svg ? URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })) : null), [svg]);
  useEffect(() => () => { if (svgUrl) URL.revokeObjectURL(svgUrl); }, [svgUrl]);
  const srcUrl = useMemo(() => src?.toDataURL(), [src]);

  if (!layer) { toast('Selecciona una capa', 'warn'); onClose(); return null; }

  const finalSvg = () => {
    const { w, h } = layerSize(layer);
    // tamaño del SVG = tamaño de la capa; el viewBox mantiene las coordenadas trazadas
    return svg!.replace(/<svg([^>]*)>/, (_m, attrs) => {
      let a = String(attrs).replace(/\s(width|height|desc)="[^"]*"/g, '');
      if (!/xmlns=/.test(a)) a += ' xmlns="http://www.w3.org/2000/svg"';
      return `<svg${a} width="${w}" height="${h}" preserveAspectRatio="none">`;
    });
  };
  const apply = () => withBusy('Creando vector…', async () => {
    if (!svg) return;
    const { w, h } = layerSize(layer);
    const v: Layer = { ...layer, id: uid('ly'), name: `${layer.name} vector`, kind: 'vector', vector: { svg: finalSvg(), w, h }, canvas: undefined, origin: undefined, adjustments: [], mask: null, text: undefined, shape: undefined, visible: true };
    commit('Vectorizar', st => {
      const layers = st.layers.map(x => (x.id === layer.id && hideSource ? { ...x, visible: false } : x));
      layers.splice(layers.findIndex(x => x.id === layer.id) + 1, 0, v);
      return { ...st, layers, selectedLayerIds: [v.id] };
    });
    toast('Capa vectorial creada', 'ok');
    onClose();
  });

  return (
    <Modal title="Vectorización automática" icon={<ScanLine size={16} />} onClose={onClose} width={1040} height="86vh"
      footer={<>
        {stats && <span className="tiny muted">{stats.paths} trazados · ~{stats.nodes} nodos · {stats.kb.toFixed(0)} KB</span>}
        <div className="spacer" />
        <Check checked={hideSource} onChange={setHideSource} label="Ocultar la capa original" />
        <button className="btn" disabled={!svg} onClick={() => downloadBlob(new Blob([finalSvg()], { type: 'image/svg+xml' }), `${layer.name}.svg`)}><Download size={13} />Descargar SVG</button>
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={!svg} onClick={apply}>Crear capa vectorial</button>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 290px', gap: 14, height: '100%', minHeight: 0 }}>
        <div className="col" style={{ minHeight: 0 }}>
          <div className="row">
            <Seg value={view} onChange={setView} options={[{ value: 'result', label: 'Resultado' }, { value: 'split', label: 'Original | Vector' }]} />
            <div className="grow" />{busy && <><div className="spinner" /><span className="tiny muted">Trazando…</span></>}
          </div>
          <div className="preview-box checker" style={{ flex: 1, minHeight: 360, display: 'grid', gridTemplateColumns: view === 'split' ? '1fr 1fr' : '1fr', gap: 2 }}>
            {view === 'split' && srcUrl && <img src={srcUrl} style={{ maxWidth: '100%', maxHeight: '100%', margin: 'auto' }} />}
            {svgUrl && <img src={svgUrl} style={{ maxWidth: '100%', maxHeight: '100%', margin: 'auto', width: view === 'split' ? '100%' : undefined }} />}
          </div>
        </div>
        <div className="col" style={{ overflowY: 'auto', gap: 10 }}>
          <div className="section-title">Tipo de imagen</div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
            {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map(k => <button key={k} className={'chip' + (preset === k ? ' accent' : '')} style={{ cursor: 'pointer' }} onClick={() => applyPreset(k)}>{PRESETS[k].label}</button>)}
          </div>
          <Check checked={bw} onChange={setBw} label="Convertir a blanco y negro" />
          {bw ? <>
            <Slider label="Umbral" value={threshold} min={1} max={254} onChange={setThreshold} />
            <div className="row"><span className="label">Color de tinta</span><ColorInput value={bwColor} onChange={setBwColor} /></div>
          </> : <>
            <Slider label="Cantidad de colores" value={colors} min={2} max={64} onChange={setColors} />
            <Check checked={removeBg} onChange={setRemoveBg} label="Eliminar color de fondo" />
          </>}
          <Slider label="Precisión" value={precision} min={0} max={100} suffix="%" onChange={setPrecision} hint="Más precisión = más fiel, más nodos" />
          <Slider label="Suavizado" value={smooth} min={0} max={5} onChange={setSmooth} />
          <Slider label="Reducción de nodos" value={omit} min={0} max={64} onChange={setOmit} hint="Descarta trazados más cortos que este número de puntos" />
          <Slider label="Resolución de trazado" value={maxSize} min={400} max={4000} step={100} suffix="px" onChange={setMaxSize} hint="Tamaño máximo de la imagen analizada" />
          <div className="tiny muted">Funciona mejor con logotipos, letras y gráficos de colores planos. Para fotos usa semitonos en lugar de vectorizar.</div>
        </div>
      </div>
    </Modal>
  );
}
void hexToRgb;
