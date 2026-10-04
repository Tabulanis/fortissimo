/* defend.js — the core loop: THE STREAM (owner, 2026-10-04: "come at you like Beat
 * Saber — here's two, here's one — not methodical").
 *
 * The song runs. Its notes come at you in a continuous stream, in song order, at the
 * song's own pace: the next few are always in flight (the WINDOW), and whether you hit
 * or miss, the stream keeps coming. A correct hit LOCKS a note: locked notes keep
 * playing (the band) and build things you can see.
 *
 * The song is learned in PASSES, not picks: each trip round the loop streams one LAYER
 * of what's still unlocked — drums: kick and snare first, then hats, then crash and
 * toms; bars: the strong beats first, then the rest — so a groove forms early and the
 * song is recognisable long before it's all locked. Hard streams the chart as written.
 *
 * DIFFICULTY is density and the keep rule (run.js):
 *   keep "any"  (Easy)    two beats between notes, one at a time; every hit locks
 *   keep "half" (Medium)  half a beat, up to two together (two hands); a PATTERN of
 *                         lockSize hits in a row locks them all — break it (a miss, a
 *                         wrong note) and a random half of the run locks anyway
 *   keep "none" (Hard)    the chart as written, up to two together; only a whole pattern
 *                         locks (lockSize Infinity: the whole section in one go)
 * Sections in order: drums, bass, treble (you turn to face each).
 *
 * Pure: the game sets the TIME (now, in beats from the song's start, continuous), the
 * window and the grace (both in beats), tells it hits, and calls tick() for misses;
 * it reports what happened. Occurrence k of note n is at k * loopBeats + n.beat.
 */
import { beatWeight } from "./stages.js";

export const SECTIONS = ["drums", "bass", "treble"];
export const LIFE = {              // per run damage: a miss hurts you and the town, a hit heals both
  gentle: { miss: 3, heal: 3 }, normal: { miss: 5, heal: 2 }, harsh: { miss: 8, heal: 1 },
};
/** the stream's density per keep rule: gap = beats between notes, together = at most this many at one beat */
export const STREAM = { any: { gap: 2, together: 1, maxGap: 3 }, half: { gap: 0.5, together: 2, maxGap: 1 }, none: { gap: 0, together: 2, maxGap: 2 } };   // Easy: every 2 beats (owner, 2026-10-04: one a beat "came a bit fast")
// maxGap: the stream never leaves you waiting longer than this (owner, 2026-10-04) — a thin
// stretch of the song gets BONUS notes on the section's other drums / guns: in key (a bar plays
// its own note), they fire the guns and score like any hit, but lock nothing (they're not the song)
const BAR_LANES = (sec) => Array.from({ length: 16 }, (_, i) => `${sec} ${i + 1}`);
// how much an instrument carries the song (lower = sooner): the drums' backbone first
const LANE_RANK = { kick: 0, snare: 0.3, hat: 3.5, crash: 3.8, "tom low": 4, "tom high": 4 };
const laneRank = (lane) => LANE_RANK[lane] ?? 0;
const sectionOf = (lane) => (lane.startsWith("bass") ? "bass" : lane.startsWith("treble") ? "treble" : "drums");

export class Defend {
  /**
   * @param {{notes: {lane, beat, midi?, vel?}[], bars: number}} song  (beats; the song loops every 4*bars beats)
   * @param {{lockSize?: number, keep?: "any"|"half"|"none", rng?: () => number}} opts
   */
  constructor(song, { lockSize = 1, keep = "any", rng = Math.random } = {}) {
    this.loopBeats = 4 * song.bars;
    this.lockSize = lockSize;
    this.keep = keep;
    this.rng = rng;
    this.notes = song.notes.map((n, id) => ({ ...n, id, section: sectionOf(n.lane) }));
    this.locked = new Set();          // note ids
    this.sectionIdx = 0;
    this.now = 0;                     // set by the game: beats since the song's start (continuous)
    this.windowBeats = 6;             // set by the game: how far ahead the stream is in flight
    this.graceBeats = 0.3;            // set by the game: the hitbox, in beats (a note is live this long after its beat)
    this.missFrom = -Infinity;        // set by the game: misses count from here (a breath after Start)
    this._plans = new Map();          // "section:k" -> note ids streamed on pass k (fixed once the window reaches it)
    this._bonus = [];                 // the filler notes made so far (ids continue after the song's)
    this._lanes = {};                 // per section: the lanes bonus notes may use
    for (const s of SECTIONS) this._lanes[s] = s === "drums" ? [...new Set(this.notes.filter((n) => n.section === s).map((n) => n.lane))] : BAR_LANES(s);
    this._done = new Set();           // "id@k": that occurrence was hit, or counted as a miss
    this._run = [];                   // Medium / Hard: the hits of the pattern under way
    this.events = [];                 // what happened since the last drain()
    this._skipEmpty();
  }

