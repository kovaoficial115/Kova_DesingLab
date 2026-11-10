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
import { PrintLayer, printFrame, inkFrame, framePoint, surfacePolylines, type PreparedPrint, type PrintResult } from './prints';
import { basisFor, type ZoneDef } from './zones';
import { FrameGovernor, basePixelRatio, qualityScale, type QualityMode } from './quality';
import type { PrintZoneId, ZonePrint } from '../core/garment3d';
import type { Guide } from './placement';
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

/** Manipulación directa de los estampados sobre la prenda (la gestiona el estudio). */
export interface PrintInteraction {
  /** ¿se puede arrastrar? (no si está bloqueado) */
  canDrag(zone: PrintZoneId): boolean;
  select(zone: PrintZoneId): void;
  /** posición propuesta (fracciones de la zona, sin ajuste); `snap` = falso con Alt pulsado */
  drag(zone: PrintZoneId, x: number, y: number, snap: boolean): void;
  end(zone: PrintZoneId): void;
}

const ACCENT = 0xd21625;
const FLAT_FOV = 6, NORMAL_FOV = 30;

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
  // calidad
  private quality: QualityMode = 'adaptive';
  private gov = new FrameGovernor();
  private cssW = 1; private cssH = 1;
  private interacting = 0;
  private chained = false;
  private lastFrameAt = 0;
  // selección y arrastre de estampados
  private interaction: PrintInteraction | null = null;
  private overlay = new THREE.Group();
  private selected: ZoneDef | null = null;
  private guides: Guide[] = [];
  private lineMats = {
    zone: new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }),
    print: new THREE.LineBasicMaterial({ color: ACCENT }),
    guide: new THREE.LineBasicMaterial({ color: 0x38d9a9 }),
  };
  private drag: { zone: PrintZoneId; plane: THREE.Plane; basis: ReturnType<typeof basisFor>; start: [number, number]; from: [number, number]; size: [number, number]; pointer: number } | null = null;
  private hoverFrame = 0;
  private pendingApply = 0;
  private ray = new THREE.Raycaster();
  private flat = false;

  constructor(private container: HTMLElement, private events: ViewerEvents = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'studio-canvas';
    container.appendChild(this.canvas);
    this.canvas.addEventListener('webglcontextlost', this.onLost, false);
    this.canvas.addEventListener('webglcontextrestored', this.onRestored, false);
    this.initGl();
    this.overlay.renderOrder = 2;
    this.scene.add(this.pivot, this.lights, this.overlay);
    this.setLighting('studio');
    // en captura sobre el contenedor: decide antes que la órbita si el gesto es un arrastre de estampado
    container.addEventListener('pointerdown', this.onPointerDown, true);
    container.addEventListener('pointermove', this.onPointerMove, true);
    container.addEventListener('pointerup', this.onPointerUp, true);
    container.addEventListener('pointercancel', this.onPointerUp, true);
    this.canvas.addEventListener('dblclick', this.onDoubleClick);
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.visObs = new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; if (this.visible) this.invalidate(); });
    this.visObs.observe(container);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.resize();
  }

  private initGl() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.pixelRatio(false));
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
    this.interacting = 0; // un gesto que quedara a medias con el contexto anterior no cuenta
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.autoRotateSpeed = 1.5;
    this.controls.addEventListener('change', () => this.invalidate());
    this.controls.addEventListener('start', () => { this.tween = null; this.interacting++; });
    this.controls.addEventListener('end', () => { this.interacting = Math.max(0, this.interacting - 1); this.invalidate(); });
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
    if (this.controls.update()) moving = true; // inercia de la órbita o giro automático
    const active = moving || this.interacting > 0;
    this.setPixelRatio(this.pixelRatio(active));
    this.renderer.render(this.scene, this.camera);
    // duración de los fotogramas encadenados (no los que dicta el ratón) para el modo adaptativo
    if (this.chained && this.quality === 'adaptive' && this.lastFrameAt && this.gov.push(now - this.lastFrameAt)) this.setPixelRatio(this.pixelRatio(active));
    this.lastFrameAt = now;
    this.chained = moving;
    if (moving) this.invalidate();
  };

  private pixelRatio(active: boolean) {
    return basePixelRatio(window.devicePixelRatio || 1, this.cssW, this.cssH, this.quality) * qualityScale(this.quality, this.gov.level, active);
  }
  private setPixelRatio(pr: number) {
    if (Math.abs(this.renderer.getPixelRatio() - pr) < 1e-3) return;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.cssW, this.cssH, false);
  }

  /** Calidad del visor (resolución de dibujo). Los renders exportados no dependen de ella. */
  setQuality(m: QualityMode) {
    this.quality = m;
    this.gov.reset();
    this.setPixelRatio(this.pixelRatio(false));
    this.invalidate();
  }
  /** Resolución actual de dibujo (diagnóstico y pruebas). */
  get drawing() { return { pixelRatio: this.renderer.getPixelRatio(), level: this.gov.level, width: this.canvas.width, height: this.canvas.height }; }

  private resize() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    this.cssW = w; this.cssH = h;
    this.renderer.setPixelRatio(this.pixelRatio(false));
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
    this.applyLens();
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
    if (this.pendingApply) { cancelAnimationFrame(this.pendingApply); this.pendingApply = 0; }
    const r = this.printLayer.apply(list);
    this.refreshOverlay();
    this.invalidate();
    return r;
  }

  /** Cambia la colocación de un estampado ya aplicado sin pasar por el documento (arrastre en vivo). Una vez por fotograma. */
  previewPrint(zone: PrintZoneId, print: ZonePrint) {
    const i = this.prints.findIndex(p => p.zone.id === zone);
    if (i < 0) return;
    this.prints = this.prints.map((p, k) => (k === i ? { ...p, print } : p));
    if (this.pendingApply) return;
    this.pendingApply = requestAnimationFrame(() => {
      this.pendingApply = 0;
      this.printLayer?.apply(this.prints);
      this.refreshOverlay();
      this.invalidate();
    });
  }

  // ---------- selección: contorno del área y del estampado sobre la tela ----------

  /** Zona seleccionada (se dibuja su área de impresión y su estampado), o null. */
  setSelection(zone: ZoneDef | null) {
    this.selected = zone;
    this.refreshOverlay();
    this.invalidate();
  }
  /** Guías del ajuste magnético (cm de la zona seleccionada). */
  setGuides(g: Guide[]) {
    if (JSON.stringify(g) === JSON.stringify(this.guides)) return;
    this.guides = g;
    this.refreshOverlay();
    this.invalidate();
  }
  setInteraction(h: PrintInteraction | null) { this.interaction = h; }

  private refreshOverlay() {
    for (const c of [...this.overlay.children]) { this.overlay.remove(c); (c as THREE.LineSegments).geometry.dispose(); }
    const z = this.selected, layer = this.printLayer;
    if (!z || !layer) return;
    const proj = layer.projector(z);
    const zw = z.sizeCm[0] / 100, zh = z.sizeCm[1] / 100, zx = z.centerCm[0] / 100, zy = layer.top - z.centerCm[1] / 100;
    const X0 = zx - zw / 2, X1 = zx + zw / 2, Y0 = zy + zh / 2, Y1 = zy - zh / 2;
    const add = (lines: THREE.Vector3[][], mat: THREE.LineBasicMaterial, dashed = false) => {
      const pts: THREE.Vector3[] = [];
      for (const l of lines) for (let i = 0; i < l.length - 1; i++) if (!dashed || i % 2 === 0) pts.push(l[i], l[i + 1]);
      if (!pts.length) return;
      const seg = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), mat);
      seg.renderOrder = 2;
      seg.frustumCulled = false;
      this.overlay.add(seg);
    };
    // área de impresión: discontinua
    add(surfacePolylines(proj, [[X0, Y0], [X1, Y0], [X1, Y1], [X0, Y1]], true, 0.01), this.lineMats.zone, true);
    // estampado (solo la parte con tinta)
    const p = this.prints.find(q => q.zone.id === z.id);
    if (p) {
      const f = inkFrame(printFrame(p.zone, p.print, p.sizeM, layer.top), p.ink);
      add(surfacePolylines(proj, [framePoint(f, 0, 0), framePoint(f, 1, 0), framePoint(f, 1, 1), framePoint(f, 0, 1)], true, 0.006), this.lineMats.print);
    }
    for (const g of this.guides) {
      const line: [number, number][] = g.axis === 'x' ? [[X0 + g.at / 100, Y0], [X0 + g.at / 100, Y1]] : [[X0, Y0 - g.at / 100], [X1, Y0 - g.at / 100]];
      add(surfacePolylines(proj, line, false, 0.008), this.lineMats.guide);
    }
  }

  // ---------- arrastre directo de estampados ----------

  private rayAt(e: PointerEvent | MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    return this.ray.ray;
  }

  /** Estampado bajo el puntero (el más cercano), con el plano de su zona para arrastrarlo. */
  private pickPrint(e: PointerEvent | MouseEvent) {
    const layer = this.printLayer;
    if (!layer || !this.prints.length) return null;
    const ray = this.rayAt(e);
    let best: { p: PreparedPrint; plane: THREE.Plane; basis: ReturnType<typeof basisFor>; at: [number, number]; t: number } | null = null;
    for (const p of this.prints) {
      const basis = basisFor(p.zone.view);
      // solo si se ve de frente su cara (no se agarra la espalda a través de la prenda)
      if (ray.direction.dot(basis.toward) > -0.25) continue;
      const f = inkFrame(printFrame(p.zone, p.print, p.sizeM, layer.top), p.ink);
      const depth = layer.projector(p.zone).sample(f.cx, f.cy)?.depth;
      if (depth === undefined) continue;
      const plane = new THREE.Plane(basis.toward.clone(), -depth);
      const hit = ray.intersectPlane(plane, new THREE.Vector3());
      if (!hit) continue;
      const x = hit.dot(basis.right), y = hit.dot(basis.up);
      // dentro del rectángulo girado (con 1 cm de margen para agarrarlo mejor)
      const c = Math.cos(-f.angle), s = Math.sin(-f.angle), dx = x - f.cx, dy = y - f.cy;
      const lx = dx * c - dy * s, ly = dx * s + dy * c;
      if (Math.abs(lx) > f.w / 2 + 0.01 || Math.abs(ly) > f.h / 2 + 0.01) continue;
      const t = hit.distanceTo(ray.origin);
      if (!best || t < best.t) best = { p, plane, basis, at: [x, y], t };
    }
    return best;
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || !this.interaction || this.exporting) return;
    const hit = this.pickPrint(e);
    if (!hit) return;
    const zone = hit.p.zone.id;
    this.interaction.select(zone);
    if (!this.interaction.canDrag(zone)) return;
    // el gesto es nuestro: la órbita no lo recibe
    e.stopPropagation();
    e.preventDefault();
    this.canvas.setPointerCapture?.(e.pointerId);
    this.drag = { zone, plane: hit.plane, basis: hit.basis, start: hit.at, from: [hit.p.print.x, hit.p.print.y], size: [hit.p.zone.sizeCm[0] / 100, hit.p.zone.sizeCm[1] / 100], pointer: e.pointerId };
    this.interacting++;
    this.canvas.style.cursor = 'grabbing';
  };

  private onPointerMove = (e: PointerEvent) => {
    const d = this.drag;
    if (d && e.pointerId === d.pointer) {
      e.stopPropagation();
      const hit = this.rayAt(e).intersectPlane(d.plane, new THREE.Vector3());
      if (!hit) return;
      const dx = hit.dot(d.basis.right) - d.start[0], dy = hit.dot(d.basis.up) - d.start[1];
      // el plano tiene y hacia arriba; la zona, hacia abajo
      this.interaction?.drag(d.zone, d.from[0] + dx / d.size[0], d.from[1] - dy / d.size[1], !e.altKey);
      return;
    }
    if (e.buttons || !this.interaction || this.hoverFrame) return;
    // cursor de agarre sobre los estampados (como mucho una comprobación por fotograma)
    this.hoverFrame = requestAnimationFrame(() => {
      this.hoverFrame = 0;
      if (this.drag || this.disposed) return;
      const hit = this.pickPrint(e);
      this.canvas.style.cursor = hit && this.interaction?.canDrag(hit.p.zone.id) ? 'grab' : '';
    });
  };

  private onPointerUp = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointer) return;
    e.stopPropagation();
    this.drag = null;
    this.interacting = Math.max(0, this.interacting - 1);
    this.canvas.releasePointerCapture?.(e.pointerId);
    this.canvas.style.cursor = 'grab';
    this.setGuides([]);
    this.interaction?.end(d.zone);
    this.invalidate();
  };

  private onDoubleClick = (e: MouseEvent) => {
    if (this.pickPrint(e)) return; // doble clic sobre un estampado: solo selección
    this.fitView();
  };

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

  /** Encuadra la prenda desde la dirección actual (también deshace el desplazamiento lateral). */
  fitView() {
    const d = this.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.08;
    const dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-9) dir.set(0, 0, 1);
    this.controls.target.set(0, 0, 0);
    this.tween = { from: this.camera.position.clone(), to: dir.normalize().multiplyScalar(d), t0: performance.now() };
    this.invalidate();
  }

  /** Vista plana: teleobjetivo de 6° que casi elimina la perspectiva (para comprobar medidas y simetría). */
  setFlat(on: boolean) {
    if (on === this.flat) return;
    const k = Math.tan(THREE.MathUtils.degToRad((on ? NORMAL_FOV : FLAT_FOV) / 2)) / Math.tan(THREE.MathUtils.degToRad((on ? FLAT_FOV : NORMAL_FOV) / 2));
    this.flat = on;
    // misma prenda al mismo tamaño en pantalla: la cámara se aleja tanto como se cierra el ángulo
    const dir = this.camera.position.clone().sub(this.controls.target).multiplyScalar(k);
    this.tween = null;
    this.camera.position.copy(this.controls.target).add(dir);
    this.applyLens();
  }
  get isFlat() { return this.flat; }

  private applyLens() {
    const k = this.flat ? Math.sin(THREE.MathUtils.degToRad(NORMAL_FOV / 2)) / Math.sin(THREE.MathUtils.degToRad(FLAT_FOV / 2)) : 1;
    this.camera.fov = this.flat ? FLAT_FOV : NORMAL_FOV;
    this.camera.near = (this.radius / 100) * k; this.camera.far = this.radius * 100 * k;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = this.radius * 0.6 * k; this.controls.maxDistance = this.radius * 8 * k;
    this.invalidate();
  }

  /** Giro automático continuo (para presentar la prenda). Se detiene al pausar la pestaña. */
  setAutoRotate(on: boolean) { this.controls.autoRotate = on; this.invalidate(); }
  get autoRotating() { return this.controls.autoRotate; }

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
    this.overlay.visible = false; // el contorno de selección no sale en los renders
    cancelAnimationFrame(this.frame); this.frame = 0;
  }
  private endExport(off: OffscreenRenderer, boosted: boolean) {
    off.dispose();
    // el atlas vuelve a su tamaño normal (memoria)
    if (boosted && this.printLayer) this.printLayer.apply(this.prints);
    this.overlay.visible = true;
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
    cancelAnimationFrame(this.hoverFrame);
    cancelAnimationFrame(this.pendingApply);
    this.loadSeq++;
    this.container.removeEventListener('pointerdown', this.onPointerDown, true);
    this.container.removeEventListener('pointermove', this.onPointerMove, true);
    this.container.removeEventListener('pointerup', this.onPointerUp, true);
    this.container.removeEventListener('pointercancel', this.onPointerUp, true);
    this.canvas.removeEventListener('dblclick', this.onDoubleClick);
    this.interaction = null;
    this.selected = null;
    this.refreshOverlay();
    Object.values(this.lineMats).forEach(m => m.dispose());
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
