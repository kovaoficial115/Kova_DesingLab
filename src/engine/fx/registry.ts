// Registro de efectos: define cada efecto (parámetros, valores por defecto, categoría) y cómo se
// ejecuta. La interfaz, la biblioteca, los preajustes y el worker leen de aquí: añadir un efecto
// es añadir una entrada.

import type { Px } from './core';
import type { FxBlend } from './core';
import * as Bl from './blur';
import * as Nz from './noise';
import * as Gl from './glitch';
import * as An from './analog';
import * as Gw from './glow';
import * as Co from './color';
import * as Tx from './texture';
import { HSL_RANGES, SEL_RANGES } from './color';

export type FxCat = 'blur' | 'noise' | 'distortion' | 'glitch' | 'vhs' | 'crt' | 'glow' | 'color' | 'texture';
export const FX_CATS: { id: FxCat; label: string }[] = [
  { id: 'blur', label: 'Desenfoque' }, { id: 'noise', label: 'Ruido y grano' }, { id: 'distortion', label: 'Distorsión' },
  { id: 'glitch', label: 'Glitch' }, { id: 'vhs', label: 'VHS' }, { id: 'crt', label: 'CRT' }, { id: 'glow', label: 'Neón y brillo' },
  { id: 'color', label: 'Color Lab' }, { id: 'texture', label: 'Texturas' },
];

interface PBase { k: string; label: string; tip?: string; when?: (p: any) => boolean; group?: string }
export type ParamDef =
  | (PBase & { type: 'range'; min: number; max: number; step?: number; unit?: string; px?: boolean; digits?: number })
  | (PBase & { type: 'color' })
  | (PBase & { type: 'select'; options: { value: string; label: string }[] })
  | (PBase & { type: 'bool' })
  | (PBase & { type: 'seed' })
  | (PBase & { type: 'text' })
  /** centro del efecto, en fracción del contenido (0..1): se mueve también arrastrando en el lienzo */
  | (PBase & { type: 'point'; kx: string; ky: string });

export interface FxDef {
  id: string;
  label: string;
  cat: FxCat;
  desc: string;
  params: ParamDef[];
  defaults: Record<string, any>;
  run: (img: Px, p: any) => void;
  /** por píxel (sin vecinos): se puede hornear en una LUT */
  point?: boolean;
  /** coste alto: la vista previa se calcula reducida mientras se arrastra */
  heavy?: boolean;
  /** modo de fusión con el que se suele usar */
  blend?: FxBlend;
  /** editor especial en la interfaz */
  ui?: 'hsl' | 'balance' | 'wheels' | 'selective' | 'lut';
}

const R = (k: string, label: string, min: number, max: number, o: Partial<{ step: number; unit: string; px: boolean; digits: number; tip: string; when: (p: any) => boolean; group: string }> = {}): ParamDef => ({ k, label, type: 'range', min, max, ...o });
const PX = (k: string, label: string, min: number, max: number, o: Partial<{ step: number; digits: number; tip: string; when: (p: any) => boolean }> = {}) => R(k, label, min, max, { unit: 'px', px: true, ...o });
const PCT = (k: string, label: string, min = 0, max = 100, o: Partial<{ tip: string; when: (p: any) => boolean; group: string }> = {}) => R(k, label, min, max, { unit: '%', ...o });
const ANG = (k = 'angle', label = 'Ángulo', o: Partial<{ when: (p: any) => boolean }> = {}) => R(k, label, -180, 180, { unit: '°', ...o });
const COL = (k: string, label: string, o: Partial<PBase> = {}): ParamDef => ({ k, label, type: 'color', ...o });
const SEL = (k: string, label: string, options: [string, string][], o: Partial<PBase> = {}): ParamDef => ({ k, label, type: 'select', options: options.map(([value, l]) => ({ value, label: l })), ...o });
const BOOL = (k: string, label: string, o: Partial<PBase> = {}): ParamDef => ({ k, label, type: 'bool', ...o });
const SEED: ParamDef = { k: 'seed', label: 'Semilla', type: 'seed', tip: 'Cambia la distribución al azar del efecto sin cambiar su carácter.' };
const CENTER: ParamDef = { k: 'center', label: 'Centro', type: 'point', kx: 'cx', ky: 'cy', tip: 'También puedes arrastrar el punto sobre el lienzo.' };
const QUALITY = SEL('quality', 'Calidad', [['draft', 'Borrador'], ['normal', 'Normal'], ['high', 'Alta']], { tip: 'Más calidad = más muestras (más lento en imágenes grandes).' });
const GLOW_MODES = SEL('mode', 'Fusión de la luz', [['screen', 'Trama'], ['add', 'Sumar'], ['lighten', 'Aclarar'], ['color-dodge', 'Sobreexponer']]);
const TEX_BASE: ParamDef[] = [
  R('scale', 'Escala', 10, 400, { unit: '%' }), ANG('rotation', 'Rotación'), PCT('opacity', 'Opacidad'),
  SEL('mode', 'Modo de fusión', [['normal', 'Normal'], ['screen', 'Trama'], ['multiply', 'Multiplicar'], ['overlay', 'Superponer'], ['soft-light', 'Luz suave'], ['add', 'Sumar'], ['lighten', 'Aclarar'], ['darken', 'Oscurecer']]),
  SEED,
];

const NOISE_KINDS: [string, string][] = [['gaussian', 'Gaussiano'], ['uniform', 'Uniforme'], ['film', 'Grano de película'], ['analog', 'Analógico'], ['chromatic', 'Cromático'], ['mono', 'Monocromático'], ['digital', 'Digital'], ['sensor', 'Sensor']];

