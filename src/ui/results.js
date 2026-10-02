/* results.js — the end-of-round panel: grade, accuracy, timing tendency.
 * show({ round, title, stats, last, onNext }); Enter or the button continues. */

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
    show({ round, title, stats, last, onNext: next }) {
      onNext = next;
      const tend = Math.abs(stats.biasMs) < 8 ? "right on the beat"
        : stats.biasMs < 0 ? `rushing — about ${-stats.biasMs} ms early` : `dragging — about ${stats.biasMs} ms late`;
      card.innerHTML = `
        <div style="font-size:14px; letter-spacing:2px; opacity:0.7">${round.toUpperCase()} COMPLETE</div>
        <div style="font-size:18px; margin-top:4px; opacity:0.85">${title}</div>
        <div style="font-size:96px; font-weight:800; line-height:1.1; margin:14px 0 4px; color:${GRADE_COLOR[stats.grade] || "#fff"}">${stats.grade}</div>
        <div style="font-size:28px; font-weight:600">${stats.accuracy}% accuracy</div>
        <div style="margin-top:14px; font-size:15px; line-height:1.7; opacity:0.85">
          ${stats.onBox} of ${stats.hits} hits inside the box<br>
          average timing error ${stats.meanMs} ms<br>
          you're ${tend}
        </div>
        <button id="gr-results-next" style="margin-top:20px; padding:10px 22px; font-size:16px; border-radius:8px;
          border:1px solid rgba(255,190,120,0.6); background:rgba(255,160,80,0.18); color:#fff; cursor:pointer">
          ${last ? "All rounds done — free play ▶" : "Next round ▶"}</button>
        <div style="margin-top:8px; font-size:12px; opacity:0.55">or press Enter</div>`;
      card.querySelector("#gr-results-next").onclick = close;
      root.style.display = "flex";
    },
  };
}
