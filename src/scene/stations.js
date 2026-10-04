/* stations.js — the two melody instruments around the player (drums are ahead):
 *   BASS   to the RIGHT (+x), bronze marimba bars
 *   TREBLE to the LEFT  (-x), silvery chime bars
 * Sixteen bars each in TWO ROWS OF EIGHT (owner, 2026-10-03), like a two-tier
 * marimba: the BOTTOM row (near, lower) = keys A S D F G H J K = the 8 pad
 * buttons; the TOP row (behind, well raised, tilted to face the player) =
 * Q W E R T Y U I = the same 8 buttons with LT held. Each row runs left ->
 * right. Resonator tubes, dark wooden frame.
 *
 * Each bar exposes `top` (centre of its striking face, world), `normal` (+y)
 * and `radius` — the same shape as a drum head, so arrows, hits and VR
 * striking can treat bars and drums alike. */
import * as THREE from "three";

export const BAR_Y = 0.86;        // top of the BOTTOM row (waist height); the top row sits ROW_RISE higher
export const BAR_NEAR = 0.55;     // distance from the player's centre to the bottom row's near edge
const ROW_RISE = 0.5, ROW_GAP = 0.03;   // top row well above the bottom: the rows read apart (tablets especially)
const TOP_TILT = 0.7;             // radians (~40°): the top row's face turns toward the player
const TOP_OVERLAP = 0.45;         // the top row starts this far back over the bottom row's bars (fraction of their length): close, not a second table
export const PER_ROW = 8, BARS = 16;
export const BAR_MID_Z = 0.6;     // the row's centre along z (behind the drum line: drums stay out of the stations' view)
const PITCH = 0.175;              // bar spacing along a row (8 bars ~1.4 m: within reach)
const BAR_W = 0.15, BAR_T = 0.04;

const KIND = {
  bass:   { side: +1, len: [0.34, 0.24], tube: [0.55, 0.28], bar: 0xd08a3e, metal: 0.7, rough: 0.45 },
  treble: { side: -1, len: [0.26, 0.17], tube: [0.30, 0.14], bar: 0xeae4d4, metal: 0.75, rough: 0.4 },
};

