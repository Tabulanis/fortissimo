/* ghosts.js — ghost loops. Pure: no DOM, no audio.
   What the player plays during a pass of the loop is recorded EXACTLY as
   played (real timing, real velocity, mistakes and OFF notes included —
   never snapped to the grid) and replays as a ghost from the NEXT pass on.
   Replaying a lane replaces its ghost; untouched lanes keep theirs. */

export class Ghosts {
  /** @param {number} period loop length in seconds */
  constructor(period) {
    this.period = period;
    // lane name -> latest recording: { pos, velocity, pass }
    this.ghosts = new Map();
  }

  /**
   * Record one press, exactly as played.
   * @param {string} lane lane name
   * @param {number} t the press time on the audio clock (s)
   * @param {number} velocity the velocity the press actually played with
   * @param {number} first the time of beat index 0 (s)
   */
  record(lane, t, velocity, first) {
    const rel = t - first;
    const pass = Math.floor(rel / this.period);
    const pos = rel - pass * this.period;   // exact, never snapped
    this.ghosts.set(lane, { pos, velocity, pass });
  }

  /**
   * Every ghost hit whose absolute time (first + k*period + pos, for any pass
   * k strictly AFTER the pass it was recorded in) falls in [fromT, toT).
   * @returns {{lane: string, time: number, velocity: number}[]}
   */
  events(fromT, toT, first) {
    const out = [];
    for (const [lane, g] of this.ghosts) {
      const relFrom = fromT - first;
      const relTo = toT - first;
      // earliest replay pass: g.pass + 1; earliest replay time relative to first
      const earliest = (g.pass + 1) * this.period + g.pos;
      // first k (>= g.pass+1) with first + k*period + g.pos >= fromT
      let k0 = Math.ceil((relFrom - g.pos) / this.period);
      if (k0 < g.pass + 1) k0 = g.pass + 1;
      for (let k = k0; ; k++) {
        const time = first + k * this.period + g.pos;
        if (time < earliest) continue;      // guard: replay starts next pass
        if (time >= toT) break;
        if (time >= fromT) out.push({ lane, time, velocity: g.velocity });
      }
    }
    return out;
  }

  /** Names of lanes that currently have a ghost. */
  get lanes() {
    return [...this.ghosts.keys()];
  }

  clear() {
    this.ghosts.clear();
  }
}
