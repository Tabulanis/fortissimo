/* menu.js — the start menu (owner, 2026-10-03, Beat Saber style):
 *   PLAY -> pick a LEVEL (rounds unlock one by one) -> set up the RUN -> Start.
 * The run: a DIFFICULTY slider, 1-10 (each level a full set of modifiers), or Custom, with the
 * modifiers — hitbox, tempo, patterns, groups, keep, damage — and the score
 * multiplier they're worth, live. The last run is remembered.
 *
 * createMenu({ levels: [{name, title, bpm}], unlocked, level, run, startAt, onStart(level, run), onCreate(card, back) })
 * CREATE (2026-10-07): the song-maker — maker-ui.js pickSounds() draws its screen in the menu's card.
 * onStart is called inside the Start click (a user gesture: the audio may start there). */
import { LEVELS, LEVEL_NAMES, LIMITS, levelOf, normalize, scoreMultiplier } from "../game/run.js";

const CSS = `
#gr-menu { position:fixed; inset:0; z-index:60; display:flex; align-items:center; justify-content:center;
  background:radial-gradient(ellipse at 50% 30%, rgba(60,30,20,0.55), rgba(8,5,10,0.85)); font-family:system-ui, sans-serif; color:#f4e9dc; overflow:auto; padding:16px; box-sizing:border-box; }
#gr-menu .card { width:min(520px, 100%); padding:24px 26px; border-radius:16px; background:rgba(28,18,26,0.94);
  border:1px solid rgba(255,190,120,0.35); box-shadow:0 10px 40px rgba(0,0,0,0.55); box-sizing:border-box; }
#gr-menu h1 { margin:0 0 4px; font-size:40px; letter-spacing:1px; color:#ffd27a; text-align:center; }
#gr-menu h2 { margin:0 0 14px; font-size:20px; text-align:center; opacity:0.9; }
#gr-menu .sub { text-align:center; opacity:0.65; font-size:14px; margin-bottom:20px; }
#gr-menu button { font:inherit; color:#fff; cursor:pointer; border-radius:10px; border:1px solid rgba(255,190,120,0.5);
  background:rgba(255,160,80,0.14); padding:12px 16px; font-size:17px; }
#gr-menu button:disabled { opacity:0.35; cursor:default; }
#gr-menu .big { display:block; width:100%; font-size:22px; padding:16px; margin-top:8px; background:rgba(255,160,80,0.28); }
#gr-menu .level { display:flex; justify-content:space-between; align-items:center; width:100%; margin:6px 0; text-align:left; }
#gr-menu .level .t { opacity:0.7; font-size:14px; }
#gr-menu .diff { margin:4px 0 14px; }
#gr-menu .diff .name { text-align:center; font-size:22px; font-weight:700; color:#ffd27a; margin-bottom:6px; }
#gr-menu .diff input { height:28px; }
#gr-menu .diff .ends { display:flex; justify-content:space-between; font-size:12px; opacity:0.55; }
#gr-menu .row { display:grid; grid-template-columns:110px 1fr 74px; align-items:center; gap:10px; margin:10px 0; font-size:15px; }
#gr-menu .row .v { text-align:right; font-variant-numeric:tabular-nums; opacity:0.85; font-size:14px; }
#gr-menu input[type=range] { width:100%; accent-color:#ffb050; }
#gr-menu select { font:inherit; font-size:15px; padding:6px; border-radius:8px; background:#2a1c24; color:#fff; border:1px solid rgba(255,190,120,0.4); }
#gr-menu .mult { text-align:center; margin:16px 0 4px; font-size:30px; font-weight:700; color:#ffd27a; }
#gr-menu .multparts { text-align:center; font-size:12px; opacity:0.6; min-height:16px; }
#gr-menu .back { background:none; border:none; opacity:0.6; font-size:14px; padding:6px; margin-top:10px; }
#gr-menu .mk-row { display:grid; grid-template-columns:70px 1fr auto; align-items:center; gap:10px; margin:9px 0; }
#gr-menu .mk-row .t { opacity:0.5; font-size:12px; }
#gr-menu .mk-row input { font:inherit; padding:7px; border-radius:8px; background:#2a1c24; color:#fff; border:1px solid rgba(255,190,120,0.4); }
#gr-menu .chips { display:flex; flex-wrap:wrap; gap:6px; }
#gr-menu .chip { padding:6px 11px; font-size:14px; }
#gr-menu .chip.on { background:rgba(255,160,80,0.45); border-color:#ffd27a; }
#gr-menu .play { padding:6px 12px; }
#gr-menu .lucky { font-size:17px; padding:12px; background:rgba(120,160,255,0.16); }
#gr-menu .custom { text-align:center; font-size:13px; opacity:0.7; margin:-8px 0 8px; min-height:16px; }
`;

