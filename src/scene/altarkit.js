/* altarkit.js — ROUND 4's KIT on the altar (owner, 2026-10-09: "in the final battle I want the drums on the screen, much like we
   have it set up for the other lanes — let's not change it up too much"; 2026-10-11 after playing it: "SO confusing… both" — the
   cues AND the amount). What rounds 1-3 have, at the altar: real DRUMS in front of you (five, the courtyard kit's colours, a BIG
   key on each) and the five GUNS beside them. The cues are the game's own: a glowing COMET flies at its target and the target
   GLOWS UP as it closes — brightest right on the beat, dark again before the next one — the same pulse as the drums in the
   courtyard. Acid (the drums' cues) comes green out of the spitting head's mouth; the strikes (the guns' cues) come orange out of
   the attacking head's mouth. No ribbons, no lanes: one comet per note, one flash per hit.
     createAltarKit(scene, { spot, drums: [{ label, color }], guns: [{ label }], approach, fireTexture, fireSim })
       -> { update(items, now), press(col, good), setGunSource(vec3), setDrumSources(fn), targetPos(col), muzzle(g), remove() }
     items: [{ col, at }] — col 0..4 drums, 5..9 guns; at = the note's time on the same clock as `now` */
import * as THREE from "three";
import { createStation } from "./stations.js";

