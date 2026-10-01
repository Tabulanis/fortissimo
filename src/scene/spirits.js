import * as THREE from 'three';

const STICK_RADIUS = 0.018;
const STICK_LENGTH = 0.42;
const IDLE_OPACITY = 0.35;
const ACTIVE_OPACITY = 0.55;
const FLASH_DECAY_MS = 150;

function makeStick(color) {
  const group = new THREE.Group();
  const geo = new THREE.CylinderGeometry(STICK_RADIUS, STICK_RADIUS, STICK_LENGTH, 8);
  // CylinderGeometry is centered; shift so the butt is at the pivot (origin).
  geo.translate(0, -STICK_LENGTH / 2, 0);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: ACTIVE_OPACITY,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  group.add(mesh);
  return { group, mat };
}

function makeGlowSprite(glowTexture, color) {
  const mat = new THREE.SpriteMaterial({
    map: glowTexture,
    color,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  return sprite;
}

export function createSpirits(scene, lanes, colors, glowTexture, drumMats) {
  const sticks = lanes.map((lane, i) => {
    const color = colors[i].clone();
    const { group, mat } = makeStick(color);

    // Pivot placement: far side of the drum, never blocking the head.
    let pivot;
    if (lane.upright) {
      pivot = new THREE.Vector3(lane.x, lane.y + 0.45, lane.z - 0.25);
    } else {
      pivot = new THREE.Vector3(lane.x, lane.y + 0.75, lane.z - 0.35);
    }
    group.position.copy(pivot);

    // Face/head point the stick tip must reach at impact.
    const face = new THREE.Vector3();
    if (lane.upright) {
      face.set(lane.x, lane.y, lane.z + lane.depth / 2 + 0.02);
    } else {
      face.set(lane.x, lane.y + lane.depth / 2 + 0.02, lane.z);
    }

    // Impact direction: from pivot to face point. The stick's local -Y axis
    // (the tip) must align with this direction at the impact angle.
    const impactDir = face.clone().sub(pivot);
    const reach = impactDir.length();
    impactDir.normalize();

    // Axis of rotation: perpendicular to impactDir. Pick a stable reference
    // (world X unless impactDir is parallel to it), then cross for the axis.
    const ref = Math.abs(impactDir.x) > 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const swingAxis = new THREE.Vector3().crossVectors(ref, impactDir).normalize();

    // Quaternion that rotates the stick's local tip axis (0,-1,0) onto impactDir.
    const tipAxis = new THREE.Vector3(0, -1, 0);
    const qImpact = new THREE.Quaternion().setFromUnitVectors(tipAxis, impactDir);

    // Idle orientation: stick tilted back ~50 deg from impact around swingAxis.
    const qIdleTilt = new THREE.Quaternion().setFromAxisAngle(swingAxis, -THREE.MathUtils.degToRad(50));
    const qIdleFinal = new THREE.Quaternion().copy(qImpact).multiply(qIdleTilt);

    // Two glow sprites along the stick (local space, tip at -Y).
    const glow1 = makeGlowSprite(glowTexture, color);
    glow1.position.set(0, -STICK_LENGTH * 0.25, 0);
    glow1.scale.setScalar(0.12);
    group.add(glow1);
    const glow2 = makeGlowSprite(glowTexture, color);
    glow2.position.set(0, -STICK_LENGTH * 0.75, 0);
    glow2.scale.setScalar(0.18);
    group.add(glow2);

    group.visible = false;
    scene.add(group);

    return {
      group,
      mat,
      glow1,
      glow2,
      pivot,
      face,
      swingAxis,
      qImpact,
      qIdleFinal,
      reach,
      lastHitTime: -Infinity,
      lastSeen: -Infinity,
      emissiveDecay: 0,
    };
  });

  // Per-lane flash sprite at the face point (created once).
  const flashes = lanes.map((lane, i) => {
    const face = sticks[i].face;
    const mat = new THREE.SpriteMaterial({
      map: glowTexture,
      color: colors[i].clone(),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(face);
    sprite.visible = false;
    scene.add(sprite);
    return { sprite, mat };
  });

  const tmpQ = new THREE.Quaternion();
  const tmpQ2 = new THREE.Quaternion();
  const tmpQ3 = new THREE.Quaternion();

  function easeIn(t) {
    return t * t;
  }
  function easeOut(t) {
    return 1 - (1 - t) * (1 - t);
  }

  function update(heardNow, ghosts) {
    // Index incoming ghosts by laneIdx.
    const byLane = new Map();
    for (const g of ghosts) {
      const key = g.laneIdx;
      const arr = byLane.get(key);
      if (!arr) {
        byLane.set(key, [g]);
      } else {
        // Keep the earliest upcoming hit for motion planning.
        if (g.time < arr[0].time) arr[0] = g;
      }
    }

    for (let i = 0; i < sticks.length; i++) {
      const s = sticks[i];
      const now = heardNow;
      const hits = byLane.get(i);
      // stretch the stick along its length so the tip lands exactly on the head
      // (min(1, L/reach) shrank it — the tip fell 0.38 m short)
      if (s.reach > 0) s.group.scale.set(1, s.reach / STICK_LENGTH, 1);

      if (hits && hits.length) {
        const next = hits[0];
        const T = next.time;
        const vel = next.velocity;

        s.lastSeen = now;

        if (now < T - 0.25) {
          // Idle with bob.
          const bob = Math.sin(now * 1.7 + i * 1.3) * 0.02;
          tmpQ.copy(s.qIdleFinal);
          tmpQ2.setFromAxisAngle(s.swingAxis, bob * 0.2);
          s.group.quaternion.copy(tmpQ).multiply(tmpQ2);
          s.mat.opacity += (IDLE_OPACITY - s.mat.opacity) * 0.1;
          s.group.visible = true;
        } else if (now < T - 0.12) {
          // Lift phase: from idle toward full back-swing (away from the drum).
          const t = (now - (T - 0.25)) / 0.13; // 0..1
          const liftScale = 0.35 + 0.65 * vel; // soft notes lift less
          const backAngle = THREE.MathUtils.degToRad(50) * liftScale * easeIn(t);
          tmpQ2.setFromAxisAngle(s.swingAxis, -backAngle);
          tmpQ.copy(s.qImpact).multiply(tmpQ2);
          s.group.quaternion.copy(tmpQ);
          s.mat.opacity += (ACTIVE_OPACITY - s.mat.opacity) * 0.25;
          s.group.visible = true;
        } else if (now < T) {
          // Swing down: from back-swing to impact (tip on face point at T).
          const t = (now - (T - 0.12)) / 0.12; // 0..1
          const liftScale = 0.35 + 0.65 * vel;
          tmpQ3.setFromAxisAngle(s.swingAxis, -THREE.MathUtils.degToRad(50) * liftScale);
          tmpQ.copy(s.qImpact).multiply(tmpQ3); // back orientation
          tmpQ.slerp(s.qImpact, easeIn(t));
          s.group.quaternion.copy(tmpQ);
          s.mat.opacity += (ACTIVE_OPACITY - s.mat.opacity) * 0.25;
          s.group.visible = true;
        } else if (now < T + 0.2) {
          // Rebound back to idle (ease-out).
          const t = (now - T) / 0.2; // 0..1
          tmpQ.copy(s.qImpact).slerp(s.qIdleFinal, easeOut(t));
          s.group.quaternion.copy(tmpQ);
          s.mat.opacity += (IDLE_OPACITY - s.mat.opacity) * 0.1;
          s.group.visible = true;
        } else {
          // After rebound, idle until the next planned hit arrives.
          const bob = Math.sin(now * 1.7 + i * 1.3) * 0.02;
          tmpQ.copy(s.qIdleFinal);
          tmpQ2.setFromAxisAngle(s.swingAxis, bob * 0.2);
          s.group.quaternion.copy(tmpQ).multiply(tmpQ2);
          s.mat.opacity += (IDLE_OPACITY - s.mat.opacity) * 0.1;
          s.group.visible = true;
        }

        // Impact: first frame heardNow crosses T.
        if (s.lastHitTime < T && now >= T) {
          s.lastHitTime = T;
          // Flash at the face point.
          const fl = flashes[i];
          fl.sprite.visible = true;
          fl.mat.opacity = 0.8 * vel + 0.2;
          const scale = 0.5 * vel + 0.2;
          fl.sprite.scale.setScalar(scale);
          // Emissive bump on the drum material (only raise, never lower).
          const dm = drumMats[i];
          if (dm) {
            dm.emissive.copy(colors[i]);
            if (dm.emissiveIntensity < 0.3 * vel) {
              dm.emissiveIntensity = 0.3 * vel;
            }
            s.emissiveDecay = now;
          }
        }
      } else {
        // No ghost hit for this lane right now: fade out after 2 s.
        if (now - s.lastSeen > 2.0) {
          s.mat.opacity *= 0.85;
          if (s.mat.opacity < 0.02) {
            s.group.visible = false;
          }
        } else {
          s.mat.opacity += (IDLE_OPACITY - s.mat.opacity) * 0.05;
        }
      }

      // Decay the flash.
      const fl = flashes[i];
      if (fl.sprite.visible) {
        fl.mat.opacity -= (1000 / FLASH_DECAY_MS) * 0.016;
        if (fl.mat.opacity <= 0.01) {
          fl.mat.opacity = 0;
          fl.sprite.visible = false;
        }
      }

      // Decay the emissive (only lower our own contribution).
      if (s.emissiveDecay > 0 && heardNow > s.emissiveDecay) {
        const age = (heardNow - s.emissiveDecay) * 1000;
        const dm = drumMats[i];
        if (dm) {
          const target = Math.max(0, 0.3 * (1 - age / FLASH_DECAY_MS));
          // Only lower if our bump is what's driving the intensity.
          if (dm.emissiveIntensity <= 0.3 || target < dm.emissiveIntensity) {
            if (target < dm.emissiveIntensity && age < FLASH_DECAY_MS) {
              dm.emissiveIntensity = target;
            }
          }
          if (age >= FLASH_DECAY_MS) s.emissiveDecay = 0;
        }
      }
    }
  }

  return { update };
}
