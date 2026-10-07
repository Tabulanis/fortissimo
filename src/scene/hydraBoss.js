/* hydraBoss.js — THE HYDRA in the sea (owner, 2026-10-06: "the body is underwater").
   What shows is three long NECKS breaking the surface in front of the dock, each with the
   rigged head (hydra.js) on top. A neck is a bending tube along a curve from the waterline
   up to the head's neck stub; the curve sways (on the beat when given one), rears, and
   LUNGES at the podium for a bite. The part of the tube under the sea plane is hidden by it.

   createHydra(scene, { origin, target, heads, scale }) -> {
     rise(), submerge(), bite(i), update(dt, now, beatPhase), heads, group, ready }
   Pure placement/animation — no game rules here (hit points, which section kills which
   head: that is round 4's logic, later). */
import * as THREE from "three";
import { loadHydraHead, createHydraHead } from "./hydra.js";

const SEGS = 28, RADIAL = 10;

/** a tube whose positions follow a curve each frame — built once, written in place */
function makeNeck(radius, material) {
  const geo = new THREE.BufferGeometry();
  const n = (SEGS + 1) * (RADIAL + 1);
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const uv = new Float32Array(n * 2), idx = [];
  for (let i = 0; i <= SEGS; i++) for (let k = 0; k <= RADIAL; k++) { uv[(i * (RADIAL + 1) + k) * 2] = k / RADIAL; uv[(i * (RADIAL + 1) + k) * 2 + 1] = i / SEGS * 6; }
  for (let i = 0; i < SEGS; i++) for (let k = 0; k < RADIAL; k++) {
    const a = i * (RADIAL + 1) + k, b = a + RADIAL + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);   // outward-facing winding (the first try was inside-out)
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, material); mesh.castShadow = true; mesh.frustumCulled = false;
  const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _n = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 0, 1);
  return {
    mesh,
    /** write the tube along the curve; the radius tapers a little toward the head */
    follow(curve) {
      const pos = geo.attributes.position.array, nor = geo.attributes.normal.array;
      let j = 0;
      for (let i = 0; i <= SEGS; i++) {
        const u = i / SEGS;
        curve.getPointAt(u, _p); curve.getTangentAt(u, _t).normalize();
        _n.crossVectors(_t, Math.abs(_t.z) < 0.9 ? _up : new THREE.Vector3(1, 0, 0)).normalize(); _b.crossVectors(_t, _n).normalize();
        const r = radius * (1.15 - 0.3 * u);
        for (let k = 0; k <= RADIAL; k++) {
          const a = k / RADIAL * Math.PI * 2, cx = Math.cos(a), sy = Math.sin(a);
          nor[j] = cx * _n.x + sy * _b.x; nor[j + 1] = cx * _n.y + sy * _b.y; nor[j + 2] = cx * _n.z + sy * _b.z;
          pos[j] = _p.x + r * nor[j]; pos[j + 1] = _p.y + r * nor[j + 1]; pos[j + 2] = _p.z + r * nor[j + 2];
          j += 3;
        }
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.normal.needsUpdate = true;
    },
  };
}

