/* braziers.js — BIG FIRE BASINS that light the town (owner, 2026-10-06: "it's dark").

   A stone pedestal and bowl at each spot. The fire is three layers, cheapest first:
     - a GLOW DISC on the paving (additive sprite, flat): the light on the ground, fake
     - a tall additive FLAME sprite: reads as fire from the far end of a court
     - the particle fire from fire.js (smoulder at the bowl) when the tier can afford it
   and a FIXED pool of real PointLights (fixed count = no shader rebuilds) that sit on the
   basins nearest the camera each frame, flickering — the stone, the drums and the guns
   nearby really are lit; the rest of the town gets the discs and the global fill.
   update(dt, camera, now) every frame. */
import * as THREE from "three";
import { ARMS, armToWorld } from "./courtyard.js";
import { DOCK, SHIP_POS } from "./cove.js";
import { register } from "./editables.js";

/** every basin's world spot: both colonnades of each court, a pair flanking each gate, the plaza corners */
export function brazierSpots() {
  const spots = [];
  for (const [name, A] of Object.entries(ARMS)) {
    const x = name === "drums" ? 5.3 : 4.8;   // the drums court's pool is 8.4 m wide: stand clear of its curb
    for (let z = -6; z > -A.length + 6; z -= 8) for (const s of [-1, 1]) spots.push(armToWorld(name, s * x, 0, z));
    for (const s of [-1, 1]) spots.push(armToWorld(name, s * 3.6, 0, -A.length + 4.2));   // flanking the gate
  }
  for (const x of [-6.2, 6.2]) for (const z of [-6.2, 6.2]) spots.push(new THREE.Vector3(x, 0, z));   // the plaza
  for (const x of [-3.2, 3.2]) spots.push(new THREE.Vector3(x, 0, DOCK.z0 - 1));                        // round 4: the dock's landward end, on the sand
  for (const x of [-1.25, 1.25]) spots.push(new THREE.Vector3(x, DOCK.y, DOCK.z1 - 3.2));              // and beside the booth, on the planks
  for (const dz of [-4, 4]) spots.push(new THREE.Vector3(SHIP_POS.x - 4.7, DOCK.y, SHIP_POS.z + dz));  // the landing: fires on the pier by the ship's gangplank
  return spots;
}

