import React, { useEffect, useMemo, useState } from 'react';
import { Layers, Printer, CheckCircle2, AlertTriangle, XCircle, Info, Download, Droplets } from 'lucide-react';
import { Modal, Slider, Seg, Check, ColorInput, CanvasPreview, Select } from '../components/controls';
import { activeDoc, activeArtboard, docState, withBusy, toast, commit, set, activeLayer } from '../../core/store';
import { renderArtboard } from '../../core/render';
import { getImageData, canvasFromImageData, hexToRgb, layerBounds, createCanvas, ctx2d, downloadBlob, canvasToBlob, cloneCanvas, layerSize } from '../../core/util';
import { runOp } from '../../engine/workerClient';
import { rasterLayer, isEffectivelyVisible } from '../../core/doc';
import { rgbaToCmyk, tacReport, cmsState, hasIcc } from '../../engine/cms';
import { defaultHalftone } from '../../engine/halftone';
import { pngSetDpi, encodeTiff } from '../../io/binary';
import { ppiStatus } from '../panels/PropertiesPanel';
import * as A from '../../core/actions';
import type { Artboard } from '../../core/types';

async function composite(ab: Artboard, maxSide?: number) {
  const s = docState()!;
  const k = maxSide ? Math.min(1, maxSide / Math.max(ab.w, ab.h)) : 1;
  return { canvas: await renderArtboard(s, ab, k, { background: false }), k };
}

