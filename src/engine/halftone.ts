// Motor de semitonos (halftone) para DTF. Puro: sin DOM, apto para worker.
// Renderiza puntos por "función de mancha" con distancia con signo → antialias opcional,
// trama rotada, muestreo por celda (promedio) o por píxel, y modo CMYK multicanal.

import { blurFloat, type Px } from './pixels';
import { rgbToCmykFormula, type CmykSettings } from './color';

export type DotShape = 'round' | 'square' | 'diamond' | 'ellipse' | 'line' | 'cross' | 'custom';
export type HalftoneMode = 'mono' | 'color' | 'alpha' | 'cmyk';

export interface ChannelScreen { angle: number; enabled: boolean; lpiScale: number }
/** Color de los puntos (modos alpha y color; mono siempre usa `inkColor`). */
export type DotColor = 'image' | 'solid' | 'gradient';
type Rgb = [number, number, number];
/** Tintas de proceso ideales: con ellas la mezcla de canales es la sustractiva clásica. */
export const PROCESS_INKS: Record<'c' | 'm' | 'y' | 'k', Rgb> = { c: [0, 255, 255], m: [255, 0, 255], y: [255, 255, 0], k: [0, 0, 0] };

export interface HalftoneParams {
  mode: HalftoneMode;
  shape: DotShape;
  cellPx: number; // tamaño de celda en px de la imagen = PPI efectivo / LPI
  angle: number;
  dotScale: number; // multiplicador del tamaño de punto (0.3..2)
  contrast: number; // -100..100
  density: number; // -100..100
  minDot: number; // 0..1 cobertura por debajo de la cual el punto desaparece
  maxDot: number; // 0..1 cobertura por encima de la cual el área es sólida
  antialias: boolean;
  invert: boolean;
  sample: 'cell' | 'pixel';
  ellipseRatio: number;
  inkColor: [number, number, number];
  /** 'image': colores de la imagen · 'solid': todos de `inkColor` · 'gradient': de `inkColor` (oscuros) a `inkColor2` (claros). */
  dotColor?: DotColor;
  inkColor2?: Rgb;
  /** CMYK: color de la tinta de cada canal (tintas planas). Sin definir: tintas de proceso. */
  inks?: Partial<Record<'c' | 'm' | 'y' | 'k', Rgb>> | null;
  knockout: 'none' | 'dark' | 'light'; // modo alpha: tonos que se vuelven transparentes
  channels: { c: ChannelScreen; m: ChannelScreen; y: ChannelScreen; k: ChannelScreen };
  cmyk: CmykSettings;
  cmykPlanes?: Uint8Array | null; // planos CMYK precalculados (ICC), entrelazados c,m,y,k
  custom?: { data: Uint8Array; w: number; h: number } | null; // umbral 0..255 (oscuro se llena antes)
  selection?: Uint8ClampedArray | null; // alfa 0..255, mismo tamaño
}

export const defaultHalftone: HalftoneParams = {
  mode: 'alpha', shape: 'round', cellPx: 10, angle: 22.5, dotScale: 1, contrast: 0, density: 0,
  minDot: 0.04, maxDot: 0.96, antialias: false, invert: false, sample: 'cell', ellipseRatio: 1.6,
  inkColor: [0, 0, 0], knockout: 'none',
  channels: {
    c: { angle: 15, enabled: true, lpiScale: 1 }, m: { angle: 75, enabled: true, lpiScale: 1 },
    y: { angle: 0, enabled: true, lpiScale: 1 }, k: { angle: 45, enabled: true, lpiScale: 1 },
  },
  cmyk: { gcr: 0.8, tac: 300 },
};

const SQ2 = Math.SQRT2;

