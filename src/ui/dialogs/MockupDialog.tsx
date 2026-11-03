import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Shirt, Plus, Trash2, Download, ImagePlus, FilePlus2 } from 'lucide-react';
import { Modal, Slider, Seg, Check, ColorInput, Select, NumberField } from '../components/controls';
import { activeDoc, activeLayer, docState, withBusy, toast } from '../../core/store';
import { renderLayerAlone } from '../../core/render';
import { createCanvas, ctx2d, getImageData, canvasToBlob, downloadBlob, trimCanvas, uid, blobToCanvas, clamp } from '../../core/util';
import { pickFiles } from '../../io/fileOps';
import { sourceFromArtboard, sourcesFromFile, type DesignSource } from '../../io/sources';
import { newDocFromCanvas } from '../../core/actions';

// Lienzo del mockup en unidades fijas; el pecho de la prenda dibujada ocupa CHEST unidades.
const MW = 1000, MH = 1100, CHEST = 540;
type Side = 'front' | 'back';
const COLLAR_Y: Record<Side, number> = { front: 140, back: 92 };

const COLORS = [
  { name: 'Blanco', hex: '#f4f4f2' }, { name: 'Negro', hex: '#1a1a1c' }, { name: 'Gris jaspe', hex: '#9b9ca0' },
  { name: 'Azul marino', hex: '#1e2740' }, { name: 'Royal', hex: '#2a4fb0' }, { name: 'Rojo', hex: '#b3202a' },
  { name: 'Verde militar', hex: '#4a5236' }, { name: 'Arena', hex: '#d9c9a8' }, { name: 'Rosa palo', hex: '#e7bfc0' },
  { name: 'Mostaza', hex: '#d5a021' }, { name: 'Vino', hex: '#5b1a26' }, { name: 'Lila', hex: '#b8a6d9' },
];
const SIZES = [{ value: '40', label: 'Niño (40 cm)' }, { value: '47', label: 'S (47 cm)' }, { value: '51', label: 'M (51 cm)' }, { value: '55', label: 'L (55 cm)' }, { value: '59', label: 'XL (59 cm)' }, { value: '63', label: 'XXL (63 cm)' }];

function shirtPath(side: Side) {
  const p = new Path2D();
  p.moveTo(360, 70);
  p.quadraticCurveTo(500, side === 'front' ? 210 : 115, 640, 70);
  p.lineTo(790, 118); p.quadraticCurveTo(900, 220, 965, 372); p.lineTo(832, 446);
  p.quadraticCurveTo(800, 400, 772, 362);
  p.quadraticCurveTo(768, 700, 778, 1048); p.quadraticCurveTo(500, 1072, 222, 1048);
  p.quadraticCurveTo(232, 700, 228, 362);
  p.quadraticCurveTo(200, 400, 168, 446); p.lineTo(35, 372); p.quadraticCurveTo(100, 220, 210, 118);
  p.closePath();
  return p;
}

/** Mapa de sombreado neutro (blanco = sin sombra) de la prenda dibujada. */
function drawnShading(side: Side) {
  const c = createCanvas(MW, MH), g = ctx2d(c);
  g.fillStyle = '#fff'; g.fillRect(0, 0, MW, MH);
  g.save(); g.clip(shirtPath(side));
  const lg = g.createLinearGradient(220, 0, 780, 0);
  lg.addColorStop(0, 'rgba(0,0,0,.30)'); lg.addColorStop(0.12, 'rgba(0,0,0,.08)'); lg.addColorStop(0.5, 'rgba(0,0,0,0)'); lg.addColorStop(0.88, 'rgba(0,0,0,.08)'); lg.addColorStop(1, 'rgba(0,0,0,.30)');
  g.fillStyle = lg; g.fillRect(0, 0, MW, MH);
  // pliegues suaves
  g.filter = 'blur(18px)';
  g.strokeStyle = 'rgba(0,0,0,.16)'; g.lineWidth = 26;
  for (const [x0, y0, x1, y1] of [[300, 420, 360, 980], [690, 450, 640, 1000], [470, 700, 540, 1040], [240, 160, 300, 360], [760, 160, 700, 360]]) { g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2 + 30, (y0 + y1) / 2, x1, y1); g.stroke(); }
  g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 34;
  for (const [x0, y0, x1, y1] of [[420, 300, 400, 900], [600, 320, 590, 880]]) { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
  g.filter = 'none';
  g.restore();
  return c;
}

