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
 *   TWO DRUMS drums are taught two at a time (owner, 2026-10-03): bass drum
 *             + snare first, then hihat + crash, then the toms; bass and treble rows
 *             one row at a time (never top and bottom together)
 *   EXPERT    every note on the instrument you're at: all the drums in one
 *             step, then each row whole
 *   BAR BY BAR (Easy, owner 2026-10-03) a busy part that doesn't repeat bar to
 *             bar is taught ONE BAR AT A TIME: bar 1's pattern loops on its own,
 *             and once locked it drops into its place in the song (atBar /
 *             phraseBars), then bar 2...
 */
import { beatWeight } from "./stages.js";

// notes a step may hold; Expert: everything on the instrument you're at, in one step
export const NOTES_PER_STEP = { easy: 4, normal: 6, hard: 8, expert: Infinity };
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
export function lessonParts(song, perStep = 4, { barByBar = false } = {}) {
  const all = perStep === Infinity;
  // 1. each instrument's notes and the loop it repeats at
  const insts = [];
  for (const inst of INSTRUMENTS) {
    const notes = song.notes.filter((n) => inst.lanes.includes(n.lane));
    if (notes.length) insts.push({ inst, notes, L: periodBars(notes, song.bars) });
  }
  // 2. groups taught together: drums in pairs (Expert: all of them), rows one at a time
  const groups = [];
  const drums = insts.filter((x) => x.inst.mode === "drums");
  if (all && drums.length) groups.push(drums);
  else {
    // in drum order: bass drum + snare, hihat + crash, then the toms
    for (let i = 0; i < drums.length; i += 2) groups.push(drums.slice(i, i + 2));
  }
  for (const x of insts) if (x.inst.mode !== "drums") groups.push([x]);
  // 3. each group: its repeating pattern, split (evenly, most important first) past perStep
  const parts = [];
  const shown = new Set();
  for (const g of groups) {
    const mode = g[0].inst.mode;
    const notes = g.flatMap((x) => x.notes);
    const L = periodBars(notes, song.bars);
    const pattern = notes.filter((n) => n.beat < 4 * L);
    if (mode === "drums") for (const x of g) shown.add(DRUM_INDEX[x.inst.lanes[0]]);
    const name = g.map((x) => x.inst.name).join(" + ");
    const show = mode === "drums" ? [...shown] : [3, 1, 0, 4, 2, 5];
    // a busy part that doesn't repeat bar to bar: one bar at a time (Easy)
    const byBar = barByBar && !all && L > 1 && pattern.length > perStep;
    const chunks = byBar
      ? Array.from({ length: L }, (_, b) => ({ b, notes: pattern.filter((n) => n.beat >= 4 * b && n.beat < 4 * b + 4) })).filter((c) => c.notes.length)
      : [{ b: null, notes: pattern }];
    let addOn = false;
    for (const c of chunks) {
      const order = [...c.notes].sort((a, b) => beatWeight(a.beat) - beatWeight(b.beat) || a.beat - b.beat);
      const n = all ? 1 : Math.ceil(order.length / perStep);
      const size = Math.ceil(order.length / n);              // even chunks: no lonely 1-note step
      for (let k = 0; k < n; k++) {
        const notes = order.slice(k * size, (k + 1) * size).sort((a, b) => a.beat - b.beat);
        const bit = (c.b != null ? ` bar ${c.b + 1}` : "") + (n > 1 ? ` ${k + 1}/${n}` : "");
        parts.push(c.b == null
          ? { label: name + bit, mode, instrument: name, bars: L, addOn, show, part: notes }
          // the step loops ONE bar (its notes moved to bar 1); locked, it goes back to bar atBar of a phraseBars loop
          : { label: name + bit, mode, instrument: name, bars: 1, addOn, show, atBar: c.b, phraseBars: L,
              part: notes.map((n) => ({ ...n, beat: n.beat - 4 * c.b })) });
        addOn = true;
      }
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
 * Background level for a section's BACK track (owner, 2026-10-03): quiet but
 * audible from the start (30%), growing as the section's steps lock (to 60%),
 * and FULL — as set in Hackbeat — once the section is unlocked.
 */
export const BACK_START = 0.3, BACK_LEARNING = 0.6;
export function backLevel(progress) {
  return progress >= 1 ? 1 : BACK_START + (BACK_LEARNING - BACK_START) * progress;
}
