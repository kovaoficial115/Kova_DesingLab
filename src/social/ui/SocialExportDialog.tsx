import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, AlertTriangle, Info, XCircle, CheckCircle2 } from 'lucide-react';
import { useStore, useActiveDoc, toast } from '../../core/store';
import { Modal, Seg, Slider, Check } from '../../ui/components/controls';
import { platform } from '../../platform';
import { fileKeyFrom } from '../presets';
import { SERIES_LABEL } from '../model';
import { fmtBytes, type Issue } from '../validate';
import { exportItems, itemNames, checkItem, renderItem, renderPdfPages, buildZip, type SocialExt, type ExportItem } from '../exportSocial';
import { Thumb } from './SocialPanel';

const EXTS: { value: SocialExt; label: string }[] = [
  { value: 'png', label: 'PNG' }, { value: 'jpg', label: 'JPEG' }, { value: 'webp', label: 'WebP' }, { value: 'pdf', label: 'PDF' }, { value: 'svg', label: 'SVG' },
];

const IssueIcon = ({ level }: { level: Issue['level'] }) =>
  level === 'error' ? <XCircle size={12} style={{ color: 'var(--danger)', flex: 'none' }} /> : level === 'warn' ? <AlertTriangle size={12} style={{ color: 'var(--warn)', flex: 'none' }} /> : <Info size={12} className="muted" style={{ flex: 'none' }} />;

