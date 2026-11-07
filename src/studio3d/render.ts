// Exportación de renders del Estudio 3D. Se dibuja en render targets fuera de pantalla (nunca
// se captura la ventana), por mosaicos para no pedir a la GPU un búfer enorme de una vez, con
// el mismo tono y espacio de color que el visor. El fondo puede quedar transparente.

import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/** Lados de la imagen exportada (px). 4096 es el máximo previsto para un M2 de 8 GB. */
export const RENDER_SIZES = [1080, 2048, 4096] as const;
export type RenderSize = (typeof RENDER_SIZES)[number];
export const MAX_RENDER = 4096;
/** lado máximo de cada mosaico */
const TILE = 2048;

export interface RenderLimits {
  maxTextureSize: number;
  maxRenderbufferSize: number;
  /** GB de memoria que declara el navegador (solo Chrome; se redondea y tiene tope en 8) */
  deviceMemoryGb?: number;
}

/** Ajusta la resolución pedida a lo que el equipo puede producir; `reason` explica la rebaja. */
export function resolveRenderSize(requested: number, l: RenderLimits): { side: number; reason?: string } {
  // los mosaicos esquivan el límite del búfer de dibujo; el de textura marca el techo
  let cap = Math.min(MAX_RENDER, l.maxTextureSize);
  let why = `la GPU admite como máximo ${l.maxTextureSize} px`;
  if (l.deviceMemoryGb !== undefined && l.deviceMemoryGb < 4 && cap > 2048) { cap = 2048; why = `el equipo declara ${l.deviceMemoryGb} GB de memoria`; }
  if (requested <= cap) return { side: requested };
  // el mayor tamaño estándar que cabe; si ni el menor cabe, el propio límite
  const side = [...RENDER_SIZES].reverse().find(s => s <= cap) ?? cap;
  return { side, reason: `Resolución reducida a ${side} px (pediste ${requested} px): ${why}.` };
}

/** Siguiente tamaño estándar por debajo (para reintentar si la GPU se queda sin memoria). */
export function smallerSize(side: number): number | null {
  return [...RENDER_SIZES].reverse().find(s => s < side) ?? null;
}

/** Lado de mosaico que admite la GPU. */
export const tileSide = (l: RenderLimits, max = TILE) => Math.max(256, Math.min(max, l.maxRenderbufferSize, l.maxTextureSize));

export interface Tile { x: number; y: number; w: number; h: number }
/** Divide W×H en mosaicos de como mucho `max` px por lado (x, y desde la esquina superior izquierda). */
export function tileGrid(W: number, H: number, max: number): Tile[] {
  const nx = Math.ceil(W / max), ny = Math.ceil(H / max);
  const tw = Math.ceil(W / nx), th = Math.ceil(H / ny);
  const out: Tile[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = i * tw, y = j * th;
    out.push({ x, y, w: Math.min(tw, W - x), h: Math.min(th, H - y) });
  }
  return out;
}

/** Copia un mosaico leído de la GPU (filas de abajo arriba) a la imagen final (filas de arriba abajo). */
export function blitTile(src: Uint8Array, t: Tile, dst: Uint8ClampedArray, W: number) {
  const row = t.w * 4;
  for (let r = 0; r < t.h; r++) {
    const from = (t.h - 1 - r) * row;
    dst.set(src.subarray(from, from + row), ((t.y + r) * W + t.x) * 4);
  }
}

/**
 * Distancia de cámara para que todos los `points` (relativos al centro que se mira) quepan
 * en el encuadre mirando desde `dir`, dejando `margin` (0..1) de aire en cada borde.
 */
export function fitDistance(points: THREE.Vector3[], dir: THREE.Vector3, fovDeg: number, aspect: number, margin = 0.08) {
  const d = dir.clone().normalize();
  const worldUp = Math.abs(d.y) > 0.99 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(worldUp, d).normalize();
  const up = new THREE.Vector3().crossVectors(d, right);
  const tanV = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2) * (1 - margin);
  const tanH = tanV * aspect;
  let dist = 0;
  for (const p of points) {
    const z = p.dot(d);
    dist = Math.max(dist, z + Math.abs(p.dot(up)) / tanV, z + Math.abs(p.dot(right)) / tanH);
  }
  return dist;
}

export const boxCorners = (b: THREE.Box3, center: THREE.Vector3) => {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < 8; i++) out.push(new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).sub(center));
  return out;
};

/** La GPU no pudo reservar memoria para el render. */
export class RenderMemoryError extends Error {
  constructor(msg = 'La GPU se quedó sin memoria para esta resolución.') { super(msg); this.name = 'RenderMemoryError'; }
}

