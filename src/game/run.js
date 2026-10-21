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
 *   lock      GROUP SIZE (defend.js): 1 = single notes; N = the next N notes;
 *             Infinity = a whole section
 *   keep      a group you don't finish: "any" = every note you hit locks (any order),
 *             "half" = a random half of them, "none" = only a perfect pattern locks
 *   damage    gentle / normal / harsh: what a miss costs you and the town
 * Notes a run leaves out still play, in the backing, so the song is whole.
 * Every setting moves the SCORE MULTIPLIER: harder pays more.
 */

export const PRESETS = {   // (10-21) every clean hit locks: lock 1 / keep "any" everywhere (normalize enforces it)
  easy:   { hitbox: 0.25, tempo: 1, patterns: "full", lock: 1, keep: "any", damage: "gentle", density: "easy" },
  medium: { hitbox: 0.25, tempo: 1, patterns: "full", lock: 1, keep: "any", damage: "normal", density: "medium" },
  hard:   { hitbox: 0.25, tempo: 1, patterns: "full", lock: 1, keep: "any", damage: "normal", density: "hard" },
  expert: { hitbox: 0.25, tempo: 1, patterns: "full", lock: 1, keep: "any", damage: "harsh",  density: "expert" },
};
// THE DIFFICULTY SLIDER (owner, 2026-10-03): 10 levels, each a full set of modifiers;
// the old four presets sit on it at 3, 5, 7 and 10. The HITBOX is ±250 ms at every level
// (owner: "ginormous"): anything near the note counts — the score is how CLOSE (chase 100%)
export const LEVELS = [   // (10-21, re-cut with C: each step up adds notes, harsher damage or speed — and pays more)
  { ...PRESETS.easy, tempo: 0.8 },                                  // 1  slower
  { ...PRESETS.easy, tempo: 0.9 },                                  // 2
  PRESETS.easy,                                                     // 3  Easy
  { ...PRESETS.medium, damage: "gentle" },                          // 4  twice the notes, gentle
  PRESETS.medium,                                                   // 5  Medium
  { ...PRESETS.hard, damage: "gentle" },                            // 6  mostly pairs, gentle
  PRESETS.hard,                                                     // 7  Hard
  { ...PRESETS.hard, damage: "harsh" },                             // 8  misses hurt
  { ...PRESETS.hard, damage: "harsh", tempo: 1.1 },                 // 9  faster
  PRESETS.expert,                                                   // 10 Expert: pairs always, rests to throw you
];
export const LEVEL_NAMES = ["Sprout", "Seedling", "Easy", "Steady", "Medium", "Brisk", "Hard", "Fierce", "Brutal", "Expert"];
/** which level (1..10) a config IS, or 0 for custom */
export function levelOf(cfg) {
  const i = LEVELS.findIndex((p) => Math.abs(p.hitbox - cfg.hitbox) < 1e-3 && Math.abs(p.tempo - cfg.tempo) < 1e-3 && p.patterns === cfg.patterns && p.lock === cfg.lock && p.keep === cfg.keep && p.damage === cfg.damage && (!cfg.density || p.density === cfg.density));
  return i + 1;
}
export const PRESET_NAMES = { easy: "Easy", medium: "Medium", hard: "Hard", expert: "Expert", custom: "Custom" };
export const LIMITS = { hitbox: [0.03, 0.25], tempo: [0.6, 1.4] };
export const LOCKS = [1, 3, 8, Infinity];
export const DAMAGES = ["gentle", "normal", "harsh"];
export const KEEPS = ["any", "half", "none"];
export const DENSITIES = ["easy", "medium", "hard", "expert"];   // how many notes come, and how often two at once (defend.js DENSITY)   // a group you don't finish: keep every hit / a random half / nothing

/** which preset a config IS (else "custom") */
export function presetOf(cfg) {
  for (const [k, p] of Object.entries(PRESETS)) {
    if (Math.abs(p.hitbox - cfg.hitbox) < 1e-3 && Math.abs(p.tempo - cfg.tempo) < 1e-3 && p.patterns === cfg.patterns && p.lock === cfg.lock && p.keep === cfg.keep && p.damage === cfg.damage && (!cfg.density || p.density === cfg.density)) return k;
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
  if (!KEEPS.includes(c.keep)) c.keep = c.lock === 1 ? "any" : "none";
  // STREAM (owner, 2026-10-10): "steps" = the song learned in layers (as above); "all" = FULL SONG — every note of the chart
  // comes from the first bar, every hit locks its note and the locked ones stop coming, so the sky clears as you learn it.
  // Full song implies the full chart, single notes, keep whatever you hit.
  if (!DENSITIES.includes(c.density)) c.density = c.keep === "any" ? "easy" : c.keep === "half" ? "medium" : c.lock === Infinity ? "expert" : "hard";
  // EVERY CLEAN HIT LOCKS (owner, 2026-10-21, the gameplay pass "C"): the group and keep rules are gone — a player couldn't see why a hit
  // didn't stick. Difficulty is how many notes come (density) and how close a hit must be (hitbox), both of which you can feel.
  c.lock = 1; c.keep = "any";
  c.patterns = "full";   // (10-12) the DENSITY decides how many notes come now; the old pattern filter dropped every off-grid note for good (Trojan's violin)
  c.stream = c.stream === "all" ? "all" : "steps";
  if (c.stream === "all") { c.patterns = "full"; }
  delete c.step;   // the old bell loop's setting
  return c;
}

/** each modifier's factor, and their product: what the run's score is worth */
export function scoreMultiplier(cfg) {
  const c = normalize(cfg);
  const parts = {
    tempo: 1 + (c.tempo - 1) * 0.8,                                       // 0.75x -> x0.80, 1.25x -> x1.20
    patterns: { easy: 0.7, medium: 0.85, full: 1 }[c.patterns],
    // lock / keep: no longer settings (every clean hit locks) — nothing to pay for
    damage: { gentle: 0.9, normal: 1, harsh: 1.1 }[c.damage],
    stream: { steps: 1, all: 1.25 }[c.stream],
    density: c.stream === "all" ? 1 : { easy: 0.85, medium: 1, hard: 1.15, expert: 1.3 }[c.density],                             // the whole song at once: x1.25
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
