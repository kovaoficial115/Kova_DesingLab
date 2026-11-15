import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, AlertTriangle, Info, XCircle, CheckCircle2 } from 'lucide-react';
import { useActiveDoc, toast } from '../../core/store';
import { Modal, Seg, Slider, Check, NumberField } from '../../ui/components/controls';
import { platform } from '../../platform';
import { fileKeyFrom } from '../../social/presets';
import { buildZip } from '../../social/exportSocial';
import { fmtBytes } from '../../social/validate';
import { Thumb } from '../../social/ui/SocialPanel';
import { listProjects, checkOutput, maxSegmentHeight, crossingItems, BEHANCE_GUIDE, type Check as Chk, type OutExt } from '../model';
import { sectionOutputs, segmentOutputs, sectionsPdf, type Output } from '../exportBehance';
import { layerBounds } from '../../core/util';

type Mode = 'sections' | 'continuous' | 'pdf';

const Icon = ({ level }: { level: Chk['level'] }) =>
  level === 'error' ? <XCircle size={12} style={{ color: 'var(--danger)', flex: 'none' }} />
    : level === 'warn' ? <AlertTriangle size={12} style={{ color: 'var(--warn)', flex: 'none' }} />
      : level === 'ok' ? <CheckCircle2 size={12} style={{ color: 'var(--ok)', flex: 'none' }} />
        : <Info size={12} className="muted" style={{ flex: 'none' }} />;

