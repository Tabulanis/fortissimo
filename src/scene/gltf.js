/* gltf.js — ONE model loader for the whole game (10-09 speed pass). Every GLTFLoader here can read GPU-compressed KTX2 textures
   (public/ktx/, tools/make-ktx-assets.sh): the transcoder (public/basis/) turns them into whatever the device's chip speaks —
   ASTC/ETC on phones, BC on PCs — and they stay compressed in GPU memory.
     initModelLoader(renderer) once, from stage3d; then gltfLoader() wherever `new GLTFLoader()` was. */
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { bootlog } from "../bootlog.js";
import { withBase } from "../base.js";

let ktx2 = null;
export function initModelLoader(renderer) {
  if (ktx2) return;
  ktx2 = new KTX2Loader().setTranscoderPath(withBase("/basis/")).detectSupport(renderer);
}
export function gltfLoader() {
  const l = new GLTFLoader();
  if (ktx2) l.setKTX2Loader(ktx2);
  // every model reports how long it took (10-09: in Chrome-type browsers the compressed copies came in late — the phone's log says how late)
  const load = l.load.bind(l);
  l.load = (url, onLoad, onProgress, onError) => { const t = performance.now();
    return load(url, (g) => { bootlog("model", { url: url.split("/").pop(), ms: Math.round(performance.now() - t), ktx: !!ktx2 }); onLoad && onLoad(g); }, onProgress,
      (e) => { bootlog("model failed", { url, error: String(e && e.message || e) }); onError && onError(e); }); };
  return l;
}
