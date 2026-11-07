# Estudio 3D

El Estudio 3D muestra el arte del editor 2D sobre una prenda en 3D. El arte siempre sale de las mesas de trabajo del documento: el estudio no edita el diseño, lo coloca sobre la prenda.

## Flujo

1. **Prendas.** Importa un modelo `.glb` (Blender, Sketchfab, CGTrader…) desde el panel *Prendas*. Se valida antes de guardarlo en la biblioteca local del equipo. Con la biblioteca vacía puedes empezar con *Usar camiseta de ejemplo*.
2. **Material.** Elige la tela (algodón, felpa o poliéster), el color y el acabado (liso, jaspeado o lavado).
3. **Estampados.** Cada zona (frente, espalda, mangas y cuello) recibe una mesa de trabajo del documento abierto, a su tamaño físico real según sus ppp. Puedes moverla, escalarla y girarla dentro de la zona.
4. **Exportar render.** Exporta una imagen PNG (1080, 2048 o 4096 px, con fondo transparente o de color) o un video de una vuelta completa (MP4, o WebM si el navegador no graba MP4).

Los ajustes 3D (prenda, tela, zonas y estampados) se guardan dentro del `.kova`, en la sección opcional `garment3d`. Si la prenda es un GLB importado, el modelo viaja en el archivo (`models3d`, sin duplicados por hash).

> Si compartes un `.kova` que usa un modelo con licencia sin redistribución, compartes también el modelo. Revisa la licencia antes de enviarlo.

## Requisitos de los modelos

El agente y la app no modelan prendas: los modelos vienen de un programa 3D o de una tienda. Si un modelo no cumple, se rechaza o se avisa; no se fuerza.

| Comprobación | Límite |
|---|---|
| Triángulos | 50 000 como máximo (Draco y Meshopt admitidos) |
| Texturas | 2048 px por lado como máximo |
| Escala | La altura real debe quedar entre 0,3 y 1,6 m (ajústala con `unitScale`) |
| Origen | Centrado; si no, se avisa y se centra al cargar |
| Mallas | Prenda separada de maniquí, cordones o etiquetas |
| UV | Sin solapes en las zonas imprimibles (las dos caras de la tela no cuentan como solape) |
| Licencia | Debe declararse; si no permite redistribuir, el modelo solo vive en la biblioteca local |

Los modelos comprados o sin permiso de redistribución nunca se añaden al repositorio: se guardan en `local-assets/`, que está en `.gitignore`.

