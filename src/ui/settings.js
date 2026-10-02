/* settings.js — the settings screen (Esc or the ⚙ button) and its storage.
   Saved in localStorage so choices survive a reload. Main code reads
   `loadSettings()` at start and gets live changes through `onChange`. */

const KEY = "gr.settings";
export const DEFAULTS = {
  difficulty: "easy",      // easy | normal | hard | expert
  autoCorrect: true,
  master: 0.9,
  hits: 1.0,
  metronome: 0.5,
};

export function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; }
  catch { return { ...DEFAULTS }; }
}
function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }

const CSS = `
#gr-gear { position: fixed; top: 10px; left: 50%; transform: translateX(-50%); z-index: 30;
  width: 40px; height: 40px; display: grid; place-items: center; border-radius: 10px;
  background: rgba(10, 8, 6, 0.55); border: 1px solid rgba(255, 200, 120, 0.25);
  color: #f4e9d8; cursor: pointer; opacity: 0.85; user-select: none; }
#gr-gear svg { width: 24px; height: 24px; }
@media (max-width: 760px), (max-height: 480px) {
  #gr-gear { top: 56px; left: auto; right: max(12px, env(safe-area-inset-right)); transform: none; }   /* phones: the round chip owns the top middle */
}
#gr-set { position: fixed; inset: 0; z-index: 40; display: none; place-items: center;
  background: rgba(8, 6, 4, 0.6); backdrop-filter: blur(3px); font: 15px system-ui, sans-serif; color: #f4e9d8; }
#gr-set .card { background: rgba(28, 20, 14, 0.95); border: 1px solid rgba(255, 190, 110, 0.35);
  border-radius: 14px; padding: 22px 28px; min-width: 340px; }
#gr-set h2 { margin: 0 0 14px; font-size: 20px; color: #ffd27a; }
#gr-set .row { display: flex; justify-content: space-between; align-items: center; gap: 18px; margin: 12px 0; }
#gr-set select, #gr-set button { font: inherit; background: #3a2a1c; color: #f4e9d8; border: 1px solid #8a6a44; border-radius: 8px; padding: 4px 10px; }
#gr-set input[type=range] { width: 150px; }
#gr-set .note { font-size: 12px; opacity: 0.7; }
#gr-set .foot { display: flex; justify-content: space-between; margin-top: 18px; }
`;

export function createSettings({ onChange, onRestart } = {}) {
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
  </svg>`;
  document.body.appendChild(gear);

  const root = document.createElement("div");
  root.id = "gr-set";
  root.innerHTML = `
    <div class="card">
      <h2>Settings</h2>
      <div class="row"><span>Difficulty</span>
        <select data-k="difficulty">
          <option value="easy">Easy — ±80 ms, 60 bpm</option>
          <option value="normal">Normal — ±50 ms, 80 bpm</option>
          <option value="hard">Hard — ±30 ms, 100 bpm</option>
          <option value="expert">Expert — ±20 ms, 112 bpm</option>
        </select></div>
      <div class="row"><span>Auto-correct <span class="note">(record hits on the beat)</span></span>
        <input type="checkbox" data-k="autoCorrect"></div>
      <div class="row"><span>Master volume</span><input type="range" min="0" max="1" step="0.01" data-k="master"></div>
      <div class="row"><span>Drum hits</span><input type="range" min="0" max="1" step="0.01" data-k="hits"></div>
      <div class="row"><span>Metronome</span><input type="range" min="0" max="1" step="0.01" data-k="metronome"></div>
      <div class="note">Changing difficulty restarts the song.</div>
      <div class="foot"><button data-act="restart">Restart song</button><button data-act="close">Close (Esc)</button></div>
    </div>`;
  document.body.appendChild(root);

  const inputs = [...root.querySelectorAll("[data-k]")];
  for (const el of inputs) {
    const k = el.dataset.k;
    if (el.type === "checkbox") el.checked = !!s[k]; else el.value = s[k];
    el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => {
      const v = el.type === "checkbox" ? el.checked : el.type === "range" ? +el.value : el.value;
      s[k] = v; save(s);
      if (k === "difficulty") { onRestart && onRestart(); return; }
      onChange && onChange(k, v, s);
    });
  }
  const open = () => { root.style.display = "grid"; };
  const close = () => { root.style.display = "none"; };
  gear.addEventListener("click", open);
  root.querySelector("[data-act=close]").addEventListener("click", close);
  root.querySelector("[data-act=restart]").addEventListener("click", () => onRestart && onRestart());
  root.addEventListener("click", (e) => { if (e.target === root) close(); });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); root.style.display === "grid" ? close() : open(); }
  });
  return {
    get isOpen() { return root.style.display === "grid"; },
    set(k, v) { s[k] = v; save(s); const el = root.querySelector(`[data-k=${k}]`); if (el) { if (el.type === "checkbox") el.checked = !!v; else el.value = v; } },
    get values() { return s; },
  };
}
