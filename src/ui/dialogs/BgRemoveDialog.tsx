import React, { useEffect, useRef, useState } from 'react';
import { Eraser, Sparkles, Pipette, Wand, Brush } from 'lucide-react';
import { Modal, Slider, Seg, Check, ColorInput, CanvasPreview } from '../components/controls';
import { activeLayer, docState, withBusy, toast, commit, set } from '../../core/store';
import { bakedLayerCanvas } from '../../core/render';
import { getImageData, canvasFromImageData, cloneCanvas, layerSize, hexToRgb, rgbToHex, createCanvas, ctx2d, canvasToBlob, blobToCanvas } from '../../core/util';
import { runOp } from '../../engine/workerClient';
import { localMaskToWorld, setSelection } from '../../core/actions';
import { invalidateLayer } from '../../core/render';
import { alphaStats } from '../../engine/alpha';

type Tab = 'ai' | 'color' | 'refine';

function detectBg(c: HTMLCanvasElement): string {
  const d = getImageData(c).data;
  const w = c.width, h = c.height;
  const pts = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1], [w >> 1, 0], [0, h >> 1], [w - 1, h >> 1], [w >> 1, h - 1]];
  let r = 0, g = 0, b = 0;
  for (const [x, y] of pts) { const o = (y * w + x) * 4; r += d[o]; g += d[o + 1]; b += d[o + 2]; }
  return rgbToHex(r / pts.length, g / pts.length, b / pts.length);
}

let aiModule: any = null;
async function removeBgAI(c: HTMLCanvasElement, onProgress: (t: string) => void): Promise<HTMLCanvasElement> {
  if (!aiModule) { onProgress('Cargando motor de IA…'); aiModule = await import('@imgly/background-removal'); }
  const blob = await canvasToBlob(c, 'image/png');
  const out: Blob = await aiModule.removeBackground(blob, {
    model: 'isnet_fp16',
    output: { format: 'image/png', type: 'mask' },
    progress: (key: string, cur: number, total: number) => { if (total) onProgress(`Descargando modelo ${Math.round((cur / total) * 100)}% (${key.split('/').pop()})`); },
  });
  return blobToCanvas(out);
}

