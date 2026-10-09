/* perf.js — WHERE THE FRAME GOES, in milliseconds (10-09 speed pass: "measure, don't guess" — draw-call counts were the only
   number until now). ?perf turns it on: a small overlay, top right, with each pass's cost averaged over half a second, and a
   "perf" line in device.log every 5 s (so a phone's numbers reach the dev log too).
     GPU ms per pass when the browser has the GPU timer (EXT_disjoint_timer_query_webgl2 — Chrome desktop/Android mostly; Firefox
     hides it), and always the CPU ms it took to SEND each pass (draw-call overhead lives there).
   installPerf({ renderer, passes: [[name, obj]], wrap: [[name, obj, method]], bootlog }) — every obj.render (or obj[method]) is timed.
   Nested timing: a pass inside a pass (the pool mirror inside the main scene) is timed on the CPU only; the GPU timer can't nest. */
export function installPerf({ renderer, passes = [], wrap = [], bootlog }) {
  const gl = renderer.getContext(), ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  const stats = new Map();   // name -> { cpu, gpu, n, gpuN }
  const stat = (k) => { if (!stats.has(k)) stats.set(k, { cpu: 0, gpu: 0, n: 0, gpuN: 0 }); return stats.get(k); };
  const pending = [];        // [query, name]
  let active = false, frameT = performance.now(), frames = 0, frameMs = 0;
  const time = (name, fn, self, args) => {
    const s = stat(name), t0 = performance.now();
    let q = null;
    if (ext && !active) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); active = true; }
    try { return fn.apply(self, args); }
    finally {
      if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); active = false; pending.push([q, name]); }
      s.cpu += performance.now() - t0; s.n++;
    }
  };
  for (const [name, obj] of passes) if (obj && obj.render) { const f = obj.render; obj.render = function (...a) { return time(name, f, this, a); }; }
  for (const [name, obj, m] of wrap) if (obj && obj[m]) { const f = obj[m]; obj[m] = function (...a) { return time(name, f, this, a); }; }
  const box = document.createElement("pre");
  box.style.cssText = "position:fixed;right:8px;top:8px;z-index:99;margin:0;padding:8px 10px;font:12px/1.35 ui-monospace,monospace;color:#e8ffe0;background:rgba(0,0,0,.72);border-radius:8px;pointer-events:none;white-space:pre";
  document.body.appendChild(box);
  let lastLog = 0;
  function tick() {   // once a frame: collect finished GPU timings; twice a second: show
    frames++;
    const disjoint = ext && gl.getParameter(ext.GPU_DISJOINT_EXT);
    for (let i = pending.length - 1; i >= 0; i--) {
      const [q, name] = pending[i];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) continue;
      if (!disjoint) { const s = stat(name); s.gpu += gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; s.gpuN++; }
      gl.deleteQuery(q); pending.splice(i, 1);
    }
    const now = performance.now();
    if (now - frameT < 500) return;
    frameMs = (now - frameT) / frames;
    const rows = [...stats].map(([k, s]) => [k, s.n ? s.cpu / frames : 0, s.gpuN ? s.gpu / s.gpuN * (s.n / frames) : null]);
    const info = renderer.info.render;
    box.textContent = `frame ${frameMs.toFixed(1)} ms  (${(1000 / frameMs).toFixed(0)} fps)   calls ${info.calls}\n` +
      `${"pass".padEnd(16)} ${"cpu".padStart(6)} ${ext ? "gpu".padStart(6) : "(no GPU timer)"}\n` +
      rows.map(([k, c, g]) => `${k.padEnd(16)} ${c.toFixed(2).padStart(6)} ${g == null ? "" : g.toFixed(2).padStart(6)}`).join("\n");
    if (bootlog && now - lastLog > 5000) { lastLog = now; bootlog("perf", { fps: Math.round(1000 / frameMs), gpuTimer: !!ext, ms: Object.fromEntries(rows.map(([k, c, g]) => [k, [+c.toFixed(2), g == null ? null : +g.toFixed(2)]])) }); }
    for (const s of stats.values()) { s.cpu = 0; s.gpu = 0; s.n = 0; s.gpuN = 0; }
    frameT = now; frames = 0;
  }
  return { tick, stats };
}
