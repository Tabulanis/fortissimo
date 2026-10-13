/* cove.js — ROUND 4's place, blocked out (owner, 2026-10-06: "Clash of the Titans").
   Through the gate behind the player: a wharf, the sea, cliffs closing in on both sides,
   a dock running out over the water with the podium at its end, and a ship moored to a
   pier on the right that the troops pour from (owner: a dock, not a beach — easier). The hydra rises from the sea (not here yet).

   Placeholder geometry only — boxes and planes in the courtyard's colours — so the
   round can be built and played while the owner makes the real pieces. World frame:
   the back wall is at z = +8.6; the cove runs +z from there. Named groups so pieces can
   be swapped one at a time: "beach", "sea", "cliff-left", "cliff-right", "dock", "ship",
   "booth". BOOTH_POS is where the player stands for round 4. */
import { gltfLoader } from "./gltf.js";
import * as THREE from "three";
import { bootlog } from "../bootlog.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createSea } from "./sea.js";
import { register } from "./editables.js";

export const COVE = { wallZ: 8.6, beachZ0: 9.6, beachZ1: 17, seaZ1: 90, halfWidth: 30 };
export const DOCK = { z0: 11, z1: 31, width: 2.6, y: 0.55 };   // (10-07: starts at the landing — the wide wharf is gone)
export const BOOTH_POS = new THREE.Vector3(0, 0, DOCK.z1 - 1.6);
export const SHIP_POS = new THREE.Vector3(14.2, -0.9, 33);   // moored alongside the right pier, afloat

