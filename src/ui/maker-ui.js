/* maker-ui.js — the SONG-MAKER's screens (owner, 2026-10-07: "Create" on the main menu — pick the
   instruments, write the level by playing — "set it up so any idiot can do it").

   1. pickSounds(card, { worlds, banks, onDone(picks), onBack })  — ONE screen, everything pre-filled:
      world, drum kit / bass set / treble set (each with ▶ to hear it), mood, tempo, a name. "Start
      writing" or "Just make me something" (random picks, and every part of round 1 starts with a starter).
   2. createRecorder({ picks, banks, ... })  — the panel over the arena while you write. The loop runs; press
      Record and play — every pass of the loop is kept as a take; Undo takes the last pass back off.
      Rounds 1-3, each drums / bass / treble; then Save writes the whole level (round 4, the Hydra, is
      made from rounds 1-3). The game wires the sound and the clock in through the callbacks. */
import { Draft, HELP, thinParts, THIN, MOODS, TEMPOS, PARTS, barMidi, starterPart, recordLanes, draftToSong, missingParts, makeLevel, slugOf } from "../game/maker.js";

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
  function paint() {
    card.innerHTML = `<h2>Make a level</h2>
      <div class="sub">Everything's already picked. Change what you like, or just hit Start.</div>
      <div class="mk-row"><span>World</span><span class="chip on">${worlds.find((w) => w.id === p.world).name}</span><span class="t">more worlds coming</span></div>
      <div class="mk-row"><span>Drums</span><select data-k="kit">${opts(banks.drums, p.kit)}</select><button class="play" data-play="kit">▶</button></div>
      <div class="mk-row"><span>Bass</span><select data-k="bass">${opts(banks.bass, p.bass)}</select><button class="play" data-play="bass">▶</button></div>
      <div class="mk-row"><span>Treble</span><select data-k="treble">${opts(banks.treble, p.treble)}</select><button class="play" data-play="treble">▶</button></div>
      <div class="mk-row"><span>Mood</span><div class="chips">${chips(MOODS, "mood")}</div></div>
      <div class="mk-row"><span>Speed</span><div class="chips">${chips(TEMPOS, "tempo")}</div></div>
      <div class="mk-row"><span>Name</span><input data-k="title" maxlength="40" value="${p.title.replace(/"/g, "&quot;")}"></div>
      <button class="big" data-a="go">Start writing ▶</button>
      <button class="big lucky" data-a="lucky">🎲 Just make me something</button>
      <button class="back" data-a="back">◀ Back</button>`;
    card.querySelectorAll("select[data-k]").forEach((s) => (s.onchange = () => { p[s.dataset.k] = s.value; }));
    card.querySelector("input[data-k=title]").oninput = (e) => { p.title = e.target.value; };
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

// ---- 2. the record panel ------------------------------------------------------------------------
const PANEL_CSS = `
#mk-panel { position:fixed; left:50%; bottom:10px; transform:translateX(-50%); z-index:40; width:min(760px, calc(100% - 20px));
  box-sizing:border-box; padding:10px 12px; border-radius:14px; background:rgba(28,18,26,0.92); border:1px solid rgba(255,190,120,0.35);
  font-family:system-ui, sans-serif; color:#f4e9dc; font-size:14px; }
#mk-panel .r { display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin:4px 0; }
#mk-panel button { font:inherit; color:#fff; cursor:pointer; border-radius:9px; border:1px solid rgba(255,190,120,0.45); background:rgba(255,160,80,0.12); padding:7px 11px; }
#mk-panel button.on { background:rgba(255,160,80,0.45); border-color:#ffd27a; }
#mk-panel button.rec.on { background:#b3261e; border-color:#ff8a80; }
#mk-panel button:disabled { opacity:0.35; cursor:default; }
#mk-panel .grow { flex:1; }
#mk-panel .say { opacity:0.8; min-height:18px; }
#mk-panel .title { font-weight:700; color:#ffd27a; margin-right:6px; }
#mk-panel .lap { font-variant-numeric:tabular-nums; opacity:0.75; }
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

  function say(t) { msg = t; paint(); }
  function setRecording(on) {
    recording = on;
    if (on) d().beginTake(part); else d().closeTake();
    paint();
  }
  function paint() {
    const missing = missingParts(d()), done = rounds.map((x) => missingParts(x).length === 0);
    el.innerHTML = `
      <div class="r"><span class="title">${picks.title}</span>
        ${rounds.map((_, i) => `<button data-round="${i}" class="${i === r ? "on" : ""}">Round ${i + 1}${done[i] ? " ✓" : ""}</button>`).join("")}
        <span class="grow"></span><span class="lap"></span><button data-a="leave">✕ Menu</button></div>
      <div class="r">${PARTS.map((p) => `<button data-part="${p}" class="${p === part ? "on" : ""}">${p === "drums" ? "🥁 Drums" : p === "bass" ? "Bass" : "Treble"} · ${d().notes(p).length}</button>`).join("")}
        <span class="grow"></span>
        <span>Timing help</span>${Object.entries(HELP).map(([k, h]) => `<button data-help="${k}" class="${d().help === k ? "on" : ""}">${h.label}</button>`).join("")}</div>
      <div class="r"><button class="rec ${recording ? "on" : ""}" data-a="rec">${recording ? "■ Stop" : "● Record"}</button>
        <button data-a="starter">🎁 Give me a starter</button>
        <button data-a="undo" ${d().takes[part].length ? "" : "disabled"}>↶ Undo</button>
        <button data-a="clear" ${d().takes[part].length || recording ? "" : "disabled"}>🗑 Start ${part} again</button>
        <span class="grow"></span>
        ${r < 2 ? `<button data-a="next">Round ${r + 2} ▶</button>` : ""}
        <button data-a="save" class="${rounds.every((x, i) => done[i]) ? "on" : ""}">💾 Save level</button></div>
      <div class="r say">${msg || (missing.length ? `${KEYS_HELP[part]}. Press Record (or Enter) and play along. Still empty here: ${missing.join(", ")}.` : `${KEYS_HELP[part]}. Round ${r + 1} has all three parts.${thinParts(d()).length ? ` Thin: ${thinParts(d()).join(", ")} — under ${THIN} notes, that fight will be over fast. Play another pass or add a 🎁 starter.` : ""}`)}</div>`;
    el.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => b.blur()));   // the keys are the instrument: never "press" a button by accident
    el.querySelectorAll("[data-round]").forEach((b) => (b.onclick = () => goRound(+b.dataset.round)));
    el.querySelectorAll("[data-part]").forEach((b) => (b.onclick = () => goPart(b.dataset.part)));
    el.querySelectorAll("[data-help]").forEach((b) => (b.onclick = () => { d().setHelp(b.dataset.help); msg = `Timing help: ${HELP[b.dataset.help].label} — everything already played is re-tidied`; paint(); }));
    el.querySelector("[data-a=rec]").onclick = () => setRecording(!recording);
    el.querySelector("[data-a=starter]").onclick = () => { addTake(d(), part, starterPart(part, d().bars)); say(`A starter ${part} part is in. Play over it, or Undo to take it back off.`); };
    el.querySelector("[data-a=undo]").onclick = () => { const was = recording; if (was) d().closeTake(); d().undo(part); if (was) d().beginTake(part); say("Took the last pass back off."); };
    el.querySelector("[data-a=clear]").onclick = () => { d().clear(part); if (recording) d().beginTake(part); say(`${part} is empty again.`); };
    const nx = el.querySelector("[data-a=next]"); if (nx) nx.onclick = () => goRound(r + 1);
    el.querySelector("[data-a=save]").onclick = save;
    el.querySelector("[data-a=leave]").onclick = () => {   // unsaved work: the first click only warns (no browser dialogs)
      if (saved || !rounds.some((x) => x.noteCount()) || leaving) return hooks.leave();
      leaving = true; say("Not saved yet — click ✕ Menu again to leave without saving.");
    };
  }
  let leaving = false;
  function goPart(p) {
    if (recording) d().closeTake();
    part = p; hooks.setPart(p);
    if (recording) d().beginTake(p);
    msg = ""; paint();
  }
  function goRound(i) {
    if (recording) setRecording(false);
    r = i; msg = d().noteCount() ? "" : `Round ${i + 1} is empty — make it different from the last one!`;
    goPart("drums");
  }
  async function save() {
    if (recording) setRecording(false);
    const notDone = rounds.map((x, i) => [i, missingParts(x)]).filter(([, m]) => m.length);
    if (notDone.length) {
      const [i, m] = notDone[0];
      return say(`Round ${i + 1} still needs ${m.join(" and ")}. Tip: 🎁 Give me a starter fills a part in one click.`);
    }
    const slug = slugOf(picks.title);
    const songs = rounds.map((x, i) => draftToSong(x, { name: `${picks.title} · round ${i + 1}`, title: picks.title, banks }));
    const level = makeLevel(songs, { name: picks.title, title: picks.title, files: songs.map((_, i) => `${slug}-${i + 1}.json`) });
    say("Saving…");
    try { saved = await hooks.save(slug, level, songs); }
    catch (e) { return say(`Couldn't save: ${e.message || e}`); }
    el.querySelector(".say").innerHTML = saved === "server"
      ? `Saved! <b>${picks.title}</b> is in your level list (rounds 1-3; the Hydra round is made from them). <button data-a="play">Play it ▶</button>`
      : `Saved on this device only (no game server here). <button data-a="play">Play it ▶</button>`;
    el.querySelector("[data-a=play]").onclick = () => hooks.play(slug);
  }
  paint();

  return {
    get part() { return part; }, get round() { return r; }, rounds, get recording() { return recording; },
    /** a hit while the loop runs (beat = loop beats, as played); only the part on screen records */
    hit(lane, beat) {
      if (!recording || !recordLanes(part).includes(lane)) return;
      d().play(lane, beat);
      const b = el.querySelector(`[data-part=${part}]`); if (b) b.textContent = `${part === "drums" ? "🥁 Drums" : part === "bass" ? "Bass" : "Treble"} · ${d().notes(part).length}`;
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
