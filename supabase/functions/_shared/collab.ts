// Servidor de colaboración de Kova_DesignLab.
//
// Es el único lugar que conoce la clave secreta de Liveblocks. Funciona como un manejador
// estándar `Request → Response`, así que se ejecuta igual en Supabase Edge Functions (Deno),
// en Node (server/dev.mjs, para desarrollo) o en cualquier runtime compatible con Fetch.
//
// Responsabilidades:
//  · Identidad: emite identidades firmadas (HMAC-SHA256). El token es la credencial del usuario;
//    nadie puede hacerse pasar por otro sin él.
//  · Autenticación de Liveblocks con ID tokens: Liveblocks comprueba en SU servidor los permisos
//    guardados en cada sala (usersAccesses). El navegador nunca recibe la clave secreta.
//  · Salas: creación, listado, renombrado y borrado.
//  · Roles: propietario (metadata.owner + room:write), editor (room:write) y lector
//    (room:read + room:presence:write: ve el documento y muestra su cursor, pero Liveblocks
//    rechaza cualquier escritura en Storage).
//  · Invitaciones: enlaces firmados con rol y un nonce por sala; restablecer el nonce invalida
//    todos los enlaces anteriores.
//
// Variables de entorno:
//  LIVEBLOCKS_SECRET_KEY  clave secreta (sk_…) del proyecto de Liveblocks          (obligatoria)
//  KOVA_COLLAB_SECRET     secreto aleatorio de 32+ caracteres para firmar tokens       (obligatoria)
//  ALLOWED_ORIGINS        orígenes permitidos separados por comas (* = cualquiera)    (opcional)
//  LIVEBLOCKS_BASE_URL    solo para el servidor local de Liveblocks (liveblocks dev)  (opcional)

import { Liveblocks } from '@liveblocks/node';
import { LiveFile, LiveList, LiveObject } from '@liveblocks/client';

export type EnvGetter = (key: string) => string | undefined;
type Role = 'owner' | 'editor' | 'viewer';

const SCOPES: Record<Exclude<Role, 'owner'>, string[]> = {
  editor: ['room:write'],
  viewer: ['room:read', 'room:presence:write'],
};
const ROOM_PREFIX = 'kova-';
const COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#748ffc', '#b197fc', '#f783ac', '#d7f25c', '#63e6be', '#ff8787'];
const MAX_MEMBERS = 45; // metadata de Liveblocks: 50 entradas (5 reservadas)

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

// ---------- utilidades de firma ----------
const enc = new TextEncoder();
const dec = new TextDecoder();
function b64url(bytes: Uint8Array) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s: string) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const keyCache = new Map<string, Promise<CryptoKey>>();
function hmacKey(secret: string) {
  let k = keyCache.get(secret);
  if (!k) { k = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); keyCache.set(secret, k); }
  return k;
}
async function signToken(payload: Record<string, unknown>, secret: string) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}
async function verifyToken<T extends { k: string }>(token: string | null | undefined, secret: string, kind: string): Promise<T | null> {
  if (!token || typeof token !== 'string' || token.length > 4096) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64url(sig), enc.encode(body));
    if (!ok) return null;
    const p = JSON.parse(dec.decode(unb64url(body))) as T & { exp?: number };
    if (p.k !== kind) return null;
    if (p.exp && Date.now() > p.exp) return null;
    return p;
  } catch { return null; }
}
function randomId(len = 16) {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = '';
  for (const b of bytes) s += abc[b % abc.length];
  return s;
}

// ---------- validación ----------
function cleanName(v: unknown, max = 40) {
  if (typeof v !== 'string') throw new HttpError(400, 'Nombre no válido');
  const s = v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
  if (!s) throw new HttpError(400, 'El nombre no puede estar vacío');
  return s;
}
function cleanColor(v: unknown, fallback: string) {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback;
}
function cleanRoomId(v: string) {
  if (!new RegExp(`^${ROOM_PREFIX}[a-z0-9]{8,32}$`).test(v)) throw new HttpError(400, 'Sala no válida');
  return v;
}

interface IdentityPayload { k: 'id'; uid: string; name: string; color: string; iat: number }
interface InvitePayload { k: 'inv'; room: string; role: 'editor' | 'viewer'; n: string; by: string; iat: number; exp?: number }