export function createHydra(scene, { origin = new THREE.Vector3(0, -0.15, 43), target = new THREE.Vector3(0, 2, 29), heads = 3, scale = 2.4, height = 9 } = {}) {
  const group = new THREE.Group(); group.name = "hydra"; scene.add(group);
  const neckMat = new THREE.MeshStandardMaterial({ color: 0x4e6a3a, roughness: 0.75, metalness: 0.05 });
  const H = [];
  const api = { group, heads: H, ready: false, level: 0, _levelTo: 0 };
  loadHydraHead().then((L) => {
    const stub = L.bounds; const stubLen = (-0.25 - stub.min.y) * scale;   // the head's own neck stub, scaled
    for (let i = 0; i < heads; i++) {
      const spread = (i - (heads - 1) / 2) * 5.5;
      const base = origin.clone().add(new THREE.Vector3(spread, 0, Math.abs(spread) * 0.35));
      const head = createHydraHead(L); head.group.scale.setScalar(scale); group.add(head.group);
      const neck = makeNeck(0.3 * scale, neckMat); group.add(neck.mesh);
      const curve = new THREE.CatmullRomCurve3([base.clone(), base.clone(), base.clone(), base.clone(), base.clone()], false, "catmullrom", 0.4);
      H.push({ head, neck, curve, base, seed: i * 2.1 + 0.7, lunge: 0, lungeAt: -1e9, tip: new THREE.Vector3(), stubLen, lean: 0.35 + 0.1 * i });
    }
    if (api._hold !== undefined) H[api._hold % H.length].hold = true;
    api.ready = true;
  });
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3(), _tan = new THREE.Vector3();
  api.rise = () => { api._levelTo = 1; };
  api.submerge = () => { api._levelTo = 0; };
  api.bite = (i, now) => { const h = H[i % H.length]; if (h) { h.lungeAt = now; h.head.bite(now + 0.3); } };
  api.holdLunge = (i) => { api._hold = i; if (H.length) H[i % H.length].hold = true; };   // dev: freeze a head at full lunge, jaw wide, for a photo (the heads load async: remembered until they exist)
  api.update = (dt, now, beatPhase = now) => {
    if (!api.ready) return;
    api.level += (api._levelTo - api.level) * Math.min(1, dt * 0.9);   // rises over ~3 s
    for (const h of H) {
      const t = now, s = h.seed, lv = api.level;
      // the lunge: toward the target for 0.35 s, back over 0.9 s
      const dl = now - h.lungeAt; h.lunge = h.hold ? 1 : dl < 0 ? 0 : dl < 0.35 ? Math.sin(dl / 0.35 * Math.PI / 2) : dl < 1.25 ? 1 - (dl - 0.35) / 0.9 : 0;
      if (h.hold) h.head.jaw(1);
      // the curve: base at the water, a belly leaning toward the dock, the tip high and swaying
      const sway = Math.sin(beatPhase * Math.PI * 0.5 + s) * 1.4 + Math.sin(t * 0.37 + s * 1.3) * 0.6;
      const toward = _fwd.subVectors(target, h.base).setY(0).normalize();
      const idleTop = h.base.clone().addScaledVector(toward, height * h.lean * lv).add(new THREE.Vector3(sway * lv, height * lv + Math.sin(t * 0.8 + s) * 0.5 * lv, 0));
      // the strike goes to a point 1.6 m short of the target, a touch above it — whatever the distance
      const strikeAt = target.clone().addScaledVector(toward, -1.6).add(new THREE.Vector3(0, 1.0, 0));
      const top = idleTop.lerp(strikeAt, 0.8 * h.lunge);
      const P = h.curve.points;
      P[0].copy(h.base).setY(h.base.y - 3);
      P[1].copy(h.base);
      P[2].lerpVectors(h.base, top, 0.45).add(new THREE.Vector3(-sway * 0.4 * lv, 0, 0));
      P[3].lerpVectors(h.base, top, 0.8).add(new THREE.Vector3(sway * 0.3 * lv, 0.6 * lv, 0));
      P[4].copy(top);
      h.curve.updateArcLengths?.();
      h.neck.follow(h.curve);
      // the head sits on the tip, its neck stub continuing the curve, snout toward the target
      h.curve.getTangentAt(1, _tan).normalize();
      _up.copy(_tan);
      _fwd.subVectors(target, top).normalize(); _fwd.addScaledVector(_up, -_fwd.dot(_up)).normalize();
      _right.crossVectors(_up, _fwd).normalize(); _fwd.crossVectors(_right, _up).normalize();   // right-handed: x=right, y=up, z=forward (x×y=z)
      _m.makeBasis(_right, _up, _fwd); _q.setFromRotationMatrix(_m);
      h.head.group.quaternion.copy(_q);
      // the head group's origin is the stub's base: set it a touch inside the tube so the two overlap
      h.head.group.position.copy(top).addScaledVector(_up, -h.stubLen * 0.15);
      h.head.setSway(t, s, 0.6 + 0.4 * lv);
      h.head.group.visible = lv > 0.02;
      h.neck.mesh.visible = lv > 0.02;
    }
  };
  return api;
}