const label = (text) => {   // the courtyard drums' letter style: light, a dark outline — big
  const c = document.createElement("canvas"); c.width = 256; c.height = 128;
  const g = c.getContext("2d");
  g.font = `bold ${text.length > 3 ? 64 : 92}px sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
  g.strokeStyle = "#1a0f08"; g.lineWidth = 12; g.strokeText(text, 128, 66); g.fillStyle = "#f4e9d8"; g.fillText(text, 128, 66);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
};
const softDisc = () => {   // a radial glow for the comets and the target halos when the stage lends no fire texture
  const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32); grad.addColorStop(0, "rgba(255,255,255,1)"); grad.addColorStop(0.4, "rgba(255,255,255,0.6)"); grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
};
const PULSE = 0.3, OFF = 0.06;   // the target flash: charges over PULSE s before the beat, dark OFF s after (the courtyard's full-song pulse)

export function createAltarKit(scene, { spot, drums, guns, approach = 1.7, fireTexture = null, fireSim = null }) {
  const root = new THREE.Group(); root.name = "altar-kit"; scene.add(root);
  const glowTex = fireTexture || softDisc();
  const eye = new THREE.Vector3(spot.x, spot.y + 1.65, spot.z - 0.5);
  const targets = [];   // { pos, obj, mat, glow, color, spawn, drum }
  // DRUMS: two rows like the courtyard kit (top three, bottom two), left of centre, heads turned to your eye
  // (x as you SEE it, + = right; facing +z out to sea, world +x is your LEFT, so it is flipped where used)
  const drumPos = [[-1.25, 1.32, 1.25], [-0.85, 1.36, 1.3], [-0.45, 1.32, 1.25], [-1.05, 1.05, 0.95], [-0.62, 1.05, 0.95]];
  const halo = (color, size) => {   // the target's glow: a flat additive disc facing the eye, dark until a cue closes
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: glowTex, color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    m.scale.setScalar(size); m.renderOrder = 5; root.add(m); return m;
  };
  drums.forEach((d, i) => {
    const [x, y, z] = drumPos[i], g = new THREE.Group(); g.position.set(spot.x - x, spot.y + y, spot.z + z);
    const geo = new THREE.CylinderGeometry(0.16, 0.16, 0.24, 28).rotateX(Math.PI / 2);   // its axis along local z
    const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: new THREE.Color(d.color).multiplyScalar(0.45), roughness: 0.6, metalness: 0.15 })); g.add(body);
    const headMat = new THREE.MeshStandardMaterial({ color: 0x6a4a32, emissive: d.color, emissiveIntensity: 0.0, roughness: 0.8 });
    const head = new THREE.Mesh(new THREE.CircleGeometry(0.155, 28), headMat); head.position.z = 0.121; g.add(head);
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.17), new THREE.MeshBasicMaterial({ map: label(d.label), transparent: true, depthWrite: false }));
    lab.position.z = 0.124; g.add(lab);
    root.add(g); g.lookAt(eye);
    const h = halo(d.color, 0.9); h.position.copy(g.position); h.lookAt(eye);
    targets.push({ pos: g.position.clone(), obj: g, mat: headMat, glow: h, color: new THREE.Color(d.color), drum: true, spawn: g.position.clone().add(new THREE.Vector3(-x * 1.5, 1.6, 9)) });
  });
  // GUNS: a real gun STATION from stations.js (rounds 1-3's mortars, red strike buttons) with five mortars, on the altar to your right
  const st = createStation(scene, "bass", { lamp: false, slots: { bottom: [0, 1, 2, 3, 4], top: [] } });
  st.group.position.set(spot.x, spot.y, spot.z - 0.5); st.group.rotation.y = -Math.PI / 2; st.group.updateMatrixWorld(true);
  const muzzles = [];
  guns.forEach((gn, i) => {
    const b = st.bars[i]; if (!b || !b.top) return;
    if (b.label && b.label.material) { b.label.material.map = label(gn.label); b.label.material.needsUpdate = true; b.label.scale.setScalar(0.2); b.label.position.y += 0.12; }   // BIG keys (10-11)
    const pos = st.group.localToWorld(b.top.clone());
    muzzles.push(pos.clone().add(new THREE.Vector3(0, 0.25, 0.25)));
    const h = halo(0xff8a4a, 0.7); h.position.copy(pos).add(new THREE.Vector3(0, 0.05, 0)); h.lookAt(eye);
    targets.push({ pos, obj: null, mat: b.buttonMat, glow: h, color: new THREE.Color(0xff8a4a), drum: false, spawn: null });
  });
  // COMETS: a pool — a bright core + a soft glow sprite, the stage's fire simulation trailing behind when it's lent to us
  const comets = [], coreGeo = new THREE.SphereGeometry(0.07, 12, 8);
  const cometFor = (k, color) => {
    if (!comets[k]) {
      const g = new THREE.Group();
      const core = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9, fog: false }));
      glow.scale.setScalar(0.55); g.add(core, glow); root.add(g); comets[k] = { g, core, glow, id: "altar-comet-" + k };
    }
    comets[k].glow.material.color.set(color); comets[k].core.material.color.copy(comets[k].glow.material.color).lerp(new THREE.Color(0xffffff), 0.6);
    return comets[k];
  };
  const flashes = new Map();
  const _p = new THREE.Vector3(), _white = new THREE.Color(0xffffff), _c = new THREE.Color();
  return {
    root, station: st.group,
    /** the attacking head's mouth: the guns' cues fly from here */
    setGunSource(v) { for (const t of targets) if (!t.drum) { t.spawn = t.spawn || new THREE.Vector3(); t.spawn.copy(v); } },
    /** the acid's source: sourceOf(col) → the spitting head's mouth for that drum */
    setDrumSources(sourceOf) { targets.forEach((t, i) => { if (!t.drum) return; const v = sourceOf(i); if (!v) return; t.spawn = t.spawn || new THREE.Vector3(); t.spawn.copy(v); }); },
    targetPos: (col) => (targets[col] ? targets[col].pos.clone() : eye.clone()),
    muzzle: (g) => muzzles[g],
    /** draw the cues in flight (items: { col, at }) and the targets' glow */
    update(items, now) {
      let k = 0; const nearest = new Array(targets.length).fill(Infinity);
      for (const it of items) {
        const t = targets[it.col]; if (!t || !t.spawn) continue;
        const dt = it.at - now; if (Math.abs(dt) < Math.abs(nearest[it.col])) nearest[it.col] = dt;
        const u = 1 - dt / approach; if (u < 0 || u > 1.05) continue;
        _p.lerpVectors(t.spawn, t.pos, Math.min(1, u));
        const c = cometFor(k++, t.drum ? 0x9cff3a : 0xff9a50);   // drums: a glob of ACID; guns: the head's strike
        c.g.position.copy(_p); if (t.drum) c.g.position.y += Math.sin(Math.min(1, u) * Math.PI) * 0.6;   // the acid lobs
        c.g.visible = true; c.glow.scale.setScalar(0.4 + 0.5 * u); c.core.scale.setScalar(0.7 + 0.6 * u);
        if (fireSim && u < 1) fireSim.trail(c.id, c.g.position, 0.25 * (0.5 + u));
      }
      for (; k < comets.length; k++) if (comets[k]) { comets[k].g.visible = false; if (fireSim) fireSim.forget(comets[k].id); }
      const tn = performance.now();
      targets.forEach((t, i) => {
        // the glow: charges over PULSE s before the beat, white-hot on it, dark OFF s after — a flash per note, never a held glow
        const dt = nearest[i], ch = dt === Infinity ? 0 : dt >= 0 ? (dt > PULSE ? 0 : Math.pow(1 - dt / PULSE, 3)) : Math.max(0, 1 + dt / OFF);
        const f = flashes.get(i), on = f && f.until > tn, fl = on ? (f.until - tn) / 180 : 0;
        const a = Math.min(1, 0.95 * ch + fl);
        t.glow.material.opacity = a; t.glow.visible = a > 0.01;
        _c.copy(on ? (f.good ? _white : new THREE.Color(0xff3020)) : t.color).lerp(_white, 0.6 * ch * ch);
        t.glow.material.color.copy(_c); t.glow.scale.setScalar((t.drum ? 0.9 : 0.7) * (0.8 + 0.5 * ch + 0.4 * fl));
        if (t.obj) t.obj.scale.setScalar(on ? 1 + 0.12 * fl : 1);
        if (t.mat && t.mat.emissive) { t.mat.emissive.copy(on ? (f.good ? t.color : new THREE.Color(0xff3020)) : t.color); t.mat.emissiveIntensity = on ? 0.8 : 0.9 * ch; }
      });
    },
    press(col, good) { flashes.set(col, { until: performance.now() + 180, good }); },
    remove() { if (fireSim) for (const c of comets) if (c) fireSim.forget(c.id); scene.remove(root); scene.remove(st.group); },
  };
}