  get section() { return SECTIONS[this.sectionIdx] || null; }
  get done() { return this.sectionIdx >= SECTIONS.length; }
  /** a note by id: the song's, or a bonus one */
  note(id) { return id < this.notes.length ? this.notes[id] : this._bonus[id - this.notes.length]; }
  sectionNotes(s = this.section) { return this.notes.filter((n) => n.section === s).sort((a, b) => a.beat - b.beat); }
  unlocked(s = this.section) { return this.sectionNotes(s).filter((n) => !this.locked.has(n.id)); }
  progress(s) { const all = this.sectionNotes(s); return all.length ? all.filter((n) => this.locked.has(n.id)).length / all.length : 1; }

  /** pass k's stream for this section: this pass's LAYER, thinned to the density */
  _plan(k) {
    const key = this.sectionIdx + ":" + k;
    if (this._plans.has(key)) return this._plans.get(key);
    const open = this.unlocked();
    let layer = open;
    if (this.keep !== "none" && open.length) {
      if (this.section === "drums") { const t = Math.min(...open.map((n) => laneRank(n.lane))) + 0.9; layer = open.filter((n) => laneRank(n.lane) <= t); }
      else { const t = Math.min(...open.map((n) => beatWeight(n.beat))) + 1; layer = open.filter((n) => beatWeight(n.beat) <= t); }
    }
    const { gap, together, maxGap } = STREAM[this.keep] || STREAM.none;
    const cands = [...layer].sort((a, b) => a.beat - b.beat || laneRank(a.lane) - laneRank(b.lane) || a.id - b.id);
    const plan = [];
    let last = -Infinity, at = 0;
    for (const n of cands) {
      if (Math.abs(n.beat - last) < 1e-6) { if (at < together) { plan.push(n); at++; } continue; }   // together: two hands at most
      if (n.beat - last < gap - 1e-6) continue;
      plan.push(n); last = n.beat; at = 1;
    }
    // FILL the gaps: bonus notes on the beat grid, on a different lane from their neighbours
    const lanes = this._lanes[this.section] || [], step = Math.max(gap, 1), filled = [];
    let prev = null, pick = (k * 7 + plan.length) % Math.max(1, lanes.length);
    const fill = (from, to, nextLane) => {
      // bonus notes every `step` beats across the gap, none closer than `gap` to the note that ends it
      for (let b = from + step; b <= to - Math.max(gap, 0.5) + 1e-6 && lanes.length; b += step) {
        let lane = lanes[pick % lanes.length];
        for (let tries = 0; tries < lanes.length && (lane === (prev && prev.lane) || lane === nextLane); tries++) lane = lanes[++pick % lanes.length];
        pick++;
        const id = this.notes.length + this._bonus.length;
        const bn = { lane, beat: b, id, section: this.section, bonus: true };
        this._bonus.push(bn); filled.push(bn); prev = bn;
      }
    };
    const L = this.loopBeats;
    for (let i = 0; i <= plan.length; i++) {
      const a = i ? plan[i - 1] : null, b = i < plan.length ? plan[i] : null;
      const from = a ? a.beat : -step, to = b ? b.beat : L;   // from the loop's start, and out to its end
      if (to - from > maxGap + 1e-6) fill(from, to, b && b.lane);
      if (b) prev = b;
    }
    const ids = [...plan, ...filled].sort((a, b) => a.beat - b.beat).map((n) => n.id);
    this._plans.set(key, ids);
    return ids;
  }

