// Materiales de tela. La prenda imprimible pasa a un MeshPhysicalMaterial con brillo de tela
// (sheen) y un mapa normal de tejido generado aquí mismo (punto jersey, felpa o malla
// deportiva) que se repite a su tamaño real en cm sobre el despliegue UV, encima de los
// pliegues propios del modelo. Los estampados del atlas van en una capa aparte que el shader
// pone sobre la tela: cambiar el color o el acabado no repinta nada ni tiñe el diseño.

import * as THREE from 'three';

export type FabricPreset = 'cotton' | 'fleece' | 'polyester';
export type FabricFinish = 'plain' | 'heather' | 'washed';

export interface FabricDef {
  label: string;
  hint: string;
  roughness: number;
  sheen: number;
  sheenRoughness: number;
  normalScale: number;
  /** tamaño físico de una repetición del tejido, cm */
  tileCm: number;
  pattern: 'jersey' | 'fleece' | 'mesh';
}

export const FABRICS: Record<FabricPreset, FabricDef> = {
  cotton: { label: 'Algodón', hint: 'Punto jersey: camisetas', roughness: 0.88, sheen: 0.35, sheenRoughness: 0.6, normalScale: 0.6, tileCm: 1.6, pattern: 'jersey' },
  fleece: { label: 'Felpa', hint: 'Sudaderas y hoodies', roughness: 0.95, sheen: 0.7, sheenRoughness: 0.85, normalScale: 0.8, tileCm: 3, pattern: 'fleece' },
  polyester: { label: 'Poliéster', hint: 'Malla deportiva, más brillo', roughness: 0.5, sheen: 0.15, sheenRoughness: 0.4, normalScale: 0.7, tileCm: 1.2, pattern: 'mesh' },
};
export const FINISHES: Record<FabricFinish, string> = { plain: 'Liso', heather: 'Jaspeado', washed: 'Lavado' };

export const SWATCHES: { name: string; hex: string }[] = [
  { name: 'Blanco', hex: '#f4f2ee' }, { name: 'Crema', hex: '#f0e7de' }, { name: 'Arena', hex: '#d6c4a4' },
  { name: 'Gris', hex: '#9b9ca0' }, { name: 'Negro', hex: '#1d1d20' }, { name: 'Azul marino', hex: '#1f2a44' },
  { name: 'Rojo', hex: '#b3262e' }, { name: 'Verde militar', hex: '#4b5330' }, { name: 'Lila', hex: '#b7a6d6' },
];

export interface FabricSettings {
  /** #rrggbb; #ffffff = el color propio del modelo */
  color: string;
  preset: FabricPreset;
  roughness: number;
  /** relieve del tejido, multiplicador del mapa normal */
  normalScale: number;
  finish: FabricFinish;
}

export const isPreset = (v: unknown): v is FabricPreset => typeof v === 'string' && v in FABRICS;
export const isFinish = (v: unknown): v is FabricFinish => typeof v === 'string' && v in FINISHES;

export function defaultFabric(preset: FabricPreset = 'cotton'): FabricSettings {
  const d = FABRICS[preset];
  return { color: '#ffffff', preset, roughness: d.roughness, normalScale: d.normalScale, finish: 'plain' };
}

// ---------------- texturas de tejido (procedurales, repetibles) ----------------

const N = 256;

/** Ruido de valor repetible en un periodo de `p` celdas. */
function valueNoise(seed: number, p: number) {
  const rnd = new Float32Array(p * p);
  let s = seed >>> 0;
  for (let i = 0; i < rnd.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; rnd[i] = s / 4294967296; }
  const at = (x: number, y: number) => rnd[(((y % p) + p) % p) * p + (((x % p) + p) % p)];
  return (x: number, y: number) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
}

/** Altura del tejido (0..1) en una rejilla N×N repetible. */
export function fabricHeight(pattern: FabricDef['pattern']): Float32Array {
  const h = new Float32Array(N * N);
  if (pattern === 'jersey') {
    // punto jersey: columnas de «V», cada una formada por dos patas inclinadas
    const cells = 8, c = N / cells, fine = valueNoise(7, 64);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const lx = (x % c) / c - 0.5, ly = (y % c) / c - 0.5;
      let v = 0;
      for (const side of [-1, 1]) {
        // pata: elipse inclinada ±28° centrada a cada lado de la columna
        const ax = lx - side * 0.22, a = side * 0.49;
        const u = ax * Math.cos(a) - ly * Math.sin(a), w = ax * Math.sin(a) + ly * Math.cos(a);
        v = Math.max(v, Math.max(0, 1 - (u * u) / 0.03 - (w * w) / 0.2));
      }
      h[y * N + x] = Math.sqrt(v) * 0.9 + fine((x / N) * 64, (y / N) * 64) * 0.1;
    }
  } else if (pattern === 'fleece') {
    // felpa: pelusa suave a varias escalas
    const n1 = valueNoise(11, 8), n2 = valueNoise(23, 32), n3 = valueNoise(37, 128);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      h[y * N + x] = n1(u * 8, v * 8) * 0.45 + n2(u * 32, v * 32) * 0.35 + n3(u * 128, v * 128) * 0.2;
    }
  } else {
    // malla deportiva (ojo de pájaro): orificios en rejilla escalonada sobre un tejido fino
    const cells = 8, c = N / cells, fine = valueNoise(5, 64);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const row = Math.floor(y / c), ox = row % 2 ? c / 2 : 0;
      const lx = (((x + ox) % c) / c) - 0.5, ly = (y % c) / c - 0.5;
      const d = Math.hypot(lx, ly);
      const hole = d < 0.2 ? 0 : d < 0.3 ? (d - 0.2) / 0.1 : 1;
      h[y * N + x] = hole * 0.85 + fine((x / N) * 64, (y / N) * 64) * 0.15;
    }
  }
  return h;
}

