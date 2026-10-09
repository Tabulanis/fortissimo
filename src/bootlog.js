/* bootlog.js — DEV ONLY: report loading steps to the dev server (device.log),
   so a crash on a tablet or phone still shows the last step it reached.
   sendBeacon is queued by the browser, so lines already sent survive a crash. */
const t0 = performance.now();

const RING = [], KEEP = 300;   // (10-09 release) the last lines, kept for the player's "copy log" in Options — no server in the shipped game
export const logLines = () => RING.slice();
export function bootlog(step, data = {}) {
  const line = JSON.stringify({ t: Math.round(performance.now() - t0), step, ...data });
  RING.push(line); if (RING.length > KEEP) RING.shift();
  if (!import.meta.env.DEV) { if (/error|failed|crash/i.test(step)) try { localStorage.setItem("gr.lastlog", RING.slice(-60).join("\n")); } catch { /* fine */ } return; }
  try { navigator.sendBeacon("/__log", line); } catch { /* logging must never break the game */ }
}
// crashes land in the log too (release: the only trace a player can send us)
window.addEventListener("error", (e) => bootlog("error", { msg: String(e.message).slice(0, 300), at: `${e.filename}:${e.lineno}` }));
window.addEventListener("unhandledrejection", (e) => bootlog("error", { msg: String(e.reason && e.reason.message || e.reason).slice(0, 300) }));
