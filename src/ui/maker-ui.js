/* maker-ui.js — the SONG-MAKER's screens (owner, 2026-10-07: "Create" on the main menu — pick the
   instruments, write the level by playing — "set it up so any idiot can do it").

   1. pickSounds(card, { worlds, banks, onDone(picks), onBack })  — ONE screen, everything pre-filled:
      world, drum kit / bass set / treble set (each with ▶ to hear it), mood, tempo, a name. "Start
      writing" or "Just make me something" (random picks, and every part of round 1 starts with a starter).
   2. createRecorder({ picks, banks, ... })  — the panel over the arena while you write. The loop runs; press
      Record and play — every pass of the loop is kept as a take; Undo takes the last pass back off.
      Rounds 1-3, each drums / bass / treble; then Save writes the whole level (round 4, the Hydra, is
      made from rounds 1-3). The game wires the sound and the clock in through the callbacks. */
import { Draft, HELP, thinParts, THIN, MOODS, TEMPOS, PARTS, barMidi, starterPart, recordLanes, draftToSong, missingParts, makeLevel, slugOf, MIX_DEFAULT, partFx } from "../game/maker.js";

const pick = (a) => a[Math.floor(Math.random() * a.length)];

// ---- 1. pick the sounds -------------------------------------------------------------------------
let previewCtx = null;
const previewBufs = new Map();
async function previewBuf(path) {
  if (!previewBufs.has(path)) previewBufs.set(path, fetch("/rounds/samples/" + path).then((r) => r.arrayBuffer()).then((b) => previewCtx.decodeAudioData(b)));
  return previewBufs.get(path);
}
async function playPreview(notes) {   // notes: [{ path, rate, at, vel }]
  previewCtx ||= new AudioContext();
  await previewCtx.resume();
  const t0 = previewCtx.currentTime + 0.05;
  for (const n of notes) {
    const buf = await previewBuf(n.path).catch(() => null);
    if (!buf) continue;
    const s = previewCtx.createBufferSource(), g = previewCtx.createGain();
    s.buffer = buf; s.playbackRate.value = n.rate || 1; g.gain.value = n.vel ?? 0.8;
    s.connect(g).connect(previewCtx.destination); s.start(t0 + n.at, 0, 1.2);
  }
}
const rateFor = (set, midi) => 2 ** ((midi - set.root) / 12);

