// Visor 3D: una sola escena viva. Dibuja solo cuando algo cambia y el visor es visible,
// libera la memoria de la prenda anterior y sobrevive a la pérdida del contexto WebGL
// (el trabajo no vive en la GPU: se reconstruye desde el modelo y los ajustes guardados).

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { loadGlb, disposeObject } from './loader';
import { fabricOf, type GarmentConfig } from './config';
import { makeFabricMaterial, applyFabric, cmPerUv, defaultFabric, disposeFabricTextures, type FabricMaterial, type FabricSettings } from './fabric';
import { isPrintable } from './validate';
import { PrintLayer, type PreparedPrint, type PrintResult } from './prints';
import { OffscreenRenderer, RenderMemoryError, resolveRenderSize, smallerSize, fitDistance, boxCorners, encodePng, recordTurntable, type RenderLimits } from './render';

export type ExportView = ViewPreset | 'current';
export interface ImageExport { size: number; view: ExportView; background: string | null }
export interface ImageResult { blob: Blob; side: number; warnings: string[] }
export interface VideoExport { size: number; seconds: number; background: string; onProgress?: (k: number) => void; signal?: AbortSignal }

export type ViewPreset = 'front' | 'back' | 'left' | 'right' | 'threeQuarter';
export type LightPreset = 'studio' | 'soft' | 'contrast';
export const VIEW_LABELS: Record<ViewPreset, string> = { front: 'Frontal', back: 'Trasera', left: 'Izquierda', right: 'Derecha', threeQuarter: '¾' };
export const LIGHT_LABELS: Record<LightPreset, string> = { studio: 'Estudio', soft: 'Suave', contrast: 'Contraste' };

// exposición calibrada por iluminación: la tela blanca queda en ~232/255 y los colores impresos
// cerca de su valor sRGB (sin ella los estampados salían aclarados y menos saturados)
const EXPOSURE: Record<LightPreset, number> = { studio: 0.55, soft: 0.45, contrast: 0.85 };

const VIEW_DIR: Record<ViewPreset, [number, number, number]> = {
  front: [0, 0.08, 1], back: [0, 0.08, -1], left: [-1, 0.08, 0], right: [1, 0.08, 0], threeQuarter: [0.7, 0.18, 0.7],
};

export interface ViewerEvents {
  onContextLost?: () => void;
  onContextRestored?: () => void;
  onError?: (e: unknown) => void;
}

export class GarmentViewer {
  readonly canvas: HTMLCanvasElement;
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  private controls!: OrbitControls;
  private pivot = new THREE.Group();          // centra y escala el modelo
  private lights = new THREE.Group();
  private model: THREE.Object3D | null = null;
  private envTex: THREE.Texture | null = null;
  private source: { data: Blob | ArrayBuffer; config: GarmentConfig } | null = null;
  private radius = 0.5;
  private frame = 0;
  private visible = true;
  private tween: { from: THREE.Vector3; to: THREE.Vector3; t0: number } | null = null;
  private light: LightPreset = 'studio';
  private background: string | null = null;
  private resizeObs: ResizeObserver;
  private visObs: IntersectionObserver;
  private disposed = false;
  private loadSeq = 0;
  private printLayer: PrintLayer | null = null;
  private prints: PreparedPrint[] = [];
  private fabrics: FabricMaterial[] = [];
  private fabric: FabricSettings | null = null;
  private uvCm = 0;
  private exporting = false;

