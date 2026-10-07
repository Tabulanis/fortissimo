/* editables.js — what the dev-mode EDITOR may move, and the saved layout (owner, 2026-10-07:
   "a level editor to go in, move things, size them" → "alter dev mode to be able to move stuff").

   Scenery registers itself here with a STABLE id (never a scene-graph index: models load async).
   The saved layout lives in public/levels/edits.json — { id: { p: [x,y,z], q: [x,y,z,w], s: [x,y,z],
   hidden } } in the object's PARENT space — written by the dev server (vite.config.js /__level)
   and applied to each object the moment it registers (or when the file arrives, if later).
   Gameplay objects (drums, guns, crystals) are deliberately NOT registered: hit tests use their
   positions. */
import * as THREE from "three";

const objs = new Map();      // id -> Object3D
let edits = {};              // id -> saved transform
let loaded = false;
const _pending = [];

function apply(id) {
  const o = objs.get(id), e = edits[id];
  if (!o || !e) return;
  if (e.p) o.position.fromArray(e.p);
  if (e.q) o.quaternion.fromArray(e.q);
  if (e.s) o.scale.fromArray(e.s);
  o.visible = !e.hidden;
}

/** load the saved layout (once, at startup) */
export function loadEdits(url = "/levels/edits.json") {
  return fetch(url, { cache: "no-store" }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}))
    .then((j) => { edits = j || {}; loaded = true; for (const id of objs.keys()) apply(id); return edits; });
}

/** scenery calls this as it is built; ids must be stable across loads */
export function register(obj, id, label = id) {
  if (objs.has(id)) { let k = 2; while (objs.has(`${id}~${k}`)) k++; id = `${id}~${k}`; }   // never collide
  obj.userData.editId = id; obj.userData.editLabel = label;
  if (!obj.userData.editHome) obj.userData.editHome = { p: obj.position.toArray(), q: obj.quaternion.toArray(), s: obj.scale.toArray() };
  objs.set(id, obj);
  if (loaded) apply(id);
  return obj;
}

/** the editable that owns a picked object (walk up the parents) */
export function editableOf(o) {
  while (o) { if (o.userData && o.userData.editId && objs.get(o.userData.editId) === o) return o; o = o.parent; }
  return null;
}
export const allEditables = () => [...objs.values()];

/** record an object's current transform as an edit (call after every change) */
export function capture(o) {
  edits[o.userData.editId] = { p: o.position.toArray(), q: o.quaternion.toArray(), s: o.scale.toArray(), ...(o.visible ? {} : { hidden: true }) };
}
/** put an object back where the code built it, and forget its edit */
export function reset(o) {
  const h = o.userData.editHome; o.position.fromArray(h.p); o.quaternion.fromArray(h.q); o.scale.fromArray(h.s); o.visible = true;
  delete edits[o.userData.editId];
}
/** write the layout to the project (dev server only) */
export function saveEdits() {
  return fetch("/__level", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(edits, null, 1) })
    .then((r) => r.ok);
}
export const editCount = () => Object.keys(edits).length;