export function BehanceExportDialog({ onClose, project }: { onClose: () => void; project?: string }) {
  const doc = useActiveDoc();
  const projects = doc ? listProjects(doc.state.artboards) : [];
  const proj = projects.find(p => p.id === project) ?? projects[0];
  const [mode, setMode] = useState<Mode>(proj?.continuous ? 'continuous' : 'sections');
  const [ext, setExt] = useState<OutExt>('jpg');
  const [scale, setScale] = useState(1);
  const [quality, setQuality] = useState(0.9);
  const [zip, setZip] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(proj?.sections.map(a => a.id)));
  const [segH, setSegH] = useState<number | null>(null);
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [progress, setProgress] = useState<string | null>(null);
  const cancel = useRef(false);
  // blobs ya medidos: si no cambian las opciones, la exportación los reutiliza
  const cache = useRef(new Map<string, Blob>());

  const chosen = proj ? proj.sections.filter(a => picked.has(a.id)) : [];
  const width = chosen.length ? Math.max(...chosen.map(a => Math.round(a.w * scale))) : 0;
  const autoSeg = maxSegmentHeight(width, ext);
  const maxH = Math.min(segH ?? autoSeg, autoSeg);
  const o = { ext, scale, quality };
  const outputs: Output[] = useMemo(() => {
    if (!doc || !proj) return [];
    if (mode === 'continuous') return segmentOutputs(doc.state, proj.name, chosen, o, maxH);
    return sectionOutputs(doc.state, proj.name, chosen, o);
  }, [doc?.state, proj?.id, mode, ext, scale, quality, maxH, chosen.map(a => a.id).join()]);
  const optKey = `${mode}|${ext}|${scale}|${quality}|${maxH}`;

  useEffect(() => { cache.current.clear(); setSizes({}); }, [doc?.state, optKey]);

  // peso real: se codifican las imágenes en segundo plano, una a una
  useEffect(() => {
    if (mode === 'pdf' || !outputs.length) return;
    let stop = false;
    const t = setTimeout(async () => {
      for (const out of outputs) {
        if (stop) return;
        const k = `${optKey}|${out.key}`;
        if (cache.current.has(k)) continue;
        try {
          const b = await out.render();
          if (stop) return;
          cache.current.set(k, b);
          setSizes(s => ({ ...s, [out.key]: b.size }));
        } catch { /* se informa al exportar */ }
      }
    }, 450);
    return () => { stop = true; clearTimeout(t); };
  }, [outputs]);

  if (!doc || !proj) return null;
  const checks = outputs.map(out => checkOutput(out.w, out.h, ext, sizes[out.key]));
  const errors = checks.flat().filter(c => c.level === 'error').length;
  const warns = checks.flat().filter(c => c.level === 'warn').length;
  const total = outputs.reduce((n, out) => n + (sizes[out.key] ?? 0), 0);
  const measured = outputs.every(out => sizes[out.key] != null);
  const base = fileKeyFrom(proj.name);
  const toggle = (id: string, v: boolean) => setPicked(p => { const n = new Set(p); v ? n.add(id) : n.delete(id); return n; });
  // en imágenes separadas, lo que cruza un límite sale partido
  const crossing = mode === 'sections' ? crossingItems(chosen, doc.state.layers.filter(l => l.kind !== 'group' && l.visible), l => layerBounds(l)) : [];

  const blobOf = async (out: Output) => cache.current.get(`${optKey}|${out.key}`) ?? out.render();

  const run = async () => {
    if (!chosen.length) return;
    cancel.current = false;
    try {
      if (mode === 'pdf') {
        const blob = await sectionsPdf(doc.state, chosen, o, proj.name, i => setProgress(`Página ${i + 1} de ${chosen.length}…`), () => cancel.current);
        if (blob) await platform.saveFile(blob, { suggestedName: `${base}.pdf`, pick: true, filters: [{ name: 'PDF', extensions: ['pdf'], mime: 'application/pdf' }] });
        else return;
      } else {
        const files: { name: string; blob: Blob }[] = [];
        for (let i = 0; i < outputs.length; i++) {
          if (cancel.current) { toast('Exportación cancelada', 'info'); return; }
          setProgress(`${mode === 'continuous' ? 'Segmento' : 'Sección'} ${i + 1} de ${outputs.length}…`);
          files.push({ name: outputs[i].name, blob: await blobOf(outputs[i]) });
        }
        if (files.length > 1 && zip) {
          setProgress('Creando ZIP…');
          await platform.saveFile(await buildZip(files), { suggestedName: `${base}_behance.zip`, pick: true, filters: [{ name: 'ZIP', extensions: ['zip'], mime: 'application/zip' }] });
        } else {
          for (const f of files) {
            const r = await platform.saveFile(f.blob, { suggestedName: f.name, pick: files.length === 1 });
            if (r.status === 'cancelled') return;
          }
        }
      }
      toast(mode === 'pdf' ? 'PDF exportado' : `Exportado: ${outputs.length} ${outputs.length === 1 ? 'imagen' : 'imágenes'}`, 'ok');
      onClose();
    } catch (e: any) {
      console.error(e);
      toast(e?.message || String(e), 'error', 6000);
    } finally { setProgress(null); }
  };

  return (
    <Modal title={`Exportar para Behance · ${proj.name}`} icon={<Download size={16} />} onClose={progress ? () => { cancel.current = true; } : onClose} width={760} height="88vh"
      footer={<>
        <span className="tiny muted">
          {mode === 'pdf' ? `${chosen.length} página(s)` : `${outputs.length} archivo(s)`}
          {mode !== 'pdf' && outputs.length > 0 && <> · {measured ? '' : '≥ '}{fmtBytes(total)}{measured ? '' : ' (midiendo…)'}</>}
          {errors > 0 && <span style={{ color: 'var(--danger)' }}> · {errors} error(es)</span>}
          {warns > 0 && <span style={{ color: 'var(--warn)' }}> · {warns} aviso(s)</span>}
        </span>
        <div className="spacer" />
        {progress && <span className="tiny">{progress}</span>}
        {progress ? <button className="btn" onClick={() => { cancel.current = true; }}>Cancelar</button> : <button className="btn" onClick={onClose}>Cerrar</button>}
        <button className="btn primary" disabled={!chosen.length || !!progress} onClick={run}><Download size={13} />Exportar</button>
      </>}>
      <Seg value={mode} onChange={setMode} full options={[
        { value: 'sections', label: 'Secciones (una imagen cada una)' },
        { value: 'continuous', label: 'Imagen continua' },
        { value: 'pdf', label: 'PDF de presentación' },
      ]} />
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        {mode !== 'pdf' && <Seg value={ext} onChange={setExt} options={[
          { value: 'jpg', label: 'JPG', title: 'Recomendado por Behance' }, { value: 'png', label: 'PNG' }, { value: 'webp', label: 'WebP', title: 'No figura entre los formatos recomendados por Behance' },
        ]} />}
        <Seg value={String(scale)} onChange={v => setScale(+v)} options={['0.5', '1', '1.5', '2'].map(v => ({ value: v, label: `${v.replace('.', ',')}× · ${Math.round(proj.sections[0].w * +v)} px` }))} />
      </div>
      {(ext !== 'png' || mode === 'pdf') && <Slider label={ext === 'webp' ? 'Calidad (compresión WebP)' : 'Calidad (compresión JPG)'} value={Math.round(quality * 100)} min={40} max={100} onChange={v => setQuality(v / 100)} suffix="%" hint="Menos calidad = archivos más ligeros" />}
      {ext === 'png' && mode !== 'pdf' && <div className="tiny muted">PNG sin pérdida: pesa más. Si una imagen pasa de 10 MB, prueba JPG.</div>}
      {mode === 'sections' && <Check checked={zip} onChange={setZip} label="Todas las secciones en un ZIP" />}
      {mode === 'continuous' && (
        <>
          <div className="row" style={{ gap: 8 }}>
            <span className="small grow">Alto máximo de cada segmento</span>
            <NumberField value={maxH} onChange={v => setSegH(Math.round(v))} min={500} max={autoSeg} digits={0} suffix="px" width={100}
              title={`Hasta ${autoSeg} px con este ancho: 32 MP por imagen (Behance) y lienzos de 16 000 px como mucho`} />
            {segH != null && <button className="btn sm ghost" onClick={() => setSegH(null)}>Automático</button>}
          </div>
          <div className="tiny muted">Las secciones se unen sin huecos. Si el total pasa de {maxH} px se divide en segmentos (por los límites entre secciones cuando se puede) para no superar los 32 MP por imagen ni los límites del navegador.</div>
          {outputs.length > 1 && <Check checked={zip} onChange={setZip} label="Segmentos en un ZIP" />}
        </>
      )}
      {mode === 'pdf' && <div className="tiny" style={{ color: 'var(--warn)' }}><AlertTriangle size={11} style={{ verticalAlign: -2 }} /> Behance no admite PDF como contenido de un proyecto: este PDF sirve para enviar o presentar el proyecto. Una página por sección.</div>}
      {crossing.length > 0 && (
        <div className="tiny row" style={{ gap: 4, alignItems: 'flex-start' }}><Icon level="warn" />
          {crossing.length} elemento(s) cruzan el límite entre secciones ({crossing.slice(0, 3).map(c => `«${c.item.name}»`).join(', ')}{crossing.length > 3 ? '…' : ''}): en imágenes separadas saldrán partidos. Si Behance muestra las imágenes sin separación encajarán; si no, usa la imagen continua o muévelos.
        </div>
      )}

      <div className="row">
        <b className="small grow">Secciones</b>
        <button className="btn sm ghost" onClick={() => { const all = proj.sections.every(a => picked.has(a.id)); proj.sections.forEach(a => toggle(a.id, !all)); }}>{proj.sections.every(a => picked.has(a.id)) ? 'Quitar todas' : 'Elegir todas'}</button>
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {proj.sections.map((a, i) => (
          <label key={a.id} className="chip" style={{ cursor: 'pointer', gap: 5 }}>
            <input type="checkbox" checked={picked.has(a.id)} onChange={e => toggle(a.id, e.target.checked)} />
            {String(i + 1).padStart(2, '0')} {a.name}
          </label>
        ))}
      </div>

      <div className="col social-export-list" style={{ gap: 8 }}>
        {mode === 'pdf' ? chosen.map((a, i) => (
          <div key={a.id} className="export-row">
            <Thumb doc={doc} ab={a} max={96} style={{ width: 44 }} />
            <span className="small grow">Página {i + 1} · {a.name}</span>
            <span className="tiny muted">{Math.round(a.w * scale)}×{Math.round(a.h * scale)}</span>
          </div>
        )) : outputs.map((out, i) => (
          <div key={out.key} className="export-row">
            <Thumb doc={doc} ab={out.sections[0]} max={96} style={{ width: 44 }} />
            <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
              <div className="row" style={{ gap: 6 }}>
                <span className="small mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{out.name}</span>
                <span className="tiny muted">{out.w}×{out.h} · {((out.w * out.h) / 1e6).toFixed(1)} MP</span>
                {sizes[out.key] != null ? <span className="tiny muted">{fmtBytes(sizes[out.key])}</span> : <span className="tiny muted">midiendo…</span>}
              </div>
              {mode === 'continuous' && <span className="tiny muted">{out.sections.map(a => a.name).join(' + ')}</span>}
              {checks[i].length === 0
                ? <span className="tiny" style={{ color: 'var(--ok)' }}><CheckCircle2 size={11} style={{ verticalAlign: -2 }} /> Dentro de lo que recomienda Behance</span>
                : checks[i].map((x, k) => <span key={k} className="tiny row" style={{ gap: 4, alignItems: 'flex-start' }}><Icon level={x.level} />{x.text}</span>)}
            </div>
          </div>
        ))}
        {!chosen.length && <div className="tiny muted">Elige al menos una sección.</div>}
      </div>
      <div className="tiny muted">
        Guía de Behance: JPG (recomendado) o PNG, {BEHANCE_GUIDE.maxRecommendedWidth} px de ancho o menos y menos de 10 MB por imagen; más de 50 MB o de 32 MP puede fallar. Las guías de sección nunca se exportan. Los archivos se guardan en tu equipo para subirlos a mano.
      </div>
    </Modal>
  );
}