/** Ruido de hebras para el jaspeado (vetas horizontales) y manchas grandes para el lavado. */
function fiberNoise(): Float32Array {
  const a = new Float32Array(N * N), streak = valueNoise(91, 128), blotch = valueNoise(57, 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    a[y * N + x] = streak(u * 16, v * 128) * 0.8 + blotch(u * 4, v * 4) * 0.2;
  }
  return a;
}

const cache = new Map<string, THREE.DataTexture>();
/** RGB = mapa normal del tejido (espacio tangente), A = ruido de hebras. Compartida entre prendas. */
export function fabricTexture(pattern: FabricDef['pattern']): THREE.DataTexture {
  let t = cache.get(pattern);
  if (t) return t;
  const h = fabricHeight(pattern), fib = fiberNoise(), data = new Uint8Array(N * N * 4), k = 2.2;
  const at = (x: number, y: number) => h[((y + N) % N) * N + ((x + N) % N)];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * k, dy = (at(x, y + 1) - at(x, y - 1)) * k;
    const l = Math.hypot(dx, dy, 1), i = (y * N + x) * 4;
    data[i] = Math.round(((-dx / l) * 0.5 + 0.5) * 255);
    data[i + 1] = Math.round(((dy / l) * 0.5 + 0.5) * 255);
    data[i + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
    data[i + 3] = Math.round(fib[y * N + x] * 255);
  }
  t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  cache.set(pattern, t);
  return t;
}
export function disposeFabricTextures() { cache.forEach(t => t.dispose()); }

// 1×1 transparente: capa de estampados vacía
let blank: THREE.DataTexture | null = null;
export const blankTexture = () => {
  if (!blank) { blank = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat); blank.needsUpdate = true; }
  return blank;
};

// ---------------- material ----------------

const WHITE = new THREE.Color(1, 1, 1);

export interface FabricUniforms {
  kDetailMap: { value: THREE.Texture };
  kDetailRepeat: { value: THREE.Vector2 };
  kDetailScale: { value: number };
  kHeather: { value: number };
  kWash: { value: number };
  kPrintMap: { value: THREE.Texture };
  kPrintOn: { value: number };
}

export type FabricMaterial = THREE.MeshPhysicalMaterial & { userData: { kovaFabric: FabricUniforms } };
export const isFabric = (m: unknown): m is FabricMaterial => !!(m as any)?.userData?.kovaFabric;

const HEADER = /* glsl */ `
uniform sampler2D kDetailMap;
uniform vec2 kDetailRepeat;
uniform float kDetailScale;
uniform float kHeather;
uniform float kWash;
uniform sampler2D kPrintMap;
uniform float kPrintOn;
// marco tangente a partir de derivadas: vale aunque el modelo no tenga tangentes ni mapa normal
mat3 kTangentFrame(vec3 eye, vec3 n, vec2 uv) {
  vec3 q0 = dFdx(eye), q1 = dFdy(eye);
  vec2 st0 = dFdx(uv), st1 = dFdy(uv);
  vec3 q1p = cross(q1, n), q0p = cross(n, q0);
  vec3 t = q1p * st0.x + q0p * st1.x, b = q1p * st0.y + q0p * st1.y;
  float d = max(dot(t, t), dot(b, b));
  float s = d == 0.0 ? 0.0 : inversesqrt(d);
  return mat3(t * s, b * s, n);
}
`;

