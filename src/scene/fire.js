/* fire.js — the fire simulation: flames, smoke and embers as particles.

   Every particle lives in world space with a position, velocity, age and
   life. Each frame the CPU moves them (buoyancy, turbulence, drag, gravity
   for embers) and the GPU draws them as camera-facing quads in two batches:
     flames + embers  additive, HDR-bright so the bloom catches them
     smoke            normally blended, dark, drawn first (behind the fire)
   Heat sets the colour: white-hot when born -> yellow -> orange -> deep red
   -> gone. A noise term in the shader tears each quad into a wisp, so the
   stream reads as flame, not as a row of round blobs.

   Emitters:
     trail(id, pos, scale)   call every frame for a flying arrow head; emits
                             evenly along the distance moved since last call,
                             so fast arrows leave an unbroken ribbon
     smoulder(pos, rate, dt) a small steady fire (stuck arrows, landed decoys)
     blaze(pos, rate, dt, radius, scale) a big steady fire (the braziers)
     burst(pos, power)       an impact: fireball, sparks, a puff of smoke
     steam(pos, power)       fire meets water: a hiss of steam that rises and drifts
     forget(id)              the arrow is gone: next trail() starts fresh */
import * as THREE from "three";

const FLAME = 0, EMBER = 1, SMOKE = 2, STEAM = 3;

const vert = /* glsl */ `
  attribute vec3 iPos;
  attribute vec4 iData;          // age 0..1, size (m), seed, kind
  varying vec2 vUv;
  varying float vAge, vSeed, vKind;
  void main() {
    vUv = position.xy + 0.5;
    vAge = iData.x; vSeed = iData.z; vKind = iData.w;
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    float rot = vSeed * 6.2832 + vAge * (vSeed - 0.5) * 4.0;     // each wisp turns as it rises
    float c = cos(rot), s = sin(rot);
    mv.xy += mat2(c, s, -s, c) * position.xy * iData.y;
    gl_Position = projectionMatrix * mv;
  }`;