const ms = (s) => `±${Math.round(s * 1000)} ms`;
const hitboxWord = (s) => (s <= 0.05 ? "tight" : s <= 0.09 ? "fair" : s <= 0.15 ? "generous" : "huge");

export function createMenu({ levels, unlocked = 0, level = 0, run, startAt = "title", onStart, onCreate, hydras = [], onHydra, onOptions }) {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement("div");
  root.id = "gr-menu";
  const card = document.createElement("div");
  card.className = "card";
  root.appendChild(card);
  document.body.appendChild(root);
  let cfg = normalize(run);
  let lvl = Math.min(level, unlocked);

  function title() {
    card.innerHTML = `<h1>Fortissimo</h1><div class="sub">play the song, one piece at a time</div>
      <button class="big" data-a="play">Start ▶</button>
      ${onCreate ? `<button class="big" data-a="create">Create ✎</button>` : ""}
      ${onOptions ? `<button class="big" data-a="options">Options ⚙</button>` : ""}`;
    card.querySelector("[data-a=play]").onclick = levelsScreen;
    if (onCreate) card.querySelector("[data-a=create]").onclick = () => onCreate(card, title);
    if (onOptions) card.querySelector("[data-a=options]").onclick = () => {   // (10-08) the menu steps aside so the settings show, and comes back on Done
      root.style.display = "none"; onOptions(() => { root.style.display = ""; });
    };   // the song-maker (maker-ui.js) draws in this card
  }

  function levelsScreen() {
    card.innerHTML = `<h2>Choose a level</h2>` + levels.map((l, i) => `
      <button class="level" data-i="${i}" ${i > unlocked && !l.made ? "disabled" : ""}>
        <span>${i > unlocked && !l.made ? "🔒 " : l.made ? "✎ " : ""}${l.name}</span><span class="t">${l.title || ""}</span></button>`).join("") +
      hydras.map((h, k) => `<button class="level hydra" data-h="${k}" ${h.open ? "" : "disabled"}>
        <span>${h.open ? "🐉 " : "🔒 "}Round 4 — The Hydra</span><span class="t">${h.title}</span></button>`).join("") +
      `<button class="back" data-a="back">◀ Back</button>`;
    card.querySelectorAll(".level:not(.hydra)").forEach((b) => (b.onclick = () => { lvl = +b.dataset.i; setup(); }));
    card.querySelectorAll(".level.hydra").forEach((b) => (b.onclick = () => onHydra && onHydra(hydras[+b.dataset.h])));   // round 4: conduct the level's three rounds
    card.querySelector("[data-a=back]").onclick = title;
  }

  function setup() {
    const L = levels[lvl] || {};
    card.innerHTML = `
      <h2>${L.name || "Level"}${L.title ? " — " + L.title : ""}</h2>
      <div class="diff"><div class="name"></div>
        <input type="range" data-a="diff" min="1" max="10" step="1">
        <div class="ends"><span>1 · gentle</span><span>10 · expert</span></div></div>
      <div class="custom"></div>
      <div class="row"><span>Hitbox</span><input type="range" data-k="hitbox" min="${LIMITS.hitbox[0]}" max="${LIMITS.hitbox[1]}" step="0.005"><span class="v" data-v="hitbox"></span></div>
      <div class="row"><span>Tempo</span><input type="range" data-k="tempo" min="${LIMITS.tempo[0]}" max="${LIMITS.tempo[1]}" step="0.05"><span class="v" data-v="tempo"></span></div>
      <div class="row"><span>Patterns</span><select data-k="patterns">
        <option value="easy">Easy — beats and half-beats</option><option value="medium">Medium — no fast runs</option><option value="full">Full — every note</option></select><span></span></div>
      <div class="row"><span>Groups</span><select data-k="lock">
        <option value="1">1 — single notes</option><option value="3">3 — groups of 3</option>
        <option value="8">8 — the next 8, in order</option><option value="all">All — the whole section in one go</option></select><span></span></div>
      <div class="row"><span>Keep</span><select data-k="keep">
        <option value="any">Whatever you hit — any order</option><option value="half">Half — if the pattern breaks</option>
        <option value="none">Nothing — only a perfect pattern</option></select><span></span></div>
      <div class="row"><span>Damage</span><select data-k="damage">
        <option value="gentle">Gentle — a miss costs a little</option><option value="normal">Normal</option>
        <option value="harsh">Harsh — misses hurt</option></select><span></span></div>
      <div class="mult"></div><div class="multparts"></div>
      <button class="big" data-a="start">Start ▶</button>
      <button class="back" data-a="back">◀ Levels</button>`;
    const el = (k) => card.querySelector(`[data-k=${k}]`);
    const paint = () => {
      el("hitbox").value = cfg.hitbox; el("tempo").value = cfg.tempo; el("patterns").value = cfg.patterns;
      el("lock").value = cfg.lock === Infinity ? "all" : String(cfg.lock); el("keep").value = cfg.keep; el("damage").value = cfg.damage;
      card.querySelector("[data-v=hitbox]").textContent = `${ms(cfg.hitbox)}`;
      card.querySelector("[data-v=tempo]").textContent = L.bpm ? `${Math.round(L.bpm * cfg.tempo)} bpm` : `×${cfg.tempo.toFixed(2)}`;
      const lv = levelOf(cfg);
      if (lv) card.querySelector("[data-a=diff]").value = lv;
      card.querySelector(".diff .name").textContent = lv ? `Level ${lv} — ${LEVEL_NAMES[lv - 1]}` : "Custom";
      card.querySelector(".custom").textContent = lv ? "" : `Custom · hitbox ${hitboxWord(cfg.hitbox)}`;
      const m = scoreMultiplier(cfg);
      card.querySelector(".mult").textContent = `Score ×${m.total.toFixed(2)}`;
      card.querySelector(".multparts").textContent = Object.entries(m.parts).filter(([, v]) => Math.abs(v - 1) > 0.005)
        .map(([k, v]) => `${k} ×${v.toFixed(2)}`).join(" · ");
    };
    card.querySelector("[data-a=diff]").oninput = (e) => { cfg = normalize({ ...LEVELS[+e.target.value - 1] }); paint(); };
    el("hitbox").oninput = () => { cfg.hitbox = +el("hitbox").value; paint(); };
    el("tempo").oninput = () => { cfg.tempo = +el("tempo").value; paint(); };
    el("patterns").onchange = () => { cfg.patterns = el("patterns").value; paint(); };
    el("lock").onchange = () => { cfg.lock = el("lock").value === "all" ? Infinity : +el("lock").value; paint(); };
    el("damage").onchange = () => { cfg.damage = el("damage").value; paint(); };
    el("keep").onchange = () => { cfg.keep = el("keep").value; paint(); };
    card.querySelector("[data-a=back]").onclick = levelsScreen;
    card.querySelector("[data-a=start]").onclick = () => { root.style.display = "none"; onStart(lvl, normalize(cfg)); };
    paint();
  }

  ({ title, levels: levelsScreen, setup })[startAt]?.() ?? title();
  return { close: () => (root.style.display = "none"), el: root };
}
