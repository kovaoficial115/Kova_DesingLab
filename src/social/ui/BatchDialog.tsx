import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Table2, FileUp, ImagePlus, Download, LayoutGrid } from 'lucide-react';
import { useActiveDoc, toast, useStore } from '../../core/store';
import { Modal, Seg, Slider } from '../../ui/components/controls';
import { pickFiles } from '../../io/fileOps';
import { blobToCanvas } from '../../core/util';
import { renderArtboard } from '../../core/render';
import { exportArtboard } from '../../io/exporters';
import { platform } from '../../platform';
import { findFormat, fileKeyFrom } from '../presets';
import { parseRows, rowFileName, BUILTIN_VARS, type Row } from '../variables';
import { analyzeTemplate, applyRow, releaseBatch, createRowArtboards, imageKey, matchImage } from '../batch';
import { buildZip } from '../exportSocial';

const MAX_ROWS = 500;
const MAX_ARTBOARDS = 60;

export function BatchDialog({ onClose }: { onClose: () => void }) {
  const doc = useActiveDoc();
  const user = useStore(s => s.socialFormats);
  const ab = doc?.state.artboards.find(a => a.id === doc.state.activeArtboardId);
  const info = useMemo(() => (doc && ab ? analyzeTemplate(doc.state, ab) : null), [doc?.state, ab]);
  const [src, setSrc] = useState('');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState('');
  const [images, setImages] = useState(new Map<string, HTMLCanvasElement>());
  const [row, setRow] = useState(0);
  const [ext, setExt] = useState<'png' | 'jpg'>('png');
  const [quality, setQuality] = useState(0.9);
  const [progress, setProgress] = useState<string | null>(null);
  const cancel = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [missing, setMissing] = useState<string[]>([]);

  const parse = (text: string, name = '') => {
    setSrc(text); setFileName(name);
    if (!text.trim()) { setRows([]); setErr(''); return; }
    try {
      const r = parseRows(text, name);
      if (!r.length) { setErr('No se encontraron filas (el CSV necesita una fila de encabezados y al menos una de datos).'); setRows([]); return; }
      if (r.length > MAX_ROWS) toast(`Se usan las primeras ${MAX_ROWS} filas`, 'warn');
      setRows(r.slice(0, MAX_ROWS)); setErr(''); setRow(0);
    } catch (e: any) { setErr(e.message); setRows([]); }
  };

  // vista previa de la fila elegida
  useEffect(() => {
    if (!doc || !ab || !info || !rows.length) return;
    let on = true;
    const { state, missing } = applyRow(doc.state, info, rows[Math.min(row, rows.length - 1)], images);
    setMissing(missing);
    renderArtboard(state, ab, Math.min(1, 300 / Math.max(ab.w, ab.h))).then(c => {
      const el = canvasRef.current;
      if (!on || !el) return;
      el.width = c.width; el.height = c.height;
      const g = el.getContext('2d')!;
      g.clearRect(0, 0, c.width, c.height);
      g.drawImage(c, 0, 0);
    });
    return () => { on = false; };
  }, [doc?.state, ab, info, rows, row, images]);
  useEffect(() => () => { if (info) releaseBatch(info); }, [info]);

  if (!doc || !ab || !info) return null;
  const f = findFormat(ab.social?.preset, user);
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const used = [...info.textVars, ...info.imageSlots.map(s => s.varName)];
  const noColumn = used.filter(v => v !== 'fecha' && columns.length && !columns.includes(v));
  const digits = String(rows.length).length;
  const names = rows.map((r, i) => `${f ? f.fileKey : fileKeyFrom(ab.name)}_${rowFileName(r, i, Math.max(2, digits))}`);

  const addImages = async () => {
    const files = await pickFiles(true, 'image/*');
    if (!files.length) return;
    const m = new Map(images);
    for (const file of files) {
      try { m.set(imageKey(file.name), await blobToCanvas(file)); m.set(imageKey(file.name.replace(/\.[^.]+$/, '')), m.get(imageKey(file.name))!); }
      catch { toast(`No se pudo leer ${file.name}`, 'warn'); }
    }
    setImages(m);
  };

  const exportZip = async () => {
    cancel.current = false;
    const files: { name: string; blob: Blob }[] = [];
    try {
      for (let i = 0; i < rows.length; i++) {
        if (cancel.current) { toast('Generación cancelada', 'info'); return; }
        setProgress(`Generando ${i + 1} de ${rows.length}…`);
        const { state } = applyRow(doc.state, info, rows[i], images);
        const blob = await exportArtboard(state, ab, { format: ext, dpi: ab.dpi, quality, background: 'artboard', filename: names[i] });
        files.push({ name: `${names[i]}.${ext}`, blob });
      }
      setProgress('Creando ZIP…');
      await platform.saveFile(await buildZip(files), { suggestedName: `${fileKeyFrom(doc.name)}_lote.zip`, pick: true, filters: [{ name: 'ZIP', extensions: ['zip'], mime: 'application/zip' }] });
      toast(`${files.length} diseño(s) generados`, 'ok');
      onClose();
    } catch (e: any) { toast(e?.message || String(e), 'error', 6000); }
    finally { setProgress(null); releaseBatch(info); }
  };

  const toDoc = () => {
    if (rows.length > MAX_ARTBOARDS) return toast(`Para crear mesas en el documento usa hasta ${MAX_ARTBOARDS} filas (o exporta el lote en ZIP)`, 'warn');
    createRowArtboards(doc.state, ab, info, rows, images, rows.map((r, i) => r.producto || r.nombre || `${ab.name} ${i + 1}`));
    toast(`${rows.length} mesa(s) creadas, editables`, 'ok');
    onClose();
  };

  const empty = !info.textVars.length && !info.imageSlots.length;
  return (
    <Modal title={`Plantilla con variables · «${ab.name}»`} icon={<Table2 size={16} />} onClose={progress ? () => { cancel.current = true; } : onClose} width={780} height="88vh"
      footer={<>
        <span className="tiny muted">{rows.length ? `${rows.length} fila(s)` : 'Sin datos'}{progress ? ` · ${progress}` : ''}</span>
        <div className="spacer" />
        {progress ? <button className="btn" onClick={() => { cancel.current = true; }}>Cancelar</button> : <button className="btn" onClick={onClose}>Cerrar</button>}
        <button className="btn" disabled={!rows.length || empty || !!progress} onClick={toDoc} title="Una mesa editable por fila en este documento"><LayoutGrid size={13} />Crear mesas</button>
        <button className="btn primary" disabled={!rows.length || empty || !!progress} onClick={exportZip}><Download size={13} />Exportar ZIP</button>
      </>}>
      <div className="tiny muted">
        Escribe variables en los textos de la mesa, p. ej. <span className="mono">{'{{producto}}'}</span>, <span className="mono">{'{{precio}}'}</span>, <span className="mono">{'{{descripcion}}'}</span>, <span className="mono">{'{{coleccion}}'}</span>; <span className="mono">{'{{fecha}}'}</span> se rellena con la fecha de hoy si no viene en los datos.
        Para cambiar una imagen, nombra su capa <span className="mono">{'{{imagen}}'}</span> y pon en esa columna el nombre del archivo.
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        <span className="small">En esta mesa:</span>
        {empty ? <span className="tiny" style={{ color: 'var(--warn)' }}>no hay variables. Añade textos con {'{{…}}'} o una capa de imagen llamada {'{{imagen}}'}.</span>
          : <>
            {info.textVars.map(v => <span key={v} className={'chip' + (noColumn.includes(v) ? ' warn' : ' ok')}>{`{{${v}}}`}</span>)}
            {info.imageSlots.map(s => <span key={s.layerId} className={'chip' + (noColumn.includes(s.varName) ? ' warn' : ' ok')} title={`Capa «${s.name}»`}><ImagePlus size={10} />{`{{${s.varName}}}`}</span>)}
          </>}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn sm" onClick={async () => { const [file] = await pickFiles(false, '.csv,.json,.tsv,.txt'); if (file) parse(await file.text(), file.name); }}><FileUp size={12} />Abrir CSV o JSON…</button>
        {info.imageSlots.length > 0 && <button className="btn sm" onClick={addImages}><ImagePlus size={12} />Añadir imágenes… {images.size ? `(${new Set(images.values()).size})` : ''}</button>}
        {fileName && <span className="tiny muted">{fileName}</span>}
      </div>
      <textarea className="input mono" rows={5} value={src} onChange={e => parse(e.target.value)} placeholder={'O pega aquí los datos. Ejemplo de formato:\nproducto,precio,imagen\n…'} style={{ resize: 'vertical', fontSize: 11 }} />
      {err && <div className="tiny" style={{ color: 'var(--danger)' }}>{err}</div>}
      {noColumn.length > 0 && <div className="tiny" style={{ color: 'var(--warn)' }}>Los datos no tienen columna para: {noColumn.join(', ')}. Columnas: {columns.join(', ')}.</div>}
      {rows.length > 0 && (
        <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
          <div className="col" style={{ gap: 6, alignItems: 'center' }}>
            <canvas ref={canvasRef} className="social-thumb" style={{ maxWidth: 240, maxHeight: 300 }} />
            <div className="row" style={{ gap: 4 }}>
              <button className="btn sm" disabled={row <= 0} onClick={() => setRow(row - 1)}>‹</button>
              <span className="tiny">Fila {row + 1} de {rows.length}</span>
              <button className="btn sm" disabled={row >= rows.length - 1} onClick={() => setRow(row + 1)}>›</button>
            </div>
            {missing.length > 0 && <div className="tiny" style={{ color: 'var(--warn)', maxWidth: 240 }}>Sin valor: {missing.join(', ')}</div>}
          </div>
          <div className="col grow" style={{ gap: 6, minWidth: 0 }}>
            <div className="batch-table">
              <table>
                <thead><tr><th>#</th>{columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>{rows.slice(0, 50).map((r, i) => (
                  <tr key={i} className={i === row ? 'on' : ''} onClick={() => setRow(i)}><td>{i + 1}</td>{columns.map(c => <td key={c}>{c === 'imagen' && r[c] ? (matchImage(r[c], images) ? '✓ ' : '✗ ') + r[c] : r[c]}</td>)}</tr>
                ))}</tbody>
              </table>
              {rows.length > 50 && <div className="tiny muted">… y {rows.length - 50} filas más</div>}
            </div>
            <div className="row" style={{ gap: 8 }}>
              <Seg value={ext} onChange={setExt} options={[{ value: 'png', label: 'PNG' }, { value: 'jpg', label: 'JPEG' }]} />
              <span className="tiny muted mono grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{names[row]}.{ext}</span>
            </div>
            {ext === 'jpg' && <Slider label="Calidad" value={Math.round(quality * 100)} min={40} max={100} onChange={v => setQuality(v / 100)} suffix="%" />}
          </div>
        </div>
      )}
      <div className="tiny muted">Variables habituales: {BUILTIN_VARS.map(v => `{{${v}}}`).join(' ')}. Puedes usar cualquier otra columna de tus datos.</div>
    </Modal>
  );
}
