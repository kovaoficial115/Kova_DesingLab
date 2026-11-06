import React, { useEffect, useRef, useState } from 'react';
import { FolderOpen, Upload, Trash2, RotateCcw, Grid3x3, Eraser, ScanLine, Layers, Shirt, FileImage, ArrowRight, Printer } from 'lucide-react';
import { useStore, set, withBusy, toast } from '../core/store';
import { KovaK, BrandIcon } from './components/Brand';
import { newDoc } from '../core/doc';
import { addDoc } from '../core/actions';
import { listLibrary, loadFromLibrary, deleteFromLibrary, type ProjectMeta } from '../io/project';
import { openFiles, pickFiles, listRecovery, discardAutosave } from '../io/fileOps';
import { halftone, defaultHalftone } from '../engine/halftone';
import { openDialog, displayKeys, commands } from './commands';
import { SharedProjects } from '../collab/SharedProjects';
import { KOVA } from './theme';
import { platform } from '../platform';

export const DOC_PRESETS = [
  { id: 'chest', name: 'Pecho estándar', w: 28, h: 35, unit: 'cm', dpi: 300, hint: 'Frontal adulto' },
  { id: 'a4', name: 'A4', w: 21, h: 29.7, unit: 'cm', dpi: 300, hint: 'Pecho / tote' },
  { id: 'back', name: 'Espalda', w: 30, h: 40, unit: 'cm', dpi: 300, hint: 'Posterior completo' },
  { id: 'pocket', name: 'Bolsillo', w: 10, h: 10, unit: 'cm', dpi: 300, hint: 'Logo pequeño' },
  { id: 'sheet58', name: 'Hoja DTF 58 cm', w: 58, h: 100, unit: 'cm', dpi: 300, hint: 'Rollo × 1 m' },
  { id: 'sheet30', name: 'Hoja DTF 30 cm', w: 30, h: 100, unit: 'cm', dpi: 300, hint: 'Rollo A3+ × 1 m' },
] as const;

export function createPresetDoc(p: { name: string; w: number; h: number; dpi: number; unit: string }, name?: string) {
  const f = p.unit === 'cm' ? p.dpi / 2.54 : p.unit === 'mm' ? p.dpi / 25.4 : p.unit === 'in' ? p.dpi : 1;
  const d = newDoc(name ?? `${p.name} ${p.w}×${p.h}`, Math.round(p.w * f), Math.round(p.h * f), p.dpi);
  addDoc(d);
}

function HeroCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const W = 300, H = 220;
    const src = new ImageData(W, H);
    let t = 0, raf = 0, last = 0;
    // con «reducir movimiento» se dibuja un único fotograma
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const draw = (now: number) => {
      if (!(still && last)) raf = requestAnimationFrame(draw);
      if (now - last < 66) return;
      last = now; t += 0.035;
      const d = src.data;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const nx = x / W, ny = y / H;
        let v = 0.5 + 0.28 * Math.sin(nx * 5.2 + t) * Math.cos(ny * 4.1 - t * 0.7) + 0.22 * Math.sin((nx + ny) * 7 - t * 1.3);
        const dx = nx - 0.5 - Math.sin(t * 0.5) * 0.15, dy = ny - 0.55;
        v = v * 0.55 + (1 - Math.min(1, Math.hypot(dx * 1.4, dy) * 1.8)) * 0.6;
        const i = (y * W + x) * 4;
        const lum = 255 * (1 - Math.max(0, Math.min(1, v)));
        d[i] = d[i + 1] = d[i + 2] = lum; d[i + 3] = 255;
      }
      const out = halftone(src, { ...defaultHalftone, mode: 'mono', cellPx: 7, angle: 22.5 + Math.sin(t * 0.3) * 8, antialias: true, minDot: 0.02, maxDot: 1, inkColor: [210, 22, 37], sample: 'cell' });
      const g = c.getContext('2d')!;
      if (c.width !== W) { c.width = W; c.height = H; }
      g.fillStyle = KOVA.navy; g.fillRect(0, 0, W, H);
      const tmp = new ImageData(out.data as any, W, H);
      const off = document.createElement('canvas'); off.width = W; off.height = H;
      off.getContext('2d')!.putImageData(tmp, 0, 0);
      g.drawImage(off, 0, 0);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} style={{ imageRendering: 'auto' }} />;
}