export function pickSounds(card, { worlds, banks, onDone, onBack }) {
  const p = { world: worlds[0].id, kit: banks.drums[0].id, bass: banks.bass[0].id, treble: banks.treble[0].id, mood: "bright", tempo: "medium", title: "My level" };
  const opts = (list, cur) => list.map((x) => `<option value="${x.id}" ${x.id === cur ? "selected" : ""}>${x.name}</option>`).join("");
  const chips = (obj, key) => Object.entries(obj).map(([id, v]) => `<button class="chip ${p[key] === id ? "on" : ""}" data-chip="${key}" data-v="${id}">${v.label}</button>`).join("");
  // FOLDED SECTIONS (owner, 2026-10-13: "collapsible menus — you can't do ANYTHING on phones"): each fold shows its current choice, so
  // the whole screen reads at a glance; Start / Surprise / Back are pinned under the folds and never scroll away
  const open = pickSounds._open ||= new Set(window.innerHeight > 700 ? ["sounds"] : []);
  const nameOf = (list, id) => (list.find((x) => x.id === id) || {}).name || id;
  function paint() {
    card.classList.add("mk-pick");
    const fold = (key, title, summary, body) => `<details data-fold="${key}" ${open.has(key) ? "open" : ""}><summary><b>${title}</b><span class="val">${summary}</span></summary><div class="fold-body">${body}</div></details>`;
    card.innerHTML = `<div class="mk-head"><h2>Make a level</h2><div class="sub">Everything's picked already — tap a section to change it, or just Start.</div></div>
      <div class="mk-scroll">
      ${fold("sounds", "Sounds", `${nameOf(banks.drums, p.kit)} · ${nameOf(banks.bass, p.bass)} · ${nameOf(banks.treble, p.treble)}`, `
        <div class="mk-row"><span>Drums</span><select data-k="kit">${opts(banks.drums, p.kit)}</select><button class="play" data-play="kit">▶</button></div>
        <div class="mk-row"><span>Bass</span><select data-k="bass">${opts(banks.bass, p.bass)}</select><button class="play" data-play="bass">▶</button></div>
        <div class="mk-row"><span>Treble</span><select data-k="treble">${opts(banks.treble, p.treble)}</select><button class="play" data-play="treble">▶</button></div>`)}
      ${fold("feel", "Mood & speed", `${MOODS[p.mood].label} · ${TEMPOS[p.tempo].label}`, `
        <div class="mk-row"><span>Mood</span><div class="chips">${chips(MOODS, "mood")}</div></div>
        <div class="mk-row"><span>Speed</span><div class="chips">${chips(TEMPOS, "tempo")}</div></div>`)}
      ${fold("name", "Name & world", `${p.title} · ${worlds.find((w) => w.id === p.world).name}`, `
        <div class="mk-row"><span>Name</span><input data-k="title" maxlength="40" value="${p.title.replace(/"/g, "&quot;")}"></div>
        <div class="mk-row"><span>World</span><span class="chip on">${worlds.find((w) => w.id === p.world).name}</span><span class="t">more coming</span></div>`)}
      </div>
      <div class="mk-foot"><button class="big" data-a="go">Start writing ▶</button>
        <button class="big lucky" data-a="lucky">🎲 Surprise me</button><button class="back" data-a="back">◀ Back</button></div>`;
    card.querySelectorAll("details[data-fold]").forEach((d) => d.addEventListener("toggle", () => { d.open ? open.add(d.dataset.fold) : open.delete(d.dataset.fold); }));
    card.querySelectorAll("select[data-k]").forEach((s) => (s.onchange = () => { p[s.dataset.k] = s.value; paint(); }));
    card.querySelector("input[data-k=title]").oninput = (e) => { p.title = e.target.value; };
    card.querySelector("input[data-k=title]").onchange = () => paint();
    card.querySelectorAll("[data-chip]").forEach((b) => (b.onclick = () => { p[b.dataset.chip] = b.dataset.v; paint(); }));
    card.querySelectorAll("[data-play]").forEach((b) => (b.onclick = () => preview(b.dataset.play)));
    card.querySelector("[data-a=go]").onclick = () => onDone({ ...p, title: p.title.trim() || "My level" });
    card.querySelector("[data-a=lucky]").onclick = () => onDone({ ...p, kit: pick(banks.drums).id, bass: pick(banks.bass).id, treble: pick(banks.treble).id,
      mood: pick(Object.keys(MOODS)), tempo: pick(Object.keys(TEMPOS)), title: p.title.trim() || "My level", starters: true });
    card.querySelector("[data-a=back]").onclick = onBack;
  }
  function preview(what) {
    const beat = 60 / TEMPOS[p.tempo].bpm;
    if (what === "kit") {
      const k = banks.drums.find((x) => x.id === p.kit).sounds;
      playPreview(["kick", "hat", "snare", "hat", "kick", "kick", "snare", "crash"].map((d, i) => ({ path: k[d], at: i * beat / 2, vel: 0.8 })));
    } else {
      const set = banks[what].find((x) => x.id === p[what]), root = what === "bass" ? 48 : 72;
      playPreview([1, 3, 5, 8, 5, 3, 1].map((bar, i) => ({ path: set.sample, rate: rateFor(set, barMidi(bar, p.mood, root)), at: i * beat / 2 })));
    }
  }
  paint();
}