/** Distancia con signo (en unidades de celda) desde (fu,fv)∈[-.5,.5]² al borde del punto de cobertura c. Negativo = tinta. */
function spot(shape: DotShape, fu: number, fv: number, c: number, ratio: number): number {
  const au = Math.abs(fu), av = Math.abs(fv);
  switch (shape) {
    case 'square': return Math.max(au, av) - Math.sqrt(c) / 2;
    case 'line': return av - c / 2;
    case 'cross': { const w = (1 - Math.sqrt(Math.max(0, 1 - c))) / 2; return Math.min(au, av) - w; }
    case 'diamond': {
      if (c <= 0.5) return (au + av - Math.sqrt(c / 2)) / SQ2;
      const l1 = (0.5 - au) + (0.5 - av);
      return (Math.sqrt((1 - c) / 2) - l1) / SQ2;
    }
    case 'ellipse':
    case 'round':
    default: {
      const k = shape === 'ellipse' ? Math.sqrt(ratio) : 1;
      const eu = fu / k, ev = fv * k;
      if (c <= 0.5) return Math.sqrt(eu * eu + ev * ev) - Math.sqrt(c / Math.PI);
      const du = (0.5 - au) / k, dv = (0.5 - av) * k;
      return Math.sqrt((1 - c) / Math.PI) - Math.sqrt(du * du + dv * dv);
    }
  }
}

function makeTransfer(p: HalftoneParams) {
  const cf = (100 + p.contrast) / 100;
  const dens = p.density / 100;
  return (v: number) => {
    if (p.invert) v = 1 - v;
    v = (v - 0.5) * cf * cf + 0.5 + dens * 0.5;
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    if (v <= p.minDot) return 0;
    if (v >= p.maxDot) return 1;
    // tamaño de punto: escala el radio → área ∝ escala²
    v = v * p.dotScale * p.dotScale;
    return v > 1 ? 1 : v;
  };
}

/** Rellena `out` (cobertura de tinta 0..1 por píxel) para un plano de valores. */
function screenPlane(values: Float32Array, w: number, h: number, cell: number, angleDeg: number, p: HalftoneParams, out: Float32Array) {
  const tr = makeTransfer(p);
  const a = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  let sampled = values;
  if (p.sample === 'cell') {
    sampled = new Float32Array(values);
    blurFloat(sampled, w, h, Math.max(1, cell * 0.5));
  }
  const inv = 1 / cell;
  const custom = p.shape === 'custom' ? p.custom : null;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5, py = y + 0.5;
      const u = (px * cos + py * sin) * inv, v = (-px * sin + py * cos) * inv;
      const iu = Math.floor(u), iv = Math.floor(v);
      const fu = u - iu - 0.5, fv = v - iv - 0.5;
      let val: number;
      if (p.sample === 'cell') {
        const cu = (iu + 0.5) * cell, cv = (iv + 0.5) * cell;
        let cx = (cu * cos - cv * sin) | 0, cy = (cu * sin + cv * cos) | 0;
        cx = cx < 0 ? 0 : cx >= w ? w - 1 : cx;
        cy = cy < 0 ? 0 : cy >= h ? h - 1 : cy;
        val = sampled[cy * w + cx];
      } else val = values[y * w + x];
      const c = tr(val);
      let ink: number;
      if (c <= 0) ink = 0;
      else if (c >= 1) ink = 1;
      else if (custom) {
        const tx = Math.min(custom.w - 1, ((fu + 0.5) * custom.w) | 0);
        const ty = Math.min(custom.h - 1, ((fv + 0.5) * custom.h) | 0);
        ink = custom.data[ty * custom.w + tx] / 255 < c ? 1 : 0;
      } else {
        const sd = spot(p.shape, fu, fv, c, p.ellipseRatio);
        if (p.antialias) {
          const t = 0.5 - sd * cell;
          ink = t < 0 ? 0 : t > 1 ? 1 : t;
        } else ink = sd <= 0 ? 1 : 0;
      }
      out[y * w + x] = ink;
    }
  }
}

