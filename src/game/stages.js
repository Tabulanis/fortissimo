/* stages.js — song parts. Pure data + helpers, no DOM.
 *
 * Lane indices (fixed): 0 hat, 1 snare, 2 crash (upright row);
 * 3 kick, 4 tomLow, 5 tomHigh (floor row).
 * Lane names are LAYOUT's names: "hat","snare","crash","kick","tom low","tom high".
 */

// SWING: the "and" of each beat lands 2/3 of the way through it (a triplet shuffle)
const SWING = 2 / 3;
const swing = (b) => (Math.abs((b % 1) - 0.5) < 1e-9 ? Math.floor(b) + SWING : b);
const notes = (lane, beats, swung = false) => beats.map((b) => ({ lane, beat: swung ? swing(b) : b }));

// Drums shown while each part is taught (same build-up every round)
const SHOW = [[3, 1], [3, 1, 0, 4], [3, 1, 0, 4, 2, 5], [3, 1, 0, 4, 2, 5]];
const ALL_DRUMS = [3, 1, 0, 4, 2, 5];
const parts = (list) => list.map((part, i) => ({ label: `Drums ${i + 1}`, mode: "drums", bars: 1, show: SHOW[i], part }));
/** a melody part: [slot 1..8, beat] pairs on the bass or treble bars, `bars` long */
const melody = (kind, bars, pairs, swung = false) => ({
  label: kind === "bass" ? "Bass" : "Treble", mode: kind, bars, show: ALL_DRUMS,
  part: pairs.map(([slot, b]) => ({ lane: `${kind} ${slot}`, beat: swung ? swing(b) : b })),
});

/** The game is 3 ROUNDS in the same arena, each graded on accuracy at the end
 *  (owner, 2026-10-02): 1 = singles; 2 = a more complex song, swung, singles;
 *  3 = a busier kick/snare combination with doubles in the closing fill.
 *  Each part is one bar; beats are quarter notes (0 = beat 1, 0.5 = its "and").
 *  Rounds 2 and 3 are PLACEHOLDER grooves following that brief — the owner
 *  writes the music. */
export const ROUNDS = [
  {
    name: "Round 1",
    title: "First Song",
    key: "C", scale: "major",
    parts: parts([
      notes("kick", [0, 2, 2.5]),                       // "boom ... boom-boom": 1, 3 and the "and" of 3
      notes("snare", [1, 3]),                           // backbeat on 2 and 4
      notes("hat", [0, 0.5, 1, 2, 2.5, 3, 3.5]),        // eighths with a breath before beat 3
      [{ lane: "crash", beat: 0 }, ...notes("tom high", [3]), ...notes("tom low", [3.5])],   // crash, then single toms
    ]).concat([
      // PLACEHOLDER melody (owner writes the music): 2-bar bass line, 2-bar tune
      melody("bass", 2, [[1, 0], [1, 1.5], [5, 2], [6, 3], [4, 4], [4, 5.5], [5, 6], [5, 7]]),
      melody("treble", 2, [[3, 0], [5, 1], [8, 2], [7, 3], [6, 4], [5, 5], [3, 6], [2, 7]]),
    ]),
  },
  {
    name: "Round 2",
    title: "Shuffle (placeholder)",
    swing: true,
    key: "A", scale: "minor",
    parts: parts([
      notes("kick", [0, 1.5, 2, 3.5], true),            // pushes on the swung "and"s
      notes("snare", [1, 2.5, 3], true),                 // backbeat plus a swung pickup
      notes("hat", [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], true),   // shuffled eighths
      [{ lane: "crash", beat: 0 }, ...notes("tom high", [3]), ...notes("tom low", [3.5], true)],
    ]).concat([
      melody("bass", 2, [[1, 0], [1, 1.5], [3, 2], [5, 3.5], [4, 4], [4, 5.5], [5, 6], [3, 7.5]], true),
      melody("treble", 2, [[5, 0], [6, 1.5], [5, 2], [3, 3], [4, 4], [3, 5.5], [2, 6], [1, 7]], true),
    ]),
  },
  {
    name: "Round 3",
    title: "Breakdown (placeholder)",
    key: "D", scale: "dorian",
    parts: parts([
      notes("kick", [0, 0.5, 1.5, 2, 2.5]),             // busier kick
      notes("snare", [1, 1.75, 3]),                      // backbeat with a sixteenth lead-in
      notes("hat", [0, 0.5, 1, 1.5, 2, 2.5]),            // hats drop out for the fill
      [{ lane: "crash", beat: 0 }, ...notes("tom high", [3, 3.25]), ...notes("tom low", [3.5, 3.75])],   // DOUBLES
    ]).concat([
      melody("bass", 2, [[1, 0], [1, 0.75], [1, 1.5], [3, 2], [4, 3], [5, 4], [5, 4.75], [4, 5.5], [3, 6], [2, 7]]),
      // a 4-bar phrase: long takes
      melody("treble", 4, [[5, 0], [6, 1], [7, 2], [8, 3], [7, 4.5], [6, 5], [5, 6], [3, 8], [4, 9], [5, 10], [6, 11.5], [5, 12], [4, 13], [2, 14], [1, 15]]),
    ]),
  },
];
/** the first round (older callers) */
export const SONG = ROUNDS[0];

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
export function isShown(song, stageIdx, laneIdx) {
  const part = song.parts[stageIdx];
  if (!part) return true;
  return part.show.includes(laneIdx);
}
