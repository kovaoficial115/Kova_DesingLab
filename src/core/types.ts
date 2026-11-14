import type { SaveTarget } from '../platform';
import type { Garment3DData } from './garment3d';
import type { ArtboardSocial, DocSocial } from '../social/model';

// Modelo de datos del documento. Los bitmaps (HTMLCanvasElement) se tratan como
// inmutables: cualquier edición de píxeles crea un canvas nuevo (copy-on-write),
// lo que permite que el historial comparta referencias sin copiar memoria.

export type Unit = 'px' | 'cm' | 'mm' | 'in';

export type BlendMode =
  | 'source-over' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten'
  | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light' | 'difference'
  | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity';

export type AdjustmentType =
  | 'brightnessContrast' | 'hueSaturation' | 'exposure' | 'levels' | 'curves'
  | 'blackWhite' | 'invert' | 'threshold' | 'posterize' | 'blur' | 'sharpen'
  | 'denoise' | 'vibrance' | 'colorize' | 'gradientMap';

export interface Adjustment {
  id: string;
  type: AdjustmentType;
  enabled: boolean;
  params: Record<string, any>;
}

export type LayerKind = 'raster' | 'text' | 'shape' | 'group' | 'vector';

export interface TextProps {
  text: string;
  fontFamily: string;
  fontSize: number; // px del documento
  fontWeight: number;
  italic: boolean;
  color: string;
  /** Alineación del párrafo. Las «justify-*» reparten el ancho del cuadro; el sufijo dice cómo
   *  se alinea la última línea de cada párrafo ('justify': también la última). En texto de punto
   *  (sin cuadro) equivalen a izquierda, centro o derecha. */
  align: TextAlign;
  lineHeight: number;
  letterSpacing: number;
  strokeColor: string;
  strokeWidth: number;
  /** Cuadro de texto (texto de párrafo): el texto se ajusta a este ancho (px del documento, sin la
   *  escala de la capa). La altura crece si el texto no cabe. Sin cuadro: texto de punto. */
  box?: { w: number; h: number } | null;
  caps?: boolean; // todo en mayúsculas
  underline?: boolean;
  strike?: boolean; // tachado
  paraSpacing?: number; // px añadidos después de cada párrafo
  indent?: number; // sangría de la primera línea de cada párrafo (px)
  /** estilo de texto vinculado (DocState.textStyles): al editar el estilo cambian sus capas */
  styleId?: string | null;
  /** texto en trayectoria: las letras siguen una curva en vez de ir en renglones */
  path?: TextPath | null;
}

/** Trayectoria de un texto. `d` es la curva (SVG, coordenadas de la capa); las formas
 *  predefinidas guardan sus medidas para poder editarlas. */
export interface TextPath {
  kind: 'circle' | 'arc' | 'wave' | 'custom';
  d: string;
  /** círculo y arco: radio; arco: ángulo abarcado (grados) */
  r?: number;
  sweep?: number;
  /** onda: amplitud y longitud de onda (px), número de ondas */
  amp?: number;
  wavelength?: number;
  waves?: number;
  /** posición del texto a lo largo de la curva (% de su longitud), según la alineación */
  pos: number;
  /** recorre la curva al revés (las letras quedan al otro lado) */
  flip: boolean;
  /** desplazamiento perpendicular de la línea base (px; positivo = hacia fuera) */
  shift: number;
}

/** Estilo de texto con nombre. Solo define las propiedades que trae: un estilo de marca puede
 *  fijar la tipografía sin imponer un tamaño. */
export interface TextStyle {
  id: string;
  name: string;
  /** uso según el manual de marca (Titulares, Cuerpo de texto…) */
  role?: string;
  /** kit de marca de origen */
  kit?: string;
  props: TextStyleProps;
}
export type TextStyleProps = Partial<Pick<TextProps, 'fontFamily' | 'fontSize' | 'fontWeight' | 'italic' | 'color' | 'lineHeight' | 'letterSpacing' | 'caps' | 'align' | 'paraSpacing' | 'underline'>>;
export const TEXT_STYLE_KEYS = ['fontFamily', 'fontSize', 'fontWeight', 'italic', 'color', 'lineHeight', 'letterSpacing', 'caps', 'align', 'paraSpacing', 'underline'] as const;

/** Variante vinculada: copia de un componente que se actualiza cuando cambia el principal.
 *  Lo que se modifica en la variante (texto, colores…) se conserva: es una sustitución. */
export interface LayerLink {
  /** capa raíz del componente principal */
  master: string;
  /** capa del principal de la que es copia esta capa */
  src: string;
}

