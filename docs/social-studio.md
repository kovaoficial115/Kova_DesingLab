# Social Design Studio — análisis y plan de integración

Módulo de KOVA Design Lab para diseñar contenido de redes sociales: publicaciones, carruseles,
historias, portadas de Reels y de historias destacadas, miniaturas y banners, previsualizarlo y
exportarlo para subirlo **a mano**. No hay conexión con Instagram ni con ninguna red social, ni
publicación o programación automática.

## 1. Lo que ya existe y se reutiliza

| Pieza | Dónde | Cómo la usa Social Design Studio |
|---|---|---|
| Mesas de trabajo en un espacio de mundo común | `core/types.ts` (`Artboard`), `core/actions.ts` | Cada formato es una mesa. Las capas viven en coordenadas de mundo: una capa que cruza dos mesas sale en las dos, que es justo lo que pide un carrusel continuo. |
| Capas, grupos, máscaras, ajustes, texto con cuadros | `core/*`, `tools/*` | Sin cambios. La adaptación multiformato solo cambia posición y escala de copias de las capas. |
| Historial (deshacer/rehacer) | `core/store.ts` (`commit`, `live`) | Todo lo nuevo que cambia el documento pasa por `commit`: se deshace como cualquier otra acción. |
| Render por mesa | `core/render.ts` (`renderArtboard`) | Miniaturas de los simuladores y exportación. Las miniaturas se piden a escala pequeña (no se renderiza nada a resolución completa salvo al exportar). |
| Exportadores PNG/JPG/WEBP/SVG/PDF | `io/exporters.ts` | Se reutilizan tal cual; el panel social añade nombres por plataforma, lotes y ZIP. |
| ZIP | `fflate` (ya es dependencia) | Exportación de campañas en un solo `.zip`. |
| Formato `.kova` con secciones opcionales versionadas | `io/kova.ts` | Nueva sección `social` (esquema 3). Los archivos v1/v2 se abren igual; las secciones desconocidas se conservan. |
| Superposición del visor | `ui/Viewport.tsx` (`drawOverlay`) | Zonas seguras, guía circular, tercios y cortes de carrusel: se dibujan encima y **nunca se exportan**. |
| Autoguardado y recuperación | `io/fileOps.ts`, IndexedDB | Sin cambios: el documento social es un documento normal. |

## 2. Modelo de datos

- `Artboard.social?: { preset, series?: { id, kind, name, index }, label? }` — dentro del estado
  del documento, así entra en el historial, en el `.kova` y en la colaboración.
  - `preset`: id del formato (`ig-post-portrait`, `yt-thumb`, …) del que salen las zonas seguras y el nombre de archivo.
  - `series`: carrusel (`carousel`), carrusel continuo (`continuous`) o colección de destacadas (`highlights`).
  - `label`: nombre visible de una destacada («DROP 01», editable).
- `Doc.social?: { profile, plans }` — sección `social` del `.kova`: nombre de perfil de ejemplo para
  las vistas previas y planes del feed (orden de publicaciones guardado y comparable).
- Presets propios del usuario en `localStorage` (son pocos y pequeños); las imágenes, en el documento.

## 3. Módulos

```
src/social/
  presets.ts     plataformas, formatos, zonas seguras y guías (puro, editable, extensible)
  model.ts       tipos, saneado de la sección .kova, ayudas sobre mesas sociales (puro)
  adapt.ts       motor de adaptación multiformato (puro, con pruebas)
  carousel.ts    diapositivas, carrusel continuo, reordenar (puro + acciones)
  validate.ts    comprobaciones antes de exportar (puro)
  naming.ts      nombres de archivo por plataforma, formato y número de diapositiva
  variables.ts   CSV/JSON y sustitución de {{variables}} (puro)
  actions.ts     acciones con historial sobre el documento
  ui/            panel Social, simuladores, exportación, adaptación, lotes
```

## 4. Estado

| Fase | Estado | Dónde |
|---|---|---|
| 1. Integración: espacio DTF / Gráfico / Redes en Inicio, formatos de todas las plataformas (editables y ampliables), medidas personalizadas (px, cm, mm, in, ppp, proporción, orientación, fondo), panel «Redes sociales», guías en el visor, `.kova` v3 | Hecho | `social/presets.ts`, `social/model.ts`, `ui/Home.tsx`, `social/ui/SocialPanel.tsx`, `ui/Viewport.tsx` (`drawSocialGuides`), `io/kova.ts` |
| 2. Carruseles: crear, añadir, duplicar, eliminar, arrastrar para reordenar, numeración, carrusel continuo, panorama desde una capa, ZIP | Hecho | `social/carousel.ts`, `social/actions.ts` |
| 3. Adaptación: ajustar, rellenar, recortar, reorganizar, mantener; fondos que cubren y se recortan a la mesa; textos en zona segura; vista previa | Hecho | `social/adapt.ts`, `social/ui/AdaptDialog.tsx` |
| 4. Simuladores locales: perfil (cuadrícula 3:4, destacadas), publicación con carrusel deslizable, historia, Reel, planificador con planes guardados y armonía de color (ΔE) | Hecho | `social/ui/PreviewDialog.tsx` |
| 5. Automatización: `{{variables}}` en textos, capas de imagen `{{imagen}}`, CSV/JSON, lote a ZIP o a mesas editables | Hecho | `social/variables.ts`, `social/batch.ts`, `social/ui/BatchDialog.tsx` |
| 6. Exportación: PNG/JPEG/WebP/PDF/SVG, escala, calidad, fondo transparente, nombres por plataforma, carpetas por serie, PDF multipágina, peso real, validación | Hecho | `social/exportSocial.ts`, `social/validate.ts`, `social/ui/SocialExportDialog.tsx` |
| Variantes vinculadas con overrides | Pendiente | La adaptación crea copias independientes |
| Estilos tipográficos guardados y texto en trayectoria (§8) | Pendiente | |
| Biblioteca de marca (§9) | Pendiente | |
| Efectos CRT/VHS/glitch (§11) | Pendiente | |

Atajo: Redes → Exportar para redes (Ctrl/⌘+Alt+E).

## 5. Rendimiento

- Las vistas previas y miniaturas se renderizan a ≤ 400 px y se guardan en caché por estado del
  documento; nada se pinta a resolución completa salvo al exportar.
- Exportación en lote secuencial con progreso y posibilidad de cancelar, liberando cada lienzo.
- El visor ya dibuja por mosaicos y reducciones (ver commit de rendimiento de pinceles).
