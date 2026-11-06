import React, { useEffect, useState } from 'react';
import { Box, CheckCircle2, AlertTriangle, XCircle, FileUp } from 'lucide-react';
import { Modal, NumberField, Select } from '../ui/components/controls';
import { pickFiles } from '../io/fileOps';
import { toast } from '../core/store';
import { readConfigFile, inspectGarment, addGarment, type GarmentEntry } from './garments';
import type { GarmentConfig } from './config';
import type { ValidationReport } from './validate';

const ICON = { ok: CheckCircle2, warn: AlertTriangle, fail: XCircle };
const CATS: { value: GarmentConfig['category']; label: string }[] = [
  { value: 'tshirt', label: 'Camiseta' }, { value: 'hoodie', label: 'Hoodie' }, { value: 'sport', label: 'Deportiva' },
  { value: 'crop', label: 'Crop' }, { value: 'longsleeve', label: 'Manga larga' }, { value: 'other', label: 'Otra' },
];

/** Importar un GLB (+ garment.json opcional): se valida con la lista de aceptación antes de guardarlo. */
export function ImportGarmentDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (e: GarmentEntry) => void }) {
  const [glb, setGlb] = useState<File | null>(null);
  const [config, setConfig] = useState<GarmentConfig | null>(null);
  const [cfgErrors, setCfgErrors] = useState<string[]>([]);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [busy, setBusy] = useState(false);

  const choose = async () => {
    const files = await pickFiles(true, '.glb,.json,model/gltf-binary,application/json');
    const g = files.find(f => /\.glb$/i.test(f.name));
    if (!g) { if (files.length) toast('Elige un archivo .glb (y, si lo tienes, su garment.json)', 'warn'); return; }
    const { config: c, errors } = await readConfigFile(files.find(f => /\.json$/i.test(f.name)), g.name);
    setGlb(g); setConfig(c); setCfgErrors(errors); setReport(null);
  };

  // se valida de nuevo cada vez que cambia la configuración (p. ej. la escala)
  useEffect(() => {
    if (!glb || !config) return;
    let alive = true;
    setBusy(true);
    inspectGarment(glb, config)
      .then(r => { if (alive) setReport(r); })
      .catch(e => { if (alive) { setReport(null); toast('No se pudo leer el modelo: ' + (e?.message || e), 'error'); } })
      .finally(() => alive && setBusy(false));
    return () => { alive = false; };
  }, [glb, config]);

  const add = async () => {
    if (!glb || !config || !report?.accepted) return;
    setBusy(true);
    try { const e = await addGarment(glb, config, report); toast(`«${config.name}» añadida a la biblioteca`, 'ok'); onAdded(e); onClose(); }
    catch (e: any) { toast(e.message, 'error'); setBusy(false); }
  };

  return (
    <Modal title="Importar prenda 3D" icon={<Box size={16} />} onClose={onClose} width={640}
      footer={<>
        <span className="tiny muted">{report && !report.accepted ? 'No se puede añadir: corrige los puntos en rojo en el modelo o en su garment.json.' : 'Los modelos se guardan en la biblioteca local de este equipo.'}</span>
        <div className="spacer" />
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={!report?.accepted || busy} onClick={add}>Añadir a la biblioteca</button>
      </>}>
      <div className="row">
        <button className="btn" onClick={choose}><FileUp size={14} />{glb ? 'Cambiar archivos…' : 'Elegir GLB y garment.json…'}</button>
        <span className="small muted grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{glb ? `${glb.name} · ${(glb.size / 1048576).toFixed(1)} MB` : 'GLB obligatorio; garment.json opcional (zonas, escala, licencia).'}</span>
      </div>
      {cfgErrors.map(e => <div key={e} className="chip warn">{e}</div>)}
      {config && (
        <div className="grid3">
          <label className="col small" style={{ gap: 4 }}>Nombre<input className="input" value={config.name} onChange={e => setConfig({ ...config, name: e.target.value })} onKeyDown={e => e.stopPropagation()} /></label>
          <label className="col small" style={{ gap: 4 }}>Tipo<Select value={config.category} onChange={v => setConfig({ ...config, category: v })} options={CATS} /></label>
          <label className="col small" style={{ gap: 4 }} title="Metros por unidad del modelo (1 si ya está en metros)">Escala (m / unidad)
            <NumberField value={config.unitScale} digits={4} step={0.001} min={0.0001} onChange={v => v > 0 && setConfig({ ...config, unitScale: v })} />
          </label>
        </div>
      )}
      {busy && !report && <div className="row small muted"><div className="spinner" />Analizando el modelo…</div>}
      {report && (
        <div className="col" style={{ gap: 6 }} aria-live="polite">
          {report.checks.map(c => {
            const I = ICON[c.status];
            return (
              <div key={c.id} className={'check-item check-' + c.status}>
                <I size={15} className="ic" />
                <div className="grow"><div className="small" style={{ fontWeight: 600 }}>{c.label}</div><div className="tiny muted">{c.detail}</div></div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
