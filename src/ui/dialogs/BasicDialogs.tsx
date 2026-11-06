import React, { useEffect, useMemo, useState } from 'react';
import { FilePlus2, Scaling, Crop, Keyboard, Info, Grid3x3, Palette, Shapes, Pipette } from 'lucide-react';
import { Modal, NumberField, Select, Check, Seg, Slider, ColorInput, CanvasPreview } from '../components/controls';
import { useStore, set, get, activeArtboard, activeLayer, docState, withBusy, toast } from '../../core/store';
import type { Unit } from '../../core/types';
import { toPx, fromPx, getImageData, canvasFromImageData, hexToRgb } from '../../core/util';
import { newDoc, rasterLayer } from '../../core/doc';
import * as A from '../../core/actions';
import { DOC_PRESETS } from '../Home';
import { commands, displayKeys } from '../commands';
import { cmsState, setCmsOptions, hasIcc } from '../../engine/cms';
import { runOp } from '../../engine/workerClient';
import { renderLayerAlone } from '../../core/render';

const units: { value: Unit; label: string }[] = [{ value: 'px', label: 'píxeles' }, { value: 'cm', label: 'cm' }, { value: 'mm', label: 'mm' }, { value: 'in', label: 'pulgadas' }];

export function NewDocDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('Diseño KOVA');
  const [unit, setUnit] = useState<Unit>('cm');
  const [w, setW] = useState(28);
  const [h, setH] = useState(35);
  const [dpi, setDpi] = useState(300);
  const [bg, setBg] = useState<'transparent' | 'white' | 'black' | 'custom'>('transparent');
  const [color, setColor] = useState('#ffffff');
  const pxW = Math.round(toPx(w, unit, dpi)), pxH = Math.round(toPx(h, unit, dpi));
  const mp = (pxW * pxH) / 1e6;
  const changeUnit = (u: Unit) => { setW(+fromPx(pxW, u, dpi).toFixed(u === 'px' ? 0 : 2)); setH(+fromPx(pxH, u, dpi).toFixed(u === 'px' ? 0 : 2)); setUnit(u); };
  const create = () => {
    const background = bg === 'transparent' ? null : bg === 'white' ? '#ffffff' : bg === 'black' ? '#000000' : color;
    A.addDoc(newDoc(name, pxW, pxH, dpi, background));
    onClose();
  };
  return (
    <Modal title="Nuevo documento" icon={<FilePlus2 size={16} />} onClose={onClose} width={560}
      footer={<><span className="tiny muted">{pxW}×{pxH} px · {mp.toFixed(1)} MP · {(mp * 4).toFixed(0)} MB en memoria</span><div className="spacer" /><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={create} disabled={pxW < 1 || pxH < 1 || mp > 400}>Crear</button></>}>
      <div className="preset-grid">
        {DOC_PRESETS.map(p => (
          <div key={p.id} className="preset" onClick={() => { setUnit('cm'); setW(p.w); setH(p.h); setDpi(p.dpi); setName(p.name); }}>
            <div className="small" style={{ fontWeight: 600 }}>{p.name}</div>
            <div className="tiny muted">{p.w}×{p.h} cm · {p.hint}</div>
          </div>
        ))}
      </div>
      <div className="row"><span className="label">Nombre</span><input className="input" value={name} onChange={e => setName(e.target.value)} /></div>
      <div className="row"><span className="label">Ancho</span><NumberField value={w} onChange={setW} min={0.01} digits={unit === 'px' ? 0 : 2} /><span className="label" style={{ textAlign: 'right' }}>Alto</span><NumberField value={h} onChange={setH} min={0.01} digits={unit === 'px' ? 0 : 2} /></div>
      <div className="row"><span className="label">Unidades</span><Select value={unit} onChange={changeUnit} options={units} /><span className="label" style={{ textAlign: 'right' }}>Resolución</span><NumberField value={dpi} onChange={setDpi} min={1} max={2400} digits={0} suffix="ppp" /></div>
      <div className="row"><span className="label">Fondo</span>
        <Seg value={bg} onChange={setBg} options={[{ value: 'transparent', label: 'Transparente' }, { value: 'white', label: 'Blanco' }, { value: 'black', label: 'Negro' }, { value: 'custom', label: 'Color' }]} />
        {bg === 'custom' && <ColorInput value={color} onChange={setColor} />}
      </div>
      <div className="tiny muted">Para DTF se recomienda 300 ppp y fondo transparente.</div>
    </Modal>
  );
}

