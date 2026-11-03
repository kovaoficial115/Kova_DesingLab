// Integración de Liveblocks en la interfaz: proveedores, puente con el motor de sincronización,
// participantes, cursores, selecciones ajenas e indicadores de conexión y guardado.

import './liveblocks.config';
import React, { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  LiveblocksProvider, RoomProvider, useRoom, useOthers, useSelf, useStatus, useSyncStatus,
  useLostConnectionListener, useErrorListener,
} from '@liveblocks/react';
import { AlertTriangle, Check, CloudOff, Eye, History, Loader2, RefreshCw, Users } from 'lucide-react';
import { useStore, get, set, toast, setView, getView } from '../core/store';
import type { Doc } from '../core/types';
import { layerCorners, layerBounds, unionRect } from '../core/util';
import { collabConfigured, LIVEBLOCKS_BASE_URL } from './config';
import { liveblocksAuth, roleLabel } from './api';
import { attachSession, getSession, subscribeSessions, type SessionInfo } from './engine';
import { initialPresence, initialStorage } from './schema';
import { registerSlot, useSlot } from './slots';
import { shareActiveDoc, syncUrlWithActiveDoc } from './rooms';
import { ShareDialog, VersionsDialog } from './dialogs';

const EMPTY_INFO: SessionInfo = { pendingUp: 0, pendingDown: 0, canUndo: false, canRedo: false, canWrite: false, lastSync: 0 };
export function useSessionInfo(docId: string | null | undefined) {
  return useSyncExternalStore(subscribeSessions, () => getSession(docId)?.info ?? EMPTY_INFO);
}

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?';

// ---------- proveedores ----------
export function CollabHost() {
  const rooms = useStore(s => s.docs.filter(d => d.collab).map(d => `${d.id}|${d.collab!.room}`).join(','));
  const active = useStore(s => (s.screen === 'editor' ? s.activeDocId : null));
  useEffect(() => useStore.subscribe((s, p) => { if (s.activeDocId !== p.activeDocId || s.screen !== p.screen || s.docs !== p.docs) syncUrlWithActiveDoc(); }), []);
  if (!collabConfigured) return null;
  const list = rooms ? rooms.split(',').map(x => x.split('|') as [string, string]) : [];
  return (
    <LiveblocksProvider authEndpoint={liveblocksAuth} baseUrl={LIVEBLOCKS_BASE_URL} throttle={40} lostConnectionTimeout={4000} preventUnsavedChanges>
      {list.map(([docId, room]) => (
        <RoomProvider key={room} id={room} initialPresence={initialPresence} initialStorage={initialStorage}>
          <RoomBridge docId={docId} />
          {docId === active && <ActiveRoom docId={docId} />}
        </RoomProvider>
      ))}
    </LiveblocksProvider>
  );
}

function RoomBridge({ docId }: { docId: string }) {
  const room = useRoom();
  useEffect(() => attachSession(docId, room as any), [room, docId]);
  return null;
}

function ActiveRoom({ docId }: { docId: string }) {
  const topbar = useSlot('topbar');
  const stage = useSlot('stage');
  const dialog = useStore(s => s.dialog?.type);
  const doc = useStore(s => s.docs.find(d => d.id === docId));
  useLostConnectionListener(ev => {
    if (ev === 'lost') toast('Conexión perdida. Tus cambios se enviarán al reconectar.', 'warn', 5000);
    else if (ev === 'restored') toast('Conexión restablecida: documento sincronizado', 'ok');
    else if (ev === 'failed') toast('No se pudo reconectar. Revisa tu conexión a internet.', 'error', 7000);
  });
  useErrorListener(err => { console.warn('Liveblocks', err); });
  if (!doc) return null;
  const close = () => set({ dialog: null });
  return (
    <>
      {topbar && createPortal(<Participants doc={doc} />, topbar)}
      {stage && createPortal(<StageOverlay doc={doc} />, stage)}
      {dialog === 'collab-share' && createPortal(<ShareDialog doc={doc} onClose={close} />, document.body)}
      {dialog === 'collab-versions' && createPortal(<VersionsDialog doc={doc} onClose={close} />, document.body)}
    </>
  );
}

// ---------- anclajes ----------
const topbarRef = (el: HTMLDivElement | null) => registerSlot('topbar', el);
const stageRef = (el: HTMLDivElement | null) => registerSlot('stage', el);