function labelTexture(text) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.lineWidth = 10; g.strokeStyle = "rgba(0,0,0,0.55)"; g.fillStyle = "#fff8ec";
  const DPAD = { dL: Math.PI, dD: Math.PI / 2, dR: 0, dU: -Math.PI / 2 };   // D-pad arrows, drawn (no font needed)
  if (text.startsWith("LT:")) {
    // a top-row pad label: the button, smaller, under a small "LT" (hold LT for this row)
    text = text.slice(3);
    g.font = "bold 34px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.lineWidth = 6; g.strokeText("LT", 64, 20); g.fillText("LT", 64, 20);
    g.translate(64, 76); g.scale(0.7, 0.7); g.translate(-64, -64); g.lineWidth = 10;
  }
  if (text in DPAD) {
    const a = DPAD[text], tri = [[44, 0], [-30, -36], [-30, 36]].map(([x, y]) => [64 + x * Math.cos(a) - y * Math.sin(a), 64 + x * Math.sin(a) + y * Math.cos(a)]);
    g.beginPath(); tri.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
    g.stroke(); g.fill();
  } else {
    g.font = "bold 84px system-ui, sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.strokeText(text, 64, 70); g.fillText(text, 64, 70);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * @param {THREE.Scene} scene
 * @param {"bass"|"treble"} kind
 * @param {{labels?: string[]}} opts
 */
export const KEY_LABELS = [..."ASDFGHJK", ..."QWERTYUI"];
export function createStation(scene, kind, { labels = KEY_LABELS, lamp: withLamp = true } = {}) {
  const K = KIND[kind];
  const s = K.side;   // +1 right (+x), -1 left (-x)
  const group = new THREE.Group();
  group.name = "station-" + kind;
  scene.add(group);
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.8 });

  const bars = [];
  // THE TOP ROW IS CANNONS (owner, 2026-10-03; placeholder until real assets):
  // a carriage you strike (its key on it) and a bronze barrel aimed outward and
  // up at the archers on the roofs; a hit, yours or the band's, fires a bolt
  // from the muzzle (defense.js). Same target shape as a bar: top / normal / radius.
  const cannonMat = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, metalness: 0.85, roughness: 0.35, emissive: 0x000000 });
  const carriageMat = new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.75 });
  // the BUTTON you hit (owner, 2026-10-03): in front of a mortar, at the back of a cannon —
  // the gun's strike point (top / normal / radius) sits on its cap
  const buttonMat = new THREE.MeshStandardMaterial({ color: 0x4a0c06, metalness: 0.3, roughness: 0.5, emissive: 0x000000 });
  const buttonRim = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, metalness: 0.85, roughness: 0.35 });
  function makeButton(rg, x, z, h = 0) {   // h: on a pedestal this tall (the shared column buttons stand clear of the mortars)
    if (h > 0) { const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, h, 12), carriageMat); ped.position.set(x, h / 2, z); ped.castShadow = true; rg.add(ped); }
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.046, 0.014, 20), buttonRim);
    rim.position.set(x, h + 0.007, z);
    const capMat = buttonMat.clone();   // its own: it lights red on its own
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.034, 0.016, 20), capMat);
    cap.position.set(x, h + 0.021, z);
    for (const m of [rim, cap]) { m.castShadow = true; m.receiveShadow = true; rg.add(m); }
    const p = new THREE.Vector3(x, h + 0.03, z); p.mat = capMat;
    return p;
  }
  // MORTARS on the bottom row: short and wide, angled up and a little outward, lobbing high
  function makeMortar(rg, i, z) {
    const mat = cannonMat.clone();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.05, 16), carriageMat);
    base.position.set(s * 0.13, 0.025, z);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.062, 0.17, 16), mat);
    barrel.rotation.z = -s * 0.35;   // up, leaning out
    barrel.position.set(s * 0.15, 0.13, z);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.054, 0.01, 8, 18), mat);
    lip.position.set(0, 0.085, 0); lip.rotation.x = Math.PI / 2;
    barrel.add(lip);
    for (const m of [base, barrel]) { m.castShadow = true; m.receiveShadow = true; rg.add(m); }
    const lab = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(labels[i]), transparent: true, depthWrite: false }));
    lab.scale.setScalar(0.085);
    rg.updateMatrixWorld(true);
    const top = new THREE.Vector3(), buttonMat = null;   // set to the column's shared button below
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(rg.quaternion);
    const muzzle = barrel.localToWorld(new THREE.Vector3(0, 0.1, 0));
    return { mesh: barrel, mat, label: lab, top, normal, radius: 0.05, len: 0.17, row: 0, mortar: true, muzzle, buttonMat };
  }
  // CRYSTALS (owner, 2026-10-04): at the TREBLE station the top row is crystals, not cannons —
  // hitting one charges the LIGHTNING GUN behind the station; charged, it strikes the boss
  const crystalMat = new THREE.MeshStandardMaterial({ color: 0x9fd4ff, metalness: 0.1, roughness: 0.15, emissive: 0x2a6fd0, emissiveIntensity: 0.9, transparent: true, opacity: 0.92 });
  function makeCrystal(rg, i, z, big = 1) {   // big: the BOSS's two crystals are large (owner, 2026-10-04)
    const mat = crystalMat.clone();   // its own: it flares when struck
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.09 * big, 0.1 * big, 0.04, 8), carriageMat);
    base.position.set(s * 0.14, 0.02, z);
    const prisms = [[0, 0, 0.26, 0.05], [0.05, 0.04, 0.17, 0.035], [-0.045, -0.04, 0.14, 0.03]].map(([dx, dz, h, r]) => {
      const m = new THREE.Mesh(new THREE.ConeGeometry(r * big, h * big, 6), mat);
      m.position.set(s * 0.14 + dx * big, 0.04 + h * big / 2, z + dz * big); m.rotation.y = dx * 7; m.rotation.z = -s * 0.12 + dx * 2;
      return m;
    });
    for (const m of [base, ...prisms]) { m.castShadow = true; m.receiveShadow = true; rg.add(m); }
    const lab = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(labels[i]), transparent: true, depthWrite: false }));
    lab.scale.setScalar(0.085);
    rg.updateMatrixWorld(true);
    const top = new THREE.Vector3(), buttonMat = null;   // set to the column's shared button below
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(rg.quaternion);
    const muzzle = prisms[0].localToWorld(new THREE.Vector3(0, 0.13 * big, 0));   // the tall crystal's tip
    const centre = prisms[0].getWorldPosition(new THREE.Vector3());
    return { mesh: prisms[0], parts: prisms, mat, label: lab, top, normal, radius: 0.05, len: 0.17, row: 1, crystal: true, muzzle, centre, buttonMat };
  }
  function makeCannon(rg, i, z) {
    const mat = cannonMat.clone();   // its own: it lights up on its own
    const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.05, 0.12), carriageMat);
    carriage.position.set(s * 0.13, 0.025, z);
    const wheelGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.015, 14);
    for (const dz of [-0.065, 0.065]) {
      const w = new THREE.Mesh(wheelGeo, carriageMat);
      w.rotation.x = Math.PI / 2;
      w.position.set(s * 0.16, 0.03, z + dz);
      rg.add(w);
    }
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.3, 16), mat);
    barrel.rotation.z = -s * (Math.PI / 2 - 0.25);   // the narrow end out and up
    barrel.position.set(s * 0.21, 0.1, z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.033, 0.008, 8, 18), mat);
    ring.position.set(0, 0.15, 0);
    ring.rotation.x = Math.PI / 2;
    barrel.add(ring);
    for (const m of [carriage, barrel]) { m.castShadow = true; m.receiveShadow = true; rg.add(m); }
    // its key floats just above the breech, always facing you (the barrel hid a flat one)
    const lab = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(labels[i]), transparent: true, depthWrite: false }));
    lab.scale.setScalar(0.085);
    rg.updateMatrixWorld(true);
    const top = new THREE.Vector3(), buttonMat = null;   // set to the column's shared button below
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(rg.quaternion);
    const muzzle = barrel.localToWorld(new THREE.Vector3(0, 0.17, 0));
    const touch = barrel.localToWorld(new THREE.Vector3(0, -0.13, 0)).addScaledVector(normal, 0.045);   // the touch-hole, on top of the breech: where the fuse starts
    return { mesh: barrel, mat, label: lab, top, normal, radius: 0.05, len: 0.17, row: 1, cannon: true, muzzle, touch, buttonMat };
  }
  // rows: bottom = bars 0-7 (near, low), top = bars 8-15 (behind, raised and
  // tilted toward the player). Within a row, left -> right as you face the
  // station: facing +x your left is -z; facing -x your left is +z.
  const ROW_DEPTH = K.len[0];   // the bottom row's longest bar
  const rowNear = [BAR_NEAR, BAR_NEAR + ROW_DEPTH * (1 - TOP_OVERLAP) + ROW_GAP];
  const rowY = [BAR_Y, BAR_Y + ROW_RISE];
  // each row is its own group, pivoting at its near edge: the top row's far end lifts
  const rowGroups = [0, 1].map((row) => {
    const g = new THREE.Group();
    g.position.set(s * rowNear[row], rowY[row], 0);
    g.rotation.z = row ? s * TOP_TILT : 0;
    group.add(g);
    return g;
  });
  const zLo = BAR_MID_Z - (PER_ROW - 1) / 2 * PITCH - BAR_W / 2 - 0.05, zHi = BAR_MID_Z + (PER_ROW - 1) / 2 * PITCH + BAR_W / 2 + 0.05;
  // ONE BUTTON PER COLUMN (owner, 2026-10-04): it sits in the middle, behind the mortar and under
  // the raised cannon, and serves BOTH guns of its column — the game picks which one fires
  const BTN_X = (rowNear[1] - rowNear[0]) + 0.06, BTN_H = 0.26, rg0 = rowGroups[0];   // up on a pedestal: clear of the mortars, under the raised cannons
  const shared = [];
  for (let j = 0; j < PER_ROW; j++) {
    const z = BAR_MID_Z + s * (j - (PER_ROW - 1) / 2) * PITCH;
    const btn = makeButton(rg0, s * BTN_X, z, BTN_H);
    rg0.updateMatrixWorld(true);
    shared.push({ top: btn.clone().applyMatrix4(rg0.matrixWorld), mat: btn.mat, normal: new THREE.Vector3(0, 1, 0).applyQuaternion(rg0.quaternion), z });
  }
  // a gun's key letter stands at the shared button: the bottom gun's low in front, the top gun's higher behind
  // the bottom gun's key letter stands over the shared button; the top gun's sits on the cannon itself (behind the rack's edge it hid)
  const labelAt = (i, lab) => { const row = i < PER_ROW ? 0 : 1, z = shared[i % PER_ROW].z;
    if (row) { lab.position.set(s * 0.0, 0.1, z); rowGroups[1].add(lab); } else { lab.position.set(s * (BTN_X - 0.07), BTN_H + 0.1, z); rg0.add(lab); } };
  for (let i = 0; i < BARS; i++) {
    const row = i < PER_ROW ? 0 : 1, j = i % PER_ROW;
    const z = BAR_MID_Z + s * (j - (PER_ROW - 1) / 2) * PITCH;
    const rg = rowGroups[row];
    // every bar is a GUN (owner, 2026-10-03): cannons on the top row, mortars on the bottom —
    // except the BOSS station's top row: TWO big crystals (owner, 2026-10-04), on bars 9 and 13,
    // between the columns; the other six top slots are stubs (nothing there, nothing plays them)
    const sh = shared[j];
    if (row === 1 && kind === "treble") {
      const isC = j === 0 || j === 4;
      if (isC) {
        const zc = BAR_MID_Z + s * ((j + 1.5) - (PER_ROW - 1) / 2) * PITCH;
        const b = makeCrystal(rg, i, zc, 2.2);
        b.top = b.centre.clone(); b.radius = 0.2; b.normal = new THREE.Vector3(0, 1, 0); b.buttonMat = sh.mat; b.column = j;
        b.label.scale.setScalar(0.12); b.label.position.set(s * 0.14, 0.72, zc); rg.add(b.label);   // its key, over the crystal
        bars.push(b);
      } else {
        const lab = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(""), transparent: true, depthWrite: false })); lab.visible = false;
        const stub = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), crystalMat.clone()); stub.visible = false; rg.add(stub);
        bars.push({ mesh: stub, mat: stub.material, label: lab, top: sh.top, normal: sh.normal, radius: 0.05, len: 0.17, row: 1, stub: true, muzzle: sh.top.clone(), buttonMat: sh.mat, column: j });
      }
      continue;
    }
    const b = row === 1 ? makeCannon(rg, i, z) : makeMortar(rg, i, z);
    b.top = sh.top; b.normal = sh.normal; b.buttonMat = sh.mat; b.column = j;
    labelAt(i, b.label);
    bars.push(b);
  }
  // THE TESLA TOWER (treble; owner, 2026-10-04: "make the orb a tesla tower, and shiny"): a tall
  // post ringed with copper coils, a mirror-bright sphere on top that fills with charge
  let lightning = null;
  if (kind === "treble") {
    const g = new THREE.Group();
    // smaller and off to the side, under the sightline to the boss (owner, 2026-10-04: "we need to see the monster")
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.07, 1.25, 12), carriageMat); post.position.y = 0.625;
    const coilMat = new THREE.MeshStandardMaterial({ color: 0xc8843a, metalness: 1.0, roughness: 0.25, emissive: 0x000000 });
    const rings = [[0.55, 0.19], [0.8, 0.16], [1.02, 0.13]].map(([y, r]) => { const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.02, 10, 32), coilMat); m.position.y = y; m.rotation.x = Math.PI / 2; return m; });
    const orbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1.0, roughness: 0.04, envMapIntensity: 1.8, emissive: 0x3a8cff, emissiveIntensity: 0.03 });   // CHROME
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.17, 32, 24), orbMat); orb.position.y = 1.42;
    for (const m of [post, ...rings, orb]) { m.castShadow = true; g.add(m); }
    g.position.set(s * (rowNear[1] + 0.55), 0, BAR_MID_Z + s * ((PER_ROW - 1) / 2 * PITCH + 0.45));   // past the right-hand end of the rack
    group.add(g); g.updateMatrixWorld(true);
    lightning = { group: g, orb, orbMat, coilMat, rings, pos: orb.getWorldPosition(new THREE.Vector3()) };
  }
  // frame: per row, two rails under the bar ends (tilting with the row) and legs to the floor
  for (let row = 0; row < 2; row++) {
    const rg = rowGroups[row];
    for (const d of [0.04, (row ? K.len[1] + 0.02 : K.len[0]) - 0.04]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, zHi - zLo), woodMat);
      rail.position.set(s * d, -BAR_T - 0.03, (zLo + zHi) / 2);
      rail.castShadow = true;
      rg.add(rail);
      rg.updateMatrixWorld(true);
      const railWorld = rail.getWorldPosition(new THREE.Vector3());
      for (const z of [zLo + 0.03, zHi - 0.03]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.045, railWorld.y, 0.045), woodMat);
        leg.position.set(railWorld.x, railWorld.y / 2, z);
        leg.castShadow = true;
        group.add(leg);
      }
    }
  }
  // a lantern for this station (no shadow: one shadow-casting lantern is enough)
  if (withLamp) {
    const lamp = new THREE.SpotLight(0xffb36a, 24, 6, Math.PI / 4, 0.6, 1.4);
    lamp.position.set(-s * 0.2, 2.6, BAR_MID_Z);
    lamp.target.position.set(s * (BAR_NEAR + 0.35), BAR_Y, BAR_MID_Z);
    group.add(lamp, lamp.target);
  }

  return {
    kind, group, bars, lightning,
    setLabels(texts) { bars.forEach((b, i) => { b.label.material.map.dispose(); b.label.material.map = labelTexture(texts[i]); b.label.material.needsUpdate = true; }); },
  };
}