export function ImageSizeDialog({ onClose }: { onClose: () => void }) {
  const ab = activeArtboard()!;
  const [unit, setUnit] = useState<Unit>(get().unit === 'px' ? 'cm' : get().unit);
  const [resample, setResample] = useState(false);
  const [keep, setKeep] = useState(true);
  const [pxW, setPxW] = useState(ab.w);
  const [pxH, setPxH] = useState(ab.h);
  const [dpi, setDpi] = useState(ab.dpi);
  // sin remuestreo, los píxeles son fijos y el tamaño físico depende del DPI
  const physW = fromPx(resample ? pxW : ab.w, unit, dpi), physH = fromPx(resample ? pxH : ab.h, unit, dpi);
  const setPhysW = (v: number) => {
    if (!resample) { setDpi(Math.max(1, +(toPx(1, 'in', 1) * ab.w / toPx(v, unit, 1)).toFixed(2))); return; }
    const nw = Math.round(toPx(v, unit, dpi)); setPxW(nw); if (keep) setPxH(Math.round((nw * ab.h) / ab.w));
  };
  const setPhysH = (v: number) => {
    if (!resample) { setDpi(Math.max(1, +(ab.h / toPx(v, unit, 1)).toFixed(2))); return; }
    const nh = Math.round(toPx(v, unit, dpi)); setPxH(nh); if (keep) setPxW(Math.round((nh * ab.w) / ab.h));
  };
  const setDpiR = (v: number) => {
    if (resample) { const k = v / dpi; setPxW(Math.round(pxW * k)); setPxH(Math.round(pxH * k)); }
    setDpi(v);
  };
  useEffect(() => { if (!resample) { setPxW(ab.w); setPxH(ab.h); } }, [resample]);
  const apply = () => { A.imageSize(resample ? pxW : ab.w, resample ? pxH : ab.h, dpi, resample); onClose(); };
  return (
    <Modal title="Tamaño de imagen" icon={<Scaling size={16} />} onClose={onClose} width={480}
      footer={<><span className="tiny muted">Actual: {ab.w}×{ab.h} px a {ab.dpi} ppp</span><div className="spacer" /><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={apply}>Aplicar</button></>}>
      <Check checked={resample} onChange={setResample} label="Remuestrear (cambia el número de píxeles)" />
      <div className="tiny muted">{resample ? 'Las capas se escalan; al exportar se generan los nuevos píxeles.' : 'Solo cambia la resolución de impresión: los píxeles no cambian, cambia el tamaño físico.'}</div>
      <div className="row"><span className="label">Dimensiones</span><span className="mono small">{resample ? pxW : ab.w} × {resample ? pxH : ab.h} px</span></div>
      <div className="row"><span className="label">Ancho</span><NumberField value={physW} onChange={setPhysW} digits={unit === 'px' ? 0 : 3} min={0.001} /><Select value={unit} onChange={setUnit} options={units} width={110} /></div>
      <div className="row"><span className="label">Alto</span><NumberField value={physH} onChange={setPhysH} digits={unit === 'px' ? 0 : 3} min={0.001} /><Check checked={keep} onChange={setKeep} label="Proporción" /></div>
      <div className="row"><span className="label">Resolución</span><NumberField value={dpi} onChange={setDpiR} digits={2} min={1} max={4800} suffix="ppp" /></div>
      {resample && <div className="row"><span className="label">Píxeles</span><NumberField label="An" value={pxW} digits={0} min={1} onChange={v => { setPxW(v); if (keep) setPxH(Math.round((v * ab.h) / ab.w)); }} /><NumberField label="Al" value={pxH} digits={0} min={1} onChange={v => { setPxH(v); if (keep) setPxW(Math.round((v * ab.w) / ab.h)); }} /></div>}
    </Modal>
  );
}