  constructor(private container: HTMLElement, private events: ViewerEvents = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'studio-canvas';
    container.appendChild(this.canvas);
    this.canvas.addEventListener('webglcontextlost', this.onLost, false);
    this.canvas.addEventListener('webglcontextrestored', this.onRestored, false);
    this.initGl();
    this.scene.add(this.pivot, this.lights);
    this.setLighting('studio');
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.visObs = new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; if (this.visible) this.invalidate(); });
    this.visObs.observe(container);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.resize();
  }

  private initGl() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // tono neutro: no altera el color de la tela
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.envTex = pmrem.fromScene(room, 0.04).texture;
    room.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
    pmrem.dispose();
    this.scene.environment = this.envTex;
    this.controls?.dispose();
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener('change', () => this.invalidate());
    this.controls.addEventListener('start', () => { this.tween = null; });
    this.applyBackground();
  }

  /** Pide un fotograma (como mucho uno por refresco de pantalla). */
  invalidate = () => {
    if (this.frame || this.disposed) return;
    this.frame = requestAnimationFrame(this.render);
  };

  private render = (now: number) => {
    this.frame = 0;
    // durante una exportación la escena puede estar girada para el video: no se dibuja en pantalla
    if (!this.visible || document.hidden || this.disposed || this.exporting) return;
    let moving = false;
    if (this.tween) {
      const k = Math.min(1, (now - this.tween.t0) / 350), e = 1 - Math.pow(1 - k, 3);
      this.camera.position.lerpVectors(this.tween.from, this.tween.to, e);
      if (k >= 1) this.tween = null; else moving = true;
    }
    if (this.controls.update()) moving = true; // inercia de la órbita
    this.renderer.render(this.scene, this.camera);
    if (moving) this.invalidate();
  };

  private resize() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  private onVisibility = () => { if (!document.hidden) this.invalidate(); };

  /** Carga una prenda; libera la anterior. Devuelve el objeto ya centrado y a escala. */
  async setGarment(data: Blob | ArrayBuffer, config: GarmentConfig) {
    const seq = ++this.loadSeq;
    const gltf = await loadGlb(data);
    if (seq !== this.loadSeq || this.disposed) { disposeObject(gltf.scene); return null; } // llegó otra más nueva
    this.clearModel();
    this.source = { data, config };
    const model = gltf.scene;
    this.pivot.scale.setScalar(config.unitScale);
    this.pivot.add(model);
    // centrar automáticamente: el origen de los modelos descargados suele estar desplazado
    this.pivot.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const c = box.getCenter(new THREE.Vector3());
    model.position.sub(this.pivot.worldToLocal(c.clone()));
    this.pivot.updateMatrixWorld(true);
    const sphere = new THREE.Box3().setFromObject(this.pivot).getBoundingSphere(new THREE.Sphere());
    this.radius = sphere.radius || 0.5;
    this.camera.near = this.radius / 100; this.camera.far = this.radius * 100; this.camera.updateProjectionMatrix();
    this.controls.minDistance = this.radius * 0.6; this.controls.maxDistance = this.radius * 8;
    this.model = model;
    const printable: THREE.Mesh[] = [];
    model.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && isPrintable(m, config)) printable.push(m); });
    this.pivot.updateMatrixWorld(true);
    // la prenda pasa a material de tela (un material por material original, compartido igual que antes)
    const converted = new Map<THREE.Material, FabricMaterial>();
    const toFabric = (src: THREE.Material) => {
      let f = converted.get(src);
      if (!f) { f = makeFabricMaterial(src, config.useBaseColorMap !== false); converted.set(src, f); }
      return f;
    };
    for (const m of printable) m.material = Array.isArray(m.material) ? m.material.map(toFabric) : toFabric(m.material);
    converted.forEach((_f, src) => src.dispose()); // sus texturas siguen en uso por la tela
    this.fabrics = [...converted.values()];
    this.uvCm = cmPerUv(printable);
    this.applyFabric(this.fabric ?? defaultFabric(fabricOf(config)));
    this.printLayer = new PrintLayer(this.scene, printable, this.renderer);
    this.prints = [];
    this.setView('front', false);
    return model;
  }

  /** Tela, color y acabado de la prenda (se conserva al cambiar de prenda y al recuperar el contexto). */
  setFabric(s: FabricSettings) {
    this.fabric = s;
    this.applyFabric(s);
  }
  private applyFabric(s: FabricSettings) {
    for (const f of this.fabrics) applyFabric(f, s, this.uvCm);
    this.invalidate();
  }
  /** Centímetros de tela por unidad UV de la prenda cargada (diagnóstico). */
  get cmPerUv() { return this.uvCm; }

  /** Aplica los estampados por zona (sustituye a los anteriores). */
  setPrints(list: PreparedPrint[]): PrintResult[] {
    this.prints = list;
    if (!this.printLayer) return [];
    const r = this.printLayer.apply(list);
    this.invalidate();
    return r;
  }

  private clearModel() {
    this.printLayer?.dispose();
    this.printLayer = null;
    this.fabrics = [];
    if (!this.model) return;
    this.pivot.remove(this.model);
    disposeObject(this.model);
    this.model = null;
    this.renderer.renderLists.dispose();
  }

  /** Vistas predefinidas con centrado automático. */
  setView(v: ViewPreset, animate = true) {
    const d = this.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.08;
    const to = new THREE.Vector3(...VIEW_DIR[v]).normalize().multiplyScalar(d);
    this.controls.target.set(0, 0, 0);
    if (animate) this.tween = { from: this.camera.position.clone(), to, t0: performance.now() };
    else { this.tween = null; this.camera.position.copy(to); }
    this.camera.lookAt(0, 0, 0);
    this.invalidate();
  }

  setLighting(p: LightPreset) {
    this.light = p;
    this.lights.clear();
    const key = new THREE.DirectionalLight(0xffffff, p === 'contrast' ? 2.6 : p === 'studio' ? 1.4 : 0);
    key.position.set(2, 3, 2.5);
    const rim = new THREE.DirectionalLight(0xffffff, p === 'contrast' ? 1.6 : p === 'studio' ? 0.5 : 0);
    rim.position.set(-2.5, 1.5, -2);
    this.lights.add(key, rim);
    this.scene.environmentIntensity = p === 'soft' ? 1.25 : p === 'studio' ? 0.85 : 0.35;
    this.renderer.toneMappingExposure = EXPOSURE[p];
    this.invalidate();
  }

  /** Color de fondo, o null para fondo transparente. */
  setBackground(color: string | null) {
    this.background = color;
    this.applyBackground();
    this.invalidate();
  }
  private applyBackground() {
    if (this.background) { this.scene.background = new THREE.Color(this.background); this.renderer.setClearColor(this.background, 1); }
    else { this.scene.background = null; this.renderer.setClearColor(0x000000, 0); }
  }

  // ---------- exportación de renders ----------

  /** Límites de la GPU para elegir la resolución de exportación. */
  renderLimits(): RenderLimits { return OffscreenRenderer.limits(this.renderer); }

  /** Cámara de exportación: la vista actual o una predefinida encuadrada a la prenda (para todos los `dirs`). */
  private exportCamera(view: ExportView, aspect: number, dirs?: THREE.Vector3[]) {
    const cam = new THREE.PerspectiveCamera(this.camera.fov, aspect, this.camera.near, this.camera.far);
    const box = new THREE.Box3().setFromObject(this.pivot);
    const c = box.getCenter(new THREE.Vector3());
    if (view === 'current') {
      cam.position.copy(this.camera.position);
      cam.quaternion.copy(this.camera.quaternion);
    } else {
      const dir = new THREE.Vector3(...VIEW_DIR[view]).normalize();
      // la silueta real encuadra mucho más ajustado que la caja (las esquinas de la caja están vacías)
      const pts = this.silhouette(c);
      const corners = pts.length ? pts : boxCorners(box, c);
      const dist = Math.max(...(dirs ?? [dir]).map(d => fitDistance(corners, d, cam.fov, aspect)));
      cam.position.copy(c).addScaledVector(dir, dist);
      cam.lookAt(c);
    }
    cam.updateMatrixWorld();
    return { cam, center: c };
  }

  /** Hasta ~4000 vértices de la prenda en coordenadas del mundo, relativos a `center`. */
  private silhouette(center: THREE.Vector3) {
    const meshes: THREE.Mesh[] = [];
    this.model?.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    const total = meshes.reduce((a, m) => a + (m.geometry.attributes.position?.count ?? 0), 0);
    const step = Math.max(1, Math.ceil(total / 4000));
    const out: THREE.Vector3[] = [];
    for (const m of meshes) {
      const p = m.geometry.attributes.position;
      if (!p) continue;
      for (let i = 0; i < p.count; i += step) out.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld).sub(center));
    }
    return out;
  }

  private beginExport() {
    if (!this.model) throw new Error('No hay ninguna prenda cargada.');
    if (this.exporting) throw new Error('Ya hay una exportación en curso.');
    if (this.renderer.getContext().isContextLost()) throw new Error('El visor 3D se está recuperando; inténtalo en unos segundos.');
    this.exporting = true;
    cancelAnimationFrame(this.frame); this.frame = 0;
  }
  private endExport(off: OffscreenRenderer, boosted: boolean) {
    off.dispose();
    // el atlas vuelve a su tamaño normal (memoria)
    if (boosted && this.printLayer) this.printLayer.apply(this.prints);
    this.exporting = false;
    this.invalidate();
  }

  /** Render PNG cuadrado fuera de pantalla. Si el equipo no llega a la resolución pedida, la baja y lo avisa. */
  async exportImage(o: ImageExport): Promise<ImageResult> {
    this.beginExport();
    const off = new OffscreenRenderer(this.renderer);
    const warnings: string[] = [];
    let boosted = false;
    try {
      const r = resolveRenderSize(o.size, this.renderLimits());
      if (r.reason) warnings.push(r.reason);
      let side = r.side;
      // a partir de 2048 px el atlas normal (~15 px/cm) se vería blando: se pinta a 4096 solo para el render
      if (side >= 2048 && this.printLayer && this.prints.length) { this.printLayer.apply(this.prints, { atlas: 4096 }); boosted = true; }
      const { cam } = this.exportCamera(o.view, 1);
      for (;;) {
        try {
          const img = await off.render(this.scene, cam, side, side, { background: o.background });
          return { blob: await encodePng(img), side, warnings };
        } catch (e) {
          const next = e instanceof RenderMemoryError ? smallerSize(side) : null;
          if (!next) throw e;
          warnings.push(`${(e as Error).message} Se exportó a ${next} px en lugar de ${side} px.`);
          side = next;
        }
      }
    } finally { this.endExport(off, boosted); }
  }

  /** Video de una vuelta completa (MP4 o WebM según el navegador), con fondo de color. */
  async exportTurntable(o: VideoExport) {
    this.beginExport();
    const off = new OffscreenRenderer(this.renderer);
    const lightsY = this.lights.rotation.y, envY = this.scene.environmentRotation.y;
    try {
      const r = resolveRenderSize(o.size, this.renderLimits());
      // encuadre que sirve para toda la vuelta (las mangas abiertas ocupan más de perfil)
      const dirs = Array.from({ length: 16 }, (_, i) => new THREE.Vector3(...VIEW_DIR.front).applyAxisAngle(new THREE.Vector3(0, 1, 0), (i / 16) * Math.PI * 2));
      const { cam, center } = this.exportCamera('front', 1, dirs);
      const start = cam.position.clone().sub(center), Y = new THREE.Vector3(0, 1, 0);
      // girar cámara, luces y entorno juntos equivale a girar la prenda (y sus calcomanías) delante de ellos
      const pose = (a: number) => {
        cam.position.copy(start).applyAxisAngle(Y, a).add(center);
        cam.lookAt(center);
        this.lights.rotation.y = lightsY + a;
        this.scene.environmentRotation.y = envY + a;
      };
      const video = await recordTurntable(off, this.scene, cam, { size: r.side, seconds: o.seconds, background: o.background, pose, onProgress: o.onProgress, signal: o.signal });
      return { ...video, side: r.side, warnings: r.reason ? [r.reason] : [] };
    } finally {
      this.lights.rotation.y = lightsY;
      this.scene.environmentRotation.y = envY;
      this.endExport(off, false);
    }
  }

  /** Datos para pruebas y diagnóstico. */
  stats() {
    const m = this.renderer.info.memory;
    return { geometries: m.geometries, textures: m.textures, programs: this.renderer.info.programs?.length ?? 0, calls: this.renderer.info.render.calls };
  }

  // ---------- pérdida de contexto WebGL ----------
  private onLost = (e: Event) => {
    e.preventDefault(); // permite que el navegador lo restaure
    cancelAnimationFrame(this.frame); this.frame = 0;
    this.events.onContextLost?.();
  };
  private onRestored = async () => {
    try {
      const src = this.source, prints = this.prints, view = this.camera.position.clone(), target = this.controls.target.clone();
      // los recursos de la GPU se perdieron: se rehace todo desde el modelo y los ajustes
      this.clearModel();
      this.envTex?.dispose();
      this.renderer.dispose();
      this.initGl();
      this.setLighting(this.light);
      if (src) { await this.setGarment(src.data, src.config); if (prints.length) this.setPrints(prints); }
      this.camera.position.copy(view); this.controls.target.copy(target); this.controls.update();
      this.resize();
      this.events.onContextRestored?.();
    } catch (err) { this.events.onError?.(err); }
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.loadSeq++;
    this.resizeObs.disconnect();
    this.visObs.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.clearModel();
    disposeFabricTextures();
    this.controls.dispose();
    this.envTex?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.source = null;
  }
}
