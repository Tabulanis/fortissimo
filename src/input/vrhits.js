/* vrhits.js — VR drum hits: the drumhead IS the hit box.

   A hit = the stick tip crossing a drumhead's plane from the playing side,
   inside the head's circle. Loudness = how fast the tip was moving INTO the
   head at that moment (ghost notes to slams). One swing hits once: after a
   hit the drum ignores that stick until the tip has come back out above the
   head, and every drum has a short lockout for both sticks.

   Pure maths, no three.js: points are {x, y, z}; times are performance.now()
   ms (the XR frame time is on the same clock). The crossing time is
   interpolated between frames, so timing doesn't snap to the frame rate. */

export const LOCKOUT_MS = 45;        // per drum, any stick
export const REARM_M = 0.012;        // tip must rise this far above the head to strike again
export const RIM_SLACK = 1.15;       // forgive a little past the rim
export const SPEED_SOFT = 0.35;      // m/s into the head = the softest ghost note
export const SPEED_HARD = 3.5;       // m/s = full force

/** speed into the head (m/s) -> force 0..1 (on a curve: soft strokes keep detail) */
export function speedToForce(speed) {
  if (speed <= SPEED_SOFT) return 0.08;
  const u = Math.min(1, (speed - SPEED_SOFT) / (SPEED_HARD - SPEED_SOFT));
  return 0.08 + 0.92 * Math.sqrt(u);
}

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

/**
 * @param {{center:{x,y,z}, normal:{x,y,z}, radius:number}[]} heads  normal points toward the player's side
 */
export function createVrHits(heads) {
  const sticks = new Map();                    // stick id -> {tip, t, armed:Set of head idx}
  const lastHit = heads.map(() => -Infinity);

  return {
    /** forget a stick (controller lost tracking): no phantom hit when it reappears */
    drop(id) { sticks.delete(id); },
    /**
     * Feed one stick's tip position for this frame.
     * @returns {{head:number, force:number, speed:number, time:number}[]} hits this frame
     */
    step(id, tip, t) {
      const prev = sticks.get(id);
      const tipNow = { x: tip.x, y: tip.y, z: tip.z };
      if (!prev) {                               // first sight: arm only the heads it's above
        const armed = new Set();
        heads.forEach((h, i) => { if (dot(sub(tipNow, h.center), h.normal) > REARM_M) armed.add(i); });
        sticks.set(id, { tip: tipNow, t, armed });
        return [];
      }
      const hits = [];
      const dt = (t - prev.t) / 1000;
      heads.forEach((h, i) => {
        const d0 = dot(sub(prev.tip, h.center), h.normal);
        const d1 = dot(sub(tipNow, h.center), h.normal);
        if (d1 > REARM_M) prev.armed.add(i);
        if (!(prev.armed.has(i) && d0 > 0 && d1 <= 0 && dt > 0)) return;
        // where (and when) the tip crossed the plane
        const f = d0 / (d0 - d1);
        const p = {
          x: prev.tip.x + (tipNow.x - prev.tip.x) * f,
          y: prev.tip.y + (tipNow.y - prev.tip.y) * f,
          z: prev.tip.z + (tipNow.z - prev.tip.z) * f,
        };
        const off = sub(p, h.center);
        const along = dot(off, h.normal);
        const radial = Math.sqrt(Math.max(0, dot(off, off) - along * along));
        if (radial > h.radius * RIM_SLACK) return;          // went past the drum, not into it
        prev.armed.delete(i);
        const time = prev.t + (t - prev.t) * f;
        if (time - lastHit[i] < LOCKOUT_MS) return;
        lastHit[i] = time;
        const speed = (d0 - d1) / dt;
        hits.push({ head: i, force: speedToForce(speed), speed, time });
      });
      prev.tip = tipNow;
      prev.t = t;
      return hits;
    },
  };
}