export function CanvasSizeDialog({ onClose }: { onClose: () => void }) {
  const ab = activeArtboard()!;
  const [unit, setUnit] = useState<Unit>(get().unit);
  const [w, setW] = useState(+fromPx(ab.w, unit, ab.dpi).toFixed(2));
  const [h, setH] = useState(+fromPx(ab.h, unit, ab.dpi).toFixed(2));
  const [anchor, setAnchor] = useState([0.5, 0.5]);
  const changeUnit = (u: Unit) => { setW(+fromPx(toPx(w, unit, ab.dpi), u, ab.dpi).toFixed(2)); setH(+fromPx(toPx(h, unit, ab.dpi), u, ab.dpi).toFixed(2)); setUnit(u); };
  return (
    <Modal title="Tamaño de lienzo" icon={<Crop size={16} />} onClose={onClose} width={420}
      footer={<><div className="spacer" /><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={() => { A.canvasSize(toPx(w, unit, ab.dpi), toPx(h, unit, ab.dpi), anchor[0], anchor[1]); onClose(); }}>Aplicar</button></>}>
      <div className="row"><span className="label">Ancho</span><NumberField value={w} onChange={setW} digits={2} min={0.01} /><Select value={unit} onChange={changeUnit} options={units} width={110} /></div>
      <div className="row"><span className="label">Alto</span><NumberField value={h} onChange={setH} digits={2} min={0.01} /></div>
      <div className="row"><span className="label">Ancla</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 24px)', gap: 3 }}>
          {[0, 0.5, 1].flatMap(y => [0, 0.5, 1].map(x => (
            <button key={`${x}${y}`} className={'icon-btn sm' + (anchor[0] === x && anchor[1] === y ? ' active' : '')} style={{ border: '1px solid var(--border-2)' }} onClick={() => setAnchor([x, y])}>•</button>
          )))}
        </div>
      </div>
    </Modal>
  );
}

export function ModifySelectionDialog({ kind, onClose }: { kind: 'feather' | 'expand' | 'contract' | 'smooth'; onClose: () => void }) {
  const [v, setV] = useState(kind === 'feather' ? 5 : 3);
  const title = { feather: 'Calar selección', expand: 'Expandir selección', contract: 'Contraer selección', smooth: 'Suavizar selección' }[kind];
  return (
    <Modal title={title} onClose={onClose} width={340}
      footer={<><div className="spacer" /><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={() => { A.modifySelection(kind, v); onClose(); }}>Aceptar</button></>}>
      <Slider label="Radio" value={v} min={0.5} max={200} step={0.5} digits={1} suffix="px" onChange={setV} />
    </Modal>
  );
}

export function ColorRangeDialog({ onClose }: { onClose: () => void }) {
  const [color, setColor] = useState(get().fg);
  const [fuzz, setFuzz] = useState(40);
  return (
    <Modal title="Gama de colores" icon={<Pipette size={16} />} onClose={onClose} width={360}
      footer={<><div className="spacer" /><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={() => { A.selectColorRange(color, fuzz * 2.2); onClose(); }}>Seleccionar</button></>}>
      <div className="row"><span className="label">Color</span><ColorInput value={color} onChange={setColor} /><span className="mono small">{color}</span></div>
      <Slider label="Tolerancia" value={fuzz} min={1} max={200} onChange={setFuzz} />
      <div className="tiny muted">Selecciona en la capa activa los píxeles similares al color (usa el cuentagotas para tomar el color frontal).</div>
    </Modal>
  );
}

export function GridDialog({ onClose }: { onClose: () => void }) {
  const st = useStore();
  return (
    <Modal title="Cuadrícula y unidades" icon={<Grid3x3 size={16} />} onClose={onClose} width={380} footer={<><div className="spacer" /><button className="btn primary" onClick={onClose}>Listo</button></>}>
      <div className="row"><span className="label">Unidades</span><Select value={st.unit} onChange={v => set({ unit: v })} options={units} /></div>
      <div className="row"><span className="label">Línea cada</span><NumberField value={st.gridSize} onChange={v => set({ gridSize: v })} min={0.01} digits={2} suffix={st.unit} /></div>
      <div className="row"><span className="label">Subdivisiones</span><NumberField value={st.gridSub} onChange={v => set({ gridSub: Math.max(1, Math.round(v)) })} min={1} max={20} digits={0} /></div>
      <Check checked={st.showGrid} onChange={v => set({ showGrid: v })} label="Mostrar cuadrícula" />
      <Check checked={st.snap} onChange={v => set({ snap: v })} label="Ajuste magnético a guías, bordes, centros y cuadrícula" />
    </Modal>
  );
}

