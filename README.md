# Kova_DesignLab

Editor de imágenes de producción para impresión **DTF (Direct to Film)**. Funciona completamente en el navegador: los documentos locales no se suben a ningún servidor. Los proyectos que decides compartir se sincronizan en tiempo real con [Liveblocks](https://liveblocks.io) (ver *Colaboración en tiempo real*).

**Versión en línea:** https://kovaoficial115.github.io/Kova_DesingLab/

## Funciones

- **Archivos:** importa PNG, JPG, WEBP, SVG, TIFF, BMP, PSD (con capas) y PDF. Exporta PNG con transparencia y ppp incrustados, JPG, WEBP, TIFF (RGB y CMYK con perfil ICC), BMP, SVG, PDF y PSD.
- **Proyectos:** formato `.kova` editable, biblioteca local, autoguardado y recuperación tras cierre inesperado.
- **Edición:** capas, grupos, máscaras, máscaras de recorte, modos de fusión, ajustes no destructivos (niveles, curvas, tono/saturación, colorear con cualquier color, mapa de degradado, exposición, umbral, posterizar, desenfoque, enfoque, reducción de ruido…).
- **Medidas físicas:** tamaño en px/cm/mm/in, cambio de ppp con o sin remuestreo, resolución efectiva por capa.
- **Semitonos:** puntos, cuadrados, líneas, elipses; LPI, ángulo, transición a transparencia, modo CMYK con ángulos por canal. Puntos del color de la imagen, de un color cualquiera o en degradado de dos colores; en CMYK, cualquier color de tinta por canal (tintas planas).
- **Eliminar fondo:** con IA (modelo local en el navegador), por color, varita mágica, refinado de bordes y limpieza de alfa para DTF.
- **Tipografías propias:** sube TTF, OTF, WOFF, WOFF2 o el .zip de DaFont, o descarga cualquier fuente de Google Fonts (catálogo de Fontsource) desde la app. Se guardan en el navegador y viajan dentro de los proyectos `.kova` y los SVG exportados.
- **Vectorización** a SVG con control de colores, precisión y reducción de nodos.
- **Color:** espacios RGB/CMYK, conversión con perfiles ICC (LittleCMS), prueba de impresión, vista por canal, cobertura de tinta (TAC).
- **Colaboración en tiempo real:** comparte un documento con un enlace; cursores, selecciones y cambios de todas las personas al instante, roles Propietario/Editor/Lector, historial de versiones y edición sin conexión.
- **Herramientas DTF:** base blanca y knockout de prenda, separación de canales, comprobación previa a la impresión, hoja de impresión (gang sheet) con acomodo automático, mockups sobre camiseta o foto propia.
- **Estudio 3D:** prendas en 3D (GLB) con tela, color y acabado; el arte de las mesas de trabajo se estampa por zonas a tamaño real; renders PNG hasta 4096 px con fondo transparente y video giratorio. Ver [docs/estudio-3d.md](docs/estudio-3d.md), con el formato `garment.json`.
- **App de escritorio para macOS** (Apple Silicon) con diálogos y archivos nativos. Ver [docs/escritorio.md](docs/escritorio.md).

## Desarrollo

Requiere Node.js 18 o superior.

```bash
npm install
npm run dev        # servidor de desarrollo en http://localhost:5173
npm run build      # comprobación de tipos + compilación en dist/
npm run preview    # sirve la compilación localmente
npm test           # pruebas unitarias (Vitest)
npm run desktop:build   # app de macOS (requiere Rust; ver docs/escritorio.md)
```

Los modelos 3D comprados o sin permiso de redistribución van en `local-assets/` (ignorado por git), nunca en el repositorio.

## Colaboración en tiempo real

La sincronización principal usa **Liveblocks** (Storage, Presence, Broadcast e History). Un pequeño servidor propio (Supabase Edge Function) solo se encarga de lo que no puede hacer el navegador sin exponer la clave secreta: identificar a cada persona, crear salas, gestionar roles e invitaciones y firmar el acceso a Liveblocks.

```
Navegador ──(token Kova firmado)──▶ kova-collab (Supabase Edge Function, guarda la sk_ de Liveblocks)
    │                                   ├─ POST /auth → identifyUser → ID token de Liveblocks
    │                                   └─ salas, roles (usersAccesses), invitaciones, versiones
    └──(ID token)──▶ Liveblocks ── WebSocket: Storage + Presence (cursores, selección, actividad)
                        └─ LiveFile: bitmaps, máscaras, SVG grandes y tipografías (se suben una vez)
```

- **Qué se sincroniza:** capas (orden, transformaciones, propiedades, creación/eliminación), grupos, máscaras, ajustes, textos, formas, mesas de trabajo, guías, tipografías propias y el nombre/modo de color del documento. Cada propiedad es un registro independiente: dos personas que cambian cosas distintas de la misma capa no se pisan; en la misma propiedad gana el último cambio.
- **Qué no viaja por Storage:** los píxeles. Cada bitmap se sube como un `LiveFile` inmutable solo cuando cambia y se referencia por id; el resto de personas lo descargan una vez.
- **Web y escritorio juntos:** un proyecto compartido se edita a la vez desde la web y desde la app de macOS. Los enlaces que crea la app abren la versión web; en la app, los enlaces recibidos se pegan en *Proyectos compartidos* (pantalla de inicio).
- **Qué es de cada persona:** zoom, desplazamiento, herramienta activa, paneles y vista. No se sincronizan.
- **Presencia:** cursor con nombre y color, selección (contorno discontinuo), mesa de trabajo, herramienta y actividad («moviendo», «pintando»…). Clic en un avatar para ir a donde está esa persona.
- **Roles:** *Propietario* (todo, incluido invitar, cambiar roles, desactivar enlaces y borrar), *Editor* (editar y restaurar versiones) y *Lector* (ver y mostrar su cursor). El servidor asigna los permisos en Liveblocks (`room:write` o `room:read` + `room:presence:write`) y Liveblocks los aplica al conectarse; la interfaz además bloquea la edición para el lector. Comprobado contra el servidor real: Liveblocks rechaza («Missing write permission») cualquier escritura del lector aunque se salte el SDK. Los cambios de rol se aplican en la app al momento y sin recargar; en el servidor de Liveblocks tardan hasta ~1 minuto (la app reintenta la conexión hasta recibir el nuevo permiso).
- **Guardado:** cada cambio se envía en menos de 50 ms y Liveblocks lo guarda; el indicador de la barra superior muestra *Guardando… / Guardado / Reconectando / Sin conexión*. Sin conexión se puede seguir editando y todo se envía al reconectar. El navegador avisa antes de cerrar si queda algo pendiente.
- **Versiones:** guardado automático cada 10 minutos con cambios (lo hace una sola persona conectada) y versiones con nombre desde *Archivo → Historial de versiones*. Se conservan 80. Restaurar guarda antes una copia «Antes de restaurar» y se puede deshacer con ⌘Z.
- **Deshacer:** ⌘Z/⇧⌘Z deshacen solo tus cambios (historial de Liveblocks), sin revertir los de otras personas.

### Probar en local

Requiere [Bun](https://bun.sh) para el servidor local de Liveblocks (no hace falta cuenta).

```bash
cp .env.example .env.development.local
npm run liveblocks:dev     # terminal 1: Liveblocks local en http://localhost:1153
npm run collab:dev         # terminal 2: servidor de colaboración en http://localhost:8787
npm run dev                # terminal 3: la app
```

Para simular varias personas abre la app en orígenes distintos (cada uno tiene su propia identidad): `http://localhost:5173`, `http://127.0.0.1:5173` y, por ejemplo, `http://otra.localhost:5173`.

### Puesta en producción

El servidor vive en un proyecto de Supabase propio, **kova-designlab** (`ljwjjhiurgesowiwonyt`), separado del catálogo (`kova-catalogo`): no comparten base de datos, funciones, secretos ni cuotas. La colaboración no usa la base de datos; todo lo guarda Liveblocks.

1. **Liveblocks:** en el proyecto *kova_desingLab* de <https://liveblocks.io/dashboard>, abre **API keys** y copia la **Secret key** (`sk_…`). La clave pública no se usa: la app se autentica con ID tokens emitidos por el servidor. La clave secreta solo va al servidor; nunca al frontend ni al repositorio.
2. **Secreto en Supabase:** en el panel del proyecto kova-designlab, **Edge Functions → Secrets → Add new secret**: nombre `LIVEBLOCKS_SECRET_KEY`, valor la clave del paso 1. Es el único secreto obligatorio: la clave para firmar identidades e invitaciones se deriva de ella (o define `KOVA_COLLAB_SECRET`, 32+ caracteres, para usar una propia). Con la CLI:
   ```bash
   supabase secrets set LIVEBLOCKS_SECRET_KEY=sk_xxx --project-ref ljwjjhiurgesowiwonyt
   ```
3. **Función** (ya desplegada; para volver a desplegar tras cambiar el código):
   ```bash
   supabase functions deploy kova-collab --no-verify-jwt --project-ref ljwjjhiurgesowiwonyt
   curl https://ljwjjhiurgesowiwonyt.supabase.co/functions/v1/kova-collab/   # → {"ok":true,"service":"kova-collab"}
   ```
   `--no-verify-jwt` es necesario porque la función usa sus propios tokens, no los de Supabase Auth. Por defecto solo acepta peticiones desde `https://kovaoficial115.github.io` y desde la app de escritorio (`tauri://localhost`); cámbialo con `ALLOWED_ORIGINS`.
4. **Comprobar los permisos en el servidor de Liveblocks** (crea una sala temporal, intenta escribir como lector saltándose el SDK y la borra):
   ```bash
   COLLAB_API=https://ljwjjhiurgesowiwonyt.supabase.co/functions/v1/kova-collab npm run collab:check-perms
   ```
5. **GitHub Pages:** la URL del servidor está en `.env.production` (`VITE_COLLAB_API`; es pública, no es un secreto) y se incluye al compilar en cada `push` a `main`. Si se borra, la app funciona igual pero sin el botón *Compartir*.

Variables del servidor: `LIVEBLOCKS_SECRET_KEY` (obligatoria), `KOVA_COLLAB_SECRET` (opcional), `ALLOWED_ORIGINS` (opcional, orígenes separados por comas) y `LIVEBLOCKS_BASE_URL` (solo para el servidor local).

El proyecto gratuito de Supabase se pausa tras una semana sin uso. Para evitarlo, `.github/workflows/keep-alive.yml` hace cada 3 días una consulta mínima (`public.ping()`) y comprueba `kova-collab`; se puede lanzar a mano en **Actions → Mantener activo Supabase → Run workflow**. GitHub desactiva las tareas programadas de un repositorio público tras 60 días sin commits: si eso pasa, te avisa por correo y basta con volver a activarla en Actions. Si aun así se pausa, la colaboración deja de responder hasta reactivarlo desde el panel (la app y el catálogo no se ven afectados).

### Limitaciones de la colaboración

- **Identidad sin contraseña:** cada persona elige un nombre y recibe una identidad firmada que se guarda en el navegador. La *clave de acceso* (Archivo → Mi perfil de colaboración) sirve para usar la misma identidad en otro dispositivo; quien la tenga puede actuar como esa persona. No hay cuentas con correo y contraseña.
- **Permisos de lector en local:** el servidor local `liveblocks dev` 1.9.0 no aplica `room:read` a mensajes enviados saltándose el SDK (sí lo hace el servidor real; ver el paso 4).
- **Quitar acceso no corta la conexión abierta en Liveblocks:** al quitar a alguien o pasarlo a Lector, su app se bloquea y se desconecta al instante, pero Liveblocks no ofrece una forma de cerrar la sesión de una persona concreta: una conexión ya abierta conserva sus permisos hasta que se reconecta, y durante ~1 minuto todavía se aceptan conexiones nuevas. Solo afecta a un cliente manipulado a propósito; el acceso a la API propia (salas, invitaciones, versiones, archivos) sí se corta al momento.
- **Píxeles durante un trazo:** las demás personas ven el resultado al soltar el pincel, no el trazo mientras se dibuja.
- **Imágenes en local:** el servidor local no envía cabeceras CORS para los archivos, así que la app los descarga a través de `kova-collab` cuando la descarga directa falla.
- **Historial de versiones:** se usa un historial propio (instantáneas como `LiveFile`), no el historial de versiones nativo de Liveblocks.
- **Archivos huérfanos:** los `LiveFile` que ya no usa ninguna capa siguen contando para la cuota de almacenamiento del plan de Liveblocks.
- **Tamaño de sala:** hasta 45 miembros por proyecto (límite de metadatos de Liveblocks).

## Publicación

Cada `push` a `main` compila y publica el sitio en GitHub Pages mediante `.github/workflows/deploy.yml`. Para activarlo, en el repositorio: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Arquitectura

```
src/
  core/     modelo de documento, estado (zustand), historial, renderizado, acciones
  engine/   procesamiento de píxeles, semitonos, alfa, color/ICC, Web Workers
  io/       importadores, exportadores, formatos binarios (PNG pHYs, TIFF, BMP), proyectos
  tools/    herramientas del lienzo (mover, selección, pincel, texto, recorte…)
  ui/       interfaz: menús, paneles, diálogos y pantalla de inicio
  collab/   colaboración: motor de sincronización con Liveblocks, presencia, salas y diálogos
  studio3d/ Estudio 3D: visor (three.js), validación de modelos, telas, estampados por zonas, renders
  platform/ Platform Adapter: único acceso a archivos y diálogos (web y escritorio)
  storage/  almacenamiento local (IndexedDB) con migraciones y recursos por hash
src-tauri/           app de escritorio para macOS (Tauri 2)
supabase/functions/  servidor de colaboración (kova-collab) para Supabase Edge Functions
server/dev.mjs       el mismo servidor sobre Node, para desarrollo local
```

El procesamiento pesado se ejecuta en Web Workers para no bloquear la interfaz.

## Limitaciones conocidas

- **CMYK:** sin un perfil ICC cargado, la conversión usa una fórmula aproximada (GCR/TAC), y la interfaz lo indica. Para separaciones precisas, carga el perfil de tu impresora en el panel *Canales*.
- **Eliminar fondo con IA:** usa `@imgly/background-removal`, que descarga el modelo la primera vez que se usa y tiene licencia **AGPL-3.0**.
- **Exportación PDF:** el PDF contiene la imagen rasterizada a la resolución elegida.
- **Exportación WEBP:** no almacena ppp; el formato no tiene un campo estándar para ello.

## Créditos

- Camiseta de ejemplo del Estudio 3D: «T-Shirt Low Poly» de [Chirag.Vijay](https://sketchfab.com/Chirag.Vijay), [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/), simplificada para KOVA.
