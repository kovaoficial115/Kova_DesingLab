// Mates de selección sin modelos de IA:
//  · guidedMatte: refina el borde de una selección (cabello, pelo, contornos finos) con un filtro
//    guiado (He et al.) que usa la luminancia de la imagen como guía. Solo cambia la franja dudosa
//    alrededor del borde; dentro y fuera la selección queda igual.
//  · quickSubject: segmentación aproximada del sujeto principal suponiendo que el fondo es lo que
//    toca los bordes de la imagen (modelo de color del borde + umbral de Otsu + mayor componente +
//    relleno de huecos). Es una alternativa rápida cuando no se puede usar la IA, no una
//    segmentación precisa.

import type { Px } from './pixels';

/** Media en ventanas (2r+1)² con imagen integral; en los bordes divide por el área real. */
export function boxMean(src: Float32Array, w: number, h: number, r: number, out = new Float32Array(w * h)) {
  const W = w + 1;
  const S = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += src[y * w + x]; S[(y + 1) * W + x + 1] = S[y * W + x + 1] + row; }
  }
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const sum = S[y1 * W + x1] - S[y0 * W + x1] - S[y1 * W + x0] + S[y0 * W + x0];
      out[y * w + x] = sum / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

/**
 * Refina el alfa de `img` (la selección) guiándose por su luminancia. `r`: radio de la ventana
 * (px); `eps`: regularización (más alto = borde más suave, menos detalle); `contrast`: dureza del
 * borde resultante (1 = la salida del filtro tal cual).
 */
export function guidedMatte(img: Px, r: number, eps = 0.002, contrast = 1.4) {
  const { width: w, height: h, data: d } = img;
  const n = w * h;
  r = Math.max(1, Math.round(r));
  const I = new Float32Array(n), P = new Float32Array(n), T = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    I[i] = (0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]) / 255;
    P[i] = d[o + 3] / 255;
  }
  const mI = boxMean(I, w, h, r), mP = boxMean(P, w, h, r);
  for (let i = 0; i < n; i++) T[i] = I[i] * I[i];
  const mII = boxMean(T, w, h, r);
  for (let i = 0; i < n; i++) T[i] = I[i] * P[i];
  const mIP = boxMean(T, w, h, r);
  // a y b por ventana (se reutilizan los arrays)
  const A = mII, B = mIP;
  for (let i = 0; i < n; i++) {
    const v = mII[i] - mI[i] * mI[i];
    const a = (mIP[i] - mI[i] * mP[i]) / (v + eps);
    A[i] = a;
    B[i] = mP[i] - a * mI[i];
  }
  const mA = boxMean(A, w, h, r, T), mB = boxMean(B, w, h, r, mI);
  let changed = 0;
  for (let i = 0; i < n; i++) {
    // solo en la franja del borde: donde la ventana mezcla dentro y fuera
    if (mP[i] <= 0.004 || mP[i] >= 0.996) continue;
    // contraste del borde: compensa el suavizado del filtro sin perder los semitonos del pelo
    const q = Math.min(1, Math.max(0, (mA[i] * I[i] + mB[i] - 0.5) * contrast + 0.5));
    const v = Math.round(q * 255);
    if (v !== d[i * 4 + 3]) changed++;
    d[i * 4 + 3] = v;
  }
  return changed;
}

/** Umbral de Otsu de un histograma. */
export function otsu(hist: Float64Array | number[]) {
  let total = 0, sum = 0;
  for (let i = 0; i < hist.length; i++) { total += hist[i]; sum += i * hist[i]; }
  let wB = 0, sumB = 0, best = 0, t = 0;
  for (let i = 0; i < hist.length; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; t = i; }
  }
  return t;
}

function morph(m: Uint8Array, w: number, h: number, r: number, dilate: boolean) {
  // separable (cuadrado): primero filas, luego columnas
  const tmp = new Uint8Array(m.length), out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = dilate ? 0 : 1;
    for (let k = -r; k <= r; k++) { const xx = x + k; if (xx < 0 || xx >= w) continue; const s = m[y * w + xx]; if (dilate ? s : !s) { v = dilate ? 1 : 0; break; } }
    tmp[y * w + x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = dilate ? 0 : 1;
    for (let k = -r; k <= r; k++) { const yy = y + k; if (yy < 0 || yy >= h) continue; const s = tmp[yy * w + x]; if (dilate ? s : !s) { v = dilate ? 1 : 0; break; } }
    out[y * w + x] = v;
  }
  return out;
}

