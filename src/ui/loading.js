/* loading.js — THE LOADING SCREEN (owner, 10-09, "make it professional": nothing visible until it's ready — the game used to
   appear with stand-in drums and the models popping in over the next fifteen seconds).
   The overlay itself is in index.html (plain HTML + CSS, so it shows before any script runs): the title, a progress bar, a
   status line. This drives it:
     - progress from three's DefaultLoadingManager (every model, texture and KTX2 file goes through it) — the bar fills as
       files land, never goes backwards, and the last stretch is the shader warm-up;
     - it lifts when the stage is built AND the loader has been quiet for a moment (the models arrive in waves — a drained
       queue is not "done"), with a floor so it never flashes and a ceiling so a stuck file never traps the player;
     - a failed file shows a plain message and a Retry button instead of a black screen.
   createLoading() -> { stageBuilt(), fail(msg) } */
import * as THREE from "three";
import { bootlog } from "../bootlog.js";

export function createLoading() {
  const el = document.getElementById("gr-loading");
  if (!el) return { stageBuilt() {}, fail() {} };
  const bar = el.querySelector(".bar i"), status = el.querySelector(".status");
  const t0 = performance.now(), MIN_MS = 1400, MAX_MS = 25000, QUIET_MS = 900;
  let seen = 0, total = 0, shown = 0, lastActivity = performance.now(), built = false, done = false, failed = false;
  const set = (frac, text) => { shown = Math.max(shown, Math.min(1, frac)); bar.style.width = `${Math.round(shown * 100)}%`; if (text) status.textContent = text; };
  const M = THREE.DefaultLoadingManager, prevProgress = M.onProgress, prevError = M.onError;
  M.onProgress = (url, loaded, all) => { seen = loaded; total = Math.max(total, all); lastActivity = performance.now();
    set(0.1 + 0.75 * (total ? seen / total : 0), `Loading ${String(url).split("/").pop().split("?")[0]}`); if (prevProgress) prevProgress(url, loaded, all); };
  M.onError = (url) => { fail(`Couldn't load ${String(url).split("/").pop()}`); if (prevError) prevError(url); };
  function fail(msg) {
    if (done) return; failed = true;
    status.innerHTML = `${msg}.<br>Check the connection and try again.`;
    const b = document.createElement("button"); b.textContent = "Retry"; b.onclick = () => location.reload();
    status.appendChild(document.createElement("br")); status.appendChild(b);
  }
  function lift() {
    done = true; M.onProgress = prevProgress; M.onError = prevError;
    bootlog("loading lifted", { ms: Math.round(performance.now() - t0), files: `${seen}/${total}`, built });
    set(1, "Ready");
    el.classList.add("out");
    setTimeout(() => el.remove(), 700);
  }
  const tick = () => {
    if (done || failed) return;
    const now = performance.now(), age = now - t0;
    if (built && shown < 0.9) set(0.9, "Warming up");
    const quiet = now - lastActivity > QUIET_MS;
    if ((built && quiet && age > MIN_MS) || age > MAX_MS) lift(); else setTimeout(tick, 150);
  };
  setTimeout(tick, 150);
  set(0.05, "Loading");
  return { stageBuilt() { built = true; lastActivity = performance.now(); }, fail };
}
