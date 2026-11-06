// Visor 3D: una sola escena viva. Dibuja solo cuando algo cambia y el visor es visible,
// libera la memoria de la prenda anterior y sobrevive a la pérdida del contexto WebGL
// (el trabajo no vive en la GPU: se reconstruye desde el modelo y los ajustes guardados).

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { loadGlb, disposeObject } from './loader';
import type { GarmentConfig } from './config';
import { isPrintable } from './validate';
import { PrintLayer, type PreparedPrint, type PrintResult } from './prints';

export type ViewPreset = 'front' | 'back' | 'left' | 'right' | 'threeQuarter';
export type LightPreset = 'studio' | 'soft' | 'contrast';
export const VIEW_LABELS: Record<ViewPreset, string> = { front: 'Frontal', back: 'Trasera', left: 'Izquierda', right: 'Derecha', threeQuarter: '¾' };
export const LIGHT_LABELS: Record<LightPreset, string> = { studio: 'Estudio', soft: 'Suave', contrast: 'Contraste' };

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
    if (!this.visible || document.hidden || this.disposed) return;
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
    this.printLayer = new PrintLayer(this.scene, printable, this.renderer);
    this.prints = [];
    this.setView('front', false);
    return model;
  }

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
    this.controls.dispose();
    this.envTex?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.source = null;
  }
}
