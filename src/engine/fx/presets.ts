// Preajustes de efectos: combinaciones editables (no filtros cerrados). Al aplicarse se convierten
// en efectos normales de la pila, con todos sus parámetros a la vista. Los valores en px están
// pensados para un lado corto de 1080 px y se escalan a la resolución de cada capa.

export type PresetCat = 'analog' | 'vhs' | 'glitch' | 'crt' | 'cinematic' | 'cyberpunk' | 'editorial' | 'photography' | 'custom';
export const PRESET_CATS: { id: PresetCat; label: string }[] = [
  { id: 'analog', label: 'Analógico' }, { id: 'vhs', label: 'VHS' }, { id: 'glitch', label: 'Glitch' }, { id: 'crt', label: 'CRT' },
  { id: 'cinematic', label: 'Cine' }, { id: 'cyberpunk', label: 'Cyberpunk' }, { id: 'editorial', label: 'Editorial' },
  { id: 'photography', label: 'Fotografía' }, { id: 'custom', label: 'Mis preajustes' },
];

export interface PresetItem { type: string; params: Record<string, any>; opacity?: number; blend?: string; enabled?: boolean; name?: string }
export interface FxPreset {
  id: string;
  name: string;
  cat: PresetCat;
  desc?: string;
  items: PresetItem[];
  /** lado corto de referencia para los px (por defecto 1080) */
  ref?: number;
  builtin?: boolean;
}

const P = (id: string, name: string, cat: PresetCat, desc: string, items: PresetItem[]): FxPreset => ({ id: 'kova:' + id, name, cat, desc, items, ref: 1080, builtin: true });
const curve = (pts: [number, number][]) => pts;