// ---------- Base blanca ----------
export function UnderbaseDialog({ onClose }: { onClose: () => void }) {
  const ab = activeArtboard()!;
  const [src, setSrc] = useState<{ canvas: HTMLCanvasElement; k: number } | null>(null);
  const [choke, setChoke] = useState(2);
  const [threshold, setThreshold] = useState(20);
  const [useKnock, setUseKnock] = useState(false);
  const [garment, setGarment] = useState('#000000');
  const [tol, setTol] = useState(12);
  const [density, setDensity] = useState(100);
  const [halftoneBase, setHalftoneBase] = useState(false);
  const [lpi, setLpi] = useState(35);
  const [preview, setPreview] = useState<HTMLCanvasElement | null>(null);
  const [view, setView] = useState<'base' | 'garment'>('base');
  useEffect(() => { composite(ab, 1000).then(setSrc); }, []);

  const build = async (input: HTMLCanvasElement, k: number) => {
    let img = (await runOp('underbase', getImageData(input), { choke: choke * k, threshold, knockout: useKnock ? hexToRgb(garment) : null, knockoutTolerance: tol, density: density / 100 })).image!;
    if (halftoneBase) img = (await runOp('halftone', img, { ...defaultHalftone, mode: 'alpha', cellPx: (ab.dpi * k) / lpi, angle: 22.5, minDot: 0.05, maxDot: 0.92, antialias: false })).image!;
    return canvasFromImageData(img);
  };
  useEffect(() => {
    if (!src) return;
    const t = setTimeout(async () => {
      const base = await build(src.canvas, src.k);
      const pv = createCanvas(base.width, base.height);
      const g = ctx2d(pv);
      if (view === 'garment') {
        g.fillStyle = garment; g.fillRect(0, 0, pv.width, pv.height);
        g.drawImage(base, 0, 0);
        g.drawImage(src.canvas, 0, 0);
      } else {
        g.fillStyle = '#2a2a30'; g.fillRect(0, 0, pv.width, pv.height);
        g.drawImage(base, 0, 0);
      }
      setPreview(pv);
    }, 150);
    return () => clearTimeout(t);
  }, [src, choke, threshold, useKnock, garment, tol, density, halftoneBase, lpi, view]);

  const full = async () => { const c = await composite(ab); return build(c.canvas, 1); };
  const asLayer = () => withBusy('Generando base blanca…', async () => {
    const base = await full();
    const l = { ...rasterLayer(base, 'Base blanca', ab.x, ab.y), locked: true };
    commit('Base blanca', st => ({ ...st, layers: [l, ...st.layers] }));
    toast('Capa «Base blanca» creada al fondo (bloqueada)', 'ok');
    onClose();
  });
  const exportPng = (asBlack: boolean) => withBusy('Exportando base blanca…', async () => {
    let base = await full();
    if (asBlack) { const g = ctx2d(base); g.globalCompositeOperation = 'source-in'; g.fillStyle = '#000'; g.fillRect(0, 0, base.width, base.height); }
    const blob = await canvasToBlob(base, 'image/png');
    downloadBlob(new Blob([pngSetDpi(new Uint8Array(await blob.arrayBuffer()), ab.dpi)], { type: 'image/png' }), `${activeDoc()!.name}-base-blanca.png`);
  });
  const knockDesign = () => withBusy('Aplicando knockout…', async () => {
    const l = activeLayer();
    if (!l) return toast('Selecciona la capa del diseño', 'warn');
    await A.applyPixelOp('knockout', { color: hexToRgb(garment), tolerance: tol, softness: 8 }, 'Knockout de prenda', l.id);
  });
  return (
    <Modal title="Base blanca y knockout de prenda" icon={<Droplets size={16} />} onClose={onClose} width={980} height="82vh"
      footer={<>
        <button className="btn" onClick={() => exportPng(false)}><Download size={13} />PNG blanco</button>
        <button className="btn" onClick={() => exportPng(true)} title="Algunos RIP esperan la capa blanca como tinta negra"><Download size={13} />PNG como tinta negra</button>
        <div className="spacer" />
        <button className="btn" onClick={onClose}>Cerrar</button>
        <button className="btn primary" onClick={asLayer}>Crear capa de base blanca</button>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 14, height: '100%', minHeight: 0 }}>
        <div className="col" style={{ minHeight: 0 }}>
          <Seg value={view} onChange={setView} options={[{ value: 'base', label: 'Base blanca' }, { value: 'garment', label: 'Simulación en prenda' }]} />
          <CanvasPreview canvas={preview} className="preview-box" style={{ flex: 1, minHeight: 340 }} />
        </div>
        <div className="col" style={{ overflowY: 'auto', gap: 10 }}>
          <div className="tiny muted">La mayoría de RIP DTF generan el blanco automáticamente. Usa esta herramienta para controlarlo tú: contraerlo para que no asome, eliminarlo donde la prenda aporta el color o tramarlo.</div>
          <Slider label="Contraer base (choke)" value={choke} min={0} max={20} step={0.5} digits={1} suffix="px" onChange={setChoke} />
          <Slider label="Alfa mínimo" value={threshold} min={0} max={254} onChange={setThreshold} />
          <Slider label="Densidad de blanco" value={density} min={10} max={100} suffix="%" onChange={setDensity} />
          <div className="section-title">Color de la prenda</div>
          <div className="row"><ColorInput value={garment} onChange={setGarment} />
            {['#000000', '#ffffff', '#1f2a44', '#7a1f2b', '#2f4f2f', '#9a9a9a'].map(c => <div key={c} onClick={() => setGarment(c)} style={{ width: 18, height: 18, borderRadius: 4, background: c, border: '1px solid var(--border-2)', cursor: 'pointer' }} />)}
          </div>
          <Check checked={useKnock} onChange={setUseKnock} label="Sin blanco donde el diseño coincide con la prenda" />
          <Slider label="Tolerancia del color de prenda" value={tol} min={1} max={60} onChange={setTol} />
          <Check checked={halftoneBase} onChange={setHalftoneBase} label="Tramar las semitransparencias de la base" />
          {halftoneBase && <Slider label="Frecuencia" value={lpi} min={10} max={60} suffix="LPI" onChange={setLpi} />}
          <div className="section-title">Knockout en el diseño</div>
          <div className="tiny muted">Elimina de la capa activa los píxeles del color de la prenda (p. ej. negros sobre camiseta negra) para que se vea el tejido y el estampado sea más suave.</div>
          <button className="btn sm" onClick={knockDesign}>Aplicar knockout a la capa activa</button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Separaciones ----------
export function SeparationsDialog({ onClose }: { onClose: () => void }) {
  const ab = activeArtboard()!;
  const [planes, setPlanes] = useState<{ key: string; canvas: HTMLCanvasElement }[]>([]);
  const [tac, setTac] = useState<{ overPct: number; max: number } | null>(null);
  useEffect(() => {
    composite(ab, 700).then(({ canvas }) => {
      const img = getImageData(canvas);
      const cmyk = rgbaToCmyk(img.data);
      const tint: Record<string, number[]> = { c: [0, 174, 239], m: [236, 0, 140], y: [255, 242, 0], k: [0, 0, 0] };
      const out: { key: string; canvas: HTMLCanvasElement }[] = (['c', 'm', 'y', 'k'] as const).map((key, ci) => {
        const p = new ImageData(canvas.width, canvas.height);
        for (let j = 0; j < cmyk.length / 4; j++) {
          const v = (cmyk[j * 4 + ci] / 255) * (img.data[j * 4 + 3] / 255);
          p.data[j * 4] = 255 + (tint[key][0] - 255) * v; p.data[j * 4 + 1] = 255 + (tint[key][1] - 255) * v; p.data[j * 4 + 2] = 255 + (tint[key][2] - 255) * v; p.data[j * 4 + 3] = 255;
        }
        return { key, canvas: canvasFromImageData(p) };
      });
      const w = new ImageData(canvas.width, canvas.height);
      for (let j = 0; j < img.data.length; j += 4) { const a = img.data[j + 3]; w.data[j] = w.data[j + 1] = w.data[j + 2] = 255 - a * 0.85; w.data[j + 3] = 255; }
      out.push({ key: 'w', canvas: canvasFromImageData(w) });
      setPlanes(out);
      setTac(tacReport(img.data, cmsState.formula.tac));
    });
  }, []);
  const exportPlates = (fmt: 'png' | 'tiff') => withBusy('Exportando separaciones…', async () => {
    const { canvas } = await composite(ab);
    const img = getImageData(canvas);
    const cmyk = rgbaToCmyk(img.data);
    const n = canvas.width * canvas.height;
    const names = ['C', 'M', 'Y', 'K', 'W'];
    for (let ci = 0; ci < 5; ci++) {
      // placa en escala de grises: negro = 100 % de tinta
      const gray = new Uint8Array(n * 3);
      const rgba = new ImageData(canvas.width, canvas.height);
      for (let j = 0; j < n; j++) {
        const a = img.data[j * 4 + 3] / 255;
        const v = ci < 4 ? (cmyk[j * 4 + ci] / 255) * a : a;
        const g = 255 - v * 255;
        gray[j * 3] = gray[j * 3 + 1] = gray[j * 3 + 2] = g;
        rgba.data[j * 4] = rgba.data[j * 4 + 1] = rgba.data[j * 4 + 2] = g; rgba.data[j * 4 + 3] = 255;
      }
      const base = `${activeDoc()!.name}-${names[ci]}`;
      if (fmt === 'tiff') downloadBlob(new Blob([encodeTiff(gray, canvas.width, canvas.height, 'rgb', ab.dpi)], { type: 'image/tiff' }), `${base}.tif`);
      else {
        const blob = await canvasToBlob(canvasFromImageData(rgba), 'image/png');
        downloadBlob(new Blob([pngSetDpi(new Uint8Array(await blob.arrayBuffer()), ab.dpi)], { type: 'image/png' }), `${base}.png`);
      }
      await new Promise(r => setTimeout(r, 250));
    }
  });
  const label: Record<string, string> = { c: 'Cian', m: 'Magenta', y: 'Amarillo', k: 'Negro', w: 'Blanco (alfa)' };
  return (
    <Modal title="Separación de canales" icon={<Layers size={16} />} onClose={onClose} width={1000} height="84vh"
      footer={<>
        <span className="tiny muted">{hasIcc() ? `Perfil: ${cmsState.profileName}` : 'Conversión por fórmula (GCR/TAC) — carga un perfil ICC para mayor precisión'}</span>
        <div className="spacer" />
        <button className="btn" onClick={() => exportPlates('png')}><Download size={13} />Placas PNG</button>
        <button className="btn" onClick={() => exportPlates('tiff')}><Download size={13} />Placas TIFF</button>
        <button className="btn primary" onClick={() => { onClose(); set({ dialog: { type: 'export', props: { quick: 'tiff-cmyk' } } }); }}>Exportar TIFF CMYK</button>
      </>}>
      {tac && (
        <div className="row">
          <span className={'chip ' + (tac.max > cmsState.formula.tac ? 'warn' : 'ok')}>Cobertura máxima {tac.max.toFixed(0)}%</span>
          <span className={'chip ' + (tac.overPct > 1 ? 'warn' : 'ok')}>{tac.overPct.toFixed(1)}% del diseño supera el TAC de {cmsState.formula.tac}%</span>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {planes.map(p => (
          <div key={p.key} className="col" style={{ gap: 4 }}>
            <span className="small" style={{ fontWeight: 600 }}>{label[p.key]}</span>
            <CanvasPreview canvas={p.canvas} className="preview-box" style={{ height: 220, background: '#fff' }} />
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ---------- Preflight ----------
type Level = 'ok' | 'warn' | 'error' | 'info';
interface CheckItem { level: Level; title: string; detail: string; fix?: { label: string; run: () => void } }

export function PreflightDialog({ onClose }: { onClose: () => void }) {
  const doc = activeDoc()!;
  const [abId, setAbId] = useState(doc.state.activeArtboardId);
  const ab = doc.state.artboards.find(a => a.id === abId)!;
  const [checks, setChecks] = useState<CheckItem[] | null>(null);
  const [thumb, setThumb] = useState<HTMLCanvasElement | null>(null);
  const [minPpi, setMinPpi] = useState(200);

  const run = async () => {
    setChecks(null);
    const s = docState()!;
    const out: CheckItem[] = [];
    const cm = (px: number) => ((px / ab.dpi) * 2.54).toFixed(1);
    out.push({ level: 'info', title: `Tamaño de impresión ${cm(ab.w)} × ${cm(ab.h)} cm`, detail: `${ab.w}×${ab.h} px a ${ab.dpi} ppp` });
    if (ab.dpi < 300) out.push({ level: ab.dpi < 200 ? 'error' : 'warn', title: `Resolución de salida ${ab.dpi} ppp`, detail: 'Para DTF se recomiendan 300 ppp.', fix: { label: 'Remuestrear a 300 ppp', run: () => { A.setActiveArtboard(ab.id); A.imageSize(Math.round((ab.w * 300) / ab.dpi), Math.round((ab.h * 300) / ab.dpi), 300, true); } } });
    else out.push({ level: 'ok', title: `Resolución de salida ${ab.dpi} ppp`, detail: 'Adecuada para DTF.' });
    if (ab.background) out.push({ level: 'warn', title: 'La mesa tiene fondo de color', detail: 'El fondo se imprimirá como tinta. En DTF normalmente debe ser transparente.', fix: { label: 'Hacer transparente', run: () => A.updateArtboard(ab.id, { background: null }, 'Fondo transparente') } });
    const inAb = s.layers.filter(l => l.kind !== 'group' && isEffectivelyVisible(s.layers, l)).filter(l => { const b = layerBounds(l); return b.x < ab.x + ab.w && b.x + b.w > ab.x && b.y < ab.y + ab.h && b.y + b.h > ab.y; });
    if (!inAb.length) out.push({ level: 'error', title: 'La mesa está vacía', detail: 'No hay capas visibles dentro del área de impresión.' });
    for (const l of inAb) {
      const b = layerBounds(l);
      if (l.kind === 'raster') {
        const ppi = ab.dpi / Math.max(Math.abs(l.scaleX), Math.abs(l.scaleY));
        const st = ppiStatus(ppi);
        if (ppi < minPpi) out.push({ level: ppi < 150 ? 'error' : 'warn', title: `«${l.name}»: resolución efectiva ${Math.round(ppi)} ppp`, detail: `${st.text}. A ${cm(b.w)}×${cm(b.h)} cm la imagen puede verse pixelada. Reduce su tamaño o usa un original de más resolución.`,
          fix: { label: `Reducir a ${minPpi} ppp efectivos`, run: () => { const f = ppi / minPpi; A.updateLayer(l.id, ll => ({ scaleX: ll.scaleX * f, scaleY: ll.scaleY * f }), 'Ajustar resolución efectiva'); } } });
      }
      const outside = b.x < ab.x - 0.5 || b.y < ab.y - 0.5 || b.x + b.w > ab.x + ab.w + 0.5 || b.y + b.h > ab.y + ab.h + 0.5;
      const inMargin = !outside && ab.margin > 0 && (b.x < ab.x + ab.margin || b.y < ab.y + ab.margin || b.x + b.w > ab.x + ab.w - ab.margin || b.y + b.h > ab.y + ab.h - ab.margin);
      if (outside) out.push({ level: 'warn', title: `«${l.name}» sale del área de impresión`, detail: 'La parte exterior se recortará al exportar.', fix: { label: 'Encajar en la mesa', run: () => { A.selectLayers([l.id]); const s2 = Math.min((ab.w - ab.margin * 2) / b.w, (ab.h - ab.margin * 2) / b.h, 1); A.updateLayer(l.id, ll => ({ scaleX: ll.scaleX * s2, scaleY: ll.scaleY * s2 }), 'Encajar'); setTimeout(() => { A.alignLayers('hcenter', 'artboard'); A.alignLayers('vcenter', 'artboard'); }, 0); } } });
      else if (inMargin) out.push({ level: 'warn', title: `«${l.name}» invade la zona de seguridad`, detail: `Margen de ${cm(ab.margin)} cm.` });
    }
    const { canvas } = await composite(ab, 1600);
    setThumb(cloneCanvas(canvas));
    const img = getImageData(canvas);
    const st = (await runOp('stats', img)).result;
    const transpPct = (st.transparent / st.total) * 100, semiPct = (st.semi / st.total) * 100;
    if (st.transparent === 0 && !ab.background) out.push({ level: 'warn', title: 'Sin transparencia', detail: 'Toda la superficie es opaca: se imprimirá un rectángulo completo. ¿Falta eliminar el fondo?', fix: { label: 'Eliminar fondo…', run: () => set({ dialog: { type: 'bg-remove' } }) } });
    else out.push({ level: 'ok', title: `Transparencia correcta (${transpPct.toFixed(0)}% transparente)`, detail: 'El PNG conservará el canal alfa.' });
    if (semiPct > 0.5) out.push({ level: semiPct > 5 ? 'warn' : 'info', title: `${semiPct.toFixed(1)}% de píxeles semitransparentes`, detail: 'El DTF no reproduce bien la opacidad parcial: el blanco de base sale irregular. Convierte sombras y degradados en semitonos o limpia el alfa.',
      fix: { label: 'Semitonos…', run: () => set({ dialog: { type: 'halftone' } }) } });
    const tac = tacReport(img.data, cmsState.formula.tac);
    if (tac.overPct > 2) out.push({ level: 'info', title: `Cobertura de tinta alta (máx. ${tac.max.toFixed(0)}%)`, detail: `${tac.overPct.toFixed(1)}% supera el TAC de ${cmsState.formula.tac}%. Puede alargar el secado del film.` });
    const thin = inAb.filter(l => l.kind === 'text' && l.text && l.text.fontSize < ab.dpi * 0.08);
    for (const l of thin) out.push({ level: 'warn', title: `Texto pequeño en «${l.name}»`, detail: 'Menos de ~2 mm de cuerpo: los trazos finos pueden no adherirse.' });
    if (!out.some(c => c.level === 'error' || c.level === 'warn')) out.push({ level: 'ok', title: 'Listo para imprimir', detail: 'Exporta PNG con transparencia a la resolución de la mesa.' });
    setChecks(out);
  };
  useEffect(() => { run(); }, [abId, minPpi]);
  const icon = { ok: <CheckCircle2 size={15} color="var(--ok)" />, warn: <AlertTriangle size={15} color="var(--warn)" />, error: <XCircle size={15} color="var(--danger)" />, info: <Info size={15} color="var(--blue)" /> };
  const counts = checks ? { e: checks.filter(c => c.level === 'error').length, w: checks.filter(c => c.level === 'warn').length } : null;
  return (
    <Modal title="Preparación para impresión DTF" icon={<Printer size={16} />} onClose={onClose} width={960} height="84vh"
      footer={<>
        {counts && <span className={'chip ' + (counts.e ? 'danger' : counts.w ? 'warn' : 'ok')}>{counts.e} errores · {counts.w} avisos</span>}
        <div className="spacer" />
        <button className="btn" onClick={run}>Volver a comprobar</button>
        <button className="btn primary" onClick={() => { A.setActiveArtboard(ab.id); set({ dialog: { type: 'export', props: { quick: 'png' } } }); }}><Download size={13} />Exportar PNG DTF</button>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 14, height: '100%', minHeight: 0 }}>
        <div className="col">
          {doc.state.artboards.length > 1 && <Select value={abId} onChange={setAbId} options={doc.state.artboards.map(a => ({ value: a.id, label: a.name }))} />}
          <CanvasPreview canvas={thumb} className="preview-box checker" style={{ height: 320 }} />
          <Slider label="Resolución efectiva mínima" value={minPpi} min={100} max={300} step={10} suffix="ppp" onChange={setMinPpi} />
        </div>
        <div className="col" style={{ overflowY: 'auto', gap: 6 }}>
          {!checks && <div className="row"><div className="spinner" />Analizando…</div>}
          {checks?.map((c, i) => (
            <div key={i} className="check-item">
              <span className="ic">{icon[c.level]}</span>
              <div className="grow">
                <div className="small" style={{ fontWeight: 600 }}>{c.title}</div>
                <div className="tiny muted">{c.detail}</div>
              </div>
              {c.fix && <button className="btn sm" onClick={() => { c.fix!.run(); setTimeout(run, 350); }}>{c.fix.label}</button>}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
void useMemo; void layerSize;