const noise = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) { return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.1 + 3.7) + 0.15 * vnoise(p * 4.3 + 9.1); }`;

const fireFrag = /* glsl */ `
  varying vec2 vUv;
  varying float vAge, vSeed, vKind;
  uniform float uTime;
  ${noise}
  // heat ramp (linear HDR): white-hot -> yellow -> orange -> deep red -> black
  vec3 heat(float t) {
    vec3 c = mix(vec3(2.0, 1.7, 1.2), vec3(1.5, 0.8, 0.18), smoothstep(0.0, 0.25, t));
    c = mix(c, vec3(0.8, 0.2, 0.03), smoothstep(0.2, 0.5, t));
    c = mix(c, vec3(0.25, 0.03, 0.005), smoothstep(0.45, 0.85, t));
    return c;
  }
  void main() {
    vec2 d = vUv - 0.5;
    float r = length(d) * 2.0;
    if (vKind > 0.5) {                                   // EMBER: a hot flickering spark
      float core = smoothstep(1.0, 0.0, r);
      float flick = 0.6 + 0.4 * sin(uTime * 30.0 + vSeed * 50.0);
      vec3 col = mix(vec3(3.0, 1.9, 0.8), vec3(1.4, 0.35, 0.05), vAge) * flick;
      gl_FragColor = vec4(col, core * core * (1.0 - vAge));
    } else {                                             // FLAME: a torn, rising wisp
      float n = fbm(vUv * 2.6 + vec2(vSeed * 17.0, -vAge * 2.5 - uTime * 0.6));
      float shape = smoothstep(1.0, 0.15, r + (n - 0.5) * 0.9);
      float a = 0.25 * shape * pow(1.0 - vAge, 1.4) * smoothstep(0.0, 0.06, vAge + 0.02);
      gl_FragColor = vec4(heat(vAge + (n - 0.5) * 0.15), a);
    }
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const smokeFrag = /* glsl */ `
  varying vec2 vUv;
  varying float vAge, vSeed, vKind;
  uniform float uTime;
  ${noise}
  void main() {
    vec2 d = vUv - 0.5;
    float r = length(d) * 2.0;
    float n = fbm(vUv * 2.0 + vec2(vSeed * 11.0, -vAge * 1.5 - uTime * 0.2));
    float shape = smoothstep(1.0, 0.0, r + (n - 0.5) * 0.8);
    if (vKind > 2.5) {                                   // STEAM (kind 3): pale, soft, lit warm by the dusk — was > 1.5, which drew SMOKE (2) pale too (fixed 2026-10-06)
      float a = shape * shape * 0.2 * smoothstep(0.0, 0.08, vAge) * pow(1.0 - vAge, 1.8);   // wispy, thins as it spreads
      gl_FragColor = vec4(vec3(0.62, 0.58, 0.62), a);
    } else {
      float a = shape * 0.18 * smoothstep(0.0, 0.2, vAge) * (1.0 - vAge);
      gl_FragColor = vec4(vec3(0.06, 0.05, 0.05) + vec3(0.05, 0.02, 0.0) * (1.0 - vAge), a);
    }
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

/** one batch of particles: CPU arrays + an instanced quad mesh */
function makeBatch(max, material) {
  const P = {
    max, next: 0,
    pos: new Float32Array(max * 3), vel: new Float32Array(max * 3),
    age: new Float32Array(max), life: new Float32Array(max).fill(1),
    size0: new Float32Array(max), seed: new Float32Array(max), kind: new Float32Array(max),
    alive: new Uint8Array(max),
  };
  const geo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  geo.index = quad.index;
  geo.setAttribute("position", quad.getAttribute("position"));
  P.iPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
  P.iData = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("iPos", P.iPos);
  geo.setAttribute("iData", P.iData);
  geo.instanceCount = 0;
  P.geo = geo;
  P.mesh = new THREE.Mesh(geo, material);
  P.mesh.frustumCulled = false;   // particles are everywhere; the quad's own bounds mean nothing
  return P;
}

function spawn(P, x, y, z, vx, vy, vz, life, size, kind) {
  const i = P.next;
  P.next = (P.next + 1) % P.max;      // ring: when full, the oldest particle makes room
  P.pos[i * 3] = x; P.pos[i * 3 + 1] = y; P.pos[i * 3 + 2] = z;
  P.vel[i * 3] = vx; P.vel[i * 3 + 1] = vy; P.vel[i * 3 + 2] = vz;
  P.age[i] = 0; P.life[i] = life; P.size0[i] = size; P.seed[i] = Math.random(); P.kind[i] = kind;
  P.alive[i] = 1;
}

const rnd = (a, b) => a + Math.random() * (b - a);

export function createFire(scene, { layer = 0, maxFire = 14000, maxSmoke = 3000 } = {}) {
  const uniforms = { uTime: { value: 0 } };
  const fireMat = new THREE.ShaderMaterial({
    uniforms, vertexShader: vert, fragmentShader: fireFrag,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const smokeMat = new THREE.ShaderMaterial({
    uniforms, vertexShader: vert, fragmentShader: smokeFrag,
    transparent: true, depthWrite: false, blending: THREE.NormalBlending, fog: false,
  });
  const fire = makeBatch(maxFire, fireMat);
  const smoke = makeBatch(maxSmoke, smokeMat);
  smoke.mesh.renderOrder = 1;         // smoke first, flames over it
  fire.mesh.renderOrder = 2;
  for (const b of [smoke, fire]) { b.mesh.layers.set(layer); scene.add(b.mesh); }

  const last = new Map();            // emitter id -> {x,y,z, carry}

  /** emit along a moving head: ~one flame per 2.5 cm travelled */
  function trail(id, p, scale = 1) {
    const prev = last.get(id);
    if (!prev) { last.set(id, { x: p.x, y: p.y, z: p.z, carry: 0 }); return; }
    const dx = p.x - prev.x, dy = p.y - prev.y, dz = p.z - prev.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > 4) { prev.x = p.x; prev.y = p.y; prev.z = p.z; return; }   // teleported (recycled): no streak across the sky
    const spacing = 0.04 * Math.max(1, scale);
    let n = (dist + prev.carry) / spacing;
    const count = Math.min(60, Math.floor(n));
    prev.carry = (n - count) * spacing;
    // the flight direction, so fresh fire is flung back a little off the head
    const inv = dist > 1e-5 ? 1 / dist : 0;
    const bx = -dx * inv, by = -dy * inv, bz = -dz * inv;
    for (let k = 0; k < count; k++) {
      const t = (k + Math.random()) / Math.max(1, count);
      const x = prev.x + dx * t, y = prev.y + dy * t, z = prev.z + dz * t;
      const j = 0.035 * scale;
      spawn(fire, x + rnd(-j, j), y + rnd(-j, j), z + rnd(-j, j),
        bx * 0.6 + rnd(-0.35, 0.35), by * 0.6 + rnd(0.1, 0.6), bz * 0.6 + rnd(-0.35, 0.35),
        rnd(0.28, 0.55), rnd(0.16, 0.3) * scale, FLAME);
      if (Math.random() < 0.06) {
        spawn(fire, x, y, z, bx * 1.5 + rnd(-1.2, 1.2), rnd(0.2, 1.6), bz * 1.5 + rnd(-1.2, 1.2),
          rnd(0.5, 1.1), rnd(0.025, 0.045) * Math.max(1, scale * 0.6), EMBER);
      }
      if (Math.random() < 0.05) {
        spawn(smoke, x, y + 0.05, z, rnd(-0.2, 0.2), rnd(0.3, 0.7), rnd(-0.2, 0.2),
          rnd(1.2, 2.2), rnd(0.25, 0.45) * scale, SMOKE);
      }
    }
    prev.x = p.x; prev.y = p.y; prev.z = p.z;
  }

  /** a small steady fire at p: rate = flames per second */
  function smoulder(p, rate, dt, scale = 1) {
    let n = rate * dt;
    while (n > 0) {
      if (n < 1 && Math.random() > n) break;
      n -= 1;
      spawn(fire, p.x + rnd(-0.03, 0.03), p.y + rnd(0, 0.04), p.z + rnd(-0.03, 0.03),
        rnd(-0.15, 0.15), rnd(0.4, 1.0), rnd(-0.15, 0.15), rnd(0.25, 0.5), rnd(0.1, 0.2) * scale, FLAME);
      if (Math.random() < 0.08) spawn(fire, p.x, p.y, p.z, rnd(-0.6, 0.6), rnd(0.8, 2.0), rnd(-0.6, 0.6), rnd(0.5, 1.0), 0.03, EMBER);
      if (Math.random() < 0.15) spawn(smoke, p.x, p.y + 0.08, p.z, rnd(-0.1, 0.1), rnd(0.35, 0.6), rnd(-0.1, 0.1), rnd(1.4, 2.4), rnd(0.15, 0.3) * scale, SMOKE);
    }
  }

  /** a BIG steady fire (the braziers, 2026-10-06): flames born across a bowl of `radius`,
   *  tall and long-lived enough to clear the rim and lick a metre up, embers and smoke to match */
  function blaze(p, rate, dt, radius = 0.4, scale = 1) {
    let n = rate * dt;
    while (n > 0) {
      if (n < 1 && Math.random() > n) break;
      n -= 1;
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius;
      spawn(fire, p.x + Math.cos(a) * r, p.y + rnd(0, 0.1), p.z + Math.sin(a) * r,
        rnd(-0.25, 0.25), rnd(1.1, 2.2), rnd(-0.25, 0.25), rnd(0.55, 1.1), rnd(0.22, 0.42) * scale, FLAME);
      if (Math.random() < 0.12) spawn(fire, p.x, p.y + 0.2, p.z, rnd(-0.8, 0.8), rnd(1.5, 3.2), rnd(-0.8, 0.8), rnd(0.8, 1.6), 0.035, EMBER);
      if (Math.random() < 0.1) spawn(smoke, p.x, p.y + 0.5, p.z, rnd(-0.15, 0.15), rnd(0.6, 1.0), rnd(-0.15, 0.15), rnd(2.0, 3.5), rnd(0.35, 0.6) * scale, SMOKE);
    }
  }

  /** impact: a fireball blown out of the drumhead, sparks, smoke; power 0..1 */
  function burst(p, power = 1, toward = null) {
    const P = Math.max(0.25, Math.min(1, power));
    const n = Math.round(80 * P);
    for (let k = 0; k < n; k++) {
      // random direction, biased out of the head toward the player
      let x = rnd(-1, 1), y = rnd(-1, 1), z = rnd(-1, 1);
      const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
      if (toward) { x += toward.x * 0.8; y += toward.y * 0.8; z += toward.z * 0.8; }
      const sp = rnd(0.8, 3.2) * P;
      spawn(fire, p.x, p.y, p.z, x * sp, y * sp + 0.6, z * sp, rnd(0.25, 0.55), rnd(0.07, 0.18) * (0.6 + 0.6 * P), FLAME);
    }
    for (let k = 0; k < Math.round(70 * P); k++) {
      let x = rnd(-1, 1), y = rnd(-0.2, 1), z = rnd(-1, 1);
      const l = Math.hypot(x, y, z) || 1;
      const sp = rnd(2.5, 7) * P / l;
      if (toward) { x += toward.x; z += toward.z; }
      spawn(fire, p.x, p.y, p.z, x * sp, y * sp + 1.0, z * sp, rnd(0.5, 1.4), rnd(0.02, 0.05), EMBER);
    }
    for (let k = 0; k < Math.round(6 * P); k++) {
      spawn(smoke, p.x + rnd(-0.1, 0.1), p.y + rnd(0, 0.15), p.z + rnd(-0.1, 0.1),
        rnd(-0.4, 0.4), rnd(0.4, 1.0), rnd(-0.4, 0.4), rnd(1.5, 2.8), rnd(0.35, 0.7), SMOKE);
    }
  }

  /** fire meets water: a burst of steam that billows up and drifts; power 0..1 */
  function steam(p, power = 1) {
    const n = Math.round(80 * Math.max(0.3, power));
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, r = rnd(0, 0.15);
      spawn(smoke, p.x + Math.cos(a) * r, p.y + rnd(0, 0.05), p.z + Math.sin(a) * r,
        Math.cos(a) * rnd(0.2, 0.9), rnd(0.6, 1.8), Math.sin(a) * rnd(0.2, 0.9),
        rnd(1.8, 3.5), rnd(0.1, 0.24), STEAM);
    }
    // the last of the flame dies in the hiss
    for (let k = 0; k < 10; k++) {
      spawn(fire, p.x, p.y + 0.03, p.z, rnd(-0.5, 0.5), rnd(0.3, 1.0), rnd(-0.5, 0.5), rnd(0.15, 0.3), rnd(0.06, 0.12), FLAME);
    }
  }

  function forget(id) { last.delete(id); }

  let tSim = 0;
  /** move every particle by dt seconds and upload what's alive */
  function update(dt) {
    dt = Math.min(dt, 0.05);           // a stalled frame doesn't fling everything
    tSim += dt;
    uniforms.uTime.value = tSim;
    for (const B of [fire, smoke]) {
      let live = 0;
      const ip = B.iPos.array, id = B.iData.array;
      for (let i = 0; i < B.max; i++) {
        if (!B.alive[i]) continue;
        const a = (B.age[i] += dt / B.life[i]);
        if (a >= 1) { B.alive[i] = 0; continue; }
        const k = B.kind[i], s = B.seed[i] * 40;
        let vx = B.vel[i * 3], vy = B.vel[i * 3 + 1], vz = B.vel[i * 3 + 2];
        const x = B.pos[i * 3], y = B.pos[i * 3 + 1], z = B.pos[i * 3 + 2];
        if (k === EMBER) {
          vy -= 4.0 * dt;                                  // sparks arc down
          const drag = Math.exp(-0.9 * dt); vx *= drag; vy *= drag; vz *= drag;
        } else {
          // buoyancy + swirling turbulence (cheap curl-like field), then drag
          const lift = k === STEAM ? 0.5 : k === SMOKE ? 0.6 : 3.2;
          const turb = k === STEAM ? 1.0 : k === SMOKE ? 0.8 : 4.5;
          vy += lift * dt;
          vx += Math.sin(y * 3.1 + tSim * 4.3 + s) * turb * dt;
          vz += Math.cos(x * 2.7 + tSim * 3.7 + s * 1.3) * turb * dt;
          vy += Math.sin(z * 2.3 + tSim * 5.1 + s * 0.7) * turb * 0.4 * dt;
          const drag = Math.exp(-(k === SMOKE || k === STEAM ? 1.4 : 2.6) * dt); vx *= drag; vy *= drag; vz *= drag;
        }
        B.vel[i * 3] = vx; B.vel[i * 3 + 1] = vy; B.vel[i * 3 + 2] = vz;
        const nx = x + vx * dt, ny = Math.max(0.01, y + vy * dt), nz = z + vz * dt;
        B.pos[i * 3] = nx; B.pos[i * 3 + 1] = ny; B.pos[i * 3 + 2] = nz;
        // size over life: flames swell then lick away; smoke keeps spreading
        const g = k === STEAM ? 1 + a * 3.5 : k === SMOKE ? 1 + a * 2.2 : k === EMBER ? 1 - a * 0.5 : (1 + a * 1.4) * (1 - a * a * 0.6);
        ip[live * 3] = nx; ip[live * 3 + 1] = ny; ip[live * 3 + 2] = nz;
        id[live * 4] = a; id[live * 4 + 1] = B.size0[i] * g; id[live * 4 + 2] = B.seed[i]; id[live * 4 + 3] = k === EMBER ? 1 : k === STEAM ? 2 : 0;
        live++;
      }
      B.geo.instanceCount = live;
      B.iPos.addUpdateRange(0, live * 3); B.iData.addUpdateRange(0, live * 4);
      B.iPos.needsUpdate = true; B.iData.needsUpdate = true;
    }
  }

  return { trail, smoulder, blaze, burst, steam, forget, update, get count() { return fire.geo.instanceCount + smoke.geo.instanceCount; } };
}
