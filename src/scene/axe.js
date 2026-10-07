/* axe.js — the minotaurs' AXE (owner, 2026-10-07: "give them axes so they can attack us"):
   a placeholder two-bitted axe on a long haft, locked to a Mixamo skeleton's right-hand bone
   so it swings with the slash clip. Swap in a Meshy axe later: keep AXE_GRIP, replace build(). */
import * as THREE from "three";

// how the haft sits in the fist, in the hand bone's own space — tuned by eye in the viewer
// (/dev/models.html?m=MinotaurRig&clip=Right_Hand_Sword_Slash&axe=1)
export const AXE_GRIP = { pos: new THREE.Vector3(-0.03, 0.08, 0), rot: new THREE.Euler(Math.PI / 2, 0, 0) };
// WALKING / RUNNING (owner, 2026-10-07: "held so it points up, not through the minotaur"): the arm hangs,
// the fingers (+Y) point down — so the haft goes up the opposite way, tipped forward past the forearm
// Solved, not guessed: the Walking clip was evaluated on the skeleton (mid-stride the hand's local axes
// are X fwd-up, Y down-fwd, Z across the body) and the haft aimed at world up + a little forward + a
// little outward, expressed in hand space = (0.71, -0.65, -0.26); the same grip reads upright in Running.
// (A first guess, Euler(PI - 0.45, 0, 0), sent the haft up into his back — only the pommel showed.)
export const AXE_GRIP_CARRY = { pos: new THREE.Vector3(-0.03, 0.08, 0.02),
  quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.71, -0.65, -0.26).normalize()) };
const _qb = new THREE.Quaternion();
/** blend an attached axe between the carry grip (t = 0) and the chop grip (t = 1) */
export function setAxeGrip(axe, t) {
  const _qa = AXE_GRIP_CARRY.quat; _qb.setFromEuler(AXE_GRIP.rot);
  axe.quaternion.slerpQuaternions(_qa, _qb, t); axe.position.lerpVectors(AXE_GRIP_CARRY.pos, AXE_GRIP.pos, t);
}   // haft on the hand bone's Z (forward through the fist), into the palm (-X)

const wood = new THREE.MeshStandardMaterial({ color: 0x4a2e1a, roughness: 0.85 });
const iron = new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.85, roughness: 0.35 });
const shape = new THREE.Shape();
shape.moveTo(0, -0.09); shape.quadraticCurveTo(0.2, -0.2, 0.26, 0); shape.quadraticCurveTo(0.2, 0.2, 0, 0.09); shape.lineTo(0, -0.09);
const bladeGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1 }).translate(0, 0, -0.0125);
const haftGeo = new THREE.CylinderGeometry(0.022, 0.026, 1.0, 10);

function build() {
  const axe = new THREE.Group(); axe.name = "axe";
  const haft = new THREE.Mesh(haftGeo, wood); haft.position.y = 0.25; axe.add(haft);   // the fist near the haft's lower end
  for (const sx of [1, -1]) { const b = new THREE.Mesh(bladeGeo, iron); b.scale.x = sx; b.position.y = 0.68; axe.add(b); }
  axe.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  return axe;
}
/** put an axe in a skinned model's right hand; returns it (or null if there is no such bone) */
export function attachAxe(root, grip = AXE_GRIP) {
  // three's GLTFLoader sanitizes node names ("mixamorig:RightHand" -> "mixamorigRightHand"): accept either
  const hand = root.getObjectByName("mixamorigRightHand") || root.getObjectByName("mixamorig:RightHand");
  if (!hand) return null;
  const axe = build(); axe.position.copy(grip.pos); axe.rotation.copy(grip.rot);
  hand.add(axe); return axe;
}