La camiseta de ejemplo (`public/garments/camiseta-basica.glb`) es «T-Shirt Low Poly» de [Chirag.Vijay](https://sketchfab.com/Chirag.Vijay), con licencia [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) ([fuente](https://sketchfab.com/3d-models/t-shirt-low-poly-3e4b13a502884acfbd79cee0f9cd8876)). Se ha simplificado y comprimido para KOVA.

## `garment.json`

Archivo opcional junto al `.glb` (impórtalos juntos). Corrige lo que el modelo no trae. Todas las claves son opcionales salvo las que la validación pida.

```json
{
  "id": "tshirt-regular",
  "name": "Camiseta regular fit",
  "category": "tshirt",
  "unitScale": 0.01,
  "fabric": "cotton",
  "useBaseColorMap": true,
  "printableMeshes": ["Camiseta"],
  "accessoryMeshes": ["Maniqui", "Etiqueta"],
  "zones": {
    "front": { "sizeCm": [30, 38], "centerCm": [0, 33] },
    "sleeveLeft": { "view": "right", "sizeCm": [9, 9], "centerCm": [0, 17] },
    "back": { "sizeCm": [34, 42], "uv": [0.52, 0.08, 0.95, 0.6] }
  },
  "license": { "name": "CC-BY-4.0", "author": "Autor", "source": "https://…", "redistributable": true }
}
```

| Clave | Tipo | Qué hace |
|---|---|---|
| `id` | texto | Identificador estable (se normaliza a minúsculas y guiones) |
| `name` | texto | Nombre en la biblioteca |
| `category` | `tshirt` · `hoodie` · `sport` · `crop` · `longsleeve` · `other` | Elige las zonas y la tela por defecto |
| `unitScale` | número > 0 | Metros por unidad del modelo (`0.01` si viene en centímetros) |
| `fabric` | `cotton` · `fleece` · `polyester` | Tela por defecto (si falta, la de su categoría) |
| `useBaseColorMap` | booleano | `false` ignora la textura de color del modelo (p. ej. una cuadrícula de prueba UV) |
| `printableMeshes` | lista de nombres | Mallas que forman la prenda; vacía = todas menos los accesorios |
| `accessoryMeshes` | lista de nombres | Se muestran, pero no reciben estampado |
| `zones` | objeto | Sustituye las zonas de la categoría (ver abajo) |
| `license` | objeto | Si falta, se lee de los metadatos del GLB (Sketchfab los incluye) |

### Zonas

Las claves son `front`, `back`, `sleeveLeft`, `sleeveRight` y `neck`. «Izquierda» es la de quien lleva la prenda. La prenda mira hacia +Z (convención glTF).

| Clave | Tipo | Qué hace |
|---|---|---|
| `sizeCm` | `[ancho, alto]` en cm | Área de impresión. Obligatoria en cada zona que declares |
| `view` | `front` · `back` · `left` · `right` | Desde dónde se proyecta el arte |
| `centerCm` | `[x, y]` en cm | `x` a la derecha del eje visto desde `view`; `y` por debajo del borde superior de la prenda |
| `uv` | `[u0, v0, u1, v1]` entre 0 y 1 | Rectángulo UV fijo (v hacia abajo, como la imagen). Si falta, se calcula sobre la malla |

Zonas por defecto (cm):

| Categoría | Frente | Espalda | Cuello | Mangas |
|---|---|---|---|---|
| Camiseta | 32 × 40 a 34 cm | 34 × 42 a 30 cm | 9 × 6 (espalda, a 6 cm) | 9 × 9 de costado, a 17 cm |
| Hoodie | 28 × 18 a 41 cm | 32 × 26 a 55 cm | 9 × 6 (espalda, a 30 cm) | 10 × 8 de frente, a ±38 cm |
| Deportiva | 28 × 30 a 30 cm | 32 × 42 a 30 cm | como camiseta | como camiseta |
| Crop | 26 × 18 a 25 cm | 28 × 20 a 23 cm | como camiseta | como camiseta |
| Manga larga | como camiseta | como camiseta | como camiseta | 8 × 34 de costado, a 38 cm |

## Cómo se estampa

- **Atlas UV.** Si el área cae en una sola isla UV sin costuras, el arte se pinta en una capa del atlas de la tela (2048 px; 4096 px solo durante renders de 2048 px o más). Sigue los pliegues de la malla.
- **Proyección (calcomanía).** Si cruza una costura UV o el área es tan pequeña que en el atlas se vería pixelada, se proyecta como calcomanía desde la vista de la zona. La tarjeta de la zona indica qué modo se usa y por qué.
- Solo cuenta la parte con tinta del arte: los márgenes transparentes de la mesa no se estampan ni cuentan como «se sale de la zona».

## Renders

- Se dibujan fuera de pantalla (render target con antialias), por mosaicos de 2048 px, con el mismo tono y color que el visor. No son capturas de la ventana.
- Si la GPU o la memoria no llegan a la resolución pedida, se baja al tamaño estándar que cabe y se avisa.
- El encuadre de las vistas predefinidas se ajusta a la silueta real de la prenda. «Actual» usa la cámara del visor.
- El video gira cámara, luces y entorno a la vez (equivale a girar la prenda) y se graba en tiempo real con MediaRecorder.

## Rendimiento

- Una sola escena viva. Se dibuja solo cuando algo cambia y el visor es visible. Densidad de píxeles ≤ 2.
- Al cambiar de prenda se libera la anterior (geometrías, texturas y materiales). Comprobado con 10 cambios seguidos sin crecimiento.
- Si el sistema retira el contexto WebGL, el visor lo recupera y rehace prenda, tela y estampados.
