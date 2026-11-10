# Análisis de Blankbuilder e integración en el Estudio 3D

Referencia funcional estudiada: https://blankbuilder.app/app/ (noviembre de 2026, parte pública, sin iniciar sesión). Se tomaron ideas de flujo y rendimiento. No se copió código, diseño ni recursos.

## 1. Cómo funciona Blankbuilder

**Arquitectura.** Usa three.js en JavaScript sin framework de componentes:
- OrbitControls con el desplazamiento lateral desactivado; lo sustituye con `camera.setViewOffset`.
- EffectComposer con oclusión ambiental (GTAO), entorno HDRI (RGBELoader) y gobos de luz.
- Dibuja solo cuando hay entrada del usuario o una animación (se «despierta» con los eventos).

**Calidad adaptativa.** Ofrece *Adaptive*, *Full*, *Half* y *Quarter*. En modo adaptativo baja la resolución de dibujo mientras gira y la recupera en reposo. Guarda la elección en `localStorage`.

**Interfaz.**
- Patrón de costura 2D a la izquierda y vista 3D a la derecha (modo *Split* o solo 3D).
- Pestañas *Design* y *Scene*.
- Visita guiada de 6 pasos.

**3D.**
- Vistas frontal, trasera y lateral; restablecer; doble clic para recentrar.
- Ayuda en pantalla: arrastre izquierdo gira, arrastre derecho mueve, rueda acerca.
- Biblioteca de unos 30 modelos con búsqueda y categorías.

**Elemento seleccionado.**
- Espejo, invertir, recortar, copiar y borrar.
- Colocaciones rápidas: pecho, logo de pecho, frente abajo, espalda, nuca, mangas y etiqueta.
- Ancho y alto en cm, giro, opacidad, ±90° y alinear a la pieza.
- Visibilidad por capa.
- De pago: vectorizar y ampliar (créditos); semitonos (Pro).

**Tela.** Colores sólidos o degradados, lavados y materiales. También ajustes de AO, arrugas, textura, tamaño del punto, brillo, contraste y luz principal.

**Escena.** HDRI (intensidad y giro), fondo con sombra y gobo, percha, etiqueta de cuello, giro automático y marcas del patrón.

**Exportación** (las capturas y exportaciones piden cuenta): render de catálogo, ZIP de archivos de impresión, paneles de sublimación, ficha técnica en PDF y video giratorio.

**Atajos del patrón.** Espacio o arrastre derecho para mover, doble clic para encuadrar, Ctrl suspende el ajuste magnético, Alt+arrastre o Ctrl+D duplica, Ctrl+Z deshace.

## 2. Comparación con el Estudio 3D de KOVA (antes de este cambio)

| Área | Blankbuilder | KOVA antes |
| --- | --- | --- |
| Colocar el arte | Arrastre en el patrón 2D, cm, colocaciones rápidas, alinear | Deslizadores de posición en fracción de zona, con retardo de 60 ms |
| Selección | Elemento activo con contorno | Ninguna en la vista 3D |
| Deshacer | Ctrl+Z | No había deshacer en el estudio |
| Atajos | Varios | Ninguno |
| Calidad | Adaptativa + fija | Densidad fija ≤ 2 |
| Cámara | Vistas, recentrar, giro automático | Vistas y órbita; sin encuadrar ni giro automático |
| Materiales | Muchos ajustes de tela, AO y HDRI | 3 telas, color, acabado y rugosidad; 3 luces |
| Exportación | Requiere cuenta; ZIP, PDF, video | PNG hasta 4096 px y video, sin cuenta |
| Semitonos | De pago | Incluido en el editor 2D |
| Formato | Propio en la nube | `.kova` local, versionado |

KOVA ya era más fuerte en exportación, formato abierto y edición del arte (el editor 2D completo). Le faltaba **manipulación directa y precisa** en la vista 3D y **control del rendimiento**.

## 3. Funciones elegidas y por qué

Se priorizaron usabilidad, rendimiento y potencia de edición, sin duplicar lo que ya hace el editor 2D.

