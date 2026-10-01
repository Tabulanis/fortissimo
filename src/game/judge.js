/* judge.js — pure timing judgment. No DOM, no audio. */

/**
 * Find the beat nearest to time t.
 * @param {number[]} beatTimes scheduled beat times (ascending)
 * @param {number} t the moment to judge (seconds, same clock)
 * @returns {{index: number, time: number, offset: number}}
 *   offset = t - time (negative = early)
 */
export function nearestBeat(beatTimes, t) {
  let index = 0;
  let best = Infinity;
  for (let i = 0; i < beatTimes.length; i++) {
    const d = Math.abs(t - beatTimes[i]);
    if (d < best) { best = d; index = i; }
  }
  return { index, time: beatTimes[index], offset: t - beatTimes[index] };
}

/**
 * Map timing error to a velocity (loudness/brightness) weight.
 * |offset| <= 0.020 -> 1.0 ; |offset| >= 0.150 -> 0.15 ; linear between.
 */
export function velocityFor(offsetSec) {
  const a = Math.abs(offsetSec);
  if (a <= 0.020) return 1.0;
  if (a >= 0.150) return 0.15;
  const f = (a - 0.020) / (0.150 - 0.020);
  return 1.0 - f * (1.0 - 0.15);
}

/** HIT within 50 ms; otherwise EARLY / LATE. */
export function label(offsetSec) {
  const a = Math.abs(offsetSec);
  if (a <= 0.050) return "HIT";
  return offsetSec < 0 ? "EARLY" : "LATE";
}