export function ColorSettingsDialog({ onClose }: { onClose: () => void }) {
  const [gcr, setGcr] = useState(cmsState.formula.gcr * 100);
  const [tac, setTac] = useState(cmsState.formula.tac);
  return (
    <Modal title="Ajustes de color" icon={<Palette size={16} />} onClose={onClose} width={440}
      footer={<><div className="spacer" /><button className="btn primary" onClick={() => { setCmsOptions({ formula: { gcr: gcr / 100, tac } }); useStore.setState(s => ({ renderTick: s.renderTick + 1 })); onClose(); }}>Aplicar</button></>}>
      <div className="card small">
        <b>{hasIcc() ? `Perfil ICC activo: ${cmsState.profileName}` : 'Sin perfil ICC'}</b>
        <div className="tiny muted" style={{ marginTop: 4 }}>
          Con un perfil ICC CMYK cargado (panel Canales y color), todas las conversiones y la prueba en pantalla usan LittleCMS.
          Sin perfil, Kova usa una conversión por fórmula con generación de negro (GCR) y límite de tinta total (TAC).
          Esa conversión es útil para separaciones y control de cobertura, pero no simula el gamut real de una impresora.
        </div>
      </div>
      <Slider label="Generación de negro (GCR)" value={gcr} min={0} max={100} suffix="%" onChange={setGcr} hint="Cuánto del gris común se sustituye por tinta K" />
      <Slider label="Límite de tinta total (TAC)" value={tac} min={100} max={400} suffix="%" onChange={setTac} hint="Suma máxima C+M+Y+K" />
    </Modal>
  );
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const list = Object.values(commands).filter(c => c.keys);
  return (
    <Modal title="Atajos de teclado" icon={<Keyboard size={16} />} onClose={onClose} width={640} height="80vh">
      <div style={{ columns: 2, columnGap: 20 }}>
        {list.map((c, i) => (
          <div key={i} className="row small" style={{ breakInside: 'avoid', padding: '3px 0' }}>
            <span className="grow">{c.label}</span><span className="kbd">{displayKeys(c.keys)}</span>
          </div>
        ))}
        <div className="row small" style={{ padding: '3px 0' }}><span className="grow">Desplazar lienzo</span><span className="kbd">Espacio + arrastrar</span></div>
        <div className="row small" style={{ padding: '3px 0' }}><span className="grow">Zoom con rueda</span><span className="kbd">{displayKeys('mod')} + rueda</span></div>
        <div className="row small" style={{ padding: '3px 0' }}><span className="grow">Mover 1 px / 10 px</span><span className="kbd">Flechas / Mayús</span></div>
      </div>
    </Modal>
  );
}

export function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="KOVA Design Lab" icon={<Info size={16} />} onClose={onClose} width={620} height="80vh">
      <div className="small">Editor de imágenes especializado en producción DTF. Todo el procesamiento ocurre en este navegador: tus archivos no se envían a ningún servidor.</div>
      <div className="section-title">Arquitectura</div>
      <div className="tiny muted">React (interfaz) · motor de documento con historial inmutable · renderizador Canvas 2D con composición de capas, máscaras, recortes y fusión · procesamiento de píxeles en Web Workers · LittleCMS (WASM) para ICC · pdf.js, ag-psd y UTIF para importación · jsPDF para PDF · ImageTracer para vectorización · IMG.LY background-removal (ONNX en el navegador) para IA.</div>
      <div className="section-title">Limitaciones conocidas</div>
      <ul className="tiny" style={{ color: 'var(--text-2)', paddingLeft: 18, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <li><b>CMYK:</b> los navegadores solo dibujan en RGB. El modo CMYK se simula en pantalla; las separaciones y la exportación TIFF CMYK son reales. Para una conversión fiel carga el perfil ICC de tu impresora/papel (sin perfil se usa una fórmula con GCR y TAC).</li>
        <li><b>Eliminación de fondo con IA:</b> la primera vez descarga el modelo (~40–80 MB) desde el CDN de IMG.LY y queda en caché; requiere conexión ese primer uso. Licencia AGPL de la librería: revísala si distribuyes la aplicación.</li>
        <li><b>PDF:</b> se importa rasterizado a la resolución elegida; la exportación PDF incrusta la composición como imagen a tamaño físico (no vectorial).</li>
        <li><b>PSD:</b> se importan capas de píxeles, grupos, opacidad, fusión y recortes. Los textos y efectos de capa de Photoshop llegan rasterizados.</li>
        <li><b>WEBP:</b> el formato no guarda DPI. Usa PNG o TIFF para impresión.</li>
        <li><b>Memoria:</b> documentos de más de ~200 MP pueden agotar la memoria del navegador.</li>
      </ul>
    </Modal>
  );
}

