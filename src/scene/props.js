/* props.js — scenery the dev editor ADDS from its palette (owner, 2026-10-07: "an add-object ability
   and a palette of the level's objects"). A prop is a model from public/models (or "brazier", a fire
   basin) on a pivot at its base centre, sized to a sensible default, registered as editable under an
   id "add#N". Added props live in the same layout file as the edits (public/levels/edits.json) with
   an extra field: { add: "Cliffs", p, q, s }, and are rebuilt on every load by spawnSaved().
     createProps(scene, { braziers }) -> { spawn(kind, at, id?), spawnSaved(edits), remove(obj), kinds() } */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { register, unregister, isRegistered } from "./editables.js";

// how big a fresh one comes in (metres): his models are exported ~2 m across, so they need a size
const FIT = { Gate: { width: 5.2 }, Fountain: { width: 4.6 }, Cliffs: { height: 9 }, Ruins: { height: 16 }, Pillar: { height: 6.3 }, Bdrum: { height: 1 },
  NewDock: { width: 23 }, AncientShip: { width: 16 } };   // (10-08: his dock + ship, at the sizes the cove uses)
// rigged characters would stand frozen in their bind pose — not scenery
export const NOT_PROPS = new Set(["MinotaurRig", "Sentinel", "Cyclops", "HydraHead", "Minotaur"]);

export function createProps(scene, { braziers }) {
  const root = new THREE.Group(); root.name = "props"; scene.add(root);
  const cache = new Map();   // model name -> Promise<{ src, bb }>
  const load = (name) => {
    if (!cache.has(name)) cache.set(name, new Promise((res, rej) => new GLTFLoader().load(`/models/${name}.glb`, (g) => {
      const src = g.scene; src.updateMatrixWorld(true);
      res({ src, bb: new THREE.Box3().setFromObject(src) });
    }, undefined, rej)));
    return cache.get(name);
  };
  let nextN = 1;
  const newId = () => { let id; do id = `add#${nextN++}`; while (isRegistered(id)); return id; };

  /** a new prop of `kind` at `at` (a Vector3 on the ground); resolves to its pivot (registered, editable) */
  async function spawn(kind, at, id = newId(), label) {
    const n = +String(id).split("#")[1]; if (n >= nextN) nextN = n + 1;
    if (kind === "brazier") {
      const g = braziers.add(at.clone(), id, label || `fire basin (added)`);
      g.userData.addKind = kind; g.userData.added = true; return g;
    }
    const { src, bb } = await load(kind), size = bb.getSize(new THREE.Vector3());
    const fit = FIT[kind] || { height: 3 }, k = fit.width ? fit.width / size.x : fit.height / size.y;
    const pivot = new THREE.Group(); pivot.name = kind; pivot.position.copy(at);
    const m = src.clone(true); m.scale.setScalar(k);
    m.position.set(-(bb.min.x + bb.max.x) / 2 * k, -bb.min.y * k, -(bb.min.z + bb.max.z) / 2 * k);
    m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    pivot.add(m); root.add(pivot);
    pivot.userData.addKind = kind; pivot.userData.added = true;
    register(pivot, id, label || `${kind} (added)`);
    return pivot;
  }
  /** rebuild every added prop in a saved layout (their transforms are applied as they register) */
  function spawnSaved(edits) {
    return Promise.all(Object.entries(edits || {}).filter(([, e]) => e && e.add).map(([id, e]) =>
      spawn(e.add, new THREE.Vector3().fromArray(e.p || [0, 0, 0]), id).catch((err) => console.warn("prop", id, err))));
  }
  function remove(obj) {
    if (!obj || !obj.userData.added) return false;
    unregister(obj.userData.editId);
    if (obj.userData.addKind === "brazier") braziers.remove(obj); else obj.removeFromParent();
    return true;
  }
  /** what the palette offers: every model in public/models (dev server lists them) that is scenery, + the fire basin */
  async function kinds() {
    let names = [];
    try { names = await (await fetch("/__models")).json(); } catch { names = Object.keys(FIT); }
    return ["brazier", ...names.filter((n) => !NOT_PROPS.has(n))];
  }
  return { spawn, spawnSaved, remove, kinds };
}
