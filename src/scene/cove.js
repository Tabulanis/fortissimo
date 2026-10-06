/* cove.js — ROUND 4's place, blocked out (owner, 2026-10-06: "Clash of the Titans").
   Through the gate behind the player: a beach, the sea, cliffs closing in on both sides,
   a dock running out over the water with the DJ booth at its end, and a ship run up on
   the beach that the troops pour from. The hydra rises from the sea (not here yet).

   Placeholder geometry only — boxes and planes in the courtyard's colours — so the
   round can be built and played while the owner makes the real pieces. World frame:
   the back wall is at z = +8.6; the cove runs +z from there. Named groups so pieces can
   be swapped one at a time: "beach", "sea", "cliff-left", "cliff-right", "dock", "ship",
   "booth". BOOTH_POS is where the player stands for round 4. */
import * as THREE from "three";

export const COVE = { wallZ: 8.6, beachZ0: 9.6, beachZ1: 17, seaZ1: 90, halfWidth: 30 };
export const DOCK = { z0: 13, z1: 31, width: 2.6, y: 0.55 };
export const BOOTH_POS = new THREE.Vector3(0, 0, DOCK.z1 - 1.6);
export const SHIP_POS = new THREE.Vector3(15, 0, 42);   // run up on the sand spit ahead-right of the booth, in view

