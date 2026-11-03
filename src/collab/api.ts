// Cliente del servidor de colaboración: identidad firmada, salas, roles e invitaciones.

import { set, get } from '../core/store';
import type { CollabRole } from '../core/types';
import { COLLAB_API, collabConfigured } from './config';

export interface CollabUser { id: string; name: string; color: string }
export interface Identity { token: string; user: CollabUser }
export interface RoomInfo { id: string; name: string; role: CollabRole | null; owner: string | null; createdAt: string; lastConnectionAt: string | null }
export interface Member { id: string; name: string; role: CollabRole }

const KEY = 'kova.identity';
let identity: Identity | null = null;
try { const raw = localStorage.getItem(KEY); if (raw) identity = JSON.parse(raw); } catch { /* sin almacenamiento */ }
const listeners = new Set<() => void>();
export const subscribeIdentity = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const getIdentity = () => identity;

function saveIdentity(id: Identity | null) {
  identity = id;
  try { id ? localStorage.setItem(KEY, JSON.stringify(id)) : localStorage.removeItem(KEY); } catch { /* sin almacenamiento */ }
  listeners.forEach(f => f());
}

export class CollabError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status; } }

async function call<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  if (!collabConfigured) throw new CollabError(0, 'La colaboración no está configurada en esta instalación (falta VITE_COLLAB_API).');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.auth !== false) {
    const id = await ensureIdentity();
    headers.Authorization = 'Bearer ' + id.token;
  }
  let r: Response;
  try {
    r = await fetch(COLLAB_API + path, { method: init.method || (init.body ? 'POST' : 'GET'), headers, body: init.body ? JSON.stringify(init.body) : undefined });
  } catch {
    throw new CollabError(0, 'No se pudo contactar con el servidor de colaboración. Revisa tu conexión.');
  }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && init.auth !== false) saveIdentity(null);
  if (!r.ok) throw new CollabError(r.status, data.error || `Error ${r.status}`);
  return data as T;
}

// ---------- identidad ----------
let pending: { resolve: (i: Identity) => void; reject: (e: Error) => void } | null = null;
/** Devuelve la identidad o abre el diálogo para pedir el nombre. */
export function ensureIdentity(): Promise<Identity> {
  if (identity) return Promise.resolve(identity);
  return new Promise((resolve, reject) => {
    pending?.reject(new Error('cancelado'));
    pending = { resolve, reject };
    set({ dialog: { type: 'collab-identity' } });
  });
}
export async function saveName(name: string, color?: string) {
  const r = await call<Identity>('/identity', { body: { name, color, token: identity?.token }, auth: false });
  saveIdentity(r);
  pending?.resolve(r); pending = null;
  return r;
}
export function cancelIdentity() { pending?.reject(new CollabError(0, 'Se necesita un nombre para colaborar')); pending = null; }
/** La clave de acceso es el propio token firmado: permite usar la misma identidad en otro equipo. */
export function exportKey() { return identity?.token ?? ''; }
export async function importKey(token: string) {
  const t = token.trim();
  const body = JSON.parse(atob(t.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
  // el servidor verifica la firma y conserva el id
  const r = await call<Identity>('/identity', { body: { name: body.name, color: body.color, token: t }, auth: false });
  if (r.user.id !== body.uid) throw new CollabError(400, 'La clave de acceso no es válida');
  saveIdentity(r);
  return r;
}
export function signOut() { saveIdentity(null); }

/** Endpoint de autenticación para LiveblocksProvider: devuelve un ID token de Liveblocks. */
export async function liveblocksAuth() {
  let id: Identity;
  try { id = await ensureIdentity(); } catch { return { error: 'forbidden' as const, reason: 'Sin identidad' }; }
  const r = await fetch(COLLAB_API + '/auth', { method: 'POST', headers: { Authorization: 'Bearer ' + id.token, 'Content-Type': 'application/json' }, body: '{}' });
  if (r.status === 401) { saveIdentity(null); return { error: 'forbidden' as const, reason: 'Identidad no válida' }; }
  if (!r.ok) throw new Error('No se pudo autenticar con el servidor de colaboración');
  return r.json();
}

// ---------- salas ----------
export const listRooms = () => call<{ rooms: RoomInfo[] }>('/rooms').then(r => r.rooms);
export const createRoom = (name: string) => call<RoomInfo>('/rooms', { body: { name } });
export const getRoom = (id: string) => call<RoomInfo & { members: Member[] }>(`/rooms/${id}`);
export const renameRoom = (id: string, name: string) => call<RoomInfo>(`/rooms/${id}`, { method: 'PATCH', body: { name } });
export const deleteRoom = (id: string) => call(`/rooms/${id}`, { method: 'DELETE' });
export const createInvite = (id: string, role: 'editor' | 'viewer') => call<{ token: string }>(`/rooms/${id}/invites`, { body: { role } });
export const resetInvites = (id: string) => call(`/rooms/${id}/invites/reset`, { body: {} });
export const setMemberRole = (id: string, userId: string, role: 'editor' | 'viewer' | null) => call<{ members: Member[] }>(`/rooms/${id}/members`, { body: { userId, role } });
export const leaveRoom = (id: string) => call(`/rooms/${id}/leave`, { body: {} });
export const saveVersion = (id: string, v: { file: unknown; label: string; auto: boolean; thumb: string; layers: number }) => call(`/rooms/${id}/versions`, { body: v });
/** Descarga un archivo de la sala a través del servidor de colaboración (respaldo sin CORS). */
export async function fetchRoomFile(room: string, fileId: string) {
  const id = await ensureIdentity();
  const r = await fetch(`${COLLAB_API}/rooms/${room}/files/${fileId}`, { headers: { Authorization: 'Bearer ' + id.token } });
  if (!r.ok) throw new CollabError(r.status, `No se pudo descargar el archivo (${r.status})`);
  return r.blob();
}
export const acceptInvite = (token: string) => call<RoomInfo>('/invites/accept', { body: { token } });

// ---------- enlaces ----------
const baseLink = () => location.origin + location.pathname;
export const inviteLink = (token: string) => `${baseLink()}#invite=${token}`;
export const roomLink = (room: string) => `${baseLink()}#room=${room}`;
export const roleLabel = (r: CollabRole | null | undefined) => (r === 'owner' ? 'Propietario' : r === 'editor' ? 'Editor' : r === 'viewer' ? 'Lector' : '—');

void get;