1. **Arrastrar el estampado sobre la prenda.** Es la forma natural de colocar. Usa el plano de la zona en lugar de lanzar rayos contra la malla de 45 000 triángulos.
2. **Selección con contorno del área y de la tinta.** Muestra qué se está editando y dónde están los límites de impresión.
3. **Ajuste magnético con guías** al centro y a los bordes del área. Centrar a ojo es el error más común en DTF.
4. **Medidas en cm** (ancho, giro, distancia al centro y al borde superior), que es como trabaja un taller.
5. **Colocaciones rápidas** con medidas habituales (logo de pecho de 9 cm) y **alinear** a bordes y centro.
6. **Girar ±90°, espejo, ocultar, bloquear y quitar** por zona. Se guardan en el `.kova` de forma compatible.
7. **Deshacer y rehacer propios del estudio**, que funden los arrastres en un solo paso.
8. **Atajos de teclado** para vistas, encuadre, mover, ocultar y bloquear.
9. **Calidad adaptativa** del visor y modos fijos para equipos lentos.
10. **Encuadrar** (F o doble clic), **vista plana** y **giro automático**.
11. **Ocultar la biblioteca** para dar más espacio al visor.

## 4. Optimizaciones y mediciones

Las mediciones se tomaron en un Mac con Apple Silicon, con el visor a 538 × 710 px CSS.

| Medida | Antes | Después |
| --- | --- | --- |
| GPU por fotograma a densidad 2 / 1 / 0,5 | 4,87 / 1,33 / 0,93 ms | La calidad adaptativa elige el nivel según la duración real |
| Píxeles de dibujo en pantallas grandes | Sin tope (hasta 4× los CSS) | Tope de 2,6 Mpx en reposo, nunca por debajo de densidad 1 |
| Aplicar estampados (`setPrints`) | 5–10 ms (hasta 21 ms subiendo texturas) | Mediana de 2,1 ms; 1,1 ms por fotograma de arrastre |
| Texturas tras 20 cambios seguidos | Nueva textura en cada cambio | Constante (4): se reutiliza el lienzo y la textura |
| Respuesta al mover un estampado | Retardo de 60 ms por el deslizador | Una actualización por fotograma, sin pasar por el documento |
| Recuperar resolución al parar | — | ~14 fotogramas (lo que dura la inercia de la órbita) |

Más detalles:
- El regulador adaptativo bajó de densidad 2 a 1,5 con fotogramas simulados de 50 ms y volvió a 2 en reposo.
- El cursor de agarre se comprueba como mucho una vez por fotograma.
- Se mantiene el dibujo bajo demanda: en reposo no hay bucle de render.

## 5. No implementado y por qué

- **Jerarquía de objetos, grupos, multiselección y gizmos libres.** El estudio es una maqueta de una prenda con zonas de impresión fijas. Un gizmo libre permitiría poner el arte fuera de las zonas que se pueden imprimir.
- **Metalizado y transparencia.** No aplican a la tela de una prenda DTF.
- **Oclusión ambiental (GTAO) y posprocesado.** Su coste en GPU integrada contradice el objetivo de rendimiento. La iluminación actual ya separa bien los pliegues.
- **Gobos, fondo con sombra y percha.** Son estéticos; quedan para más adelante.
- **Catálogo de modelos incluido.** Depende de licencias que permitan redistribuir. Se mantiene la importación de GLB y la camiseta de ejemplo CC-BY-4.0.
- **Vectorizar y ampliar.** En Blankbuilder son servicios de pago en la nube; KOVA trabaja en local.
- **Editor de patrón de costura.** El editor 2D de KOVA ya es la fuente del arte. Duplicarlo iría contra la regla de no repetir herramientas.
- **ZIP de archivos de impresión y ficha técnica en PDF.** Son útiles, pero no forman parte del editor 3D. Son buenos candidatos para una fase siguiente.
- **Cámara ortográfica real.** Se sustituye por una «vista plana» con teleobjetivo de 6°. Así se conserva todo el sistema de exportación y encuadre, que asume cámara en perspectiva.
