// Supabase Edge Function: servidor de colaboración (autenticación de Liveblocks, salas, roles e invitaciones).
// Despliegue: supabase functions deploy kova-collab --no-verify-jwt
// Secreto obligatorio: LIVEBLOCKS_SECRET_KEY (sk_…). Opcionales: KOVA_COLLAB_SECRET y ALLOWED_ORIGINS.
import { handle } from '../_shared/collab.ts';

// Orígenes que pueden usar el servidor si no se define ALLOWED_ORIGINS: la web publicada y la
// app de escritorio para macOS (Tauri sirve la interfaz desde tauri://localhost).
const DEFAULT_ORIGINS = 'https://kovaoficial115.github.io,tauri://localhost';

Deno.serve(req => handle(req, k => Deno.env.get(k) ?? (k === 'ALLOWED_ORIGINS' ? DEFAULT_ORIGINS : undefined)));