export function Home() {
  const docs = useStore(s => s.docs);
  const [recent, setRecent] = useState<ProjectMeta[]>([]);
  const [recovery, setRecovery] = useState<ProjectMeta[]>([]);
  const [over, setOver] = useState(false);
  const refresh = () => {
    listLibrary().then(setRecent).catch(() => setRecent([]));
    listRecovery().then(r => setRecovery(r.filter(x => !useStore.getState().docs.some(d => d.id === x.id))));
  };
  useEffect(refresh, []);
  const features = [
    { icon: Grid3x3, title: 'Semitonos DTF', sub: 'Trama por alfa, mono, color o CMYK multicanal', cmd: 'dtf.halftone' },
    { icon: Eraser, title: 'Eliminar fondo', sub: 'IA local, por color con descontaminación de bordes', cmd: 'dtf.bg' },
    { icon: ScanLine, title: 'Vectorizar', sub: 'Logotipos y tipografías a SVG', cmd: 'dtf.vectorize' },
    { icon: Layers, title: 'Hoja de impresión', sub: 'Imposición automática y aprovechamiento del film', cmd: 'dtf.gang' },
    { icon: Shirt, title: 'Mockups en prenda', sub: 'Tamaño real sobre camiseta o tu foto', cmd: 'dtf.mockup' },
    { icon: Printer, title: 'Preflight DTF', sub: 'Resolución, transparencia y área de impresión', cmd: 'dtf.preflight' },
  ];
  return (
    <div className="home"
      onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); openFiles(platform.droppedFiles(e.dataTransfer)); }}>
      <div className="home-shell">
        <div className="home-left">
          <div className="home-brand" style={{ flexWrap: 'wrap' }}>
            <KovaK size={36} />
            <div>
              <div className="name">KOVA Design Lab</div>
              <div className="tiny muted" style={{ marginTop: 3 }}>Editor de producción para impresión DTF</div>
            </div>
            <div className="grow" />
            {docs.length > 0 && <button className="btn sm" onClick={() => set({ screen: 'editor' })}>Volver al editor <ArrowRight size={12} /></button>}
          </div>

          <div className="col" style={{ gap: 6, marginTop: 6 }}>
            <span className="home-kicker"><BrandIcon name="spark" size={12} />Nuevo documento</span>
            <h1>Empieza un diseño</h1>
            <span className="muted">Elige un formato de impresión o abre tus archivos.</span>
          </div>

          <div className="preset-grid">
            {DOC_PRESETS.map(p => {
              const k = 30 / Math.max(p.w, p.h);
              return (
                <div key={p.id} className="preset" role="button" tabIndex={0} aria-label={`Nuevo documento ${p.name}, ${p.w}×${p.h} ${p.unit}`}
                  onClick={() => createPresetDoc(p)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); createPresetDoc(p); } }}>
                  <div className="shape"><div style={{ width: Math.max(6, p.w * k), height: Math.max(6, p.h * k) }} /></div>
                  <div className="small" style={{ fontWeight: 600 }}>{p.name}</div>
                  <div className="tiny muted">{p.w}×{p.h} {p.unit} · {p.dpi} ppp</div>
                </div>
              );
            })}
          </div>
          <div className="row">
            <button className="btn primary" onClick={() => openDialog('new')}><FileImage size={14} />Documento personalizado</button>
            <button className="btn" onClick={async () => openFiles(await pickFiles())}><FolderOpen size={14} />Abrir archivo</button>
          </div>

          <div className={'dropzone' + (over ? ' over' : '')}>
            <Upload size={18} />
            <div className="small" style={{ color: 'var(--text)', fontWeight: 500 }}>Arrastra y suelta archivos para abrirlos</div>
            <div className="tiny">PNG, JPG, WEBP, SVG, TIFF, BMP, PSD (con capas), PDF y proyectos .kova</div>
          </div>

          {recovery.length > 0 && (
            <div className="card" style={{ borderColor: 'rgba(255,181,71,.35)' }}>
              <div className="row" style={{ marginBottom: 6 }}><RotateCcw size={14} style={{ color: 'var(--warn)' }} /><b className="small">Recuperación de sesión</b><span className="tiny muted">Cambios guardados automáticamente que no se cerraron correctamente</span></div>
              {recovery.map(r => (
                <div key={r.id} className="row small" style={{ padding: '4px 0' }}>
                  <img src={r.thumb} style={{ width: 34, height: 24, objectFit: 'cover', borderRadius: 4 }} />
                  <span className="grow">{r.name}</span>
                  <span className="tiny muted">{new Date(r.updated).toLocaleString()}</span>
                  <button className="btn sm" onClick={() => withBusy('Recuperando…', async () => { const d = await loadFromLibrary(r.id, 'autosave'); addDoc({ ...d, dirty: true }); })}>Recuperar</button>
                  <button className="icon-btn sm" title="Descartar" onClick={async () => { await discardAutosave(r.id); refresh(); }}><Trash2 size={12} /></button>
                </div>
              ))}
            </div>
          )}

          <SharedProjects />

          <div className="col" style={{ gap: 8 }}>
            <div className="row"><h2>Proyectos recientes</h2><span className="tiny muted">Biblioteca local de este navegador</span></div>
            {recent.length === 0 ? <div className="tiny muted">Aún no hay proyectos guardados. Usa Archivo → Guardar (Ctrl/⌘+S).</div> : (
              <div className="recent-grid">
                {recent.map(r => (
                  <div key={r.id} className="recent" onClick={() => withBusy('Abriendo proyecto…', async () => {
                    if (useStore.getState().docs.some(d => d.id === r.id)) { set({ activeDocId: r.id, screen: 'editor' }); return; }
                    addDoc(await loadFromLibrary(r.id));
                  })}>
                    <img src={r.thumb} />
                    <div className="info">
                      <div className="small" style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                      <div className="tiny muted">{(r.w / r.dpi * 2.54).toFixed(1)}×{(r.h / r.dpi * 2.54).toFixed(1)} cm · {new Date(r.updated).toLocaleDateString()}</div>
                    </div>
                    <button className="icon-btn sm del" style={{ background: 'rgba(0,0,0,.6)' }} title="Eliminar de la biblioteca"
                      onClick={async e => { e.stopPropagation(); if (confirm(`¿Eliminar "${r.name}" de la biblioteca?`)) { await deleteFromLibrary(r.id); refresh(); toast('Proyecto eliminado', 'ok'); } }}><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="home-right">
          <HeroCanvas />
          <div className="hero-copy"><h2>Producción DTF.<br /><em>Perfeccionada.</em></h2></div>
          <BrandIcon name="sparkDuo" size={44} className="hero-spark" style={{ right: 26, top: 26, color: 'var(--accent)' }} />
          <div className="hero-card">
            {features.map(f => (
              <div key={f.title} className="feat">
                <div className="ico"><f.icon size={14} /></div>
                <div className="grow">
                  <div className="small" style={{ fontWeight: 600 }}>{f.title}</div>
                  <div className="tiny muted">{f.sub}</div>
                </div>
                {commands[f.cmd]?.keys && <span className="kbd">{displayKeys(commands[f.cmd].keys)}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
