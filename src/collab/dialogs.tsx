// Diálogos de colaboración: identidad, compartir (invitaciones, miembros, roles) y versiones.

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { useBroadcastEvent, useOthers, useStorage } from '@liveblocks/react';
import { Copy, History, KeyRound, Link2, LogOut, RotateCcw, Save, Trash2, UserRound, Users } from 'lucide-react';
import { Modal, Select } from '../ui/components/controls';
import { set, toast } from '../core/store';
import type { CollabRole, Doc } from '../core/types';
import * as api from './api';
import { getSession } from './engine';

const COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#748ffc', '#b197fc', '#f783ac', '#d7f25c', '#63e6be', '#ff8787'];
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?';

async function copy(text: string, msg = 'Enlace copiado') {
  try { await navigator.clipboard.writeText(text); toast(msg, 'ok'); }
  catch { prompt('Copia el enlace:', text); }
}
const useIdentity = () => useSyncExternalStore(api.subscribeIdentity, api.getIdentity);

// ---------- identidad ----------
export function IdentityDialog({ onClose }: { onClose: () => void }) {
  const id = useIdentity();
  const [name, setName] = useState(id?.user.name ?? '');
  const [color, setColor] = useState(id?.user.color ?? COLORS[Math.floor(Math.random() * COLORS.length)]);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const close = () => { api.cancelIdentity(); onClose(); };
  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try { await api.saveName(name.trim(), color); onClose(); toast('Listo: así te verán los demás', 'ok'); }
    catch (e: any) { toast(e.message, 'error', 6000); }
    finally { setBusy(false); }
  };
  const useKey = async () => {
    setBusy(true);
    try { const r = await api.importKey(key); await api.saveName(r.user.name, r.user.color); onClose(); toast(`Bienvenido de nuevo, ${r.user.name}`, 'ok'); }
    catch (e: any) { toast(e?.message || 'Clave no válida', 'error'); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Tu perfil de colaboración" icon={<UserRound size={16} />} onClose={close} width={440}
      footer={<><button className="btn" onClick={close}>Cancelar</button><button className="btn primary" disabled={!name.trim() || busy} onClick={save}>{id ? 'Guardar' : 'Continuar'}</button></>}>
      <div className="col" style={{ gap: 12 }}>
        <span className="small muted">Tu nombre y tu color identifican tu cursor y tus selecciones para las demás personas del proyecto.</span>
        <div className="row" style={{ gap: 10 }}>
          <span className="avatar lg" style={{ background: color }}>{initials(name || '?')}</span>
          <input className="input grow" autoFocus maxLength={40} placeholder="Tu nombre" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); }} />
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {COLORS.map(c => <button key={c} className={'swatch-btn' + (c === color ? ' on' : '')} style={{ background: c }} onClick={() => setColor(c)} title={c} />)}
        </div>
        <div className="card col" style={{ gap: 8 }}>
          <div className="row small"><KeyRound size={13} /><b>Clave de acceso</b></div>
          <span className="tiny muted">Tu identidad vive en este navegador. Con la clave puedes usarla en otro equipo y conservar tus proyectos y tu rol de propietario. No la compartas: quien la tenga actúa en tu nombre.</span>
          <div className="row">
            {id && <button className="btn sm" onClick={() => copy(api.exportKey(), 'Clave copiada. Guárdala en un lugar seguro.')}><Copy size={12} />Copiar mi clave</button>}
            <button className="btn sm ghost" onClick={() => setShowKey(v => !v)}>Usar una clave de otro equipo</button>
          </div>
          {showKey && (
            <div className="row">
              <input className="input grow" placeholder="Pega aquí tu clave" value={key} onChange={e => setKey(e.target.value)} />
              <button className="btn sm" disabled={!key.trim() || busy} onClick={useKey}>Usar</button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ---------- compartir ----------
export function ShareDialog({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  const c = doc.collab!;
  const me = useIdentity();
  const others = useOthers();
  const broadcast = useBroadcastEvent();
  const [members, setMembers] = useState<api.Member[] | null>(null);
  const [links, setLinks] = useState<{ editor?: string; viewer?: string }>({});
  const [name, setName] = useState(doc.name);
  const isOwner = c.role === 'owner';
  const canEdit = c.role !== 'viewer';
  const online = new Set(others.map(o => o.id));

  const load = () => api.getRoom(c.room).then(r => {
    setMembers(r.members);
    if (r.role && r.role !== c.role) set(s => ({ docs: s.docs.map(d => (d.id === doc.id && d.collab ? { ...d, collab: { ...d.collab, role: r.role! } } : d)) }));
  }).catch(e => toast(e.message, 'error'));
  useEffect(() => { load(); }, [c.room]);

  const makeLink = async (role: 'editor' | 'viewer') => {
    try {
      const { token } = await api.createInvite(c.room, role);
      const url = api.inviteLink(token);
      setLinks(l => ({ ...l, [role]: url }));
      await copy(url, `Enlace de ${role === 'editor' ? 'edición' : 'solo lectura'} copiado`);
    } catch (e: any) { toast(e.message, 'error'); }
  };
  const changeRole = async (m: api.Member, role: 'editor' | 'viewer' | null) => {
    if (role === null && !confirm(`¿Quitar a ${m.name} del proyecto?`)) return;
    try {
      const r = await api.setMemberRole(c.room, m.id, role);
      setMembers(r.members);
      broadcast({ type: 'access-changed', userId: m.id });
      toast(role ? `${m.name} ahora es ${api.roleLabel(role)}` : `${m.name} ya no tiene acceso`, 'ok');
    } catch (e: any) { toast(e.message, 'error'); }
  };
  const rename = async () => {
    const n = name.trim();
    if (!n || n === doc.name) return;
    try { await api.renameRoom(c.room, n); set(s => ({ docs: s.docs.map(d => (d.id === doc.id ? { ...d, name: n } : d)) })); }
    catch (e: any) { toast(e.message, 'error'); }
  };
  const leave = async () => {
    if (!confirm('¿Salir de este proyecto? Necesitarás una nueva invitación para volver.')) return;
    try { await api.leaveRoom(c.room); onClose(); set(s => ({ docs: s.docs.filter(d => d.id !== doc.id), activeDocId: s.docs.find(d => d.id !== doc.id)?.id ?? null, screen: s.docs.length > 1 ? 'editor' : 'home' })); }
    catch (e: any) { toast(e.message, 'error'); }
  };
  const remove = async () => {
    if (!confirm('¿Eliminar el proyecto compartido para todas las personas? Tu copia abierta se conserva como documento local.')) return;
    try {
      broadcast({ type: 'access-changed', userId: '*' });
      await api.deleteRoom(c.room);
      onClose();
      set(s => ({ docs: s.docs.map(d => (d.id === doc.id ? { ...d, collab: undefined, dirty: true } : d)) }));
      toast('Proyecto compartido eliminado. Queda como documento local.', 'ok');
    } catch (e: any) { toast(e.message, 'error'); }
  };

  return (
    <Modal title="Compartir proyecto" icon={<Users size={16} />} onClose={onClose} width={520}
      footer={<button className="btn primary" onClick={onClose}>Listo</button>}>
      <div className="col" style={{ gap: 14 }}>
        <div className="col" style={{ gap: 4 }}>
          <span className="tiny muted">Nombre del proyecto</span>
          <input className="input" value={name} disabled={!canEdit} onChange={e => setName(e.target.value)} onBlur={rename} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        </div>

        {isOwner ? (
          <div className="col" style={{ gap: 8 }}>
            <div className="row small"><Link2 size={13} /><b>Invitar con un enlace</b></div>
            {(['editor', 'viewer'] as const).map(role => (
              <div key={role} className="share-row">
                <div className="col grow" style={{ gap: 1 }}>
                  <span className="small" style={{ fontWeight: 600 }}>{role === 'editor' ? 'Pueden editar' : 'Solo pueden ver'}</span>
                  <span className="tiny muted">{role === 'editor' ? 'Modifican capas, mesas y textos en tiempo real' : 'Ven el documento y su cursor, sin modificarlo'}</span>
                  {links[role] && <input className="input tiny" readOnly value={links[role]} onFocus={e => e.target.select()} style={{ marginTop: 4 }} />}
                </div>
                <button className="btn sm" onClick={() => makeLink(role)}><Copy size={12} />Copiar enlace</button>
              </div>
            ))}
            <div className="row">
              <span className="tiny muted grow">Quien abra el enlace elige su nombre y entra con ese rol.</span>
              <button className="btn sm ghost" title="Los enlaces que ya enviaste dejarán de funcionar" onClick={async () => {
                if (!confirm('¿Desactivar todos los enlaces de invitación enviados? Los miembros actuales conservan su acceso.')) return;
                try { await api.resetInvites(c.room); setLinks({}); toast('Enlaces anteriores desactivados', 'ok'); } catch (e: any) { toast(e.message, 'error'); }
              }}><RotateCcw size={12} />Desactivar enlaces</button>
            </div>
          </div>
        ) : (
          <div className="card small muted">Solo el propietario puede invitar a más personas. Tu rol: <b style={{ color: 'var(--text)' }}>{api.roleLabel(c.role)}</b>.</div>
        )}

        <div className="col" style={{ gap: 6 }}>
          <div className="row small"><Users size={13} /><b>Personas con acceso</b>{members && <span className="tiny muted">{members.length}</span>}</div>
          {!members ? <span className="tiny muted">Cargando…</span> : members.map(m => (
            <div key={m.id} className="row small member-row">
              <span className="avatar" style={{ background: 'var(--panel-4)' }}>{initials(m.name)}</span>
              <span className="grow">{m.name}{m.id === me?.user.id ? ' (tú)' : ''}</span>
              {online.has(m.id) && <span className="tiny" style={{ color: 'var(--ok)' }}>● en línea</span>}
              {isOwner && m.role !== 'owner' ? (
                <>
                  <Select<CollabRole> value={m.role} onChange={v => changeRole(m, v as 'editor' | 'viewer')} options={[{ value: 'editor', label: 'Editor' }, { value: 'viewer', label: 'Lector' }]} width={100} />
                  <button className="icon-btn sm" title="Quitar acceso" onClick={() => changeRole(m, null)}><Trash2 size={12} /></button>
                </>
              ) : <span className="tiny muted" style={{ width: 100, textAlign: 'right' }}>{api.roleLabel(m.role)}</span>}
            </div>
          ))}
          {isOwner && members && members.length > 1 && (
            <span className="tiny muted">Los cambios de rol se aplican al momento en la app, pero Liveblocks puede tardar hasta un minuto en aplicarlos en su servidor.</span>
          )}
        </div>

        <div className="row" style={{ gap: 6 }}>
          <button className="btn sm" onClick={() => copy(api.roomLink(c.room), 'Enlace del proyecto copiado (solo funciona para miembros)')}><Link2 size={12} />Copiar enlace del proyecto</button>
          <button className="btn sm ghost" onClick={() => set({ dialog: { type: 'collab-identity' } })}><UserRound size={12} />Mi perfil</button>
          <div className="grow" />
          {isOwner
            ? <button className="btn sm ghost danger" onClick={remove}><Trash2 size={12} />Eliminar proyecto</button>
            : <button className="btn sm ghost danger" onClick={leave}><LogOut size={12} />Salir del proyecto</button>}
        </div>
      </div>
    </Modal>
  );
}

// ---------- versiones ----------
export function VersionsDialog({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  const versions = useStorage(root => root.versions) as readonly any[] | null;
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const session = getSession(doc.id);
  const canWrite = !!session?.writable;
  const list = [...(versions ?? [])].sort((a, b) => b.at - a.at);
  const save = async () => {
    if (!session) return;
    setBusy('save');
    try { await session.saveVersion(label.trim() || 'Versión guardada'); setLabel(''); toast('Versión guardada', 'ok'); }
    catch (e: any) { toast(e.message, 'error'); }
    finally { setBusy(null); }
  };
  const restore = async (v: any) => {
    if (!session || !confirm(`¿Restaurar «${v.label || 'versión'}» del ${new Date(v.at).toLocaleString()}? Se aplica para todas las personas; puedes deshacerlo con ⌘Z.`)) return;
    setBusy(v.id);
    try {
      await session.saveVersion('Antes de restaurar', true).catch(() => {});
      await session.restoreVersion(v);
      toast('Versión restaurada', 'ok');
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setBusy(null); }
  };
  return (
    <Modal title="Historial de versiones" icon={<History size={16} />} onClose={onClose} width={500} height={560}>
      <div className="col" style={{ gap: 12, height: '100%' }}>
        <span className="small muted">Los cambios se guardan solos en la nube mientras trabajas. Las versiones son instantáneas para volver atrás: se crea una automáticamente cada 10 minutos de actividad.</span>
        {canWrite && (
          <div className="row">
            <input className="input grow" placeholder="Nombre de la versión (opcional)" value={label} maxLength={80} onChange={e => setLabel(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); }} />
            <button className="btn primary sm" disabled={!!busy} onClick={save}><Save size={12} />{busy === 'save' ? 'Guardando…' : 'Guardar versión'}</button>
          </div>
        )}
        <div className="col version-list" style={{ gap: 6, overflow: 'auto', flex: 1 }}>
          {versions === null ? <span className="tiny muted">Cargando…</span> : !list.length ? <span className="tiny muted">Aún no hay versiones guardadas.</span> : list.map(v => (
            <div key={v.id} className="row version-row">
              {v.thumb ? <img src={v.thumb} /> : <div className="thumb-ph" />}
              <div className="col grow" style={{ gap: 1, minWidth: 0 }}>
                <span className="small" style={{ fontWeight: 600 }}>{v.label || 'Versión'}{v.auto && <span className="tiny muted"> · automática</span>}</span>
                <span className="tiny muted">{new Date(v.at).toLocaleString()} · {v.byName} · {v.layers} capas</span>
              </div>
              {canWrite && <button className="btn sm" disabled={!!busy} onClick={() => restore(v)}><RotateCcw size={12} />{busy === v.id ? 'Restaurando…' : 'Restaurar'}</button>}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