export function halftone(img: Px, p: HalftoneParams): Px {
  const { width: w, height: h, data: d } = img;
  const n = w * h;
  const out = new Uint8ClampedArray(d.length);
  const cell = Math.max(2, p.cellPx);
  const ink = new Float32Array(n);
  const vals = new Float32Array(n);

  if (p.mode === 'cmyk') {
    // planos CMYK
    const planes = [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    for (let j = 0; j < n; j++) {
      const a = d[j * 4 + 3] / 255;
      let c: number, m: number, yv: number, k: number;
      if (p.cmykPlanes) { c = p.cmykPlanes[j * 4] / 255; m = p.cmykPlanes[j * 4 + 1] / 255; yv = p.cmykPlanes[j * 4 + 2] / 255; k = p.cmykPlanes[j * 4 + 3] / 255; }
      else [c, m, yv, k] = rgbToCmykFormula(d[j * 4], d[j * 4 + 1], d[j * 4 + 2], p.cmyk);
      planes[0][j] = c * a; planes[1][j] = m * a; planes[2][j] = yv * a; planes[3][j] = k * a;
    }
    const keys = ['c', 'm', 'y', 'k'] as const;
    const inks = planes.map(() => new Float32Array(n));
    const sub = { ...p, invert: false };
    keys.forEach((key, i) => {
      const ch = p.channels[key];
      if (!ch.enabled) return;
      screenPlane(planes[i], w, h, cell * (ch.lpiScale || 1), ch.angle, sub, inks[i]);
    });
    // cuánto absorbe cada tinta de cada componente (1 − color/255): con las de proceso, la mezcla sustractiva clásica
    const absorb = keys.map(key => (p.inks?.[key] ?? PROCESS_INKS[key]).map(v => 1 - v / 255));
    for (let j = 0; j < n; j++) {
      const o = j * 4;
      let any = 0, r = 255, g = 255, b = 255;
      for (let i = 0; i < 4; i++) {
        const v = inks[i][j];
        if (v <= 0) continue;
        if (v > any) any = v;
        const a = absorb[i];
        r *= 1 - v * a[0]; g *= 1 - v * a[1]; b *= 1 - v * a[2];
      }
      if (any <= 0) { out[o + 3] = 0; continue; }
      // composición de las tintas sobre el film
      out[o] = r; out[o + 1] = g; out[o + 2] = b;
      out[o + 3] = 255 * any * (d[o + 3] > 0 ? 1 : 0);
    }
  } else {
    for (let j = 0; j < n; j++) {
      const o = j * 4;
      const a = d[o + 3] / 255;
      const lum = (0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]) / 255;
      if (p.mode === 'alpha') {
        let v = a;
        if (p.knockout === 'dark') v *= lum;
        else if (p.knockout === 'light') v *= 1 - lum;
        vals[j] = v;
      } else vals[j] = (1 - lum) * a;
    }
    screenPlane(vals, w, h, cell, p.angle, p, ink);
    const [ir, ig, ib] = p.inkColor;
    const [jr, jg, jb] = p.inkColor2 ?? [255, 255, 255];
    const color: DotColor = p.mode === 'mono' ? 'solid' : p.dotColor ?? 'image';
    for (let j = 0; j < n; j++) {
      const o = j * 4;
      const k = ink[j];
      if (color === 'solid') { out[o] = ir; out[o + 1] = ig; out[o + 2] = ib; }
      else if (color === 'gradient') {
        // el tono del original elige el color: oscuros → primer color, claros → segundo
        const t = (0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]) / 255;
        out[o] = ir + (jr - ir) * t; out[o + 1] = ig + (jg - ig) * t; out[o + 2] = ib + (jb - ib) * t;
      } else { out[o] = d[o]; out[o + 1] = d[o + 1]; out[o + 2] = d[o + 2]; }
      out[o + 3] = 255 * k;
    }
  }

  if (p.selection) {
    const s = p.selection;
    for (let j = 0; j < n; j++) {
      const t = s[j] / 255;
      if (t >= 1) continue;
      const o = j * 4;
      for (let c = 0; c < 4; c++) out[o + c] = d[o + c] + (out[o + c] - d[o + c]) * t;
    }
  }
  return { data: out, width: w, height: h };
}