const AFTER_MAP = /* glsl */ `
vec4 kFib = texture2D(kDetailMap, vUv * kDetailRepeat);
vec4 kBlot = texture2D(kDetailMap, vUv * kDetailRepeat * 0.07 + 0.31);
// jaspeado: hebras más claras y más oscuras
diffuseColor.rgb *= mix(1.0, 0.8 + 0.4 * kFib.a, kHeather);
// lavado: menos saturado y con manchas suaves
vec3 kGray = vec3(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)));
diffuseColor.rgb = mix(diffuseColor.rgb, mix(kGray, diffuseColor.rgb, 0.7) * (0.86 + 0.28 * kBlot.a), kWash);
// estampados del atlas (alfa premultiplicado): encima de la tela, sin teñirse con ella
vec4 kPrint = texture2D(kPrintMap, vUv) * kPrintOn;
diffuseColor.rgb = diffuseColor.rgb * (1.0 - kPrint.a) + kPrint.rgb;
`;

const AFTER_ROUGHNESS = /* glsl */ `
// la película DTF es algo más lisa que la tela
roughnessFactor = mix(roughnessFactor, 0.6, kPrint.a);
`;

const AFTER_NORMAL = /* glsl */ `
{
  vec3 kD = kFib.xyz * 2.0 - 1.0;
  kD.xy *= kDetailScale * (1.0 - 0.75 * kPrint.a);
  normal = normalize(kTangentFrame(-vViewPosition, normal, vUv) * kD);
}
`;

/** Convierte el material de la prenda en tela. `useBaseMap: false` descarta la textura de color del modelo. */
export function makeFabricMaterial(src: THREE.Material, useBaseMap = true): FabricMaterial {
  const m = new THREE.MeshPhysicalMaterial();
  if ((src as THREE.MeshStandardMaterial).isMeshStandardMaterial) THREE.MeshStandardMaterial.prototype.copy.call(m, src as THREE.MeshStandardMaterial);
  else if ((src as any).map) m.map = (src as any).map;
  m.defines = { STANDARD: '', PHYSICAL: '', USE_UV: '' };
  if (!useBaseMap && m.map) { m.map.dispose(); m.map = null; }
  m.metalness = 0;
  m.sheenColor = new THREE.Color(1, 1, 1);
  const u: FabricUniforms = {
    kDetailMap: { value: fabricTexture('jersey') },
    kDetailRepeat: { value: new THREE.Vector2(1, 1) },
    kDetailScale: { value: 0 },
    kHeather: { value: 0 },
    kWash: { value: 0 },
    kPrintMap: { value: blankTexture() },
    kPrintOn: { value: 0 },
  };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + HEADER)
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + AFTER_MAP)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + AFTER_ROUGHNESS)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + AFTER_NORMAL);
  };
  m.customProgramCacheKey = () => 'kova-fabric-1';
  m.userData.kovaFabric = u;
  m.name = (src.name || 'tela') + ' · tela';
  return m as FabricMaterial;
}

/** Aplica tipo de tela, color y acabado. `cmPerUv`: centímetros de tela por unidad UV. */
export function applyFabric(m: FabricMaterial, s: FabricSettings, cmPerUv: number) {
  const d = FABRICS[s.preset], u = m.userData.kovaFabric;
  m.color.set(s.color);
  // el brillo de la tela lleva el color de sus fibras (un brillo blanco la volvería pastel)
  m.sheenColor.copy(m.color).lerp(WHITE, 0.2);
  m.roughness = s.roughness;
  m.sheen = d.sheen;
  m.sheenRoughness = d.sheenRoughness;
  u.kDetailMap.value = fabricTexture(d.pattern);
  const rep = cmPerUv > 0 ? cmPerUv / d.tileCm : 1;
  u.kDetailRepeat.value.set(rep, rep);
  u.kDetailScale.value = s.normalScale;
  u.kHeather.value = s.finish === 'heather' ? 1 : 0;
  u.kWash.value = s.finish === 'washed' ? 1 : 0;
}

/** Centímetros de tela por unidad UV (relación de áreas 3D/UV de las mallas). */
export function cmPerUv(meshes: THREE.Mesh[]): number {
  let a3 = 0, a2 = 0;
  const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (const m of meshes) {
    const g = m.geometry, pos = g.attributes.position, uv = g.attributes.uv, idx = g.index;
    if (!uv) continue;
    m.updateWorldMatrix(true, false);
    const n = (idx?.count ?? pos.count) / 3;
    for (let f = 0; f < n; f++) {
      const ids = [0, 1, 2].map(k => (idx ? idx.getX(f * 3 + k) : f * 3 + k));
      ids.forEach((i, k) => p[k].fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld));
      a3 += e1.subVectors(p[1], p[0]).cross(e2.subVectors(p[2], p[0])).length() / 2;
      const [u0, v0, u1, v1, u2, v2] = [uv.getX(ids[0]), uv.getY(ids[0]), uv.getX(ids[1]), uv.getY(ids[1]), uv.getX(ids[2]), uv.getY(ids[2])];
      a2 += Math.abs((u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0)) / 2;
    }
  }
  return a2 > 0 ? Math.sqrt(a3 / a2) * 100 : 0;
}
