// Configuración de la colaboración (variables de Vite, públicas: nunca contienen secretos).
//  VITE_COLLAB_API           URL del servidor de colaboración (Supabase Edge Function o server/dev.mjs)
//  VITE_LIVEBLOCKS_BASE_URL  solo en desarrollo, para el servidor local de Liveblocks
export const COLLAB_API = ((import.meta.env.VITE_COLLAB_API as string | undefined) || '').replace(/\/+$/, '');
export const LIVEBLOCKS_BASE_URL = (import.meta.env.VITE_LIVEBLOCKS_BASE_URL as string | undefined) || undefined;
export const collabConfigured = !!COLLAB_API;
/** Versión web publicada: los enlaces creados en la app de escritorio apuntan aquí (tauri://localhost no existe fuera de la app). */
export const PUBLIC_WEB_URL = ((import.meta.env.VITE_PUBLIC_WEB_URL as string | undefined) || 'https://kovaoficial115.github.io/Kova_DesingLab/').replace(/\/*$/, '/');
