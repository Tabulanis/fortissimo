/* altarkit.js — ROUND 4's KIT on the altar (owner, 2026-10-09: "in the final battle I want the drums on the screen, much like we
   have it set up for the other lanes — let's not change it up too much"). What rounds 1-3 have, at the altar: real DRUMS in front of
   you (five, the courtyard kit's colours, the key + controller button on each head) and the five GUNS beside them, each with a CUE
   LANE: a glowing ball flies down the lane and lands on its target exactly on the beat. The drums' cues come in over the sea; the
   guns' cues come OUT OF THE ATTACKING HEAD's mouth (setGunSource) — the strike is coming at you.
     createAltarKit(scene, { spot, drums: [{ label, color }], guns: [{ label }], approach })
       -> { update(items, now), press(col, good), setGunSource(vec3), muzzle(g), remove() }
     items: [{ col, at }] — col 0..4 drums, 5..9 guns; at = the note's time on the same clock as `now` */
import * as THREE from "three";
import { createStation } from "./stations.js";

const label = (text) => {   // the courtyard drums' letter style: light, a dark outline
  const c = document.createElement("canvas"); c.width = 256; c.height = 128;
  const g = c.getContext("2d");
  g.font = `bold ${text.length > 4 ? 52 : 64}px sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
  g.strokeStyle = "#1a0f08"; g.lineWidth = 9; g.strokeText(text, 128, 66); g.fillStyle = "#f4e9d8"; g.fillText(text, 128, 66);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
};

export function createAltarKit(scene, { spot, drums, guns, approach = 1.7 }) {
  const root = new THREE.Group(); root.name = "altar-kit"; scene.add(root);
  const eye = new THREE.Vector3(spot.x, spot.y + 1.65, spot.z - 0.5);
  const targets = [];   // { pos, obj, mat, base, spawn, line }
  // DRUMS: two rows like the courtyard kit (top three, bottom two), left of centre, heads turned to your eye
  // (x as you SEE it, + = right; facing +z out to sea, world +x is your LEFT, so it is flipped where used — 10-09: it came out mirrored)
  const drumPos = [[-1.25, 1.32, 1.25], [-0.85, 1.36, 1.3], [-0.45, 1.32, 1.25], [-1.05, 1.05, 0.95], [-0.62, 1.05, 0.95]];
  drums.forEach((d, i) => {
    const [x, y, z] = drumPos[i], g = new THREE.Group(); g.position.set(spot.x - x, spot.y + y, spot.z + z);
    const geo = new THREE.CylinderGeometry(0.16, 0.16, 0.24, 28).rotateX(Math.PI / 2);   // its axis along local z
    const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: new THREE.Color(d.color).multiplyScalar(0.45), roughness: 0.6, metalness: 0.15 })); g.add(body);   // the colour in the shell, like the courtyard kit
    const headMat = new THREE.MeshStandardMaterial({ color: 0x6a4a32, emissive: d.color, emissiveIntensity: 0.0, roughness: 0.8 });   // a dark skin head (10-09: bright colour heads bloomed the letters away)
    const head = new THREE.Mesh(new THREE.CircleGeometry(0.155, 28), headMat); head.position.z = 0.121; g.add(head);
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.15), new THREE.MeshBasicMaterial({ map: label(d.label), transparent: true, depthWrite: false }));
    lab.position.z = 0.124; g.add(lab);
    root.add(g); g.lookAt(eye);
    targets.push({ pos: g.position.clone(), obj: g, mat: headMat, base: 0.0, glow: d.color, spawn: g.position.clone().add(new THREE.Vector3(-x * 1.5, 1.6, 9)) });
  });
  // GUNS (owner, 2026-10-09: "set up the guns and mortars the same way they are in the rest of the game — just 5"): a real gun
  // STATION from stations.js (rounds 1-3's mortars, red strike buttons, key labels) built with five mortars, then set on the
  // altar to your right, facing you. A station is built for a player at the origin facing +x with its row along +z (his right);
  // turned -90° about y and stood where you stand, that is your right side facing the sea.
  const st = createStation(scene, "bass", { lamp: false, slots: { bottom: [0, 1, 2, 3, 4], top: [] } });
  st.group.position.set(spot.x, spot.y, spot.z - 0.5); st.group.rotation.y = -Math.PI / 2; st.group.updateMatrixWorld(true);
  const muzzles = [];
  guns.forEach((gn, i) => {
    const b = st.bars[i]; if (!b || !b.top) return;
    if (b.label && b.label.material) { b.label.material.map = label(gn.label); b.label.material.needsUpdate = true; }
    const pos = st.group.localToWorld(b.top.clone());
    muzzles.push(pos.clone().add(new THREE.Vector3(0, 0.25, 0.25)));
    targets.push({ pos, obj: null, mat: b.buttonMat, base: 0, gun: true, spawn: null });
  });
  // LANES: a faint glowing line from each target's spawn to it (the guns' redrawn when the attacking head moves)
  const laneMat = (c) => new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
  targets.forEach((t, i) => {
    const geo = new THREE.BufferGeometry().setFromPoints([t.spawn || t.pos, t.pos]);
    t.line = new THREE.Line(geo, laneMat(i < drums.length ? drums[i].color : "#ff9a5a")); t.line.visible = !!t.spawn; root.add(t.line);
  });
  const setLine = (t) => { const a = t.line.geometry.attributes.position; a.setXYZ(0, t.spawn.x, t.spawn.y, t.spawn.z); a.setXYZ(1, t.pos.x, t.pos.y, t.pos.z); a.needsUpdate = true; t.line.visible = true; };
  // CUES: a pool of glowing balls
  const orbGeo = new THREE.SphereGeometry(0.06, 12, 8), orbs = [];
  const orbFor = (k, color) => {
    if (!orbs[k]) { const m = new THREE.Mesh(orbGeo, new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); root.add(m); orbs[k] = m; }
    orbs[k].material.color.set(color); return orbs[k];
  };
  const flashes = new Map();
  const _p = new THREE.Vector3();
  return {
    root, station: st.group,
    /** the attacking head's mouth: the guns' cues fly from here */
    setGunSource(v) { for (const t of targets) if (t.gun) { t.spawn = t.spawn || new THREE.Vector3(); t.spawn.copy(v); setLine(t); } },
    muzzle: (g) => muzzles[g],
    /** draw the cues in flight (items: { col, at }) and the targets' glow */
    update(items, now) {
      let k = 0;
      for (const it of items) {
        const t = targets[it.col]; if (!t || !t.spawn) continue;
        const u = 1 - (it.at - now) / approach; if (u < 0 || u > 1.05) continue;
        _p.lerpVectors(t.spawn, t.pos, Math.min(1, u));
        const o = orbFor(k++, it.col < drums.length ? drums[it.col].color : "#ffb070"); o.position.copy(_p); o.visible = true; o.scale.setScalar(0.7 + 0.6 * u);
      }
      for (; k < orbs.length; k++) if (orbs[k]) orbs[k].visible = false;
      const tn = performance.now();
      targets.forEach((t, i) => {   // a press pops the target and lights it (green-white good, red miss)
        const f = flashes.get(i), on = f && f.until > tn, s = on ? 1 + 0.12 * ((f.until - tn) / 140) : 1;
        if (t.obj) t.obj.scale.setScalar(s);
        if (t.mat.emissive) { t.mat.emissive.set(on ? (f.good ? (t.glow || 0xffffff) : 0xff3020) : (t.glow || 0x000000)); t.mat.emissiveIntensity = on ? 0.6 : t.base; }
      });
    },
    press(col, good) { flashes.set(col, { until: performance.now() + 140, good }); },
    remove() { scene.remove(root); scene.remove(st.group); },
  };
}
