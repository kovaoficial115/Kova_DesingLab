// Abrir, compartir y unirse a documentos compartidos; sincronización con la URL (#room= / #invite=).

import { get, set, toast, withBusy, activeDoc } from '../core/store';
import { newDoc } from '../core/doc';
import { addDoc } from '../core/actions';
import * as api from './api';
import { collabConfigured } from './config';

const docIdFor = (room: string) => 'doc_' + room.replace(/^kova-/, '');
const findRoomDoc = (room: string) => get().docs.find(d => d.collab?.room === room);

/** Abre un proyecto compartido (o lo activa si ya está abierto). */
export async function openRoom(room: string) {
  const open = findRoomDoc(room);
  if (open) { set({ activeDocId: open.id, screen: 'editor' }); return; }
  await withBusy('Conectando con el proyecto compartido…', async () => {
    const info = await api.getRoom(room);
    if (!info.role) throw new Error('No tienes acceso a este proyecto');
    const d = newDoc(info.name, 1080, 1080, 300);
    addDoc({ ...d, id: docIdFor(room), lastLabel: 'Documento compartido', collab: { room, role: info.role, status: 'connecting' } }, false);
  });
}

/** Convierte el documento activo en un proyecto compartido (quien lo comparte es el propietario). */
export async function shareActiveDoc() {
  const d = activeDoc();
  if (!d) return;
  if (d.collab) { set({ dialog: { type: 'collab-share' } }); return; }
  await withBusy('Creando el proyecto compartido…', async () => {
    const info = await api.createRoom(d.name);
    set(s => ({ docs: s.docs.map(x => (x.id === d.id ? { ...x, collab: { room: info.id, role: 'owner', status: 'connecting', seed: true } } : x)) }));
    set({ dialog: { type: 'collab-share' } });
  });
}

export async function joinInvite(token: string) {
  try {
    const info = await api.acceptInvite(token);
    toast(`Te uniste a «${info.name}» como ${api.roleLabel(info.role)}`, 'ok');
    await openRoom(info.id);
  } catch (e: any) {
    toast(e?.message || String(e), 'error', 7000);
  }
}

/** Abre un enlace de KOVA pegado a mano (en escritorio no hay barra de direcciones). */
export async function openCollabLink(text: string): Promise<boolean> {
  const link = api.parseCollabLink(text);
  if (!link) { toast('Ese texto no es un enlace de invitación ni de proyecto de KOVA.', 'warn'); return false; }
  if ('invite' in link) await joinInvite(link.invite);
  else { try { await openRoom(link.room); } catch (e: any) { toast(e?.message || String(e), 'error', 7000); return false; } }
  return true;
}

/** Lee la URL al arrancar: enlaces de invitación y de proyecto. */
export async function initFromUrl() {
  if (!collabConfigured) return;
  const h = new URLSearchParams(location.hash.slice(1));
  const invite = h.get('invite');
  const room = h.get('room');
  if (invite) { history.replaceState(null, '', location.pathname + location.search); await joinInvite(invite); }
  else if (room) {
    try { await openRoom(room); } catch (e: any) { toast(e?.message || String(e), 'error', 7000); }
  }
}

/** Mantiene #room=… en la URL mientras el documento activo es compartido (recargar = volver a entrar). */
export function syncUrlWithActiveDoc() {
  const s = get();
  const d = s.screen === 'editor' ? s.docs.find(x => x.id === s.activeDocId) : null;
  const want = d?.collab ? '#room=' + d.collab.room : '';
  const has = location.hash.startsWith('#room=') ? location.hash : '';
  if (want !== has) history.replaceState(null, '', location.pathname + location.search + want);
}