function drawGarment(g: CanvasRenderingContext2D, side: Side, color: string, shade: HTMLCanvasElement) {
  const path = shirtPath(side);
  g.save();
  g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 30; g.shadowOffsetY = 12;
  g.fillStyle = color; g.fill(path);
  g.restore();
  g.save(); g.clip(path);
  g.globalCompositeOperation = 'multiply'; g.drawImage(shade, 0, 0);
  g.globalCompositeOperation = 'source-over';
  // cuello acanalado
  g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 24;
  g.beginPath(); g.moveTo(360, 70); g.quadraticCurveTo(500, side === 'front' ? 210 : 115, 640, 70); g.stroke();
  // costuras
  g.setLineDash([6, 6]); g.lineWidth = 2; g.strokeStyle = 'rgba(0,0,0,.25)';
  g.beginPath(); g.moveTo(230, 1020); g.quadraticCurveTo(500, 1044, 770, 1020); g.stroke();
  g.beginPath(); g.moveTo(178, 425); g.lineTo(52, 356); g.stroke();
  g.beginPath(); g.moveTo(822, 425); g.lineTo(948, 356); g.stroke();
  g.setLineDash([]);
  g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(210, 118); g.quadraticCurveTo(240, 250, 228, 362); g.stroke();
  g.beginPath(); g.moveTo(790, 118); g.quadraticCurveTo(760, 250, 772, 362); g.stroke();
  g.restore();
}

/** Mapa de sombreado a partir de una foto: luminancia relativa a la media de la prenda. */
function photoShading(photo: HTMLCanvasElement) {
  const img = getImageData(photo), d = img.data;
  let sum = 0, n = 0;
  const cx0 = photo.width * 0.3, cx1 = photo.width * 0.7, cy0 = photo.height * 0.3, cy1 = photo.height * 0.7;
  for (let y = Math.floor(cy0); y < cy1; y += 2) for (let x = Math.floor(cx0); x < cx1; x += 2) { const i = (y * photo.width + x) * 4; sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; n++; }
  const mean = Math.max(8, sum / Math.max(1, n));
  const out = new ImageData(photo.width, photo.height);
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = clamp((l / mean) * 235, 0, 255);
    out.data[i] = out.data[i + 1] = out.data[i + 2] = v; out.data[i + 3] = 255;
  }
  const c = createCanvas(photo.width, photo.height); ctx2d(c).putImageData(out, 0, 0);
  return c;
}

interface Print { id: string; src: DesignSource; side: Side; widthCm: number; dx: number; dy: number; rotation: number }
interface Photo { canvas: HTMLCanvasElement; shade: HTMLCanvasElement; widthCm: number; collarPct: number }

