// Pantalla de inicio: proyectos compartidos a los que tengo acceso (recuperación desde cualquier equipo).
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Users, UserRound, RefreshCw, Link2 } from 'lucide-react';
import { set, toast } from '../core/store';
import * as api from './api';
import { collabConfigured } from './config';
import { openRoom, openCollabLink } from './rooms';

export function SharedProjects() {
  const id = useSyncExternalStore(api.subscribeIdentity, api.getIdentity);
  const [rooms, setRooms] = useState<api.RoomInfo[] | null>(null);
  const [err, setErr] = useState('');
  const [link, setLink] = useState('');
  const load = () => {
    if (!id) return;
    setErr('');
    api.listRooms().then(r => setRooms(r.sort((a, b) => (b.lastConnectionAt ?? b.createdAt).localeCompare(a.lastConnectionAt ?? a.createdAt)))).catch(e => setErr(e.message));
  };
  useEffect(load, [id?.user.id]);
  if (!collabConfigured) return null;
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row">
        <h2>Proyectos compartidos</h2>
        <span className="tiny muted grow">Colaboración en tiempo real</span>
        {id && <button className="icon-btn sm" title="Actualizar" onClick={load}><RefreshCw size={12} /></button>}
        <button className="btn sm ghost" onClick={() => set({ dialog: { type: 'collab-identity' } })}><UserRound size={12} />{id ? id.user.name : 'Mi perfil'}</button>
      </div>
      <form className="row" style={{ gap: 6 }} onSubmit={async e => {
        e.preventDefault();
        if (link.trim() && (await openCollabLink(link))) { setLink(''); load(); }
      }}>
        <input className="input grow" value={link} onChange={e => setLink(e.target.value)} aria-label="Enlace de invitación o de proyecto"
          placeholder="Pega un enlace de invitación o de proyecto" />
        <button className="btn sm" type="submit" disabled={!link.trim()}><Link2 size={12} />Abrir</button>
      </form>
      {!id ? <div className="tiny muted">Pega un enlace de invitación, o abre un documento y pulsa «Compartir» en la barra superior para invitar a otras personas.</div>
        : err ? <div className="tiny" style={{ color: 'var(--danger)' }}>{err}</div>
        : rooms === null ? <div className="tiny muted">Cargando…</div>
        : !rooms.length ? <div className="tiny muted">Todavía no participas en ningún proyecto compartido.</div>
        : (
          <div className="col" style={{ gap: 4 }}>
            {rooms.map(r => (
              <div key={r.id} className="row small shared-row" onClick={() => openRoom(r.id).catch(e => toast(e.message, 'error'))}>
                <Users size={13} style={{ color: 'var(--accent)' }} />
                <span className="grow" style={{ fontWeight: 500 }}>{r.name}</span>
                <span className="tiny muted">{api.roleLabel(r.role)}</span>
                <span className="tiny muted">{new Date(r.lastConnectionAt ?? r.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}
