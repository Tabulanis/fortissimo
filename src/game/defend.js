/* defend.js — the core loop (owner, 2026-10-03): play the song, build the shield.
 *
 * No bell, no turns: the song runs, arrows come in on the notes you still
 * need, and hitting them LOCKS them — locked notes keep playing (ghosts) and
 * build things you can see. One dial sets the difficulty, the LOCK SIZE:
 *   1    Easy — ONE note at a time, picked to reveal the song (backbone first,
 *        then echoes of what's locked); any one you hit locks on the spot
 *   N    the next N notes of the song, in order: hit them all, in order, on
 *        one pass and they lock together; a miss or a wrong note and that
 *        group simply comes round again on the next pass
 *   Infinity  the whole section in one go
 * Sections in order: drums, bass, treble (you turn to face each).
 * The drums build the SHIELD (siege.js holds its life); bass and treble are the guns.
 *
 * Pure: the engine is told hits and the time; it reports what happened.
 * Times are song-relative: a note's time in pass k = k * loopBeats + beat (beats).
 */
import { beatWeight } from "./stages.js";

export const SECTIONS = ["drums", "bass", "treble"];
export const MIN_GAP_S = 1.0;      // lock size 1: offered notes at least this far apart
export const MAX_OFFER = 1;        // lock size 1: ONE note at a time (owner, 2026-10-03), with a long lead (the game's LEAD)
export const LIFE = {              // per run damage: a miss hurts you and the town, a hit heals both
  gentle: { miss: 3, heal: 3 }, normal: { miss: 5, heal: 2 }, harsh: { miss: 8, heal: 1 },
};
// how much an instrument carries the song (lower = sooner): the drums' backbone first;
// bars all count the same (their beat does the sorting)
const LANE_RANK = { kick: 0, snare: 0.3, hat: 3.5, crash: 3.8, "tom low": 4, "tom high": 4 };   // the snare's backbeat outranks a hat on the beat: "boom-tak" first
const laneRank = (lane) => LANE_RANK[lane] ?? 0;
const sectionOf = (lane) => (lane.startsWith("bass") ? "bass" : lane.startsWith("treble") ? "treble" : "drums");

export class Defend {
  /**
   * @param {{notes: {lane, beat, midi?, vel?}[], bars: number}} song  (beats; the song loops every 4*bars beats)
   * @param {{lockSize: number, beatDur: number}} opts
   */
  constructor(song, { lockSize = 1, beatDur = 0.75, keep = "none", rng = Math.random } = {}) {
    this.loopBeats = 4 * song.bars;
    this.beatDur = beatDur;
    this.lockSize = lockSize;
    this.keep = keep;                 // a group you DON'T finish: "any" = every note you hit locks (Easy),
                                      // "half" = a random half of them lock (Medium), "none" = nothing (Hard)
    this.rng = rng;
    this.notes = song.notes.map((n, id) => ({ ...n, id, section: sectionOf(n.lane) }));
    this.locked = new Set();          // note ids
    this.sectionIdx = 0;
    this._chunk = null;               // lock size > 1: { ids: [...], next: 0, hits: [] }
    this._single = null;              // lock size 1: the one note on offer (stays until it locks)
    this.nowBeat = 0;                 // set by the game: where the song is now (beats into the loop)
    this.leadBeats = 0;               // set by the game: the lead time, in beats
    this.events = [];                 // what happened since the last drain()
    this._skipEmpty();
  }

  get section() { return SECTIONS[this.sectionIdx] || null; }
  get done() { return this.sectionIdx >= SECTIONS.length; }
  sectionNotes(s = this.section) { return this.notes.filter((n) => n.section === s).sort((a, b) => a.beat - b.beat); }
  unlocked(s = this.section) { return this.sectionNotes(s).filter((n) => !this.locked.has(n.id)); }
  progress(s) { const all = this.sectionNotes(s); return all.length ? all.filter((n) => this.locked.has(n.id)).length / all.length : 1; }