// paso final: de color lineal premultiplicado a sRGB con el mismo tono que el visor; el fondo
// de color se mezcla aquí (como en el visor, el fondo no pasa por el mapeo de tono)
const outputShader = (tone: THREE.ToneMapping) => new THREE.RawShaderMaterial({
  uniforms: { tDiffuse: { value: null }, toneMappingExposure: { value: 1 }, bg: { value: new THREE.Color() }, bgOn: { value: 0 } },
  defines: { ...(tone === THREE.NeutralToneMapping ? { NEUTRAL_TONE_MAPPING: '' } : tone === THREE.ACESFilmicToneMapping ? { ACES_FILMIC_TONE_MAPPING: '' } : tone === THREE.AgXToneMapping ? { AGX_TONE_MAPPING: '' } : {}), SRGB_TRANSFER: '' },
  vertexShader: /* glsl */`
    precision highp float;
    uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix;
    attribute vec3 position; attribute vec2 uv;
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform vec3 bg;
    uniform float bgOn;
    #include <tonemapping_pars_fragment>
    #include <colorspace_pars_fragment>
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float a = clamp(c.a, 0.0, 1.0);
      // el antialias deja los bordes premultiplicados contra el negro transparente
      vec3 rgb = a > 0.0 ? c.rgb / a : vec3(0.0);
      #if defined( NEUTRAL_TONE_MAPPING )
        rgb = NeutralToneMapping(rgb);
      #elif defined( ACES_FILMIC_TONE_MAPPING )
        rgb = ACESFilmicToneMapping(rgb);
      #elif defined( AGX_TONE_MAPPING )
        rgb = AgXToneMapping(rgb);
      #endif
      vec4 o = sRGBTransferOETF(vec4(rgb, a));
      if (bgOn > 0.5) { o.rgb = mix(bg, o.rgb, a); o.a = 1.0; }
      gl_FragColor = o;
    }`,
  depthTest: false, depthWrite: false,
});

export interface RenderOptions {
  /** color sRGB (#rrggbb) o null para fondo transparente */
  background: string | null;
  /** lado máximo de mosaico (pruebas) */
  tile?: number;
}

/**
 * Render fuera de pantalla reutilizable (una imagen o los fotogramas de un video). Reserva sus
 * render targets al primer uso y los libera en `dispose()`; deja el renderer como estaba.
 */
export class OffscreenRenderer {
  private ms: THREE.WebGLRenderTarget | null = null;
  private out: THREE.WebGLRenderTarget | null = null;
  private quad: FullScreenQuad;
  private material: THREE.RawShaderMaterial;
  private buf = new Uint8Array(0);

  constructor(private renderer: THREE.WebGLRenderer) {
    this.material = outputShader(renderer.toneMapping);
    this.quad = new FullScreenQuad(this.material);
  }

  static limits(renderer: THREE.WebGLRenderer): RenderLimits {
    const gl = renderer.getContext();
    const mem = (navigator as { deviceMemory?: number }).deviceMemory;
    return { maxTextureSize: renderer.capabilities.maxTextureSize, maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number, ...(typeof mem === 'number' ? { deviceMemoryGb: mem } : {}) };
  }

  private targets(w: number, h: number) {
    if (!this.ms) {
      const ext = this.renderer.extensions;
      // HDR lineal mientras se dibuja (sin bandas en las sombras); 8 bits si la GPU no puede
      const half = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float');
      const samples = Math.min(4, this.renderer.capabilities.maxSamples || 0);
      this.ms = new THREE.WebGLRenderTarget(w, h, { type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, samples, depthBuffer: true });
      this.out = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, depthBuffer: false });
    }
    this.ms.setSize(w, h);
    this.out!.setSize(w, h);
    return { ms: this.ms, out: this.out! };
  }

  /** Dibuja `scene` vista por `camera` en una imagen W×H (sRGB, alfa sin premultiplicar). */
  async render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, W: number, H: number, o: RenderOptions): Promise<ImageData> {
    const r = this.renderer, gl = r.getContext();
    const data = new Uint8ClampedArray(W * H * 4);
    const prev = { target: r.getRenderTarget(), color: r.getClearColor(new THREE.Color()), alpha: r.getClearAlpha(), bg: scene.background, autoClear: r.autoClear };
    const cam = camera.clone();
    cam.aspect = W / H;
    const u = this.material.uniforms;
    u.toneMappingExposure.value = r.toneMappingExposure;
    u.bgOn.value = o.background ? 1 : 0;
    if (o.background) (u.bg.value as THREE.Color).set(o.background).convertLinearToSRGB();
    try {
      scene.background = null;
      r.setClearColor(0x000000, 0);
      r.autoClear = true;
      while (gl.getError() !== gl.NO_ERROR) { /* limpia errores anteriores */ }
      for (const t of tileGrid(W, H, tileSide(OffscreenRenderer.limits(r), o.tile))) {
        cam.setViewOffset(W, H, t.x, t.y, t.w, t.h);
        cam.updateProjectionMatrix();
        const { ms, out } = this.targets(t.w, t.h);
        r.setRenderTarget(ms);
        r.render(scene, cam);
        u.tDiffuse.value = ms.texture;
        r.setRenderTarget(out);
        this.quad.render(r);
        if (gl.isContextLost()) throw new Error('Se perdió el contexto WebGL durante la exportación.');
        if (gl.getError() === gl.OUT_OF_MEMORY) throw new RenderMemoryError();
        if (this.buf.length < t.w * t.h * 4) this.buf = new Uint8Array(t.w * t.h * 4);
        const px = this.buf.subarray(0, t.w * t.h * 4);
        // lectura asíncrona (WebGL 2): no congela la interfaz mientras la GPU termina
        if (r.readRenderTargetPixelsAsync) await r.readRenderTargetPixelsAsync(out, 0, 0, t.w, t.h, px);
        else r.readRenderTargetPixels(out, 0, 0, t.w, t.h, px);
        blitTile(px, t, data, W);
      }
    } finally {
      u.tDiffuse.value = null;
      r.setRenderTarget(prev.target);
      r.setClearColor(prev.color, prev.alpha);
      r.autoClear = prev.autoClear;
      scene.background = prev.bg;
    }
    return new ImageData(data, W, H);
  }

  dispose() {
    this.ms?.dispose(); this.out?.dispose();
    this.ms = this.out = null;
    this.quad.dispose();
    this.material.dispose();
    this.buf = new Uint8Array(0);
  }
}