export function createCove(scene) {
  const root = new THREE.Group(); root.name = "cove"; scene.add(root);
  const sand = new THREE.MeshStandardMaterial({ color: 0xc9b48a, roughness: 1 });
  const rock = new THREE.MeshStandardMaterial({ color: 0x6e635a, roughness: 0.95 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a3220, roughness: 0.85 });
  const hull = new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.8 });
  const water = new THREE.MeshStandardMaterial({ color: 0x2a5e74, roughness: 0.3, metalness: 0.25 });   // placeholder: the pool's reflector later (metal with no env map went black)
  const box = (name, w, h, d, mat, x, y, z, ry = 0, parent = root) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.name = name;
    m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = m.receiveShadow = true; parent.add(m); return m;
  };
  // BEACH: a shelf of sand from the wall to the waterline, sloping down a touch
  const beach = new THREE.Mesh(new THREE.BoxGeometry(COVE.halfWidth * 2, 0.6, COVE.beachZ1 - COVE.beachZ0 + 1), sand);
  beach.name = "beach"; beach.position.set(0, -0.32, (COVE.beachZ0 + COVE.beachZ1) / 2); beach.rotation.x = 0.02; beach.receiveShadow = true; root.add(beach);
  // SEA: a wide sheet at the waterline
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(COVE.halfWidth * 2 + 40, COVE.seaZ1 - COVE.beachZ1 + 20), water);
  sea.name = "sea"; sea.rotation.x = -Math.PI / 2; sea.position.set(0, -0.15, (COVE.beachZ1 + COVE.seaZ1) / 2 + 10); root.add(sea);
  // the SAND SPIT the ship is run up on: a shelf along the right cliff, out past the dock
  const spit = new THREE.Mesh(new THREE.BoxGeometry(14, 0.6, 30), sand);
  spit.name = "spit"; spit.position.set(17, -0.3, 36); spit.rotation.y = 0.12; spit.receiveShadow = true; root.add(spit);
  // LIGHT for this side: every light in the game faces the sunset behind us, so the cove
  // gets a cool MOON over the sea (no shadows: cost) and a warm lantern over the booth
  const moon = new THREE.DirectionalLight(0x9fb4e0, 0.9); moon.position.set(-20, 30, 80); moon.target.position.set(0, 0, 20); root.add(moon, moon.target);
  const lantern = new THREE.SpotLight(0xffb36a, 30, 9, Math.PI / 3.5, 0.6, 1.4); lantern.position.set(0.4, 3.6, BOOTH_POS.z - 0.6); lantern.target.position.set(0, 1, BOOTH_POS.z + 0.6); root.add(lantern, lantern.target);
  // CLIFFS: stacked rough blocks either side, climbing as they go out, closing in a little
  for (const side of [-1, 1]) {
    const g = new THREE.Group(); g.name = side < 0 ? "cliff-left" : "cliff-right"; root.add(g);
    let seed = side * 7;
    const r = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let z = COVE.wallZ; z < COVE.seaZ1; z += 6) {
      const t = (z - COVE.wallZ) / (COVE.seaZ1 - COVE.wallZ);
      const h = 7 + 9 * t + r() * 3, x = side * (COVE.halfWidth - 6 * t + r() * 2);
      box("rock", 9 + r() * 4, h, 7 + r() * 2, rock, x, h / 2 - 1, z + 3, (r() - 0.5) * 0.3, g);
      box("rock", 5 + r() * 3, h * 0.55, 5, rock, x - side * (5 + r() * 2), h * 0.27 - 0.5, z + 1 + r() * 3, (r() - 0.5) * 0.4, g);
    }
  }
  // the beach's own flanks: lower rock so the cove reads closed next to the wall
  for (const side of [-1, 1]) box("spur", 8, 5, 10, rock, side * 14, 2.0, COVE.beachZ0 + 4);
  // DOCK: planks on posts, out over the water
  const dock = new THREE.Group(); dock.name = "dock"; root.add(dock);
  box("planks", DOCK.width, 0.16, DOCK.z1 - DOCK.z0, wood, 0, DOCK.y, (DOCK.z0 + DOCK.z1) / 2, 0, dock);
  for (let z = DOCK.z0 + 1; z < DOCK.z1; z += 3) for (const s of [-1, 1]) box("post", 0.22, DOCK.y + 1.2, 0.22, wood, s * (DOCK.width / 2 - 0.15), DOCK.y / 2 - 0.3, z, 0, dock);
  for (const s of [-1, 1]) box("rail", 0.08, 0.9, DOCK.z1 - DOCK.z0 - 2, wood, s * (DOCK.width / 2 - 0.1), DOCK.y + 0.55, (DOCK.z0 + DOCK.z1) / 2, 0, dock);
  // the BOOTH at the end of the dock: a table with three fader slots (placeholder for the DJ rig)
  const booth = new THREE.Group(); booth.name = "booth"; booth.position.copy(BOOTH_POS); root.add(booth);
  box("table", 2.0, 0.08, 0.7, wood, 0, DOCK.y + 0.95, 0.5, 0, booth);
  for (const s of [-1, 1]) box("leg", 0.1, 0.95, 0.6, wood, s * 0.9, DOCK.y + 0.48, 0.5, 0, booth);
  [-0.6, 0, 0.6].forEach((x, i) => {
    box("fader-slot", 0.12, 0.02, 0.5, new THREE.MeshStandardMaterial({ color: 0x1a1612 }), x, DOCK.y + 1.0, 0.5, 0, booth);
    box("fader-cap", 0.14, 0.06, 0.08, new THREE.MeshStandardMaterial({ color: [0xd9442a, 0x3a7ad9, 0xe8c640][i] }), x, DOCK.y + 1.03, 0.5 + 0.15, 0, booth);
  });
  // the SHIP: run up on the beach to the right, listing a little; a mast and a gangplank down to the sand
  const ship = new THREE.Group(); ship.name = "ship"; ship.position.copy(SHIP_POS); ship.rotation.set(0, 0.55, 0.12); root.add(ship);   // bow up the sand, stern to the sea
  box("hull", 5.5, 3.2, 16, hull, 0, 1.2, 0, 0, ship);
  box("deck", 5.0, 0.2, 15, wood, 0, 2.9, 0, 0, ship);
  box("prow", 1.6, 2.6, 2.4, hull, 0, 1.6, -8.6, 0, ship).rotation.y = Math.PI / 4;
  box("sterncastle", 4.6, 2.2, 3.6, hull, 0, 4.0, 6.2, 0, ship);
  box("mast", 0.3, 11, 0.3, wood, 0, 8.4, -1, 0, ship);
  box("yard", 7, 0.18, 0.18, wood, 0, 11.5, -1, 0, ship);
  box("sail", 6.6, 5.5, 0.06, new THREE.MeshStandardMaterial({ color: 0xd8cbb0, roughness: 1, side: THREE.DoubleSide }), 0, 8.4, -0.8, 0, ship);
  box("gangplank", 0.9, 0.08, 7, wood, -3.6, 1.4, 3, 0, ship).rotation.z = 0.42;
  return root;
}
