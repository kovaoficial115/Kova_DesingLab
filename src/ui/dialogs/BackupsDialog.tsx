import React, { useEffect, useState } from 'react';
import { History, FolderOpen, Download, Trash2 } from 'lucide-react';
import { Modal } from '../components/controls';
import { storage, type BackupMeta } from '../../storage';
import { platform } from '../../platform';
import { deserializeDoc } from '../../io/project';
import { addDoc } from '../../core/actions';
import { get, toast, withBusy } from '../../core/store';
import { reasonLabel } from '../../io/library';

/** Copias de respaldo de la biblioteca: el original antes de actualizar su formato y la
 *  versión anterior de cada proyecto guardado. Abrirlas nunca modifica la copia. */
export function BackupsDialog({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<BackupMeta[] | null>(null);
  const refresh = () => storage.backups.list().then(setItems).catch(e => { toast(e.message, 'error'); setItems([]); });
  useEffect(() => { refresh(); }, []);

  const open = (b: BackupMeta) => withBusy('Abriendo copia…', async () => {
    const rec = await storage.backups.get(b.key);
    if (!rec) return;
    const doc = await deserializeDoc(rec.data, { onWarning: m => toast(m, 'warn') });
    // se abre como documento nuevo para no confundirlo con el proyecto actual
    if (get().docs.some(d => d.id === doc.id)) doc.id = `${doc.id}_${Date.now().toString(36)}`;
    addDoc({ ...doc, name: `${doc.name} (copia ${new Date(b.created).toLocaleDateString()})`, dirty: true });
    onClose();
  });
  const download = async (b: BackupMeta) => {
    const rec = await storage.backups.get(b.key);
    if (rec) await platform.saveFile(new Blob([rec.data], { type: 'application/json' }), { suggestedName: `${rec.name} (respaldo).kova`, pick: true, filters: [{ name: 'Proyecto Kova', extensions: ['kova'], mime: 'application/json' }] });
  };
  const remove = async (b: BackupMeta) => {
    if (!confirm(`¿Eliminar esta copia de «${b.name}»?`)) return;
    await storage.backups.delete(b.key);
    refresh();
  };

  return (
    <Modal title="Copias de respaldo" icon={<History size={16} />} onClose={onClose} width={620}>
      <span className="small muted">Se guardan solas: el original de un proyecto antes de actualizar su formato y la versión anterior cada vez que lo guardas en la biblioteca. Abrir una copia crea un documento nuevo.</span>
      {items === null ? <span className="tiny muted">Cargando…</span> : items.length === 0 ? <span className="tiny muted">Aún no hay copias de respaldo.</span> : (
        <div className="col" style={{ gap: 6 }}>
          {items.map(b => (
            <div key={b.key} className="row share-row">
              <div className="grow">
                <div className="small" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</div>
                <div className="tiny muted">{reasonLabel(b.reason)} · formato {b.schema} · {new Date(b.created).toLocaleString()}</div>
              </div>
              <button className="btn sm" onClick={() => open(b)}><FolderOpen size={12} />Abrir</button>
              <button className="icon-btn sm" title="Descargar como .kova" aria-label="Descargar como .kova" onClick={() => download(b)}><Download size={12} /></button>
              <button className="icon-btn sm" title="Eliminar copia" aria-label="Eliminar copia" onClick={() => remove(b)}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
