/* batcher.js — FEWER DRAW CALLS for the town (10-09 speed pass: "don't draw what you can't see, optimize like crazy").
   Measured at the drums: ~300 courtyard pieces, ~120 fire-basin pieces, ~90 columns — each its own draw call, every frame.
   While you PLAY, every small, still, solid piece under the given groups that shares a material with others nearby is glued
   into ONE mesh per material per 12 m cell (the cells keep the off-screen parts of town culled); the originals are hidden.
   While you EDIT (fly mode) it all comes apart again — the originals back, so each piece can be picked, moved, mirrored —
   and it is re-glued when you leave. Pieces that move at runtime are kept out (skip(o) says which).
     createBatcher(scene, { roots: () => [groups], skip: (o) => bool, maxZ }) -> { build(), dissolve(), get on, stats }
   build() checks a cheap signature first and does nothing if nothing changed. */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const CELL = 12, MAX_VERTS = 5000;   // big models are one draw call already, and keep their own culling

export function createBatcher(scene, { roots, skip = () => false, maxZ = Infinity }) {
  const group = new THREE.Group(); group.name = "batched"; scene.add(group);
  let hidden = [], sig = "", on = false;
  const stats = { pieces: 0, batches: 0 };
  const shown = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
  const _p = new THREE.Vector3();

  function eligible() {
    const out = [];
    for (const r of roots()) {
      if (!r) continue;
      r.traverse((o) => {
        if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || !o.geometry || !o.geometry.attributes.position) return;
        const m = o.material;
        if (!m || Array.isArray(m) || m.transparent || m.isShaderMaterial || !o.layers.isEnabled(0)) return;
        if (o.geometry.morphAttributes && Object.keys(o.geometry.morphAttributes).length) return;
        if (m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return;   // its own shader tricks: keep it whole
        if (o.geometry.attributes.position.count > MAX_VERTS || o.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return;
        for (let a = o; a; a = a.parent) if (skip(a)) return;
        if (!shown(o)) return;
        if (o.getWorldPosition(_p).z > maxZ) return;
        out.push(o);
      });
    }
    return out;
  }
  const signature = (list) => { let s = 0; for (const o of list) { const e = o.matrixWorld.elements; s += e[12] * 1.3 + e[13] * 2.1 + e[14] * 3.7 + e[0] + e[5] + e[10]; } return list.length + ":" + s.toFixed(3); };

  function dissolve() {
    for (const o of hidden) o.visible = true;
    hidden = [];
    for (const c of [...group.children]) { c.geometry.dispose(); group.remove(c); }
    on = false; stats.pieces = 0; stats.batches = 0;
  }

  function build() {
    scene.updateMatrixWorld();
    if (on) { for (const o of hidden) o.visible = true; }   // look at the scene as it really stands
    const list = eligible(), s = signature(list);
    if (on && s === sig) { for (const o of hidden) o.visible = false; return false; }   // nothing changed
    dissolve(); sig = s;
    const buckets = new Map();
    for (const o of list) {
      const g = o.geometry, attrs = Object.keys(g.attributes).sort().join(",");   // ALL of it (10-09: dropping uv1/tangent changed how walls looked)
      const c = o.getWorldPosition(_p);
      const key = `${o.material.uuid}|${attrs}|${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}|${Math.floor(c.x / CELL)},${Math.floor(c.z / CELL)}`;
      if (!buckets.has(key)) buckets.set(key, { mat: o.material, attrs: attrs.split(","), cast: o.castShadow, recv: o.receiveShadow, list: [] });
      buckets.get(key).list.push(o);
    }
    for (const b of buckets.values()) {
      if (b.list.length < 2) continue;   // alone: nothing to gain
      const geos = b.list.map((o) => {
        let g = new THREE.BufferGeometry();
        for (const k of b.attrs) g.setAttribute(k, o.geometry.attributes[k]);
        if (o.geometry.index) g.setIndex(o.geometry.index);
        else g.setIndex([...Array(o.geometry.attributes.position.count).keys()]);
        g = g.clone(); g.applyMatrix4(o.matrixWorld);
        if (o.matrixWorld.determinant() < 0) {   // a mirrored piece (the editor's Mirror): flip its triangles or it shows inside out
          const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
        }
        return g;
      });
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      const m = new THREE.Mesh(merged, b.mat); m.castShadow = b.cast; m.receiveShadow = b.recv; m.matrixAutoUpdate = false;
      m.userData.batched = true; group.add(m);
      for (const o of b.list) { o.visible = false; hidden.push(o); }
      stats.pieces += b.list.length; stats.batches++;
    }
    on = true;
    return true;
  }
  return { build, dissolve, get on() { return on; }, stats, group };
}
