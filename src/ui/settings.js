/* settings.js — the settings screen (Esc or the ⚙ button) and its storage.
   Saved in localStorage so choices survive a reload. Main code reads
   `loadSettings()` at start and gets live changes through `onChange`. */

const KEY = "gr.settings";
export const DEFAULTS = {
  autoCorrect: true,
  master: 0.9,
  hits: 1.0,
  metronome: 0.5,
  quality: "auto",         // auto | high | medium | low | lowest (graphics)
};

export function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; }
  catch { return { ...DEFAULTS }; }
}
function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }

// (owner, 2026-10-08: "phone settings need to be easier to get to and read"): a LABELLED button, and on a phone the
// settings open FULL-SCREEN — big text, thumb-sized rows, full-width sliders, grouped under plain headings
const CSS = `
#gr-gear { position: fixed; top: 10px; left: 50%; transform: translateX(-50%); z-index: 30;
  height: 40px; padding: 0 12px 0 9px; display: flex; align-items: center; gap: 6px; border-radius: 12px;
  background: rgba(10, 8, 6, 0.6); border: 1px solid rgba(255, 200, 120, 0.35);
  color: #f4e9d8; cursor: pointer; user-select: none; font: 600 14px system-ui, sans-serif; }
#gr-gear svg { width: 22px; height: 22px; }
@media (max-width: 760px), (max-height: 480px), (pointer: coarse) {
  #gr-gear { top: calc(max(10px, env(safe-area-inset-top)) + 96px); left: auto; right: max(10px, env(safe-area-inset-right)); transform: none;   /* under the life bars (top right) */
    height: 48px; padding: 0 14px 0 11px; font-size: 16px; background: rgba(20, 12, 6, 0.8); }
  #gr-gear svg { width: 26px; height: 26px; }
}
#gr-set { position: fixed; inset: 0; z-index: 40; display: none; place-items: center;
  background: rgba(8, 6, 4, 0.6); backdrop-filter: blur(3px); font: 15px system-ui, sans-serif; color: #f4e9d8; }
#gr-set .card { background: rgba(28, 20, 14, 0.96); border: 1px solid rgba(255, 190, 110, 0.35);
  border-radius: 14px; padding: 20px 26px; width: min(460px, 92vw); max-height: 92vh; overflow: auto; box-sizing: border-box; }
#gr-set h2 { margin: 0 0 6px; font-size: 22px; color: #ffd27a; }
#gr-set h3 { margin: 16px 0 4px; font-size: 13px; letter-spacing: .12em; text-transform: uppercase; color: #e8b46a; opacity: .85; }
#gr-set .row { display: flex; justify-content: space-between; align-items: center; gap: 14px; min-height: 40px; }
#gr-set select, #gr-set button { font: inherit; background: #3a2a1c; color: #f4e9d8; border: 1px solid #8a6a44; border-radius: 10px; padding: 7px 12px; }
#gr-set input[type=range] { width: 170px; accent-color: #ffb050; }
#gr-set input[type=checkbox] { width: 22px; height: 22px; accent-color: #ffb050; }
#gr-set .note { font-size: 12px; opacity: 0.7; }
#gr-set .wide { width: 100%; }
#gr-set .foot { display: flex; gap: 10px; margin-top: 18px; }
#gr-set .foot button { flex: 1; }
@media (max-width: 760px), (max-height: 480px), (pointer: coarse) {   /* PHONES: a full-screen settings page */
  #gr-set { place-items: stretch; font-size: 18px; }
  #gr-set .card { width: 100%; max-height: none; height: 100%; border-radius: 0; border: none;
    padding: max(16px, env(safe-area-inset-top)) max(18px, env(safe-area-inset-right)) max(20px, env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-left)); }
  #gr-set h2 { font-size: 26px; display: flex; justify-content: space-between; align-items: center; }
  #gr-set h3 { font-size: 14px; margin-top: 22px; }
  #gr-set .row { flex-wrap: wrap; min-height: 56px; border-bottom: 1px solid rgba(255, 190, 110, 0.12); }
  #gr-set .row.slider { display: grid; grid-template-columns: 1fr; gap: 6px; padding: 8px 0; }
  #gr-set input[type=range] { width: 100%; height: 34px; }
  #gr-set select { width: 100%; font-size: 17px; padding: 12px; }
  #gr-set button { padding: 14px 16px; font-size: 18px; }
  #gr-set .foot { flex-direction: column; }
  #gr-set .note { font-size: 14px; }
}
`;

