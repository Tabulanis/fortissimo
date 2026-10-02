/* bootlog.js — DEV ONLY: report loading steps to the dev server (device.log),
   so a crash on a tablet or phone still shows the last step it reached.
   sendBeacon is queued by the browser, so lines already sent survive a crash. */
const t0 = performance.now();

export function bootlog(step, data = {}) {
  if (!import.meta.env.DEV) return;
  const line = JSON.stringify({ t: Math.round(performance.now() - t0), step, ...data });
  try { navigator.sendBeacon("/__log", line); } catch { /* logging must never break the game */ }
}
