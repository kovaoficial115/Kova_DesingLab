#!/usr/bin/env node
// Comprueba en el SERVIDOR de Liveblocks que un Lector no puede escribir en Storage.
//
// No usa el SDK (que ya bloquea al lector en el navegador): abre el WebSocket de Liveblocks
// con el token del lector y envía una operación de Storage en bruto, como haría alguien que
// manipulase el cliente. Después lee el Storage como propietario y comprueba si se aplicó.
//
//   COLLAB_API=https://<ref>.supabase.co/functions/v1/kova-collab npm run collab:check-perms
//
// Variables: COLLAB_API (por defecto http://localhost:8787) y LIVEBLOCKS_BASE_URL
// (por defecto https://api.liveblocks.io; usa http://localhost:1153 con `liveblocks dev`).
// Crea una sala temporal y la borra al terminar.
//
// Nota: el servidor local `liveblocks dev` (1.9.0) NO aplica los permisos a mensajes en bruto,
// así que contra él la prueba sale "ESCRITURA ACEPTADA". El resultado que cuenta es el de
// producción (api.liveblocks.io).

const API = (process.env.COLLAB_API || 'http://localhost:8787').replace(/\/$/, '');
const LB = (process.env.LIVEBLOCKS_BASE_URL || 'https://api.liveblocks.io').replace(/\/$/, '');

async function call(path, token, body, method) {
  const r = await fetch(API + path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path}: ${r.status} ${j.error || ''}`);
  return j;
}

/** Conexión mínima al protocolo de Liveblocks (v8). */
function connect(roomId, lbToken) {
  const url = new URL(LB);
  url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
  url.pathname = '/v8';
  url.searchParams.set('roomId', roomId);
  url.searchParams.set('tok', lbToken);
  url.searchParams.set('version', 'kova-perm-check');
  const ws = new WebSocket(url);
  const inbox = [];
  const waiters = [];
  ws.onmessage = (e) => {
    if (e.data === 'pong') return;
    let m; try { m = JSON.parse(e.data); } catch { return; }
    for (const msg of Array.isArray(m) ? m : [m]) {
      inbox.push(msg);
      for (const w of [...waiters]) if (w.pred(msg)) { waiters.splice(waiters.indexOf(w), 1); w.res(msg); }
    }
  };
  const wait = (pred, ms = 8000) => {
    const hit = inbox.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((res, rej) => {
      const w = { pred, res };
      waiters.push(w);
      setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); rej(new Error('timeout')); } }, ms);
    });
  };
  const send = (msgs) => ws.send(JSON.stringify(msgs));
  const opened = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('No se pudo abrir el WebSocket de Liveblocks')); });
  return { ws, inbox, wait, send, opened };
}

async function readStorage(roomId, lbToken) {
  const c = connect(roomId, lbToken);
  await c.opened;
  await c.wait(m => m.type === 104);
  c.send([{ type: 200 }]);
  await c.wait(m => m.type === 211 || m.type === 200);
  const text = JSON.stringify(c.inbox.filter(m => m.type === 210 || m.type === 200));
  c.ws.close();
  return text;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let owner, room;
try {
  console.log(`API: ${API}\nLiveblocks: ${LB}\n`);
  owner = (await call('/identity', null, { name: 'Prueba propietario' })).token;
  const viewer = (await call('/identity', null, { name: 'Prueba lector' })).token;
  room = await call('/rooms', owner, { name: 'Prueba de permisos (temporal)' });
  const inv = await call(`/rooms/${room.id}/invites`, owner, { role: 'viewer' });
  const joined = await call('/invites/accept', viewer, { token: inv.token });
  console.log(`Sala ${room.id}; rol del invitado: ${joined.role}`);

  const ownerLb = (await call('/auth', owner, {})).token;
  const viewerLb = (await call('/auth', viewer, {})).token;

  // 1) el propietario escribe una marca en la raíz
  const o = connect(room.id, ownerLb);
  await o.opened;
  const os = await o.wait(m => m.type === 104);
  o.send([{ type: 200 }]);
  await o.wait(m => m.type === 211 || m.type === 200);
  o.send([{ type: 201, ops: [{ type: 3, id: 'root', opId: 'own:1', data: { permProbe: 'owner' } }] }]);
  await sleep(800);
  console.log(`Permisos del propietario según Liveblocks: ${JSON.stringify(os.scopes)}`);

  // 2) el lector intenta escribir en bruto, sin el SDK
  const v = connect(room.id, viewerLb);
  await v.opened;
  const vs = await v.wait(m => m.type === 104);
  console.log(`Permisos del lector según Liveblocks:     ${JSON.stringify(vs.scopes)}`);
  v.send([{ type: 200 }]);
  await v.wait(m => m.type === 211 || m.type === 200).catch(() => {});
  v.send([{ type: 201, ops: [{ type: 3, id: 'root', opId: 'viewer:1', data: { permProbe: 'viewer', viewerWrite: true } }] }]);
  const rejected = await v.wait(m => m.type === 299, 2500).catch(() => null);
  await sleep(500);
  const ownerSawIt = o.inbox.some(m => m.type === 201 && JSON.stringify(m).includes('viewerWrite'));
  v.ws.close(); o.ws.close();

  // 3) leer el Storage de nuevo como propietario
  const stored = await readStorage(room.id, ownerLb);
  const applied = stored.includes('viewerWrite');

  console.log(`\nRechazo explícito (REJECT_STORAGE_OP): ${rejected ? 'sí — ' + (rejected.reason || '') : 'no'}`);
  console.log(`El propietario recibió la operación del lector: ${ownerSawIt ? 'sí' : 'no'}`);
  console.log(`La operación quedó guardada en Storage:        ${applied ? 'sí' : 'no'}`);
  console.log(applied || ownerSawIt
    ? '\n✗ ESCRITURA ACEPTADA: el servidor no aplicó el permiso de solo lectura.'
    : '\n✓ CORRECTO: Liveblocks rechazó en el servidor la escritura del lector.');
  process.exitCode = applied || ownerSawIt ? 1 : 0;
} catch (e) {
  console.error('Error:', e.message);
  process.exitCode = 2;
} finally {
  if (owner && room) await call(`/rooms/${room.id}`, owner, undefined, 'DELETE').catch(() => {});
}