/** Barra superior: participantes y «Compartir». */
export function TopbarCollab() {
  const doc = useStore(s => s.docs.find(d => d.id === s.activeDocId));
  if (!collabConfigured || !doc) return null;
  if (doc.collab) return <div ref={topbarRef} className="collab-topbar" />;
  return <button className="btn sm" title="Invitar a otras personas a editar este documento" onClick={() => shareActiveDoc()}><Users size={13} />Compartir</button>;
}
/** Capa sobre el lienzo para cursores y selecciones. */
export function StageSlot() {
  return <div ref={stageRef} className="collab-stage" />;
}

// ---------- participantes ----------
function Participants({ doc }: { doc: Doc }) {
  const others = useOthers();
  const self = useSelf();
  const status = useStatus();
  const sync = useSyncStatus({ smooth: true });
  const info = useSessionInfo(doc.id);
  const c = doc.collab!;
  // una persona con varias pestañas cuenta una vez
  const people = useMemo(() => {
    const m = new Map<string, (typeof others)[number]>();
    for (const o of others) if (o.id && o.id !== self?.id && !m.has(o.id)) m.set(o.id, o);
    return [...m.values()];
  }, [others, self?.id]);

  let pill: { icon: React.ReactNode; text: string; cls: string; title: string };
  if (c.status === 'error') pill = { icon: <AlertTriangle size={12} />, text: 'Error', cls: 'bad', title: c.error || 'Error' };
  else if (status === 'disconnected' || (status === 'initial' && c.status === 'ready')) pill = { icon: <CloudOff size={12} />, text: 'Sin conexión', cls: 'bad', title: 'Los cambios se guardan en este navegador y se enviarán al reconectar' };
  else if (status === 'reconnecting') pill = { icon: <RefreshCw size={12} className="spin" />, text: 'Reconectando…', cls: 'warn', title: 'Recuperando la conexión con la sala' };
  else if (status !== 'connected' || c.status === 'connecting') pill = { icon: <Loader2 size={12} className="spin" />, text: 'Conectando…', cls: 'warn', title: 'Entrando en la sala' };
  else if (c.status === 'uploading') pill = { icon: <Loader2 size={12} className="spin" />, text: c.progress || 'Subiendo…', cls: 'warn', title: 'Subiendo el documento a la nube' };
  else if (c.status === 'waiting') pill = { icon: <Loader2 size={12} className="spin" />, text: 'Esperando documento', cls: 'warn', title: 'El documento aún no se ha publicado' };
  else if (info.pendingUp > 0 || sync === 'synchronizing') pill = { icon: <Loader2 size={12} className="spin" />, text: info.pendingUp ? `Guardando… (${info.pendingUp})` : 'Guardando…', cls: 'warn', title: 'Enviando cambios' };
  else pill = { icon: <Check size={12} />, text: 'Guardado', cls: 'ok', title: 'Todos los cambios están sincronizados y guardados en la nube' };

  const readOnly = c.role === 'viewer' || (status === 'connected' && self && !self.canWrite);
  const shown = people.slice(0, 4);
  return (
    <div className="row collab-participants" style={{ gap: 6 }}>
      <span className={'sync-pill ' + pill.cls} title={pill.title}>{pill.icon}{pill.text}</span>
      {readOnly && <span className="sync-pill" title="Puedes ver el documento y mostrar tu cursor, pero no modificarlo"><Eye size={12} />Solo lectura</span>}
      <div className="avatars">
        {shown.map(o => (
          <button key={o.id} className="avatar" style={{ background: o.info?.color }} onClick={() => jumpTo(doc, o.presence)}
            title={`${o.info?.name ?? 'Invitado'} · ${o.canWrite ? 'Puede editar' : 'Solo lectura'}${o.presence.activity ? ' · ' + o.presence.activity : ''}\nClic para ir a su posición`}>
            {initials(o.info?.name ?? '?')}
            {o.presence.activity && <span className="avatar-dot" />}
          </button>
        ))}
        {people.length > shown.length && <span className="avatar more" title={people.slice(4).map(o => o.info?.name).join(', ')}>+{people.length - shown.length}</span>}
        {self && <span className="avatar me" style={{ background: self.info?.color }} title={`${self.info?.name} (tú) · ${roleLabel(c.role)}`}>{initials(self.info?.name ?? '?')}</span>}
      </div>
      <button className="icon-btn" title="Historial de versiones" onClick={() => set({ dialog: { type: 'collab-versions' } })}><History size={15} /></button>
      <button className="btn sm" onClick={() => set({ dialog: { type: 'collab-share' } })}><Users size={13} />Compartir</button>
    </div>
  );
}