// ---------- roles ----------
type RoomData = Awaited<ReturnType<Liveblocks['getRoom']>>;
function meta(room: RoomData, key: string): string | undefined {
  const v = room.metadata?.[key];
  return Array.isArray(v) ? v[0] : v;
}
function roleOf(room: RoomData, uid: string): Role | null {
  if (meta(room, 'owner') === uid) return 'owner';
  const scopes = (room.usersAccesses?.[uid] ?? []) as string[];
  if (scopes.includes('room:write')) return 'editor';
  if (scopes.includes('room:read')) return 'viewer';
  return null;
}
function members(room: RoomData) {
  const out: { id: string; name: string; role: Role }[] = [];
  for (const uid of Object.keys(room.usersAccesses ?? {})) {
    const role = roleOf(room, uid);
    if (role) out.push({ id: uid, name: meta(room, 'u_' + uid) || 'Invitado', role });
  }
  const rank = { owner: 0, editor: 1, viewer: 2 };
  return out.sort((a, b) => rank[a.role] - rank[b.role] || a.name.localeCompare(b.name));
}
/** Quita el acceso (lo importante) y después el nombre guardado en metadata. El servidor local
 *  `liveblocks dev` no admite `null` en metadata (la API real sí lo usa para borrar la clave). */
async function revoke(lb: Liveblocks, roomId: string, uid: string) {
  await lb.updateRoom(roomId, { usersAccesses: { [uid]: null } } as any);
  await lb.updateRoom(roomId, { metadata: { ['u_' + uid]: null } } as any).catch(() => {});
}

function roomInfo(room: RoomData, uid: string) {
  return {
    id: room.id,
    name: meta(room, 'name') || 'Proyecto sin nombre',
    role: roleOf(room, uid),
    owner: meta(room, 'owner') ?? null,
    createdAt: room.createdAt,
    lastConnectionAt: room.lastConnectionAt ?? null,
  };
}