/** Recurso de un kit de marca colocado en el documento (logotipo, icono). */
export interface BrandRef {
  kit: string;
  asset: string;
  /** color aplicado (iconos recoloreables) */
  color?: string;
}

export type TextAlign = 'left' | 'center' | 'right' | 'justify-left' | 'justify-center' | 'justify-right' | 'justify';

export interface ShapeProps {
  shape: 'rect' | 'ellipse' | 'line';
  w: number;
  h: number;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  radius: number;
}

export interface VectorProps {
  svg: string; // documento SVG completo
  w: number;
  h: number;
}

export interface Layer {
  id: string;
  name: string;
  kind: LayerKind;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0..1
  blend: BlendMode;
  // Transformación: posición de la esquina sup-izq sin rotar; rotación alrededor del centro.
  x: number;
  y: number;
  rotation: number; // grados
  scaleX: number;
  scaleY: number;
  parentId: string | null;
  clip: boolean; // máscara de recorte con la capa inferior
  adjustments: Adjustment[];
  mask: HTMLCanvasElement | null; // luminancia/alpha: blanco = visible
  maskEnabled: boolean;
  collapsed?: boolean;
  // contenido
  canvas?: HTMLCanvasElement; // raster
  origin?: HTMLCanvasElement; // píxeles originales para el pincel de restauración
  text?: TextProps;
  shape?: ShapeProps;
  vector?: VectorProps;
  /** componente principal: sus variantes vinculadas siguen sus cambios */
  component?: { name: string } | null;
  /** variante vinculada a un componente */
  link?: LayerLink | null;
  /** recurso de marca (logotipo, marca responsive, icono) */
  brand?: BrandRef | null;
}

export interface Artboard {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  dpi: number;
  background: string | null; // null = transparente
  margin: number; // zona de seguridad en px
  /** formato de redes sociales y serie (carrusel, destacadas) — Social Design Studio */
  social?: ArtboardSocial | null;
}

export interface Guide {
  id: string;
  axis: 'x' | 'y';
  pos: number;
}

export interface Selection {
  // máscara en coordenadas de mundo (alpha = seleccionado)
  x: number;
  y: number;
  canvas: HTMLCanvasElement;
  shape?: { type: 'rect' | 'ellipse'; x: number; y: number; w: number; h: number } | null;
}

export type ColorMode = 'RGB' | 'CMYK';

export interface DocState {
  layers: Layer[]; // orden: índice 0 = fondo (abajo)
  artboards: Artboard[];
  guides: Guide[];
  selection: Selection | null;
  selectedLayerIds: string[];
  activeArtboardId: string;
  /** estilos de texto del documento (vinculados a sus capas) */
  textStyles?: TextStyle[];
}

export interface HistoryEntry {
  label: string;
  state: DocState;
  time: number;
}

export interface Doc {
  id: string;
  name: string;
  colorMode: ColorMode;
  state: DocState;
  past: HistoryEntry[];
  future: HistoryEntry[];
  lastLabel: string;
  /** destino de «Guardar» en disco (Platform Adapter) */
  fileHandle?: SaveTarget;
  dirty: boolean;
  createdAt: number;
  /** configuración del Estudio 3D (sección opcional `garment3d` del .kova) */
  garment3d?: Garment3DData;
  /** perfil y planes del feed de Social Design Studio (sección opcional `social` del .kova) */
  social?: DocSocial;
  /** origen del archivo: versión de formato y secciones desconocidas que se conservan al guardar */
  kova?: { sourceVersion: number; extra?: Record<string, unknown> };
  /** documento compartido en una sala de Liveblocks */
  collab?: CollabInfo;
}

export type CollabRole = 'owner' | 'editor' | 'viewer';
export interface CollabInfo {
  room: string;
  role: CollabRole;
  status: 'connecting' | 'uploading' | 'waiting' | 'ready' | 'error';
  /** true si este navegador debe subir el documento local a una sala vacía */
  seed?: boolean;
  error?: string;
  progress?: string;
}

export interface View {
  zoom: number;
  panX: number; // desplazamiento en px de pantalla del origen del mundo
  panY: number;
  /** true mientras la vista sigue el último «ajustar a pantalla» (se reajusta al redimensionar) */
  autoFit?: boolean;
}

export type ToolId =
  | 'move' | 'marquee' | 'ellipseMarquee' | 'lasso' | 'wand' | 'crop' | 'eyedropper'
  | 'brush' | 'eraser' | 'restore' | 'fill' | 'gradient' | 'text' | 'shape'
  | 'hand' | 'zoom' | 'artboard';