// the picker's layout: a column whose middle scrolls while the head and the Start buttons stay put; smaller on short screens
{ const st = document.createElement("style"); st.textContent = `
#gr-menu .card.mk-pick { display:flex; flex-direction:column; max-height:calc(100dvh - 20px); padding:14px 16px; }
#gr-menu .mk-pick .mk-head h2 { margin:0 0 2px; }
#gr-menu .mk-pick .mk-head .sub { margin-bottom:8px; }
#gr-menu .mk-pick .mk-scroll { overflow:auto; flex:1 1 auto; min-height:0; }
#gr-menu .mk-pick details { border:1px solid rgba(255,190,120,0.25); border-radius:10px; margin:6px 0; background:rgba(255,160,80,0.05); }
#gr-menu .mk-pick summary { display:flex; gap:10px; align-items:baseline; padding:10px 12px; cursor:pointer; list-style:none; }
#gr-menu .mk-pick summary::-webkit-details-marker { display:none; }
#gr-menu .mk-pick summary::before { content:"▸"; color:#ffd27a; }
#gr-menu .mk-pick details[open] summary::before { content:"▾"; }
#gr-menu .mk-pick summary .val { opacity:0.65; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; text-align:right; }
#gr-menu .mk-pick .fold-body { padding:0 12px 8px; }
#gr-menu .mk-pick .mk-foot { flex:0 0 auto; display:grid; grid-template-columns:1fr 1fr; gap:8px; padding-top:8px; }
#gr-menu .mk-pick .mk-foot .big { margin:0; font-size:17px; padding:12px; }
#gr-menu .mk-pick .mk-foot .back { grid-column:1 / -1; }
@media (max-height: 500px) {
  #gr-menu .mk-pick { padding:8px 12px; }
  #gr-menu .mk-pick .mk-head h2 { font-size:17px; } #gr-menu .mk-pick .mk-head .sub { display:none; }
  #gr-menu .mk-pick summary { padding:7px 10px; } #gr-menu .mk-pick .mk-foot .big { font-size:15px; padding:9px; }
  #gr-menu .mk-pick .mk-foot { grid-template-columns:1fr 1fr auto; } #gr-menu .mk-pick .mk-foot .back { grid-column:auto; }
}`; document.head.appendChild(st); }

// ---- 2. the record panel ------------------------------------------------------------------------
const PANEL_CSS = `
#mk-panel { position:fixed; left:50%; top:8px; transform:translateX(-50%); z-index:40; width:min(820px, calc(100% - 16px));
  box-sizing:border-box; font-family:system-ui, sans-serif; color:#f4e9dc; font-size:14px; }
#mk-panel .bar, #mk-panel .drawer { border-radius:12px; background:rgba(28,18,26,0.9); border:1px solid rgba(255,190,120,0.35); }
#mk-panel .bar { display:flex; gap:5px; align-items:center; padding:5px 6px; overflow-x:auto; scrollbar-width:none; }
#mk-panel .drawer { margin-top:6px; padding:8px 10px; }
#mk-panel .r { display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin:4px 0; }
#mk-panel button, #mk-panel select { font:inherit; color:#fff; cursor:pointer; border-radius:9px; border:1px solid rgba(255,190,120,0.45); background:rgba(255,160,80,0.12); padding:6px 10px; white-space:nowrap; flex:0 0 auto; }
#mk-panel select { background:#2a1c24; }
#mk-panel button.on { background:rgba(255,160,80,0.45); border-color:#ffd27a; }
#mk-panel button.rec { font-weight:700; }
#mk-panel button.rec.on { background:#b3261e; border-color:#ff8a80; }
#mk-panel button:disabled { opacity:0.35; cursor:default; }
#mk-panel .grow { flex:1 1 0; min-width:4px; }
#mk-panel .seg { display:flex; flex:0 0 auto; }
#mk-panel .seg button { border-radius:0; margin-left:-1px; } #mk-panel .seg button:first-child { border-radius:9px 0 0 9px; margin:0; } #mk-panel .seg button:last-child { border-radius:0 9px 9px 0; }
#mk-panel .say { margin-top:6px; padding:6px 10px; border-radius:10px; background:rgba(28,18,26,0.85); font-size:13px; opacity:0.9; }
#mk-panel .lap { font-variant-numeric:tabular-nums; opacity:0.7; font-size:12px; white-space:nowrap; }
#mk-panel .sl { display:grid; grid-template-columns:76px 1fr 44px; gap:4px 10px; align-items:center; font-size:13px; }
#mk-panel .sl input[type=range] { width:100%; accent-color:#ffb050; }
#mk-panel .sl .v { text-align:right; opacity:0.75; font-variant-numeric:tabular-nums; }
#mk-panel h4 { margin:2px 0 6px; font-size:13px; color:#ffd27a; letter-spacing:0.04em; }
@media (max-height: 500px) { #mk-panel { font-size:13px; } #mk-panel button, #mk-panel select { padding:5px 8px; } #mk-panel .lap { display:none; }
  #mk-panel .sl { grid-template-columns:52px 1fr 40px 52px 1fr 40px; } #mk-panel .drawer { padding:6px 8px; } #mk-panel h4 { margin:0 0 4px; } }
body.mk-creating #gr-hud .top, body.mk-creating #gr-gear { display:none !important; }
body.dev-mode #mk-panel { display:none; }
`;
const KEYS_HELP = {
  drums: "Drums: top row Q W E, bottom row A S D",
  bass: "Bass: A S D F G H J K low notes, Q W E R T Y U I the high ones",
  treble: "Treble: A S D F G H J K",
};

