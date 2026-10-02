/* hud.js — the on-screen layer over the 3D stage: the ghost bell, what the
   bell is doing, lives, which part of the song you're on, and difficulty.
   Plain DOM, no game logic: main.js tells it what to show. */

const CSS = `
#gr-hud { position: fixed; inset: 0; pointer-events: none; z-index: 20;
  font: 15px/1.3 system-ui, sans-serif; color: #f4e9d8; }
#gr-hud .top { position: absolute; top: 14px; left: 18px; right: 18px;
  display: flex; justify-content: space-between; align-items: flex-start; }
#gr-hud .chip { background: rgba(10, 8, 6, 0.55); border: 1px solid rgba(255, 200, 120, 0.25);
  border-radius: 10px; padding: 6px 12px; backdrop-filter: blur(3px); }
#gr-hud .lives { letter-spacing: 3px; color: #ff6a50; font-size: 18px; }
#gr-hud .bellbox { position: absolute; right: 26px; bottom: 40px; text-align: center; }
#gr-hud .bell { pointer-events: auto; cursor: pointer; width: 84px; height: 84px; border-radius: 50%;
  display: grid; place-items: center; font-size: 42px; user-select: none;
  background: radial-gradient(circle at 40% 35%, #ffd27a, #b8741c 70%);
  box-shadow: 0 0 18px rgba(255, 190, 90, 0.45); transition: transform 0.08s, box-shadow 0.2s; }
#gr-hud .bell.armed { box-shadow: 0 0 26px rgba(255, 220, 120, 0.9); }
#gr-hud .bell.recording { box-shadow: 0 0 30px rgba(255, 70, 50, 0.95); }
#gr-hud .bell.tick { transform: scale(1.12) rotate(-8deg); }
#gr-hud .bellkey { margin-top: 6px; font-size: 12px; opacity: 0.7; }
#gr-hud .listen { pointer-events: auto; cursor: pointer; width: 54px; height: 54px; margin: 0 auto 12px; border-radius: 50%;
  display: grid; place-items: center; font-size: 26px; user-select: none;
  background: radial-gradient(circle at 40% 35%, #9fd4ff, #2f5f8a 72%); box-shadow: 0 0 14px rgba(120, 190, 255, 0.45);
  transition: transform 0.08s; }
#gr-hud .listen:active { transform: scale(0.94); }
#gr-hud .status { position: absolute; top: 64px; left: 50%; transform: translateX(-50%);
  font-size: 22px; text-shadow: 0 2px 8px #000; text-align: center; white-space: nowrap; }
#gr-hud .status.good { color: #9dff9a; } #gr-hud .status.bad { color: #ffb070; }
#gr-hud .count { font-size: 15px; opacity: 0.85; }
/* small screens (phones): tighter chips, wrapping status, smaller bell */
@media (max-width: 760px), (max-height: 480px) {
  #gr-hud { font-size: 13px; }
  #gr-hud .top { top: max(8px, env(safe-area-inset-top)); left: max(10px, env(safe-area-inset-left)); right: max(10px, env(safe-area-inset-right)); }
  #gr-hud .status { top: 48px; font-size: 16px; white-space: normal; width: min(64vw, calc(100vw - 130px)); }   /* clear of the gear on the right */
  #gr-hud .bellbox { right: max(14px, env(safe-area-inset-right)); bottom: max(14px, env(safe-area-inset-bottom)); }
  #gr-hud .bell { width: 64px; height: 64px; font-size: 32px; }
}
/* touch screens: no keyboard hint under the bell */
@media (pointer: coarse) { #gr-hud .bellkey { display: none; } }
.touch #gr-hud .bellkey { display: none; }
`;

export function createHud({ onBell, onHint } = {}) {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.id = "gr-hud";
  root.innerHTML = `
    <div class="top">
      <div class="chip"><span class="part">Part 1</span> · <span class="diff">Easy</span></div>
      <div class="chip lives">♥♥♥</div>
    </div>
    <div class="status"></div>
    <div class="bellbox">
      <div class="listen" title="Listen — hear the whole section, lit up (Tab / View)">👂</div>
      <div class="bell" title="Ghost bell — record one measure and loop it">🔔</div>
      <div class="bellkey">Space</div>
    </div>`;
  document.body.appendChild(root);

  const $ = (s) => root.querySelector(s);
  const bell = $(".bell");
  // pointerdown, not click: rings the moment a finger lands (no tap delay)
  bell.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); onBell && onBell(); });
  $(".listen").addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); onHint && onHint(); });

  let statusTimer = 0;
  return {
    setPart(text) { $(".part").textContent = text; },
    setDifficulty(text) { $(".diff").textContent = text; },
    setLives(n, max = 3) { $(".lives").textContent = "♥".repeat(Math.max(0, n)) + "♡".repeat(Math.max(0, max - n)); },
    /** state: "idle" | "armed" | "recording" */
    setBellState(state) {
      bell.classList.toggle("armed", state === "armed");
      bell.classList.toggle("recording", state === "recording");
    },
    /** One metronome tick of the bell (call on each beat while armed/recording). */
    tick() {
      bell.classList.add("tick");
      setTimeout(() => bell.classList.remove("tick"), 90);
    },
    /** kind: "" | "good" | "bad"; ms = 0 keeps it until replaced. */
    say(html, kind = "", ms = 0) {
      const s = $(".status");
      s.innerHTML = html;
      s.className = "status" + (kind ? " " + kind : "");
      clearTimeout(statusTimer);
      if (ms) statusTimer = setTimeout(() => { s.innerHTML = ""; }, ms);
    },
  };
}
