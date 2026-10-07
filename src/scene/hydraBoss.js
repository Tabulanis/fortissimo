/* hydraBoss.js — THE HYDRA in the sea (owner, 2026-10-06: "the body is underwater";
   later: "lose the tube necks — the bases never come out of the water, stretch the neck").

   Three of the rigged head (hydra.js) close in front of the dock. Each head's own neck stub
   IS its neck: the head group stands on a point BELOW the sea plane and never rises above
   it; the neck bones are STRETCHED (bone.scale.y) so the stub reaches up out of the water,
   and the skull bone is counter-scaled so the head itself keeps its shape. The whole neck
   leans toward the podium from its underwater base; idle sway bends the bones; a STRIKE
   pitches the neck forward and down at the podium and the jaw snaps.

   createHydra(scene, { origin, target, heads, scale, stretch }) -> {
     rise(), submerge(), bite(i, now), holdLunge(i), update(dt, now, beatPhase), heads, group, ready }
   Pure placement/animation — the rules (hit points, which section kills which head) are
   round 4's logic, elsewhere. */
import * as THREE from "three";
import { loadHydraHead, createHydraHead, RIG } from "./hydra.js";

export function createHydra(scene, { origin = new THREE.Vector3(0, -1.4, 37), target = new THREE.Vector3(0, 2.2, 29), heads = 3, scale = 2.4, stretch = 1.25, spread = 4.6 } = {}) {
  const group = new THREE.Group(); group.name = "hydra"; scene.add(group);
  const H = [];
  const api = { group, heads: H, ready: false, level: 0, _levelTo: 0 };
  loadHydraHead().then((L) => {
    for (let i = 0; i < heads; i++) {
      const sx = (i - (heads - 1) / 2) * spread;
      const base = origin.clone().add(new THREE.Vector3(sx, 0, Math.abs(sx) * 0.3));   // the outer two a touch further back
      const head = createHydraHead(L);
      // a PIVOT at the neck's base (the file's origin is mid-skull): the neck turns about this point under the water
      const pivot = new THREE.Group(); pivot.position.copy(base); group.add(pivot);
      head.group.scale.setScalar(scale); head.group.position.set(0, -L.bounds.min.y * scale, 0); pivot.add(head.group);
      // stretch the neck: every neck bone's y, the skull counter-scaled so the head keeps its shape
      const N = RIG.neckBones;
      for (let b = 1; b < N; b++) head.bones[b].scale.y = stretch;
      head.skull.scale.y = 1 / Math.pow(stretch, N - 1);
      H.push({ head, pivot, base, seed: i * 2.1 + 0.7, lean: 0.62 + 0.05 * Math.abs(i - 1), lunge: 0, lungeAt: -1e9, hold: false });
    }
    if (api._hold !== undefined) H[api._hold % H.length].hold = true;
    api.ready = true;
  });
  const _to = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
  api.rise = () => { api._levelTo = 1; };
  api.submerge = () => { api._levelTo = 0; };
  api.bite = (i, now) => { const h = H[i % H.length]; if (h) { h.lungeAt = now; h.head.bite(now + 0.3); } };
  api.holdLunge = (i) => { api._hold = i; if (H.length) H[i % H.length].hold = true; };   // dev: freeze a head at full strike for a photo
  api.update = (dt, now, beatPhase = now) => {
    if (!api.ready) return;
    api.level += (api._levelTo - api.level) * Math.min(1, dt * 0.9);   // rises over ~3 s
    for (const h of H) {
      const t = now, s = h.seed, lv = api.level;
      const dl = now - h.lungeAt; h.lunge = h.hold ? 1 : dl < 0 ? 0 : dl < 0.35 ? Math.sin(dl / 0.35 * Math.PI / 2) : dl < 1.25 ? 1 - (dl - 0.35) / 0.9 : 0;
      if (h.hold) h.head.jaw(1);
      // the base stays under the water: rising = the neck pitching up from flat-on-the-water to its lean
      _to.subVectors(target, h.base); const yaw = Math.atan2(_to.x, _to.z);   // the snout (+z) toward the podium
      const sway = Math.sin(beatPhase * Math.PI * 0.5 + s) * 0.12 + Math.sin(t * 0.37 + s * 1.3) * 0.05;
      const pitch = (1 - lv) * 1.35 + h.lean * lv + h.lunge * 0.55 + Math.sin(t * 0.8 + s) * 0.04 * lv;   // forward lean about the base (local x)
      _e.set(pitch, yaw, sway * lv, "YXZ"); h.pivot.quaternion.setFromEuler(_e);
      h.head.setSway(t, s, 0.5 + 0.5 * lv);
      // the skull tilts BACK as the neck pitches forward, so the jaws face the podium (not the crown)
      h.head.skull.rotation.x = -0.08 - 1.0 * h.lunge;   // at rest barely; in the strike the jaws come round to face you
      h.pivot.visible = lv > 0.02;
    }
  };
  return api;
}
