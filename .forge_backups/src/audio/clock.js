/* clock.js — lookahead beat scheduler on the audio clock.
   Every 25 ms, schedules any beat falling within the next 0.1 s. */

/**
 * @param {AudioContext} ctx
 * @param {{bpm: number, onBeat: (time: number, n: number) => void}} opts
 * @returns {{stop: () => void, beatTimes: number[]}}
 */
export function startClock(ctx, { bpm, onBeat }) {
  const beatDur = 60 / bpm;
  const first = ctx.currentTime + 0.5;
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
  };
}
