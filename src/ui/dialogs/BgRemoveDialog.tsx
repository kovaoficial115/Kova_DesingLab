import React, { useEffect, useRef, useState } from 'react';
import { Eraser, Sparkles, Pipette, Wand, Brush } from 'lucide-react';
import { Modal, Slider, Seg, Check, ColorInput, CanvasPreview } from '../components/controls';
import { activeLayer, docState, withBusy, toast, commit, set } from '../../core/store';
import type { Layer } from '../../core/types';
import { descendants } from '../../core/doc';
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
  // WebGPU si el navegador lo ofrece (más rápido); si no, WebAssembly en la CPU. Con poca memoria se
  // usa el modelo cuantizado (más ligero, algo menos preciso).
  const gpu = typeof navigator !== 'undefined' && 'gpu' in navigator && !!(await (navigator as any).gpu?.requestAdapter?.().catch(() => null));
  const lowMem = typeof navigator !== 'undefined' && (navigator as any).deviceMemory !== undefined && (navigator as any).deviceMemory <= 4;
  onProgress(gpu ? 'Usando la GPU (WebGPU)…' : 'Usando la CPU (WebAssembly)…');
  const run = (device: 'gpu' | 'cpu') => aiModule.removeBackground(blob, {
    device,
    model: lowMem && device === 'cpu' ? 'isnet_quint8' : 'isnet_fp16',
    output: { format: 'image/png', type: 'mask' },
    progress: (key: string, cur: number, total: number) => { if (total) onProgress(`Descargando modelo ${Math.round((cur / total) * 100)}% (${key.split('/').pop()})`); },
  });
  let out: Blob;
  try { out = await run(gpu ? 'gpu' : 'cpu'); }
  catch (e) { if (!gpu) throw e; onProgress('La GPU falló; reintentando en la CPU…'); out = await run('cpu'); }
  return blobToCanvas(out);
}

/** Capas a las que se aplica: todas las seleccionadas (y las de dentro de los grupos seleccionados)
 *  que tienen píxeles y no están bloqueadas. La activa va primero (es la de la vista previa). */
function targetLayers(active: Layer | null): Layer[] {
  const s = docState();
  if (!s || !active) return active ? [active] : [];
  const ids = new Set<string>();
  for (const id of s.selectedLayerIds) { ids.add(id); descendants(s.layers, id).forEach(d => ids.add(d.id)); }
  const ok = (l: Layer) => ids.has(l.id) && l.kind !== 'group' && l.kind !== 'adjust' && !l.locked;
  const list = s.layers.filter(ok);
  return [active, ...list.filter(l => l.id !== active.id)].filter(ok);
}

export function BgRemoveDialog({ onClose, tab: initialTab, asSelection }: { onClose: () => void; tab?: Tab; asSelection?: boolean }) {
  const layer = activeLayer();
  const targets = React.useMemo(() => targetLayers(layer), []);
  const multi = targets.length > 1;
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

  const process = async (input: HTMLCanvasElement, full: boolean, refW = src!.width, mask: HTMLCanvasElement | null = aiMask): Promise<HTMLCanvasElement> => {
    const k = input.width / refW;
    let img = getImageData(input);
    if (tab === 'ai') {
      if (!mask) return input;
      const out = cloneCanvas(input);
      const g = ctx2d(out);
      const m = createCanvas(input.width, input.height);
      const mg = ctx2d(m);
      mg.drawImage(mask, 0, 0, input.width, input.height);
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

  /** Imagen de una capa a su tamaño de contenido (igual que la vista previa de la activa). */
  const sourceOf = async (l: Layer) => {
    const b = await bakedLayerCanvas(l);
    if (!b) return null;
    const { w, h } = layerSize(l);
    return cloneCanvas(b, w, h);
  };
  const maskFrom = (l: Layer, out: HTMLCanvasElement) => {
    const { w, h } = layerSize(l);
    const mask = createCanvas(w, h);
    const g = ctx2d(mask);
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    const white = createCanvas(w, h);
    const wg = ctx2d(white);
    wg.drawImage(out, 0, 0, w, h);
    wg.globalCompositeOperation = 'source-in';
    wg.fillStyle = '#fff'; wg.fillRect(0, 0, w, h);
    g.drawImage(white, 0, 0);
    return mask;
  };

  const apply = () => withBusy(multi && output !== 'selection' ? `Aplicando a ${targets.length} capas…` : 'Aplicando…', async () => {
    if (!src) return;
    if (output === 'selection') {
      const out = await process(src, true);
      setSelection(localMaskToWorld(out, layer), 'Seleccionar sujeto', 'new');
      toast('Listo', 'ok');
      onClose();
      return;
    }
    // misma configuración para todas las capas seleccionadas, en un solo paso del historial
    const results = new Map<string, HTMLCanvasElement>();
    let skipped = 0;
    for (let i = 0; i < targets.length; i++) {
      const l = targets[i];
      if (multi) setAiStatus(`Capa ${i + 1} de ${targets.length}: ${l.name}`);
      const input = l.id === layer.id ? src : await sourceOf(l);
      if (!input || !input.width || !input.height) { skipped++; continue; }
      let mask = aiMask;
      if (tab === 'ai' && l.id !== layer.id) mask = await removeBgAI(input, t => setAiStatus(`${l.name}: ${t}`));
      results.set(l.id, await process(input, true, input.width, mask));
    }
    if (!results.size) { toast('Ninguna capa seleccionada tiene píxeles que procesar', 'warn'); return; }
    if (output === 'mask') {
      const masks = new Map([...results].map(([id, out]) => [id, maskFrom(targets.find(l => l.id === id)!, out)]));
      commit(multi ? `Máscara de fondo (${masks.size} capas)` : 'Máscara de fondo', st => ({ ...st, layers: st.layers.map(x => (masks.has(x.id) ? { ...x, mask: masks.get(x.id)!, maskEnabled: true } : x)) }));
    } else {
      results.forEach((_, id) => invalidateLayer(id));
      const label = (tab === 'refine' ? 'Refinar bordes' : 'Eliminar fondo') + (multi ? ` (${results.size} capas)` : '');
      commit(label, st => ({ ...st, layers: st.layers.map(x => {
        const out = results.get(x.id);
        return out ? { ...x, kind: 'raster', canvas: out, origin: x.origin ?? x.canvas ?? out, adjustments: [], text: undefined, shape: undefined, vector: undefined } : x;
      }) }));
    }
    toast(multi ? `Aplicado a ${results.size} capas${skipped ? ` (${skipped} sin píxeles, sin cambios)` : ''}` : 'Listo', 'ok');
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
        {multi && output !== 'selection' && <span className="chip" title={`La vista previa muestra «${layer.name}»; los mismos ajustes se aplican a todas`}>Se aplicará a {targets.length} capas</span>}
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
            <div className="tiny muted">Segmentación por red neuronal (ISNet) ejecutada en tu navegador, con WebGPU si está disponible y si no en la CPU. La primera vez descarga el modelo (~40–80 MB) desde el CDN de IMG.LY; después queda en caché. Tus imágenes no salen del equipo. Sin conexión o en equipos lentos: Selección → Sujeto rápido (sin IA, aproximado).</div>
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