/** Codifica una imagen como PNG (conserva la transparencia). */
export async function encodePng(img: ImageData): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  // sin lienzo o sin PNG = el navegador no tiene memoria para ese tamaño: se reintenta más pequeño
  if (!g) throw new RenderMemoryError(`El navegador no pudo crear un lienzo de ${img.width} px.`);
  g.putImageData(img, 0, 0);
  const blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/png'));
  c.width = c.height = 0; // libera la memoria del lienzo enseguida (Safari la retiene)
  if (!blob) throw new RenderMemoryError('No se pudo codificar el PNG.');
  return blob;
}

// ---------------- video giratorio ----------------

/** Formatos de video en orden de preferencia: MP4 se abre en QuickTime y en redes; WebM si no hay MP4. */
const VIDEO_TYPES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
export function videoFormat(isSupported: (t: string) => boolean = t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) {
  const mime = VIDEO_TYPES.find(isSupported);
  return mime ? { mime, ext: mime.startsWith('video/mp4') ? 'mp4' : 'webm' } : null;
}

export interface TurntableOptions {
  size: number;
  seconds: number;
  fps?: number;
  background: string;
  /** gira la escena el ángulo dado (radianes) antes de dibujar el fotograma */
  pose: (angle: number) => void;
  onProgress?: (k: number) => void;
  signal?: AbortSignal;
}

/**
 * Graba una vuelta completa. Cada fotograma se dibuja fuera de pantalla y se pasa a un lienzo
 * que no está en la página; MediaRecorder lo codifica en tiempo real.
 */
export async function recordTurntable(off: OffscreenRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, o: TurntableOptions) {
  const fmt = videoFormat();
  if (!fmt) throw new Error('Este navegador no puede grabar video.');
  const fps = o.fps ?? 30, frames = Math.round(o.seconds * fps);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = o.size;
  const g = canvas.getContext('2d')!;
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  const manual = typeof track.requestFrame === 'function';
  if (!manual) { track.stop(); }
  const live = manual ? stream : canvas.captureStream(fps);
  const rec = new MediaRecorder(live, { mimeType: fmt.mime, videoBitsPerSecond: Math.round(8e6 * (o.size / 1080) ** 2) });
  const chunks: Blob[] = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<void>((res, rej) => { rec.onstop = () => res(); rec.onerror = e => rej((e as unknown as { error?: Error }).error ?? new Error('Falló la grabación.')); });
  try {
    // primer fotograma antes de empezar: el video no arranca en negro
    o.pose(0);
    g.putImageData(await off.render(scene, camera, o.size, o.size, { background: o.background }), 0, 0);
    rec.start();
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      if (o.signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
      o.pose((i / frames) * Math.PI * 2);
      g.putImageData(await off.render(scene, camera, o.size, o.size, { background: o.background }), 0, 0);
      if (manual) track.requestFrame!();
      o.onProgress?.((i + 1) / frames);
      // el grabador marca el tiempo con el reloj: se mantiene el ritmo de fps
      const wait = t0 + ((i + 1) * 1000) / fps - performance.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
    }
    rec.stop();
    await done;
  } finally {
    if (rec.state !== 'inactive') rec.stop();
    live.getTracks().forEach(t => t.stop());
    canvas.width = canvas.height = 0;
  }
  return { blob: new Blob(chunks, { type: fmt.mime.split(';')[0] }), ext: fmt.ext };
}
