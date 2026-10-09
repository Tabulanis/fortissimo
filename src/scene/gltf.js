/* gltf.js — ONE model loader for the whole game (10-09 speed pass). Every GLTFLoader here can read GPU-compressed KTX2 textures
   (public/ktx/, tools/make-ktx-assets.sh): the transcoder (public/basis/) turns them into whatever the device's chip speaks —
   ASTC/ETC on phones, BC on PCs — and they stay compressed in GPU memory.
     initModelLoader(renderer) once, from stage3d; then gltfLoader() wherever `new GLTFLoader()` was. */
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

let ktx2 = null;
export function initModelLoader(renderer) {
  if (ktx2) return;
  ktx2 = new KTX2Loader().setTranscoderPath("/basis/").detectSupport(renderer);
}
export function gltfLoader() {
  const l = new GLTFLoader();
  if (ktx2) l.setKTX2Loader(ktx2);
  return l;
}
