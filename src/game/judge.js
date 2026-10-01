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
 * Judge against the beat GRID, which is known in advance — unlike the
 * scheduled-only beat list, this never misjudges an early press against the
 * previous beat.
 * @param {number} first time of beat index 0 (seconds)
 * @param {number} beatDur seconds per beat
 * @param {number} t the moment to judge (seconds, same clock)
 * @returns {{index: number, time: number, offset: number}}
 *   offset = t - time (negative = early)
 */
export function nearestOnGrid(first, beatDur, t) {
  let index = Math.round((t - first) / beatDur);
  if (index < 0) index = 0;
  const time = first + index * beatDur;
  return { index, time, offset: t - time };
}

/**
 * Map timing error to a velocity (loudness/brightness) weight.
 * |offset| <= 0.020 -> 1.0 ; |offset| >= 0.150 -> 0.15 ; linear between.
 */
export function velocityFor(offsetSec) {
  // Loudness is heard in decibels, not linear gain: a linear ramp left a note
  // 50 ms off at 80% (only ~2 dB down) and misses sounded nearly as loud as
  // blocks. Full volume when you block it (<= 20 ms), falling on a dB curve to
  // -24 dB at 150 ms. 50 ms off ~ -8 dB, 100 ms off ~ -17 dB.
  const a = Math.abs(offsetSec);
  if (a <= 0.020) return 1.0;
  if (a >= 0.150) return MISS_VEL;
  const x = (a - 0.020) / (0.150 - 0.020);
  return Math.pow(10, (-24 * Math.pow(x, 0.8)) / 20);
}

/** Velocity at / beyond the miss edge: -24 dB. */
export const MISS_VEL = Math.pow(10, -24 / 20);   // ~0.063

/** Velocity of an off-chart press (no note anywhere near): barely there, -30 dB. */
export const OFF_VEL = Math.pow(10, -30 / 20);    // ~0.032

/**
 * Judge a press against a repeating chart note.
 * The note at beat b in loop k (k >= 0) sounds at first + (k*loopBeats + b)*beatDur;
 * return the occurrence nearest to t. A press just before a loop boundary is
 * judged EARLY against beat 0 of the NEXT loop, not late against the last
 * note of the previous one.
 * @returns {{offset: number, beat: number} | null} offset = t - time (s, negative = early)
 */
export function nearestInLoop(beats, loopBeats, first, beatDur, t) {
  if (!beats.length) return null;
  const period = loopBeats * beatDur;
  const loops = Math.floor((t - first) / period);
  let best = null;
  for (let k = Math.max(0, loops - 1); k <= loops + 1; k++) {
    for (const b of beats) {
      const time = first + (k * loopBeats + b) * beatDur;
      const d = Math.abs(t - time);
      if (!best || d < best.d) best = { d, time, beat: b };
    }
  }
  return { offset: t - best.time, beat: best.beat, time: best.time };
}

/** HIT within 50 ms; otherwise EARLY / LATE. */
export function label(offsetSec) {
  const a = Math.abs(offsetSec);
  if (a <= 0.050) return "HIT";
  return offsetSec < 0 ? "EARLY" : "LATE";
}

/** A press farther than this from its lane's nearest note is OFF-CHART. */
export const OFF_CHART = 0.25; // seconds

/** Pure helper: true when the judge result marks an off-chart press. */
export function isOffChart(j) {
  return !j || Math.abs(j.offset) > OFF_CHART;
}
