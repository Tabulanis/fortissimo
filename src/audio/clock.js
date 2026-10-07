/* clock.js — lookahead beat scheduler on the audio clock.
   Every 25 ms, schedules any beat falling within the next 0.1 s. */

/**
 * @param {AudioContext} ctx
 * @param {{bpm: number, onBeat: (time: number, n: number) => void, at?: number}} opts  at: the first beat's time (default: 0.5 s from now) —
 *   round 4 starts the next movement's clock exactly on the old one's bar line
 * @returns {{stop: () => void, beatTimes: number[]}}
 */
export function startClock(ctx, { bpm, onBeat, at }) {
  const beatDur = 60 / bpm;
  const first = at ?? ctx.currentTime + 0.5;
  const beatTimes = [];
  let next = first;
  let n = 0;
  let stopped = false;

  const timer = setInterval(() => {
    if (stopped) return;
    const horizon = ctx.currentTime + 0.1;
    while (next < horizon) {
      beatTimes.push(next);
      onBeat(next, n);
      n++;
      next += beatDur;
    }
  }, 25);

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    get beatTimes() { return beatTimes; },
    get first() { return first; },
    get beatDur() { return beatDur; },
  };
}
