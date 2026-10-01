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
  const a = Math.abs(offsetSec);
  if (a <= 0.020) return 1.0;
  if (a >= 0.150) return 0.15;
  const f = (a - 0.020) / (0.150 - 0.020);
  return 1.0 - f * (1.0 - 0.15);
}

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
  return { offset: t - best.time, beat: best.beat };
}

/** HIT within 50 ms; otherwise EARLY / LATE. */
export function label(offsetSec) {
  const a = Math.abs(offsetSec);
  if (a <= 0.050) return "HIT";
  return offsetSec < 0 ? "EARLY" : "LATE";
}
