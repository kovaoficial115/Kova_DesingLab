import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Plus, X, RotateCcw } from 'lucide-react';
import { useStore, setBrush, toast } from '../../core/store';
import { NumberField, Slider, Check } from './controls';
import {
  listBrushImages, getBrushImage, addBrushImage, removeBrushImage, loadBrushLibrary, onBrushLibrary, brushLibraryVersion,
  makeStamp, makeTextureMask, dabPositions, defaultBrushes, type BrushImage, type BrushSettings, type BrushToolId,
} from '../../engine/brush';
import { ctx2d } from '../../core/util';

const useLibrary = () => useSyncExternalStore(onBrushLibrary, brushLibraryVersion);

/** Miniatura de una punta o textura (blanco sobre el fondo del panel). */
function Thumb({ img, size = 34 }: { img: BrushImage; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = c.height = Math.round(size * dpr);
    const g = ctx2d(c);
    g.clearRect(0, 0, c.width, c.height);
    g.imageSmoothingQuality = 'high';
    const src = img.canvas, k = Math.min(c.width / src.width, c.height / src.height) * (img.kind === 'tip' ? 0.86 : 1);
    const w = src.width * k, h = src.height * k;
    if (img.kind === 'texture') { g.drawImage(src, 0, 0, c.width, c.height); return; }
    g.drawImage(src, (c.width - w) / 2, (c.height - h) / 2, w, h);
  }, [img, size]);
  return <canvas ref={ref} style={{ width: size, height: size }} aria-hidden />;
}

/** Trazo de muestra con los ajustes actuales. */
function Preview({ b }: { b: BrushSettings }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const lib = useLibrary();
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const W = 268, H = 64;
    c.width = W * dpr; c.height = H * dpr;
    const g = ctx2d(c);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    // muestra a un tamaño que quepa, con las mismas proporciones de separación, giro y textura
    const d = Math.min(36, Math.max(6, b.size));
    const stamp = makeStamp(b, '#f2f2f4', d * dpr);
    const buf = document.createElement('canvas');
    buf.width = c.width; buf.height = c.height;
    const bg = ctx2d(buf);
    bg.setTransform(dpr, 0, 0, dpr, 0, 0);
    bg.globalAlpha = b.flow;
    let rnd = 1;
    const rand = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
    const pts = Array.from({ length: 40 }, (_, i) => { const t = i / 39; return { x: 22 + t * (W - 44), y: H / 2 + Math.sin(t * Math.PI * 2) * (H / 2 - d / 2 - 4) }; });
    let carry = 0;
    const dab = (x: number, y: number) => {
      let s = d;
      if (b.sizeJitter > 0) s *= 1 - b.sizeJitter * rand();
      if (b.scatter > 0) { const a = rand() * Math.PI * 2, k = rand() * b.scatter * d; x += Math.cos(a) * k; y += Math.sin(a) * k; }
      const ang = b.angle + (b.angleJitter > 0 ? (rand() - 0.5) * 360 * b.angleJitter : 0);
      bg.save(); bg.translate(x, y); bg.rotate((ang * Math.PI) / 180);
      bg.drawImage(stamp, -s / 2, (-s * b.roundness) / 2, s, s * b.roundness);
      bg.restore();
    };
    dab(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const r = dabPositions(pts[i - 1], pts[i], Math.max(0.5, d * Math.max(0.01, b.spacing)), carry);
      r.points.forEach(p => dab(p.x, p.y));
      carry = r.carry;
    }
    const tex = makeTextureMask(b);
    if (tex) {
      const pat = bg.createPattern(tex, 'repeat')!;
      pat.setTransform(new DOMMatrix().scaleSelf(Math.max(0.05, b.textureScale) * 0.5 * dpr));
      bg.setTransform(1, 0, 0, 1, 0, 0);
      bg.globalAlpha = 1;
      bg.globalCompositeOperation = 'destination-in';
      bg.fillStyle = pat;
      bg.fillRect(0, 0, buf.width, buf.height);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = b.opacity;
    g.drawImage(buf, 0, 0);
  }, [b, lib]);
  return <canvas ref={ref} className="brush-preview" style={{ width: 268, height: 64 }} aria-label="Vista previa del trazo" />;
}

