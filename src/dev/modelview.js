/* modelview.js — dev model viewer behind public/dev/models.html?m=<Name>[&small=1]:
 * loads /models/<Name>.glb (or /small/models/), frames it, turns it slowly, logs
 * triangle count + bounds to the page and to device.log. For eyeballing a squeezed model. */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { bootlog } from "../bootlog.js";
const q = new URLSearchParams(location.search), name = q.get("m") || "Fountain", small = q.has("small");
const url = `${small ? "/small" : ""}/models/${name}.glb`;
const out = document.getElementById("out");
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(1); document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x303848);
const cam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 500);
scene.add(new THREE.HemisphereLight(0xffffff, 0x404060, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(3, 6, 4); scene.add(sun);
scene.add(new THREE.GridHelper(10, 10, 0x667799, 0x445566));
let model = null;
new GLTFLoader().load(url, (g) => {
  model = g.scene; scene.add(model);
  let tris = 0; model.traverse((o) => { if (o.isMesh) { const i = o.geometry.index; tris += (i ? i.count : o.geometry.attributes.position.count) / 3; } });
  const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  model.position.sub(c); model.position.y += size.y / 2;   // on the grid, centred
  const r = Math.max(size.x, size.y, size.z);
  cam.position.set(r * 1.2, r * 0.9, r * 1.6); cam.lookAt(0, size.y / 2, 0);
  const info = { model: name, small, tris: Math.round(tris), size: [size.x, size.y, size.z].map((v) => +v.toFixed(2)) };
  out.textContent = JSON.stringify(info); bootlog("modelview", info);
  // ?shot=1 (headless checks): a second after the model is in, post the rendered frame to the dev sink
  if (q.has("shot")) setTimeout(() => fetch(`http://127.0.0.1:8899/png/${name}${small ? "-small" : ""}`, { method: "POST", body: renderer.domElement.toDataURL("image/png") }).catch(() => {}), 1200);
}, undefined, (e) => { out.textContent = "FAILED " + e; bootlog("modelview", { model: name, error: String(e) }); });
(function tick() { if (model) model.rotation.y += 0.004; renderer.render(scene, cam); requestAnimationFrame(tick); })();
