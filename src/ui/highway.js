/* highway.js — round 4's NOTE HIGHWAY (2026-10-08): the cues for "drums AND notes", drawn over the bottom of the
   screen while the hydra and the acid fill the view above. Left block: the six drums (the shield). Right block: the
   eight note lanes (the heads' strikes), each lane in its head's colour. Notes fall onto the hit line at their beat.
     createHighway({ drums: [{key, label}], notes: [{key, head}], headColors }) ->
       { draw(items, now, approach), flash(col, good), show(on) }
     items: [{ col, at (seconds), head? }] — col 0..5 drums, 6..13 notes */
export function createHighway({ drums, notes, headColors = ["#ff7a5a", "#e8c84a", "#5ad1ff"] }) {
  const cv = document.createElement("canvas");
  cv.id = "gr-highway";
  cv.style.cssText = "position:fixed;left:50%;bottom:8px;transform:translateX(-50%);z-index:20;pointer-events:none;" +
    "width:min(760px,96vw);height:min(36vh,300px);display:none";
  document.body.appendChild(cv);
  const g = cv.getContext("2d");
  const cols = [...drums.map((d) => ({ ...d, kind: "drum", color: "#c9b48a" })), ...notes.map((n) => ({ ...n, kind: "note", color: headColors[n.head] || "#fff" }))];
  const flashes = new Map();   // col -> { until, good }
  const api = {
    el: cv,
    setNoteColor(c) { for (const col of cols) if (col.kind === "note") col.color = c; },
    show(on) { cv.style.display = on ? "block" : "none"; },
    flash(col, good) { flashes.set(col, { until: performance.now() + 160, good }); },
    draw(items, now, approach = 1.6) {
      if (cv.style.display === "none") return;
      const W = cv.clientWidth, H = cv.clientHeight, dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      const gap = W * 0.05, colW = (W - gap) / cols.length, xOf = (c) => c * colW + (c >= drums.length ? gap : 0);
      const hitY = H - 34;
      // the lanes
      cols.forEach((c, i) => {
        const x = xOf(i);
        g.fillStyle = i < drums.length ? "rgba(30,22,18,0.55)" : "rgba(14,20,30,0.55)";
        g.fillRect(x + 1, 0, colW - 2, H);
        const f = flashes.get(i), on = f && f.until > performance.now();
        g.fillStyle = on ? (f.good ? "rgba(255,255,255,0.85)" : "rgba(255,80,60,0.7)") : c.color;
        g.globalAlpha = on ? 1 : 0.5; g.fillRect(x + 3, hitY - 3, colW - 6, 6); g.globalAlpha = 1;
        g.fillStyle = "#f4e9dc"; g.font = `bold ${Math.min(18, colW * 0.45)}px system-ui`; g.textAlign = "center";
        g.fillText(c.label || c.key.toUpperCase(), x + colW / 2, H - 9);
      });
      // the notes: at the hit line exactly on their time
      for (const it of items) {
        const dt = it.at - now;
        if (dt > approach || dt < -0.15) continue;
        const y = hitY - (dt / approach) * (hitY - 6), x = xOf(it.col), c = cols[it.col];
        g.fillStyle = c.color; g.shadowColor = c.color; g.shadowBlur = 10;
        g.beginPath(); g.roundRect(x + 4, y - 7, colW - 8, 14, 6); g.fill(); g.shadowBlur = 0;
      }
      // the divide: drums (shield) | notes (the heads)
      g.fillStyle = "rgba(244,233,220,0.6)"; g.font = "12px system-ui"; g.textAlign = "center";
      g.fillText("DRUMS — the shield", xOf(0) + (drums.length * colW) / 2, 14);
      g.fillText("NOTES — the heads", xOf(drums.length) + (notes.length * colW) / 2, 14);
    },
  };
  return api;
}