export function createBraziers(scene, { fireSim, fireTexture, flameTexture, layer = 0, lights = 4, particles = true, rate = 1 } = {}) {
  const spots = brazierSpots();
  const stone = new THREE.MeshStandardMaterial({ color: 0x9a8c7e, roughness: 0.9 });   // pale enough to catch the firelight (a dark bowl went black up close)
  const coals = new THREE.MeshStandardMaterial({ color: 0x2a1008, emissive: 0xff5a14, emissiveIntensity: 2.2, roughness: 1 });
  const pedestalGeo = new THREE.CylinderGeometry(0.34, 0.46, 1.0, 14);
  const bowlGeo = new THREE.CylinderGeometry(0.92, 0.5, 0.5, 18, 1, true);
  const bowlFloorGeo = new THREE.CircleGeometry(0.5, 18);
  const coalsGeo = new THREE.CircleGeometry(0.8, 18);
  const rimGeo = new THREE.TorusGeometry(0.92, 0.07, 8, 24);
  const glowGeo = new THREE.PlaneGeometry(1, 1);
  const group = new THREE.Group(); group.name = "braziers"; scene.add(group);
  // one basin (also used by the dev editor's palette: add() below)
  const makeBasin = (p, id, label) => {
    const g = new THREE.Group(); g.position.copy(p);
    const ped = new THREE.Mesh(pedestalGeo, stone); ped.position.y = 0.5; ped.castShadow = ped.receiveShadow = true;
    const bowl = new THREE.Mesh(bowlGeo, stone); bowl.position.y = 1.25; bowl.material.side = THREE.DoubleSide; bowl.castShadow = true;
    const floor = new THREE.Mesh(bowlFloorGeo, stone); floor.rotation.x = -Math.PI / 2; floor.position.y = 1.0;
    const coal = new THREE.Mesh(coalsGeo, coals); coal.rotation.x = -Math.PI / 2; coal.position.y = 1.36;
    const rim = new THREE.Mesh(rimGeo, stone); rim.rotation.x = Math.PI / 2; rim.position.y = 1.5;
    g.add(ped, bowl, floor, coal, rim);
    // the flame: a tall additive sprite over the bowl, stretched upward
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTexture, color: 0xff8a30, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85, fog: false }));
    flame.scale.set(1.2, 2.4, 1); flame.position.y = 2.5; flame.layers.set(layer); g.add(flame);
    // the light on the ground: a warm additive disc, flat on the paving
    const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({ map: flameTexture, color: 0xff7a2a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55, fog: false }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = 0.03; glow.scale.set(6.5, 6.5, 1); glow.layers.set(layer); g.add(glow);
    group.add(g);
    g.userData.model = "brazier";   // the editor can Duplicate it
    register(g, id, label);   // the dev editor can move / size / hide it
    return { g, pos: p, fire: new THREE.Vector3(p.x, p.y + 1.42, p.z), flame, glow, seed: Math.random() * 100 };
  };
  const basins = spots.map((p, bi) => makeBasin(p, `brazier#${bi}`, `fire basin ${bi + 1}`));
  const pool = [];
  for (let i = 0; i < lights; i++) { const l = new THREE.PointLight(0xff9a4a, 0, 13, 2); scene.add(l); pool.push(l); }
  const _d = new THREE.Vector3();
  return {
    get count() { return basins.length; },
    /** a new basin (the editor's palette); returns its group, registered under id */
    add(p, id, label = "fire basin (added)") { const b = makeBasin(p, id, label); basins.push(b); return b.g; },
    /** take an added basin out again */
    remove(g) { const i = basins.findIndex((b) => b.g === g); if (i >= 0) { basins.splice(i, 1); g.removeFromParent(); } },
    update(dt, camera, now) {
      const t = now / 1000;
      // flicker + the fire itself, nearest first so the particle budget goes where it shows
      for (const b of basins) {
        if (!b.g.visible) { b.dist = Infinity; continue; }        // hidden in the editor: no fire, no light
        b.g.localToWorld(b.fire.set(0, 1.42, 0));                  // follows the basin if the editor moved it
        const f = 0.82 + 0.18 * Math.sin(t * 9.1 + b.seed) * Math.sin(t * 5.3 + b.seed * 1.7);
        b.flame.material.opacity = 0.75 * f; b.flame.scale.set(1.4 + 0.2 * f, 2.3 + 0.5 * f, 1);
        b.glow.material.opacity = 0.16 + 0.06 * f;   // (10-08: the painted pool of light read fake — the real fire lights do the floor)
        b.dist = _d.copy(b.fire).distanceTo(camera.position);
        if (particles && fireSim && b.dist < 34) {
          const r = rate * (b.dist < 14 ? 1 : 0.45);   // far basins burn thinner: the sprite carries them
          fireSim.blaze(b.fire, 90 * r, dt, 0.5, 1);   // ~90 tall flames a second across the bowl (each wisp is faint; the fire is the overlap)
        }
      }
      if (pool.length) {
        const near = [...basins].sort((a, b) => a.dist - b.dist).slice(0, pool.length);
        near.forEach((b, i) => { const l = pool[i]; l.position.copy(b.fire).setY(b.fire.y + 0.25);   // just over the rim: the bowl's outside catches it too
          l.intensity = (16 + 4 * Math.sin(t * 11 + b.seed)) * (b.dist > 10 ? Math.max(0, 1 - (b.dist - 10) / 8) : 1); });
      }
    },
  };
}