export function SocialExportDialog({ onClose }: { onClose: () => void }) {
  const doc = useActiveDoc();
  const user = useStore(s => s.socialFormats);
  const [includePlain, setIncludePlain] = useState(false);
  const items = useMemo(() => (doc ? exportItems(doc.state, includePlain) : []), [doc?.state, includePlain]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(items.map(i => i.ab.id)));
  const [ext, setExt] = useState<SocialExt>('png');
  const [scale, setScale] = useState(1);
  const [quality, setQuality] = useState(0.92);
  const [transparent, setTransparent] = useState(false);
  const [zip, setZip] = useState(true);
  const [onePdf, setOnePdf] = useState(true);
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [progress, setProgress] = useState<string | null>(null);
  const cancel = useRef(false);

  // las mesas que aparecen nuevas en la lista (p. ej. al incluir las que no son de redes) entran marcadas
  const seen = useRef(new Set(items.map(i => i.ab.id)));
  useEffect(() => setPicked(p => {
    const ids = new Set(items.map(i => i.ab.id));
    const n = new Set([...p].filter(id => ids.has(id)));
    for (const i of items) if (!seen.current.has(i.ab.id)) { seen.current.add(i.ab.id); n.add(i.ab.id); }
    return n;
  }), [items]);

  const chosen = items.filter(i => picked.has(i.ab.id));
  const names = useMemo(() => itemNames(items, ext, user, zip), [items, ext, user, zip]);
  const nameOf = (it: ExportItem) => names[items.indexOf(it)];
  const checks = useMemo(() => (doc ? items.map(it => checkItem(doc.state, it, scale, ext, user)) : []), [items, scale, ext, user, doc?.state]);
  const errors = chosen.reduce((n, it) => n + checks[items.indexOf(it)].filter(x => x.level === 'error').length, 0);
  const warns = chosen.reduce((n, it) => n + checks[items.indexOf(it)].filter(x => x.level === 'warn').length, 0);

  // peso real: se codifica cada imagen en segundo plano con las opciones elegidas
  useEffect(() => {
    if (!doc || ext === 'pdf' || ext === 'svg') { setSizes({}); return; }
    let stop = false;
    setSizes({});
    const t = setTimeout(async () => {
      for (const it of chosen) {
        if (stop) return;
        try {
          const b = await renderItem(doc.state, it, { ext, scale, quality, transparent });
          if (stop) return;
          setSizes(s => ({ ...s, [it.ab.id]: b.size }));
        } catch { /* se informa al exportar */ }
      }
    }, 350);
    return () => { stop = true; clearTimeout(t); };
  }, [doc?.state, ext, scale, quality, transparent, chosen.map(c => c.ab.id).join()]);

  if (!doc) return null;
  const total = chosen.reduce((n, it) => n + (sizes[it.ab.id] ?? 0), 0);
  const measured = chosen.every(it => sizes[it.ab.id] != null);
  const toggle = (id: string, v: boolean) => setPicked(p => { const n = new Set(p); v ? n.add(id) : n.delete(id); return n; });
  const base = fileKeyFrom(doc.name);

  const run = async () => {
    if (!chosen.length) return;
    cancel.current = false;
    const o = { ext, scale, quality, transparent };
    try {
      if (ext === 'pdf' && onePdf && chosen.length > 1) {
        const blob = await renderPdfPages(doc.state, chosen, o, doc.name, i => setProgress(`Página ${i + 1} de ${chosen.length}…`), () => cancel.current);
        if (blob) await platform.saveFile(blob, { suggestedName: `${base}.pdf`, pick: true, filters: [{ name: 'PDF', extensions: ['pdf'], mime: 'application/pdf' }] });
      } else {
        const files: { name: string; blob: Blob }[] = [];
        for (let i = 0; i < chosen.length; i++) {
          if (cancel.current) { toast('Exportación cancelada', 'info'); return; }
          setProgress(`Exportando ${i + 1} de ${chosen.length}…`);
          files.push({ name: nameOf(chosen[i]), blob: await renderItem(doc.state, chosen[i], o) });
        }
        if (files.length > 1 && zip) {
          setProgress('Creando ZIP…');
          const blob = await buildZip(files);
          await platform.saveFile(blob, { suggestedName: `${base}_redes.zip`, pick: true, filters: [{ name: 'ZIP', extensions: ['zip'], mime: 'application/zip' }] });
        } else {
          for (const f of files) {
            const r = await platform.saveFile(f.blob, { suggestedName: f.name, pick: files.length === 1 });
            if (r.status === 'cancelled') return;
          }
        }
      }
      toast(`Exportado: ${chosen.length} ${chosen.length === 1 ? 'imagen' : 'imágenes'}`, 'ok');
      onClose();
    } catch (e: any) {
      console.error(e);
      toast(e?.message || String(e), 'error', 6000);
    } finally { setProgress(null); }
  };

  // agrupado por serie para mostrarlo
  const groups: { key: string; title: string; list: ExportItem[] }[] = [];
  for (const it of items) {
    const g = groups.find(x => x.key === it.group);
    const ser = it.ab.social?.series;
    if (g) g.list.push(it);
    else groups.push({ key: it.group, title: ser ? `${ser.name} · ${SERIES_LABEL[ser.kind]}` : '', list: [it] });
  }

  return (
    <Modal title="Exportar para redes" icon={<Download size={16} />} onClose={progress ? () => { cancel.current = true; } : onClose} width={720} height="86vh"
      footer={<>
        <span className="tiny muted">
          {chosen.length} seleccionada(s)
          {ext !== 'pdf' && ext !== 'svg' && chosen.length > 0 && <> · {measured ? '' : '≥ '}{fmtBytes(total)}{measured ? '' : ' (midiendo…)'}</>}
          {errors > 0 && <span style={{ color: 'var(--danger)' }}> · {errors} error(es)</span>}
          {warns > 0 && <span style={{ color: 'var(--warn)' }}> · {warns} aviso(s)</span>}
        </span>
        <div className="spacer" />
        {progress && <span className="tiny">{progress}</span>}
        {progress ? <button className="btn" onClick={() => { cancel.current = true; }}>Cancelar</button> : <button className="btn" onClick={onClose}>Cerrar</button>}
        <button className="btn primary" disabled={!chosen.length || !!progress} onClick={run}><Download size={13} />Exportar</button>
      </>}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <Seg value={ext} onChange={setExt} options={EXTS} />
        <Seg value={String(scale) as '1' | '2' | '0.5'} onChange={v => setScale(+v)} options={[{ value: '0.5', label: '0,5×' }, { value: '1', label: '1×' }, { value: '2', label: '2×' }]} />
      </div>
      {(ext === 'jpg' || ext === 'webp' || ext === 'pdf') && <Slider label="Calidad" value={Math.round(quality * 100)} min={40} max={100} onChange={v => setQuality(v / 100)} suffix="%" />}
      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        {(ext === 'png' || ext === 'webp') && <Check checked={transparent} onChange={setTransparent} label="Fondo transparente" />}
        {ext === 'pdf' ? <Check checked={onePdf} onChange={setOnePdf} label="Un solo PDF con una página por mesa" /> : <Check checked={zip} onChange={setZip} label="Varias imágenes en un ZIP" />}
        <Check checked={includePlain} onChange={setIncludePlain} label="Incluir mesas sin formato de redes" />
      </div>
      <div className="col social-export-list" style={{ gap: 10 }}>
        {groups.map(g => (
          <div key={g.key} className="col" style={{ gap: 4 }}>
            {g.title && (
              <div className="row">
                <b className="small grow">{g.title}</b>
                <button className="btn sm ghost" onClick={() => { const all = g.list.every(it => picked.has(it.ab.id)); g.list.forEach(it => toggle(it.ab.id, !all)); }}>{g.list.every(it => picked.has(it.ab.id)) ? 'Quitar todas' : 'Elegir todas'}</button>
              </div>
            )}
            {g.list.map(it => {
              const iss = checks[items.indexOf(it)];
              return (
                <label key={it.ab.id} className="export-row">
                  <input type="checkbox" checked={picked.has(it.ab.id)} onChange={e => toggle(it.ab.id, e.target.checked)} />
                  <Thumb doc={doc} ab={it.ab} max={96} style={{ width: 44 }} />
                  <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
                    <div className="row" style={{ gap: 6 }}>
                      <span className="small mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ext === 'pdf' && onePdf && chosen.length > 1 ? `${base}.pdf · pág. ${chosen.indexOf(it) + 1}` : nameOf(it)}</span>
                      <span className="tiny muted">{Math.round(it.ab.w * scale)}×{Math.round(it.ab.h * scale)}</span>
                      {sizes[it.ab.id] != null && <span className="tiny muted">{fmtBytes(sizes[it.ab.id])}</span>}
                    </div>
                    {iss.length === 0
                      ? <span className="tiny" style={{ color: 'var(--ok)' }}><CheckCircle2 size={11} style={{ verticalAlign: -2 }} /> Listo para subir</span>
                      : iss.map((x, k) => <span key={k} className="tiny row" style={{ gap: 4, alignItems: 'flex-start' }}><IssueIcon level={x.level} />{x.text}</span>)}
                  </div>
                </label>
              );
            })}
          </div>
        ))}
        {!items.length && <div className="tiny muted">No hay mesas con formato de redes. Asigna un formato desde el panel Redes o marca «Incluir mesas sin formato».</div>}
      </div>
      <div className="tiny muted">Los archivos se guardan en tu equipo para subirlos a mano. Las guías y zonas seguras nunca se exportan.</div>
    </Modal>
  );
}
