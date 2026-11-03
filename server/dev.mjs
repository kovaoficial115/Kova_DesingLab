// Servidor de colaboración para desarrollo local (Node 22.6+ ejecuta el .ts directamente).
//
//   npm run collab:dev        → servidor de Liveblocks local + este servidor en http://localhost:8787
//
// Variables: LIVEBLOCKS_SECRET_KEY, KOVA_COLLAB_SECRET, LIVEBLOCKS_BASE_URL, ALLOWED_ORIGINS, PORT.
// Sin variables usa el servidor local de Liveblocks (`liveblocks dev`, clave sk_localdev).
import http from 'node:http';
import { handle } from '../supabase/functions/_shared/collab.ts';

const env = {
  LIVEBLOCKS_SECRET_KEY: 'sk_localdev',
  LIVEBLOCKS_BASE_URL: 'http://localhost:1153',
  KOVA_COLLAB_SECRET: 'kova-dev-secret-only-for-local-development',
  ALLOWED_ORIGINS: '*',
  ...process.env,
};
const port = Number(env.PORT || 8787);

http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(`http://localhost:${port}${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    const r = await handle(request, k => env[k]);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
    console.log(req.method, req.url, r.status);
  } catch (e) {
    console.error(e);
    res.writeHead(500); res.end('error');
  }
}).listen(port, () => console.log(`kova-collab en http://localhost:${port} (Liveblocks: ${env.LIVEBLOCKS_BASE_URL || 'nube'})`));