/** Etiqueta componentes conexos (4-vecinos) de los píxeles a 1; devuelve etiquetas y áreas. */
function components(m: Uint8Array, w: number, h: number) {
  const lab = new Int32Array(m.length).fill(-1);
  const areas: number[] = [];
  const stack = new Int32Array(m.length);
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || lab[s] >= 0) continue;
    const id = areas.length;
    let top = 0, area = 0;
    stack[top++] = s; lab[s] = id;
    while (top) {
      const p = stack[--top];
      area++;
      const x = p % w, y = (p - x) / w;
      if (x > 0 && m[p - 1] && lab[p - 1] < 0) { lab[p - 1] = id; stack[top++] = p - 1; }
      if (x < w - 1 && m[p + 1] && lab[p + 1] < 0) { lab[p + 1] = id; stack[top++] = p + 1; }
      if (y > 0 && m[p - w] && lab[p - w] < 0) { lab[p - w] = id; stack[top++] = p - w; }
      if (y < h - 1 && m[p + w] && lab[p + w] < 0) { lab[p + w] = id; stack[top++] = p + w; }
    }
    areas.push(area);
  }
  return { lab, areas };
}

/** k-medias sobre muestras RGB (n×3); devuelve los centros. Determinista. */
function kmeans(samples: Float32Array, K: number, iters = 8) {
  const ns = samples.length / 3;
  K = Math.max(1, Math.min(K, ns));
  const C = new Float32Array(K * 3);
  for (let k = 0; k < K; k++) { const s = Math.floor(((k + 0.5) / K) * ns) * 3; C[k * 3] = samples[s]; C[k * 3 + 1] = samples[s + 1]; C[k * 3 + 2] = samples[s + 2]; }
  const acc = new Float64Array(K * 4);
  for (let it = 0; it < iters; it++) {
    acc.fill(0);
    for (let i = 0; i < ns; i++) {
      const r = samples[i * 3], g = samples[i * 3 + 1], b = samples[i * 3 + 2];
      let best = 0, bd = Infinity;
      for (let k = 0; k < K; k++) { const dr = r - C[k * 3], dg = g - C[k * 3 + 1], db = b - C[k * 3 + 2]; const dd = dr * dr + dg * dg + db * db; if (dd < bd) { bd = dd; best = k; } }
      acc[best * 4] += r; acc[best * 4 + 1] += g; acc[best * 4 + 2] += b; acc[best * 4 + 3]++;
    }
    for (let k = 0; k < K; k++) if (acc[k * 4 + 3]) { C[k * 3] = acc[k * 4] / acc[k * 4 + 3]; C[k * 3 + 1] = acc[k * 4 + 1] / acc[k * 4 + 3]; C[k * 3 + 2] = acc[k * 4 + 2] / acc[k * 4 + 3]; }
  }
  return C;
}
function nearest(C: Float32Array, r: number, g: number, b: number) {
  let bd = Infinity;
  for (let k = 0; k < C.length; k += 3) { const dr = r - C[k], dg = g - C[k + 1], db = b - C[k + 2]; const dd = dr * dr + dg * dg + db * db; if (dd < bd) bd = dd; }
  return Math.sqrt(bd);
}
/** Hasta `max` muestras RGB de los píxeles con m[i] === want (submuestreo regular). */
function sampleWhere(d: Uint8ClampedArray, m: Uint8Array, want: number, max: number) {
  let count = 0;
  for (let i = 0; i < m.length; i++) if (m[i] === want && d[i * 4 + 3] >= 16) count++;
  const step = Math.max(1, Math.floor(count / max));
  const out: number[] = [];
  let c = 0;
  for (let i = 0; i < m.length; i++) {
    if (m[i] !== want || d[i * 4 + 3] < 16) continue;
    if (c++ % step) continue;
    out.push(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
  }
  return new Float32Array(out);
}
/** Deja la mayor región (y las que sean al menos un 20 % de ella) y rellena sus huecos. */
function cleanSubject(m: Uint8Array, w: number, h: number) {
  const n = w * h;
  const { lab, areas } = components(m, w, h);
  if (!areas.length) return 0;
  const big = Math.max(...areas);
  const keep = areas.map(a => a >= big * 0.2);
  for (let i = 0; i < n; i++) m[i] = lab[i] >= 0 && keep[lab[i]] ? 1 : 0;
  const inv = new Uint8Array(n);
  for (let i = 0; i < n; i++) inv[i] = 1 - m[i];
  const bgLab = components(inv, w, h);
  const touches = new Uint8Array(bgLab.areas.length);
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) { const l = bgLab.lab[y * w + x]; if (l >= 0) touches[l] = 1; }
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) { const l = bgLab.lab[y * w + x]; if (l >= 0) touches[l] = 1; }
  let area = 0;
  for (let i = 0; i < n; i++) { const l = bgLab.lab[i]; if (!m[i] && l >= 0 && !touches[l]) m[i] = 1; area += m[i]; }
  return area;
}

