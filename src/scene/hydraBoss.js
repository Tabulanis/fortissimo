/* hydraBoss.js — THE HYDRA in the sea (owner, 2026-10-06: "the body is underwater";
   later: "lose the tube necks — the bases never come out of the water, stretch the neck").

   Three of the rigged head (hydra.js) close in front of the dock. Each head's own neck stub
   IS its neck: the head group stands on a point BELOW the sea plane and never rises above
   it; the neck bones are STRETCHED (bone.scale.y) so the stub reaches up out of the water,
   and the skull bone is counter-scaled so the head itself keeps its shape. The whole neck
   leans toward the podium from its underwater base; idle sway bends the bones; a STRIKE
   pitches the neck forward and down at the podium and the jaw snaps.

   createHydra(scene, { origin, target, heads, scale, stretch }) -> {
     rise(), submerge(), bite(i, now), holdLunge(i), update(dt, now, beatPhase), heads, group, ready,
     rear(i, on), hit(i, now), down(i), up(i) }   ← round 4's fight (hydrafight.js) drives these:
     rear = the head pulls back, jaws open (it strikes next bar); hit = a recoil; down / up = that head
     sinks / comes back (regrowth)
   Pure placement/animation — the rules (hit points, which section kills which head) are
   round 4's logic, elsewhere. */
import * as THREE from "three";
import { loadHydraHead, createHydraHead, RIG } from "./hydra.js";
import { register } from "./editables.js";

