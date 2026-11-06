// Detección de solapes UV por rasterizado (función pura, sin Three.js).
// Dos triángulos que cubren el mismo texel recibirían el mismo estampado: en una zona
// imprimible eso duplica o deforma el diseño.

export interface UvCoverage {
  /** fracción de la región cubierta por algún triángulo */
  coverage: number;
  /** fracción de lo cubierto que está cubierto dos o más veces */
  overlap: number;
}

/**
 * @param uv     pares (u, v) por vértice
 * @param index  índices de triángulos (o null si la geometría no está indexada)
 * @param region [u0, v0, u1, v1] a analizar (por defecto todo el espacio UV)
 * @param res    resolución de la rejilla
 */
export function uvOverlap(uv: ArrayLike<number>, index: ArrayLike<number> | null, region: [number, number, number, number] = [0, 0, 1, 1], res = 512): UvCoverage {
  const [u0, v0, u1, v1] = region;
  const sx = res / (u1 - u0), sy = res / (v1 - v0);
  const grid = new Uint8Array(res * res);
  const triCount = (index ? index.length : uv.length / 2) / 3;
  const vi = (t: number, k: number) => (index ? index[t * 3 + k] : t * 3 + k);
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
        if (w0 > 0 && w1 > 0 && w2 > 0) { const i = y * res + x; if (grid[i] < 255) grid[i]++; }
      }
    }
  }
  let covered = 0, over = 0;
  for (let i = 0; i < grid.length; i++) { if (grid[i]) covered++; if (grid[i] > 1) over++; }
  return { coverage: covered / grid.length, overlap: covered ? over / covered : 0 };
}
