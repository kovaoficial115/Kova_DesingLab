// Escritores binarios: metadatos de resolución en PNG/JPEG, TIFF (RGB/RGBA/CMYK) y BMP.

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Inserta/reemplaza el chunk pHYs (píxeles por metro) para que el RIP lea el tamaño físico. */
export function pngSetDpi(png: Uint8Array, dpi: number): Uint8Array {
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // 'pHYs'
  dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));
  // recorrer chunks, quitar pHYs existentes e insertar tras IHDR
  const out: Uint8Array[] = [png.subarray(0, 8)];
  let off = 8;
  const pv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  while (off < png.length) {
    const len = pv.getUint32(off);
    const type = String.fromCharCode(...png.subarray(off + 4, off + 8));
    const end = off + 12 + len;
    if (type !== 'pHYs') out.push(png.subarray(off, end));
    if (type === 'IHDR') out.push(chunk);
    off = end;
  }
  const total = out.reduce((a, b) => a + b.length, 0);
  const res = new Uint8Array(total);
  let p = 0;
  for (const o of out) { res.set(o, p); p += o.length; }
  return res;
}

export function pngReadDpi(buf: Uint8Array): number | null {
  if (buf[0] !== 0x89 || buf[1] !== 0x50) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 8;
  while (off + 8 < buf.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(...buf.subarray(off + 4, off + 8));
    if (type === 'pHYs' && buf[off + 16] === 1) return Math.round(dv.getUint32(off + 8) * 0.0254);
    if (type === 'IDAT') break;
    off += 12 + len;
  }
  return null;
}

/** Ajusta la densidad JFIF (APP0) de un JPEG; la inserta si no existe. */
export function jpegSetDpi(jpg: Uint8Array, dpi: number): Uint8Array {
  const d = Math.min(65535, Math.round(dpi));
  if (jpg[2] === 0xff && jpg[3] === 0xe0 && jpg[6] === 0x4a && jpg[7] === 0x46) {
    const out = new Uint8Array(jpg);
    out[13] = 1; out[14] = d >> 8; out[15] = d & 255; out[16] = d >> 8; out[17] = d & 255;
    return out;
  }
  const app0 = new Uint8Array([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 1, d >> 8, d & 255, d >> 8, d & 255, 0, 0]);
  const out = new Uint8Array(jpg.length + app0.length);
  out.set(jpg.subarray(0, 2), 0); out.set(app0, 2); out.set(jpg.subarray(2), 2 + app0.length);
  return out;
}
export function jpegReadDpi(buf: Uint8Array): number | null {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  if (buf[2] === 0xff && buf[3] === 0xe0 && buf[6] === 0x4a) {
    const units = buf[13];
    const x = (buf[14] << 8) | buf[15];
    if (units === 1 && x > 1) return x;
    if (units === 2 && x > 1) return Math.round(x * 2.54);
  }
  return null;
}

