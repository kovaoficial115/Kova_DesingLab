# Kova_DesignLab

Editor de imágenes de producción para impresión **DTF (Direct to Film)**. Funciona completamente en el navegador: los archivos no se suben a ningún servidor.

**Versión en línea:** https://kovaoficial115.github.io/Kova_DesingLab/

## Funciones

- **Archivos:** importa PNG, JPG, WEBP, SVG, TIFF, BMP, PSD (con capas) y PDF. Exporta PNG con transparencia y ppp incrustados, JPG, WEBP, TIFF (RGB y CMYK con perfil ICC), BMP, SVG, PDF y PSD.
- **Proyectos:** formato `.kova` editable, biblioteca local, autoguardado y recuperación tras cierre inesperado.
- **Edición:** capas, grupos, máscaras, máscaras de recorte, modos de fusión, ajustes no destructivos (niveles, curvas, tono/saturación, exposición, umbral, posterizar, desenfoque, enfoque, reducción de ruido…).
- **Medidas físicas:** tamaño en px/cm/mm/in, cambio de ppp con o sin remuestreo, resolución efectiva por capa.
- **Semitonos:** puntos, cuadrados, líneas, elipses; LPI, ángulo, transición a transparencia, modo CMYK con ángulos por canal.
- **Eliminar fondo:** con IA (modelo local en el navegador), por color, varita mágica, refinado de bordes y limpieza de alfa para DTF.
- **Tipografías propias:** sube TTF, OTF, WOFF, WOFF2 o el .zip de DaFont, o descarga cualquier fuente de Google Fonts (catálogo de Fontsource) desde la app. Se guardan en el navegador y viajan dentro de los proyectos `.kova` y los SVG exportados.
- **Vectorización** a SVG con control de colores, precisión y reducción de nodos.
- **Color:** espacios RGB/CMYK, conversión con perfiles ICC (LittleCMS), prueba de impresión, vista por canal, cobertura de tinta (TAC).
- **Herramientas DTF:** base blanca y knockout de prenda, separación de canales, comprobación previa a la impresión, hoja de impresión (gang sheet) con acomodo automático, mockups sobre camiseta o foto propia.

## Desarrollo

Requiere Node.js 18 o superior.

```bash
npm install
npm run dev        # servidor de desarrollo en http://localhost:5173
npm run build      # comprobación de tipos + compilación en dist/
npm run preview    # sirve la compilación localmente
```

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
```

El procesamiento pesado se ejecuta en Web Workers para no bloquear la interfaz.

## Limitaciones conocidas

- **CMYK:** sin un perfil ICC cargado, la conversión usa una fórmula aproximada (GCR/TAC), y la interfaz lo indica. Para separaciones precisas, carga el perfil de tu impresora en el panel *Canales*.
- **Eliminar fondo con IA:** usa `@imgly/background-removal`, que descarga el modelo la primera vez que se usa y tiene licencia **AGPL-3.0**.
- **Exportación PDF:** el PDF contiene la imagen rasterizada a la resolución elegida.
- **Exportación WEBP:** no almacena ppp; el formato no tiene un campo estándar para ello.