export function createSettings({ onChange, onRestart, onEditor } = {}) {
  const s = loadSettings();
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const gear = document.createElement("div");
  gear.id = "gr-gear"; gear.title = "Settings (Esc)";
  // drawn, not a font glyph: the ⚙ character had no font on some systems and was invisible
  gear.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3.2"/>
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>
  </svg><span>Settings</span>`;
  document.body.appendChild(gear);

  const root = document.createElement("div");
  root.id = "gr-set";
  root.innerHTML = `
    <div class="card">
      <h2>Settings <button data-act="close" aria-label="Close" style="font-size:20px;padding:4px 12px">✕</button></h2>
      <h3>Sound</h3>
      <div class="row slider"><span>Master volume</span><input type="range" min="0" max="1" step="0.01" data-k="master"></div>
      <div class="row slider"><span>Drum hits</span><input type="range" min="0" max="1" step="0.01" data-k="hits"></div>
      <div class="row slider"><span>Metronome (the click)</span><input type="range" min="0" max="1" step="0.01" data-k="metronome"></div>
      <h3>Playing</h3>
      <div class="row"><span>Auto-correct <span class="note">— your hits land on the beat</span></span><input type="checkbox" data-k="autoCorrect"></div>
      <div class="note">Difficulty is picked in the start menu.</div>
      <h3>Graphics</h3>
      <div class="row"><select data-k="quality" class="wide">
          <option value="auto">Auto — measures this device</option>
          <option value="high">High — every effect</option>
          <option value="medium">Medium — strong phones and laptops</option>
          <option value="low">Low — no effects (most phones and tablets)</option>
          <option value="lowest">Lowest — no effects, lower resolution, small textures</option>
          <option value="potato">Potato — half resolution, bare minimum (weak tablets)</option>
        </select></div>
      <h3>Make</h3>
      <div class="row"><button data-act="editor" class="wide">🛠 Level editor</button></div>
      <div class="foot"><button data-act="restart">Restart song</button><button data-act="close2">Close</button></div>
    </div>`;
  document.body.appendChild(root);

  const inputs = [...root.querySelectorAll("[data-k]")];
  for (const el of inputs) {
    const k = el.dataset.k;
    if (el.type === "checkbox") el.checked = !!s[k]; else el.value = s[k];
    el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => {
      const v = el.type === "checkbox" ? el.checked : el.type === "range" ? +el.value : el.value;
      s[k] = v; save(s);
      if (k === "quality") { onRestart && onRestart(); return; }   // graphics rebuild the game
      onChange && onChange(k, v, s);
    });
  }
  const open = () => { root.style.display = "grid"; };
  const close = () => { root.style.display = "none"; };
  gear.addEventListener("click", open);
  if (new URLSearchParams(location.search).has("settings")) open();   // dev: ?settings opens it (screenshots)
  root.querySelector("[data-act=close]").addEventListener("click", close);
  root.querySelector("[data-act=close2]").addEventListener("click", close);
  root.querySelector("[data-act=restart]").addEventListener("click", () => onRestart && onRestart());
  // the LEVEL EDITOR from here too (10-08: a tablet / phone has no tilde key)
  root.querySelector("[data-act=editor]").addEventListener("click", () => { close(); onEditor && onEditor(); });
  root.addEventListener("click", (e) => { if (e.target === root) close(); });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); root.style.display === "grid" ? close() : open(); }
  });
  return {
    get isOpen() { return root.style.display === "grid"; },
    open,   // the main menu's Options button
    /** show what Auto picked: "Auto — now Medium" */
    setAutoNote(text) { const o = root.querySelector('[data-k=quality] option[value=auto]'); if (o) o.textContent = text; },
    set(k, v) { s[k] = v; save(s); const el = root.querySelector(`[data-k=${k}]`); if (el) { if (el.type === "checkbox") el.checked = !!v; else el.value = v; } },
    get values() { return s; },
  };
}
