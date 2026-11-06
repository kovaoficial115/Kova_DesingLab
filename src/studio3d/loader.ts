// Carga de GLB con Three.js. Todo este módulo se importa bajo demanda (no afecta al arranque).
// Admite modelos comprimidos con DRACO (decodificador servido por la propia app) y meshopt.

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

let loader: GLTFLoader | null = null;
function getLoader() {
  if (loader) return loader;
  const draco = new DRACOLoader();
  // ruta relativa a la página: funciona en GitHub Pages (subcarpeta) y en la app de escritorio
  draco.setDecoderPath(new URL('draco/', document.baseURI).href);
  draco.setDecoderConfig({ type: 'wasm' });
  loader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

export async function loadGlb(data: Blob | ArrayBuffer): Promise<GLTF> {
  const buf = data instanceof Blob ? await data.arrayBuffer() : data;
  return getLoader().parseAsync(buf, '');
}

/** Libera geometrías, materiales y texturas de un objeto (al cambiar de prenda o salir). */
export function disposeObject(root: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry?.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      if (!mat) continue;
      for (const v of Object.values(mat)) if (v && (v as THREE.Texture).isTexture) textures.add(v as THREE.Texture);
      mat.dispose();
    }
  });
  textures.forEach(t => { (t.image as ImageBitmap | undefined)?.close?.(); t.dispose(); });
}
