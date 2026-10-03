/* run.js — a RUN's settings, Beat Saber style (owner, 2026-10-03). Pure.
 *
 * The song is the song: every difficulty plays it at its own tempo (the
 * Hackbeat BPM). What changes is how much of it you play and how forgiving
 * it is — four presets, or Custom with the modifiers set by hand:
 *   hitbox    seconds either side of a note that still count (a slider)
 *   tempo     x the song's tempo (a slider; the pitch is kept)
 *   patterns  "easy"   only the easy-to-get notes (on the beat and half-beat)
 *             "medium" more, but no fast runs or odd off-grid bits
 *             "full"   every note
 *   step      notes per step (Infinity = an instrument all at once)
 *   keep      notes hit on an earlier pass of a step stay hit
 * Notes a run leaves out still play, in the backing, so the song is whole.
 * Every setting moves the SCORE MULTIPLIER: harder pays more.
 */

export const PRESETS = {
  easy:   { hitbox: 0.14, tempo: 1, patterns: "easy",   step: 8, keep: true },
  medium: { hitbox: 0.11, tempo: 1, patterns: "medium", step: 8, keep: false },
  hard:   { hitbox: 0.07, tempo: 1, patterns: "full",   step: 8, keep: false },
  expert: { hitbox: 0.04, tempo: 1, patterns: "full",   step: Infinity, keep: false },
};
export const PRESET_NAMES = { easy: "Easy", medium: "Medium", hard: "Hard", expert: "Expert", custom: "Custom" };
export const LIMITS = { hitbox: [0.03, 0.25], tempo: [0.6, 1.4] };
export const STEPS = [4, 6, 8, Infinity];

/** which preset a config IS (else "custom") */
export function presetOf(cfg) {
  for (const [k, p] of Object.entries(PRESETS)) {
    if (Math.abs(p.hitbox - cfg.hitbox) < 1e-3 && Math.abs(p.tempo - cfg.tempo) < 1e-3 && p.patterns === cfg.patterns && p.step === cfg.step && p.keep === cfg.keep) return k;
  }
  return "custom";
}

/** a config with every value in range (anything missing from the Easy preset) */
export function normalize(cfg = {}) {
  const c = { ...PRESETS.easy, ...cfg };
  const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, +v || lo));
  c.hitbox = clamp(c.hitbox, LIMITS.hitbox);
  c.tempo = clamp(c.tempo, LIMITS.tempo);
  if (!["easy", "medium", "full"].includes(c.patterns)) c.patterns = "easy";
  if (!STEPS.includes(c.step)) c.step = c.step === null || c.step === "all" ? Infinity : 8;
  c.keep = !!c.keep;
  return c;
}

/** each modifier's factor, and their product: what the run's score is worth */
export function scoreMultiplier(cfg) {
  const c = normalize(cfg);
  const parts = {
    hitbox: Math.min(1.15, Math.max(0.5, 1 - (c.hitbox - 0.08) * 2.5)),   // 0.04 -> x1.10, 0.14 -> x0.85, 0.25 -> x0.58
    tempo: 1 + (c.tempo - 1) * 0.8,                                       // 0.75x -> x0.80, 1.25x -> x1.20
    patterns: { easy: 0.7, medium: 0.85, full: 1 }[c.patterns],
    step: c.step === Infinity ? 1.1 : 1,
    keep: c.keep ? 0.8 : 1,
  };
  const total = Object.values(parts).reduce((a, b) => a * b, 1);
  return { total: Math.round(total * 100) / 100, parts };
}

/** what the bell judges with: the box, how much of a step locks it, strays allowed, keep */
export function judgeFor(cfg) {
  const c = normalize(cfg);
  return { window: c.hitbox, ratio: c.keep ? 0.75 : c.hitbox >= 0.1 ? 0.8 : 1, extras: c.hitbox >= 0.1 ? 2 : c.hitbox >= 0.06 ? 1 : 0, keep: c.keep };
}

// ---- pattern difficulty: which notes a run plays --------------------------------
const TOL = 0.03;   // beats: a note dragged a hair off the grid still counts as on it
const onGrid = (beat, step) => { const r = ((beat % step) + step) % step; return r < TOL || step - r < TOL; };
const group = (lane) => lane.split(" ")[0];   // "bass 3" -> "bass"; drums are their own

/**
 * @param {{lane, beat}[]} notes the whole song
 * @param {"easy"|"medium"|"full"} level
 * @returns {{play: object[], backing: object[]}} what you play, and what the backing plays for you
 */
export function simplifyNotes(notes, level) {
  if (level === "full") return { play: [...notes], backing: [] };
  const play = [], backing = [];
  const sorted = [...notes].sort((a, b) => a.beat - b.beat);
  for (const n of sorted) {
    let keep;
    if (level === "easy") keep = onGrid(n.beat, 0.5);                                   // beats and half-beats
    else {
      // medium: the sixteenth grid, but a sixteenth only where it stands alone — not in
      // the middle of a run (notes a sixteenth either side), not near another off-beat sixteenth
      const same = sorted.filter((m) => m !== n && group(m.lane) === group(n.lane));
      const near = (d) => same.some((m) => Math.abs(m.beat - (n.beat + d)) < TOL);
      keep = onGrid(n.beat, 0.25) && (onGrid(n.beat, 0.5) ||
        (!(near(-0.25) && near(0.25)) && !same.some((m) => onGrid(m.beat, 0.25) && !onGrid(m.beat, 0.5) && Math.abs(m.beat - n.beat) < 0.5 + TOL)));
    }
    (keep ? play : backing).push(n);
  }
  return { play, backing };
}
