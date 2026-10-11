/* acid.js — round 4's ACID and the DRUM SHIELD at the podium (owner, 2026-10-08: "have them spit acid so the
   drums shield has to stay up").
   A glob is a glowing green ball that arcs from a head's mouth to the podium, timed to land on a beat.
   The SHIELD is a dome over the podium whose glow follows the shield level (hydrafight.js); a glob that
   lands on a shield that holds bursts against the dome (sizzle), one that gets through bursts on the podium.
     createAcid(scene, { center, radius }) -> { spit(from, landAt, now), update(now), setShield(level, holds),
       onLand(fn(head, glob)) is set by the game; burst(at, through) } */
import * as THREE from "three";

export function createAcid(scene, { center, radius = 3.2 } = {}) {
  const root = new THREE.Group(); root.name = "acid"; scene.add(root);
  // the DOME: a soft green-gold shell, fresnel-bright at its rim, invisible when the shield is down
  const domeMat = new THREE.ShaderMaterial({
    uniforms: { uLevel: { value: 1 }, uHit: { value: 0 }, uColor: { value: new THREE.Color(0x7fe0b0) } },
    vertexShader: `varying vec3 vN, vV; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform float uLevel, uHit; uniform vec3 uColor; varying vec3 vN, vV;
      void main(){ float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.5);
        float a = (0.04 + 0.5 * rim) * uLevel + 0.35 * uHit * rim;
        gl_FragColor = vec4(uColor * (0.6 + 0.8 * rim), a); }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
  dome.position.copy(center); root.add(dome);

  const globGeo = new THREE.SphereGeometry(0.22, 14, 10);
  const globMat = new THREE.MeshBasicMaterial({ color: 0x9cff3a });
  const burstMat = new THREE.MeshBasicMaterial({ color: 0xb6ff5a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const globs = [], bursts = [];
  const api = { onLand: null, dome };
  /** a glob from `from` (world) landing at the podium at time landAt (seconds, the game's clock) */
  api.spit = (head, from, landAt, now) => {
    const m = new THREE.Mesh(globGeo, globMat); m.position.copy(from); root.add(m);
    const to = center.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2.2, 1.2 + Math.random(), (Math.random() - 0.5) * 1.5));
    globs.push({ head, m, from: from.clone(), to, t0: now, t1: landAt, landed: false });
  };
  api.burst = (at, through) => {
    const m = new THREE.Mesh(globGeo, burstMat.clone()); m.position.copy(at); root.add(m);
    bursts.push({ m, t0: performance.now() / 1000, big: through ? 1.1 : 0.6 });   // (10-11: 3.2-5 m at the drum filled the screen green on every hit)
  };
  let hit = 0;
  api.setShield = (level) => { domeMat.uniforms.uLevel.value = Math.max(0, Math.min(1, level)); };
  const _p = new THREE.Vector3(), _d = new THREE.Vector3();
  api.update = (now) => {
    for (let i = globs.length - 1; i >= 0; i--) {
      const g = globs[i], k = Math.min(1, (now - g.t0) / Math.max(0.05, g.t1 - g.t0));
      _p.lerpVectors(g.from, g.to, k); _p.y += Math.sin(k * Math.PI) * 2.6;   // a lob (10-08: 4.5 took it over the camera)
      g.m.position.copy(_p); g.m.scale.setScalar(0.8 + 0.4 * Math.sin(now * 20 + i));
      // reaching the dome's edge: that's where it lands (the game decides blocked / through)
      _d.subVectors(_p, center); _d.y = Math.max(0, _d.y);
      if (!g.landed && (k >= 1 || _d.length() <= radius)) {
        g.landed = true;
        const blocked = api.onLand ? api.onLand(g.head) : false;
        api.burst(blocked ? _p.clone() : g.to.clone(), !blocked);
        if (blocked) hit = 1;
        root.remove(g.m); globs.splice(i, 1);
      }
    }
    const t = performance.now() / 1000;
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i], a = (t - b.t0) / 0.45;
      if (a >= 1) { root.remove(b.m); bursts.splice(i, 1); continue; }
      b.m.scale.setScalar(1 + a * b.big); b.m.material.opacity = 1 - a;
    }
    hit = Math.max(0, hit - 0.05); domeMat.uniforms.uHit.value = hit;
  };
  api.clear = () => { for (const g of globs) root.remove(g.m); globs.length = 0; };
  return api;
}
