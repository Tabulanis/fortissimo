/* editor.js — the DEV-MODE EDITOR (owner, 2026-10-07: "a level editor to go in, move things, size
   them" → "alter dev mode to be able to move stuff"). Lives inside the fly camera (tilde key):
     left-click     select a piece of scenery (gates, fountain, fire basins, cove pieces, hydra heads)
     drag a handle  move / turn / size it          right-drag  turn the camera   W A S D Q E  fly
     1 2 3          Move / Turn / Size handles      Delete  hide     Esc  let go
     Ctrl+Z  undo   Ctrl+S  save (public/levels/edits.json via the dev server; in git, applied on load)
   The panel (top right) shows the same as buttons plus typed numbers. Only things registered in
   scene/editables.js can be picked; gameplay pieces (drums, guns, crystals) are not, on purpose. */
import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { allEditables, editableOf, capture, reset, saveEdits, editCount } from "../scene/editables.js";

export function createEditor({ scene, camera, dom, props = null, log = () => {} }) {
  const tc = new TransformControls(camera, dom);
  const helper = tc.getHelper(); scene.add(helper);
  tc.setSize(0.9);
  let sel = null, dirty = false, on = false, snap = false;
  const undo = [];
  const snapshot = (o) => ({ o, p: o.position.toArray(), q: o.quaternion.toArray(), s: o.scale.toArray(), v: o.visible });
  const restore = (st) => { st.o.position.fromArray(st.p); st.o.quaternion.fromArray(st.q); st.o.scale.fromArray(st.s); st.o.visible = st.v; capture(st.o); };

  // ---- the panel
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;top:10px;right:10px;z-index:60;width:250px;padding:10px 12px;border-radius:10px;" +
    "background:rgba(20,14,10,.88);color:#f1e3cc;font:13px system-ui;box-shadow:0 4px 18px rgba(0,0,0,.5);display:none;user-select:none";
  el.innerHTML = `
    <div style="font-weight:700;letter-spacing:.08em;margin-bottom:6px">EDIT <span data-k="status" style="font-weight:400;opacity:.7;float:right"></span></div>
    <div data-k="name" style="margin-bottom:8px;opacity:.9">click something to grab it</div>
    <div style="display:flex;gap:4px;margin-bottom:8px">
      <button data-a="translate">1 Move</button><button data-a="rotate">2 Turn</button><button data-a="scale">3 Size</button></div>
    <div data-k="nums" style="display:grid;grid-template-columns:auto 1fr 1fr 1fr;gap:3px 4px;align-items:center;margin-bottom:8px">
      <span>pos</span><input data-n="px"><input data-n="py"><input data-n="pz">
      <span>turn°</span><input data-n="ry"><span></span><span></span>
      <span>size</span><input data-n="s"><span></span><span></span></div>
    <label style="display:block;margin-bottom:8px"><input type="checkbox" data-k="snap"> snap (25 cm · 15° · 10%)</label>
    <div style="display:flex;flex-wrap:wrap;gap:4px">
      <button data-a="dup">Duplicate</button><button data-a="del">Delete</button><button data-a="hide">Hide</button>
      <button data-a="reset">Reset</button><button data-a="undo">Undo</button><button data-a="save" style="font-weight:700">Save</button></div>
    <div style="margin-top:10px;font-weight:700;letter-spacing:.08em">ADD <span style="font-weight:400;opacity:.6;font-size:11px">click one — it lands in front of you</span></div>
    <div data-k="palette" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;max-height:160px;overflow:auto"></div>
    <div style="margin-top:8px;opacity:.6;font-size:11px;line-height:1.35">HOLD right mouse to look · W A S D fly · Q/E down/up · Shift fast · wheel = fly speed · Esc let go · tilde (~) leaves (the game was paused; it resumes)</div>`;
  for (const b of el.querySelectorAll("button")) b.style.cssText = "flex:1;padding:5px 6px;border-radius:6px;border:1px solid #6a4a2a;background:#3a2414;color:#f1e3cc;cursor:pointer;font:12px system-ui";
  for (const i of el.querySelectorAll("input:not([type])")) i.style.cssText = "width:100%;box-sizing:border-box;background:#120c08;color:#f1e3cc;border:1px solid #5a3e24;border-radius:4px;padding:2px 4px;font:12px ui-monospace,monospace";
  el.dataset.devEditor = "1";   // dev mode hides every other overlay, not this one
  document.body.appendChild(el);
  const $ = (k) => el.querySelector(`[data-k="${k}"]`), N = (n) => el.querySelector(`[data-n="${n}"]`);
  const status = () => { $("status").textContent = dirty ? "unsaved" : `${editCount()} saved`; $("status").style.color = dirty ? "#ffb35a" : ""; };
  const showNums = () => {
    $("name").textContent = sel ? `${sel.userData.editLabel}${sel.visible ? "" : " (hidden)"}` : "click something to grab it";
    $("nums").style.opacity = sel ? 1 : 0.35;
    if (!sel) return;
    N("px").value = sel.position.x.toFixed(2); N("py").value = sel.position.y.toFixed(2); N("pz").value = sel.position.z.toFixed(2);
    N("ry").value = THREE.MathUtils.radToDeg(new THREE.Euler().setFromQuaternion(sel.quaternion, "YXZ").y).toFixed(0);
    N("s").value = sel.scale.x.toFixed(2);
  };
  const changed = () => { if (sel) capture(sel); dirty = true; status(); showNums(); };
  const select = (o) => { sel = o; if (o) tc.attach(o); else tc.detach(); showNums(); log("select", { id: o ? o.userData.editId : null }); };
  const setMode = (m) => { tc.setMode(m); for (const b of el.querySelectorAll("[data-a]")) b.style.outline = b.dataset.a === m ? "2px solid #ffb35a" : ""; };
  setMode("translate");
  const setSnap = (v) => { snap = v; tc.setTranslationSnap(v ? 0.25 : null); tc.setRotationSnap(v ? THREE.MathUtils.degToRad(15) : null); tc.setScaleSnap(v ? 0.1 : null); $("snap").checked = v; };
  $("snap").addEventListener("change", (e) => setSnap(e.target.checked));
  const act = {
    translate: () => setMode("translate"), rotate: () => setMode("rotate"), scale: () => setMode("scale"),
    hide: () => { if (!sel) return; undo.push(snapshot(sel)); sel.visible = !sel.visible; changed(); },
    reset: () => { if (!sel) return; undo.push(snapshot(sel)); reset(sel); dirty = true; status(); showNums(); },
    undo: () => { const st = undo.pop(); if (st) { restore(st); dirty = true; status(); showNums(); } },
    dup: () => { if (!sel || !props) return; const kind = sel.userData.addKind || sel.userData.model;
      if (!kind) { $("status").textContent = "can't copy this one"; return; }
      const at = sel.position.clone().add(new THREE.Vector3(2, 0, 2));
      addProp(kind, at, (o) => { o.quaternion.copy(sel.quaternion); o.scale.copy(sel.scale); }); },
    del: () => { if (!sel) return;
      if (props && props.remove(sel)) { log("delete", { id: sel.userData.editId }); select(null); dirty = true; status(); }
      else act.hide(); },   // built-in pieces can only be hidden
    save: () => saveEdits().then((ok) => { dirty = !ok; status(); $("status").textContent = ok ? `saved ${editCount()}` : "SAVE FAILED"; log("save", { ok, n: editCount() }); }),
  };
  for (const b of el.querySelectorAll("[data-a]")) b.addEventListener("click", (e) => { e.stopPropagation(); act[b.dataset.a](); });
  for (const i of el.querySelectorAll("input[data-n]")) i.addEventListener("change", () => {
    if (!sel) return; undo.push(snapshot(sel));
    const v = (n) => parseFloat(N(n).value);
    if (Number.isFinite(v("px"))) sel.position.set(v("px"), v("py"), v("pz"));
    if (Number.isFinite(v("ry"))) { const e = new THREE.Euler().setFromQuaternion(sel.quaternion, "YXZ"); e.y = THREE.MathUtils.degToRad(v("ry")); sel.quaternion.setFromEuler(e); }
    if (Number.isFinite(v("s")) && v("s") > 0) sel.scale.setScalar(v("s"));
    changed();
  });
  // keep typing in the panel out of the game and the fly keys
  el.addEventListener("keydown", (e) => e.stopPropagation());

  // ---- ADD (owner, 2026-10-07: "an add-object ability and a palette of the level's objects")
  function inFront() {   // where the camera looks, on the ground (y = 0), 3–25 m away
    const o = camera.getWorldPosition(new THREE.Vector3()), d = camera.getWorldDirection(new THREE.Vector3());
    let t = d.y < -0.05 ? -o.y / d.y : 10; t = Math.max(3, Math.min(25, t));
    const p = o.addScaledVector(d, t); p.y = 0; return p;
  }
  function addProp(kind, at = inFront(), tweak = null) {
    props.spawn(kind, at).then((o) => { if (tweak) tweak(o); capture(o); dirty = true; status(); select(o); setMode("translate"); log("add", { kind, id: o.userData.editId }); })
      .catch((e) => { $("status").textContent = "add failed"; log("add failed", { kind, e: String(e) }); });
  }
  if (props) props.kinds().then((list) => {
    const box = $("palette");
    for (const k of list) {
      const b = document.createElement("button"); b.textContent = k === "brazier" ? "fire basin" : k;
      b.style.cssText = "padding:4px 7px;border-radius:6px;border:1px solid #4a5a3a;background:#1f2a18;color:#e6f0d6;cursor:pointer;font:12px system-ui";
      b.addEventListener("click", (e) => { e.stopPropagation(); addProp(k); });
      box.appendChild(b);
    }
  });

  // ---- the handles
  // UNIFORM SIZE (owner, 2026-10-07: "scale doesn't work"): three's centre box sizes by the RATIO of the
  // pointer's distance from the centre now vs. at the grab — grab on the centre (where the box is) and
  // that ratio explodes (an 80 px drag gave ×37). Our rule instead: drag UP to grow, DOWN to shrink,
  // ×2 per 140 px, floor 2 %. The per-axis stretch boxes sit out at the arm ends and keep three's rule.
  let sizeDrag = null;
  dom.addEventListener("pointerdown", (e) => { if (on && sel && tc.mode === "scale" && tc.axis === "XYZ") sizeDrag = { y0: e.clientY, y: e.clientY, s0: sel.scale.clone() }; });
  dom.addEventListener("pointermove", (e) => { if (sizeDrag) sizeDrag.y = e.clientY; });
  dom.addEventListener("pointerup", () => { sizeDrag = null; });
  tc.addEventListener("dragging-changed", (e) => { if (e.value && sel) undo.push(snapshot(sel)); });
  tc.addEventListener("objectChange", () => {
    if (sizeDrag && sel) sel.scale.copy(sizeDrag.s0).multiplyScalar(Math.max(0.02, Math.pow(2, (sizeDrag.y0 - sizeDrag.y) / 140)));
    if (sel && tc.mode === "scale") sel.scale.set(Math.max(0.02, sel.scale.x), Math.max(0.02, sel.scale.y), Math.max(0.02, sel.scale.z));
    changed();
  });

  // ---- picking: a click (not a drag) on the canvas, not on a handle
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null;
  dom.addEventListener("pointerdown", (e) => { if (on && e.button === 0) down = { x: e.clientX, y: e.clientY, onHandle: tc.axis !== null }; });
  dom.addEventListener("pointerup", (e) => {
    if (!on || e.button !== 0 || !down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5, onHandle = down.onHandle; down = null;
    if (moved || onHandle) return;
    const r = dom.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera); ray.layers.enableAll();
    const pool = allEditables().filter((o) => o.visible || o === sel);
    const hits = ray.intersectObjects(pool, true);
    log("pick", { editables: pool.length, hits: hits.length, first: hits[0] ? (hits[0].object.name || hits[0].object.type) : null, at: [+ndc.x.toFixed(2), +ndc.y.toFixed(2)] });
    select(hits.length ? editableOf(hits[0].object) : null);
  });

  window.__grEdit = { allEditables, tc,   // harness handle (dev only)
    screenOf: (o) => { const v = o.getWorldPosition(new THREE.Vector3()).project(camera), r = dom.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; } };
  return {
    get on() { return on; }, get selected() { return sel; },
    setOn(v) { on = !!v; el.style.display = on ? "block" : "none"; helper.visible = on; if (!on) select(null); status(); },
    /** keys while editing; true = consumed */
    key(e) {
      if (!on) return false;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "s") { e.preventDefault(); act.save(); return true; }
      if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); act.undo(); return true; }
      if (k === "1") { setMode("translate"); return true; }
      if (k === "2") { setMode("rotate"); return true; }
      if (k === "3") { setMode("scale"); return true; }
      if (k === "delete" || k === "backspace") { act.del(); return true; }
      if ((e.ctrlKey || e.metaKey) && k === "d") { e.preventDefault(); act.dup(); return true; }
      if (k === "escape") { select(null); return true; }
      return false;
    },
    select,
  };
}