  /** the notes arrows fly for right now (the song's own beats) */
  offered() {
    if (this.done) return [];
    const open = this.unlocked();
    if (this.lockSize === 1) {
      // ONE note at a time; it stays on offer until it locks. Picked so it comes
      // round just after the lead: the important notes first, weighed against
      // the wait (each step down in importance is worth about a beat of waiting)
      if (this._single != null && !this.locked.has(this._single) && this.notes[this._single].section === this.section) return [this.notes[this._single]];
      let best = null, bestScore = Infinity;
      const target = this.nowBeat + this.leadBeats;
      // REVEAL THE SONG (owner, 2026-10-03): the backbone first (kick and snare before
      // hats, crash and toms; strong beats before off-beats), and ECHOES — a note whose
      // instrument already plays that spot in another bar — so a repeating groove
      // forms early and the song is recognisable long before it's all locked
      const echo = new Set([...this.locked].map((id) => { const m = this.notes[id]; return m.lane + "@" + ((m.beat % 4) + 4) % 4; }));
      for (const n of open) {
        if (n.id === this._avoid && open.length > 1) continue;   // just missed: something else first
        const wait = (((n.beat - target) % this.loopBeats) + this.loopBeats) % this.loopBeats;
        const echoes = echo.has(n.lane + "@" + ((n.beat % 4) + 4) % 4);
        const score = wait + beatWeight(n.beat) + 1.5 * laneRank(n.lane) - (echoes ? 2 : 0);
        if (score < bestScore - 1e-9) { bestScore = score; best = n; }
      }
      this._single = best ? best.id : null;
      return best ? [best] : [];
    }
    if (!this._chunk) {
      const size = this.lockSize === Infinity ? open.length : this.lockSize;
      // in song order from the first notes that come round AFTER the lead — so a new group
      // never has to wait a whole loop for its warning; notes left behind come back next time round
      const target = this.nowBeat + this.leadBeats, L = this.loopBeats;
      const wait = (n) => (((n.beat - target) % L) + L) % L;
      let ids;
      if (this.keep === "none") ids = [...open].sort((a, b) => wait(a) - wait(b)).slice(0, size).map((n) => n.id);   // Hard: the real sequence
      else {
        // Easy / Medium: every note of a group on a DIFFERENT drum or gun (owner, 2026-10-03:
        // no double strikes in the queue unless there's no other way), still revealing the
        // song — the backbone first (kick and snare, then hats, then crash and toms)
        const tier = Math.min(...open.map((n) => laneRank(n.lane))) + 0.9;
        const byTime = [...open].sort((a, b) => wait(a) - wait(b)), pick = [], lanes = new Set();
        // EASY plays a group ONE AT A TIME — 1, 2, 3, never two at once (owner); Medium may
        // have two together (never more: two hands in VR — the song itself is capped at two, run.js)
        const apart = (n) => this.keep !== "any" || !pick.some((m) => Math.abs(m.beat - n.beat) < 0.03);
        const take = (ok) => { for (const n of byTime) { if (pick.length >= size) return; if (!pick.includes(n) && apart(n) && ok(n)) { pick.push(n); lanes.add(n.lane); } } };
        take((n) => laneRank(n.lane) <= tier && !lanes.has(n.lane));   // the backbone, one per drum
        take((n) => !lanes.has(n.lane));                                // then other drums
        take(() => true);                                               // a repeat only if there's no other way
        ids = pick.sort((a, b) => wait(a) - wait(b)).map((n) => n.id);
      }
      this._chunk = { ids, next: 0, hits: [] };
    }
    const ids = new Set(this._chunk.ids);
    return this.notes.filter((n) => ids.has(n.id)).sort((a, b) => a.beat - b.beat);
  }

  /** the chunk's progress (lock size > 1): how many of its notes are hit so far, in order */
  get chunkProgress() { return this._chunk ? { hit: this._chunk.next, of: this._chunk.ids.length } : null; }

