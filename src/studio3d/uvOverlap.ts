// Detección de solapes UV por rasterizado (función pura, sin Three.js).
// Dos triángulos que cubren el mismo texel recibirían el mismo estampado: en una zona
// imprimible eso duplica o deforma el diseño.

export interface UvCoverage {
  /** fracción de la región cubierta por algún triángulo */
  coverage: number;
  /** fracción de lo cubierto que comparten partes distintas de la prenda (recibirían el mismo estampado) */
  overlap: number;
  /** fracción de lo cubierto que comparten las dos caras de la tela (exterior e interior, a pocos mm):
   *  es normal en prendas con grosor y no duplica el estampado en otra parte */
  shell: number;
}

export interface OverlapOptions {
  /** posiciones 3D por vértice (x, y, z): con ellas se distinguen las dos caras de la tela de un solape real */
  positions?: ArrayLike<number>;
  /** distancia por debajo de la cual dos triángulos son la misma zona de tela (m) */
  thicknessM?: number;
}

/**
 * @param uv     pares (u, v) por vértice
 * @param index  índices de triángulos (o null si la geometría no está indexada)
 * @param region [u0, v0, u1, v1] a analizar (por defecto todo el espacio UV)
 * @param res    resolución de la rejilla
 */
export function uvOverlap(uv: ArrayLike<number>, index: ArrayLike<number> | null, region: [number, number, number, number] = [0, 0, 1, 1], res = 512, opts: OverlapOptions = {}): UvCoverage {
  const [u0, v0, u1, v1] = region;
  const sx = res / (u1 - u0), sy = res / (v1 - v0);
  // por texel: primer triángulo que lo cubre (+1; 0 = vacío) y si alguien más lo pisó
  const first = new Int32Array(res * res);
  const state = new Uint8Array(res * res); // 0 libre · 1 una vez · 2 caras de la tela · 3 solape real
  const triCount = (index ? index.length : uv.length / 2) / 3;
  const vi = (t: number, k: number) => (index ? index[t * 3 + k] : t * 3 + k);
  const P = opts.positions, th2 = (opts.thicknessM ?? 0.03) ** 2;
  const cent = (t: number, k: number) => { let n = 0; for (let j = 0; j < 3; j++) n += P![vi(t, j) * 3 + k]; return n / 3; };
  const near = (t1: number, t2: number) => {
    if (!P) return false;
    const dx = cent(t1, 0) - cent(t2, 0), dy = cent(t1, 1) - cent(t2, 1), dz = cent(t1, 2) - cent(t2, 2);
    return dx * dx + dy * dy + dz * dz < th2;
  };
  for (let t = 0; t < triCount; t++) {
    const a = vi(t, 0), b = vi(t, 1), c = vi(t, 2);
    // a coordenadas de rejilla
    const ax = (uv[a * 2] - u0) * sx, ay = (uv[a * 2 + 1] - v0) * sy;
    const bx = (uv[b * 2] - u0) * sx, by = (uv[b * 2 + 1] - v0) * sy;
    const cx = (uv[c * 2] - u0) * sx, cy = (uv[c * 2 + 1] - v0) * sy;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-12) continue;
    const s = area > 0 ? 1 : -1;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(res - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxY = Math.min(res - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        // regla de borde: un texel en la arista compartida cuenta solo para un triángulo
        const w0 = s * ((bx - ax) * (py - ay) - (by - ay) * (px - ax));
        const w1 = s * ((cx - bx) * (py - by) - (cy - by) * (px - bx));
        const w2 = s * ((ax - cx) * (py - cy) - (ay - cy) * (px - cx));
        if (w0 > 0 && w1 > 0 && w2 > 0) {
          const i = y * res + x;
          if (!state[i]) { state[i] = 1; first[i] = t; }
          else if (state[i] !== 3) state[i] = near(first[i], t) ? Math.max(state[i], 2) : 3;
        }
      }
    }
  }
  let covered = 0, over = 0, shell = 0;
  for (let i = 0; i < state.length; i++) { if (state[i]) covered++; if (state[i] === 3) over++; else if (state[i] === 2) shell++; }
  return { coverage: covered / state.length, overlap: covered ? over / covered : 0, shell: covered ? shell / covered : 0 };
}

/** Si todas las UV caen en una misma casilla entera (p. ej. u entre 2 y 3, habitual en
 *  exportaciones de Sketchfab con textura en repetición), devuelve esa casilla; si no, null. */
export function singleTile(uv: ArrayLike<number>): [number, number] | null {
  if (!uv.length) return [0, 0];
  let mnU = Infinity, mnV = Infinity, mxU = -Infinity, mxV = -Infinity;
  for (let i = 0; i < uv.length; i += 2) {
    const u = uv[i], v = uv[i + 1];
    if (u < mnU) mnU = u; if (u > mxU) mxU = u; if (v < mnV) mnV = v; if (v > mxV) mxV = v;
  }
  const e = 1e-4, tu = Math.floor(mnU + e), tv = Math.floor(mnV + e);
  return mxU <= tu + 1 + e && mxV <= tv + 1 + e ? [tu, tv] : null;
}
