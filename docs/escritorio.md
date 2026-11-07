# App de escritorio (macOS)

KOVA Design Lab para macOS es la misma app web dentro de una ventana nativa (Tauri 2, WebKit de macOS). Solo para Mac con Apple Silicon (M1 o posterior), macOS 13 o superior.

## Diferencias con la web

| | Web | Escritorio |
|---|---|---|
| Abrir archivos | Selector del navegador | Diálogo nativo de macOS |
| Guardar / exportar | Descarga (o ubicación elegida en Chrome) | Diálogo nativo; «Guardar» reescribe el mismo archivo sin preguntar |
| Confirmaciones | `confirm()` del navegador | Diálogo nativo |
| Enlaces externos | Pestaña nueva | Navegador predeterminado |
| Cerrar con cambios sin guardar | Aviso del navegador | Diálogo nativo |
| Datos locales (biblioteca, prendas, fuentes, autoguardado) | Del navegador | Propios de la app |

Los datos locales **no se comparten** entre la app y los navegadores. Para pasar tu trabajo usa *Exportar todo* / *Importar copia* en la pantalla de inicio, o abre los `.kova`. Las prendas 3D se importan de nuevo (o llegan dentro de un `.kova`).

Todo el acceso a archivos pasa por el Platform Adapter (`src/platform`). La implementación de escritorio (`desktop.ts`) solo se descarga dentro de la app.

## Compilar

Requisitos: Xcode Command Line Tools, Node 20 o superior y Rust estable (`rustup`, objetivo `aarch64-apple-darwin`).

```bash
npm install
npm run desktop:build      # .app y .dmg en src-tauri/target/aarch64-apple-darwin/release/bundle/
npm run desktop:dev        # ventana de desarrollo con recarga en caliente (usa el servidor de Vite)
```

Los scripts añaden `~/.cargo/bin` al PATH. La primera compilación descarga y compila Tauri (unos 2 minutos en un M2). `src-tauri/target` ocupa 1–4 GB y no se versiona.

## Seguridad

- **Permisos (capabilities):** solo diálogos (abrir, guardar y mensajes), leer y escribir los archivos que el usuario elige en esos diálogos, y cerrar la ventana. Sin acceso libre al disco ni a comandos del sistema.
- **CSP:** solo recursos propios, más Google Fonts, Fontsource/jsDelivr (catálogo de fuentes), Supabase y Liveblocks (colaboración) e IMG.LY (modelo de quitar fondo). Requiere `'unsafe-eval'` y `'wasm-unsafe-eval'` porque las librerías de quitar fondo y de color usan WebAssembly y código generado. Comprobada dentro de la app sin violaciones.
- **Colaboración:** el servidor `kova-collab` acepta por defecto el origen de la app (`tauri://localhost`).

## Fuera de alcance

Firma, notarización, App Store y actualizaciones automáticas. Al no estar firmada, macOS avisa la primera vez: abre la app con clic derecho → *Abrir*.

## Limitaciones

- *Eliminar fondo* funciona con un solo hilo (como en la web publicada): WebKit no ofrece `SharedArrayBuffer` sin aislamiento entre orígenes.
- El video giratorio se graba en MP4 (H.264) con el MediaRecorder de WebKit.
