/* hydra.js — the HYDRA's heads: the owner's one-piece Meshy head (public/models/HydraHead.glb,
   neck stub + skull + open jaw, 7.8k tris, NO rig in the file) given a skeleton in code and
   skinned — bones and weights, the mesh stays one piece (owner, 2026-10-06).

   Bones (all in the head's own frame, +y up the neck, the snout toward +z):
     neck0..neckN   a chain up the neck stub, so the head sways, rears and strikes
     skull          the head itself
     jaw            hinged at the back of the mouth, child of the skull: opens and bites
   Weights are computed from each vertex's position:
     neck:  by height, blended between the two nearest neck bones
     skull: everything above the neck
     jaw:   skull vertices BELOW the mouth line and IN FRONT of the hinge, with a soft
            band at the hinge so the skin stretches instead of tearing
   One loaded geometry; each head is its own SkinnedMesh + Skeleton (clone), so the three
   heads move on their own. API per head: setSway(t), bite(now), jaw(open 0..1), group. */
import { gltfLoader } from "./gltf.js";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { bootlog } from "../bootlog.js";

export const RIG = {
  // measured from the mesh (2026-10-06): neck y -1.69..-0.25 (narrow, leans back to -z), skull
  // above, snout +z out to 0.93, lower jaw tip at y -0.15 z 0.78, horns -z. Tune by eye.
  neckTop: -0.25,      // y where the neck ends and the skull begins
  neckBones: 16,       // the long-necked export (2026-10-06 22:43): 3.6 m of neck; 16 bones (owner, 10-11: "more bones, let 'em use that length") — the bends are scaled by 8/N
  mouthY: 0.35,        // (fallback only, when the file has no _JAW flag)
  hingeZ: 0.22,        // the jaw hinge: measured from a side density map — the head is tilted, the hinge is high
  hingeY: 0.33,
  band: 0.1,           // soft blend width at the jaw's edges
};

let loaded = null;   // { geometry, material, bounds }
export function loadHydraHead(url = "/models/HydraHead.glb") {
  if (loaded) return Promise.resolve(loaded);
  return new Promise((resolve, reject) => gltfLoader().load(url, (g) => {
    let mesh = null; g.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
    mesh.updateWorldMatrix(true, false);
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);   // bake the file's node transform
    geometry.computeBoundingBox();
    skinGeometry(geometry);   // ownership comes baked in the file (_JAW, tools/hydra-jaw-labels.py)
    loaded = { geometry, material: mesh.material, bounds: geometry.boundingBox };
    resolve(loaded);
  }, undefined, reject));
}

/** bone index layout: 0..N-1 neck (bottom up), N skull, N+1 jaw */
function skinGeometry(geo) {
  const pos = geo.attributes.position, n = pos.count, flag = geo.attributes._jaw || null;
  bootlog("hydra rig", { jawFlag: !!flag, verts: n });
  const bb = geo.boundingBox, y0 = bb.min.y, yTop = RIG.neckTop, N = RIG.neckBones;
  const idx = new Uint16Array(n * 4), w = new Float32Array(n * 4);
  const smooth = (x) => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let a = 0, b = 0, wa = 1, wb = 0;
    if (y < yTop) {   // the neck: position along it in bone units
      const u = (y - y0) / (yTop - y0) * (N - 1);
      a = Math.floor(u); b = Math.min(N - 1, a + 1); wb = u - a; wa = 1 - wb;
    } else {
      // the skull or the jaw: the file says which (_JAW, baked from the mesh's own connectivity by
      // tools/hydra-jaw-labels.py — teeth ride whatever they are attached to, RIGIDLY); the only
      // blend is a soft band around the hinge so the corner of the mouth stretches instead of tearing
      let jaw = flag ? flag.getX(i) : smooth((RIG.mouthY - y) / RIG.band + 0.5) * smooth((z - RIG.hingeZ) / RIG.band + 0.5);
      if (flag && jaw > 0.5) {
        const dh = Math.hypot(y - RIG.hingeY, z - RIG.hingeZ);
        if (dh < RIG.band * 2) jaw = 0.5 + 0.5 * smooth(dh / (RIG.band * 2));
      }
      a = N; b = N + 1; wa = 1 - jaw; wb = jaw;
      // the first skull vertices also lean on the top neck bone so the join bends, not kinks
      if (y < yTop + RIG.band && jaw < 0.5) { const k = 1 - (y - yTop) / RIG.band; wa *= 1 - 0.5 * k; idx[i * 4 + 2] = N - 1; w[i * 4 + 2] = 0.5 * k * (1 - jaw); }
    }
    idx[i * 4] = a; idx[i * 4 + 1] = b; w[i * 4] = wa; w[i * 4 + 1] = wb;
  }
  geo.setAttribute("skinIndex", new THREE.BufferAttribute(idx, 4));
  geo.setAttribute("skinWeight", new THREE.BufferAttribute(w, 4));
}

/** a rigged head: its own skeleton over the shared geometry */
export function createHydraHead({ geometry, material, bounds }) {
  const N = RIG.neckBones, y0 = bounds.min.y, step = (RIG.neckTop - y0) / (N - 1);
  const bones = [];
  for (let i = 0; i < N; i++) { const bn = new THREE.Bone(); bn.name = "neck" + i; bn.position.y = i === 0 ? y0 : step; (i ? bones[i - 1] : null)?.add(bn); bones.push(bn); }
  const skull = new THREE.Bone(); skull.name = "skull"; skull.position.y = RIG.neckTop - (y0 + step * (N - 1)); bones[N - 1].add(skull); bones.push(skull);
  const jaw = new THREE.Bone(); jaw.name = "jaw"; jaw.position.set(0, RIG.hingeY - RIG.neckTop, RIG.hingeZ); skull.add(jaw); bones.push(jaw);
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.add(bones[0]);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.castShadow = true; mesh.frustumCulled = false;
  const group = new THREE.Group(); group.add(mesh);
  const rest = bones.map((b) => b.quaternion.clone());
  let biteAt = -1e9, jawOpen = 0.15;   // idle: lips just parted
  const head = {
    group, mesh, bones, skull, jaw,
    /** idle: a slow S-curve sway up the neck; t in seconds, seed per head */
    setSway(t, seed = 0, amount = 1) {
      for (let i = 0; i < N; i++) {
        const k = i / (N - 1);
        bones[i].quaternion.copy(rest[i]);
        bones[i].rotateZ(Math.sin(t * 0.9 + seed + k * 2.2) * 0.08 * amount * (0.3 + k));
        bones[i].rotateX(Math.sin(t * 0.7 + seed * 1.3 + k * 1.6) * 0.06 * (8 / bones.length) * amount * (0.3 + k));
      }
      // a strike: the neck whips forward (+z) over 0.35 s, then eases back
      const dt = t - biteAt;
      if (dt >= 0 && dt < 1.2) {
        const s = dt < 0.35 ? Math.sin(dt / 0.35 * Math.PI / 2) : 1 - (dt - 0.35) / 0.85;
        for (let i = 1; i < N; i++) bones[i].rotateX(-0.22 * s);
        jawOpen = dt < 0.35 ? 1 : dt < 0.6 ? 0.05 : Math.min(1, jawOpen + 0.02);
      }
      // the file ships with the mouth OPEN: 0 = swung shut (-0.42 rad, seen 2026-10-06), 1 = wide (+0.45)
      jaw.quaternion.copy(rest[N + 1]); jaw.rotateX(-0.42 + jawOpen * 0.87);
    },
    bite(t) { biteAt = t; },
    jaw(open) { jawOpen = open; },
  };
  return head;
}
