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
      // replay starts in pass g.pass + 1; find the first such occurrence at or
      // after fromT, then step by period until past toT.
      const relFrom = fromT - first;
      let k = Math.max(g.pass + 1, Math.ceil((relFrom - g.pos) / this.period));
      for (;;) {
        const time = first + k * this.period + g.pos;
        if (time >= toT) break;
        if (time >= fromT) out.push({ lane, time, velocity: g.velocity });
        k++;
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