  /** the notes in flight right now: each with `at` (its occurrence, in beats) — the stream's window */
  offered() {
    if (this.done) return [];
    const L = this.loopBeats, out = [], seen = new Set();
    const k0 = Math.floor((this.now - this.graceBeats) / L), k1 = Math.floor((this.now + this.windowBeats) / L);
    for (let k = k0; k <= k1; k++) {
      for (const id of this._plan(k)) {
        if (this.locked.has(id) || seen.has(id) || this._done.has(id + "@" + k)) continue;
        const n = this.note(id), t = k * L + n.beat;
        if (t < this.now - this.graceBeats || t > this.now + this.windowBeats) continue;
        seen.add(id);
        out.push({ ...n, at: t, k });
      }
    }
    return out.sort((a, b) => a.at - b.at);
  }

  /** every frame: streamed occurrences that went by unhit are misses */
  tick() {
    if (this.done) return;
    const L = this.loopBeats, k0 = Math.floor((this.now - this.graceBeats - 1) / L), k1 = Math.floor(this.now / L);
    for (let k = k0; k <= k1; k++) {
      for (const id of this._plan(k)) {
        if (this.locked.has(id)) continue;
        const t = k * L + this.note(id).beat, key = id + "@" + k;
        if (t >= this.now - this.graceBeats || this._done.has(key)) continue;
        this._done.add(key);
        if (t >= this.missFrom) this._miss(this.note(id));
      }
    }
  }

  /** the pattern under way (Medium / Hard): how many hits in a row so far, of how many */
  get runProgress() { return this.keep === "any" ? null : { hit: this._run.length, of: this._need() }; }
  _need() { return this.lockSize === Infinity ? this.unlocked().length : this.lockSize; }

  /**
   * A correct hit on a streamed note (the caller judged the timing).
   * @returns {"lock"|"progress"|"bonus"|"ignored"}  bonus: a filler note — scores, locks nothing
   */
  hit(noteId, hitInfo = {}) {
    if (this.done || this.locked.has(noteId)) return "ignored";
    const o = this.offered().find((n) => n.id === noteId);
    if (!o) return "ignored";
    this._done.add(noteId + "@" + o.k);
    if (o.bonus) { this.events.push({ type: "bonusHit", note: o }); return "bonus"; }
    const h = { id: noteId, ...hitInfo };
    if (this.keep === "any") { this._lock([noteId], [h]); return "lock"; }
    this._run.push(h);
    const need = this._need();
    this.events.push({ type: "progress", hit: this._run.length, of: need });
    if (this._run.length >= need) { const run = this._run; this._run = []; this._lock(run.map((x) => x.id), run); return "lock"; }
    return "progress";
  }

  /** a wrong note — a hit with nothing streamed there (breaks a pattern under way) */
  stray() { this._break("wrong note"); }

  drain() { const e = this.events; this.events = []; return e; }

  /** harness only: lock everything left in this section */
  lockAll() { const ids = this.unlocked().map((n) => n.id); if (ids.length) this._lock(ids, ids.map((id) => ({ id }))); }

  _miss(n) {
    this.events.push({ type: "miss", note: n });
    if (!n.bonus) this._break("missed");   // a missed filler costs you the rocket, not the pattern
  }

  /** the pattern breaks: Medium keeps a random half of the run, Hard nothing */
  _break(why) {
    if (this.keep === "any" || !this._run.length) return;
    this.events.push({ type: "chunkFail", why });
    const run = this._run;
    this._run = [];
    if (this.keep === "half") {
      const kept = run.filter(() => this.rng() < 0.5);
      if (kept.length) this._lock(kept.map((h) => h.id), kept);
    }
  }

  _lock(ids, hits) {
    for (const id of ids) this.locked.add(id);
    this.events.push({ type: "lock", notes: ids.map((id) => this.note(id)), hits });
    this._skipEmpty();
  }

  _skipEmpty() {
    while (!this.done && this.unlocked().length === 0) {
      this.events.push({ type: "sectionDone", section: this.section });
      this.sectionIdx++;
      this._run = [];
    }
  }
}