export function OutlineDialog({ onClose }: { onClose: () => void }) {
  const l = activeLayer();
  const [mode, setMode] = useState<'outline' | 'silhouette'>('outline');
  const [width, setWidth] = useState(12);
  const [color, setColor] = useState('#ffffff');
  const [pos, setPos] = useState<'outside' | 'inside' | 'center'>('outside');
  const [preview, setPreview] = useState<HTMLCanvasElement | null>(null);
  const [src, setSrc] = useState<{ canvas: HTMLCanvasElement; bounds: any; pad: number } | null>(null);
  useEffect(() => {
    if (!l) return;
    (async () => {
      const s = docState()!;
      const r = await renderLayerAlone(s, l, 1);
      const pad = 220;
      const c = document.createElement('canvas');
      c.width = r.canvas.width + pad * 2; c.height = r.canvas.height + pad * 2;
      c.getContext('2d')!.drawImage(r.canvas, pad, pad);
      setSrc({ canvas: c, bounds: r.bounds, pad });
    })();
  }, []);
  const compute = async (full: boolean) => {
    if (!src) return null;
    const w = mode === 'silhouette' ? 0.5 : width;
    const res = await runOp('outline', getImageData(src.canvas), { width: w, color: hexToRgb(color), position: mode === 'silhouette' ? 'inside' : pos });
    let out = canvasFromImageData(res.image!);
    if (mode === 'silhouette') {
      const g = out.getContext('2d')!;
      g.globalCompositeOperation = 'source-in';
      g.drawImage(src.canvas, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = color; g.fillRect(0, 0, out.width, out.height);
    }
    if (!full) {
      const pv = document.createElement('canvas');
      pv.width = out.width; pv.height = out.height;
      const g = pv.getContext('2d')!;
      g.drawImage(out, 0, 0);
      if (mode === 'outline' && pos === 'outside') g.drawImage(src.canvas, 0, 0);
      return pv;
    }
    return out;
  };
  useEffect(() => { const t = setTimeout(async () => setPreview(await compute(false)), 200); return () => clearTimeout(t); }, [src, mode, width, color, pos]);
  const apply = () => withBusy('Generando…', async () => {
    const out = await compute(true);
    if (!out || !src || !l) return;
    const layer = rasterLayer(out, mode === 'silhouette' ? `${l.name} silueta` : `${l.name} contorno`, src.bounds.x - src.pad, src.bounds.y - src.pad);
    const s = docState()!;
    // insertar debajo de la capa original
    const idx = s.layers.findIndex(x => x.id === l.id);
    import('../../core/store').then(m => m.commit(mode === 'silhouette' ? 'Silueta' : 'Contorno', st => {
      const layers = [...st.layers];
      layers.splice(idx, 0, { ...layer, parentId: l.parentId });
      return { ...st, layers };
    }));
    onClose();
  });
  if (!l) { toast('Selecciona una capa', 'warn'); onClose(); return null; }
  return (
    <Modal title="Contorno / silueta" icon={<Shapes size={16} />} onClose={onClose} width={720}
      footer={<><span className="tiny muted">Se crea una capa nueva debajo de «{l.name}»</span><div className="spacer" /><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={apply}>Crear capa</button></>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px', gap: 14 }}>
        <CanvasPreview canvas={preview} className="preview-box checker-dark" style={{ height: 380 }} />
        <div className="col">
          <Seg value={mode} onChange={setMode} full options={[{ value: 'outline', label: 'Contorno' }, { value: 'silhouette', label: 'Silueta' }]} />
          {mode === 'outline' && <>
            <Slider label="Grosor" value={width} min={1} max={200} suffix="px" onChange={setWidth} />
            <Seg value={pos} onChange={setPos} full options={[{ value: 'outside', label: 'Fuera' }, { value: 'center', label: 'Centro' }, { value: 'inside', label: 'Dentro' }]} />
          </>}
          <div className="row"><span className="label">Color</span><ColorInput value={color} onChange={setColor} /></div>
          <div className="tiny muted">El contorno exterior es útil como borde de seguridad en diseños con detalles finos o para crear un “sticker” DTF. La silueta sirve como base blanca manual o línea de corte.</div>
        </div>
      </div>
    </Modal>
  );
}
