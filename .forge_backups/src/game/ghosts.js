/* ghosts.js — ghost loops. Pure: no DOM, no audio.
   What the player plays during a pass of the loop is recorded EXACTLY as
   played (real timing, real velocity, mistakes and OFF notes included —
   never snapped to the grid) and replays as a ghost from the NEXT pass on.
   Replaying a lane replaces its ghost; untouched lanes keep theirs. */

export class Ghosts {
  /** @param {number} period loop length in seconds */
  constructor(period) {
    this.period = period;
    // lane name -> list of takes [{ pass, hits: [{ pos, velocity }] }],
    // oldest take first; each take is every hit of one pass, in time order.
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
    // Every hit of the pass accumulates into this pass's take; a later pass
    // records a fresh take, which supersedes the old one from its next pass on.
    let takes = this.ghosts.get(lane);
    if (!takes) {
      takes = [];
      this.ghosts.set(lane, takes);
    }
    const last = takes[takes.length - 1];
    if (last && last.pass === pass) {
      last.hits.push({ pos, velocity });
    } else {
      takes.push({ pass, hits: [{ pos, velocity }] });
    }
  }

  /**
   * Every ghost hit whose absolute time (first + k*period + pos, for any pass
   * k strictly AFTER the pass it was recorded in) falls in [fromT, toT).
   * @returns {{lane: string, time: number, velocity: number}[]}
   */
  events(fromT, toT, first) {
    // For absolute pass k, the lane's ghost is its latest take with
    // take.pass < k: the old take keeps playing during the replacing pass
    // itself, and only takes over from the replacing pass's next pass on.
    const out = [];
    const relFrom = fromT - first;
    const kLo = Math.floor(relFrom / this.period);
    const kHi = Math.floor((toT - 1e-12) / this.period);
    for (const [lane, takes] of this.ghosts) {
      let current = null;
      for (let k = kLo; k <= kHi; k++) {
        let active = current;
        const sup = takes.find((tk) => tk.pass === k - 1);
        if (sup) {
          active = sup;
          current = sup;
        }
        if (!active) continue;
        for (const h of active.hits) {
          const time = first + k * this.period + h.pos;
          if (time >= fromT && time < toT) {
            out.push({ lane, time, velocity: h.velocity });
          }
        }
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
