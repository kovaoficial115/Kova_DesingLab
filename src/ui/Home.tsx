import React, { useEffect, useRef, useState } from 'react';
import { FolderOpen, Upload, Trash2, RotateCcw, Grid3x3, Eraser, ScanLine, Layers, Shirt, FileImage, ArrowRight, Printer, Archive, ArchiveRestore, Box, Smartphone, Images, Shuffle, Table2, Download, Eye } from 'lucide-react';
import { allFormats, aspectLabel } from '../social/presets';
import { createSocialDoc } from '../social/actions';
import type { Workspace } from '../core/store';
import { useStore, set, withBusy, toast } from '../core/store';
import { KovaK, BrandIcon } from './components/Brand';
import { newDoc } from '../core/doc';
import { addDoc } from '../core/actions';
import { listLibrary, loadFromLibrary, deleteFromLibrary, type ProjectMeta } from '../io/project';
import { openFiles, pickFiles, listRecovery, discardAutosave } from '../io/fileOps';
import { halftone, defaultHalftone } from '../engine/halftone';
import { openDialog, displayKeys, commands, runCommand } from './commands';
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

export const GRAPHIC_PRESETS = [
  { id: 'g-a4', name: 'A4', w: 21, h: 29.7, unit: 'cm', dpi: 300, hint: 'Documento / flyer' },
  { id: 'g-a3', name: 'A3', w: 29.7, h: 42, unit: 'cm', dpi: 300, hint: 'Cartel' },
  { id: 'g-letter', name: 'Carta', w: 8.5, h: 11, unit: 'in', dpi: 300, hint: 'Documento US' },
  { id: 'g-poster', name: 'Póster', w: 50, h: 70, unit: 'cm', dpi: 150, hint: 'Gran formato' },
  { id: 'g-card', name: 'Tarjeta', w: 8.5, h: 5.5, unit: 'cm', dpi: 300, hint: 'Tarjeta de visita' },
  { id: 'g-screen', name: 'Pantalla HD', w: 1920, h: 1080, unit: 'px', dpi: 72, hint: 'Presentación / web' },
] as const;

/** Formatos de redes que se ofrecen en Inicio (el resto, en «Más formatos»). */
const HOME_SOCIAL = ['ig-post-portrait', 'ig-story', 'ig-reel-cover', 'ig-post-square', 'ig-highlight', 'tt-video', 'yt-thumb', 'pin-vertical'];

const WORKSPACES: { id: Workspace; name: string }[] = [{ id: 'dtf', name: 'DTF' }, { id: 'graphic', name: 'Gráfico' }, { id: 'social', name: 'Redes sociales' }];