export function BgRemoveDialog({ onClose, tab: initialTab, asSelection }: { onClose: () => void; tab?: Tab; asSelection?: boolean }) {
  const layer = activeLayer();
  const [tab, setTab] = useState<Tab>(initialTab ?? 'color');
  const [src, setSrc] = useState<HTMLCanvasElement | null>(null);
  const [preview, setPreview] = useState<HTMLCanvasElement | null>(null);
  const [result, setResult] = useState<HTMLCanvasElement | null>(null);
  const [aiMask, setAiMask] = useState<HTMLCanvasElement | null>(null);
  const [aiStatus, setAiStatus] = useState('');
  const [bgPreview, setBgPreview] = useState<'checker' | 'black' | 'white'>('checker');
  const [output, setOutput] = useState<'pixels' | 'mask' | 'selection'>(asSelection ? 'selection' : 'pixels');
  // color
  const [color, setColor] = useState('#ffffff');
  const [tolerance, setTolerance] = useState(12);
  const [softness, setSoftness] = useState(8);
  const [contiguous, setContiguous] = useState(true);
  const [decont, setDecont] = useState(true);
  const [choke, setChoke] = useState(0);
  // refinado
  const [rSmooth, setRSmooth] = useState(0);
  const [rContract, setRContract] = useState(0);
  const [rFeather, setRFeather] = useState(0);
  const [cleanLow, setCleanLow] = useState(0);
  const [cleanHigh, setCleanHigh] = useState(255);
  const [rDecont, setRDecont] = useState(false);
  const [stats, setStats] = useState<{ semi: number; total: number } | null>(null);
  const picking = useRef(false);

  useEffect(() => {
    if (!layer) return;
    bakedLayerCanvas(layer).then(b => {
      if (!b) return;
      const { w, h } = layerSize(layer);
      const c = cloneCanvas(b, w, h);
      setSrc(c);
      setColor(detectBg(c));
    });
  }, []);

  // la vista previa trabaja sobre una versión reducida para ser fluida
  const small = React.useMemo(() => {
    if (!src) return null;
    const k = Math.min(1, 900 / Math.max(src.width, src.height));
    return k < 1 ? cloneCanvas(src, src.width * k, src.height * k) : src;
  }, [src]);

  const process = async (input: HTMLCanvasElement, full: boolean): Promise<HTMLCanvasElement> => {
    const k = input.width / src!.width;
    let img = getImageData(input);
    if (tab === 'ai') {
      if (!aiMask) return input;
      const out = cloneCanvas(input);
      const g = ctx2d(out);
      const m = createCanvas(input.width, input.height);
      const mg = ctx2d(m);
      mg.drawImage(aiMask, 0, 0, input.width, input.height);
      // máscara en luminancia → alfa
      const md = mg.getImageData(0, 0, m.width, m.height);
      for (let i = 0; i < md.data.length; i += 4) { md.data[i + 3] = md.data[i]; md.data[i] = md.data[i + 1] = md.data[i + 2] = 255; }
      mg.putImageData(md, 0, 0);
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(m, 0, 0);
      img = getImageData(out);
    } else if (tab === 'color') {
      img = (await runOp('colorKey', img, { color: hexToRgb(color), tolerance, softness, contiguous, decontaminate: decont, choke: choke * k })).image!;
    }
    // refinado (siempre se aplica después; en la pestaña de refinado actúa sobre la capa actual)
    if (rSmooth || rContract || rFeather || cleanLow > 0 || cleanHigh < 255 || rDecont) {
      img = (await runOp('refine', img, { smooth: rSmooth * k, contract: rContract * k, feather: rFeather * k, cleanLow, cleanHigh, decontaminate: rDecont, matte: hexToRgb(color) })).image!;
    }
    void full;
    return canvasFromImageData(img);
  };

  useEffect(() => {
    if (!small) return;
    const t = setTimeout(async () => {
      const out = await process(small, false);
      setPreview(out);
      const st = alphaStats(getImageData(out));
      setStats({ semi: st.semi, total: st.total });
    }, 120);
    return () => clearTimeout(t);
  }, [small, tab, aiMask, color, tolerance, softness, contiguous, decont, choke, rSmooth, rContract, rFeather, cleanLow, cleanHigh, rDecont]);

  const runAI = () => withBusy('Eliminando fondo con IA…', async () => {
    if (!src) return;
    try {
      const m = await removeBgAI(src, setAiStatus);
      setAiMask(m);
      setAiStatus('Listo. Ajusta con la pestaña Refinar si hace falta.');
    } catch (e: any) {
      setAiStatus('Error: ' + (e?.message || e) + '. Comprueba la conexión (el modelo se descarga la primera vez).');
      throw e;
    }
  });
  useEffect(() => { if (tab === 'ai' && src && !aiMask && initialTab === 'ai') runAI(); }, [src]);

  if (!layer) { toast('Selecciona una capa', 'warn'); onClose(); return null; }

  const apply = () => withBusy('Aplicando…', async () => {
    if (!src) return;
    const out = await process(src, true);
    if (output === 'selection') {
      setSelection(localMaskToWorld(out, layer), 'Seleccionar sujeto', 'new');
    } else if (output === 'mask') {
      const { w, h } = layerSize(layer);
      const mask = createCanvas(w, h);
      const g = ctx2d(mask);
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
      const white = createCanvas(w, h);
      const wg = ctx2d(white);
      wg.drawImage(out, 0, 0, w, h);
      wg.globalCompositeOperation = 'source-in';
      wg.fillStyle = '#fff'; wg.fillRect(0, 0, w, h);
      g.drawImage(white, 0, 0);
      commit('Máscara de fondo', st => ({ ...st, layers: st.layers.map(x => (x.id === layer.id ? { ...x, mask, maskEnabled: true } : x)) }));
    } else {
      invalidateLayer(layer.id);
      commit(tab === 'refine' ? 'Refinar bordes' : 'Eliminar fondo', st => ({ ...st, layers: st.layers.map(x => (x.id === layer.id ? { ...x, kind: 'raster', canvas: out, origin: x.origin ?? x.canvas ?? out, adjustments: [], text: undefined, shape: undefined, vector: undefined } : x)) }));
    }
    toast('Listo', 'ok');
    onClose();
  });

  const pickColor = (e: React.MouseEvent) => {
    if (!picking.current || !small) return;
    const cv = (e.currentTarget as HTMLElement).querySelector('canvas');
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * small.width), y = Math.floor(((e.clientY - r.top) / r.height) * small.height);
    const d = ctx2d(small).getImageData(x, y, 1, 1).data;
    setColor(rgbToHex(d[0], d[1], d[2]));
    picking.current = false;
  };
  const semiPct = stats ? (stats.semi / stats.total) * 100 : 0;

  return (
    <Modal title="Eliminar fondo y transparencias" icon={<Eraser size={16} />} onClose={onClose} width={1040} height="86vh"
      footer={<>
        {stats && <span className={'chip ' + (semiPct > 2 ? 'warn' : 'ok')}>{semiPct.toFixed(1)}% píxeles semitransparentes</span>}
        <div className="spacer" />
        <Seg value={output} onChange={setOutput} options={[{ value: 'pixels', label: 'Aplicar a píxeles' }, { value: 'mask', label: 'Como máscara' }, { value: 'selection', label: 'Como selección' }]} />
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" onClick={apply} disabled={!src || (tab === 'ai' && !aiMask)}>Aplicar</button>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 14, height: '100%', minHeight: 0 }}>
        <div className="col" style={{ minHeight: 0 }}>
          <div className="row">
            <Seg value={bgPreview} onChange={setBgPreview} options={[{ value: 'checker', label: 'Cuadrícula' }, { value: 'black', label: 'Prenda negra' }, { value: 'white', label: 'Prenda blanca' }]} />
            <div className="grow" />
            <span className="tiny muted">Vista reducida; se aplica a resolución completa</span>
          </div>
          <div className={'preview-box ' + (bgPreview === 'checker' ? 'checker' : '')} style={{ flex: 1, minHeight: 360, background: bgPreview === 'black' ? '#0c0c0c' : bgPreview === 'white' ? '#f4f4f4' : undefined, cursor: picking.current ? 'crosshair' : 'default' }} onClick={pickColor}>
            <CanvasPreview canvas={preview} style={{ width: '100%', height: '100%' }} />
          </div>
        </div>
        <div className="col" style={{ overflowY: 'auto', gap: 10 }}>
          <Seg value={tab} onChange={setTab} full options={[{ value: 'ai', label: <><Sparkles size={12} />IA</> }, { value: 'color', label: <><Wand size={12} />Color</> }, { value: 'refine', label: <><Brush size={12} />Refinar</> }]} />
          {tab === 'ai' && <>
            <div className="tiny muted">Segmentación por red neuronal (ISNet) ejecutada en tu navegador. La primera vez descarga el modelo (~80 MB) desde el CDN de IMG.LY; después queda en caché. Tus imágenes no salen del equipo.</div>
            <button className="btn primary" onClick={runAI} disabled={!src}><Sparkles size={13} />{aiMask ? 'Volver a calcular' : 'Detectar sujeto'}</button>
            {aiStatus && <div className="tiny" style={{ color: 'var(--text-2)' }}>{aiStatus}</div>}
          </>}
          {tab === 'color' && <>
            <div className="row"><span className="label">Color fondo</span><ColorInput value={color} onChange={setColor} />
              <button className="icon-btn sm" title="Tomar de la vista previa" onClick={() => { picking.current = true; }}><Pipette size={13} /></button>
              <button className="btn sm" onClick={() => setColor('#ffffff')}>Blanco</button><button className="btn sm" onClick={() => setColor('#000000')}>Negro</button></div>
            <Slider label="Tolerancia" value={tolerance} min={0} max={100} onChange={setTolerance} />
            <Slider label="Suavizado del borde" value={softness} min={0} max={60} onChange={setSoftness} />
            <Check checked={contiguous} onChange={setContiguous} label="Solo fondo conectado al borde" title="Desactiva para eliminar ese color en toda la imagen (p. ej. huecos de letras)" />
            <Check checked={decont} onChange={setDecont} label="Descontaminar bordes (quita halo)" />
            <Slider label="Contraer borde" value={choke} min={0} max={20} step={0.5} digits={1} suffix="px" onChange={setChoke} />
          </>}
          <div className="section-title">Refinar bordes</div>
          <Slider label="Suavizar dientes" value={rSmooth} min={0} max={10} step={0.5} digits={1} suffix="px" onChange={setRSmooth} />
          <Slider label="Contraer / expandir" value={rContract} min={-10} max={20} step={0.5} digits={1} suffix="px" onChange={setRContract} />
          <Slider label="Calar (feather)" value={rFeather} min={0} max={20} step={0.5} digits={1} suffix="px" onChange={setRFeather} />
          <Check checked={rDecont} onChange={setRDecont} label="Descontaminar con el color de fondo" />
          <div className="section-title">Limpiar alfa para DTF</div>
          <Slider label="Eliminar por debajo de" value={cleanLow} min={0} max={254} onChange={setCleanLow} hint="Píxeles casi transparentes que generan ruido de blanco" />
          <Slider label="Opaco por encima de" value={cleanHigh} min={1} max={255} onChange={setCleanHigh} />
          <div className="row" style={{ gap: 4 }}>
            <button className="btn sm" onClick={() => { setCleanLow(25); setCleanHigh(230); }}>Recomendado</button>
            <button className="btn sm" onClick={() => { setCleanLow(127); setCleanHigh(128); }}>Binario</button>
            <button className="btn sm" onClick={() => { setCleanLow(0); setCleanHigh(255); }}>Sin limpiar</button>
          </div>
          <div className="tiny muted">Para recuperar zonas borradas usa el pincel de restauración (Y) o aplica el resultado como máscara y píntala.</div>
          <button className="btn sm ghost" onClick={() => { onClose(); set({ tool: 'restore' }); }}><Brush size={12} />Ir al pincel de restauración</button>
        </div>
      </div>
    </Modal>
  );
}
