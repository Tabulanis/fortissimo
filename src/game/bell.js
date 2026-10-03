/** kept: Set of note indices already hit on an earlier pass (Easy: keep what you got right) */
export function judgeMeasure(hits, part, barStart, beatDur, diff, kept = null) {
  const total = part.length;
  const matched = new Array(part.length).fill(false);
  const pairs = [];   // [note index, hit] for every hit that found its note
  let extras = 0;
  const lanes = new Set(part.map((n) => n.lane));
  for (const h of hits) {
    if (!lanes.has(h.lane)) continue; // a lane not in the part is noise, not an extra
    let best = -1, bestD = Infinity;
    for (let i = 0; i < total; i++) {
      const n = part[i];
      if (n.lane !== h.lane || matched[i]) continue;
      const d = Math.abs(h.t - (barStart + n.beat * beatDur));
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best >= 0 && bestD <= diff.window) { matched[best] = true; pairs.push([best, h]); }
    else extras++;
  }
  // with keep: a note hit on ANY pass so far counts
  const hitsMatched = matched.filter((m, i) => m || (kept && kept.has(i))).length;
  return {
    pass: total > 0 && hitsMatched / total >= diff.ratio && extras <= diff.extras,
    matched: hitsMatched,
    total,
    extras,
    pairs,
  };
}

export class Bell {
  constructor({ first, beatDur, beatsPerBar = 4 }) {
    this.first = first;
    this.beatDur = beatDur;
    this.beatsPerBar = beatsPerBar;
    this.barDur = beatDur * beatsPerBar;
    this._mode = "idle";
    this._recordStart = null;
    this._hits = [];
    this._window = 0;
  }

  get state() { return this._mode; }
  get recordStart() { return this._recordStart; }
  get recordEnd() { return this._recordStart + this._phraseDur(); }
  _phraseDur() { return this.barDur * (this._bars || 1); }

  /** ring: record the next phrase of `bars` bars (melody parts can be long),
   *  starting on the phrase grid counted from the first beat */
  ring(now, bars = 1) {
    if (this._mode !== "idle") return;
    this._mode = "armed";
    this._bars = bars;
    const threshold = now + 0.05;
    const k = Math.floor((threshold - this.first) / this._phraseDur());
    this._recordStart = this.first + (k + 1) * this._phraseDur();
    this._hits = [];
  }

  // Buffer every hit once the bell is rung; which measure a hit belongs to is
  // decided at judging time (the window is known then). Filtering here dropped
  // an on-beat-but-early beat-1 hit that arrives while still "armed".
  add(hit) {
    if (this._mode === "idle") return;
    this._hits.push(hit);
  }

  tick(now, { part, diff, free }) {
    if (this._mode === "armed" && now >= this._recordStart) this._mode = "recording";
    if (this._mode !== "recording") return null;
    this._window = diff.window;
    // the measure is complete at end - w: every later hit belongs to the next bar.
    // Judging here (not end + w) lets a locked loop start ON its first beat.
    if (now < this.recordEnd - diff.window) return null;
    // this measure = hits in [start - w, end - w): an early beat-1 hit is in,
    // an early hit for the NEXT bar's beat 1 is out (it stays buffered).
    const lo = this._recordStart - diff.window, hi = this.recordEnd - diff.window;
    const measure = this._hits.filter((h) => h.t >= lo && h.t < hi);
    // KEEP WHAT YOU GOT RIGHT (Easy, owner 2026-10-03): notes hit on an earlier
    // pass of this same step stay hit; a pass only needs the ones still missing
    if (!diff.keep || this._keptPart !== part) { this._kept = new Map(); this._keptPart = part; }
    const judge = free
      ? { pass: true, matched: measure.length, total: measure.length, extras: 0 }
      : judgeMeasure(measure, part, this._recordStart, this.beatDur, diff, diff.keep ? new Set(this._kept.keys()) : null);
    if (diff.keep && judge.pairs) for (const [i, h] of judge.pairs) this._kept.set(i, { lane: h.lane, pos: h.t - this._recordStart, velocity: h.velocity });
    if (!judge.pass) {
      this._hits = this._hits.filter((h) => h.t >= hi);   // keep the next bar's early hits
      this._recordStart += this._phraseDur();
      return { locked: false, judge };
    }
    // the locked loop: this pass as played, plus a kept hit for every note this pass missed
    if (diff.keep && judge.pairs) {
      const hitNow = new Set(judge.pairs.map(([i]) => i));
      for (const [i, k] of this._kept) if (!hitNow.has(i)) measure.push({ lane: k.lane, t: this._recordStart + k.pos, velocity: k.velocity });
    }
    this._kept = new Map(); this._keptPart = null;
    this._hits = measure;
    const bars = this._bars || 1;
    const layer = {
      bars,                                                                       // replays every `bars` bars
      startBar: Math.round((this._recordStart - this.first) / this.barDur) + bars,   // from the NEXT pass
      hits: this._hits.map((h) => ({ lane: h.lane, pos: h.t - this._recordStart, velocity: h.velocity })),
    };
    this._hits = [];
    this._mode = "idle";
    this._recordStart = null;
    return { locked: true, layer, judge };
  }

  __setRecording(window) {
    this._window = window;
    this._mode = "recording";
  }

  cancel() {
    this._mode = "idle";
    this._recordStart = null;
    this._hits = [];
  }
}
