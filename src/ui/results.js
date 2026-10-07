/* results.js — the end-of-round panel: ACCURACY first (owner, 2026-10-03: it's about
 * getting 100%), then the grade and timing tendency.
 * show({ round, title, stats, last, run, onNext, onMenu }); Enter or the button continues.
 * run: { name, mult } — the run's preset and score multiplier: score = accuracy x multiplier.
 * PLAIN WORDS (2026-10-07, the any-idiot rule): what you hit first, then how tight it was in words;
 * the % stays big (his "chase the 100%"), no grade letters, no "×0.51" maths on screen. */
const TIMING_WORD = { S: "dead on", A: "tight", B: "good", C: "a bit loose", D: "loose" };

const GRADE_COLOR = { S: "#ffd36a", A: "#9be38a", B: "#8ec5ff", C: "#f0b36a", D: "#ff8a7a" };

export function createResults() {
  const root = document.createElement("div");
  root.id = "gr-results";
  root.style.cssText = `position:fixed; inset:0; display:none; align-items:center; justify-content:center;
    background:rgba(10,6,14,0.55); z-index:50; font-family:system-ui, sans-serif; color:#f4e9dc;`;
  const card = document.createElement("div");
  card.style.cssText = `min-width:300px; max-width:90vw; padding:28px 36px; border-radius:14px; text-align:center;
    background:rgba(28,18,26,0.92); border:1px solid rgba(255,190,120,0.35); box-shadow:0 10px 40px rgba(0,0,0,0.5);`;
  root.appendChild(card);
  document.body.appendChild(root);

  let onNext = null;
  const close = () => { root.style.display = "none"; const f = onNext; onNext = null; if (f) f(); };
  window.addEventListener("keydown", (e) => {
    if (root.style.display !== "none" && e.key === "Enter") { e.preventDefault(); e.stopImmediatePropagation(); close(); }
  }, true);

  return {
    get open() { return root.style.display !== "none"; },
    show({ round, title, stats, last, run, failed = false, onNext: next, onMenu, nextLabel }) {
      onNext = next;
      const tend = Math.abs(stats.biasMs) < 8 ? "right on the beat"
        : stats.biasMs < 0 ? "a hair early, on average" : "a hair late, on average";
      card.innerHTML = `
        <div style="font-size:14px; letter-spacing:2px; opacity:0.7; ${failed ? "color:#ff8a7a; opacity:1" : ""}">${round.toUpperCase()} ${failed ? "— FAILED" : "COMPLETE"}</div>
        <div style="font-size:18px; margin-top:4px; opacity:0.85">${title}</div>
        <div style="font-size:88px; font-weight:800; line-height:1.1; margin:14px 0 0; color:${GRADE_COLOR[stats.grade] || "#fff"}">${stats.accuracy}%</div>
        <div style="font-size:20px; font-weight:600; letter-spacing:1px">${stats.accuracy >= 100 ? "💯 PERFECT!" : `on the beat · ${TIMING_WORD[stats.grade] || "good"}`}</div>
        <div style="margin-top:14px; font-size:17px; line-height:1.7">
          ${stats.onBox === stats.hits ? `You hit every note — all ${stats.hits}! ✓` : `You hit ${stats.onBox} of ${stats.hits} notes`}<br>
          <span style="opacity:0.8">you're ${tend}</span>
        </div>
        ${run ? `<div style="margin-top:8px; font-size:22px; color:#ffd27a">Score ${Math.round(stats.accuracy * run.mult * 10)}
          <span style="font-size:14px; opacity:0.75">on ${run.name}</span></div>` : ""}
        <button id="gr-results-next" style="margin-top:20px; padding:10px 22px; font-size:16px; border-radius:8px;
          border:1px solid rgba(255,190,120,0.6); background:rgba(255,160,80,0.18); color:#fff; cursor:pointer">
          ${nextLabel || (failed ? "Try again ▶" : last ? "All rounds done — free play ▶" : "Next round ▶")}</button>
        ${onMenu ? `<button id="gr-results-menu" style="margin-top:20px; margin-left:8px; padding:10px 22px; font-size:16px; border-radius:8px;
          border:1px solid rgba(255,190,120,0.35); background:none; color:#fff; cursor:pointer">Menu</button>` : ""}
        <div style="margin-top:8px; font-size:12px; opacity:0.55">or press Enter</div>`;
      card.querySelector("#gr-results-next").onclick = close;
      if (onMenu) card.querySelector("#gr-results-menu").onclick = () => { root.style.display = "none"; onNext = null; onMenu(); };
      root.style.display = "flex";
    },
  };
}
