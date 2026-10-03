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
 *   lock      LOCK SIZE (defend.js): 1 = any note you hit locks; N = the next N
 *             notes, all hit in order on one pass; Infinity = a whole section
 *   damage    gentle / normal / harsh: what a miss costs you and the town
 * Notes a run leaves out still play, in the backing, so the song is whole.
 * Every setting moves the SCORE MULTIPLIER: harder pays more.
 */

export const PRESETS = {
  easy:   { hitbox: 0.14, tempo: 1, patterns: "easy",   lock: 1,        damage: "gentle" },
  medium: { hitbox: 0.11, tempo: 1, patterns: "medium", lock: 3,        damage: "normal" },
  hard:   { hitbox: 0.07, tempo: 1, patterns: "full",   lock: 8,        damage: "normal" },
  expert: { hitbox: 0.04, tempo: 1, patterns: "full",   lock: Infinity, damage: "harsh" },
};
export const PRESET_NAMES = { easy: "Easy", medium: "Medium", hard: "Hard", expert: "Expert", custom: "Custom" };
export const LIMITS = { hitbox: [0.03, 0.25], tempo: [0.6, 1.4] };
export const LOCKS = [1, 3, 8, Infinity];
export const DAMAGES = ["gentle", "normal", "harsh"];

/** which preset a config IS (else "custom") */
export function presetOf(cfg) {
  for (const [k, p] of Object.entries(PRESETS)) {
    if (Math.abs(p.hitbox - cfg.hitbox) < 1e-3 && Math.abs(p.tempo - cfg.tempo) < 1e-3 && p.patterns === cfg.patterns && p.lock === cfg.lock && p.damage === cfg.damage) return k;
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
  if (c.lock === null || c.lock === "all") c.lock = Infinity;
  if (!LOCKS.includes(c.lock)) c.lock = 1;
  if (!DAMAGES.includes(c.damage)) c.damage = "normal";
  delete c.step; delete c.keep;   // the old bell loop's settings
  return c;
}

/** each modifier's factor, and their product: what the run's score is worth */
export function scoreMultiplier(cfg) {
  const c = normalize(cfg);
  const parts = {
    hitbox: Math.min(1.15, Math.max(0.5, 1 - (c.hitbox - 0.08) * 2.5)),   // 0.04 -> x1.10, 0.14 -> x0.85, 0.25 -> x0.58
    tempo: 1 + (c.tempo - 1) * 0.8,                                       // 0.75x -> x0.80, 1.25x -> x1.20
    patterns: { easy: 0.7, medium: 0.85, full: 1 }[c.patterns],
    lock: { 1: 0.8, 3: 0.95, 8: 1.05 }[c.lock] ?? 1.15,                 // all at once: x1.15
    damage: { gentle: 0.9, normal: 1, harsh: 1.1 }[c.damage],
  };
  const total = Object.values(parts).reduce((a, b) => a * b, 1);
  return { total: Math.round(total * 100) / 100, parts };
}

/** what a hit is judged by: the box (seconds either side of its note) */
export function judgeFor(cfg) {
  return { window: normalize(cfg).hitbox };
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
  const r = simplifyPattern(notes, level);
  return twoHands(r.play, r.backing);
}

// TWO HANDS (owner, 2026-10-03: "in VR you only got two hands"): never more than
// two notes at the same moment at one station — the two that matter most stay
// yours (drums: kick, snare, hat, crash, toms; bars: the bottom row, then the
// top, low to high); the rest go to the backing, so they still sound
const DRUM_RANK = { kick: 0, snare: 1, hat: 2, crash: 3, "tom low": 4, "tom high": 5 };
const rank = (lane) => DRUM_RANK[lane] ?? +lane.split(" ")[1];
export const MAX_AT_ONCE = 2;
function twoHands(play, backing) {
  const keep = [], extra = [...backing];
  const groups = new Map();
  for (const n of play) {
    const key = group(n.lane) === "bass" || group(n.lane) === "treble" ? group(n.lane) : "drums";
    const k = key + "@" + Math.round(n.beat / TOL);
    (groups.get(k) || groups.set(k, []).get(k)).push(n);
  }
  for (const g of groups.values()) {
    g.sort((a, b) => rank(a.lane) - rank(b.lane));
    keep.push(...g.slice(0, MAX_AT_ONCE));
    extra.push(...g.slice(MAX_AT_ONCE));
  }
  keep.sort((a, b) => a.beat - b.beat);
  return { play: keep, backing: extra };
}

function simplifyPattern(notes, level) {
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
