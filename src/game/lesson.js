/* lesson.js — how the game TEACHES a round's song (owner, 2026-10-02/03). Pure.
 *
 * The song file is the whole song; the game breaks it into steps by a rule:
 *   ORDER     drums (bass drum, snare, hihat, crash, toms), then bass (bottom
 *             row, top row), then treble (bottom, top) — the three SECTIONS
 *   LOOP      each instrument is taught as the pattern it REPEATS: a kick that
 *             repeats every bar is a 1-bar step the bell loops, not a few hits
 *             spread across the whole song (2026-10-03: "1 hit and waiting
 *             forever"). Non-repeating phrases loop at their full length.
 *   STEP SIZE at most N notes per step, by difficulty: Easy 4, Normal 6,
 *             Hard and Expert 8 — a pattern bigger than that is split, the
 *             most important notes first (bar downbeats, beat 3, the other
 *             beats, off-beats, finer); each next step fills in over the ghosts
 *   TOGETHER  neighbouring pieces that loop at the same length share a step
 *             while they fit in N: drums come in together (kick + snare...)
 */
import { beatWeight } from "./stages.js";

export const NOTES_PER_STEP = { easy: 4, normal: 6, hard: 8, expert: 8 };
const INSTRUMENTS = [
  { mode: "drums", name: "Bass drum", lanes: ["kick"] },
  { mode: "drums", name: "Snare", lanes: ["snare"] },
  { mode: "drums", name: "Hihat", lanes: ["hat"] },
  { mode: "drums", name: "Crash", lanes: ["crash"] },
  { mode: "drums", name: "Low tom", lanes: ["tom low"] },
  { mode: "drums", name: "High tom", lanes: ["tom high"] },
  // two rows of 8 (owner, 2026-10-03): bottom = bars 1-8, top = bars 9-16
  { mode: "bass", name: "Bass bottom", lanes: Array.from({ length: 8 }, (_, i) => `bass ${i + 1}`) },
  { mode: "bass", name: "Bass top", lanes: Array.from({ length: 8 }, (_, i) => `bass ${i + 9}`) },
  { mode: "treble", name: "Treble bottom", lanes: Array.from({ length: 8 }, (_, i) => `treble ${i + 1}`) },
  { mode: "treble", name: "Treble top", lanes: Array.from({ length: 8 }, (_, i) => `treble ${i + 9}`) },
];
const DRUM_INDEX = { hat: 0, snare: 1, crash: 2, kick: 3, "tom low": 4, "tom high": 5 };

/** the shortest loop (1, 2, 4... bars, dividing the song) that these notes repeat at */
export function periodBars(notes, songBars) {
  const key = (n, L) => `${n.lane}@${(((n.beat % (4 * L)) + 4 * L) % (4 * L)).toFixed(4)}`;
  for (let L = 1; L < songBars; L *= 2) {
    if (songBars % L) continue;
    const pattern = new Set(notes.filter((n) => n.beat < 4 * L).map((n) => key(n, L)));
    const all = new Set(notes.map((n) => key(n, L)));
    // every bar-block holds exactly the pattern (same notes, same count per block)
    if (all.size === pattern.size && [...all].every((k) => pattern.has(k)) && notes.length === pattern.size * (songBars / L)) return L;
  }
  return songBars;
}

/**
 * @param {{bars:number, notes:{lane,beat,vel}[]}} song
 * @param {number} perStep notes per step
 * @returns {{label, mode, bars, show, part, instrument, addOn}[]}
 */
export function lessonParts(song, perStep = 4) {
  // 1. pieces: each instrument's repeating pattern, split into chunks of <= perStep
  const pieces = [];
  for (const inst of INSTRUMENTS) {
    const notes = song.notes.filter((n) => inst.lanes.includes(n.lane));
    if (!notes.length) continue;
    const L = periodBars(notes, song.bars);
    const pattern = notes.filter((n) => n.beat < 4 * L);
    const order = [...pattern].sort((a, b) => beatWeight(a.beat) - beatWeight(b.beat) || a.beat - b.beat);
    const n = Math.ceil(order.length / perStep);
    for (let k = 0; k < n; k++) pieces.push({ inst, L, k, n, notes: order.slice(k * perStep, (k + 1) * perStep) });
  }
  // 2. steps: neighbouring pieces of the same section and loop length share a step while they fit
  const steps = [];
  for (const pc of pieces) {
    const cur = steps[steps.length - 1];
    if (cur && cur.mode === pc.inst.mode && cur.L === pc.L && cur.notes.length + pc.notes.length <= perStep) {
      cur.pieces.push(pc); cur.notes.push(...pc.notes);
    } else steps.push({ mode: pc.inst.mode, L: pc.L, pieces: [pc], notes: [...pc.notes] });
  }
  // 3. parts, in the shape the game plays
  const shown = new Set();
  return steps.map((st) => {
    if (st.mode === "drums") for (const pc of st.pieces) shown.add(DRUM_INDEX[pc.inst.lanes[0]]);
    const label = st.pieces.map((pc) => (pc.n > 1 ? `${pc.inst.name} ${pc.k + 1}/${pc.n}` : pc.inst.name)).join(" + ");
    return {
      label, mode: st.mode, instrument: st.pieces.map((pc) => pc.inst.name).join(" + "),
      bars: st.L, addOn: st.pieces.some((pc) => pc.k > 0),
      show: st.mode === "drums" ? [...shown] : [3, 1, 0, 4, 2, 5],
      part: [...st.notes].sort((a, b) => a.beat - b.beat),
    };
  });
}

/**
 * How far each section is: 0 nothing locked .. 1 done. `stageIdx` = the step
 * being learned (every step before it is locked); past the end = all done.
 * @returns {{drums:number, bass:number, treble:number}}
 */
export function sectionProgress(parts, stageIdx) {
  const out = {};
  for (const mode of ["drums", "bass", "treble"]) {
    const idx = parts.map((p, i) => (p.mode === mode ? i : -1)).filter((i) => i >= 0);
    out[mode] = idx.length ? idx.filter((i) => i < stageIdx).length / idx.length : 0;
  }
  return out;
}

/**
 * Background level for a section's BACK track: it fades in as the section's
 * steps lock (up to 35%), and comes in fully when the section is done.
 */
export function backLevel(progress) {
  return progress >= 1 ? 1 : 0.35 * progress;
}