export function MockupDialog({ onClose }: { onClose: () => void }) {
  const [color, setColor] = useState(COLORS[1].hex);
  const [side, setSide] = useState<Side>('front');
  const [chest, setChest] = useState('51');
  const [prints, setPrints] = useState<Print[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [realism, setRealism] = useState(70);
  const [noUnderbase, setNoUnderbase] = useState(false);
  const [layout, setLayout] = useState<'single' | 'sides' | 'colors'>('single');
  const [compareColors, setCompareColors] = useState<string[]>([COLORS[0].hex, COLORS[1].hex, COLORS[3].hex, COLORS[5].hex]);
  const [photos, setPhotos] = useState<Partial<Record<Side, Photo>>>({});
  const [usePhoto, setUsePhoto] = useState(false);
  const cv = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ id: string; x: number; y: number; dx: number; dy: number } | null>(null);
  const shades = useMemo(() => ({ front: drawnShading('front'), back: drawnShading('back') }), []);
  const sel = prints.find(p => p.id === selId) ?? null;

  const addSource = (src: DesignSource, s: Side = side) => {
    const wCm = Math.min((src.canvas.width / src.dpi) * 2.54, Number(chest) * 0.85);
    const p: Print = { id: uid('pr'), src, side: s, widthCm: +wCm.toFixed(1), dx: 0, dy: s === 'front' ? 8 : 10, rotation: 0 };
    setPrints(ps => [...ps, p]); setSelId(p.id);
  };
  const addArtboard = () => withBusy('Preparando diseño…', async () => {
    const d = activeDoc(); if (!d) return;
    const ab = d.state.artboards.find(a => a.id === d.state.activeArtboardId)!;
    const s = await sourceFromArtboard(d.state, ab, ab.name);
    if (s) addSource(s); else toast('La mesa activa está vacía', 'warn');
  });
  const addLayer = () => withBusy('Preparando capa…', async () => {
    const l = activeLayer(), st = docState(), d = activeDoc();
    if (!l || !st || !d) return toast('Selecciona una capa', 'warn');
    const { canvas } = await renderLayerAlone(st, l, 1);
    const t = trimCanvas(canvas);
    const ab = d.state.artboards.find(a => a.id === d.state.activeArtboardId)!;
    if (t) addSource({ id: uid('src'), name: l.name, canvas: t.canvas, dpi: ab.dpi });
  });
  const addFile = async () => {
    const [f] = await pickFiles(false); if (!f) return;
    await withBusy('Importando…', async () => { const [s] = await sourcesFromFile(f); if (s) addSource(s); });
  };
  const uploadPhoto = async () => {
    const [f] = await pickFiles(false, 'image/*'); if (!f) return;
    const c = await blobToCanvas(f);
    setPhotos(ph => ({ ...ph, [side]: { canvas: c, shade: photoShading(c), widthCm: 70, collarPct: 12 } }));
    setUsePhoto(true);
  };
  useEffect(() => { if (activeDoc()) addArtboard(); }, []);
  const patch = (id: string, p: Partial<Print>) => setPrints(ps => ps.map(x => (x.id === id ? { ...x, ...p } : x)));

  // geometría: unidades del mockup por cm y origen (centro del cuello)
  const geom = (s: Side) => {
    const ph = usePhoto ? photos[s] : undefined;
    if (ph) {
      const k = Math.min(MW / ph.canvas.width, MH / ph.canvas.height);
      const w = ph.canvas.width * k, h = ph.canvas.height * k;
      const ox = (MW - w) / 2, oy = (MH - h) / 2;
      return { upc: w / ph.widthCm, cx: MW / 2, cy: oy + (h * ph.collarPct) / 100, photo: { ph, x: ox, y: oy, w, h } };
    }
    return { upc: CHEST / Number(chest), cx: MW / 2, cy: COLLAR_Y[s], photo: null };
  };
  const printRect = (p: Print) => {
    const gm = geom(p.side);
    const w = p.widthCm * gm.upc, h = (w * p.src.canvas.height) / p.src.canvas.width;
    return { cx: gm.cx + p.dx * gm.upc, cy: gm.cy + p.dy * gm.upc + h / 2, w, h };
  };

  const renderMock = (s: Side, col: string, showSel: boolean) => {
    const c = createCanvas(MW, MH), g = ctx2d(c);
    const gm = geom(s);
    let shade: HTMLCanvasElement;
    if (gm.photo) {
      g.drawImage(gm.photo.ph.canvas, gm.photo.x, gm.photo.y, gm.photo.w, gm.photo.h);
      shade = createCanvas(MW, MH); const sg = ctx2d(shade); sg.fillStyle = '#fff'; sg.fillRect(0, 0, MW, MH);
      sg.drawImage(gm.photo.ph.shade, gm.photo.x, gm.photo.y, gm.photo.w, gm.photo.h);
    } else { drawGarment(g, s, col, shades[s]); shade = shades[s]; }
    for (const p of prints.filter(x => x.side === s)) {
      const r = printRect(p);
      // estampado en su propio lienzo para sombrearlo sin tocar la prenda
      const pc = createCanvas(MW, MH), pg = ctx2d(pc);
      pg.translate(r.cx, r.cy); pg.rotate((p.rotation * Math.PI) / 180);
      pg.drawImage(p.src.canvas, -r.w / 2, -r.h / 2, r.w, r.h);
      pg.setTransform(1, 0, 0, 1, 0, 0);
      if (realism > 0) {
        const tmp = createCanvas(MW, MH), tg = ctx2d(tmp);
        tg.drawImage(pc, 0, 0);
        tg.globalCompositeOperation = 'multiply'; tg.globalAlpha = realism / 100; tg.drawImage(shade, 0, 0);
        tg.globalAlpha = 1; tg.globalCompositeOperation = 'destination-in'; tg.drawImage(pc, 0, 0);
        pg.clearRect(0, 0, MW, MH); pg.drawImage(tmp, 0, 0);
      }
      g.save();
      if (noUnderbase) g.globalCompositeOperation = 'multiply';
      g.drawImage(pc, 0, 0);
      g.restore();
      if (showSel && p.id === selId) {
        g.save(); g.translate(r.cx, r.cy); g.rotate((p.rotation * Math.PI) / 180);
        g.strokeStyle = '#d7f25c'; g.setLineDash([8, 6]); g.lineWidth = 2; g.strokeRect(-r.w / 2, -r.h / 2, r.w, r.h);
        g.restore();
      }
    }
    return c;
  };

  const composition = (showSel: boolean) => {
    if (layout === 'single') return renderMock(side, color, showSel);
    const list = layout === 'sides' ? [renderMock('front', color, showSel), renderMock('back', color, showSel)] : compareColors.map(c => renderMock(side, c, false));
    const cols = list.length <= 2 ? list.length : 2, rows = Math.ceil(list.length / cols);
    const out = createCanvas(MW * cols, MH * rows), g = ctx2d(out);
    list.forEach((c, i) => g.drawImage(c, (i % cols) * MW, Math.floor(i / cols) * MH));
    return out;
  };

  useEffect(() => {
    const c = cv.current; if (!c) return;
    const src = composition(true);
    c.width = src.width; c.height = src.height;
    ctx2d(c).drawImage(src, 0, 0);
  }, [prints, selId, color, side, chest, realism, noUnderbase, layout, compareColors, photos, usePhoto]);

  // interacción: arrastrar para mover, rueda para escalar (solo vista individual)
  const toMock = (e: React.PointerEvent | React.WheelEvent) => {
    const r = cv.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * MW, y: ((e.clientY - r.top) / r.height) * MH };
  };
  const hit = (x: number, y: number) => {
    const list = prints.filter(p => p.side === side);
    for (let i = list.length - 1; i >= 0; i--) {
      const r = printRect(list[i]);
      const a = (-list[i].rotation * Math.PI) / 180, lx = (x - r.cx) * Math.cos(a) - (y - r.cy) * Math.sin(a), ly = (x - r.cx) * Math.sin(a) + (y - r.cy) * Math.cos(a);
      if (Math.abs(lx) <= r.w / 2 && Math.abs(ly) <= r.h / 2) return list[i];
    }
    return null;
  };
  const onDown = (e: React.PointerEvent) => {
    if (layout !== 'single') return;
    const m = toMock(e), p = hit(m.x, m.y);
    setSelId(p?.id ?? null);
    if (p) { drag.current = { id: p.id, x: m.x, y: m.y, dx: p.dx, dy: p.dy }; (e.target as Element).setPointerCapture(e.pointerId); }
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const m = toMock(e), upc = geom(side).upc;
    let dx = d.dx + (m.x - d.x) / upc;
    if (Math.abs(dx) < 0.4 && !e.altKey) dx = 0; // imán al centro
    patch(d.id, { dx: +dx.toFixed(2), dy: +(d.dy + (m.y - d.y) / upc).toFixed(2) });
  };
  const onWheel = (e: React.WheelEvent) => {
    if (layout !== 'single' || !sel) return;
    patch(sel.id, { widthCm: +clamp(sel.widthCm * (e.deltaY < 0 ? 1.04 : 1 / 1.04), 1, 80).toFixed(1) });
  };

  const exportPng = () => withBusy('Exportando mockup…', async () => {
    downloadBlob(await canvasToBlob(composition(false), 'image/png'), `${activeDoc()?.name ?? 'kova'}-mockup.png`);
  });
  const openAsDoc = () => withBusy('Creando documento…', async () => { await newDocFromCanvas(composition(false), 'Mockup', 150); onClose(); });
  const ph = photos[side];

  return (
    <Modal title="Mockup en prenda" icon={<Shirt size={16} />} onClose={onClose} width={1180} height="90vh"
      footer={<>
        <span className="tiny muted">Arrastra el estampado para moverlo · rueda para escalar · Alt desactiva el imán al centro</span>
        <div className="spacer" />
        <button className="btn" onClick={openAsDoc}><FilePlus2 size={13} />Abrir como documento</button>
        <button className="btn primary" onClick={exportPng}><Download size={13} />Exportar PNG</button>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr 270px', gap: 14, height: '100%', minHeight: 0 }}>
        <div className="col" style={{ overflowY: 'auto', gap: 10 }}>
          <div className="section-title">Prenda</div>
          <Seg value={side} onChange={setSide} full options={[{ value: 'front', label: 'Delantera' }, { value: 'back', label: 'Espalda' }]} />
          <div className="row" style={{ flexWrap: 'wrap', gap: 5 }}>
            {COLORS.map(c => <div key={c.hex} title={c.name} onClick={() => { setColor(c.hex); setUsePhoto(false); }} style={{ width: 24, height: 24, borderRadius: 6, background: c.hex, cursor: 'pointer', border: color === c.hex && !usePhoto ? '2px solid var(--accent)' : '1px solid var(--border-2)' }} />)}
          </div>
          <div className="row"><span className="label">Personalizado</span><ColorInput value={color} onChange={v => { setColor(v); setUsePhoto(false); }} /></div>
          <div className="row"><span className="label">Talla</span><Select value={chest} onChange={setChest} options={SIZES} /></div>
          <div className="tiny muted">Ancho de pecho de la talla: el diseño se muestra a su tamaño físico real.</div>
          <div className="section-title">Foto propia</div>
          <button className="btn sm" onClick={uploadPhoto}><ImagePlus size={12} />Subir foto ({side === 'front' ? 'delantera' : 'espalda'})</button>
          {ph && <>
            <Check checked={usePhoto} onChange={setUsePhoto} label="Usar la foto" />
            <div className="row"><span className="label">Ancho foto</span><NumberField value={ph.widthCm} onChange={v => setPhotos(p => ({ ...p, [side]: { ...ph, widthCm: v } }))} min={10} max={300} digits={0} suffix="cm" /></div>
            <Slider label="Altura del cuello" value={ph.collarPct} min={0} max={60} suffix="%" onChange={v => setPhotos(p => ({ ...p, [side]: { ...ph, collarPct: v } }))} />
            <div className="tiny muted">Indica cuánto mide de ancho lo que se ve en la foto para que la escala sea real.</div>
          </>}
          <div className="section-title">Realismo</div>
          <Slider label="Pliegues y luz de la tela" value={realism} min={0} max={100} suffix="%" onChange={setRealism} />
          <Check checked={noUnderbase} onChange={setNoUnderbase} label="Simular sin base blanca" />
        </div>
        <div className="col" style={{ minHeight: 0 }}>
          <Seg value={layout} onChange={setLayout} options={[{ value: 'single', label: 'Individual' }, { value: 'sides', label: 'Delantera + espalda' }, { value: 'colors', label: 'Comparar colores' }]} />
          <div className="preview-box" style={{ flex: 1, minHeight: 0, background: '#e9e9ec' }}>
            <canvas ref={cv} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (drag.current = null)} onWheel={onWheel}
              style={{ maxWidth: '100%', maxHeight: '100%', cursor: layout === 'single' ? 'move' : 'default', touchAction: 'none' }} />
          </div>
          {layout === 'colors' && (
            <div className="row" style={{ gap: 5, flexWrap: 'wrap' }}>
              <span className="tiny muted">Colores a comparar:</span>
              {COLORS.map(c => {
                const on = compareColors.includes(c.hex);
                return <div key={c.hex} title={c.name} onClick={() => setCompareColors(cs => (on ? cs.filter(x => x !== c.hex) : cs.length < 6 ? [...cs, c.hex] : cs))} style={{ width: 20, height: 20, borderRadius: 5, background: c.hex, cursor: 'pointer', border: on ? '2px solid var(--accent)' : '1px solid var(--border-2)' }} />;
              })}
            </div>
          )}
        </div>
        <div className="col" style={{ overflowY: 'auto', gap: 10 }}>
          <div className="section-title">Estampados</div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
            <button className="btn sm" onClick={addArtboard} disabled={!activeDoc()}><Plus size={12} />Mesa</button>
            <button className="btn sm" onClick={addLayer} disabled={!activeDoc()}><Plus size={12} />Capa</button>
            <button className="btn sm" onClick={addFile}><Plus size={12} />Archivo</button>
          </div>
          {prints.map(p => (
            <div key={p.id} className="check-item" style={{ alignItems: 'center', cursor: 'pointer', borderColor: p.id === selId ? 'var(--accent)' : undefined }} onClick={() => { setSelId(p.id); setSide(p.side); }}>
              <img src={p.src.canvas.toDataURL()} className="checker-dark" style={{ width: 36, height: 36, objectFit: 'contain', borderRadius: 6 }} />
              <div className="grow">
                <div className="small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.src.name}</div>
                <div className="tiny muted">{p.side === 'front' ? 'Delantera' : 'Espalda'} · {p.widthCm} cm</div>
              </div>
              <button className="icon-btn sm" onClick={e => { e.stopPropagation(); setPrints(ps => ps.filter(x => x.id !== p.id)); }}><Trash2 size={13} /></button>
            </div>
          ))}
          {sel && <>
            <div className="section-title">Colocación</div>
            <Seg value={sel.side} onChange={v => { patch(sel.id, { side: v }); setSide(v); }} full options={[{ value: 'front', label: 'Delantera' }, { value: 'back', label: 'Espalda' }]} />
            <div className="row"><span className="label">Ancho</span><NumberField value={sel.widthCm} onChange={v => patch(sel.id, { widthCm: v })} min={1} max={80} digits={1} suffix="cm" /></div>
            <div className="row"><span className="label">Alto</span><span className="small">{((sel.widthCm * sel.src.canvas.height) / sel.src.canvas.width).toFixed(1)} cm</span></div>
            <div className="row"><span className="label">Desde cuello</span><NumberField value={sel.dy} onChange={v => patch(sel.id, { dy: v })} min={-10} max={80} digits={1} suffix="cm" /></div>
            <div className="row"><span className="label">Desde centro</span><NumberField value={sel.dx} onChange={v => patch(sel.id, { dx: v })} min={-40} max={40} digits={1} suffix="cm" /></div>
            <Slider label="Rotación" value={sel.rotation} min={-45} max={45} suffix="°" onChange={v => patch(sel.id, { rotation: v })} />
            <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
              {[{ l: 'Pecho centro', w: 28, dx: 0, dy: 8 }, { l: 'Bolsillo izq.', w: 9, dx: 10, dy: 7 }, { l: 'Espalda', w: 30, dx: 0, dy: 10, s: 'back' as Side }, { l: 'Nuca', w: 8, dx: 0, dy: 3, s: 'back' as Side }].map(pr => (
                <button key={pr.l} className="chip" style={{ cursor: 'pointer' }} onClick={() => { const s = pr.s ?? 'front'; patch(sel.id, { widthCm: pr.w, dx: pr.dx, dy: pr.dy, side: s }); setSide(s); }}>{pr.l}</button>
              ))}
            </div>
            {sel.src.canvas.width / (sel.widthCm / 2.54) < 200 && <span className="chip warn">{Math.round(sel.src.canvas.width / (sel.widthCm / 2.54))} ppp efectivos a este tamaño</span>}
          </>}
        </div>
      </div>
    </Modal>
  );
}
