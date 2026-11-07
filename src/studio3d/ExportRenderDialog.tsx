import React, { useMemo, useRef, useState } from 'react';
import { ImageDown, Film, Loader2 } from 'lucide-react';
import { Modal, Seg, ColorInput } from '../ui/components/controls';
import { toast } from '../core/store';
import { platform } from '../platform';
import { VIEW_LABELS, type GarmentViewer, type ExportView, type ViewPreset } from './viewer';
import { RENDER_SIZES, resolveRenderSize, videoFormat } from './render';

type Kind = 'image' | 'video';
const VIEW_OPTIONS: { value: ExportView; label: string }[] = [
  { value: 'current', label: 'Actual' },
  ...(Object.keys(VIEW_LABELS) as ViewPreset[]).map(v => ({ value: v, label: VIEW_LABELS[v] })),
];
const VIDEO_SIZES = ['720', '1080'] as const;
const DURATIONS = ['4', '6', '8'] as const;

/** Nombre de archivo sin caracteres que macOS o Windows rechazan. */
const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'render';

/** Exportar la prenda como imagen PNG (hasta 4096 px, fondo transparente) o como video giratorio. */
export function ExportRenderDialog({ viewer, name, background, onClose }: { viewer: GarmentViewer; name: string; background: string | null; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>('image');
  const [size, setSize] = useState<`${(typeof RENDER_SIZES)[number]}`>('2048');
  const [view, setView] = useState<ExportView>('current');
  const [transparent, setTransparent] = useState(background === null);
  const [color, setColor] = useState(background ?? '#ffffff');
  const [vsize, setVsize] = useState<(typeof VIDEO_SIZES)[number]>('1080');
  const [secs, setSecs] = useState<(typeof DURATIONS)[number]>('6');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);

  const limits = useMemo(() => viewer.renderLimits(), [viewer]);
  const fmt = useMemo(() => videoFormat(), []);
  const planned = resolveRenderSize(Number(kind === 'image' ? size : vsize), limits);

  const save = async (blob: Blob, file: string, filter: { name: string; extensions: string[]; mime: string }) => {
    const r = await platform.saveFile(blob, { suggestedName: file, filters: [filter] });
    return r.status !== 'cancelled';
  };

  const run = async () => {
    setBusy(true);
    try {
      if (kind === 'image') {
        const r = await viewer.exportImage({ size: Number(size), view, background: transparent ? null : color });
        const label = view === 'current' ? 'vista' : VIEW_LABELS[view];
        if (await save(r.blob, `${fileSafe(name)} - ${label} ${r.side}px.png`, { name: 'Imagen PNG', extensions: ['png'], mime: 'image/png' }))
          toast(`Render exportado: ${r.side} × ${r.side} px${transparent ? ', fondo transparente' : ''}`, 'ok');
        r.warnings.forEach(w => toast(w, 'warn'));
      } else {
        abort.current = new AbortController();
        setProgress(0);
        const r = await viewer.exportTurntable({ size: Number(vsize), seconds: Number(secs), background: color, onProgress: setProgress, signal: abort.current.signal });
        if (await save(r.blob, `${fileSafe(name)} - giro ${r.side}px.${r.ext}`, { name: r.ext === 'mp4' ? 'Video MP4' : 'Video WebM', extensions: [r.ext], mime: r.blob.type }))
          toast(`Video exportado: ${r.side} px, ${secs} s (${r.ext.toUpperCase()})`, 'ok');
        r.warnings.forEach(w => toast(w, 'warn'));
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') toast('No se pudo exportar: ' + (e?.message || e), 'error');
    } finally {
      abort.current = null;
      setProgress(null);
      setBusy(false);
    }
  };

  const close = () => { if (busy) abort.current?.abort(); else onClose(); };
  return (
    <Modal title="Exportar render" icon={kind === 'image' ? <ImageDown size={16} /> : <Film size={16} />} onClose={close} width={460}
      footer={<>
        <span className="tiny muted">{kind === 'image' ? 'Se dibuja fuera de pantalla, no es una captura.' : fmt ? `Se guarda como ${fmt.ext.toUpperCase()}.` : ''}</span>
        <div className="spacer" />
        {busy && kind === 'video' ? <button className="btn" onClick={() => abort.current?.abort()}>Cancelar</button> : <button className="btn" onClick={onClose} disabled={busy}>Cerrar</button>}
        <button className="btn primary" onClick={run} disabled={busy || (kind === 'video' && !fmt)}>
          {busy ? <Loader2 size={13} className="spin" /> : kind === 'image' ? <ImageDown size={13} /> : <Film size={13} />}
          {busy ? (kind === 'video' ? 'Grabando…' : 'Renderizando…') : 'Exportar'}
        </button>
      </>}>
      <div className="col" style={{ gap: 10 }}>
        <Seg full value={kind} onChange={(v: Kind) => setKind(v)} options={[{ value: 'image', label: 'Imagen PNG' }, { value: 'video', label: 'Video giratorio' }]} />
        {kind === 'image' ? <>
          <div className="section-title">Resolución (px por lado)</div>
          <Seg full value={size} onChange={v => setSize(v)} options={RENDER_SIZES.map(s => ({ value: `${s}` as const, label: `${s}`, title: `${s} × ${s} px` }))} />
          <div className="section-title">Vista</div>
          <Seg full value={view} onChange={setView} options={VIEW_OPTIONS} />
        </> : <>
          {!fmt && <div className="small" style={{ color: 'var(--warn)' }}>Este navegador no puede grabar video. Prueba con Chrome o Safari actualizados.</div>}
          <div className="section-title">Resolución</div>
          <Seg full value={vsize} onChange={setVsize} options={VIDEO_SIZES.map(s => ({ value: s, label: `${s} px` }))} />
          <div className="section-title">Duración de la vuelta</div>
          <Seg full value={secs} onChange={setSecs} options={DURATIONS.map(s => ({ value: s, label: `${s} s` }))} />
        </>}
        <div className="section-title">Fondo</div>
        <div className="row">
          {kind === 'image' && <Seg value={transparent ? 'none' : 'color'} onChange={v => setTransparent(v === 'none')} options={[{ value: 'none', label: 'Transparente' }, { value: 'color', label: 'Color' }]} />}
          {(kind === 'video' || !transparent) && <ColorInput value={color} onChange={setColor} title="Color de fondo" />}
          {kind === 'video' && <span className="tiny muted">El video no admite transparencia.</span>}
        </div>
        {planned.reason && <div className="tiny" style={{ color: 'var(--warn)' }}>{planned.reason}</div>}
        {progress !== null && (
          <div className="col" style={{ gap: 4 }}>
            <div className="render-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><span style={{ width: `${progress * 100}%` }} /></div>
            <span className="tiny muted">Grabando en tiempo real: {Math.round(progress * 100)} %</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
