/* stages.js — song parts. Pure data + helpers, no DOM.
 *
 * Lane indices (fixed): 0 hat, 1 snare, 2 crash (upright row);
 * 3 kick, 4 tomLow, 5 tomHigh (floor row).
 * Lane names are LAYOUT's names: "hat","snare","crash","kick","tom low","tom high".
 */

export const SONG = {
  name: "First Song",
  parts: [
    // GROOVE (owner: "change up the beat instead of just steady"). Each part is
    // one bar; beats are quarter notes (0 = beat 1, 0.5 = its "and").
    {
      label: "Part 1",
      show: [3, 1],
      // kick: "boom ... boom-boom" — 1, 3 and the "and" of 3
      part: [0, 2, 2.5].map((b) => ({ lane: "kick", beat: b })),
    },
    {
      label: "Part 2",
      show: [3, 1, 0, 4],
      // snare backbeat on 2 and 4
      part: [1, 3].map((b) => ({ lane: "snare", beat: b })),
    },
    {
      label: "Part 3",
      show: [3, 1, 0, 4, 2, 5],
      // hats: eighths with a breath before beat 3 (the "and" of 2 is skipped)
      part: [0, 0.5, 1, 2, 2.5, 3, 3.5].map((b) => ({ lane: "hat", beat: b })),
    },
    {
      label: "Part 4",
      show: [3, 1, 0, 4, 2, 5],
      // crash on 1, then a 16th-note tom roll into the next bar
      part: [
        { lane: "crash", beat: 0 },
        { lane: "tom high", beat: 3 },
        { lane: "tom high", beat: 3.25 },
        { lane: "tom low", beat: 3.5 },
        { lane: "tom low", beat: 3.75 },
      ],
    },
  ],
};

/**
 * Every note of `part`, repeated every bar, mapped to timeline times.
 * Bar k >= 0: time = first + k*barDur + beat*beatDur.
 * Keeps times in [fromT, toT), sorted by time.
 * @returns {Array<{laneIdx: number, time: number}>}
 */
export function partArrows(part, laneIndexByName, first, barDur, beatDur, fromT, toT) {
  const out = [];
  const span = toT - first;
  const bars = Math.max(0, Math.ceil(span / barDur) + 1);
  for (let k = 0; k < bars; k++) {
    for (const n of part) {
      const time = first + k * barDur + n.beat * beatDur;
      if (time >= fromT && time < toT) {
        out.push({ laneIdx: laneIndexByName(n.lane), time });
      }
    }
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

/**
 * Is laneIdx shown during stageIdx? Past the last part, everything is shown.
 */
export function isShown(stageIdx, laneIdx) {
  const part = SONG.parts[stageIdx];
  if (!part) return true;
  return part.show.includes(laneIdx);
}
