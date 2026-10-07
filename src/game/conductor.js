/* conductor.js — ROUND 4's core, pure (owner, 2026-10-06: "conductor mode").

   The band (three SECTIONS: drums, bass, treble) plays on; the player conducts it with
   GESTURES judged on the BAR LINE, not the beat:
     cue(section, t)      bring it in — lands on the nearest bar line
     cut(section, t)      silence it — likewise
     accent(section, t)   a stab on the downbeat: a short surge (the hydra-head killer)
     swell(section, t)    start a crescendo that builds across bars until cut/accent/release
     release(section, t)  end the swell (it stays at the level it reached)
   Timing: a gesture within `window` beats of a bar line is CLEAN and lands exactly on
   that bar; outside it, it is LATE: it lands where it was given and the section DIPS
   (level * (1 - dip)) for a beat — you hear the stumble (music is the punishment).

   Time is in BEATS from the song's start, continuous; bars are `beatsPerBar` long.
   level(section, t) gives the section's gain 0..1 at time t (for the mixer, each frame).
   Returns an event per gesture { kind, section, bar, clean, error } for sound/visuals.
   No audio, no DOM: tested in node. */
export const SECTIONS = ["drums", "bass", "treble"];

export class Conductor {
  constructor({ beatsPerBar = 4, window = 0.5, dip = 0.6, swellBars = 2, accentBeats = 1 } = {}) {
    this.beatsPerBar = beatsPerBar; this.window = window; this.dip = dip;
    this.swellBars = swellBars; this.accentBeats = accentBeats;
    this.s = {};
    for (const k of SECTIONS) this.s[k] = { on: true, base: 0.7, from: 0.7, to: 0.7, t0: -1e9, t1: -1e9, dipUntil: -1e9, accentUntil: -1e9, swelling: false };
    this.log = [];
  }
  /** the nearest bar line to t, and how far off (beats, signed: + = late) */
  nearestBar(t) {
    const bar = Math.round(t / this.beatsPerBar);
    return { bar, at: bar * this.beatsPerBar, error: t - bar * this.beatsPerBar };
  }
  _judge(kind, section, t) {
    const { bar, at, error } = this.nearestBar(t);
    const clean = Math.abs(error) <= this.window;
    const ev = { kind, section, bar, at: clean ? at : t, clean, error: +error.toFixed(3) };
    if (!clean) this.s[section].dipUntil = t + 1;   // a beat of stumble
    this.log.push(ev);
    return ev;
  }
  _ramp(section, to, t, dur) { const S = this.s[section]; S.from = this.level(section, t); S.to = to; S.t0 = t; S.t1 = t + dur; }
  cue(section, t) {
    const ev = this._judge("cue", section, t); const S = this.s[section];
    S.on = true; S.swelling = false; this._ramp(section, S.base, ev.at, 0.25);
    return ev;
  }
  cut(section, t) {
    const ev = this._judge("cut", section, t); const S = this.s[section];
    S.on = false; S.swelling = false; this._ramp(section, 0, ev.at, 0.1);
    return ev;
  }
  accent(section, t) {
    const ev = this._judge("accent", section, t); const S = this.s[section];
    S.on = true; S.swelling = false; S.accentUntil = ev.at + this.accentBeats;
    this._ramp(section, S.base, ev.at, 0.05);
    return ev;
  }
  swell(section, t) {
    const ev = this._judge("swell", section, t); const S = this.s[section];
    S.on = true; S.swelling = true; this._ramp(section, 1, ev.at, this.swellBars * this.beatsPerBar);
    return ev;
  }
  release(section, t) {
    const S = this.s[section]; if (!S.swelling) return null;
    const ev = { kind: "release", section, at: t, clean: true, error: 0 };
    const here = this.level(section, t); S.swelling = false; S.base = Math.max(0.7, here); this._ramp(section, here, t, 0.01);
    this.log.push(ev); return ev;
  }
  /** the section's gain 0..1 at time t (beats) */
  level(section, t) {
    const S = this.s[section];
    let v;
    if (t <= S.t0) v = S.from; else if (t >= S.t1) v = S.to; else v = S.from + (S.to - S.from) * (t - S.t0) / (S.t1 - S.t0);
    if (t < S.accentUntil && t >= S.accentUntil - this.accentBeats) v = Math.min(1, v + 0.35 * (1 - (t - (S.accentUntil - this.accentBeats)) / this.accentBeats));
    if (t < S.dipUntil) v *= 1 - this.dip;
    return Math.max(0, Math.min(1, v));
  }
  /** how many sections are playing (for the dome: all three or it thins) */
  playing(t) { return SECTIONS.filter((k) => this.level(k, t) > 0.05).length; }
  isOn(section) { return this.s[section].on; }
}