/** the panel. hooks: setPart(part) turns the arena to that station; save(level, songs) -> Promise<"server"|"device">;
 *  play(level) goes and plays it. Each round is its own Draft; the arena's sounds are the same for all three. */
export function createRecorder({ picks, banks, hooks }) {
  const style = document.createElement("style"); style.textContent = PANEL_CSS; document.head.appendChild(style);
  const el = document.createElement("div"); el.id = "mk-panel"; document.body.appendChild(el);
  const draftOpts = { world: picks.world, kit: picks.kit, bass: picks.bass, treble: picks.treble, mood: picks.mood, tempo: picks.tempo };
  const rounds = [new Draft(draftOpts), new Draft(draftOpts), new Draft(draftOpts)];
  let r = 0, part = "drums", recording = false, lap = -1, msg = "", saved = null;
  const d = () => rounds[r];
  const addTake = (dr, p, notes) => { dr.beginTake(p); for (const n of notes) dr.play(n.lane, n.played, n.vel); dr.closeTake(); };
  if (picks.starters) for (const p of PARTS) addTake(rounds[0], p, starterPart(p, rounds[0].bars));

  function say(t) { sayFor(t); }
  function setRecording(on) {
    recording = on;
    if (on) d().beginTake(part); else d().closeTake();
    paint();
  }
  // THE BAR (owner, 2026-10-13: "collapsible menus — smaller UI on phones"): one slim row along the top — Record, round, part, Undo,
  // 🎚 Sound, ⋯ More, Save — so the instruments stay in view; the rest lives in two drawers that open under it
  const mix = { drums: { ...MIX_DEFAULT }, bass: { ...MIX_DEFAULT }, treble: { ...MIX_DEFAULT } };
  let drawer = null, sayTimer = null;   // null | "sound" | "more"
  const PART_LABEL = { drums: "🥁 Drums", bass: "Bass", treble: "Treble" };
  function paint() {
    const missing = missingParts(d()), done = rounds.map((x) => missingParts(x).length === 0), m = mix[part];
    const slider = (k, label, min, max, step, fmt) => `<span>${label}</span><input type="range" data-mix="${k}" min="${min}" max="${max}" step="${step}" value="${m[k]}"><span class="v" data-mixv="${k}">${fmt(m[k])}</span>`;
    const pct = (v) => Math.round(v * 100) + "%";
    el.innerHTML = `
      <div class="bar">
        <button class="rec ${recording ? "on" : ""}" data-a="rec" title="Record (Enter)">${recording ? "■ Stop" : "● Rec"}</button>
        <select data-a="round" title="Round">${rounds.map((_, i) => `<option value="${i}" ${i === r ? "selected" : ""}>Round ${i + 1}${done[i] ? " ✓" : ""}</option>`).join("")}</select>
        <div class="seg">${PARTS.map((p) => `<button data-part="${p}" class="${p === part ? "on" : ""}">${PART_LABEL[p]} ${d().notes(p).length}</button>`).join("")}</div>
        <button data-a="undo" title="Take the last pass back off" ${d().takes[part].length ? "" : "disabled"}>↶</button>
        <span class="lap"></span><span class="grow"></span>
        <button data-a="sound" class="${drawer === "sound" ? "on" : ""}" title="Reverb, tone, volume, echo for ${part}">🎚</button>
        <button data-a="more" class="${drawer === "more" ? "on" : ""}" title="More">⋯</button>
        <button data-a="save" class="${rounds.every((x, i) => done[i]) ? "on" : ""}" title="Save the level">💾</button>
      </div>
      ${drawer === "sound" ? `<div class="drawer"><h4>${PART_LABEL[part]} SOUND — for the whole level</h4><div class="sl">
        ${slider("reverb", "Reverb", 0, 1, 0.05, pct)}${slider("tone", "Tone", -1, 1, 0.1, (v) => (v < -0.05 ? "dark" : v > 0.05 ? "bright" : "even"))}
        ${slider("volume", "Volume", 0, 1.5, 0.05, pct)}${slider("echo", "Echo", 0, 1, 0.05, pct)}</div>
        <div class="r"><button data-a="mixall">Use for every part</button><button data-a="mixreset">Reset</button></div></div>` : ""}
      ${drawer === "more" ? `<div class="drawer">
        <div class="r"><button data-a="starter">🎁 Give me a starter</button><button data-a="clear" ${d().takes[part].length || recording ? "" : "disabled"}>🗑 Start ${part} again</button>
          ${r < 2 ? `<button data-a="next">Round ${r + 2} ▶</button>` : ""}</div>
        <div class="r"><span>Timing help</span>${Object.entries(HELP).map(([k, h]) => `<button data-help="${k}" class="${d().help === k ? "on" : ""}">${h.label}</button>`).join("")}</div>
        <div class="r"><button data-a="settings">⚙ Settings</button><button data-a="leave">✕ Back to the menu</button><span class="grow"></span><span style="opacity:.6">${picks.title}</span></div></div>` : ""}
      ${msg ? `<div class="say">${msg}</div>` : ""}`;
    el.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => b.blur()));   // the keys are the instrument: never "press" a button by accident
    el.querySelector("[data-a=round]").onchange = (e) => { e.target.blur(); goRound(+e.target.value); };
    el.querySelectorAll("[data-part]").forEach((b) => (b.onclick = () => goPart(b.dataset.part)));
    el.querySelector("[data-a=rec]").onclick = () => setRecording(!recording);
    el.querySelector("[data-a=undo]").onclick = () => { const was = recording; if (was) d().closeTake(); d().undo(part); if (was) d().beginTake(part); say("Took the last pass back off."); };
    el.querySelector("[data-a=sound]").onclick = () => { drawer = drawer === "sound" ? null : "sound"; paint(); };
    el.querySelector("[data-a=more]").onclick = () => { drawer = drawer === "more" ? null : "more"; paint(); };
    el.querySelector("[data-a=save]").onclick = save;
    el.querySelectorAll("[data-mix]").forEach((inp) => (inp.oninput = () => {   // live: the part's tracks change as you drag
      m[inp.dataset.mix] = +inp.value; const v = el.querySelector(`[data-mixv=${inp.dataset.mix}]`);
      if (v) v.textContent = inp.dataset.mix === "tone" ? (m.tone < -0.05 ? "dark" : m.tone > 0.05 ? "bright" : "even") : Math.round(m[inp.dataset.mix] * 100) + "%";
      if (hooks.setMix) hooks.setMix(part, partFx(m));
    }));
    const on = (a, fn) => { const b = el.querySelector(`[data-a=${a}]`); if (b) b.onclick = fn; };
    on("mixall", () => { for (const p of PARTS) { mix[p] = { ...m }; if (hooks.setMix) hooks.setMix(p, partFx(mix[p])); } say(`Every part now uses the ${part} sound settings.`); });
    on("mixreset", () => { mix[part] = { ...MIX_DEFAULT }; if (hooks.setMix) hooks.setMix(part, partFx(mix[part])); paint(); });
    on("starter", () => { addTake(d(), part, starterPart(part, d().bars)); say(`A starter ${part} part is in. Play over it, or Undo to take it back off.`); });
    on("clear", () => { d().clear(part); if (recording) d().beginTake(part); say(`${part} is empty again.`); });
    on("next", () => goRound(r + 1));
    on("settings", () => { if (hooks.settings) hooks.settings(); });
    on("leave", () => {   // unsaved work: the first click only warns (no browser dialogs)
      if (saved || !rounds.some((x) => x.noteCount()) || leaving) return hooks.leave();
      leaving = true; say("Not saved yet — tap ✕ again to leave without saving.");
    });
    el.querySelectorAll("[data-help]").forEach((b) => (b.onclick = () => { d().setHelp(b.dataset.help); say(`Timing help: ${HELP[b.dataset.help].label} — everything already played is re-tidied`); }));
  }
  // the message line comes and goes (it used to sit there, a paragraph tall, all the time)
  function sayFor(t, ms = 6000) { msg = t; paint(); clearTimeout(sayTimer); if (t) sayTimer = setTimeout(() => { msg = ""; paint(); }, ms); }
  let leaving = false;
  function goPart(p) {
    if (recording) d().closeTake();
    part = p; hooks.setPart(p);
    if (recording) d().beginTake(p);
    const touch = "ontouchstart" in window, empty = !d().notes(p).length;
    sayFor(`${touch ? `Tap the ${p === "drums" ? "drums" : "guns"} to play` : KEYS_HELP[p]}. ● Rec${touch ? "" : " (or Enter)"} and play along${empty ? ` — or ⋯ → 🎁 for a starter` : ""}.`, 7000);
  }
  function goRound(i) {
    if (recording) setRecording(false);
    r = i; goPart("drums");
    if (!d().noteCount()) sayFor(`Round ${i + 1} is empty — make it different from the last one!`);
  }
  async function save() {
    if (recording) setRecording(false);
    const notDone = rounds.map((x, i) => [i, missingParts(x)]).filter(([, m]) => m.length);
    if (notDone.length) {
      const [i, m] = notDone[0];
      return say(`Round ${i + 1} still needs ${m.join(" and ")}. Tip: 🎁 Give me a starter fills a part in one click.`);
    }
    const slug = slugOf(picks.title);
    const songs = rounds.map((x, i) => draftToSong(x, { name: `${picks.title} · round ${i + 1}`, title: picks.title, banks, mix }));   // the 🎚 settings go with it
    const level = makeLevel(songs, { name: picks.title, title: picks.title, files: songs.map((_, i) => `${slug}-${i + 1}.json`) });
    say("Saving…");
    try { saved = await hooks.save(slug, level, songs); }
    catch (e) { return say(`Couldn't save: ${e.message || e}`); }
    clearTimeout(sayTimer); msg = " "; paint();
    el.querySelector(".say").innerHTML = saved === "server"
      ? `Saved! <b>${picks.title}</b> is in your level list (rounds 1-3; the Hydra round is made from them). <button data-a="play">Play it ▶</button>`
      : `Saved on this device only (no game server here). <button data-a="play">Play it ▶</button>`;
    el.querySelector("[data-a=play]").onclick = () => hooks.play(slug);
  }
  goPart("drums");   // first paint, with the how-to-play tip

  return {
    get part() { return part; }, get round() { return r; }, rounds, get recording() { return recording; },
    /** a hit while the loop runs (beat = loop beats, as played); only the part on screen records */
    hit(lane, beat) {
      if (!recording || !recordLanes(part).includes(lane)) return;
      d().play(lane, beat);
      const b = el.querySelector(`[data-part=${part}]`); if (b) b.textContent = `${PART_LABEL[part]} ${d().notes(part).length}`;
    },
    /** the loop came round: a new pass is a new take */
    lapTo(n, beatInLoop) {
      const s = el.querySelector(".lap"); if (s) s.textContent = `${recording ? "● " : ""}bar ${Math.floor(beatInLoop / 4) + 1} of ${d().bars}`;
      if (n === lap) return;
      lap = n;
      if (recording) { d().closeTake(); d().beginTake(part); const u = el.querySelector("[data-a=undo]"); if (u) u.disabled = !d().takes[part].length; }
    },
    /** what the loop plays back: every part's finished passes, tidied */
    playback() { return PARTS.flatMap((p) => d().notes(p, { closedOnly: true })); },
    key(e) {   // Enter: record on / off
      if (e.key === "Enter" && !e.repeat) { e.preventDefault(); setRecording(!recording); return true; }
      return false;
    },
    say,
  };
}