export function createHydra(scene, { origin = new THREE.Vector3(0, -1.4, 37), target = new THREE.Vector3(0, 2.2, 29), heads = 3, scale = 2.4, stretch = 1.0, spread = 6.2, sea = null } = {}) {   // the long-necked export needs no stretch; sea: ripples where the necks break it
  const group = new THREE.Group(); group.name = "hydra"; scene.add(group);
  const H = [];
  const api = { group, heads: H, ready: false, level: 0, _levelTo: 0 };
  loadHydraHead().then((L) => {
    for (let i = 0; i < heads; i++) {
      const sx = (i - (heads - 1) / 2) * spread;
      const base = origin.clone().add(new THREE.Vector3(sx, 0, Math.abs(sx) * 0.55));   // the outer two further back: long necks reach
      const head = createHydraHead(L);
      // a PIVOT at the neck's base (the file's origin is mid-skull): the neck turns about this point under the water
      const pivot = new THREE.Group(); pivot.position.copy(base); group.add(pivot);
      register(pivot, `hydra-head-${i}`, `hydra head ${i + 1}`);   // the editor MOVES / SIZES it; its turn is animated
      head.group.scale.setScalar(scale); head.group.position.set(0, -L.bounds.min.y * scale, 0); pivot.add(head.group);
      // stretch the neck: every neck bone's y, the skull counter-scaled so the head keeps its shape
      const N = RIG.neckBones;
      for (let b = 1; b < N; b++) head.bones[b].scale.y = stretch;
      head.skull.scale.y = 1 / Math.pow(stretch, N - 1);
      // the outer two lean less: their necks are long and their bases sit nearer the sides
      H.push({ head, pivot, base: pivot.position, seed: i * 2.1 + 0.7, lean: i === 1 ? 0.62 : 0.4, lunge: 0, lungeAt: -1e9, hold: false, alv: 1, aliveTo: 1, rear: 0, rearTo: 0, hitAt: -1e9, back: 0, backTo: 0, rippleAt: 0, wasUp: false, lastPitch: 0 });
    }
    if (api._hold !== undefined) H[api._hold % H.length].hold = true;
    api.ready = true;
  });
  const _to = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
  const target0 = target.clone();
  /** round 4's play spot moved (his altar): the heads keep the same place relative to it, and aim at it */
  api.moveTo = (spot) => { group.position.set(spot.x - target0.x, 0, spot.z - target0.z); target.set(spot.x, spot.y, spot.z); };
  api.rise = () => { api._levelTo = 1; };
  api.submerge = () => { api._levelTo = 0; };
  const _sx = new THREE.Vector3();
  /** where a neck crosses the surface (the straight neck line from the pivot at its pitch), for the ripples */
  const surfaceOf = (h, pitch, yaw) => {
    const seaY = sea ? sea.level : -0.15, d = (seaY - h.base.y) / Math.max(0.2, Math.cos(pitch));   // along the neck to the surface
    return _sx.set(h.base.x + Math.sin(yaw) * Math.sin(pitch) * d, seaY, h.base.z + Math.cos(yaw) * Math.sin(pitch) * d);
  };
  api.bite = (i, now) => { const h = H[i % H.length]; if (h) { h.lungeAt = now; h.head.bite(now + 0.3); if (sea) { const p = surfaceOf(h, h.lastPitch, h.lastYaw || 0); sea.addRipple(p.x, p.z, 2.4); } } };
  api.rear = (i, on = true) => { const h = H[i % H.length]; if (h) h.rearTo = on ? 1 : 0; };
  api.hit = (i, now) => { const h = H[i % H.length]; if (h) { h.hitAt = now; h.rearTo = 0; if (sea) sea.addRipple(h.base.x, h.base.z - 2, 2.0); } };
  api.standBack = (i, on = true) => { const h = H[i % H.length]; if (h) h.backTo = typeof on === "number" ? on : on ? 1 : 0; };   // a number = part way back (10-11: the attacker at 0.45 so it never covers the kit)   // round 4: the heads not attacking lean away (10-08: the middle one sat 3.5 m from the camera)
  api.down = (i) => { const h = H[i % H.length]; if (h) { h.aliveTo = 0; h.rearTo = 0; } };
  api.up = (i) => { const h = H[i % H.length]; if (h) h.aliveTo = 1; };
  api.mouth = (i, out = new THREE.Vector3()) => { const h = H[i % H.length]; return h ? h.head.skull.getWorldPosition(out) : null; };   // where acid leaves from
  api.holdLunge = (i) => { api._hold = i; if (H.length) H[i % H.length].hold = true; };   // dev: freeze a head at full strike for a photo
  // ROUND 4 LANES (owner, 2026-10-11: "fire, ice and acid from the heads, from the mouth to the drum"): a head that is the SOURCE of
  // lanes holds STILL — no sway, no wobble — so the far end of its lanes never wanders; and its mouth glows its element
  api.still = (i, on = true) => { const h = H[i % H.length]; if (h) h.stillTo = on ? 1 : 0; };
  api.mouthGlow = (i, color, strength = 1) => { const h = H[i % H.length]; if (!h) return;
    if (!h.glow) { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap(), color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      m.scale.setScalar(1.6); m.position.set(0, -0.1, 0.6); h.head.skull.add(m); h.glow = m; }
    h.glow.material.color.set(color); h.glow.material.opacity = Math.min(1, strength); h.glow.visible = strength > 0.01; };
  const glowMap = () => { if (api._glowMap) return api._glowMap; const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d");
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.35, "rgba(255,255,255,0.5)"); r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r; g.fillRect(0, 0, 64, 64); return (api._glowMap = new THREE.CanvasTexture(c)); };
  api.update = (dt, now, beatPhase = now) => {
    if (!api.ready) return;
    api.level += (api._levelTo - api.level) * Math.min(1, dt * 0.9);   // rises over ~3 s
    for (const h of H) {
      h.alv += (h.aliveTo - h.alv) * Math.min(1, dt * 1.2);   // one head sinking / regrowing
      h.rear += (h.rearTo - h.rear) * Math.min(1, dt * 6);
      h.back += (h.backTo - h.back) * Math.min(1, dt * 1.5);
      h.still = (h.still || 0) + ((h.stillTo || 0) - (h.still || 0)) * Math.min(1, dt * 2);   // a lane source settles still over ~0.5 s
      const t = now, s = h.seed, lv = api.level * h.alv;
      const dh = now - h.hitAt, recoil = dh >= 0 && dh < 1.2 ? Math.exp(-dh * 3.5) * Math.sin(Math.min(1, dh / 0.12) * Math.PI / 2) : 0;
      const dl = now - h.lungeAt; h.lunge = h.hold ? 1 : dl < 0 ? 0 : dl < 0.35 ? Math.sin(dl / 0.35 * Math.PI / 2) : dl < 1.25 ? 1 - (dl - 0.35) / 0.9 : 0;
      if (h.hold) h.head.jaw(1); else if (h.rear > 0.02 || h.rearTo) h.head.jaw(Math.max(0.15, 0.85 * h.rear));   // rearing: jaws open (back to the idle 0.15 after)
      // the base stays under the water: rising = the neck pitching up from flat-on-the-water to its lean
      _to.subVectors(target, h.base); const yaw = Math.atan2(_to.x, _to.z);   // the snout (+z) toward the podium
      const calm = 1 - h.still;   // still: the source of the lanes doesn't sway or wobble
      const sway = (Math.sin(beatPhase * Math.PI * 0.5 + s) * 0.12 + Math.sin(t * 0.37 + s * 1.3) * 0.05) * calm;
      const pitch = (1 - lv) * 1.35 + h.lean * lv + h.lunge * 0.24 + Math.sin(t * 0.8 + s) * 0.04 * lv * calm - 0.32 * h.rear * lv - 0.18 * recoil * lv - 0.45 * h.back * lv;   // rearing pulls back; a wound throws it BACK too (10-08: it was + — every wound lunged the head into the camera)   // forward lean about the base (local x); the strike is mostly the neck CURLING (below)
      _e.set(pitch, yaw, sway * lv, "YXZ"); h.pivot.quaternion.setFromEuler(_e);
      h.head.setSway(t, s, (0.5 + 0.5 * lv) * calm);
      // the strike: the upper neck curls forward toward the podium (setSway reset the bones this frame)
      { const B = h.head.bones, N = RIG.neckBones; for (let b = Math.floor(N / 2); b < N; b++) B[b].rotateX(0.11 * (8 / N) * 1.25 * h.lunge); }   // (10-11: more bones share the same curl, a touch more of it)
      // the skull tilts BACK as the neck pitches forward, so the jaws face the podium (not the crown)
      h.head.skull.rotation.x = -0.08 - 1.0 * h.lunge;   // at rest barely; in the strike the jaws come round to face you
      h.pivot.visible = lv > 0.02;
      // RIPPLES where the neck breaks the surface: a ring every 0.45 s while up, sized by how fast the neck is moving;
      // a big one as it first breaks the surface
      if (sea && lv > 0.05) {
        const p = surfaceOf(h, pitch, yaw); h.lastYaw = yaw;
        const moving = Math.abs(pitch - h.lastPitch) / Math.max(dt, 1e-3);
        if (!h.wasUp) { sea.addRipple(p.x, p.z, 3.0); h.wasUp = true; h.rippleAt = t; }
        else if (sea.press) sea.press(p.x, p.z, (0.003 + Math.min(0.06, moving * 0.05)) * dt * 60, 1.1);   // the CLOTH: pressed every frame by the neck's motion
        else if (t - h.rippleAt > 0.45) { sea.addRipple(p.x, p.z, 0.6 + Math.min(1.8, moving * 2.2)); h.rippleAt = t; }
      } else if (lv <= 0.05) h.wasUp = false;
      h.lastPitch = pitch;
    }
  };
  return api;
}
