/* lesson.js — how the game TEACHES a round's song (owner, 2026-10-02). Pure.
 *
 * The song file is the whole song; the game breaks it into steps by a rule:
 *   ORDER     drums one instrument at a time (bass drum, snare, hihat, crash,
 *             then any toms), then bass (bottom row, top row), then treble
 *             (bottom row, top row) — the three SECTIONS
 *   STEP SIZE at most N notes per step, by difficulty: Easy 4, Normal 6,
 *             Hard and Expert 8 — the most important notes first (bar
 *             downbeats, beat 3, the other beats, off-beats, finer), earlier
 *             before later; each next step fills in over the ghosts
 *   LENGTH    every step is as long as the song (the bell records the whole
 *             song-length phrase; the ghost loops it)
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
  { mode: "bass", name: "Bass bottom", lanes: ["bass 1", "bass 2", "bass 3", "bass 4"] },
  { mode: "bass", name: "Bass top", lanes: ["bass 5", "bass 6", "bass 7", "bass 8"] },
  { mode: "treble", name: "Treble bottom", lanes: ["treble 1", "treble 2", "treble 3", "treble 4"] },
  { mode: "treble", name: "Treble top", lanes: ["treble 5", "treble 6", "treble 7", "treble 8"] },
];
const DRUM_INDEX = { hat: 0, snare: 1, crash: 2, kick: 3, "tom low": 4, "tom high": 5 };

/**
 * @param {{bars:number, notes:{lane,beat,vel}[]}} song
 * @param {number} perStep notes per step
 * @returns {{label, mode, bars, show, part, instrument}[]}
 */
export function lessonParts(song, perStep = 4) {
  const parts = [];
  const shown = new Set();
  for (const inst of INSTRUMENTS) {
    const notes = song.notes.filter((n) => inst.lanes.includes(n.lane));
    if (!notes.length) continue;
    if (inst.mode === "drums") shown.add(DRUM_INDEX[inst.lanes[0]]);
    const order = [...notes].sort((a, b) => beatWeight(a.beat) - beatWeight(b.beat) || a.beat - b.beat);
    const steps = Math.ceil(order.length / perStep);
    for (let k = 0; k < steps; k++) {
      const part = order.slice(k * perStep, (k + 1) * perStep).sort((a, b) => a.beat - b.beat);
      parts.push({
        label: steps > 1 ? `${inst.name} ${k + 1}/${steps}` : inst.name,
        mode: inst.mode, instrument: inst.name, bars: song.bars, addOn: k > 0,
        show: inst.mode === "drums" ? [...shown] : [3, 1, 0, 4, 2, 5],
        part,
      });
    }
  }
  return parts;
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
