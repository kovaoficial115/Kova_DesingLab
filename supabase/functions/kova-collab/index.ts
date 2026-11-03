// Supabase Edge Function: servidor de colaboración (autenticación de Liveblocks, salas, roles e invitaciones).
// Despliegue: supabase functions deploy kova-collab --no-verify-jwt
// Secretos:   supabase secrets set LIVEBLOCKS_SECRET_KEY=sk_... KOVA_COLLAB_SECRET=... ALLOWED_ORIGINS=https://kovaoficial115.github.io
import { handle } from '../_shared/collab.ts';

Deno.serve(req => handle(req, k => Deno.env.get(k)));