export const BUILTIN_PRESETS: FxPreset[] = [
  // ---------------- VHS ----------------
  P('vhs-1985', 'VHS 1985', 'vhs', 'Cinta doméstica de los 80: color corrido, líneas, ruido y rótulo PLAY.', [
    { type: 'colorBasic', params: { contrast: -12, highlights: -20, blacks: 18, saturation: 18, temperature: 12 } },
    { type: 'colorBleed', params: { amount: 7, shift: 5, saturation: 25 } },
    { type: 'tapeDistortion', params: { amount: 3, frequency: 2.5, jitter: 1.2, seed: 4 } },
    { type: 'ghosting', params: { offset: 7, amount: 25, copies: 2 } },
    { type: 'analogSharpness', params: { amount: 70, radius: 2 } },
    { type: 'noise', params: { kind: 'analog', amount: 14, size: 1.5, density: 100, mono: false, contrast: 0, seed: 3 } },
    { type: 'hScanlines', params: { intensity: 22, spacing: 3, thickness: 40 } },
    { type: 'tapeNoise', params: { amount: 14, length: 90, brightness: 85, seed: 2 } },
    { type: 'vhsTracking', params: { amount: 14, position: 92, height: 45, noise: 55, seed: 7 } },
    { type: 'headSwitching', params: { height: 14, amount: 26, noise: 40, seed: 1 } },
    { type: 'timecode', params: { label: 'PLAY >', time: 'SP 0:03:27', date: 'JUN.14 1985', size: 4, color: '#ffffff', margin: 48, corner: 'tl', split: true } },
  ]),
  P('vhs-1999', 'VHS 1999', 'vhs', 'Videocámara de finales de los 90: más nítida, colores fríos y fecha.', [
    { type: 'colorBasic', params: { contrast: 8, highlights: -10, saturation: -5, temperature: -10, tint: 4 } },
    { type: 'colorBleed', params: { amount: 4, shift: 3, saturation: 10 } },
    { type: 'analogSharpness', params: { amount: 110, radius: 2 } },
    { type: 'noise', params: { kind: 'analog', amount: 9, size: 1.2, density: 100, mono: false, contrast: 0, seed: 1 } },
    { type: 'interlacing', params: { offset: 1.5, darken: 10, field: 'odd' } },
    { type: 'tapeDistortion', params: { amount: 1.5, frequency: 1.5, jitter: 0.6, seed: 2 } },
    { type: 'timecode', params: { label: '', time: 'PM 11:58', date: 'DEC.31 1999', size: 4, color: '#f3f0e6', margin: 48, corner: 'br', split: false } },
  ]),
  P('damaged-tape', 'Cinta dañada', 'vhs', 'Pérdidas de señal, tracking, franjas rotas y estática.', [
    { type: 'colorBasic', params: { contrast: 18, saturation: -25, blacks: 10 } },
    { type: 'tapeDistortion', params: { amount: 8, frequency: 4, jitter: 3, seed: 9 } },
    { type: 'hGlitch', params: { amount: 60, bands: 14, height: 18, rgb: 6, seed: 5 } },
    { type: 'signalDropout', params: { amount: 70, length: 160, mode: 'white', seed: 3 } },
    { type: 'vhsTracking', params: { amount: 40, position: 30, height: 90, noise: 90, seed: 2 } },
    { type: 'staticInterference', params: { amount: 60, bands: 6, scale: 100, rotation: 0, opacity: 22, mode: 'screen', seed: 4 } },
    { type: 'colorBleed', params: { amount: 9, shift: 7, saturation: 0 } },
    { type: 'headSwitching', params: { height: 20, amount: 40, noise: 70, seed: 2 } },
  ]),
  P('analog-horror', 'Terror analógico', 'vhs', 'Imagen apagada y verdosa, sombras hundidas, interferencias.', [
    { type: 'colorBasic', params: { exposure: -0.35, contrast: 25, shadows: -30, saturation: -55, temperature: -8, tint: -18 } },
    { type: 'splitToning', params: { hHue: 75, hSat: 18, sHue: 150, sSat: 22, balance: -20 } },
    { type: 'noise', params: { kind: 'analog', amount: 22, size: 1.6, density: 100, mono: true, contrast: 20, seed: 6 } },
    { type: 'signalInterference', params: { amount: 45, bands: 2, frequency: 220, noise: 30, roll: 35, shift: 10, seed: 3 } },
    { type: 'hScanlines', params: { intensity: 30, spacing: 3, thickness: 45 } },
    { type: 'ghosting', params: { offset: 10, amount: 30, copies: 3 } },
    { type: 'timecode', params: { label: 'REC', time: '03:33:03', date: '', size: 4, color: '#e8e8e8', margin: 48, corner: 'tl', split: true } },
  ]),
  P('retro-camcorder', 'Videocámara retro', 'vhs', 'Viñeta, nitidez de vídeo, color cálido y REC.', [
    { type: 'colorBasic', params: { contrast: 10, highlights: -25, whites: -10, saturation: 12, temperature: 18 } },
    { type: 'analogSharpness', params: { amount: 90, radius: 2 } },
    { type: 'colorBleed', params: { amount: 5, shift: 3, saturation: 10 } },
    { type: 'noise', params: { kind: 'sensor', amount: 12, size: 1.3, density: 100, mono: false, contrast: 0, seed: 2 } },
    { type: 'screenCurvature', params: { amount: 0, corner: 0, vignette: 40, border: '#000000' } },
    { type: 'timecode', params: { label: 'REC', time: '00:12:45', date: 'AUG.09 1996', size: 4, color: '#ff3b30', margin: 48, corner: 'tr', split: true } },
  ]),
  P('cyber-vhs', 'Cyber VHS', 'vhs', 'Magentas y cianes, separación RGB y brillo de neón.', [
    { type: 'colorBasic', params: { contrast: 20, blacks: -10, saturation: 30, temperature: -15, tint: 25 } },
    { type: 'splitToning', params: { hHue: 300, hSat: 35, sHue: 190, sSat: 45, balance: 0 } },
    { type: 'rgbSplit', params: { rx: 7, ry: 0, gx: 0, gy: 0, bx: -7, by: 1 } },
    { type: 'bloom', params: { threshold: 60, softness: 30, radius: 26, intensity: 70, useTint: false, tint: '#ffffff', mode: 'screen' } },
    { type: 'hScanlines', params: { intensity: 26, spacing: 3, thickness: 40 } },
    { type: 'vhsTracking', params: { amount: 16, position: 85, height: 40, noise: 50, seed: 3 } },
    { type: 'noise', params: { kind: 'chromatic', amount: 14, size: 1.2, density: 100, mono: false, contrast: 0, seed: 5 } },
  ]),
  P('dark-archive', 'Archivo oscuro', 'vhs', 'Copia de copia: blanco y negro sucio, rayas y polvo.', [
    { type: 'colorBasic', params: { contrast: 30, highlights: -35, shadows: -20, blacks: 15, saturation: -90 } },
    { type: 'tapeDistortion', params: { amount: 3, frequency: 1, jitter: 1.5, seed: 5 } },
    { type: 'noise', params: { kind: 'film', amount: 26, size: 1.8, density: 100, mono: true, contrast: 15, seed: 8 } },
    { type: 'scratches', params: { amount: 35, width: 1.2, dark: false, scale: 100, rotation: 0, opacity: 55, mode: 'normal', seed: 2 } },
    { type: 'filmDust', params: { amount: 45, size: 2, dark: false, scale: 100, rotation: 0, opacity: 70, mode: 'normal', seed: 4 } },
    { type: 'hScanlines', params: { intensity: 18, spacing: 4, thickness: 40 } },
  ]),

  // ---------------- Glitch ----------------
  P('digital-glitch', 'Glitch digital', 'glitch', 'Franjas desplazadas, canales separados y bloques rotos.', [
    { type: 'rgbSplit', params: { rx: 10, ry: 0, gx: 0, gy: 0, bx: -10, by: 0 } },
    { type: 'hGlitch', params: { amount: 90, bands: 22, height: 26, rgb: 10, seed: 3 } },
    { type: 'dataCorruption', params: { amount: 40, block: 26, shift: 160, channels: 50, bits: 25, seed: 2 } },
    { type: 'scanlineDisplace', params: { amount: 24, frequency: 60, start: 55, end: 75, noise: 50, seed: 4 } },
  ]),
  P('datamosh-melt', 'Datamosh', 'glitch', 'Bloques que se arrastran y se funden.', [
    { type: 'datamosh', params: { block: 16, amount: 35, smear: 90, angle: -90, quantize: 6, seed: 7 } },
    { type: 'pixelate', params: { size: 2, mode: 'average' } },
    { type: 'rgbSplit', params: { rx: 3, ry: 0, gx: 0, gy: 0, bx: -3, by: 0 } },
  ]),
  P('pixel-waterfall', 'Cascada de píxeles', 'glitch', 'Ordenación vertical por luminosidad.', [
    { type: 'pixelSort', params: { direction: 'vertical', key: 'luma', lower: 70, upper: 235, reverse: false, maxLength: 500, randomness: 35, seed: 2 } },
    { type: 'colorBasic', params: { contrast: 12, saturation: 10 } },
  ]),
  P('signal-lost', 'Señal perdida', 'glitch', 'Interferencias, ruido digital y franjas.', [
    { type: 'signalInterference', params: { amount: 65, bands: 4, frequency: 260, noise: 45, roll: 10, shift: 18, seed: 6 } },
    { type: 'noise', params: { kind: 'digital', amount: 22, size: 3, density: 70, mono: false, contrast: 20, seed: 9 } },
    { type: 'vGlitch', params: { amount: 40, bands: 10, height: 18, rgb: 4, seed: 4 } },
  ]),

  // ---------------- CRT ----------------
  P('crt-arcade', 'CRT arcade', 'crt', 'Tubo de recreativa: curvatura, fósforo, barrido y bloom.', [
    { type: 'crtSharpness', params: { sharpness: -30, radius: 2 } },
    { type: 'bloom', params: { threshold: 55, softness: 35, radius: 18, intensity: 55, useTint: false, tint: '#ffffff', mode: 'screen' } },
    { type: 'phosphorMask', params: { type: 'shadow', size: 2, intensity: 40, brightness: 25 } },
    { type: 'crtScanlines', params: { intensity: 55, spacing: 4, thickness: 50, response: 60 } },
    { type: 'chromaticAberration', params: { mode: 'radial', amount: 5, cx: 0.5, cy: 0.5, angle: 0 } },
    { type: 'screenCurvature', params: { amount: 35, corner: 30, vignette: 45, border: '#050505' } },
  ]),
  P('green-monitor', 'Monitor de fósforo verde', 'crt', 'Terminal monocromo verde con persistencia.', [
    { type: 'colorBasic', params: { contrast: 25, saturation: -100 } },
    { type: 'gradientMap', params: { dark: '#001a08', light: '#7dff9a', amount: 100 } },
    { type: 'phosphorGlow', params: { radius: 10, intensity: 55, persistence: 45, useColor: false, color: '#7dffb0' } },
    { type: 'crtScanlines', params: { intensity: 60, spacing: 3.5, thickness: 45, response: 70 } },
    { type: 'screenCurvature', params: { amount: 30, corner: 25, vignette: 55, border: '#000000' } },
  ]),
  P('trinitron', 'Trinitron', 'crt', 'Rejilla de apertura, nitidez y sincronía algo torcida.', [
    { type: 'phosphorMask', params: { type: 'grille', size: 1.5, intensity: 35, brightness: 20 } },
    { type: 'crtScanlines', params: { intensity: 35, spacing: 3, thickness: 55, response: 50 } },
    { type: 'hsync', params: { amount: 14, frequency: 5, position: 4, decay: 20, seed: 1 } },
    { type: 'screenFlicker', params: { amount: 18, band: 14, position: 62, seed: 2 } },
    { type: 'barrel', params: { amount: 12, cx: 0.5, cy: 0.5, zoom: 104 } },
  ]),

  // ---------------- Analógico / fotografía ----------------
  P('film-35mm', 'Película 35 mm', 'photography', 'Grano fino, negros levantados y halación suave.', [
    { type: 'colorBasic', params: { contrast: 8, highlights: -15, blacks: 12, saturation: -6, temperature: 6 } },
    { type: 'curves', params: { rgb: curve([[0, 14], [64, 60], [192, 200], [255, 246]]) } },
    { type: 'halation', params: { threshold: 75, radius: 14, intensity: 45, color: '#ff4a1c' } },
    { type: 'noise', params: { kind: 'film', amount: 16, size: 1.3, density: 100, mono: true, contrast: 0, seed: 1 } },
  ]),
  P('expired-film', 'Película caducada', 'analog', 'Dominante cálida, fugas de luz, polvo y grano grueso.', [
    { type: 'colorBasic', params: { contrast: -10, highlights: -20, blacks: 22, saturation: -15, temperature: 25, tint: 12 } },
    { type: 'splitToning', params: { hHue: 45, hSat: 30, sHue: 330, sSat: 18, balance: 10 } },
    { type: 'lightLeaks', params: { color: '#ff4d1a', color2: '#ffc93c', size: 60, position: 12, amount: 70, opacity: 65, mode: 'screen', seed: 3 } },
    { type: 'noise', params: { kind: 'film', amount: 24, size: 1.9, density: 100, mono: true, contrast: 10, seed: 2 } },
    { type: 'filmDust', params: { amount: 30, size: 2, dark: false, scale: 100, rotation: 0, opacity: 60, mode: 'normal', seed: 1 } },
  ]),
  P('print-grain', 'Impresión con grano', 'editorial', 'Papel, semitono suave y tinta apagada.', [
    { type: 'colorBasic', params: { contrast: 14, highlights: -12, blacks: 10, saturation: -20 } },
    { type: 'halftoneOverlay', params: { cell: 5, shape: 'dot', contrast: 10, color: '#1b1b1b', rotation: 45, opacity: 25, mode: 'multiply' } },
    { type: 'paperGrain', params: { amount: 70, fibers: 50, scale: 100, rotation: 0, opacity: 45, mode: 'overlay', seed: 2 } },
  ]),

  // ---------------- Color Lab (looks editables) ----------------
  P('cyberpunk-green', 'Cyberpunk Green', 'cyberpunk', 'Verdes ácidos, sombras teal y luces de neón.', [
    { type: 'colorBasic', params: { contrast: 22, highlights: -15, shadows: -10, blacks: -8, saturation: 10, vibrance: 25, temperature: -12, tint: -30 } },
    { type: 'hsl', params: { h_yellow: 22, h_orange: 10, s_green: 35, l_green: 10, h_blue: -25, s_aqua: 30 } },
    { type: 'splitToning', params: { hHue: 95, hSat: 28, sHue: 170, sSat: 40, balance: -10 } },
    { type: 'colorGlow', params: { color: '#7dff3a', radius: 40, intensity: 35, threshold: 55, mode: 'screen' } },
  ]),
  P('electric-blue', 'Electric Blue', 'cyberpunk', 'Azules eléctricos y luces frías.', [
    { type: 'colorBasic', params: { contrast: 18, highlights: -10, blacks: -6, saturation: 12, temperature: -40, tint: 8 } },
    { type: 'colorWheels', params: { liftHue: 230, liftAmt: 45, liftLum: -5, gammaHue: 215, gammaAmt: 25, gammaLum: 0, gainHue: 200, gainAmt: 20, gainLum: 5 } },
    { type: 'hsl', params: { s_blue: 40, l_blue: 10, h_aqua: 15, s_orange: -30 } },
  ]),
  P('acid-yellow', 'Acid Yellow', 'cyberpunk', 'Amarillo ácido sobre sombras verdes, con grano y brillo.', [
    { type: 'colorBasic', params: { exposure: 0.15, contrast: 20, highlights: 15, shadows: -20, saturation: 15, temperature: 20, tint: -25 } },
    { type: 'gradientMap', params: { dark: '#0d2a05', light: '#f4ff6a', amount: 55 } },
    { type: 'diffusion', params: { radius: 30, intensity: 35, highlights: 60, mode: 'screen' } },
    { type: 'noise', params: { kind: 'film', amount: 22, size: 1.6, density: 100, mono: true, contrast: 0, seed: 5 } },
  ]),
  P('dark-emerald', 'Dark Emerald', 'cinematic', 'Verdes profundos y sombras densas.', [
    { type: 'colorBasic', params: { exposure: -0.2, contrast: 28, highlights: -25, shadows: -15, blacks: -10, saturation: -10, tint: -15 } },
    { type: 'colorBalance', params: { s_cr: -20, s_mg: 18, s_yb: 8, m_cr: -8, m_mg: 10, m_yb: 0, h_cr: 6, h_mg: 0, h_yb: -6, preserve: true } },
    { type: 'hsl', params: { h_green: 12, s_green: 20, l_green: -20, s_red: -20, h_yellow: 20 } },
  ]),
  P('analog-red', 'Analog Red', 'analog', 'Rojos quemados, crema en las luces y grano grueso.', [
    { type: 'colorBasic', params: { contrast: 30, highlights: 10, shadows: -25, saturation: 10, temperature: 20 } },
    { type: 'gradientMap', params: { dark: '#2a0400', light: '#ffe9b8', amount: 70 } },
    { type: 'halation', params: { threshold: 60, radius: 24, intensity: 80, color: '#ff3a12' } },
    { type: 'noise', params: { kind: 'film', amount: 32, size: 1.8, density: 100, mono: true, contrast: 20, seed: 4 } },
  ]),
  P('bleach-bypass', 'Bleach Bypass', 'cinematic', 'Contraste alto y color lavado (positivado sin blanqueo).', [
    { type: 'colorBasic', params: { contrast: 35, highlights: -10, shadows: -10, saturation: -45, vibrance: -10 } },
    { type: 'curves', params: { rgb: curve([[0, 0], [70, 52], [180, 196], [255, 255]]) } },
  ]),
  P('cinematic-teal', 'Cinematic Teal', 'cinematic', 'Sombras teal y pieles cálidas.', [
    { type: 'colorBasic', params: { contrast: 15, highlights: -15, shadows: 8, saturation: -5, vibrance: 15 } },
    { type: 'splitToning', params: { hHue: 32, hSat: 30, sHue: 185, sSat: 45, balance: 0 } },
    { type: 'hsl', params: { h_orange: -6, s_orange: 10, h_blue: -15, s_blue: 15, h_aqua: 10 } },
  ]),
  P('retro-film', 'Retro Film', 'analog', 'Película antigua: contraste suave, cálido y grano.', [
    { type: 'colorBasic', params: { contrast: -8, highlights: -20, blacks: 25, saturation: -18, temperature: 15 } },
    { type: 'curves', params: { rgb: curve([[0, 22], [128, 132], [255, 238]]), b: curve([[0, 30], [255, 220]]) } },
    { type: 'noise', params: { kind: 'film', amount: 18, size: 1.5, density: 100, mono: true, contrast: 0, seed: 7 } },
  ]),
  P('cold-industrial', 'Cold Industrial', 'editorial', 'Frío, metálico, poco saturado.', [
    { type: 'colorBasic', params: { contrast: 22, highlights: -10, shadows: -5, saturation: -35, temperature: -30, tint: 5 } },
    { type: 'colorBalance', params: { s_cr: -15, s_mg: 0, s_yb: 18, m_cr: -6, m_mg: 0, m_yb: 8, h_cr: 0, h_mg: 0, h_yb: 4, preserve: true } },
  ]),
  P('y2k-digital', 'Y2K Digital', 'cyberpunk', 'Cámara digital del 2000: frío, nítido, ruido digital y fecha.', [
    { type: 'colorBasic', params: { exposure: 0.2, contrast: 12, highlights: 10, saturation: 20, temperature: -18, tint: 12 } },
    { type: 'sharpen', params: { amount: 120, radius: 1.2, threshold: 2 } },
    { type: 'noise', params: { kind: 'digital', amount: 10, size: 2, density: 100, mono: false, contrast: 0, seed: 3 } },
    { type: 'bloom', params: { threshold: 75, softness: 25, radius: 16, intensity: 45, useTint: false, tint: '#ffffff', mode: 'screen' } },
    { type: 'timecode', params: { label: '', time: '', date: '2001 03 15', size: 4, color: '#ffa53d', margin: 48, corner: 'br', split: false } },
  ]),
  P('dreamcore', 'Dreamcore', 'editorial', 'Pastel difuso, luces que se abren y color suave.', [
    { type: 'colorBasic', params: { exposure: 0.25, contrast: -25, highlights: -10, blacks: 30, saturation: -10, tint: 15 } },
    { type: 'splitToning', params: { hHue: 320, hSat: 25, sHue: 200, sSat: 20, balance: 20 } },
    { type: 'diffusion', params: { radius: 45, intensity: 55, highlights: 35, mode: 'screen' } },
    { type: 'noise', params: { kind: 'film', amount: 10, size: 1.4, density: 100, mono: true, contrast: 0, seed: 2 } },
  ]),
  P('dark-editorial', 'Dark Editorial', 'editorial', 'Negros profundos, piel neutra, poco color.', [
    { type: 'colorBasic', params: { exposure: -0.15, contrast: 30, highlights: -20, shadows: -25, blacks: -15, saturation: -30 } },
    { type: 'curves', params: { rgb: curve([[0, 0], [60, 40], [190, 205], [255, 250]]) } },
    { type: 'noise', params: { kind: 'film', amount: 8, size: 1.2, density: 100, mono: true, contrast: 0, seed: 1 } },
  ]),

  // ---------------- looks de las referencias ----------------
  P('neon-contours', 'Contornos de neón', 'cyberpunk', 'Rostro dibujado con líneas de luz azul y contornos repetidos (mejor con el sujeto recortado o sobre fondo oscuro).', [
    { type: 'lightLines', params: { direction: 'vertical', spacing: 8, width: 2.5, displace: 45, smoothing: 6, wave: 5, frequency: 16, threshold: 14, color: '#2f3dff', color2: '#eef1ff', glow: 8, intensity: 140, base: 100, seed: 2 } },
    { type: 'contourEcho', params: { source: 'luma', threshold: 14, lines: 6, spacing: 14, width: 3, offset: 6, wave: 8, frequency: 7, jitter: 60, side: 'outside', falloff: 10, color: '#3340ff', color2: '#8f9dff', glow: 10, intensity: 120, base: 0, seed: 3 } },
    { type: 'bloom', params: { threshold: 40, softness: 40, radius: 24, intensity: 60, useTint: true, tint: '#5a64ff', mode: 'screen' } },
  ]),
  P('acid-glow-grain', 'Brillo ácido con grano', 'cyberpunk', 'Verde-amarillo difuso, luces abiertas y grano grueso.', [
    { type: 'colorBasic', params: { contrast: 15, highlights: 20, shadows: -20, saturation: -100 } },
    { type: 'gradientMap', params: { dark: '#0a1f04', light: '#f2ffb0', amount: 100 } },
    { type: 'diffusion', params: { radius: 50, intensity: 60, highlights: 55, mode: 'screen' } },
    { type: 'bloom', params: { threshold: 60, softness: 40, radius: 40, intensity: 50, useTint: true, tint: '#d8ff5a', mode: 'screen' } },
    { type: 'noise', params: { kind: 'film', amount: 34, size: 1.7, density: 100, mono: true, contrast: 10, seed: 6 } },
  ]),
  P('night-drive', 'Conducción nocturna', 'cyberpunk', 'Verde-teal de noche, movimiento, líneas verticales y señal.', [
    { type: 'colorBasic', params: { exposure: -0.1, contrast: 18, highlights: -10, shadows: -15, saturation: 5, temperature: -20, tint: -28 } },
    { type: 'splitToning', params: { hHue: 70, hSat: 30, sHue: 165, sSat: 45, balance: -5 } },
    { type: 'directionalBlur', params: { angle: 160, distance: 50, intensity: 45, falloff: 50, quality: 'normal' }, opacity: 70, blend: 'lighten' },
    { type: 'vGlitch', params: { amount: 12, bands: 30, height: 4, rgb: 3, seed: 8 } },
    { type: 'rgbSplit', params: { rx: 4, ry: 0, gx: 0, gy: 0, bx: -4, by: 0 } },
    { type: 'hScanlines', params: { intensity: 14, spacing: 3, thickness: 40 } },
    { type: 'noise', params: { kind: 'film', amount: 16, size: 1.4, density: 100, mono: true, contrast: 0, seed: 2 } },
  ]),
  P('burnt-analog', 'Analógico quemado', 'analog', 'Rojo-naranja quemado a crema, grano denso y halo.', [
    { type: 'colorBasic', params: { contrast: 35, highlights: 15, shadows: -30, saturation: -100 } },
    { type: 'gradientMap', params: { dark: '#1a0000', light: '#fff2c4', amount: 100 } },
    { type: 'splitToning', params: { hHue: 45, hSat: 25, sHue: 8, sSat: 70, balance: -15 } },
    { type: 'halation', params: { threshold: 55, radius: 30, intensity: 90, color: '#ff5a1a' } },
    { type: 'noise', params: { kind: 'film', amount: 40, size: 1.9, density: 100, mono: true, contrast: 25, seed: 9 } },
  ]),
];