/** TIFF sin compresión, little-endian. channels: 3 RGB, 4 RGBA (alfa no asociado) o 'cmyk'. */
export function encodeTiff(pixels: Uint8Array, w: number, h: number, mode: 'rgb' | 'rgba' | 'cmyk', dpi: number, icc?: Uint8Array | null): Uint8Array {
  const spp = mode === 'rgb' ? 3 : 4;
  const dataLen = w * h * spp;
  const entries: [number, number, number, number[] | Uint8Array][] = []; // tag, type, count, values
  const SHORT = 3, LONG = 4, RATIONAL = 5, UNDEF = 7, ASCII = 2;
  const sw = new TextEncoder().encode('Kova_DesignLab\0');
  entries.push([256, LONG, 1, [w]]);
  entries.push([257, LONG, 1, [h]]);
  entries.push([258, SHORT, spp, new Array(spp).fill(8)]);
  entries.push([259, SHORT, 1, [1]]);
  entries.push([262, SHORT, 1, [mode === 'cmyk' ? 5 : 2]]);
  entries.push([273, LONG, 1, [0]]); // offset, se rellena luego
  entries.push([277, SHORT, 1, [spp]]);
  entries.push([278, LONG, 1, [h]]);
  entries.push([279, LONG, 1, [dataLen]]);
  entries.push([282, RATIONAL, 1, [Math.round(dpi * 100), 100]]);
  entries.push([283, RATIONAL, 1, [Math.round(dpi * 100), 100]]);
  entries.push([284, SHORT, 1, [1]]);
  entries.push([296, SHORT, 1, [2]]);
  entries.push([305, ASCII, sw.length, sw]);
  if (mode === 'rgba') entries.push([338, SHORT, 1, [2]]);
  if (mode === 'cmyk') entries.push([332, SHORT, 1, [1]]);
  if (icc) entries.push([34675, UNDEF, icc.length, icc]);
  entries.sort((a, b) => a[0] - b[0]);

  const typeSize = (t: number) => (t === SHORT ? 2 : t === LONG ? 4 : t === RATIONAL ? 8 : 1);
  const ifdSize = 2 + entries.length * 12 + 4;
  let extraLen = 0;
  for (const e of entries) { const sz = typeSize(e[1]) * e[2]; if (sz > 4) extraLen += sz + (sz & 1); }
  const headerLen = 8 + ifdSize + extraLen;
  const buf = new Uint8Array(headerLen + dataLen);
  const dv = new DataView(buf.buffer);
  buf[0] = 0x49; buf[1] = 0x49; dv.setUint16(2, 42, true); dv.setUint32(4, 8, true);
  let p = 8;
  dv.setUint16(p, entries.length, true); p += 2;
  let extra = 8 + ifdSize;
  for (const [tag, type, count, vals] of entries) {
    dv.setUint16(p, tag, true); dv.setUint16(p + 2, type, true); dv.setUint32(p + 4, count, true);
    const sz = typeSize(type) * count;
    let target = p + 8;
    if (sz > 4) { dv.setUint32(p + 8, extra, true); target = extra; extra += sz + (sz & 1); }
    const values = tag === 273 ? [headerLen] : vals;
    for (let i = 0; i < count; i++) {
      const v = (values as any)[i];
      if (type === SHORT) dv.setUint16(target + i * 2, v, true);
      else if (type === LONG) dv.setUint32(target + i * 4, v, true);
      else if (type === RATIONAL) { dv.setUint32(target, (values as number[])[0], true); dv.setUint32(target + 4, (values as number[])[1], true); break; }
      else buf[target + i] = v;
    }
    p += 12;
  }
  dv.setUint32(p, 0, true);
  buf.set(pixels.subarray(0, dataLen), headerLen);
  return buf;
}

/** BMP 32 bits con canal alfa (BITMAPV4HEADER). */
export function encodeBmp(rgba: Uint8ClampedArray, w: number, h: number, dpi: number): Uint8Array {
  const rowSize = w * 4;
  const dataSize = rowSize * h;
  const headerSize = 14 + 108;
  const buf = new Uint8Array(headerSize + dataSize);
  const dv = new DataView(buf.buffer);
  buf[0] = 0x42; buf[1] = 0x4d;
  dv.setUint32(2, buf.length, true); dv.setUint32(10, headerSize, true);
  dv.setUint32(14, 108, true); dv.setInt32(18, w, true); dv.setInt32(22, -h, true);
  dv.setUint16(26, 1, true); dv.setUint16(28, 32, true); dv.setUint32(30, 3, true); dv.setUint32(34, dataSize, true);
  const ppm = Math.round(dpi / 0.0254);
  dv.setInt32(38, ppm, true); dv.setInt32(42, ppm, true);
  dv.setUint32(54, 0x00ff0000, true); dv.setUint32(58, 0x0000ff00, true); dv.setUint32(62, 0x000000ff, true); dv.setUint32(66, 0xff000000, true);
  dv.setUint32(70, 0x73524742, true); // 'sRGB'
  let p = headerSize;
  for (let i = 0; i < rgba.length; i += 4) { buf[p++] = rgba[i + 2]; buf[p++] = rgba[i + 1]; buf[p++] = rgba[i]; buf[p++] = rgba[i + 3]; }
  return buf;
}