/**
 * Sujeto aproximado: deja en el alfa de `img` 255 para el sujeto y 0 para el fondo. Devuelve la
 * fracción de la imagen que ocupa el sujeto (0 si no encontró nada razonable).
 *
 * 1) El fondo se modela con los colores del borde; lo que se aleja de ellos (umbral de Otsu) es
 *    el sujeto inicial. Si eso no da una región razonable, se parte de una elipse central.
 * 2) Unas iteraciones al estilo GrabCut (sin corte de grafo): modelos de color del sujeto y del
 *    fondo, cada píxel va con el más parecido, el mapa se suaviza y se limpia (mayor región,
 *    huecos rellenos). El borde de la imagen siempre es fondo.
 */
export function quickSubject(img: Px): number {
  const { width: w, height: h, data: d } = img;
  const n = w * h;
  if (w < 8 || h < 8) return 0;
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.03));
  const border = new Uint8Array(n);
  // borde superior y laterales: en retratos y bustos el sujeto suele salir por abajo, así que el
  // borde inferior no se da por fondo (lo decide el modelo de color)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < band || x >= w - band || y < band) border[y * w + x] = 1;
  const bgS = sampleWhere(d, border, 1, 6000);
  if (bgS.length < 24) return 0;
  // ¿hay contraste? (una imagen lisa no tiene sujeto)
  let mean = [0, 0, 0], varSum = 0;
  for (let i = 0; i < n; i++) { mean[0] += d[i * 4]; mean[1] += d[i * 4 + 1]; mean[2] += d[i * 4 + 2]; }
  mean = mean.map(v => v / n);
  for (let i = 0; i < n; i++) { const a = d[i * 4] - mean[0], b = d[i * 4 + 1] - mean[1], c = d[i * 4 + 2] - mean[2]; varSum += a * a + b * b + c * c; }
  if (Math.sqrt(varSum / n) < 4) return 0;
  // 1) sujeto inicial: lejos de los colores del borde
  const bgC0 = kmeans(bgS, 5);
  const dist = new Float32Array(n);
  let maxD = 0;
  for (let i = 0; i < n; i++) { const v = nearest(bgC0, d[i * 4], d[i * 4 + 1], d[i * 4 + 2]); dist[i] = v; if (v > maxD) maxD = v; }
  let m = new Uint8Array(n);
  if (maxD > 0) {
    const hist = new Float64Array(256);
    for (let i = 0; i < n; i++) hist[Math.min(255, Math.floor((dist[i] / maxD) * 255))]++;
    const t = Math.max((otsu(hist) / 255) * maxD, 24);
    for (let i = 0; i < n; i++) m[i] = dist[i] > t && !border[i] ? 1 : 0;
  }
  let area = cleanSubject(m, w, h);
  if (area < n * 0.03 || area > n * 0.85) {
    // sin un sujeto claro por color: elipse central (como el rectángulo inicial de GrabCut)
    m = new Uint8Array(n);
    const cx = w / 2, cy = h * 0.52, rx = w * 0.32, ry = h * 0.4;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) m[y * w + x] = 1;
  }
  // 2) iteraciones: modelos de color del sujeto y del fondo
  const score = new Float32Array(n);
  const rs = Math.max(1, Math.round(Math.min(w, h) / 120));
  for (let it = 0; it < 4; it++) {
    const fgS = sampleWhere(d, m, 1, 5000);
    const bgMask = new Uint8Array(n);
    for (let i = 0; i < n; i++) bgMask[i] = m[i] ? 0 : 1;
    const bgS2 = sampleWhere(d, bgMask, 1, 6000);
    if (fgS.length < 24 || bgS2.length < 24) break;
    const fgC = kmeans(fgS, 6), bgC = kmeans(bgS2, 6);
    for (let i = 0; i < n; i++) {
      if (border[i] || d[i * 4 + 3] < 16) { score[i] = 0; continue; }
      const df = nearest(fgC, d[i * 4], d[i * 4 + 1], d[i * 4 + 2]), db = nearest(bgC, d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
      score[i] = db / (df + db + 1e-6);
    }
    const sm = boxMean(score, w, h, rs);
    for (let i = 0; i < n; i++) m[i] = sm[i] > 0.5 && !border[i] ? 1 : 0;
    m = morph(morph(m, w, h, 1, false), w, h, 1, true);
    area = cleanSubject(m, w, h);
    if (area < n * 0.01) return 0;
  }
  for (let i = 0; i < n; i++) d[i * 4 + 3] = m[i] ? 255 : 0;
  return area / n;
}

/** Máscara de luminancia en el sitio: gris = luminancia (o su inversa, `shadows`); lo
 *  transparente cuenta como negro. */
export function lumaMask(d: Uint8ClampedArray, shadows: boolean) {
  for (let i = 0; i < d.length; i += 4) {
    let v = ((0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) * d[i + 3]) / (255 * 255);
    if (shadows) v = 1 - v;
    const g = Math.round(v * 255);
    d[i] = d[i + 1] = d[i + 2] = g; d[i + 3] = 255;
  }
  return d;
}