  /**
   * A correct hit on an offered note (the caller judged the timing).
   * @returns {"lock"|"progress"|"wrong"|"ignored"}
   */
  hit(noteId, hitInfo = {}) {
    if (this.done || this.locked.has(noteId)) return "ignored";
    const offered = this.offered();
    if (!offered.some((n) => n.id === noteId)) return "ignored";
    if (this.lockSize === 1) { this._lock([noteId], [{ id: noteId, ...hitInfo }]); return "lock"; }
    const c = this._chunk;
    if (this.keep === "any") {
      // Easy: any note of the group, any order — it locks on the spot; the group is done
      // once you've got at least one and it comes round (or when it's all locked)
      c.hits.push({ id: noteId, ...hitInfo });
      c.ids = c.ids.filter((id) => id !== noteId);
      this._lockSome([noteId], [{ id: noteId, ...hitInfo }]);
      if (this._chunk === c && !c.ids.length) this._closeChunk();
      return "lock";
    }
    if (c.ids[c.next] !== noteId) { this._fail("out of order"); return "wrong"; }
    c.hits.push({ id: noteId, ...hitInfo });
    c.next++;
    this.events.push({ type: "progress", hit: c.next, of: c.ids.length });
    if (c.next === c.ids.length) { this._lock(c.ids, c.hits); return "lock"; }
    return "progress";
  }

  /** an offered note went by unhit (the caller saw it pass the hitbox) */
  miss(noteId) {
    if (this.done || this.locked.has(noteId)) return;
    const n = this.notes[noteId];
    this.events.push({ type: "miss", note: n });
    // lock size 1: a miss moves on to another note (owner, 2026-10-03: keep the pace steady) —
    // the missed one stays unlocked and comes back later
    if (this.lockSize === 1 && this._single === noteId) { this._single = null; this._avoid = noteId; }
    if (this.lockSize !== 1 && this._chunk && this._chunk.ids.includes(noteId)) {
      if (this.keep === "any") { if (this._chunk.hits.length) this._closeChunk(); }   // got some: move on
      else this._fail("missed");
    }
  }

  /** a wrong note — a hit with no offered note there (only matters while a chunk is under way) */
  stray() { if (this.lockSize !== 1 && this.keep !== "any" && this._chunk && this._chunk.next > 0) this._fail("wrong note"); }

  drain() { const e = this.events; this.events = []; return e; }

  _fail(why) {
    const c = this._chunk;
    if (!c) return;
    if (c.next > 0) this.events.push({ type: "chunkFail", why });
    // Medium: a random half of what you DID hit locks anyway; the rest of the group comes round again
    if (this.keep === "half" && c.hits.length) {
      const kept = c.hits.filter(() => this.rng() < 0.5);
      if (kept.length) {
        const keptIds = new Set(kept.map((h) => h.id));
        c.ids = c.ids.filter((id) => !keptIds.has(id));
        this._lockSome([...keptIds], kept);
      }
    }
    if (this._chunk === c) { c.next = 0; c.hits = []; if (!c.ids.length) this._closeChunk(); }
  }

  /** the group is done: the next one starts after it */
  _closeChunk() { this._chunk = null; }

  /** lock some notes without ending the group (Easy's every hit, Medium's kept half) */
  _lockSome(ids, hits) {
    for (const id of ids) this.locked.add(id);
    this.events.push({ type: "lock", notes: ids.map((id) => this.notes[id]), hits });
    this._skipEmpty();
  }

  _lock(ids, hits) {
    for (const id of ids) this.locked.add(id);
    this._closeChunk();
    this.events.push({ type: "lock", notes: ids.map((id) => this.notes[id]), hits });
    this._skipEmpty();
  }

  _skipEmpty() {
    while (!this.done && this.unlocked().length === 0) {
      this.events.push({ type: "sectionDone", section: this.section });
      this.sectionIdx++;
      this._chunk = null;   // a new section starts fresh
    }
  }
}