const defs: FxDef[] = [
  // ---------------- desenfoques ----------------
  { id: 'boxBlur', label: 'Desenfoque de caja', cat: 'blur', desc: 'Promedio uniforme: rápido y de bordes duros.', params: [PX('radius', 'Radio', 0, 200), QUALITY], defaults: { radius: 8, quality: 'normal' }, run: Bl.boxBlur },
  { id: 'lensBlur', label: 'Desenfoque de lente', cat: 'blur', desc: 'Bokeh circular: las luces se abren en discos.', heavy: true, params: [PX('radius', 'Radio', 0, 150), PCT('bokeh', 'Brillo del bokeh'), R('brightness', 'Brillo', -50, 50), QUALITY], defaults: { radius: 12, bokeh: 40, brightness: 0, quality: 'normal' }, run: Bl.lensBlur },
  { id: 'surfaceBlur', label: 'Desenfoque de superficie', cat: 'blur', desc: 'Suaviza las zonas parejas y respeta los bordes (piel, cielos).', heavy: true, params: [PX('radius', 'Radio', 1, 60), R('threshold', 'Umbral', 1, 100), QUALITY], defaults: { radius: 8, threshold: 18, quality: 'normal' }, run: Bl.surfaceBlur },
  { id: 'medianBlur', label: 'Mediana', cat: 'blur', desc: 'Quita motas y deja un aspecto pictórico.', heavy: true, params: [PX('radius', 'Radio', 1, 12, { step: 1 })], defaults: { radius: 3 }, run: Bl.medianBlur },
  { id: 'motionBlur', label: 'Desenfoque de movimiento', cat: 'blur', desc: 'Barrido en una dirección, como una cámara en movimiento.', heavy: true, params: [ANG(), PX('distance', 'Distancia', 0, 400), QUALITY], defaults: { angle: 0, distance: 40, quality: 'normal' }, run: Bl.motionBlur },
  { id: 'directionalBlur', label: 'Desenfoque direccional', cat: 'blur', desc: 'Estela hacia un solo lado con caída controlable.', heavy: true, params: [ANG(), PX('distance', 'Distancia', 0, 400), PCT('intensity', 'Intensidad'), R('falloff', 'Caída', 0, 100), QUALITY], defaults: { angle: 0, distance: 60, intensity: 80, falloff: 50, quality: 'normal' }, run: Bl.directionalBlur },
  { id: 'radialBlur', label: 'Desenfoque radial', cat: 'blur', desc: 'Giro alrededor de un centro editable.', heavy: true, params: [CENTER, R('angle', 'Ángulo de giro', 0, 90, { unit: '°' }), PCT('inner', 'Zona nítida central'), QUALITY], defaults: { cx: 0.5, cy: 0.5, angle: 8, inner: 0, quality: 'normal' }, run: Bl.radialBlur },
  { id: 'zoomBlur', label: 'Desenfoque de zoom', cat: 'blur', desc: 'Estelas hacia un punto: sensación de velocidad.', heavy: true, params: [CENTER, PCT('amount', 'Cantidad'), QUALITY], defaults: { cx: 0.5, cy: 0.5, amount: 30, quality: 'normal' }, run: Bl.zoomBlur },
  { id: 'spinBlur', label: 'Desenfoque de giro', cat: 'blur', desc: 'Giro solo dentro de un círculo (ruedas, hélices).', heavy: true, params: [CENTER, PX('radius', 'Radio de la zona', 4, 3000), R('angle', 'Ángulo de giro', 0, 180, { unit: '°' }), PCT('feather', 'Suavizado del borde'), QUALITY], defaults: { cx: 0.5, cy: 0.5, radius: 300, angle: 25, feather: 20, quality: 'normal' }, run: Bl.spinBlur },
  { id: 'tiltShift', label: 'Cambio de inclinación', cat: 'blur', desc: 'Franja (o círculo) nítida y desenfoque progresivo: efecto maqueta.', heavy: true, params: [SEL('mode', 'Forma', [['linear', 'Lineal'], ['radial', 'Radial']]), CENTER, ANG('angle', 'Ángulo', { when: p => p.mode !== 'radial' }), PCT('focus', 'Zona nítida'), PCT('transition', 'Transición'), PX('radius', 'Desenfoque', 0, 120), R('saturation', 'Saturación', -100, 100)], defaults: { mode: 'linear', cx: 0.5, cy: 0.55, angle: 0, focus: 18, transition: 30, radius: 16, saturation: 15 }, run: Bl.tiltShift },

  // ---------------- ruido ----------------
  { id: 'noise', label: 'Ruido y grano', cat: 'noise', desc: 'Gaussiano, uniforme, grano de película, analógico, cromático, digital o de sensor. La semilla fija el resultado.', params: [
    SEL('kind', 'Tipo', NOISE_KINDS), PCT('amount', 'Cantidad'), PX('size', 'Tamaño del grano', 1, 12, { step: 0.1, digits: 1 }), PCT('density', 'Densidad'),
    SEL('distribution', 'Distribución', [['gaussian', 'Gaussiana'], ['uniform', 'Uniforme']], { when: p => !['gaussian', 'uniform'].includes(p.kind) }),
    BOOL('mono', 'Monocromático', { when: p => !['film', 'mono', 'chromatic'].includes(p.kind) }), R('contrast', 'Contraste', -100, 100), SEED,
  ], defaults: { kind: 'film', amount: 18, size: 1.2, density: 100, distribution: 'gaussian', mono: true, contrast: 0, seed: 1 }, run: Nz.addNoise },

  // ---------------- distorsión ----------------
  { id: 'displacement', label: 'Desplazamiento digital', cat: 'distortion', desc: 'Deforma con un mapa de ruido fractal o con la propia luminosidad.', heavy: true, params: [SEL('source', 'Mapa', [['noise', 'Ruido fractal'], ['luma', 'Luminosidad de la imagen']]), PX('amount', 'Cantidad', 0, 200), PX('scale', 'Escala del mapa', 4, 600, { when: p => p.source !== 'luma' }), ANG('angle', 'Dirección', { when: p => p.source === 'luma' }), SEED], defaults: { source: 'noise', amount: 18, scale: 120, angle: 0, seed: 1 }, run: Gl.displacement },
  { id: 'wave', label: 'Onda', cat: 'distortion', desc: 'Distorsión senoidal horizontal y vertical.', params: [PX('ampX', 'Amplitud horizontal', 0, 200), PX('wavelengthX', 'Longitud (horizontal)', 2, 1000), PX('ampY', 'Amplitud vertical', 0, 200), PX('wavelengthY', 'Longitud (vertical)', 2, 1000), R('phase', 'Fase', 0, 360, { unit: '°' })], defaults: { ampX: 12, wavelengthX: 160, ampY: 0, wavelengthY: 200, phase: 0 }, run: Gl.waveDistortion },
  { id: 'barrel', label: 'Barril / cojín', cat: 'distortion', desc: 'Abomba (positivo) o hunde (negativo) la imagen desde el centro.', params: [R('amount', 'Cantidad', -100, 100), CENTER, R('zoom', 'Zoom', 50, 200, { unit: '%' })], defaults: { amount: 30, cx: 0.5, cy: 0.5, zoom: 100 }, run: An.barrelDistortion },
  { id: 'pixelate', label: 'Pixelado', cat: 'distortion', desc: 'Bloques de tamaño configurable.', params: [PX('size', 'Tamaño del píxel', 1, 200, { step: 1 }), SEL('mode', 'Color del bloque', [['average', 'Promedio'], ['nearest', 'Central']])], defaults: { size: 12, mode: 'average' }, run: Gl.pixelate },

  // ---------------- glitch ----------------
  { id: 'rgbSplit', label: 'Separación RGB', cat: 'glitch', desc: 'Mueve por separado los canales rojo, verde y azul.', params: [PX('rx', 'Rojo X', -100, 100), PX('ry', 'Rojo Y', -100, 100), PX('gx', 'Verde X', -100, 100), PX('gy', 'Verde Y', -100, 100), PX('bx', 'Azul X', -100, 100), PX('by', 'Azul Y', -100, 100)], defaults: { rx: 6, ry: 0, gx: 0, gy: 0, bx: -6, by: 0 }, run: Gl.rgbSplit },
  { id: 'chromaticAberration', label: 'Aberración cromática', cat: 'glitch', desc: 'Bordes de color: radial (crece hacia fuera) o direccional.', params: [SEL('mode', 'Tipo', [['radial', 'Radial'], ['directional', 'Direccional']]), PX('amount', 'Cantidad', 0, 80, { step: 0.5, digits: 1 }), CENTER, ANG('angle', 'Ángulo', { when: p => p.mode === 'directional' })], defaults: { mode: 'radial', amount: 8, cx: 0.5, cy: 0.5, angle: 0 }, run: Gl.chromaticAberration },
  { id: 'channelOffset', label: 'Desplazar canal', cat: 'glitch', desc: 'Desplaza un solo canal (con o sin vuelta).', params: [SEL('channel', 'Canal', [['r', 'Rojo'], ['g', 'Verde'], ['b', 'Azul']]), PX('dx', 'Horizontal', -400, 400), PX('dy', 'Vertical', -400, 400), BOOL('wrap', 'Dar la vuelta')], defaults: { channel: 'r', dx: 10, dy: 0, wrap: false }, run: Gl.channelOffset },
  { id: 'hGlitch', label: 'Glitch horizontal', cat: 'glitch', desc: 'Franjas horizontales desplazadas al azar.', params: [PX('amount', 'Desplazamiento', 0, 400), R('bands', 'Franjas', 0, 120, { step: 1 }), PX('height', 'Alto de franja', 1, 300), PX('rgb', 'Separación RGB', 0, 60), SEED], defaults: { amount: 40, bands: 18, height: 24, rgb: 6, seed: 1 }, run: (img, p) => Gl.sliceGlitch(img, { ...p, vertical: false }) },
  { id: 'vGlitch', label: 'Glitch vertical', cat: 'glitch', desc: 'Columnas desplazadas al azar.', params: [PX('amount', 'Desplazamiento', 0, 400), R('bands', 'Columnas', 0, 120, { step: 1 }), PX('height', 'Ancho de columna', 1, 300), PX('rgb', 'Separación RGB', 0, 60), SEED], defaults: { amount: 30, bands: 12, height: 20, rgb: 4, seed: 1 }, run: (img, p) => Gl.sliceGlitch(img, { ...p, vertical: true }) },
  { id: 'pixelSort', label: 'Ordenación de píxeles', cat: 'glitch', desc: 'Ordena los píxeles de cada tramo según su luminosidad o color.', heavy: true, params: [SEL('direction', 'Dirección', [['horizontal', 'Horizontal'], ['vertical', 'Vertical']]), SEL('key', 'Ordenar por', [['luma', 'Luminosidad'], ['hue', 'Tono'], ['saturation', 'Saturación'], ['r', 'Rojo'], ['g', 'Verde'], ['b', 'Azul']]), R('lower', 'Desde', 0, 255), R('upper', 'Hasta', 0, 255), BOOL('reverse', 'Orden inverso'), PX('maxLength', 'Largo máximo del tramo', 2, 4000), PCT('randomness', 'Aleatoriedad'), SEED], defaults: { direction: 'vertical', key: 'luma', lower: 60, upper: 230, reverse: false, maxLength: 400, randomness: 30, seed: 1 }, run: Gl.pixelSort },
  { id: 'dataCorruption', label: 'Corrupción de datos', cat: 'glitch', desc: 'Bloques copiados de otro sitio, canales cambiados y bits rotos.', params: [R('amount', 'Bloques', 0, 400, { step: 1 }), PX('block', 'Tamaño de bloque', 2, 200), PX('shift', 'Desplazamiento', 0, 600), PCT('channels', 'Canales cambiados'), PCT('bits', 'Bits rotos'), SEED], defaults: { amount: 60, block: 24, shift: 120, channels: 40, bits: 20, seed: 1 }, run: Gl.dataCorruption },
  { id: 'scanlineDisplace', label: 'Desplazamiento de líneas', cat: 'glitch', desc: 'Una franja de líneas que se tuerce (localizada).', params: [PX('amount', 'Desplazamiento', 0, 300), R('frequency', 'Frecuencia', 0.1, 200, { step: 0.1, digits: 1 }), PCT('start', 'Inicio de la franja'), PCT('end', 'Fin de la franja'), PCT('noise', 'Ruido'), SEED], defaults: { amount: 30, frequency: 40, start: 40, end: 70, noise: 40, seed: 1 }, run: Gl.scanlineDisplace },
  { id: 'datamosh', label: 'Datamosh', cat: 'glitch', desc: 'Artefactos de compresión: bloques arrastrados y color por bloques (estático).', params: [PX('block', 'Bloque', 2, 64, { step: 1 }), PCT('amount', 'Cantidad'), PX('smear', 'Arrastre', 0, 400), ANG('angle', 'Dirección del arrastre'), R('quantize', 'Cuantización', 1, 16, { step: 1 }), SEED], defaults: { block: 16, amount: 25, smear: 60, angle: -90, quantize: 6, seed: 1 }, run: Gl.datamosh },
  { id: 'signalInterference', label: 'Interferencia de señal', cat: 'glitch', desc: 'Bandas de brillo, líneas de ruido y tirones horizontales.', params: [PCT('amount', 'Intensidad'), R('bands', 'Bandas', 0, 20, { step: 0.5, digits: 1 }), R('frequency', 'Líneas finas', 1, 600, { step: 1 }), PCT('noise', 'Ruido'), PCT('roll', 'Posición de las bandas'), PX('shift', 'Tirón horizontal', 0, 100), SEED], defaults: { amount: 50, bands: 3, frequency: 180, noise: 25, roll: 0, shift: 12, seed: 1 }, run: Gl.signalInterference },
  { id: 'edgeEcho', label: 'Eco de bordes', cat: 'glitch', desc: 'Los contornos se repiten desplazados y se apagan.', heavy: true, params: [R('copies', 'Copias', 1, 12, { step: 1 }), PX('distance', 'Separación', 1, 100), ANG(), PCT('decay', 'Caída'), PCT('threshold', 'Umbral de borde'), BOOL('useColor', 'Usar un color'), COL('color', 'Color', { when: p => p.useColor })], defaults: { copies: 4, distance: 8, angle: 0, decay: 30, threshold: 12, useColor: true, color: '#7f8cff' }, run: Gl.edgeEcho },

  // ---------------- VHS ----------------
  { id: 'vhsTracking', label: 'Tracking VHS', cat: 'vhs', desc: 'Franja temblorosa con ruido blanco, como una cinta mal alineada.', params: [PX('amount', 'Temblor', 0, 120), PCT('position', 'Posición'), PX('height', 'Alto', 2, 600), PCT('noise', 'Ruido'), SEED], defaults: { amount: 18, position: 88, height: 60, noise: 60, seed: 1 }, run: An.vhsTracking },
  { id: 'tapeNoise', label: 'Ruido de cinta', cat: 'vhs', desc: 'Destellos horizontales finos.', params: [PCT('amount', 'Cantidad'), PX('length', 'Largo', 2, 600), PCT('brightness', 'Brillo'), SEED], defaults: { amount: 25, length: 80, brightness: 90, seed: 1 }, run: An.tapeNoise },
  { id: 'hScanlines', label: 'Líneas horizontales', cat: 'vhs', desc: 'Líneas de vídeo alternas.', params: [PCT('intensity', 'Intensidad'), PX('spacing', 'Separación', 1, 40, { step: 0.5, digits: 1 }), PCT('thickness', 'Grosor')], defaults: { intensity: 30, spacing: 3, thickness: 40 }, run: An.hScanlines },
  { id: 'colorBleed', label: 'Sangrado de color', cat: 'vhs', desc: 'El color se corre y se emborrona en horizontal (croma analógico).', params: [PX('amount', 'Emborronado', 0, 40, { step: 1 }), PX('shift', 'Corrimiento', -40, 40), R('saturation', 'Saturación', -100, 100)], defaults: { amount: 6, shift: 4, saturation: 15 }, run: An.colorBleed },
  { id: 'tapeDistortion', label: 'Distorsión de cinta', cat: 'vhs', desc: 'Vaivén lento de las líneas (cinta estirada).', params: [PX('amount', 'Cantidad', 0, 80), R('frequency', 'Frecuencia', 0, 20, { step: 0.1, digits: 1 }), PX('jitter', 'Temblor', 0, 20, { step: 0.1, digits: 1 }), SEED], defaults: { amount: 4, frequency: 2, jitter: 1, seed: 1 }, run: An.tapeDistortion },
  { id: 'signalDropout', label: 'Pérdida de señal', cat: 'vhs', desc: 'Líneas sueltas en blanco, negro o ruido.', params: [R('amount', 'Cantidad', 0, 300, { step: 1 }), PX('length', 'Largo', 4, 800), SEL('mode', 'Tipo', [['white', 'Blancas'], ['black', 'Negras'], ['noise', 'Ruido']]), SEED], defaults: { amount: 30, length: 120, mode: 'white', seed: 1 }, run: An.signalDropout },
  { id: 'ghosting', label: 'Imagen fantasma', cat: 'vhs', desc: 'Copias tenues desplazadas (reflejo de señal).', params: [PX('offset', 'Desplazamiento', 1, 100), PCT('amount', 'Intensidad'), R('copies', 'Copias', 1, 4, { step: 1 })], defaults: { offset: 8, amount: 35, copies: 2 }, run: An.ghosting },
  { id: 'analogSharpness', label: 'Nitidez analógica', cat: 'vhs', desc: 'Realce horizontal con halos, típico del vídeo.', params: [R('amount', 'Cantidad', 0, 300, { unit: '%' }), PX('radius', 'Radio', 1, 20, { step: 1 })], defaults: { amount: 80, radius: 2 }, run: An.analogSharpness },
  { id: 'interlacing', label: 'Entrelazado', cat: 'vhs', desc: 'Un campo de líneas desplazado y más oscuro.', params: [PX('offset', 'Desplazamiento', -40, 40), PCT('darken', 'Oscurecer'), SEL('field', 'Campo', [['odd', 'Impar'], ['even', 'Par']])], defaults: { offset: 3, darken: 15, field: 'odd' }, run: An.interlacing },
  { id: 'headSwitching', label: 'Cambio de cabezal', cat: 'vhs', desc: 'Las últimas líneas se tuercen con ruido.', params: [PX('height', 'Alto', 1, 200), PX('amount', 'Desplazamiento', 0, 200), PCT('noise', 'Ruido'), SEED], defaults: { height: 14, amount: 30, noise: 50, seed: 1 }, run: An.headSwitching },
  { id: 'timecode', label: 'Rótulo de vídeo', cat: 'vhs', desc: 'PLAY/REC, hora y fecha con fuente de píxeles.', params: [{ k: 'label', label: 'Texto', type: 'text' }, { k: 'time', label: 'Hora', type: 'text' }, { k: 'date', label: 'Fecha', type: 'text' }, PX('size', 'Tamaño', 1, 20, { step: 1 }), COL('color', 'Color'), PX('margin', 'Margen', 0, 300), SEL('corner', 'Esquina', [['tl', 'Arriba izq.'], ['tr', 'Arriba der.'], ['bl', 'Abajo izq.'], ['br', 'Abajo der.']]), BOOL('split', 'Texto arriba y hora abajo')], defaults: { label: 'PLAY >', time: '00:00:00', date: 'JAN.01 1999', size: 4, color: '#ffffff', margin: 40, corner: 'tl', split: true }, run: An.timecode },

  // ---------------- CRT ----------------
  { id: 'crtScanlines', label: 'Líneas de barrido CRT', cat: 'crt', desc: 'Perfil suave del haz; más fino en las sombras.', params: [PCT('intensity', 'Intensidad'), PX('spacing', 'Densidad (separación)', 1.5, 30, { step: 0.5, digits: 1 }), PCT('thickness', 'Grosor del haz'), PCT('response', 'Respuesta al brillo')], defaults: { intensity: 55, spacing: 4, thickness: 50, response: 50 }, run: An.crtScanlines },
  { id: 'phosphorMask', label: 'Máscara de fósforo', cat: 'crt', desc: 'Tríadas RGB, ranuras o rejilla de apertura.', params: [SEL('type', 'Tipo', [['shadow', 'Máscara de sombra'], ['slot', 'Ranuras'], ['grille', 'Rejilla de apertura']]), PX('size', 'Tamaño', 1, 12, { step: 0.5, digits: 1 }), PCT('intensity', 'Intensidad'), R('brightness', 'Compensar brillo', 0, 100, { unit: '%' })], defaults: { type: 'shadow', size: 2, intensity: 45, brightness: 25 }, run: An.phosphorMask },
  { id: 'screenCurvature', label: 'Curvatura de pantalla', cat: 'crt', desc: 'Abombado, esquinas redondeadas y viñeta.', params: [PCT('amount', 'Curvatura'), PCT('corner', 'Esquinas'), PCT('vignette', 'Viñeta'), COL('border', 'Marco')], defaults: { amount: 40, corner: 30, vignette: 45, border: '#000000' }, run: An.screenCurvature },
  { id: 'screenFlicker', label: 'Parpadeo de pantalla', cat: 'crt', desc: 'Variación de brillo y banda luminosa (fotograma fijo de un parpadeo).', params: [PCT('amount', 'Intensidad'), PCT('band', 'Alto de la banda'), PCT('position', 'Posición'), SEED], defaults: { amount: 30, band: 12, position: 30, seed: 1 }, run: An.screenFlicker },
  { id: 'hsync', label: 'Sincronía horizontal', cat: 'crt', desc: 'Las líneas se tuercen y se amortiguan desde un punto.', params: [PX('amount', 'Cantidad', 0, 200), R('frequency', 'Ondulación', 0, 40, { step: 0.1, digits: 1 }), PCT('position', 'Inicio'), PCT('decay', 'Amortiguación'), SEED], defaults: { amount: 24, frequency: 6, position: 10, decay: 25, seed: 1 }, run: An.hsyncDistortion },
  { id: 'crtSharpness', label: 'Nitidez CRT', cat: 'crt', desc: 'Negativo: haz suave; positivo: realce del tubo.', params: [R('sharpness', 'Nitidez', -100, 100), PX('radius', 'Radio', 1, 12, { step: 1 })], defaults: { sharpness: -40, radius: 2 }, run: An.crtSharpness },
  { id: 'phosphorGlow', label: 'Resplandor de fósforo', cat: 'crt', desc: 'Luz del fósforo con persistencia horizontal.', heavy: true, params: [PX('radius', 'Radio', 1, 120), PCT('intensity', 'Intensidad'), PCT('persistence', 'Persistencia'), BOOL('useColor', 'Teñir'), COL('color', 'Color', { when: p => p.useColor })], defaults: { radius: 10, intensity: 45, persistence: 30, useColor: false, color: '#7dffb0' }, run: Gw.phosphorGlow },

  // ---------------- neón y brillo ----------------
  { id: 'bloom', label: 'Bloom', cat: 'glow', desc: 'Las luces se derraman con un halo suave.', heavy: true, params: [PCT('threshold', 'Umbral'), PCT('softness', 'Suavidad del umbral'), PX('radius', 'Radio', 1, 300), PCT('intensity', 'Intensidad', 0, 300), BOOL('useTint', 'Teñir'), COL('tint', 'Color', { when: p => p.useTint }), GLOW_MODES], defaults: { threshold: 65, softness: 30, radius: 30, intensity: 70, useTint: false, tint: '#ffffff', mode: 'screen' }, run: Gw.bloom },
  { id: 'neonGlow', label: 'Neón', cat: 'glow', desc: 'Los bordes se vuelven tubos de neón con núcleo blanco.', heavy: true, params: [COL('color', 'Color'), PX('radius', 'Radio', 1, 200), PCT('intensity', 'Intensidad', 0, 300), PCT('threshold', 'Umbral de borde'), PCT('core', 'Núcleo'), PCT('base', 'Oscurecer la imagen'), GLOW_MODES], defaults: { color: '#4d5bff', radius: 18, intensity: 100, threshold: 10, core: 70, base: 60, mode: 'screen' }, run: Gw.neonGlow },
  { id: 'outerGlow', label: 'Resplandor exterior', cat: 'glow', desc: 'Halo alrededor de un recorte (usa la transparencia).', params: [COL('color', 'Color'), PX('radius', 'Radio', 1, 300), PCT('intensity', 'Intensidad', 0, 300), PCT('spread', 'Extensión')], defaults: { color: '#ffffff', radius: 24, intensity: 100, spread: 20 }, run: Gw.outerGlow },
  { id: 'innerGlow', label: 'Resplandor interior', cat: 'glow', desc: 'Luz desde los bordes hacia dentro (o desde el centro).', params: [COL('color', 'Color'), PX('radius', 'Radio', 1, 300), PCT('intensity', 'Intensidad', 0, 300), SEL('source', 'Origen', [['edge', 'Borde'], ['center', 'Centro']]), GLOW_MODES], defaults: { color: '#ffffff', radius: 30, intensity: 80, source: 'edge', mode: 'screen' }, run: Gw.innerGlow },
  { id: 'edgeGlow', label: 'Brillo de bordes', cat: 'glow', desc: 'Los bordes brillan con su propio color (o uno elegido).', heavy: true, params: [PX('radius', 'Radio', 1, 150), PCT('intensity', 'Intensidad', 0, 300), PCT('threshold', 'Umbral de borde'), BOOL('useColor', 'Usar un color'), COL('color', 'Color', { when: p => p.useColor }), PCT('base', 'Oscurecer la imagen'), GLOW_MODES], defaults: { radius: 8, intensity: 80, threshold: 8, useColor: false, color: '#ffffff', base: 0, mode: 'screen' }, run: Gw.edgeGlow },
  { id: 'lightStreaks', label: 'Destellos de luz', cat: 'glow', desc: 'Estelas rectas desde las luces (estrellas, anamórfico).', heavy: true, params: [PCT('threshold', 'Umbral'), PX('length', 'Largo', 2, 800), ANG(), R('rays', 'Rayos', 2, 8, { step: 2 }), PCT('intensity', 'Intensidad', 0, 300), BOOL('useTint', 'Teñir'), COL('tint', 'Color', { when: p => p.useTint })], defaults: { threshold: 82, length: 120, angle: 0, rays: 2, intensity: 80, useTint: true, tint: '#9fb7ff' }, run: Gw.lightStreaks },
  { id: 'halation', label: 'Halación', cat: 'glow', desc: 'Halo rojizo de película alrededor de las luces fuertes.', heavy: true, params: [PCT('threshold', 'Umbral'), PX('radius', 'Radio', 1, 200), PCT('intensity', 'Intensidad', 0, 300), COL('color', 'Color')], defaults: { threshold: 70, radius: 16, intensity: 70, color: '#ff4a1c' }, run: Gw.halation },
  { id: 'diffusion', label: 'Difusión', cat: 'glow', desc: 'Niebla luminosa (filtro de difusión).', heavy: true, params: [PX('radius', 'Radio', 1, 200), PCT('intensity', 'Intensidad'), PCT('highlights', 'Solo en las luces'), GLOW_MODES], defaults: { radius: 24, intensity: 40, highlights: 50, mode: 'screen' }, run: Gw.diffusionGlow },
  { id: 'colorGlow', label: 'Resplandor de color', cat: 'glow', desc: 'La luminosidad de la imagen convertida en luz de un color.', heavy: true, params: [COL('color', 'Color'), PX('radius', 'Radio', 1, 300), PCT('intensity', 'Intensidad', 0, 300), PCT('threshold', 'Umbral'), GLOW_MODES], defaults: { color: '#7dff3a', radius: 40, intensity: 60, threshold: 35, mode: 'screen' }, run: Gw.colorGlow },
  { id: 'thresholdGlow', label: 'Resplandor por umbral', cat: 'glow', desc: 'Solo lo que supera el umbral brilla.', heavy: true, params: [PCT('threshold', 'Umbral'), PX('radius', 'Radio', 1, 300), PCT('intensity', 'Intensidad', 0, 300), BOOL('useColor', 'Usar un color'), COL('color', 'Color', { when: p => p.useColor }), GLOW_MODES], defaults: { threshold: 80, radius: 20, intensity: 90, useColor: false, color: '#ffffff', mode: 'add' }, run: Gw.thresholdGlow },
  { id: 'contourEcho', label: 'Contornos de eco', cat: 'glow', desc: 'Líneas luminosas que repiten la silueta hacia fuera, con separación, ondulación y brillo.', heavy: true, params: [
    SEL('source', 'Silueta desde', [['alpha', 'Transparencia (recorte)'], ['luma', 'Luminosidad']]), PCT('threshold', 'Umbral de la silueta'),
    R('lines', 'Líneas', 1, 60, { step: 1 }), PX('spacing', 'Separación', 2, 200), PX('width', 'Grosor', 0.5, 30, { step: 0.5, digits: 1 }), PX('offset', 'Distancia a la silueta', -100, 300),
    PX('wave', 'Ondulación', 0, 200), R('frequency', 'Frecuencia', 0.1, 60, { step: 0.1, digits: 1 }), PCT('jitter', 'Irregularidad'),
    SEL('side', 'Lado', [['outside', 'Fuera'], ['inside', 'Dentro'], ['both', 'Ambos']]), PCT('falloff', 'Atenuación por línea'),
    COL('color', 'Color'), COL('color2', 'Color de la última línea'), PX('glow', 'Brillo (radio)', 0, 120), PCT('intensity', 'Intensidad', 0, 300), PCT('base', 'Oscurecer la imagen'), SEED,
  ], defaults: { source: 'alpha', threshold: 50, lines: 8, spacing: 14, width: 3, offset: 4, wave: 10, frequency: 6, jitter: 50, side: 'outside', falloff: 8, color: '#3d4bff', color2: '#b8c4ff', glow: 10, intensity: 120, base: 0, seed: 1 }, run: Gw.contourEcho },
  { id: 'lightLines', label: 'Líneas de luz', cat: 'glow', desc: 'Barrido de líneas paralelas que se desplazan con la luminosidad (relieve de señal).', heavy: true, params: [
    SEL('direction', 'Dirección', [['vertical', 'Verticales'], ['horizontal', 'Horizontales']]), PX('spacing', 'Separación', 2, 80), PX('width', 'Grosor', 0.5, 20, { step: 0.5, digits: 1 }),
    PX('displace', 'Relieve', -300, 300), PX('smoothing', 'Suavizado del relieve', 1, 60), PX('wave', 'Ondulación', 0, 120), R('frequency', 'Frecuencia', 0.1, 80, { step: 0.1, digits: 1 }),
    PCT('threshold', 'Umbral (fondo sin líneas)'), COL('color', 'Color'), COL('color2', 'Color en las luces'), PX('glow', 'Brillo (radio)', 0, 120), PCT('intensity', 'Intensidad', 0, 300), PCT('base', 'Oscurecer la imagen'), SEED,
  ], defaults: { direction: 'vertical', spacing: 9, width: 2.5, displace: 40, smoothing: 6, wave: 6, frequency: 14, threshold: 12, color: '#3340ff', color2: '#eef1ff', glow: 8, intensity: 130, base: 100, seed: 1 }, run: Gw.lightLines },

  // ---------------- Color Lab ----------------
  { id: 'colorBasic', label: 'Básico', cat: 'color', point: true, desc: 'Exposición, contraste, luces, sombras, blancos, negros, temperatura, matiz, saturación e intensidad en un solo ajuste.', params: [
    R('exposure', 'Exposición', -5, 5, { step: 0.01, digits: 2, group: 'Tono' }), R('brightness', 'Brillo', -100, 100, { group: 'Tono' }), R('contrast', 'Contraste', -100, 100, { group: 'Tono' }),
    R('highlights', 'Altas luces', -100, 100, { group: 'Tono' }), R('shadows', 'Sombras', -100, 100, { group: 'Tono' }), R('whites', 'Blancos', -100, 100, { group: 'Tono' }), R('blacks', 'Negros', -100, 100, { group: 'Tono' }),
    R('gamma', 'Gamma', 0.2, 3, { step: 0.01, digits: 2, group: 'Tono' }),
    R('temperature', 'Temperatura', -100, 100, { group: 'Color' }), R('tint', 'Matiz (verde ↔ magenta)', -100, 100, { group: 'Color' }), R('hue', 'Tono', -180, 180, { unit: '°', group: 'Color' }),
    R('saturation', 'Saturación', -100, 100, { group: 'Color' }), R('vibrance', 'Intensidad', -100, 100, { group: 'Color' }),
  ], defaults: { exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, gamma: 1, temperature: 0, tint: 0, hue: 0, saturation: 0, vibrance: 0 }, run: Co.colorBasic },
  { id: 'hsl', label: 'HSL por color', cat: 'color', point: true, ui: 'hsl', desc: 'Tono, saturación y luminosidad de cada gama de color por separado.', params: HSL_RANGES.flatMap(r => [R('h_' + r.k, `${r.label}: tono`, -60, 60, { unit: '°', group: r.label }), R('s_' + r.k, `${r.label}: saturación`, -100, 100, { group: r.label }), R('l_' + r.k, `${r.label}: luminosidad`, -100, 100, { group: r.label })]), defaults: Object.fromEntries(HSL_RANGES.flatMap(r => [['h_' + r.k, 0], ['s_' + r.k, 0], ['l_' + r.k, 0]])), run: Co.hslRanges },
  { id: 'colorBalance', label: 'Equilibrio de color', cat: 'color', point: true, ui: 'balance', desc: 'Cian↔rojo, magenta↔verde y amarillo↔azul en sombras, medios tonos y luces.', params: [
    ...(['s', 'm', 'h'] as const).flatMap(z => { const g = z === 's' ? 'Sombras' : z === 'm' ? 'Medios tonos' : 'Luces'; return [R(z + '_cr', 'Cian ↔ Rojo', -100, 100, { group: g }), R(z + '_mg', 'Magenta ↔ Verde', -100, 100, { group: g }), R(z + '_yb', 'Amarillo ↔ Azul', -100, 100, { group: g })]; }),
    BOOL('preserve', 'Conservar luminosidad'),
  ], defaults: { s_cr: 0, s_mg: 0, s_yb: 0, m_cr: 0, m_mg: 0, m_yb: 0, h_cr: 0, h_mg: 0, h_yb: 0, preserve: true }, run: Co.colorBalance },
  { id: 'splitToning', label: 'Virado partido', cat: 'color', point: true, desc: 'Un color para las luces y otro para las sombras.', params: [R('hHue', 'Luces: tono', 0, 360, { unit: '°', group: 'Luces' }), PCT('hSat', 'Luces: saturación', 0, 100, { group: 'Luces' }), R('sHue', 'Sombras: tono', 0, 360, { unit: '°', group: 'Sombras' }), PCT('sSat', 'Sombras: saturación', 0, 100, { group: 'Sombras' }), R('balance', 'Equilibrio', -100, 100)], defaults: { hHue: 40, hSat: 25, sHue: 210, sSat: 25, balance: 0 }, run: Co.splitToning },
  { id: 'colorWheels', label: 'Ruedas de color', cat: 'color', point: true, ui: 'wheels', desc: 'Elevación (sombras), gamma (medios) y ganancia (luces) como en un etalonaje.', params: [
    ...(['lift', 'gamma', 'gain'] as const).flatMap(z => { const g = z === 'lift' ? 'Sombras (elevación)' : z === 'gamma' ? 'Medios tonos (gamma)' : 'Luces (ganancia)'; return [R(z + 'Hue', 'Tono', 0, 360, { unit: '°', group: g }), PCT(z + 'Amt', 'Cantidad', 0, 100, { group: g }), R(z + 'Lum', 'Luminosidad', -100, 100, { group: g })]; }),
  ], defaults: { liftHue: 220, liftAmt: 0, liftLum: 0, gammaHue: 40, gammaAmt: 0, gammaLum: 0, gainHue: 40, gainAmt: 0, gainLum: 0 }, run: Co.colorWheels },
  { id: 'selectiveColor', label: 'Color selectivo', cat: 'color', point: true, ui: 'selective', desc: 'Cian, magenta, amarillo y negro de cada gama (rojos, amarillos, neutros…).', params: [
    SEL('method', 'Método', [['relative', 'Relativo'], ['absolute', 'Absoluto']]),
    ...SEL_RANGES.flatMap(r => (['c', 'm', 'y', 'k'] as const).map(ch => R(`${r.k}_${ch}`, ch === 'c' ? 'Cian' : ch === 'm' ? 'Magenta' : ch === 'y' ? 'Amarillo' : 'Negro', -100, 100, { unit: '%', group: r.label }))),
  ], defaults: { method: 'relative', ...Object.fromEntries(SEL_RANGES.flatMap(r => ['c', 'm', 'y', 'k'].map(ch => [`${r.k}_${ch}`, 0]))) }, run: Co.selectiveColor },
  { id: 'lut', label: 'LUT (.cube)', cat: 'color', point: true, ui: 'lut', desc: 'Aplica una tabla de color .cube importada, con intensidad regulable.', params: [PCT('amount', 'Intensidad')], defaults: { name: '', size: 0, data: '', amount: 100 }, run: Co.applyLut3D },

  // ---------------- texturas ----------------
  { id: 'filmDust', label: 'Polvo de película', cat: 'texture', desc: 'Motas y pelusas.', params: [PCT('amount', 'Cantidad'), PX('size', 'Tamaño', 0.5, 20, { step: 0.5, digits: 1 }), BOOL('dark', 'Oscuras'), ...TEX_BASE], defaults: { amount: 40, size: 2, dark: false, scale: 100, rotation: 0, opacity: 80, mode: 'normal', seed: 1 }, run: Tx.filmDust },
  { id: 'scratches', label: 'Rayaduras', cat: 'texture', desc: 'Rayas finas de película, cortadas a trozos.', params: [PCT('amount', 'Cantidad'), PX('width', 'Grosor', 0.5, 10, { step: 0.5, digits: 1 }), BOOL('dark', 'Oscuras'), ...TEX_BASE], defaults: { amount: 30, width: 1.2, dark: false, scale: 100, rotation: 0, opacity: 70, mode: 'normal', seed: 1 }, run: Tx.scratches },
  { id: 'paperGrain', label: 'Grano de papel', cat: 'texture', desc: 'Poros y fibras para un acabado impreso.', params: [PCT('amount', 'Cantidad'), PCT('fibers', 'Fibras'), ...TEX_BASE], defaults: { amount: 60, fibers: 40, scale: 100, rotation: 0, opacity: 35, mode: 'overlay', seed: 1 }, run: Tx.paperGrain },
  { id: 'lightLeaks', label: 'Fugas de luz', cat: 'texture', desc: 'Manchas de luz cálida que entran por un borde.', params: [COL('color', 'Color'), COL('color2', 'Segundo color'), PCT('size', 'Tamaño', 5, 200), PCT('position', 'Posición en el borde'), PCT('amount', 'Cantidad'), ...TEX_BASE.filter(p => p.k !== 'scale' && p.k !== 'rotation')], defaults: { color: '#ff4d1a', color2: '#ffc93c', size: 60, position: 10, amount: 80, opacity: 75, mode: 'screen', seed: 1 }, run: Tx.lightLeaks },
  { id: 'halftoneOverlay', label: 'Trama de semitono', cat: 'texture', desc: 'Puntos o líneas según la luminosidad (no destructiva).', params: [PX('cell', 'Celda', 2, 60), SEL('shape', 'Forma', [['dot', 'Puntos'], ['line', 'Líneas']]), R('contrast', 'Contraste', -100, 100), COL('color', 'Color de la tinta'), ...TEX_BASE.filter(p => p.k !== 'scale' && p.k !== 'seed')], defaults: { cell: 8, shape: 'dot', contrast: 0, color: '#000000', rotation: 45, opacity: 100, mode: 'multiply' }, run: Tx.halftoneOverlay },
  { id: 'grunge', label: 'Grunge', cat: 'texture', desc: 'Manchas, desgaste y salpicaduras.', params: [PCT('amount', 'Cantidad'), R('contrast', 'Contraste', -50, 100), BOOL('dark', 'Oscuro'), ...TEX_BASE], defaults: { amount: 55, contrast: 30, dark: true, scale: 100, rotation: 0, opacity: 60, mode: 'multiply', seed: 1 }, run: Tx.grunge },
  { id: 'staticInterference', label: 'Estática', cat: 'texture', desc: 'Nieve de televisión con bandas.', params: [PCT('amount', 'Cantidad'), R('bands', 'Bandas', 0, 30, { step: 0.5, digits: 1 }), ...TEX_BASE], defaults: { amount: 50, bands: 4, scale: 100, rotation: 0, opacity: 35, mode: 'screen', seed: 1 }, run: Tx.staticInterference },
  { id: 'scanlineTexture', label: 'Líneas (textura)', cat: 'texture', desc: 'Líneas de barrido como textura, con rotación.', params: [PX('spacing', 'Separación', 1, 60, { step: 0.5, digits: 1 }), PCT('thickness', 'Grosor'), ...TEX_BASE.filter(p => p.k !== 'seed')], defaults: { spacing: 4, thickness: 45, scale: 100, rotation: 0, opacity: 40, mode: 'multiply' }, run: Tx.scanlineTexture },
];

