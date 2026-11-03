import React, { useEffect, useState } from 'react';
import { Download, AlertTriangle } from 'lucide-react';
import { Modal, NumberField, Select, Seg, Slider, Check, CanvasPreview } from '../components/controls';
import { activeDoc, withBusy, toast } from '../../core/store';
import { exportAndDownload, formatInfo, type ExportFormat } from '../../io/exporters';
import { renderArtboard } from '../../core/render';
import { hasIcc, cmsState } from '../../engine/cms';

export function ExportDialog({ onClose, quick }: { onClose: () => void; quick?: string }) {
  const doc = activeDoc()!;
  const s = doc.state;
  const active = s.artboards.find(a => a.id === s.activeArtboardId) ?? s.artboards[0];
  const [format, setFormat] = useState<ExportFormat>((quick as ExportFormat) || 'png');
  const [dpi, setDpi] = useState(active.dpi);
  const [quality, setQuality] = useState(92);
  const [bg, setBg] = useState<'transparent' | 'white' | 'artboard'>('transparent');
  const [scope, setScope] = useState<'active' | 'all'>('active');
  const [name, setName] = useState(doc.name.replace(/[^\w\- áéíóúñÁÉÍÓÚÑ]+/g, '_'));
  const [preview, setPreview] = useState<HTMLCanvasElement | null>(null);
  const info = formatInfo[format];
  const abs = scope === 'all' ? s.artboards : [active];
  const scale = dpi / active.dpi;
  const outW = Math.round(active.w * scale), outH = Math.round(active.h * scale);
  useEffect(() => {
    const k = Math.min(1, 520 / Math.max(active.w, active.h));
    renderArtboard(s, active, k, { background: bg === 'artboard' }).then(setPreview);
  }, [bg]);
  const run = () => withBusy('Exportando…', async () => {
    const ok = await exportAndDownload(s, abs, { format, dpi, quality: quality / 100, background: bg, filename: name });
    if (ok !== false) { toast(`Exportado ${abs.length > 1 ? abs.length + ' archivos' : name + '.' + info.ext}`, 'ok'); onClose(); }
  });
  const upsample = dpi > active.dpi;
  return (
    <Modal title="Exportar" icon={<Download size={16} />} onClose={onClose} width={780}
      footer={<><span className="tiny muted">{outW}×{outH} px · {(active.w / active.dpi * 2.54).toFixed(2)}×{(active.h / active.dpi * 2.54).toFixed(2)} cm a {dpi} ppp</span><div className="spacer" /><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={run}><Download size={14} />Exportar</button></>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16 }}>
        <CanvasPreview canvas={preview} className={'preview-box ' + (bg === 'transparent' ? 'checker' : '')} style={{ height: 400, background: bg === 'white' ? '#fff' : undefined }} />
        <div className="col" style={{ gap: 10 }}>
          <div className="col" style={{ gap: 4 }}>
            <span className="small muted">Formato</span>
            <Select value={format} onChange={setFormat} options={(Object.keys(formatInfo) as ExportFormat[]).map(k => ({ value: k, label: formatInfo[k].label }))} />
            <span className="tiny muted">{info.note}</span>
          </div>
          <div className="row"><span className="label">Nombre</span><input className="input" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.stopPropagation()} /></div>
          <div className="row"><span className="label">Resolución</span><NumberField value={dpi} onChange={setDpi} min={36} max={2400} digits={0} suffix="ppp" /></div>
          <div className="row" style={{ gap: 4 }}>{[150, 300, 360, 600].map(v => <button key={v} className={'chip' + (dpi === v ? ' accent' : '')} style={{ cursor: 'pointer' }} onClick={() => setDpi(v)}>{v}</button>)}</div>
          {upsample && <div className="row tiny" style={{ color: 'var(--warn)' }}><AlertTriangle size={12} />Más resolución que la mesa ({active.dpi} ppp): se interpolan píxeles, no se añade detalle.</div>}
          {(format === 'jpg' || format === 'webp') && <Slider label="Calidad" value={quality} min={10} max={100} suffix="%" onChange={setQuality} />}
          {info.alpha && format !== 'svg' && (
            <div className="col" style={{ gap: 4 }}>
              <span className="small muted">Fondo</span>
              <Seg value={bg} onChange={setBg} full options={[{ value: 'transparent', label: 'Transparente' }, { value: 'white', label: 'Blanco' }, { value: 'artboard', label: 'De la mesa' }]} />
            </div>
          )}
          {format === 'tiff-cmyk' && <div className="tiny muted">{hasIcc() ? `Separación con ${cmsState.profileName}, perfil incrustado.` : 'Sin perfil ICC: separación por fórmula (GCR/TAC). Carga un perfil en Canales y color para una conversión precisa.'}</div>}
          {s.artboards.length > 1 && (
            <div className="col" style={{ gap: 4 }}>
              <span className="small muted">Mesas</span>
              <Seg value={scope} onChange={setScope} full options={[{ value: 'active', label: `Activa (${active.name})` }, { value: 'all', label: `Todas (${s.artboards.length})` }]} />
            </div>
          )}
          {format === 'png' && bg === 'transparent' && <div className="chip ok" style={{ alignSelf: 'flex-start' }}>Listo para RIP DTF: alfa + {dpi} ppp incrustados</div>}
        </div>
      </div>
    </Modal>
  );
}
void Check;
