import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutGrid, Plus, Trash2, FilePlus2, RotateCw, AlertTriangle } from 'lucide-react';
import { Modal, NumberField, Check, Select } from '../components/controls';
import { get, activeDoc, withBusy, toast } from '../../core/store';
import { newDoc, newArtboard, rasterLayer } from '../../core/doc';
import { addDoc } from '../../core/actions';
import { createCanvas, ctx2d } from '../../core/util';
import { pickFiles } from '../../io/fileOps';
import { sourceFromArtboard, sourcesFromFile, type DesignSource } from '../../io/sources';
import type { Layer } from '../../core/types';

// ---------- empaquetado MaxRects (bottom-left) ----------
interface R { x: number; y: number; w: number; h: number }
interface Placed { item: number; x: number; y: number; w: number; h: number; rot: boolean }

class MaxRects {
  free: R[];
  constructor(public w: number, public h: number) { this.free = [{ x: 0, y: 0, w, h }]; }
  find(w: number, h: number, rot: boolean): { x: number; y: number; rot: boolean } | null {
    let best: { x: number; y: number; rot: boolean } | null = null, by = Infinity, bx = Infinity;
    const test = (ww: number, hh: number, r: boolean) => {
      for (const f of this.free) {
        if (ww <= f.w + 1e-6 && hh <= f.h + 1e-6) {
          const top = f.y + hh;
          if (top < by || (top === by && f.x < bx)) { by = top; bx = f.x; best = { x: f.x, y: f.y, rot: r }; }
        }
      }
    };
    test(w, h, false);
    if (rot && w !== h) test(h, w, true);
    return best;
  }
  place(r: R) {
    const next: R[] = [];
    for (const f of this.free) {
      if (r.x >= f.x + f.w || r.x + r.w <= f.x || r.y >= f.y + f.h || r.y + r.h <= f.y) { next.push(f); continue; }
      if (r.x > f.x) next.push({ x: f.x, y: f.y, w: r.x - f.x, h: f.h });
      if (r.x + r.w < f.x + f.w) next.push({ x: r.x + r.w, y: f.y, w: f.x + f.w - r.x - r.w, h: f.h });
      if (r.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: r.y - f.y });
      if (r.y + r.h < f.y + f.h) next.push({ x: f.x, y: r.y + r.h, w: f.w, h: f.y + f.h - r.y - r.h });
    }
    // eliminar rectángulos contenidos en otros
    this.free = next.filter((a, i) => !next.some((b, j) => j !== i && a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h && (j < i || a.w !== b.w || a.h !== b.h || a.x !== b.x || a.y !== b.y)));
  }
}

interface Item extends DesignSource { copies: number; widthCm: number }
interface Sheet { placed: Placed[]; usedH: number }

function pack(items: Item[], sheetW: number, maxH: number, spacing: number, margin: number, rotate: boolean, dpi: number) {
  const cmPx = (cm: number) => (cm / 2.54) * dpi;
  const binW = sheetW - margin * 2 + spacing, binH = maxH - margin * 2 + spacing;
  const list: { item: number; w: number; h: number }[] = [];
  items.forEach((it, i) => {
    const w = cmPx(it.widthCm), h = (w * it.canvas.height) / it.canvas.width;
    for (let c = 0; c < it.copies; c++) list.push({ item: i, w, h });
  });
  list.sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h);
  const sheets: Sheet[] = [];
  const bins: MaxRects[] = [];
  const tooBig = new Set<number>();
  for (const e of list) {
    const ww = e.w + spacing, hh = e.h + spacing;
    if ((ww > binW || hh > binH) && (!rotate || hh > binW || ww > binH)) { tooBig.add(e.item); continue; }
    let k = 0, spot: ReturnType<MaxRects['find']> = null;
    for (; k < bins.length; k++) { spot = bins[k].find(ww, hh, rotate); if (spot) break; }
    if (!spot) { bins.push(new MaxRects(binW, binH)); sheets.push({ placed: [], usedH: 0 }); k = bins.length - 1; spot = bins[k].find(ww, hh, rotate)!; }
    const pw = spot.rot ? hh : ww, ph = spot.rot ? ww : hh;
    bins[k].place({ x: spot.x, y: spot.y, w: pw, h: ph });
    const p: Placed = { item: e.item, x: margin + spot.x, y: margin + spot.y, w: pw - spacing, h: ph - spacing, rot: spot.rot };
    sheets[k].placed.push(p);
    sheets[k].usedH = Math.max(sheets[k].usedH, p.y + p.h + margin);
  }
  return { sheets, tooBig };
}