// ---------- manejador ----------
export async function handle(req: Request, env: EnvGetter): Promise<Response> {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env('ALLOWED_ORIGINS') || '*').split(',').map(s => s.trim()).filter(Boolean);
  const allowOrigin = allowed.includes('*') ? '*' : allowed.includes(origin) ? origin : '';
  const cors: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOrigin || 'null',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (origin && !allowOrigin) return json({ error: 'Origen no permitido' }, 403);

  const secret = env('LIVEBLOCKS_SECRET_KEY');
  const appSecret = env('KOVA_COLLAB_SECRET');
  if (!secret || !appSecret || appSecret.length < 32) return json({ error: 'El servidor de colaboración no está configurado (faltan LIVEBLOCKS_SECRET_KEY o KOVA_COLLAB_SECRET).' }, 503);
  if (secret.startsWith('pk_')) return json({ error: 'LIVEBLOCKS_SECRET_KEY debe ser la clave secreta (sk_…), no la pública.' }, 503);
  const baseUrl = env('LIVEBLOCKS_BASE_URL') || undefined;
  const lb = new Liveblocks({ secret, ...(baseUrl ? { baseUrl } : {}) });

  // ruta relativa a la función (Supabase añade /functions/v1/kova-collab)
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/kova-collab/, '').replace(/\/+$/, '') || '/';
  const parts = path.split('/').filter(Boolean);

  const body = async () => {
    if (req.method === 'GET') return {} as any;
    const text = await req.text();
    if (text.length > 65_536) throw new HttpError(413, 'Solicitud demasiado grande');
    try { return text ? JSON.parse(text) : {}; } catch { throw new HttpError(400, 'JSON no válido'); }
  };
  const identity = async () => {
    const h = req.headers.get('Authorization') || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    const id = await verifyToken<IdentityPayload>(token, appSecret, 'id');
    if (!id) throw new HttpError(401, 'Identidad no válida. Vuelve a escribir tu nombre.');
    return id;
  };
  const loadRoom = async (roomId: string) => {
    try { return await lb.getRoom(cleanRoomId(roomId)); }
    catch (e: any) { if (e?.status === 404) throw new HttpError(404, 'El proyecto no existe o se eliminó'); throw e; }
  };
  const requireRole = (room: RoomData, uid: string, allowed: Role[]) => {
    const role = roleOf(room, uid);
    if (!role) throw new HttpError(403, 'No tienes acceso a este proyecto');
    if (!allowed.includes(role)) throw new HttpError(403, 'Tu rol no permite esta acción');
    return role;
  };

  try {
    // POST /identity → crea o actualiza la identidad (conserva el id si se envía un token válido)
    if (req.method === 'POST' && path === '/identity') {
      const b = await body();
      const prev = await verifyToken<IdentityPayload>(b.token, appSecret, 'id');
      const uid = prev?.uid ?? 'u' + randomId(15);
      const color = cleanColor(b.color, prev?.color ?? COLORS[crypto.getRandomValues(new Uint8Array(1))[0] % COLORS.length]);
      const payload: IdentityPayload = { k: 'id', uid, name: cleanName(b.name), color, iat: Date.now() };
      return json({ token: await signToken(payload as any, appSecret), user: { id: uid, name: payload.name, color } });
    }

    // POST /auth → ID token de Liveblocks (los permisos los aplica Liveblocks según la sala)
    if (req.method === 'POST' && path === '/auth') {
      const id = await identity();
      const r = await lb.identifyUser({ userId: id.uid, groupIds: [] }, { userInfo: { name: id.name, color: id.color } });
      return new Response(r.body, { status: r.status, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // GET /rooms → proyectos a los que tengo acceso
    if (req.method === 'GET' && path === '/rooms') {
      const id = await identity();
      const page = await lb.getRooms({ userId: id.uid, query: { roomId: { startsWith: ROOM_PREFIX } } } as any);
      return json({ rooms: page.data.map(r => roomInfo(r, id.uid)).filter(r => r.role) });
    }

    // POST /rooms {name} → nueva sala; quien la crea es el propietario
    if (req.method === 'POST' && path === '/rooms') {
      const id = await identity();
      const b = await body();
      const roomId = ROOM_PREFIX + randomId(16);
      const room = await lb.createRoom(roomId, {
        defaultAccesses: [],
        usersAccesses: { [id.uid]: SCOPES.editor as any },
        metadata: { name: cleanName(b.name, 120), owner: id.uid, nonce: randomId(12), ['u_' + id.uid]: id.name },
      });
      return json(roomInfo(room, id.uid), 201);
    }

    // /rooms/:id …
    if (parts[0] === 'rooms' && parts[1]) {
      const id = await identity();
      const room = await loadRoom(parts[1]);
      const sub = parts.slice(2).join('/');

      if (req.method === 'GET' && !sub) {
        requireRole(room, id.uid, ['owner', 'editor', 'viewer']);
        // mantener el nombre visible actualizado en la lista de miembros
        if (meta(room, 'u_' + id.uid) !== id.name) await lb.updateRoom(room.id, { metadata: { ['u_' + id.uid]: id.name } }).catch(() => {});
        return json({ ...roomInfo(room, id.uid), members: members(room) });
      }
      if (req.method === 'PATCH' && !sub) {
        requireRole(room, id.uid, ['owner', 'editor']);
        const b = await body();
        const r2 = await lb.updateRoom(room.id, { metadata: { name: cleanName(b.name, 120) } });
        return json(roomInfo(r2, id.uid));
      }
      if (req.method === 'DELETE' && !sub) {
        requireRole(room, id.uid, ['owner']);
        await lb.deleteRoom(room.id);
        return json({ ok: true });
      }
      if (req.method === 'POST' && sub === 'invites') {
        requireRole(room, id.uid, ['owner']);
        const b = await body();
        const role = b.role === 'viewer' ? 'viewer' : b.role === 'editor' ? 'editor' : null;
        if (!role) throw new HttpError(400, 'Rol no válido');
        const days = Math.min(365, Math.max(0, Number(b.days) || 0));
        const p: InvitePayload = { k: 'inv', room: room.id, role, n: meta(room, 'nonce') || '', by: id.uid, iat: Date.now(), ...(days ? { exp: Date.now() + days * 86400_000 } : {}) };
        return json({ token: await signToken(p as any, appSecret), role });
      }
      if (req.method === 'POST' && sub === 'invites/reset') {
        requireRole(room, id.uid, ['owner']);
        await lb.updateRoom(room.id, { metadata: { nonce: randomId(12) } });
        return json({ ok: true });
      }
      if (req.method === 'POST' && sub === 'members') {
        requireRole(room, id.uid, ['owner']);
        const b = await body();
        const target = typeof b.userId === 'string' ? b.userId : '';
        if (!target || !room.usersAccesses?.[target]) throw new HttpError(404, 'Ese usuario no es miembro');
        if (target === meta(room, 'owner')) throw new HttpError(400, 'No se puede cambiar el rol del propietario');
        if (b.role === null) {
          await revoke(lb, room.id, target);
        } else {
          const role = b.role === 'viewer' ? 'viewer' : b.role === 'editor' ? 'editor' : null;
          if (!role) throw new HttpError(400, 'Rol no válido');
          await lb.updateRoom(room.id, { usersAccesses: { [target]: SCOPES[role] as any } });
        }
        return json({ members: members(await lb.getRoom(room.id)) });
      }
      // POST /rooms/:id/versions → registra una versión (instantánea ya subida como LiveFile).
      // Se escribe desde el servidor para que no entre en el historial de deshacer de nadie.
      if (req.method === 'POST' && sub === 'versions') {
        requireRole(room, id.uid, ['owner', 'editor']);
        const b = await body();
        const f = b.file;
        if (!f || typeof f.id !== 'string' || typeof f.name !== 'string' || typeof f.size !== 'number' || typeof f.mimeType !== 'string') throw new HttpError(400, 'Instantánea no válida');
        const entry = {
          id: 'v' + randomId(10),
          label: typeof b.label === 'string' ? b.label.replace(/[\u0000-\u001f]/g, '').slice(0, 80) : '',
          auto: !!b.auto,
          at: Date.now(),
          by: id.uid,
          byName: id.name,
          layers: Math.max(0, Math.min(100000, Number(b.layers) || 0)),
          thumb: typeof b.thumb === 'string' && b.thumb.startsWith('data:image/') && b.thumb.length < 24_000 ? b.thumb : '',
        };
        await lb.mutateStorage(room.id, ({ root }) => {
          let list = root.get('versions') as LiveList<LiveObject<any>> | undefined;
          if (!list) { list = new LiveList([]); root.set('versions', list as any); }
          list.push(new LiveObject({ ...entry, file: new LiveFile({ id: f.id, name: f.name, size: f.size, mimeType: f.mimeType }) }));
          // conservar las 80 más recientes (primero se descartan las automáticas)
          while (list.length > 80) {
            const arr = list.toArray();
            const idx = arr.findIndex(v => v.get('auto'));
            list.delete(idx >= 0 ? idx : 0);
          }
        });
        return json({ version: entry }, 201);
      }
      // GET /rooms/:id/files/:fileId → descarga de un LiveFile de la sala a través del servidor
      // (respaldo para cuando el almacenamiento de archivos no permite CORS desde el navegador).
      if (req.method === 'GET' && parts[2] === 'files' && parts[3] && parts.length === 4) {
        requireRole(room, id.uid, ['owner', 'editor', 'viewer']);
        if (!/^fl_[A-Za-z0-9_-]{6,64}$/.test(parts[3])) throw new HttpError(400, 'Archivo no válido');
        const { url: fileUrl } = await lb.getFileUrl({ roomId: room.id, file: parts[3] });
        const r = await fetch(fileUrl);
        if (!r.ok || !r.body) throw new HttpError(r.status === 404 ? 404 : 502, 'No se pudo leer el archivo');
        return new Response(r.body, {
          status: 200,
          headers: { ...cors, 'Content-Type': r.headers.get('Content-Type') || 'application/octet-stream', 'Cache-Control': 'private, max-age=86400' },
        });
      }
      if (req.method === 'POST' && sub === 'leave') {
        const role = requireRole(room, id.uid, ['editor', 'viewer', 'owner']);
        if (role === 'owner') throw new HttpError(400, 'El propietario no puede salir; elimina el proyecto si ya no lo necesitas');
        await revoke(lb, room.id, id.uid);
        return json({ ok: true });
      }
      throw new HttpError(404, 'Ruta no encontrada');
    }

    // POST /invites/accept {token}
    if (req.method === 'POST' && path === '/invites/accept') {
      const id = await identity();
      const b = await body();
      const inv = await verifyToken<InvitePayload>(b.token, appSecret, 'inv');
      if (!inv) throw new HttpError(400, 'El enlace de invitación no es válido o caducó');
      const room = await loadRoom(inv.room);
      if (inv.n !== (meta(room, 'nonce') || '')) throw new HttpError(410, 'Este enlace de invitación se desactivó. Pide uno nuevo al propietario.');
      const current = roleOf(room, id.uid);
      const rank = { owner: 3, editor: 2, viewer: 1 };
      if (!current || rank[inv.role] > rank[current]) {
        if (!current && members(room).length >= MAX_MEMBERS) throw new HttpError(409, 'El proyecto alcanzó el máximo de participantes');
        await lb.updateRoom(room.id, { usersAccesses: { [id.uid]: SCOPES[inv.role] as any }, metadata: { ['u_' + id.uid]: id.name } });
      }
      const r2 = await lb.getRoom(room.id);
      return json(roomInfo(r2, id.uid));
    }

    if (req.method === 'GET' && path === '/') return json({ ok: true, service: 'kova-collab' });
    throw new HttpError(404, 'Ruta no encontrada');
  } catch (e: any) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Error del servidor de colaboración' }, 500);
  }
}
