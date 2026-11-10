import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Grid3x3, AlertTriangle, ZoomIn, Maximize2 } from 'lucide-react';
import { Modal, Slider, Select, Seg, Check, ColorInput, CanvasPreview, NumberField } from '../components/controls';
import { activeLayer, activeArtboard, docState, withBusy, toast, commit } from '../../core/store';
import { bakedLayerCanvas } from '../../core/render';
import { getImageData, canvasFromImageData, resampleCanvas, layerSize, createCanvas, ctx2d, cloneCanvas, hexToRgb, uid } from '../../core/util';
import { selectionInLayer } from '../../core/actions';
import { invalidateLayer } from '../../core/render';
import { defaultHalftone, type HalftoneParams, type DotShape, type HalftoneMode } from '../../engine/halftone';
import { runOp } from '../../engine/workerClient';
import { hasIcc, rgbaToCmyk } from '../../engine/cms';
import { rasterLayer, groupLayer } from '../../core/doc';
import type { Layer } from '../../core/types';

interface UIParams extends Omit<HalftoneParams, 'cellPx' | 'inkColor'> { lpi: number; ink: string }

const PRESETS: { name: string; desc: string; p: Partial<UIParams> }[] = [
  { name: 'Transición DTF', desc: 'Degradados y sombras a puntos sólidos (alfa)', p: { mode: 'alpha', shape: 'round', lpi: 30, angle: 22.5, minDot: 0.04, maxDot: 0.94, knockout: 'none', sample: 'cell', antialias: false } },
  { name: 'Prenda oscura', desc: 'Los tonos oscuros desaparecen en puntos', p: { mode: 'alpha', shape: 'round', lpi: 28, angle: 22.5, knockout: 'dark', minDot: 0.05, maxDot: 0.95, antialias: false } },
  { name: 'Prenda clara', desc: 'Los tonos claros desaparecen en puntos', p: { mode: 'alpha', shape: 'round', lpi: 28, angle: 22.5, knockout: 'light', minDot: 0.05, maxDot: 0.95, antialias: false } },
  { name: 'Vintage', desc: 'Trama gruesa desgastada', p: { mode: 'color', shape: 'round', lpi: 18, angle: 45, contrast: 15, minDot: 0.08, maxDot: 0.9, antialias: false } },
  { name: 'Mono 45°', desc: 'Tinta única clásica', p: { mode: 'mono', shape: 'round', lpi: 35, angle: 45, ink: '#000000', antialias: false } },
  { name: 'Líneas', desc: 'Trama lineal', p: { mode: 'mono', shape: 'line', lpi: 24, angle: 30, antialias: false } },
  { name: 'Pop CMYK', desc: 'Cuatricromía con ángulos clásicos', p: { mode: 'cmyk', shape: 'round', lpi: 25, antialias: false } },
];

/** Celda mínima (px) con la que se calcula la vista previa completa. */
const MIN_PREVIEW_CELL = 8;

function toEngine(p: UIParams, ppi: number): HalftoneParams {
  const { lpi, ink, ...rest } = p;
  return { ...rest, cellPx: ppi / lpi, inkColor: hexToRgb(ink) };
}

