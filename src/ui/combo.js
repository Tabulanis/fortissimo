/* combo.js — THE STREAK (owner, 2026-10-21, the gameplay pass "E": "yep" to a combo counter, hit grades, a streak sound and the band
   following your streak). A clean hit counts up, a miss or a stray hit breaks it. The counter sits on the right edge, pulses on each hit;
   at 10 / 25 / 50 / 100 a big stamp and a bright chime. bandLevel() is what the locked notes play at: 0.7 just after a break, swelling to
   full by a 20 streak — playing well is something you HEAR.
     createCombo({ getCtx, stamp }) -> { hit(grade, x, y), breakStreak(x, y), bandLevel(), reset(), get count(), get best() }
     grade(offsetSeconds) -> "PERFECT" | "GREAT" | "OK" */
export const grade = (off) => { const a = Math.abs(off); return a <= 0.04 ? "PERFECT" : a <= 0.09 ? "GREAT" : "OK"; };
const GRADE_COLOR = { PERFECT: "#fff3b0", GREAT: "#ffd76a", OK: "#ffb07a" };
const MILESTONES = [10, 25, 50, 100, 150, 200];

export function createCombo({ getCtx, stamp }) {
  const style = document.createElement("style");
  style.textContent = `
#gr-combo { position:fixed; right:18px; top:38%; z-index:25; text-align:center; pointer-events:none; font-family:system-ui, sans-serif;
  color:#ffd27a; text-shadow:0 2px 6px rgba(0,0,0,0.7); opacity:0; transition:opacity 0.25s; }
#gr-combo .n { font-size:46px; font-weight:800; line-height:1; display:block; transition:transform 0.08s; }
#gr-combo .l { font-size:13px; letter-spacing:0.18em; opacity:0.8; }
#gr-combo.pop .n { transform:scale(1.18); }
@media (max-height: 500px) { #gr-combo { right:10px; } #gr-combo .n { font-size:34px; } }
body.mk-creating #gr-combo { display:none; }`;
  document.head.appendChild(style);
  const el = document.createElement("div"); el.id = "gr-combo"; el.innerHTML = `<span class="n">0</span><span class="l">COMBO</span>`;
  document.body.appendChild(el);
  const n = el.querySelector(".n");
  let count = 0, best = 0, popT = null, band = 0.7;
  const show = () => { n.textContent = count; el.style.opacity = count >= 3 ? 1 : 0; };
  function chime(level) {   // a bright two-note ping, up a fifth (an octave for the big ones)
    const ctx = getCtx(); if (!ctx) return;
    const t = ctx.currentTime + 0.01, g = ctx.createGain(); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    const base = 660 * (level >= 50 ? 1.5 : 1);
    for (const [f, d] of [[base, 0], [base * (level >= 50 ? 2 : 1.5), 0.08]]) {
      const o = ctx.createOscillator(); o.type = "triangle"; o.frequency.value = f; o.connect(g); o.start(t + d); o.stop(t + 1);
    }
  }
  return {
    get count() { return count; }, get best() { return best; },
    /** a clean hit: the grade at the target (x, y on screen), the counter up, a milestone maybe */
    hit(g, x, y) {
      count++; best = Math.max(best, count);
      band = Math.min(1, 0.7 + 0.3 * (count / 20));
      if (x != null) stamp(g, x, y - 4, { size: g === "PERFECT" ? 30 : 26, color: GRADE_COLOR[g], ms: 750 });
      show(); el.classList.add("pop"); clearTimeout(popT); popT = setTimeout(() => el.classList.remove("pop"), 90);
      if (MILESTONES.includes(count)) { stamp(`${count} STREAK!`, window.innerWidth / 2, window.innerHeight * 0.3, { size: count >= 50 ? 58 : 46, color: "#fff3b0", ms: 1400 }); chime(count); }
    },
    /** a miss or a stray hit: the streak is gone */
    breakStreak(x, y) {
      if (count >= 10 && x != null) stamp("streak lost", x, y + 24, { size: 18, color: "#ff9a7a", ms: 800 });
      count = 0; band = 0.7; show();
    },
    /** what the band (the locked notes) plays at, 0.7..1 */
    bandLevel: () => band,
    reset() { count = 0; band = 0.7; show(); },
  };
}