function Library({ kind, value, onPick }: { kind: 'tip' | 'texture'; value: string | null; onPick: (id: string | null) => void }) {
  useLibrary();
  const file = useRef<HTMLInputElement>(null);
  const items = listBrushImages(kind);
  const upload = async (f: File | undefined) => {
    if (!f) return;
    try {
      const it = await addBrushImage(f, kind);
      onPick(it.id);
      toast(kind === 'tip' ? `Punta «${it.name}» creada` : `Textura «${it.name}» creada`, 'ok', 2000);
    } catch { toast('No se pudo leer la imagen', 'error'); }
  };
  return (
    <div className="brush-lib" role="listbox" aria-label={kind === 'tip' ? 'Puntas' : 'Texturas'}>
      {kind === 'texture' && (
        <button className={'brush-item none' + (value === null ? ' on' : '')} role="option" aria-selected={value === null} title="Sin textura" onClick={() => onPick(null)}>
          <X size={14} />
        </button>
      )}
      {items.map(it => (
        <div key={it.id} className="brush-item-wrap">
          <button className={'brush-item' + (it.id === value ? ' on' : '')} role="option" aria-selected={it.id === value} title={it.name} onClick={() => onPick(it.id)}>
            <Thumb img={it} />
          </button>
          {!it.builtin && (
            <button className="brush-del" title={`Eliminar «${it.name}»`} onClick={() => { if (it.id === value) onPick(kind === 'tip' ? 'round' : null); void removeBrushImage(it.id); }}>
              <X size={9} />
            </button>
          )}
        </div>
      ))}
      <button className="brush-item add" title={kind === 'tip' ? 'Crear una punta a partir de una imagen (lo oscuro o lo opaco pinta)' : 'Crear una textura a partir de una imagen (lo oscuro deja huecos)'} onClick={() => file.current?.click()}>
        <Plus size={14} />
      </button>
      <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml" hidden
        onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}

const pct = (v: number) => Math.round(v * 100);

/** Ajustes de punta, forma y textura de una herramienta de pintura. */
export function BrushSettingsPanel({ tool }: { tool: BrushToolId }) {
  const b = useStore(s => s.brushes[tool]);
  const up = (p: Partial<BrushSettings>) => setBrush(tool, p);
  return (
    <div className="brush-panel">
      <Preview b={b} />
      <div className="section-title">Punta</div>
      <Library kind="tip" value={b.tip} onPick={id => up({ tip: id ?? 'round' })} />
      <div className="grid2">
        <Slider label="Espaciado" value={pct(b.spacing)} min={1} max={200} suffix="%" onChange={v => up({ spacing: v / 100 })} hint="Distancia entre toques, en % del tamaño" />
        <Slider label="Ángulo" value={b.angle} min={-180} max={180} suffix="°" onChange={v => up({ angle: v })} />
        <Slider label="Redondez" value={pct(b.roundness)} min={5} max={100} suffix="%" onChange={v => up({ roundness: v / 100 })} />
        <Slider label="Dispersión" value={pct(b.scatter)} min={0} max={200} suffix="%" onChange={v => up({ scatter: v / 100 })} />
        <Slider label="Variar tamaño" value={pct(b.sizeJitter)} min={0} max={100} suffix="%" onChange={v => up({ sizeJitter: v / 100 })} />
        <Slider label="Variar ángulo" value={pct(b.angleJitter)} min={0} max={100} suffix="%" onChange={v => up({ angleJitter: v / 100 })} />
      </div>
      <Check checked={b.pressure} onChange={v => up({ pressure: v })} label="La presión del lápiz cambia el tamaño" />
      <div className="section-title">Textura</div>
      <Library kind="texture" value={b.texture} onPick={id => up({ texture: id })} />
      {b.texture && (
        <div className="grid2">
          <Slider label="Escala" value={pct(b.textureScale)} min={5} max={1000} suffix="%" onChange={v => up({ textureScale: v / 100 })} />
          <Slider label="Profundidad" value={pct(b.textureDepth)} min={0} max={100} suffix="%" onChange={v => up({ textureDepth: v / 100 })} />
          <Check checked={b.textureInvert} onChange={v => up({ textureInvert: v })} label="Invertir" />
        </div>
      )}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn sm ghost" onClick={() => setBrush(tool, defaultBrushes()[tool])}><RotateCcw size={12} /> Restablecer</button>
      </div>
    </div>
  );
}

/** Controles de la barra de opciones para pincel, borrador y restaurar. */
export function BrushOptions({ tool }: { tool: BrushToolId }) {
  const b = useStore(s => s.brushes[tool]);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  // la barra de opciones se desplaza en horizontal (recorta lo que sobresale): el panel va fuera,
  // con posición fija bajo el botón
  useLayoutEffect(() => {
    if (!open || !wrap.current) return;
    const place = () => {
      const r = wrap.current!.getBoundingClientRect();
      setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 316)), top: r.bottom + 6 });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);
  useLibrary();
  useEffect(() => { void loadBrushLibrary(); }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { const t = e.target as Node; if (!wrap.current?.contains(t) && !pop.current?.contains(t)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('keydown', esc); };
  }, [open]);
  const up = (p: Partial<BrushSettings>) => setBrush(tool, p);
  const tip = getBrushImage(b.tip);
  const opt = (label: string, el: React.ReactNode) => <div className="opt">{label}{el}</div>;
  return (
    <>
      <div className="brush-opts-anchor" ref={wrap}>
        <button className={'btn sm brush-tip-btn' + (open ? ' on' : '')} onClick={() => setOpen(o => !o)} title="Punta, forma y textura" aria-expanded={open}>
          {tip && <Thumb img={tip} size={20} />}
          <ChevronDown size={12} />
        </button>
        {open && createPortal(
          <div ref={pop} className="brush-pop" style={{ left: pos.left, top: pos.top, maxHeight: `calc(100vh - ${pos.top + 12}px)` }} role="dialog" aria-label="Punta, forma y textura">
            <BrushSettingsPanel tool={tool} />
          </div>, document.body)}
      </div>
      {opt('Tamaño', <NumberField value={b.size} onChange={v => up({ size: Math.max(1, v) })} min={1} max={5000} suffix="px" digits={0} label="↔" />)}
      {opt('Dureza', <NumberField value={pct(b.hardness)} onChange={v => up({ hardness: v / 100 })} min={0} max={100} suffix="%" digits={0} label="↔" disabled={b.tip !== 'round'} title={b.tip !== 'round' ? 'La dureza es de la punta redonda' : undefined} />)}
      {opt('Opacidad', <NumberField value={pct(b.opacity)} onChange={v => up({ opacity: v / 100 })} min={1} max={100} suffix="%" digits={0} label="↔" />)}
      {opt('Flujo', <NumberField value={pct(b.flow)} onChange={v => up({ flow: v / 100 })} min={1} max={100} suffix="%" digits={0} label="↔" />)}
      {b.texture && <span className="chip" title="Este trazo usa una textura">Textura</span>}
    </>
  );
}