/** Centra la vista en el cursor (o la selección) de otra persona, sin cambiar el zoom. */
function jumpTo(doc: Doc, p: any) {
  const el = document.getElementById('kova-viewport');
  if (!el) return;
  let pt = p?.cursor as { x: number; y: number } | null;
  if (!pt && p?.selection?.length) {
    const r = unionRect(doc.state.layers.filter(l => p.selection.includes(l.id)).map(layerBounds));
    if (r) pt = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }
  if (!pt) { toast('Esa persona no está mirando el lienzo ahora mismo', 'info'); return; }
  const v = getView(doc.id);
  setView({ panX: el.clientWidth / 2 - pt.x * v.zoom, panY: el.clientHeight / 2 - pt.y * v.zoom }, doc.id);
}

// ---------- lienzo: cursores, selecciones y estado de carga ----------
function StageOverlay({ doc }: { doc: Doc }) {
  const others = useOthers();
  const view = useStore(s => s.views[doc.id]) ?? { zoom: 1, panX: 0, panY: 0 };
  const c = doc.collab!;
  const sx = (x: number) => x * view.zoom + view.panX;
  const sy = (y: number) => y * view.zoom + view.panY;
  const byId = useMemo(() => new Map(doc.state.layers.map(l => [l.id, l] as const)), [doc.state.layers]);
  const session = getSession(doc.id);
  return (
    <>
      <svg className="collab-svg">
        {others.map(o => {
          const color = o.info?.color ?? '#5a95ff';
          const sel = (o.presence.selection ?? []).map((id: string) => byId.get(id)).filter(Boolean);
          return (
            <g key={'s' + o.connectionId}>
              {sel.map((l: any) => {
                const pts = layerCorners(l).map(p => `${sx(p.x)},${sy(p.y)}`).join(' ');
                return <polygon key={l.id} points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="5 3" />;
              })}
              {sel.length > 0 && (() => {
                const r = unionRect(sel.map((l: any) => layerBounds(l)))!;
                return <text x={sx(r.x)} y={sy(r.y) - 5} fill={color} fontSize={10} fontWeight={600}>{o.info?.name}</text>;
              })()}
            </g>
          );
        })}
      </svg>
      {others.map(o => {
        const p = o.presence.cursor;
        if (!p) return null;
        const color = o.info?.color ?? '#5a95ff';
        return (
          <div key={'c' + o.connectionId} className="collab-cursor" style={{ transform: `translate(${sx(p.x)}px, ${sy(p.y)}px)` }}>
            <svg width="18" height="20" viewBox="0 0 18 20"><path d="M1 1l6.5 17 2.4-7.1L17 8.4z" fill={color} stroke="#0b0b0d" strokeWidth="1.2" strokeLinejoin="round" /></svg>
            <span className="collab-name" style={{ background: color }}>{o.info?.name ?? 'Invitado'}{o.presence.activity ? ` · ${o.presence.activity}` : ''}</span>
          </div>
        );
      })}
      {c.status !== 'ready' && (
        <div className="collab-loading">
          <div className="card col" style={{ gap: 10, alignItems: 'center', maxWidth: 360, textAlign: 'center' }}>
            {c.status === 'error' ? <AlertTriangle size={22} style={{ color: 'var(--danger)' }} /> : <Loader2 size={22} className="spin" />}
            <b>{c.status === 'error' ? 'No se pudo abrir el proyecto' : c.status === 'uploading' ? 'Publicando el documento' : c.status === 'waiting' ? 'Esperando el documento' : 'Conectando con la sala…'}</b>
            <span className="small muted">
              {c.status === 'error' ? c.error : c.status === 'uploading' ? (c.progress || 'Subiendo capas…') : c.status === 'waiting' ? 'La persona que lo compartió aún no terminó de subirlo. Se abrirá solo cuando esté listo.' : 'Cargando capas y mesas de trabajo.'}
            </span>
            {c.status === 'waiting' && session?.writable && (
              <button className="btn sm" onClick={() => session.startEmpty()}>Empezar con un documento vacío</button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

void get;