export function createPresetDoc(p: { name: string; w: number; h: number; dpi: number; unit: string }, name?: string) {
  const f = p.unit === 'cm' ? p.dpi / 2.54 : p.unit === 'mm' ? p.dpi / 25.4 : p.unit === 'in' ? p.dpi : 1;
  const d = newDoc(name ?? `${p.name} ${p.w}×${p.h}`, Math.round(p.w * f), Math.round(p.h * f), p.dpi);
  // un formato de impresión se mide en sus unidades (tras trabajar en redes la app queda en px)
  if (p.unit === 'cm' || p.unit === 'mm' || p.unit === 'in' || p.unit === 'px') set({ unit: p.unit });
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
  useEffect(() => {
    refresh();
    window.addEventListener('kova:library-changed', refresh);
    return () => window.removeEventListener('kova:library-changed', refresh);
  }, []);
  const workspace = useStore(s => s.workspace);
  const socialFormats = useStore(s => s.socialFormats);
  const social = workspace === 'social';
  const presets = workspace === 'graphic' ? GRAPHIC_PRESETS : DOC_PRESETS;
  const socialFeatures = [
    { icon: Smartphone, title: 'Formatos de cada red', sub: 'Instagram, TikTok, YouTube, Facebook y Pinterest, editables', cmd: 'social.new' },
    { icon: Images, title: 'Carruseles', sub: 'Diapositivas numeradas y panoramas continuos', cmd: 'social.carousel' },
    { icon: Shuffle, title: 'Adaptación multiformato', sub: 'Del post a la historia o la miniatura sin deformar', cmd: 'social.adapt' },
    { icon: Eye, title: 'Vista previa local', sub: 'Perfil, historias, Reels y planificador del feed', cmd: 'social.preview' },
    { icon: Table2, title: 'Lotes con variables', sub: '{{producto}}, {{precio}}… desde CSV o JSON', cmd: 'social.batch' },
    { icon: Download, title: 'Exportación para redes', sub: 'Nombres por plataforma, validación y ZIP', cmd: 'social.export' },
  ];
  const features0 = [
    { icon: Grid3x3, title: 'Semitonos DTF', sub: 'Trama por alfa, mono, color o CMYK multicanal', cmd: 'dtf.halftone' },
    { icon: Eraser, title: 'Eliminar fondo', sub: 'IA local, por color con descontaminación de bordes', cmd: 'dtf.bg' },
    { icon: ScanLine, title: 'Vectorizar', sub: 'Logotipos y tipografías a SVG', cmd: 'dtf.vectorize' },
    { icon: Layers, title: 'Hoja de impresión', sub: 'Imposición automática y aprovechamiento del film', cmd: 'dtf.gang' },
    { icon: Shirt, title: 'Mockups en prenda', sub: 'Tamaño real sobre camiseta o tu foto', cmd: 'dtf.mockup' },
    { icon: Box, title: 'Estudio 3D', sub: 'Tus prendas GLB en 360°, con luces y vistas', cmd: 'view.studio3d' },
    { icon: Printer, title: 'Preflight DTF', sub: 'Resolución, transparencia y área de impresión', cmd: 'dtf.preflight' },
  ];
  const features = social ? socialFeatures : features0;
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
              <div className="tiny muted" style={{ marginTop: 3 }}>{social ? 'Diseño para redes sociales y producción DTF' : 'Editor de producción para impresión DTF'}</div>
            </div>
            <div className="grow" />
            {docs.length > 0 && <button className="btn sm" onClick={() => set({ screen: 'editor' })}>Volver al editor <ArrowRight size={12} /></button>}
          </div>

          <div className="col" style={{ gap: 6, marginTop: 6 }}>
            <span className="home-kicker"><BrandIcon name="spark" size={12} />Nuevo documento</span>
            <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
              <h1 className="grow">Empieza un diseño</h1>
              <div className="seg" role="radiogroup" aria-label="Espacio de trabajo">
                {WORKSPACES.map(w => <button key={w.id} role="radio" aria-checked={workspace === w.id} className={workspace === w.id ? 'on' : ''} onClick={() => set({ workspace: w.id })}>{w.name}</button>)}
              </div>
            </div>
            <span className="muted">{social ? 'Elige un formato de redes; podrás exportarlo listo para subir a mano.' : workspace === 'graphic' ? 'Elige un formato de impresión o pantalla, o abre tus archivos.' : 'Elige un formato de impresión o abre tus archivos.'}</span>
          </div>

          {social ? (
            <div className="preset-grid">
              {HOME_SOCIAL.map(id => allFormats(socialFormats).find(f => f.id === id)).filter(Boolean).map(f => {
                const k = 30 / Math.max(f!.w, f!.h);
                const open = () => createSocialDoc(f!);
                return (
                  <div key={f!.id} className="preset" role="button" tabIndex={0} aria-label={`Nuevo diseño ${f!.name}, ${f!.w}×${f!.h} px`}
                    onClick={open} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}>
                    <div className="shape"><div style={f!.circle ? { width: 22, height: 22, borderRadius: '50%' } : { width: Math.max(6, f!.w * k), height: Math.max(6, f!.h * k) }} /></div>
                    <div className="small" style={{ fontWeight: 600 }}>{f!.name}</div>
                    <div className="tiny muted">{f!.platform === 'instagram' ? 'Instagram' : f!.platform === 'tiktok' ? 'TikTok' : f!.platform === 'youtube' ? 'YouTube' : f!.platform === 'pinterest' ? 'Pinterest' : 'Facebook'} · {f!.w}×{f!.h} · {aspectLabel(f!.w, f!.h)}</div>
                  </div>
                );
              })}
            </div>
          ) : (
          <div className="preset-grid">
            {presets.map(p => {
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
          )}
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {social ? <>
              <button className="btn primary" onClick={() => openDialog('social-new', { mode: 'new' })}><Smartphone size={14} />Más formatos y personalizado</button>
              <button className="btn" onClick={() => openDialog('social-new', { mode: 'new', tab: 'series' })}><Images size={14} />Carrusel o destacadas</button>
            </> : <button className="btn primary" onClick={() => openDialog('new')}><FileImage size={14} />Documento personalizado</button>}
            <button className="btn" onClick={async () => openFiles(await pickFiles())}><FolderOpen size={14} />Abrir archivo</button>
            <button className="btn" onClick={() => set({ screen: 'studio' })}><Box size={14} />Estudio 3D</button>
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
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <h2>Proyectos recientes</h2><span className="tiny muted grow">Biblioteca local de este navegador</span>
              <button className="btn sm ghost" title="Todos los proyectos en un .zip (copia de seguridad o para la app de escritorio)" disabled={!recent.length} onClick={() => runCommand('file.exportAll')}><Archive size={12} />Exportar todo</button>
              <button className="btn sm ghost" title="Añadir a la biblioteca los proyectos de un .zip exportado" onClick={() => runCommand('file.importAll')}><ArchiveRestore size={12} />Importar copia</button>
            </div>
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
                      onClick={async e => { e.stopPropagation(); if (await platform.confirm(`¿Eliminar "${r.name}" de la biblioteca?`, { okLabel: 'Eliminar' })) { await deleteFromLibrary(r.id); refresh(); toast('Proyecto eliminado', 'ok'); } }}><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="home-right">
          <HeroCanvas />
          <div className="hero-copy">{social ? <h2>Contenido para redes.<br /><em>Listo para subir.</em></h2> : <h2>Producción DTF.<br /><em>Perfeccionada.</em></h2>}</div>
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