export const FX: Record<string, FxDef> = Object.fromEntries(defs.map(d => [d.id, d]));
export const fxDef = (id: string): FxDef | undefined => FX[id];
export const FX_LIST = defs;

/** Parámetros en px de los ajustes clásicos (para escalar la vista previa y los preajustes). */
const BUILTIN_PX: Record<string, string[]> = { blur: ['radius'], sharpen: ['radius'] };

/** Lista de claves en px de un efecto (o ajuste clásico). */
export function pxKeys(type: string): string[] {
  const d = FX[type];
  if (d) return d.params.filter(p => p.type === 'range' && p.px).map(p => p.k);
  return BUILTIN_PX[type] ?? [];
}
/** Escala los parámetros en px (vista previa reducida o un preajuste aplicado a otra resolución). */
export function scaleParams(type: string, params: Record<string, any>, k: number) {
  if (k === 1) return params;
  const keys = pxKeys(type);
  if (!keys.length) return params;
  const out = { ...params };
  for (const key of keys) if (typeof out[key] === 'number') out[key] = Math.round(out[key] * k * 100) / 100;
  return out;
}

/** Ejecuta un efecto del registro (con los valores por defecto para lo que falte). */
export function runFx(img: Px, type: string, params: any): boolean {
  const d = FX[type];
  if (!d) return false;
  d.run(img, { ...d.defaults, ...params });
  return true;
}