const WIDTHS = [
  { value: '30', label: '30 cm' }, { value: '33', label: '33 cm (A3+)' }, { value: '55', label: '55 cm' },
  { value: '56', label: '56 cm' }, { value: '58', label: '58 cm' }, { value: '60', label: '60 cm' }, { value: 'custom', label: 'Personalizado' },
];

export function GangSheetDialog({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [widthSel, setWidthSel] = useState('58');
  const [customW, setCustomW] = useState(58);
  const [maxLen, setMaxLen] = useState(100);
  const [spacingMm, setSpacingMm] = useState(5);
  const [marginMm, setMarginMm] = useState(5);
  const [rotate, setRotate] = useState(true);
  const [trimLen, setTrimLen] = useState(true);
  const [dpi, setDpi] = useState(300);
  const [price, setPrice] = useState(0);
  const [sheetIdx, setSheetIdx] = useState(0);
  const cv = useRef<HTMLCanvasElement>(null);
  const sheetCm = widthSel === 'custom' ? customW : Number(widthSel);
  const px = (cm: number) => (cm / 2.54) * dpi;

  const addSources = (srcs: DesignSource[]) => setItems(it => [...it, ...srcs.map(s => ({ ...s, copies: 1, widthCm: +((s.canvas.width / s.dpi) * 2.54).toFixed(2) }))]);
  const addActive = () => withBusy('Preparando diseño…', async () => {
    const d = activeDoc(); if (!d) return;
    const ab = d.state.artboards.find(a => a.id === d.state.activeArtboardId)!;
    const s = await sourceFromArtboard(d.state, ab, `${d.name} · ${ab.name}`);
    if (s) addSources([s]); else toast('La mesa activa está vacía', 'warn');
  });
  const addAllOpen = () => withBusy('Preparando diseños…', async () => {
    const out: DesignSource[] = [];
    for (const d of get().docs) for (const ab of d.state.artboards) { const s = await sourceFromArtboard(d.state, ab, `${d.name} · ${ab.name}`); if (s) out.push(s); }
    addSources(out);
  });
  const addFiles = async () => {
    const files = await pickFiles(true);
    if (!files.length) return;
    await withBusy('Importando…', async () => { for (const f of files) addSources(await sourcesFromFile(f)); });
  };
  useEffect(() => { if (activeDoc()) addActive(); }, []);

  const result = useMemo(() => pack(items, px(sheetCm), px(maxLen), px(spacingMm / 10), px(marginMm / 10), rotate, dpi), [items, sheetCm, maxLen, spacingMm, marginMm, rotate, dpi]);
  const sheets = result.sheets;
  const cur = sheets[Math.min(sheetIdx, sheets.length - 1)];
  const sheetH = (s: Sheet) => (trimLen ? Math.min(px(maxLen), Math.ceil(s.usedH / px(1)) * px(1)) : px(maxLen));
  const totals = useMemo(() => {
    let area = 0, len = 0;
    for (const s of sheets) { len += sheetH(s); for (const p of s.placed) area += p.w * p.h; }
    const sheetArea = px(sheetCm) * len;
    return { lenCm: (len / dpi) * 2.54, usage: sheetArea ? (area / sheetArea) * 100 : 0, count: sheets.reduce((n, s) => n + s.placed.length, 0) };
  }, [sheets, trimLen]);

  useEffect(() => {
    const c = cv.current; if (!c) return;
    const box = c.parentElement!.getBoundingClientRect();
    const W = px(sheetCm), H = cur ? sheetH(cur) : px(maxLen);
    const k = Math.min((box.width - 20) / W, (box.height - 20) / H);
    c.width = Math.max(1, Math.round(W * k)); c.height = Math.max(1, Math.round(H * k));
    const g = ctx2d(c);
    g.clearRect(0, 0, c.width, c.height);
    const m = px(marginMm / 10) * k;
    g.strokeStyle = 'rgba(90,149,255,.6)'; g.setLineDash([4, 4]); g.strokeRect(m, m, c.width - 2 * m, c.height - 2 * m); g.setLineDash([]);
    if (!cur) return;
    for (const p of cur.placed) {
      const it = items[p.item];
      g.save();
      g.translate((p.x + p.w / 2) * k, (p.y + p.h / 2) * k);
      if (p.rot) g.rotate(Math.PI / 2);
      const dw = (p.rot ? p.h : p.w) * k, dh = (p.rot ? p.w : p.h) * k;
      g.drawImage(it.canvas, -dw / 2, -dh / 2, dw, dh);
      g.restore();
      g.strokeStyle = 'rgba(215,242,92,.55)'; g.strokeRect(p.x * k + 0.5, p.y * k + 0.5, p.w * k, p.h * k);
    }
  }, [cur, items, sheetCm, maxLen, marginMm, trimLen, dpi]);

  const create = () => {
    if (!sheets.length) return toast('Añade al menos un diseño', 'warn');
    const W = Math.round(px(sheetCm));
    const d = newDoc(`Hoja DTF ${sheetCm} cm`, W, Math.round(sheetH(sheets[0])), dpi);
    const gap = px(10);
    const artboards = sheets.map((s, i) => (i === 0 ? { ...d.state.artboards[0], name: 'Hoja 1', margin: Math.round(px(marginMm / 10)) } : { ...newArtboard(W, sheetH(s), dpi, `Hoja ${i + 1}`, i * (W + gap), 0), margin: Math.round(px(marginMm / 10)) }));
    const layers: Layer[] = [];
    sheets.forEach((s, i) => {
      const ab = artboards[i];
      s.placed.forEach((p, n) => {
        const it = items[p.item];
        const tw = p.rot ? p.h : p.w;
        const scale = tw / it.canvas.width;
        const cx = ab.x + p.x + p.w / 2, cy = ab.y + p.y + p.h / 2;
        layers.push({ ...rasterLayer(it.canvas, `${it.name} ${n + 1}`), x: cx - it.canvas.width / 2, y: cy - it.canvas.height / 2, scaleX: scale, scaleY: scale, rotation: p.rot ? 90 : 0 });
      });
    });
    d.state = { ...d.state, artboards, layers, selectedLayerIds: [] };
    addDoc(d);
    toast(`Hoja creada: ${totals.count} diseños en ${sheets.length} hoja(s)`, 'ok');
    onClose();
  };

  const setItem = (i: number, patch: Partial<Item>) => setItems(it => it.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <Modal title="Hoja de impresión DTF (gang sheet)" icon={<LayoutGrid size={16} />} onClose={onClose} width={1120} height="88vh"
      footer={<>
        <span className="chip accent">{totals.count} diseños · {sheets.length} hoja(s)</span>
        <span className="chip">{totals.lenCm.toFixed(1)} cm de film</span>
        <span className={'chip ' + (totals.usage > 70 ? 'ok' : totals.usage > 45 ? '' : 'warn')}>Aprovechamiento {totals.usage.toFixed(0)}%</span>
        {price > 0 && <span className="chip">Coste ≈ {((totals.lenCm / 100) * price).toFixed(2)}</span>}
        <div className="spacer" />
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={!totals.count} onClick={create}><FilePlus2 size={13} />Crear documento de hoja</button>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr 250px', gap: 14, height: '100%', minHeight: 0 }}>
        <div className="col" style={{ minHeight: 0 }}>
          <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
            <button className="btn sm" onClick={addActive} disabled={!activeDoc()}><Plus size={12} />Mesa activa</button>
            <button className="btn sm" onClick={addAllOpen}><Plus size={12} />Todos los abiertos</button>
            <button className="btn sm" onClick={addFiles}><Plus size={12} />Archivos…</button>
          </div>
          <div className="col" style={{ overflowY: 'auto', gap: 6, flex: 1 }}>
            {!items.length && <div className="tiny muted">Añade diseños desde las mesas abiertas o desde archivos (PNG, PSD, SVG, PDF, TIFF, .kova).</div>}
            {items.map((it, i) => {
              const ppi = it.canvas.width / (it.widthCm / 2.54);
              return (
                <div key={it.id} className="check-item" style={{ alignItems: 'center' }}>
                  <img src={it.canvas.toDataURL()} className="checker-dark" style={{ width: 44, height: 44, objectFit: 'contain', borderRadius: 6 }} />
                  <div className="grow col" style={{ gap: 4, minWidth: 0 }}>
                    <div className="small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</div>
                    <div className="row" style={{ gap: 4 }}>
                      <NumberField value={it.widthCm} onChange={v => setItem(i, { widthCm: Math.max(0.5, v) })} min={0.5} max={500} digits={1} suffix="cm" width={78} />
                      <span className="tiny muted">× {((it.widthCm * it.canvas.height) / it.canvas.width).toFixed(1)}</span>
                      <NumberField value={it.copies} onChange={v => setItem(i, { copies: Math.max(1, Math.round(v)) })} min={1} max={999} digits={0} suffix="uds" width={66} />
                    </div>
                    {ppi < 200 && <span className="tiny" style={{ color: 'var(--warn)' }}><AlertTriangle size={10} /> {Math.round(ppi)} ppp efectivos</span>}
                    {result.tooBig.has(i) && <span className="tiny" style={{ color: 'var(--danger)' }}>No cabe en el ancho de la hoja</span>}
                  </div>
                  <button className="icon-btn" title="Quitar" onClick={() => setItems(x => x.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
                </div>
              );
            })}
          </div>
        </div>
        <div className="col" style={{ minHeight: 0 }}>
          {sheets.length > 1 && <div className="row" style={{ gap: 4 }}>{sheets.map((_, i) => <button key={i} className={'chip' + (i === sheetIdx ? ' accent' : '')} style={{ cursor: 'pointer' }} onClick={() => setSheetIdx(i)}>Hoja {i + 1}</button>)}</div>}
          <div className="preview-box checker-dark" style={{ flex: 1, minHeight: 0 }}><canvas ref={cv} style={{ background: 'rgba(255,255,255,.04)', boxShadow: '0 0 0 1px var(--border-2)' }} /></div>
        </div>
        <div className="col" style={{ overflowY: 'auto', gap: 10 }}>
          <div className="section-title">Film</div>
          <div className="row"><span className="label">Ancho</span><Select value={widthSel} onChange={setWidthSel} options={WIDTHS} /></div>
          {widthSel === 'custom' && <div className="row"><span className="label" /><NumberField value={customW} onChange={setCustomW} min={5} max={200} digits={1} suffix="cm" /></div>}
          <div className="row"><span className="label">Largo máx.</span><NumberField value={maxLen} onChange={setMaxLen} min={10} max={2000} digits={0} suffix="cm" /></div>
          <div className="row"><span className="label">Resolución</span><NumberField value={dpi} onChange={setDpi} min={150} max={600} digits={0} suffix="ppp" /></div>
          <Check checked={trimLen} onChange={setTrimLen} label="Recortar el largo al contenido" />
          <div className="section-title">Distribución</div>
          <div className="row"><span className="label">Separación</span><NumberField value={spacingMm} onChange={setSpacingMm} min={0} max={50} digits={1} suffix="mm" /></div>
          <div className="row"><span className="label">Márgenes</span><NumberField value={marginMm} onChange={setMarginMm} min={0} max={50} digits={1} suffix="mm" /></div>
          <Check checked={rotate} onChange={setRotate} label={<><RotateCw size={12} /> Permitir rotar 90°</>} />
          <div className="section-title">Coste</div>
          <div className="row"><span className="label">Precio / m</span><NumberField value={price} onChange={setPrice} min={0} max={1e6} digits={2} /></div>
          <div className="tiny muted">El acomodo usa MaxRects (inferior-izquierda): coloca primero los diseños grandes y rellena huecos con los pequeños. Si un diseño no cabe en el largo máximo se abre otra hoja.</div>
        </div>
      </div>
    </Modal>
  );
}
