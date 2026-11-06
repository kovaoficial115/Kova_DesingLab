import type { SaveTarget } from '../platform';
import type { Garment3DData } from './garment3d';

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
  | 'denoise' | 'vibrance';

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
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  letterSpacing: number;
  strokeColor: string;
  strokeWidth: number;
}

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
