// Texto en trayectoria: las letras se colocan una a una a lo largo de una curva (círculo, arco,
// onda o el contorno de otra forma). Funciones puras: interpretan la curva SVG, la convierten en
// una polilínea medida y calculan la posición y el giro de cada letra. Las usan el dibujo, la
// exportación a SVG y los tests.

import type { TextAlign, TextPath } from './types';

export interface Pt { x: number; y: number }

// ---------- lectura de trazados SVG (M L H V C S Q T A Z, absolutos y relativos) ----------
const NUM = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;

/** Subtrazados aplanados en polilíneas. `closed` si terminan en Z. */
export function flattenPath(d: string, steps = 24): { pts: Pt[]; closed: boolean }[] {
  const out: { pts: Pt[]; closed: boolean }[] = [];
  const tokens = d.match(/[a-df-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  let i = 0, cmd = '', cx = 0, cy = 0, sx = 0, sy = 0;
  let lastC: Pt | null = null, lastQ: Pt | null = null;
  let cur: Pt[] | null = null;
  const isCmd = (t: string) => /^[a-z]$/i.test(t);
  const n = () => parseFloat(tokens[i++]);
  const push = (p: Pt) => { if (!cur) { cur = [{ x: cx, y: cy }]; out.push({ pts: cur, closed: false }); } cur.push(p); };
  const cubic = (p1: Pt, p2: Pt, p3: Pt) => {
    const p0 = { x: cx, y: cy };
    const len = Math.hypot(p1.x - p0.x, p1.y - p0.y) + Math.hypot(p2.x - p1.x, p2.y - p1.y) + Math.hypot(p3.x - p2.x, p3.y - p2.y);
    const k = Math.max(4, Math.min(64, Math.ceil(len / 6)));
    for (let s = 1; s <= k; s++) {
      const t = s / k, u = 1 - t;
      push({ x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x, y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y });
    }
  };
  const quad = (p1: Pt, p2: Pt) => {
    const p0 = { x: cx, y: cy };
    cubic({ x: p0.x + (2 / 3) * (p1.x - p0.x), y: p0.y + (2 / 3) * (p1.y - p0.y) }, { x: p2.x + (2 / 3) * (p1.x - p2.x), y: p2.y + (2 / 3) * (p1.y - p2.y) }, p2);
  };
  const arc = (rx: number, ry: number, rotDeg: number, large: boolean, sweep: boolean, x: number, y: number) => {
    // conversión de extremo a centro (SVG 1.1, apéndice F.6)
    const x1 = cx, y1 = cy;
    if (rx === 0 || ry === 0 || (x1 === x && y1 === y)) { push({ x, y }); return; }
    rx = Math.abs(rx); ry = Math.abs(ry);
    const phi = (rotDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
    const dx = (x1 - x) / 2, dy = (y1 - y) / 2;
    const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
    const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
    const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    let co = Math.sqrt(Math.max(0, num / den));
    if (large === sweep) co = -co;
    const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
    const ccx = cos * cxp - sin * cyp + (x1 + x) / 2, ccy = sin * cxp + cos * cyp + (y1 + y) / 2;
    const ang = (ux: number, uy: number, vx: number, vy: number) => {
      const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
      return a;
    };
    const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    else if (sweep && dt < 0) dt += 2 * Math.PI;
    const k = Math.max(6, Math.min(128, Math.ceil((Math.abs(dt) * Math.max(rx, ry)) / 6)));
    for (let s = 1; s <= k; s++) {
      const t = t1 + (dt * s) / k;
      const ex = rx * Math.cos(t), ey = ry * Math.sin(t);
      push(s === k ? { x, y } : { x: cos * ex - sin * ey + ccx, y: sin * ex + cos * ey + ccy });
    }
  };
  void steps; void NUM;
  while (i < tokens.length) {
    if (isCmd(tokens[i])) cmd = tokens[i++];
    else if (!cmd) { i++; continue; }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? cx : 0, oy = rel ? cy : 0;
    if (C === 'Z') {
      if (cur) { const c: Pt[] = cur; if (c.length && (c[c.length - 1].x !== sx || c[c.length - 1].y !== sy)) c.push({ x: sx, y: sy }); out[out.length - 1].closed = true; }
      cx = sx; cy = sy; cur = null; lastC = lastQ = null;
      continue;
    }
    if (i >= tokens.length || isCmd(tokens[i])) { continue; }
    switch (C) {
      case 'M': {
        cx = n() + ox; cy = n() + oy; sx = cx; sy = cy;
        cur = [{ x: cx, y: cy }]; out.push({ pts: cur, closed: false });
        cmd = rel ? 'l' : 'L'; lastC = lastQ = null;
        break;
      }
      case 'L': { const x = n() + ox, y = n() + oy; push({ x, y }); cx = x; cy = y; lastC = lastQ = null; break; }
      case 'H': { const x = n() + ox; push({ x, y: cy }); cx = x; lastC = lastQ = null; break; }
      case 'V': { const y = n() + oy; push({ x: cx, y }); cy = y; lastC = lastQ = null; break; }
      case 'C': {
        const p1 = { x: n() + ox, y: n() + oy }, p2 = { x: n() + ox, y: n() + oy }, p3 = { x: n() + ox, y: n() + oy };
        cubic(p1, p2, p3); cx = p3.x; cy = p3.y; lastC = p2; lastQ = null; break;
      }
      case 'S': {
        const p1 = lastC ? { x: 2 * cx - lastC.x, y: 2 * cy - lastC.y } : { x: cx, y: cy };
        const p2 = { x: n() + ox, y: n() + oy }, p3 = { x: n() + ox, y: n() + oy };
        cubic(p1, p2, p3); cx = p3.x; cy = p3.y; lastC = p2; lastQ = null; break;
      }
      case 'Q': {
        const p1 = { x: n() + ox, y: n() + oy }, p2 = { x: n() + ox, y: n() + oy };
        quad(p1, p2); cx = p2.x; cy = p2.y; lastQ = p1; lastC = null; break;
      }
      case 'T': {
        const p1 = lastQ ? { x: 2 * cx - lastQ.x, y: 2 * cy - lastQ.y } : { x: cx, y: cy };
        const p2 = { x: n() + ox, y: n() + oy };
        quad(p1, p2); cx = p2.x; cy = p2.y; lastQ = p1; lastC = null; break;
      }
      case 'A': {
        const rx = n(), ry = n(), rot = n(), large = n() !== 0, sweep = n() !== 0, x = n() + ox, y = n() + oy;
        arc(rx, ry, rot, large, sweep, x, y); cx = x; cy = y; lastC = lastQ = null; break;
      }
      default: i++;
    }
  }
  return out.filter(s => s.pts.length > 1);
}

// ---------- formas predefinidas ----------
const f = (v: number) => +v.toFixed(2);

/** Círculo de radio r centrado en (0,0), desde arriba en el sentido de las agujas del reloj. */
export function circlePath(r: number) {
  r = Math.max(1, r);
  return `M0 ${f(-r)}A${f(r)} ${f(r)} 0 1 1 0 ${f(r)}A${f(r)} ${f(r)} 0 1 1 0 ${f(-r)}Z`;
}
/** Arco de radio r que abarca `sweep` grados, centrado arriba. */
export function arcPath(r: number, sweep: number) {
  r = Math.max(1, r);
  const sw = Math.max(1, Math.min(359, sweep)) * (Math.PI / 180);
  const a0 = -Math.PI / 2 - sw / 2, a1 = -Math.PI / 2 + sw / 2;
  return `M${f(r * Math.cos(a0))} ${f(r * Math.sin(a0))}A${f(r)} ${f(r)} 0 ${sw > Math.PI ? 1 : 0} 1 ${f(r * Math.cos(a1))} ${f(r * Math.sin(a1))}`;
}
/** Onda senoidal horizontal. */
export function wavePath(amp: number, wavelength: number, waves: number) {
  const L = Math.max(4, wavelength), n = Math.max(0.5, Math.min(20, waves));
  const total = L * n, k = Math.ceil(n * 24);
  let d = `M0 0`;
  for (let i = 1; i <= k; i++) { const x = (total * i) / k; d += `L${f(x)} ${f(-amp * Math.sin((2 * Math.PI * x) / L))}`; }
  return d;
}

/** Contorno de una forma (en sus coordenadas, ya escalada). */
export function shapeOutline(shape: 'rect' | 'ellipse' | 'line', w: number, h: number, radius = 0): string {
  if (shape === 'line') return `M0 ${f(h / 2)}L${f(w)} ${f(h / 2)}`;
  if (shape === 'ellipse') return `M${f(w / 2)} 0A${f(w / 2)} ${f(h / 2)} 0 1 1 ${f(w / 2)} ${f(h)}A${f(w / 2)} ${f(h / 2)} 0 1 1 ${f(w / 2)} 0Z`;
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (!r) return `M0 0H${f(w)}V${f(h)}H0Z`;
  return `M${f(r)} 0H${f(w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w)} ${f(r)}V${f(h - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w - r)} ${f(h)}H${f(r)}A${f(r)} ${f(r)} 0 0 1 0 ${f(h - r)}V${f(r)}A${f(r)} ${f(r)} 0 0 1 ${f(r)} 0Z`;
}

/** Trayectoria por defecto de un tipo, a la escala del texto. */
export function defaultPath(kind: TextPath['kind'], fontSize: number, prev?: TextPath | null): TextPath {
  const base = { pos: prev?.pos ?? (kind === 'circle' ? 0 : 50), flip: prev?.flip ?? false, shift: prev?.shift ?? 0 };
  if (kind === 'circle') { const r = prev?.r ?? Math.round(fontSize * 2.5); return { kind, d: circlePath(r), r, ...base }; }
  if (kind === 'arc') { const r = prev?.r ?? Math.round(fontSize * 3); const sweep = prev?.sweep ?? 140; return { kind, d: arcPath(r, sweep), r, sweep, ...base }; }
  if (kind === 'wave') {
    const amp = prev?.amp ?? Math.round(fontSize * 0.4), wavelength = prev?.wavelength ?? Math.round(fontSize * 4), waves = prev?.waves ?? 2;
    return { kind, d: wavePath(amp, wavelength, waves), amp, wavelength, waves, ...base };
  }
  return { kind: 'custom', d: prev?.d ?? `M0 0L${fontSize * 6} 0`, ...base };
}

/** Vuelve a generar `d` tras cambiar las medidas de una forma predefinida. */
export function rebuildPath(p: TextPath): TextPath {
  if (p.kind === 'circle') return { ...p, d: circlePath(p.r ?? 100) };
  if (p.kind === 'arc') return { ...p, d: arcPath(p.r ?? 100, p.sweep ?? 140) };
  if (p.kind === 'wave') return { ...p, d: wavePath(p.amp ?? 20, p.wavelength ?? 200, p.waves ?? 2) };
  return p;
}

// ---------- medición de la curva ----------
export interface Sampler { pts: Pt[]; cum: number[]; total: number; closed: boolean }

export function samplePath(d: string, flip = false): Sampler | null {
  const sub = flattenPath(d)[0];
  if (!sub) return null;
  let pts = sub.pts.filter((p, i, a) => i === 0 || p.x !== a[i - 1].x || p.y !== a[i - 1].y);
  if (pts.length < 2) return null;
  if (flip) pts = [...pts].reverse();
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return { pts, cum, total: cum[cum.length - 1], closed: sub.closed };
}

/** Punto y dirección (radianes) a la distancia `s` del inicio. Fuera de los extremos de una
 *  curva abierta se prolonga en línea recta; en una cerrada da la vuelta. */
export function pointAt(S: Sampler, s: number): { x: number; y: number; a: number } {
  const { pts, cum, total } = S;
  if (S.closed && total > 0) s = ((s % total) + total) % total;
  if (s <= 0) {
    const a = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
    return { x: pts[0].x + Math.cos(a) * s, y: pts[0].y + Math.sin(a) * s, a };
  }
  if (s >= total) {
    const n = pts.length - 1;
    const a = Math.atan2(pts[n].y - pts[n - 1].y, pts[n].x - pts[n - 1].x);
    return { x: pts[n].x + Math.cos(a) * (s - total), y: pts[n].y + Math.sin(a) * (s - total), a };
  }
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  const seg = cum[hi] - cum[lo] || 1, t = (s - cum[lo]) / seg;
  const p0 = pts[lo], p1 = pts[hi];
  return { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t, a: Math.atan2(p1.y - p0.y, p1.x - p0.x) };
}

export function pathBounds(S: Sampler) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of S.pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export interface PathGlyph { ch: string; x: number; y: number; a: number; w: number }

/**
 * Coloca cada letra sobre la curva. `prefix(i)` es el ancho de las i primeras letras (con su
 * interletraje); el espaciado se suma aparte. La letra queda centrada en su punto de la curva,
 * girada según la tangente, con la línea base desplazada `shift` hacia fuera.
 */
export function layoutOnPath(chars: string[], prefix: (i: number) => number, opts: { S: Sampler; pos: number; align: TextAlign; letterSpacing: number; shift: number }): PathGlyph[] {
  const { S } = opts;
  const n = chars.length;
  const width = n ? prefix(n) + opts.letterSpacing * (n - 1) : 0;
  const anchor = (Math.max(0, Math.min(100, opts.pos)) / 100) * S.total;
  const a = opts.align;
  const start = a === 'center' || a === 'justify-center' ? anchor - width / 2 : a === 'right' || a === 'justify-right' ? anchor - width : anchor;
  const out: PathGlyph[] = [];
  for (let i = 0; i < n; i++) {
    const s0 = prefix(i) + opts.letterSpacing * i;
    const w = prefix(i + 1) - prefix(i);
    const p = pointAt(S, start + s0 + w / 2);
    // la normal «hacia fuera» es la izquierda de la dirección de avance (y hacia abajo en pantalla)
    const nx = Math.sin(p.a), ny = -Math.cos(p.a);
    out.push({ ch: chars[i], x: p.x + nx * opts.shift, y: p.y + ny * opts.shift, a: p.a, w });
  }
  return out;
}

/** Caja de la tinta de las letras (cada una como rectángulo girado de su ancho × alto). */
export function glyphBounds(gs: PathGlyph[], ascent: number, descent: number, pad: number) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const g of gs) {
    if (!g.ch.trim()) continue;
    const c = Math.cos(g.a), s = Math.sin(g.a);
    for (const [lx, ly] of [[-g.w / 2, -ascent], [g.w / 2, -ascent], [g.w / 2, descent], [-g.w / 2, descent]]) {
      const x = g.x + lx * c - ly * s, y = g.y + lx * s + ly * c;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  if (!isFinite(x0)) return null;
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
}