export function HalftoneDialog({ onClose }: { onClose: () => void }) {
  const layer = activeLayer();
  const ab = activeArtboard()!;
  const sel = docState()?.selection ?? null;
  const [p, setP] = useState<UIParams>({ ...defaultHalftone, lpi: 30, ink: '#000000' } as any);
  const scale = layer ? Math.max(Math.abs(layer.scaleX), Math.abs(layer.scaleY)) : 1;
  const [printRes, setPrintRes] = useState(Math.abs(scale - 1) > 0.02);
  const [onlySel, setOnlySel] = useState(!!sel);
  const [output, setOutput] = useState<'replace' | 'new' | 'separate'>('new');
  const [base, setBase] = useState<HTMLCanvasElement | null>(null);
  const [view, setView] = useState<'fit' | 'detail'>('fit');
  const [detailPos, setDetailPos] = useState({ x: 0.5, y: 0.5 });
  const [preview, setPreview] = useState<HTMLCanvasElement | null>(null);
  const [computing, setComputing] = useState(false);
  const reqId = useRef(0);
  const up = (patch: Partial<UIParams>) => setP(x => ({ ...x, ...patch }));
  const upCh = (k: 'c' | 'm' | 'y' | 'k', patch: any) => setP(x => ({ ...x, channels: { ...x.channels, [k]: { ...x.channels[k], ...patch } } }));

  // fuente: la capa con ajustes horneados, opcionalmente a resolución de impresión
  useEffect(() => {
    if (!layer) return;
    (async () => {
      const b = await bakedLayerCanvas(layer);
      if (!b) return;
      const { w, h } = layerSize(layer);
      let c = cloneCanvas(b, w, h);
      if (printRes) c = resampleCanvas(c, Math.max(1, w * Math.abs(layer.scaleX)), Math.max(1, h * Math.abs(layer.scaleY)));
      setBase(c);
    })();
  }, [printRes]);

  const ppi = printRes ? ab.dpi : ab.dpi / scale;
  const cell = ppi / p.lpi;
  const selMask = useMemo(() => {
    if (!base || !sel || !onlySel || !layer) return null;
    let m = selectionInLayer(sel, layer);
    if (m.width !== base.width) m = resampleCanvas(m, base.width, base.height);
    const d = getImageData(m).data;
    const a = new Uint8ClampedArray(base.width * base.height);
    for (let j = 0; j < a.length; j++) a[j] = d[j * 4 + 3];
    return a;
  }, [base, onlySel]);

  // región de la vista previa
  const region = useMemo(() => {
    if (!base) return null;
    if (view === 'fit') {
      const MAX = 1400;
      let down = base.width * base.height > MAX * MAX ? Math.sqrt((MAX * MAX) / (base.width * base.height)) : 1;
      // la trama se calcula a la escala reducida: con celdas de menos de ~8 px los puntos ya no se
      // pueden dibujar redondos y la vista previa muestra un tejido que el resultado real no tiene
      down = Math.min(1, Math.max(down, MIN_PREVIEW_CELL / cell));
      return { x: 0, y: 0, w: base.width, h: base.height, down };
    }
    const W = Math.min(base.width, 560), H = Math.min(base.height, 420);
    return { x: Math.round(Math.max(0, Math.min(base.width - W, detailPos.x * base.width - W / 2))), y: Math.round(Math.max(0, Math.min(base.height - H, detailPos.y * base.height - H / 2))), w: W, h: H, down: 1 };
  }, [base, view, detailPos, cell]);

  useEffect(() => {
    if (!base || !region) return;
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      setComputing(true);
      // para la vista completa de imágenes grandes se reduce también la celda → mismo aspecto visual
      let src = base;
      if (region.down < 1) src = resampleCanvas(base, base.width * region.down, base.height * region.down);
      const c = createCanvas(region.w * region.down, region.h * region.down);
      ctx2d(c).drawImage(src, -region.x * region.down, -region.y * region.down);
      const img = getImageData(c);
      const params = toEngine(p, ppi * region.down);
      if (p.mode === 'cmyk' && hasIcc()) params.cmykPlanes = rgbaToCmyk(img.data);
      if (selMask) {
        const sc = createCanvas(base.width, base.height);
        const sd = new ImageData(base.width, base.height);
        for (let j = 0; j < selMask.length; j++) sd.data[j * 4 + 3] = selMask[j];
        ctx2d(sc).putImageData(sd, 0, 0);
        const sc2 = createCanvas(c.width, c.height);
        ctx2d(sc2).drawImage(sc, -region.x * region.down, -region.y * region.down, base.width * region.down, base.height * region.down);
        const d = getImageData(sc2).data;
        const a = new Uint8ClampedArray(c.width * c.height);
        for (let j = 0; j < a.length; j++) a[j] = d[j * 4 + 3];
        params.selection = a;
      }
      try {
        const r = await runOp('halftone', img, params);
        if (id !== reqId.current) return;
        setPreview(canvasFromImageData(r.image!));
      } finally { if (id === reqId.current) setComputing(false); }
    }, 180);
    return () => clearTimeout(t);
  }, [base, region, p, selMask, ppi]);

  if (!layer) { toast('Selecciona una capa', 'warn'); onClose(); return null; }

  const runFull = async (params: HalftoneParams) => {
    const img = getImageData(base!);
    if (params.mode === 'cmyk' && hasIcc()) params.cmykPlanes = rgbaToCmyk(img.data);
    if (selMask) params.selection = selMask;
    const r = await runOp('halftone', img, params);
    return canvasFromImageData(r.image!);
  };

  const apply = () => withBusy('Generando semitonos…', async () => {
    if (!base) return;
    const params = toEngine(p, ppi);
    const transform: Partial<Layer> = printRes ? { scaleX: Math.sign(layer.scaleX), scaleY: Math.sign(layer.scaleY) } : {};
    if (output === 'separate' && p.mode === 'cmyk') {
      const inks: Record<string, string> = { c: '#00aeef', m: '#ec008c', y: '#fff200', k: '#000000' };
      const names: Record<string, string> = { c: 'Cian', m: 'Magenta', y: 'Amarillo', k: 'Negro' };
      const grp = { ...groupLayer(`${layer.name} · separación CMYK`), parentId: layer.parentId };
      const kids: Layer[] = [];
      for (const k of ['y', 'm', 'c', 'k'] as const) {
        if (!p.channels[k].enabled) continue;
        const only = { ...params, channels: { c: { ...params.channels.c, enabled: k === 'c' }, m: { ...params.channels.m, enabled: k === 'm' }, y: { ...params.channels.y, enabled: k === 'y' }, k: { ...params.channels.k, enabled: k === 'k' } } };
        const c = await runFull(only);
        kids.push({ ...rasterLayer(c, names[k], layer.x, layer.y), ...transform, rotation: layer.rotation, scaleX: printRes ? Math.sign(layer.scaleX) : layer.scaleX, scaleY: printRes ? Math.sign(layer.scaleY) : layer.scaleY, blend: 'multiply', parentId: grp.id });
        void inks;
      }
      commit('Separación CMYK con semitonos', st => {
        const layers = [...st.layers];
        const idx = layers.findIndex(x => x.id === layer.id) + 1;
        layers.splice(idx, 0, grp, ...kids);
        return { ...st, layers: layers.map(x => (x.id === layer.id ? { ...x, visible: false } : x)), selectedLayerIds: [grp.id] };
      });
    } else {
      const c = await runFull(params);
      if (output === 'replace') {
        invalidateLayer(layer.id);
        commit('Semitonos', st => ({ ...st, layers: st.layers.map(x => (x.id === layer.id ? { ...x, kind: 'raster', canvas: c, origin: x.origin ?? x.canvas, adjustments: [], text: undefined, shape: undefined, vector: undefined, ...transform } : x)) }));
      } else {
        const nl: Layer = { ...layer, id: uid('ly'), name: `${layer.name} semitono`, kind: 'raster', canvas: c, origin: c, adjustments: [], mask: null, text: undefined, shape: undefined, vector: undefined, ...transform };
        commit('Semitonos (nueva capa)', st => {
          const layers = st.layers.map(x => (x.id === layer.id ? { ...x, visible: false } : x));
          layers.splice(layers.findIndex(x => x.id === layer.id) + 1, 0, nl);
          return { ...st, layers, selectedLayerIds: [nl.id] };
        });
      }
    }
    toast('Semitonos aplicados', 'ok');
    onClose();
  });

  const warn = cell < 4 ? 'Celda menor de 4 px: los puntos no se forman bien a esta resolución. Baja el LPI o sube la resolución.' : p.lpi > 55 ? 'LPI alto para DTF: los puntos muy finos pueden no transferirse.' : null;

  return (
    <Modal title="Semitonos (halftone)" icon={<Grid3x3 size={16} />} onClose={onClose} width={1080} height="88vh"
      footer={<>
        <span className="tiny muted">Celda {cell.toFixed(2)} px · {ppi.toFixed(0)} ppp efectivos · {base ? `${base.width}×${base.height} px` : ''}</span>
        <div className="spacer" />
        <Seg value={output} onChange={setOutput} options={[{ value: 'new', label: 'Nueva capa' }, { value: 'replace', label: 'Reemplazar' }, ...(p.mode === 'cmyk' ? [{ value: 'separate' as const, label: 'Capas C/M/Y/K' }] : [])]} />
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" onClick={apply} disabled={!base}>Aplicar</button>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 14, minHeight: 0, height: '100%' }}>
        <div className="col" style={{ minHeight: 0 }}>
          <div className="row">
            <Seg value={view} onChange={setView} options={[{ value: 'fit', label: <><Maximize2 size={12} />Completo</> }, { value: 'detail', label: <><ZoomIn size={12} />Detalle 1:1</> }]} />
            {view === 'fit' && <span className="tiny muted">Clic en la imagen para ver ese punto a 1:1</span>}
            <div className="grow" />
            {computing && <><div className="spinner" /><span className="tiny muted">Calculando…</span></>}
          </div>
          <div className="preview-box checker" style={{ flex: 1, minHeight: 360, cursor: view === 'fit' ? 'zoom-in' : 'default' }}
            onClick={e => {
              if (view !== 'fit') return;
              const cv = (e.currentTarget as HTMLElement).querySelector('canvas');
              if (!cv) return;
              const r = cv.getBoundingClientRect();
              setDetailPos({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
              setView('detail');
            }}>
            <CanvasPreview canvas={preview} style={{ width: '100%', height: '100%' }} pixelated={view === 'detail'} />
          </div>
        </div>
        <div className="col" style={{ overflowY: 'auto', paddingRight: 4, gap: 10 }}>
          <div className="section-title">Ajustes preestablecidos</div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
            {PRESETS.map(pr => <button key={pr.name} className="chip" style={{ cursor: 'pointer' }} title={pr.desc} onClick={() => up(pr.p)}>{pr.name}</button>)}
          </div>
          <div className="section-title">Modo</div>
          <Select value={p.mode} onChange={(v: HalftoneMode) => up({ mode: v })} options={[
            { value: 'alpha', label: 'Transparencia (conserva color) — DTF' }, { value: 'mono', label: 'Monocromo (una tinta)' },
            { value: 'color', label: 'Color (puntos por luminancia)' }, { value: 'cmyk', label: 'CMYK multicanal' },
          ]} />
          {p.mode === 'alpha' && <Select value={p.knockout} onChange={v => up({ knockout: v })} options={[
            { value: 'none', label: 'Trama solo en semitransparencias' }, { value: 'dark', label: 'Oscuros → transparentes (prenda negra)' }, { value: 'light', label: 'Claros → transparentes (prenda blanca)' },
          ]} />}
          {p.mode === 'mono' && <div className="row"><span className="label">Tinta</span><ColorInput value={p.ink} onChange={v => up({ ink: v })} /></div>}
          <div className="section-title">Trama</div>
          <Select value={p.shape} onChange={(v: DotShape) => up({ shape: v })} options={[
            { value: 'round', label: 'Puntos circulares' }, { value: 'square', label: 'Puntos cuadrados' }, { value: 'diamond', label: 'Rombo' },
            { value: 'ellipse', label: 'Elíptico' }, { value: 'line', label: 'Líneas' }, { value: 'cross', label: 'Cruz' },
          ]} />
          {p.shape === 'ellipse' && <Slider label="Proporción elíptica" value={p.ellipseRatio} min={1} max={4} step={0.05} digits={2} onChange={v => up({ ellipseRatio: v })} />}
          <Slider label="Frecuencia" value={p.lpi} min={5} max={85} step={0.5} digits={1} suffix="LPI" onChange={v => up({ lpi: v })} hint="Líneas por pulgada" />
          {p.mode !== 'cmyk' && <Slider label="Ángulo" value={p.angle} min={0} max={180} step={0.5} digits={1} suffix="°" onChange={v => up({ angle: v })} />}
          <Slider label="Tamaño de punto" value={p.dotScale * 100} min={30} max={200} suffix="%" onChange={v => up({ dotScale: v / 100 })} />
          <Slider label="Contraste" value={p.contrast} min={-100} max={100} onChange={v => up({ contrast: v })} />
          <Slider label="Densidad" value={p.density} min={-100} max={100} onChange={v => up({ density: v })} />
          <div className="section-title">Transición</div>
          <Slider label="Punto mínimo (se elimina)" value={Math.round(p.minDot * 100)} min={0} max={50} suffix="%" onChange={v => up({ minDot: v / 100 })} />
          <Slider label="Sólido a partir de" value={Math.round(p.maxDot * 100)} min={50} max={100} suffix="%" onChange={v => up({ maxDot: v / 100 })} />
          <Seg value={p.sample} onChange={v => up({ sample: v })} full options={[{ value: 'cell', label: 'Promedio por celda' }, { value: 'pixel', label: 'Por píxel' }]} />
          <Check checked={p.antialias} onChange={v => up({ antialias: v })} label="Bordes suavizados (antialias)" title="Desactivado = píxeles 100 % opacos o transparentes, ideal para DTF" />
          <Check checked={p.invert} onChange={v => up({ invert: v })} label="Invertir" />
          {p.mode === 'cmyk' && <>
            <div className="section-title">Canales CMYK {hasIcc() ? '(perfil ICC)' : '(fórmula)'}</div>
            {(['c', 'm', 'y', 'k'] as const).map(k => (
              <div key={k} className="row">
                <Check checked={p.channels[k].enabled} onChange={v => upCh(k, { enabled: v })} label={<b style={{ color: { c: '#00aeef', m: '#ec008c', y: '#fff200', k: '#ddd' }[k] }}>{k.toUpperCase()}</b>} />
                <NumberField label="∠" value={p.channels[k].angle} onChange={v => upCh(k, { angle: v })} min={0} max={180} digits={1} suffix="°" />
                <NumberField label="×" value={p.channels[k].lpiScale} onChange={v => upCh(k, { lpiScale: v })} min={0.5} max={2} step={0.05} digits={2} title="Escala de celda del canal" />
              </div>
            ))}
            <span className="tiny muted">Ángulos clásicos C15° M75° Y0° K45° minimizan el moiré entre canales.</span>
          </>}
          <div className="section-title">Origen</div>
          <Check checked={printRes} onChange={setPrintRes} label={`Generar a resolución de impresión (${ab.dpi} ppp)`} title="Hornea la escala de la capa para que cada punto tenga el tamaño físico exacto" />
          {sel && <Check checked={onlySel} onChange={setOnlySel} label="Solo dentro de la selección" />}
          {warn && <div className="row tiny" style={{ color: 'var(--warn)', alignItems: 'flex-start' }}><AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />{warn}</div>}
          <div className="tiny muted">Para DTF: 25–40 LPI a 300 ppp. El antialias desactivado evita píxeles semitransparentes que el RIP convierte en blanco irregular.</div>
        </div>
      </div>
    </Modal>
  );
}