export function createCove(scene) {
  const root = new THREE.Group(); root.name = "cove"; scene.add(root);
  const sand = new THREE.MeshStandardMaterial({ color: 0xc9b48a, roughness: 1 });
  const rock = new THREE.MeshStandardMaterial({ color: 0x6e635a, roughness: 0.95 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a3220, roughness: 0.85 });
  const hull = new THREE.MeshStandardMaterial({ color: 0x6a4630, roughness: 0.8 });   // near-black went invisible at night
  const water = new THREE.MeshStandardMaterial({ color: 0x2a5e74, roughness: 0.3, metalness: 0.25 });   // placeholder: the pool's reflector later (metal with no env map went black)
  const box = (name, w, h, d, mat, x, y, z, ry = 0, parent = root) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.name = name;
    m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = m.receiveShadow = true; parent.add(m); return m;
  };
  // (10-08: the box wharf/landing, box dock and box side pier are GONE — his dock (below) replaces them; he lays it out in the editor)
  // SEA: sea.js — swell, sky-fresnel, moon glint, ripple rings; stage3d ticks it and the hydra ripples it
  const SEA_FAR = 230;   // (10-08: the sea runs out to the draw distance, then the sky dome's painted sea takes over)
  const sea = createSea(scene, { x: 0, z: COVE.wallZ + SEA_FAR / 2, width: SEA_FAR * 2, depth: SEA_FAR, y: -0.15 });   // from the wall out
  root.userData.sea = sea;
  // LIGHT for this side: every light in the game faces the sunset behind us, so the cove
  // gets a cool MOON over the sea (no shadows: cost) and a warm lantern over the booth
  const moon = new THREE.DirectionalLight(0x9fb4e0, 1.6); moon.position.set(-20, 30, 80); moon.target.position.set(0, 0, 20); root.add(moon, moon.target);
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
  for (const side of [-1, 1]) box("spur", 8, 5, 10, rock, side * 14, 2.0, COVE.beachZ0 + 4).name = "spur";
  // HIS CLIFFS + RUINS (2026-10-07) replace the placeholder box cliffs, which stay built but hidden
  for (const n of ["cliff-left", "cliff-right"]) { const o = root.getObjectByName(n); if (o) o.visible = false; }
  root.traverse((o) => { if (o.name === "spur") o.visible = false; });
  const placeModel = (url, spots, height) => gltfLoader().load(url, (gltf) => {
    const src = gltf.scene; src.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(src), size = bb.getSize(new THREE.Vector3()), k = height / size.y;
    spots.forEach(({ x, y = 0, z, yaw = 0, s = 1, id, label }) => {
      const pivot = new THREE.Group(); pivot.name = id; pivot.position.set(x, y, z); pivot.rotation.y = yaw; pivot.scale.setScalar(s);
      const m = src.clone(true); m.scale.setScalar(k);
      m.position.set(-(bb.min.x + bb.max.x) / 2 * k, -bb.min.y * k, -(bb.min.z + bb.max.z) / 2 * k);   // base centre on the pivot
      m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      pivot.add(m); root.add(pivot); pivot.userData.model = url.split("/").pop().replace(".glb", ""); register(pivot, id, label);
    });
  }, undefined, (e) => console.warn(url + " failed to load", e));
  // the cliffs: five down each side, long axis along the shore, each turned and sized a little differently,
  // their bases a metre under the water; the cove closes in and rises toward the open sea
  const cliffSpots = [];
  for (const side of [-1, 1]) for (let i = 0; i < 5; i++) {
    const z = COVE.beachZ0 + 6 + i * 16, t = i / 4, jit = Math.sin(i * 7.3 + side * 2.1);
    cliffSpots.push({ x: side * (COVE.halfWidth - 3 - 5 * t + jit * 1.5), y: -1.0, z, yaw: side * Math.PI / 2 + jit * 0.18, s: 1.0 + 0.35 * t + 0.1 * jit,
      id: `cliff-${side < 0 ? "R" : "L"}${i}`, label: `cliff ${side < 0 ? "right" : "left"} ${i + 1}` });   // from the podium world -x is on your RIGHT
  }
  placeModel("/models/Cliffs.glb", cliffSpots, 9);
  // the RUINS: a fort on a crag, the headland opposite the ship (your right from the podium), over the hydra
  placeModel("/models/Ruins.glb", [{ x: -22, y: -1.0, z: 50, yaw: Math.PI / 2, id: "ruins", label: "ruins" }], 16);
  // the BOOTH at the end of the dock: a table with three fader slots (placeholder for the DJ rig)
  const booth = new THREE.Group(); booth.name = "booth"; booth.position.copy(BOOTH_POS); root.add(booth);
  booth.visible = false;   // (10-08: the ALTAR is the play area now — the old podium table stays built, hidden; the editor can unhide it)
  box("table", 2.0, 0.08, 0.7, wood, 0, DOCK.y + 0.95, 0.5, 0, booth);
  for (const s of [-1, 1]) box("leg", 0.1, 0.95, 0.6, wood, s * 0.9, DOCK.y + 0.48, 0.5, 0, booth);
  [-0.6, 0, 0.6].forEach((x, i) => {
    box("fader-slot", 0.12, 0.02, 0.5, new THREE.MeshStandardMaterial({ color: 0x1a1612 }), x, DOCK.y + 1.0, 0.5, 0, booth);
    box("fader-cap", 0.14, 0.06, 0.08, new THREE.MeshStandardMaterial({ color: [0xd9442a, 0x3a7ad9, 0xe8c640][i] }), x, DOCK.y + 1.03, 0.5 + 0.15, 0, booth);
  });
  // the SHIP: run up on the beach to the right, listing a little; a mast and a gangplank down to the sand
  const ship = new THREE.Group(); ship.name = "ship"; ship.position.copy(SHIP_POS).add(new THREE.Vector3(0, -0.35, 0)); ship.rotation.set(0, 0.04 + Math.PI / 2, 0.03); root.add(ship);
  // (10-08: turned HERE, not on load — a saved edit must not get the turn twice) the model's length along the pier, keel ~1.2 m under  (was: alongside the pier, a slight roll)
  // (10-08: the box hull, deck, mast, sail and gangplank are gone — his ship below is the ship)
  // HIS DOCK (2026-10-08, his newdock.glb → public/models/NewDock.glb): a stone landing with steps at one end,
  // a plank pier with a crane at the other. Its length runs along its x: turned so the stone sits at the gate and the pier
  // runs out to the podium, scaled to reach from the wall to just past the podium; its DECK (measured: 1.92 units above the
  // posts' feet, the pier's centre line at z -0.25) at the old dock's plank height, so the podium and camera stay put.
  // Both are built in the PALETTE's layout (props.js: the model base-centred and unturned inside its pivot; turn and place
  // on the pivot), so Duplicate / Mirror copy — which rebuild through props.js — come out exactly like them (10-08).
  const propLayout = (src, k) => {   // props.js spawn(), the same maths
    src.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(src);
    src.scale.setScalar(k); src.position.set(-(bb.min.x + bb.max.x) / 2 * k, -bb.min.y * k, -(bb.min.z + bb.max.z) / 2 * k);
    src.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return bb;
  };
  gltfLoader().load("/models/NewDock.glb", (gltf) => {
    const src = gltf.scene; src.updateMatrixWorld(true);
    const len = new THREE.Box3().setFromObject(src).getSize(new THREE.Vector3()).x, k = 23 / len;   // = props FIT NewDock { width: 23 }
    const bb = propLayout(src, k), cz = (bb.min.z + bb.max.z) / 2;
    const DECK_ABOVE_FEET = 1.92, PIER_Z = -0.25, deckY = DOCK.y + 0.08;
    const pivot = new THREE.Group(); pivot.name = "newdock"; pivot.rotation.y = -Math.PI / 2;   // its +x (toward the crane) → world +z
    pivot.position.set((PIER_Z - cz) * k, deckY - DECK_ABOVE_FEET * k, COVE.wallZ + len * k / 2);   // stone end at the wall, pier on x = 0
    pivot.add(src); root.add(pivot); pivot.userData.model = "NewDock";
    register(pivot, "cove-newdock", "dock (his)");
    bootlog("placed NewDock.glb", { scale: +k.toFixed(2), length: +(len * k).toFixed(1), deckY });
  }, undefined, (e) => console.warn("NewDock.glb failed to load", e));
  // HIS ALTAR (2026-10-08, his alter.glb → public/models/Altar.glb): "put that at the end of the dock — I'll move it —
  // that will be the end hydra play area". A stepped stone altar rising out of the water past the dock's end, its stairs facing
  // the dock. ROUND 4 IS PLAYED ON ITS TOP, wherever he moves it: stage3d.playSpot() reads root.userData.altar.
  gltfLoader().load("/models/Altar.glb", (gltf) => {
    const src = gltf.scene; src.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(src).getSize(new THREE.Vector3()), k = 7 / size.x;   // = props FIT Altar { width: 7 }
    propLayout(src, k);
    const pivot = new THREE.Group(); pivot.name = "altar"; pivot.rotation.y = Math.PI;   // its stairs (+z in the file) toward the dock
    pivot.position.set(0, -0.6, DOCK.z1 + 0.6 + 3.6);   // just past the dock's end, its base under the water
    pivot.userData.topY = size.y * k;                    // its top, in the pivot's own units (the editor's size scales it)
    pivot.add(src); root.add(pivot); pivot.userData.model = "Altar";
    register(pivot, "cove-altar", "altar (round 4 play area)");
    root.userData.altar = pivot;
    bootlog("placed Altar.glb", { scale: +k.toFixed(2), top: +(pivot.position.y + size.y * k).toFixed(2) });
  }, undefined, (e) => console.warn("Altar.glb failed to load", e));
  gltfLoader().load("/models/AncientShip.glb", (gltf) => {
    const src = gltf.scene; src.updateMatrixWorld(true);
    const k = 16 / new THREE.Box3().setFromObject(src).getSize(new THREE.Vector3()).x;   // = props FIT AncientShip { width: 16 }
    propLayout(src, k);
    ship.add(src); ship.userData.model = "AncientShip";
    bootlog("placed AncientShip.glb", { scale: +k.toFixed(2) });
  }, undefined, (e) => console.warn("AncientShip.glb failed to load", e));
  // the dev editor may move / size / hide these (pieces whose parts sit at world coords — wharf, dock,
  // pier, cliffs — turn about the cove's origin, so for those MOVE is the useful tool)
  for (const [name, label] of [["ship", "ship"], ["booth", "podium"]]) {
    const o = root.getObjectByName(name); if (o) register(o, `cove-${name}`, label);
  }
  return root;
}
