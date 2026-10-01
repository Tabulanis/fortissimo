export function judgeMeasure(hits, part, barStart, beatDur, diff) {
  const total = part.length;
  const matched = new Array(part.length).fill(false);
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
    if (best >= 0 && bestD <= diff.window) matched[best] = true;
    else extras++;
  }
  const hitsMatched = matched.filter(Boolean).length;
  return {
    pass: total > 0 && hitsMatched / total >= diff.ratio && extras <= diff.extras,
    matched: hitsMatched,
    total,
    extras,
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
  get recordEnd() { return this._recordStart + this.barDur; }

  ring(now) {
    if (this._mode !== "idle") return;
    this._mode = "armed";
    const threshold = now + 0.05;
    const k = Math.floor((threshold - this.first) / this.barDur);
    this._recordStart = this.first + (k + 1) * this.barDur;
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
    if (now < this.recordEnd + diff.window) return null;
    // this measure = hits in [start - w, end - w): an early beat-1 hit is in,
    // an early hit for the NEXT bar's beat 1 is out (it stays buffered).
    const lo = this._recordStart - diff.window, hi = this.recordEnd - diff.window;
    const measure = this._hits.filter((h) => h.t >= lo && h.t < hi);
    const judge = free
      ? { pass: true, matched: measure.length, total: measure.length, extras: 0 }
      : judgeMeasure(measure, part, this._recordStart, this.beatDur, diff);
    if (!judge.pass) {
      this._hits = this._hits.filter((h) => h.t >= hi);   // keep the next bar's early hits
      this._recordStart += this.barDur;
      return { locked: false, judge };
    }
    this._hits = measure;
    const layer = {
      startBar: Math.round((this._recordStart - this.first) / this.barDur) + 1,
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
