/* locked.js — "LOCKED!" slammed onto the screen like something hitting a
   windshield (owner, 2026-10-02): it flies in huge, smacks flat with a squash
   and a white impact ring, holds a moment, then slides down a little,
   smearing, and fades. Every lock gets it — a drum part, a four-note step.
   KABOOM style (owner): a military STENCIL face (Black Ops One, SIL OFL —
   public/fonts/, licence beside it) and a rattle — it shakes back and forth,
   dying down — before it smears out. */

// load the stencil face now, so the very first LOCKED! isn't in a fallback font
try {
  const face = new FontFace("Black Ops One", "url(/fonts/BlackOpsOne.woff2)");
  face.load().then((f) => document.fonts.add(f)).catch(() => {});
} catch { /* very old browser: the fallback font still slams */ }

const CSS = `
.gr-locked { position: fixed; inset: 0; display: grid; place-items: center; pointer-events: none; z-index: 40; }
.gr-locked .word { font: clamp(64px, 14vw, 180px)/1 "Black Ops One", "Arial Black", sans-serif; letter-spacing: 0.06em;
  color: #ffd76a; -webkit-text-stroke: 4px #3a1406; paint-order: stroke fill;
  text-shadow: 0 0 24px rgba(255, 170, 60, 0.85), 0 6px 0 #7a2a08;
  animation: gr-slam 2s linear forwards; }
.gr-locked .ring { position: absolute; width: 40vmin; height: 40vmin; border-radius: 50%;
  border: 6px solid rgba(255, 245, 220, 0.9); animation: gr-ring 0.45s ease-out forwards; }
@keyframes gr-slam {
  0%   { transform: scale(3.2) rotate(var(--rot)); opacity: 0; filter: blur(6px); animation-timing-function: cubic-bezier(.5,0,.9,.4); }
  7%   { transform: scale(0.9, 0.76) rotate(var(--rot)); opacity: 1; filter: blur(0); }        /* SMACK: squashed flat */
  11%  { transform: scale(1.1, 1.04) rotate(calc(var(--rot) + 6deg)) translate(4px, -3px); }  /* the rattle... */
  15%  { transform: scale(1) rotate(calc(var(--rot) - 7deg)) translate(-5px, 2px); }
  19%  { transform: scale(1.03) rotate(calc(var(--rot) + 5deg)) translate(3px, -2px); }
  23%  { transform: scale(1) rotate(calc(var(--rot) - 4deg)) translate(-3px, 1px); }
  27%  { transform: scale(1.01) rotate(calc(var(--rot) + 2.5deg)) translate(2px, 0); }
  31%  { transform: scale(1) rotate(calc(var(--rot) - 1.5deg)); }
  35%  { transform: scale(1) rotate(calc(var(--rot) + 0.6deg)); }                              /* ...dying down */
  39%  { transform: scale(1) rotate(var(--rot)); }
  62%  { transform: scale(1) translateY(0) rotate(var(--rot)); opacity: 1; filter: blur(0); animation-timing-function: ease-in; }
  100% { transform: scale(1.02, 1.14) translateY(8vh) rotate(var(--rot)); opacity: 0; filter: blur(5px); }   /* slides down, smears, gone */
}
@keyframes gr-ring {
  0%   { transform: scale(0.3); opacity: 0.95; }
  100% { transform: scale(2.4); opacity: 0; border-width: 1px; }
}
`;

let styleAdded = false;
/* STAMPED ON THE TARGET (owner, 2026-10-03): the same slam, but on the drum or
   bar itself — every hit stamps its accuracy (0-100%), a lock stamps LOCKED!.
   x, y: the target on screen (CSS px). size: font px. ms: how long it lives. */
const STAMP_CSS = `
.gr-stamp { position: fixed; pointer-events: none; z-index: 41; transform: translate(-50%, -50%); }
.gr-stamp .word { font-family: "Black Ops One", "Arial Black", sans-serif; letter-spacing: 0.04em; white-space: nowrap;
  -webkit-text-stroke: 2px #3a1406; paint-order: stroke fill; text-shadow: 0 0 14px rgba(255, 170, 60, 0.8), 0 3px 0 #7a2a08;
  animation: gr-slam var(--dur) linear forwards; }
`;
let stampStyle = false;
export function showStamp(text, x, y, { size = 34, color = "#ffd76a", ms = 900 } = {}) {
  if (!stampStyle) {
    if (!styleAdded) { const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st); styleAdded = true; }
    const st = document.createElement("style"); st.textContent = STAMP_CSS; document.head.appendChild(st); stampStyle = true;
  }
  const el = document.createElement("div");
  el.className = "gr-stamp";
  el.style.left = x + "px"; el.style.top = y + "px";
  const rot = (Math.random() * 10 - 5).toFixed(1) + "deg";
  el.innerHTML = `<div class="word" style="--rot:${rot}; --dur:${ms}ms; font-size:${size}px; color:${color}">${text}</div>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms + 60);
}
