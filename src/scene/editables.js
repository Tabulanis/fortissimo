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
    .then((j) => { edits = j || {}; loaded = true; for (const id of objs.keys()) apply(id); if (levelScene) applyLevelPieces(); return edits; });
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

/** record an object's current transform as an edit (call after every change); an ADDED prop also
 *  records what it is ({ add: "Cliffs" }) so the next load can build it again (props.js) */
export function capture(o) {
  edits[o.userData.editId] = { ...(o.userData.addKind ? { add: o.userData.addKind } : {}),
    p: o.position.toArray(), q: o.quaternion.toArray(), s: o.scale.toArray(), ...(o.visible ? {} : { hidden: true }) };
}
export const isRegistered = (id) => objs.has(id);
/** forget an object entirely (an added prop being deleted): no edit, no registration */
export function unregister(id) { objs.delete(id); delete edits[id]; }
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

/* LEVEL GEOMETRY (owner, 2026-10-08: "for the level I want to be able to select and move or remove level geom"):
   every piece the courtyard and the cove are BUILT from (their boxes, columns, floors, steps…) is editable too, without
   being registered up front: a click on one registers it on the spot under an id that is its PATH from its level root
   ("@courtyard/3.1" = child 3, then its child 1) — the code builds those pieces in the same order every time, so the
   id finds the same piece next load. Saved edits for such ids are applied once the scene is known (setLevelScene).
   Gameplay (drums, guns, crystals), the sea, the sky and the ground live outside these roots: never selectable. */
export const LEVEL_ROOTS = ["courtyard", "cove"];
let levelScene = null;
const rootOf = (name) => levelScene && levelScene.children.find((c) => c.name === name);
/** the piece a click on `o` selects: the registered editable it is part of, else the level piece itself (registered now); null = not editable */
export function levelPieceOf(o) {
  const e = editableOf(o); if (e) return e;
  let root = null;
  for (let p = o.parent; p; p = p.parent) if (LEVEL_ROOTS.includes(p.name) && p.parent === levelScene) { root = p; break; }
  if (!root) return null;
  const path = []; for (let c = o; c !== root; c = c.parent) path.unshift(c.parent.children.indexOf(c));
  const kind = o.geometry && o.geometry.type ? o.geometry.type.replace("Geometry", "").toLowerCase() : "piece";
  return register(o, `@${root.name}/${path.join(".")}`, `${o.name || kind} (${root.name})`);
}
function applyLevelPieces() {
  for (const id of Object.keys(edits)) {
    const m = /^@([a-z]+)\/([\d.]+)$/.exec(id); if (!m || objs.has(id)) continue;
    let o = rootOf(m[1]);
    for (const i of m[2].split(".").map(Number)) o = o && o.children[i];
    if (o) register(o, id, `${o.name || "piece"} (${m[1]})`);
  }
}
/** the scene the level roots live in (stage3d calls this once the courtyard and the cove are built) */
export function setLevelScene(scene) { levelScene = scene; if (loaded) applyLevelPieces(); }

/** level-wide settings saved in the same layout file under "_<key>" (10-08: "_lighting") — not objects */
export function setSetting(key, value) { edits["_" + key] = value; }
export const getSetting = (key) => edits["_" + key];
