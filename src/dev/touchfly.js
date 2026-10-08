/* touchfly.js — the LEVEL EDITOR on a tablet / phone (owner, 2026-10-08: "put all this in the settings menu instead of the
   tilde key so we can use a tablet/phone, and let's do touch edit controls").
   While dev mode is on it adds, over the 3-D view:
     a THUMBSTICK (bottom left) — fly forward / back / sideways (feeds the fly camera's W A S D);
     UP / DOWN buttons (bottom right) — the fly camera's E / Q;
     ONE-FINGER DRAG on empty space — look around (a tap still selects; dragging a handle still moves the selection);
     a DONE button (top left) — leave the editor (the tilde key's job, for a device with no keyboard).
   createTouchFly({ stage3d, dom, onDone }) -> { show(on) }. Its elements carry data-dev-editor (dev mode never hides them). */
export function createTouchFly({ stage3d, dom, onDone }) {
  const wrap = document.createElement("div");
  wrap.dataset.devEditor = "1";
  wrap.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:59;display:none;font-family:system-ui,sans-serif";
  wrap.innerHTML = `
    <button data-t="done" style="pointer-events:auto;position:absolute;left:10px;top:10px;padding:10px 16px;font:600 15px system-ui;border-radius:10px;border:1px solid #ffb35a;background:rgba(40,24,12,.85);color:#ffd27a">✓ Done</button>
    <div data-t="stick" style="pointer-events:auto;position:absolute;left:18px;bottom:18px;width:130px;height:130px;border-radius:50%;background:rgba(20,14,10,.45);border:2px solid rgba(255,190,120,.45);touch-action:none">
      <div data-t="nub" style="position:absolute;left:40px;top:40px;width:50px;height:50px;border-radius:50%;background:rgba(255,190,120,.55)"></div></div>
    <div style="pointer-events:auto;position:absolute;right:18px;bottom:18px;display:flex;flex-direction:column;gap:10px">
      <button data-t="up" style="width:64px;height:56px;font-size:22px;border-radius:12px;border:1px solid #ffb35a;background:rgba(40,24,12,.8);color:#ffd27a;touch-action:none">▲</button>
      <button data-t="down" style="width:64px;height:56px;font-size:22px;border-radius:12px;border:1px solid #ffb35a;background:rgba(40,24,12,.8);color:#ffd27a;touch-action:none">▼</button></div>`;
  document.body.appendChild(wrap);
  const $ = (k) => wrap.querySelector(`[data-t="${k}"]`);
  $("done").addEventListener("click", () => onDone && onDone());

  // THE THUMBSTICK: the nub follows the finger inside the ring; past a dead zone it holds the matching fly keys
  const stick = $("stick"), nub = $("nub"), R = 45;
  let stickId = null;
  const setKeys = (dx, dy) => {
    const dead = 0.3, f = -dy / R, s = dx / R;
    stage3d.flyKey("w", f > dead); stage3d.flyKey("s", f < -dead); stage3d.flyKey("d", s > dead); stage3d.flyKey("a", s < -dead);
  };
  const moveStick = (e) => {
    const r = stick.getBoundingClientRect(); let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy); if (d > R) { dx *= R / d; dy *= R / d; }
    nub.style.transform = `translate(${dx}px, ${dy}px)`; setKeys(dx, dy);
  };
  const endStick = () => { stickId = null; nub.style.transform = ""; setKeys(0, 0); };
  stick.addEventListener("pointerdown", (e) => { stickId = e.pointerId; stick.setPointerCapture(e.pointerId); moveStick(e); });
  stick.addEventListener("pointermove", (e) => { if (e.pointerId === stickId) moveStick(e); });
  stick.addEventListener("pointerup", endStick); stick.addEventListener("pointercancel", endStick);
  // UP / DOWN: held
  for (const [k, key] of [["up", "e"], ["down", "q"]]) {
    const b = $(k);
    b.addEventListener("pointerdown", (e) => { b.setPointerCapture(e.pointerId); stage3d.flyKey(key, true); });
    for (const ev of ["pointerup", "pointercancel"]) b.addEventListener(ev, () => stage3d.flyKey(key, false));
  }

  // LOOK: one finger dragged on the 3-D view (not on a handle the editor is dragging) turns the camera
  let look = null;
  dom.addEventListener("pointerdown", (e) => { if (wrap.style.display !== "none" && e.pointerType !== "mouse") look = { id: e.pointerId, x: e.clientX, y: e.clientY }; });
  dom.addEventListener("pointermove", (e) => {
    if (!look || e.pointerId !== look.id) return;
    const ed = stage3d.editor; if (ed && ed.dragging) { look = null; return; }   // moving the selection, not the view
    stage3d.flyLook((e.clientX - look.x) * 1.4, (e.clientY - look.y) * 1.4); look.x = e.clientX; look.y = e.clientY;
  });
  for (const ev of ["pointerup", "pointercancel"]) dom.addEventListener(ev, () => { look = null; });

  return { show(on) { wrap.style.display = on ? "block" : "none"; if (!on) { endStick(); stage3d.flyKey("e", false); stage3d.flyKey("q", false); } } };
}
