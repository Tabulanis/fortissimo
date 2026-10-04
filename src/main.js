/* main.js — Garden Rhythm beat core.
   Start button -> AudioContext (created inside the click), drums rendered,
   metronome click scheduled ahead of the audio clock, instant kicks on lane
   keys with timing judged against the chart (known in advance), mapped to
   velocity. First-person 3D courtyard on canvas#stage: flaming arrows fly in
   on the audio clock (the arrows ARE the notes). The timing histogram lives on
   its own canvas#chart. A calibration mode removes the player's systematic
   offset. */

import "./audio/voices.js";
import "./audio/hbchain.js";
import { stretchBuffer } from "./audio/stretch.js";
import { bakeThroughTrack, liteTrack, sendsAny } from "./audio/bake.js";   // Hackbeat's own track chain, word for word (tools/sync-hackbeat-audio.mjs)
import { makeDrums } from "./audio/drums.js";
import { startClock } from "./audio/clock.js";
import { nearestOnGrid, nearestInLoop, velocityFor, label, OFF_CHART, OFF_VEL } from "./game/judge.js";
import { LAYOUT, CHART } from "./game/chart.js";
import { Ghosts } from "./game/ghosts.js";
import { SessionLog } from "./game/session.js";
import { createStage3D } from "./scene/stage3d.js";
import { Bell } from "./game/bell.js";
import { Loops } from "./game/loops.js";
import { ROUNDS, partArrows, isShown, buildUp } from "./game/stages.js";
import { loadRoundFiles } from "./game/roundfiles.js";
import { lessonParts, sectionProgress, backLevel, finishedLanes } from "./game/lesson.js";
import { normalize, judgeFor, simplifyNotes, scoreMultiplier, presetOf, PRESET_NAMES } from "./game/run.js";
import { createMenu } from "./ui/menu.js";
import { Defend, townDamage, LIFE } from "./game/defend.js";
import { gradeRound } from "./game/grade.js";
import { createResults } from "./ui/results.js";
import { showLocked, showStamp } from "./ui/locked.js";
import { createHud } from "./ui/hud.js";
import { createMixer } from "./audio/mixer.js";
import { loadSettings, createSettings } from "./ui/settings.js";
import { createPads } from "./input/pads.js";
import { bootlog } from "./bootlog.js";
import { makeMelodyVoices } from "./audio/melody.js";
import { instrumentNotes, BASS_OCTAVE, TREBLE_OCTAVE } from "./game/scales.js";
bootlog("page", { ua: navigator.userAgent, screen: `${screen.width}x${screen.height}`, dpr: window.devicePixelRatio,
  view: `${innerWidth}x${innerHeight}`, memGB: navigator.deviceMemory, cores: navigator.hardwareConcurrency });
window.addEventListener("error", (e) => bootlog("error", { msg: String(e.message), at: `${e.filename}:${e.lineno}` }));
window.addEventListener("unhandledrejection", (e) => bootlog("rejection", { msg: String(e.reason && (e.reason.stack || e.reason)).slice(0, 600) }));

const { VoicePool, VOICE_PRESETS, voiceSettings, voiceShaped } = window.HB_VOICES;

const hud = document.querySelector("#hud");
const stage = document.querySelector("#stage");
const chart = document.querySelector("#chart");
const ctx2d = chart.getContext("2d");
const SET = loadSettings();         // saved settings (Esc / gear)
// THE RUN (run.js, owner 2026-10-03, Beat Saber style): chosen in the start menu —
// hitbox, tempo, pattern difficulty, notes per step, keep. Saved between visits.
const RUN = (() => { try { return normalize(JSON.parse(localStorage.getItem("gr.run") || "null") || {}); } catch { return normalize({}); } })();
let BPM = 80;   // set at Start: the song's own tempo x the run's tempo
// levels unlock one by one: finishing level N opens N + 1
const UNLOCKED_KEY = "gr.unlocked";
const unlockedLevel = () => { try { return +localStorage.getItem(UNLOCKED_KEY) || 0; } catch { return 0; } };

const CALIB_KEY = "gr.calib";

// --- drum colours (hex strings; shared by the 3D stage and the chart) ------
const DRUM_COLOR = {
  hat: "#8ac", snare: "#f8a", crash: "#ce8",
  kick: "#a8f", tomLow: "#da6", tomHigh: "#fa4",
};

// --- the 3D stage (created once at load; canvas#stage becomes WebGL) --------
// GRAPHICS LEVEL: high | medium | low | lowest. Settings can fix it; on Auto the
// game starts from a guess (touch screen -> medium) and MEASURES the frame rate
// after loading: too slow and it steps down a level and reloads, remembering the
// level for this device. ?quality=... in the URL forces one (mobile = medium).
const TIERS = ["high", "medium", "low", "lowest"];
const urlQ = new URLSearchParams(location.search).get("quality");
const IS_TOUCH = window.matchMedia("(pointer: coarse)").matches || urlQ === "mobile";   // touch layout, separate from graphics
const AUTO_GFX = !urlQ && (SET.quality || "auto") === "auto";
let savedTier = null;
try { savedTier = localStorage.getItem("gr.autoTier"); } catch { /* storage blocked: guess each time */ }
const TIER = urlQ === "mobile" ? "medium" : TIERS.includes(urlQ) ? urlQ
  : !AUTO_GFX && TIERS.includes(SET.quality) ? SET.quality
  : TIERS.includes(savedTier) ? savedTier : IS_TOUCH ? "medium" : "high";
const stage3d = createStage3D(stage, LAYOUT, DRUM_COLOR, { tier: TIER });
bootlog("stage3d built");
stage.addEventListener("webglcontextlost", () => bootlog("WEBGL CONTEXT LOST"));
// once running: a heartbeat with the frame rate, so a later crash shows when
{ let frames = 0; const tick = () => { frames++; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  setInterval(() => {
    const a = stage3d.debugArrows ? stage3d.debugArrows() : {};
    bootlog("alive", { fps: Math.round(frames / 5), started: !!ctx,
      round: roundIdx + 1, part: stageIdx + 1, wants: [...new Set(currentPart().map((n) => n.lane))],
      flying: a.flying, shown: a.shown && a.shown.map((v) => (v ? 1 : 0)).join(""), taps: recentTaps.splice(0) });
    frames = 0;
  }, 5000); }
if (IS_TOUCH) document.documentElement.classList.add("touch");   // touch layout (no keyboard hints)
window.__gr = { stage3d };   // debug handle for the browser harness

// --- the song: parts unlock two drums at a time; the ghost bell locks them ---
const BARS = 16;                          // per station: bottom row 1-8, top row 9-16 (owner, 2026-10-03)
const LANE_INDEX = {};                    // lane name -> target 0..37
[...LAYOUT.top, ...LAYOUT.bottom].forEach((ln, i) => { LANE_INDEX[ln.name] = i; });
// melody bars: "bass 1".."bass 16" -> 6..21, "treble 1".."treble 16" -> 22..37
for (let k = 0; k < BARS; k++) { LANE_INDEX[`bass ${k + 1}`] = 6 + k; LANE_INDEX[`treble ${k + 1}`] = 6 + BARS + k; }
let stageIdx = 0;
let bell = null;                          // created when the clock starts
let loops = null;                         // locked measures, replayed exactly as played
// 3 ROUNDS in the same arena; each ends with an accuracy grade
let roundIdx = 0;
// Easy teaches every part in steps (on-beat core first, then the add-on over its ghost)
// the songs: Hackbeat projects (public/rounds, or Hackbeat's own copies while
// developing); the built-in ROUNDS only if those can't be read
// the round's SONG is a Hackbeat file; the game TEACHES it by the difficulty's
// rule (lesson.js: drums one instrument at a time, then bass, then treble, at
// most 4 / 6 / 8 notes a step). The built-in ROUNDS only if the files can't be read.
const BASE_ROUNDS = ROUNDS;
const EASY_ROUNDS = ROUNDS.map(buildUp);
let LESSONS = null;
const judgeDiff = () => judgeFor(RUN);   // what a step is judged by
const song = () => (LESSONS ? LESSONS[roundIdx] : (RUN.patterns === "easy" ? EASY_ROUNDS : BASE_ROUNDS)[roundIdx]);
const lastRound = () => roundIdx >= (LESSONS || BASE_ROUNDS).length - 1;
let SONGS = null;   // the rounds' songs as written (Hackbeat files)
// the run's pattern difficulty picks the notes you play; the rest goes to the backing (it still sounds)
function buildLessons() {
  if (!SONGS) return;
  LESSONS = SONGS.map((s) => {
    const { play, backing } = simplifyNotes(s.notes, RUN.patterns);
    return { ...s, playNotes: play, backingNotes: backing, parts: lessonParts({ ...s, notes: play }, 8, { barByBar: true }) };
  });
}
const roundsReady = loadRoundFiles().then((songs) => {
  if (!songs.length) return;
  SONGS = songs;
  buildLessons();
  if (typeof applyStage === "function") applyStage();
  bootlog("rounds from files", { n: songs.length, steps: LESSONS.map((l) => l.parts.length), warnings: songs.flatMap((r) => r.warnings) });
}).catch((e) => { console.warn("round files unavailable — playing the built-in songs", e); bootlog("rounds: built-in", { why: String(e) }); });
// THE CORE LOOP (defend.js, owner 2026-10-03): no bell — the song runs, arrows
// come for the notes you still need (song time: the "part" is the whole song),
// a correct hit locks by the run's lock size. Before Start: the old step view.
let defend = null;
let defendFrom = 0;              // misses count from here (a breath after Start)
const occDone = new Set();       // "noteId@pass": that occurrence was hit or counted as a miss
const offeredAt = new Map();     // noteId -> when it was first offered (its arrow can only come after that)
// LEAD TIME (owner, 2026-10-03): a newly offered note's target glows "coming up"
// (fading in) for this long before its arrow may come. Easy: 3 s, getting
// shorter as the song fills in (1.2 s near the end) — it speeds up toward the end.
const leadFor = () => {
  if (RUN.lock !== 1) return 4;
  const done = defend ? defend.locked.size / Math.max(1, defend.notes.length) : 0;
  return 3 - 1.8 * done;
};
const readyAt = (id) => (offeredAt.has(id) ? offeredAt.get(id) + leadFor() : Infinity);
const songDone = () => (defend ? defend.done : stageIdx >= song().parts.length);
const currentPart = () => (defend ? defend.offered() : songDone() ? [] : song().parts[stageIdx].part);
const partObj = () => (defend ? (defend.done ? null : { mode: defend.section, bars: song().bars, part: defend.offered() }) : songDone() ? null : song().parts[stageIdx]);
const partBars = () => (defend ? song().bars : (partObj() && partObj().bars) || 1);   // the engine: the whole song is the loop
const partMode = () => (partObj() && partObj().mode) || "drums";       // "drums" | "bass" | "treble"
const isMelody = () => partMode() !== "drums";
let padConnected = false;   // a game controller is plugged in (the bars then show its buttons)
// the notes this run's pattern difficulty leaves out. NOTHING plays that you
// haven't played (owner, 2026-10-03: "random horns"): an instrument's left-out
// notes join only once that instrument is finished, as a locked loop.
let backingJoined = new Set();   // lanes whose left-out notes are already playing
function addBacking() { backingJoined = new Set(); joinBacking(); }   // a fresh round: nothing joined yet
function joinBacking() {
  const b = song().backingNotes;
  if (!loops || !clock || !b || !b.length) return;
  const done = defend ? new Set(b.filter((n) => defend.progress(n.lane.startsWith("bass") ? "bass" : n.lane.startsWith("treble") ? "treble" : "drums") >= 1).map((n) => n.lane))
    : finishedLanes(song().parts, stageIdx);
  const lanes = [...done].filter((l) => !backingJoined.has(l) && b.some((n) => n.lane === l));
  if (!lanes.length) return;
  for (const l of lanes) backingJoined.add(l);
  const hits = b.filter((n) => lanes.includes(n.lane)).map((n) => ({ lane: n.lane, pos: n.beat * clock.beatDur, velocity: (n.vel ?? 1) * 0.85, midi: n.midi }));
  const startBar = Math.ceil((ctx.currentTime - clock.first) / (4 * clock.beatDur * song().bars)) * song().bars;   // from the next pass of the song
  loops.add({ bars: song().bars, startBar, backing: true, hits });
}
let audioStarted = false;   // Start pressed and the audio graph exists (the page lays out its HUD before that)
let roundOffsets = [];          // every guided hit this round: seconds off its note, null = off-chart
const results = createResults();
const hudUI = createHud({ onBell: ringBell, onHint: () => playHint() });
let autoCorrect = SET.autoCorrect;   // A toggles; also in settings
function showDifficulty() { hudUI.setDifficulty(`${PRESET_NAMES[presetOf(RUN)]} ×${scoreMultiplier(RUN).total}${autoCorrect ? " · Auto ✓" : ""}`); }
showDifficulty();
const settingsUI = createSettings({
  onChange: (k, v) => {
    if (k === "autoCorrect") { autoCorrect = v; showDifficulty(); return; }
    if (mixer) mixer.setVolume(k, v);
  },
  onRestart: () => location.reload(),   // difficulty sets the tempo; graphics rebuild the scene
});
settingsUI.setAutoNote(`Auto — measures this device (now: ${TIER})`);

// AUTO GRAPHICS CHECK: after a 2.5 s warm-up, count frames for 4 s (only while
// the page is visible). Under 28 fps -> step down a level and reload (or, once
// a game has started, just remember it for next time).
if (AUTO_GFX) {
  let frames = 0, t0 = 0, measuring = false, done = false;
  const begin = () => { frames = 0; t0 = performance.now(); measuring = document.visibilityState === "visible"; };
  setTimeout(begin, 2500);
  document.addEventListener("visibilitychange", () => { if (!done && document.visibilityState === "visible") begin(); else measuring = false; });
  const count = () => {
    if (done) return;
    if (measuring && ++frames && performance.now() - t0 >= 4000) { done = true; judgeGraphics(frames / ((performance.now() - t0) / 1000)); return; }
    requestAnimationFrame(count);
  };
  requestAnimationFrame(count);
}
function judgeGraphics(measured) {
  const fake = +new URLSearchParams(location.search).get("fakefps");   // TEST ONLY: pretend this frame rate
  const fps = fake || measured;
  const i = TIERS.indexOf(TIER), next = TIERS[i + 1];
  bootlog("graphics check", { tier: TIER, fps: Math.round(fps) });
  const remember = (t) => { try { localStorage.setItem("gr.autoTier", t); } catch { /* fine */ } };
  if (fps >= 28 || !next) { remember(TIER); return; }
  remember(next);
  if (ctx) { hudUI.say(`Graphics are slow here — next time this device uses ${next}`, "", 3500); return; }
  hudUI.say(`Adjusting graphics for this device: ${next}…`, "", 2500);
  setTimeout(() => location.reload(), 1200);
}

// where a hit is RECORDED: snapped onto its note (or, with no notes to follow,
// the nearest eighth) when auto-correct is on and it landed inside the box
function autoCorrectHit(press, vel, j, free) {
  if (!autoCorrect || !clock) return { t: press, velocity: vel };
  const box = judgeDiff().window;
  if (!free && j && Math.abs(j.offset) <= box) return { t: j.time, velocity: Math.max(vel, 0.95) };
  if (free) {
    const g = nearestOnGrid(clock.first, clock.beatDur / 2, press);   // eighth notes
    if (Math.abs(g.offset) <= box) return { t: g.time, velocity: vel };
  }
  return { t: press, velocity: vel };
}
// LIFE: you and the town, 100 each; a miss hurts both (the town less with the shield up), a hit heals both
const life = { you: 100, town: 100, over: false };
hudUI.setLife(100, 100);
hudUI.setShield(0);

function applyStage() {
  if (defend) { const lanes = new Set(song().notes.map((n) => n.lane)); for (let i = 0; i < 6; i++) stage3d.setDrumVisible(i, lanes.has(KEYMAP_BY_IDX[i] && KEYMAP_BY_IDX[i].ln.name)); }
  else for (let i = 0; i < 6; i++) stage3d.setDrumVisible(i, isShown(song(), stageIdx, i));
  stage3d.setStation(isMelody() ? partMode() : "drums");   // bass: turn right, treble: turn left
  if (audioStarted) updateBackLevels();                      // the sections' background music follows progress
  stageMessage();
  if (audioStarted) joinBacking();   // a finished instrument's left-out notes join in
}

// the standing instruction for where you are in the song
function stageMessage() {
  if (defend) {
    if (defend.done) { hudUI.setPart(`${song().name} done`); return; }
    const sec = defend.section, pct = Math.round(defend.progress(sec) * 100);
    hudUI.setPart(`${song().name} · ${sec} ${pct}%`);
    const how = sec === "drums" ? (IS_TOUCH ? "tap the drums" : "the drum keys") : IS_TOUCH ? "tap the bars"
      : padConnected ? "D-pad + X A B Y · hold LT for the top row" : "A S D F G H J K · top row Q W E R T Y U I";
    const rule = RUN.lock === 1 ? "every arrow you hit locks" : RUN.lock === Infinity ? "hit them ALL, in order, to lock the section" : `hit the next ${RUN.lock}, in order, to lock them`;
    hudUI.say(`${sec === "drums" ? "Drums" : sec === "bass" ? "Bass — turned right" : "Treble — turned left"}: ${how} — ${rule}`);
    return;
  }
  if (bell && bell.state !== "idle") return;   // the bell's own messages win while it works
  hudUI.setPart(songDone() ? (lastRound() ? "Free play" : `${song().name} done`)
    : `${song().name} · ${song().parts[stageIdx].label} of ${song().parts.length}`);
  if (songDone() && !lastRound()) {
    hudUI.say(`${song().name} complete!`, "good");
  } else if (songDone()) {
    hudUI.say("Song complete! Play anything — ring the bell 🔔 to add a measure", "good");
  } else {
    const m = partMode(), bars = partBars();
    const take = bars > 1 ? ` (${bars}-bar take)` : "";
    if (m !== "drums") {
      const where = m === "bass" ? "Bass — turned right" : "Treble — turned left";
      const how = IS_TOUCH ? "tap the bars" : padConnected ? "D-pad + X A B Y · hold LT for the top row" : "keys A S D F G H J K · top row Q W E R T Y U I";
      hudUI.say(`${where}: ${how}${take}. Got it? Ring the bell 🔔 ${padConnected ? "(Menu)" : IS_TOUCH ? "" : "(Space)"}`);
    } else {
      hudUI.say(IS_TOUCH ? "Follow the arrows — tap the drums. Got it? Tap the bell 🔔"
        : "Follow the arrows. Got it? Ring the bell 🔔 (Space)");
    }
  }
}

function ringBell() {
  if (defend) return;   // no bell in the core loop: the game is always listening
  if (!bell || !ctx) { hudUI.say("Press Start first", "bad", 1500); return; }
  if (bell.state !== "idle") return;
  bell.ring(ctx.getOutputTimestamp().contextTime, partBars());
  hudUI.setBellState("armed");
  hudUI.say("Get ready — recording starts on the next bar…");
}

// THE CORE LOOP, every frame: an offered note whose moment went by unhit is a
// miss (hurts you and the town); then whatever the engine reports happens
function tickDefend(heardNow) {
  if (!defend || life.over) return;
  const loop = 4 * song().bars * clock.beatDur, box = judgeDiff().window;
  // where the song is, and the lead, for picking Easy's next note (it comes just after the lead)
  defend.nowBeat = (((heardNow - clock.first) / clock.beatDur) % defend.loopBeats + defend.loopBeats) % defend.loopBeats;
  defend.leadBeats = leadFor() / clock.beatDur;
  if (!defend.done) for (const n of defend.offered()) {
    if (!offeredAt.has(n.id)) offeredAt.set(n.id, heardNow);
    const k = Math.floor((heardNow - box - clock.first - n.beat * clock.beatDur) / loop);
    const t = clock.first + k * loop + n.beat * clock.beatDur;
    if (t < defendFrom || heardNow < t + box) continue;
    // only once its lead is over and its arrow had time to fly in (fair: nothing unannounced counts)
    if (t < readyAt(n.id)) continue;
    const key = n.id + "@" + k;
    if (occDone.has(key)) continue;
    occDone.add(key);
    defend.miss(n.id);
    offeredAt.delete(n.id);   // if it's offered again later, it gets a fresh lead
  }
  // the targets of what's offered glow "coming up"
  // ...over the last few BEATS before its note (owner: in the song's timing), throbbing on each beat
  const lv = {};
  if (!defend.done) for (const n of defend.offered()) {
    const i = LANE_INDEX[n.lane];
    if (i == null) continue;
    const from = Math.max(readyAt(n.id), heardNow - box);
    const k = Math.ceil((from - clock.first - n.beat * clock.beatDur) / loop);
    const tNext = clock.first + k * loop + n.beat * clock.beatDur;   // its next moment that counts
    lv[i] = Math.max(lv[i] || 0, Math.min(1, Math.max(0, 1 - (tNext - heardNow) / stage3d.cueSpan())));   // over the cue's beats (2, or 4 when fast)
  }
  stage3d.setPending(lv);
  defendEvents();
}
// the dome: each section's part shimmers as it's built and stands once it's up
function showShield() {
  const part = (name) => ({ progress: defend.partProgress(name === "drums" ? "drums" : name + " bottom"), up: defend.shield().includes(name === "drums" ? "drums" : name + " bottom") });
  stage3d.setShield({ drums: part("drums"), bass: part("bass"), treble: part("treble") });
}
const isGun = (lane) => /^(bass|treble) \d+$/.test(lane);   // every bar is a gun now: cannons on top, mortars below
function defendEvents() {
  const L = LIFE[RUN.damage] || LIFE.normal;
  for (const e of defend.drain()) {
    if (e.type === "miss") {
      // a part that's up catches the arrow (the town takes less, see townDamage)
      const sec = e.note.lane.startsWith("bass") ? "bass" : e.note.lane.startsWith("treble") ? "treble" : "drums";
      if (LANE_INDEX[e.note.lane] != null) stage3d.shieldHit(sec, LANE_INDEX[e.note.lane]);
      life.you -= L.miss;
      life.town -= townDamage(L.miss, defend.shield().length);
      const idx = LANE_INDEX[e.note.lane], p = idx != null && stage3d.drumScreen(idx);
      if (p) showStamp("MISS", p.x, p.y, { size: 26, color: "#ff7a5a", ms: 800 });
    } else if (e.type === "lock") {
      // locked notes join the band: they play every pass from the next one on
      const loop = 4 * song().bars * clock.beatDur, k = Math.floor((ctx.currentTime - clock.first) / loop);
      loops.add({ bars: song().bars, startBar: (k + 1) * song().bars,
        hits: e.notes.map((n) => { const h = e.hits.find((x) => x.id === n.id) || {}; return { lane: n.lane, pos: n.beat * clock.beatDur + (autoCorrect ? 0 : h.offset || 0), velocity: h.velocity ?? 0.9, midi: n.midi }; }) });
      const last = e.notes[e.notes.length - 1], idx = LANE_INDEX[last.lane], p = idx != null && stage3d.drumScreen(idx);
      if (p) showStamp("LOCKED!", p.x, p.y - 30, { size: e.notes.length > 1 ? 56 : 40, ms: 1600 });
      showShield();
      stageMessage();
    } else if (e.type === "progress") {
      hudUI.say(`${e.hit} / ${e.of} — keep going, in order`, "good", 1200);
    } else if (e.type === "chunkFail") {
      hudUI.say(`Broke the run (${e.why}) — those come round again`, "bad", 1600);
    } else if (e.type === "shield") {
      hudUI.setShield(e.up);
      hudUI.say(`🛡 Shield ${e.up}/3 up — the town takes ${Math.round((e.up / 3) * 100)}% less`, "good", 2600);
    } else if (e.type === "sectionDone") {
      applyStage();   // turn to the next station
      updateBackLevels();
    }
  }
  life.you = Math.max(0, Math.min(100, life.you)); life.town = Math.max(0, Math.min(100, life.town));
  hudUI.setLife(life.you, life.town);
  if (!life.over && (life.you <= 0 || life.town <= 0)) failRun(life.you <= 0 ? "You fell" : "The town fell");
  else if (!life.over && defend.done) { life.over = true; setTimeout(endRound, 1600); }
}
function failRun(why) {
  life.over = true;
  hudUI.say(`${why}…`, "bad", 4000);
  setTimeout(() => results.show({
    round: song().name, title: why, stats: gradeRound(roundOffsets, judgeDiff().window), last: false, failed: true,
    run: { name: PRESET_NAMES[presetOf(RUN)], mult: scoreMultiplier(RUN).total },
    onNext: () => { try { sessionStorage.setItem("gr.menuAt", "setup"); } catch { /* menu from the top */ } location.reload(); },
    onMenu: () => { try { sessionStorage.setItem("gr.menuAt", "levels"); } catch { /* fine */ } location.reload(); },
  }), 1400);
}

// called every frame: has a recorded measure finished?
function tickBell(heardNow) {
  if (!bell) return;
  const free = mode === "free" || songDone();
  const r = bell.tick(heardNow, { part: currentPart(), diff: judgeDiff(), free });
  hudUI.setBellState(bell.state);
  if (bell.state === "recording" && !r) hudUI.say("● Recording this measure…");
  if (!r) return;
  if (r.locked) {
    // a bar-by-bar step (Easy): it was learned as a 1-bar loop; it plays in ITS bar of the song
    const placed = partObj();
    if (placed && placed.atBar != null) {
      const L = placed.phraseBars, barDur = 4 * clock.beatDur;
      r.layer = { bars: L, startBar: Math.ceil(r.layer.startBar / L) * L,
        hits: r.layer.hits.map((h) => ({ ...h, pos: h.pos + placed.atBar * barDur })) };
    }
    loops.add(r.layer);
    // the scheduler may already be past this loop's first notes (it looks
    // 0.1 s ahead) — schedule the new layer's notes up to that point now
    if (ctx && pool) {
      const one = new Loops(4 * clock.beatDur); one.add(r.layer);
      for (const e of one.events(ctx.currentTime, scheduledUntil, clock.first)) {
        const entry = KEYMAP_BY_LANE[e.lane];
        if (!entry) continue;
        pool.noteOn({ channel: entry.idx + 40, midi: 60, baseNote: 60, ...laneSound(entry.ln, e.midi),
          velocity: e.velocity * 0.85, when: e.time });
      }
    }
    const wasGuided = !songDone();
    if (wasGuided) stageIdx++;
    applyStage();
    hudUI.say(`Locked in! ✨ (${r.judge.matched}/${r.judge.total})`, "good");
    showLocked();   // the big slam
    setTimeout(stageMessage, 2500);   // then back to the standing instruction (it used to go blank)
    if (wasGuided && songDone()) setTimeout(endRound, 1600);   // the band plays the full song a moment, then the grade
  } else {
    hudUI.say(`Not quite (${r.judge.matched}/${r.judge.total}) — keep playing, it's still listening`, "bad");
  }
}
applyStage();

// end of a round: the grade, then the next round in the same arena (fresh song,
// fresh loops); after the last round, free play
function endRound() {
  const stats = gradeRound(roundOffsets, judgeDiff().window);
  // finishing a level unlocks the next
  try { if (unlockedLevel() < roundIdx + 1) localStorage.setItem(UNLOCKED_KEY, roundIdx + 1); } catch { /* not remembered */ }
  const toMenu = (where, level) => {
    try { sessionStorage.setItem("gr.menuAt", where); if (level != null) localStorage.setItem("gr.level", level); } catch { /* menu from the top */ }
    location.reload();   // a fresh run: its own tempo and settings
  };
  results.show({
    round: song().name, title: song().title, stats, last: lastRound(),
    run: { name: PRESET_NAMES[presetOf(RUN)], mult: scoreMultiplier(RUN).total },
    onNext: () => { if (lastRound()) { stageMessage(); return; } toMenu("setup", roundIdx + 1); },
    onMenu: () => toMenu("levels"),
  });
}

let ctx = null;
let masterGain = null;
let mixer = null;          // the mixing desk: lane strips, drum bus, reverb, limiter
let drums = null;
let pool = null;
let clock = null;

// --- timing chart ---------------------------------------------------------
let offsets = [];          // every press offset (ms), after calibration
let flashes = [];          // lane-segment flashes: { idx, kind, until }

// --- drum-mode lane map ----------------------------------------------------
// key -> { lane index (0..5), lane } built once from the layout.
const KEYMAP = {};
{
  let idx = 0;
  for (const ln of [...LAYOUT.top, ...LAYOUT.bottom]) {
    KEYMAP[ln.key] = { idx: idx++, ln };
  }
}
// lane NAME -> entry (ghost events carry lane names)
const KEYMAP_BY_LANE = {};
for (const e of Object.values(KEYMAP)) KEYMAP_BY_LANE[e.ln.name] = e;
// the 16 melody bars as lanes: "bass 1".."bass 8", "treble 1".."treble 8"
// bottom row A S D F G H J K = bars 1-8, top row Q W E R T Y U I = bars 9-16
const MELODY_LETTERS = [..."ASDFGHJK", ..."QWERTYUI"];
const MELODY_KEYS = Object.fromEntries(MELODY_LETTERS.map((c, i) => [c.toLowerCase(), i]));
// the pad: the same 8 buttons for both rows (hold LT = top row); drawn as D-pad arrows / face letters
// the pad (owner, 2026-10-03): D-pad = the mortars, X A B Y = the cannons, each button on two neighbours
const PAD_LABELS = [..."dL dL dD dD dR dR dU dU X X A A B B Y Y".split(" ")];
const MELODY_ENTRY = { bass: [], treble: [] };
for (const kind of ["bass", "treble"]) {
  for (let slot = 0; slot < BARS; slot++) {
    const name = `${kind} ${slot + 1}`;
    const e = { idx: 6 + (kind === "treble" ? BARS : 0) + slot, ln: { name, key: MELODY_LETTERS[slot].toLowerCase(), kind, slot } };
    KEYMAP_BY_LANE[name] = e;
    MELODY_ENTRY[kind][slot] = e;
  }
}
// the melody voices, built for the current round's key + scale
let melodyVoices = { bass: [], treble: [] };
let lastUp = [];   // this frame's upcoming notes: a pad button on two guns picks the one that's due
async function buildMelodyVoices() {
  if (!ctx) return;
  const { key = "C", scale = "major" } = song();
  const [b, t] = await Promise.all([
    makeMelodyVoices(ctx.sampleRate, instrumentNotes({ key, scale, octave: BASS_OCTAVE, count: BARS }), "bass"),
    makeMelodyVoices(ctx.sampleRate, instrumentNotes({ key, scale, octave: TREBLE_OCTAVE, count: BARS }), "treble"),
  ]);
  melodyVoices = { bass: b, treble: t };
}
// one place that knows where a lane's sound comes from and where it goes:
// the round's own sample (from Hackbeat) at the note it was written on —
// pitched exactly like Hackbeat (note 60 = as recorded) — else the built-in sound
const sampleCache = new Map();   // sample path -> AudioBuffer (null = failed to load)
async function loadRoundSamples() {
  if (!ctx) return;
  const paths = [...new Set([...Object.values(song().sounds || {}).map((x) => x.path),
    ...Object.values(song().back || {}).flat().map((e) => e.path)])].filter((p) => !sampleCache.has(p));
  await Promise.all(paths.map(async (p) => {
    try {
      const r = await fetch("/rounds/samples/" + p);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      sampleCache.set(p, await ctx.decodeAudioData(await r.arrayBuffer()));
    } catch (e) { sampleCache.set(p, null); console.warn(`sample ${p} failed: ${e}`); }
  }));
  if (BAKE) await bakeRound();   // phones: each track's sound through its effects, once
  if (mixer && song().tracks) mixer.setHackbeatMix(song().masterVol, song().tracks.length);   // Hackbeat's own master + headroom
  prepareBackBuffers();   // stretch the background recordings to the game's tempo now, not mid-song
}

// --- PHONES: baked sounds instead of live effect chains (bake.js) ----------
const BAKE = IS_TOUCH;
const bakedCache = new Map();   // "path|track" -> the sample through that track's effects
const baked = (path, track) => bakedCache.get(path + "|" + track) || null;
async function bakeRound() {
  const s = song();
  if (!s.tracks) return;
  const jobs = new Map();
  const backPaths = new Set(Object.values(s.back || {}).flat().map((e) => e.path + "|" + e.track));
  for (const x of [...Object.values(s.sounds || {}), ...Object.values(s.back || {}).flat()]) {
    if (x.track == null || !s.tracks[x.track]) continue;
    const key = x.path + "|" + x.track, buf = sampleCache.get(x.path);
    // a background loop keeps its exact length (its tail wraps round)
    if (buf && !bakedCache.has(key) && !jobs.has(key)) jobs.set(key, bakeThroughTrack(buf, s.tracks[x.track].fx, HB_CHAIN, { loop: backPaths.has(key) }).then((b) => bakedCache.set(key, b)));
  }
  const t0 = performance.now();
  await Promise.all(jobs.values());
  bootlog("baked", { sounds: jobs.size, ms: Math.round(performance.now() - t0) });
}
// one shared reverb + echo for every baked track (phones: not one per track / section)
let phoneBus = null, phoneBusSong = null;
const backSends = {};   // section -> {reverbIn, delayIn}: the background's sends, following its section fade
function sharedSends(section) {
  const s = song();
  if (!phoneBus || phoneBusSong !== s) {
    phoneBus = HB_CHAIN.buildSendBuses(ctx, mixer.hackbeat);
    phoneBus.setReverb(s.fxBus.reverbDecay);
    phoneBus.setDelay(s.fxBus.delayTime, s.fxBus.delayFb);
    phoneBusSong = s;
    for (const k of Object.keys(backSends)) delete backSends[k];
  }
  if (!section) return phoneBus;
  if (!backSends[section]) {
    const level = backGain[section] ? backGain[section].gain.value : 1;
    const r = ctx.createGain(), d = ctx.createGain();
    r.gain.value = d.gain.value = level;
    r.connect(phoneBus.reverbIn); d.connect(phoneBus.delayIn);
    backSends[section] = { reverbIn: r, delayIn: d };
  }
  return backSends[section];
}
let liteTracks = null;
function phoneTrack(track, dest, destKey, section) {
  const s = song();
  if (track == null || !s.tracks || !s.tracks[track] || !ctx) return null;
  if (!liteTracks || liteTracks.song !== s) liteTracks = { song: s, map: new Map() };
  const key = track + "|" + destKey;
  if (!liteTracks.map.has(key)) {
    const fx = s.tracks[track].fx;
    liteTracks.map.set(key, liteTrack(ctx, dest, fx, sendsAny(fx) ? sharedSends(section) : null));
  }
  return liteTracks.map.get(key);
}
// the BACK tracks are recordings at the song's Hackbeat tempo: stretched (pitch
// kept) to the game's tempo, once per round (owner, 2026-10-03)
const backCache = new Map();   // "path@factor" -> stretched AudioBuffer
function backFactor() { const b = song().bpm; return b ? b / BPM : 1; }
function backBuffer(path, track) {
  const buf = (BAKE && baked(path, track)) || sampleCache.get(path);
  if (!buf) return null;
  const f = backFactor();
  if (Math.abs(f - 1) < 1e-3) return buf;
  const key = path + "|" + (BAKE ? track : "") + "@" + f.toFixed(4);
  if (!backCache.has(key)) backCache.set(key, stretchBuffer(ctx, buf, f));
  return backCache.get(key);
}
function prepareBackBuffers() {
  for (const e of Object.values(song().back || {}).flat()) backBuffer(e.path, e.track);
}
/* What a lane plays and where it goes. A round's own sample plays through
   its Hackbeat track's chain (the effects set on that track in Hackbeat);
   the built-in sounds go through the game's lane strips. */
//   midi: the note to sound — the chart note's pitch AS WRITTEN (octave and all);
//   without one (a hit with no note near it), the bar's own note.
// A Hackbeat track is ONE voice, like in Hackbeat: its channel is the track's,
// and a new note cuts the last (mono). Timing sets the volume, never the tone.
function laneSound(ln, midi) {
  const s = song().sounds && song().sounds[ln.name];
  const buf = s && sampleCache.get(s.path);
  const hb = buf ? { midi: midi ?? s.note, baseNote: 60, channel: 200 + (s.track ?? 0), mono: true, settings: hbVoice(s.voice) } : null;
  if (buf && BAKE) {   // phones: the baked sound, through a lite track (shared reverb / echo)
    return { ...hb, buffer: baked(s.path, s.track) || buf, destination: phoneTrack(s.track, mixer.hackbeat, "hits", null) || laneDest(ln) };
  }
  if (buf) return { ...hb, buffer: buf, destination: hbTrack(s.track, mixer.hackbeat, "hits") || laneDest(ln) };
  return { buffer: ln.kind ? melodyVoices[ln.kind][ln.slot] : drums[ln.drum], midi: 60, baseNote: 60, destination: laneDest(ln), settings: hbVoice(null) };
}
/* a slot's shaped INSTRUMENT VOICE from Hackbeat, else a plain one-shot */
// PLAIN: Hackbeat's own playback — the sample as recorded, no tone filter,
// a 12 ms fade when the next note cuts it (Hackbeat's DECLICK)
const PLAIN_VOICE = { attack: 0.001, hold: 0, decay: 0, sustain: 1, release: 0.012, cutoff: 1, reso: 0, velToCutoff: 0, glide: 0, pan: 0, gain: 1, loop: false };
function hbVoice(voice) {
  return voiceSettings({ voice: voice && voiceShaped({ voice }) ? voice : PLAIN_VOICE });
}
const laneDest = (ln) => mixer.lane(ln.kind || ln.name);

/* Hackbeat track chains for the current round, built on first use: one per
   (track, destination) — the back tracks have their own section faders. */
let hbChains = null;
function hbTrack(track, dest, destKey) {
  const s = song();
  if (track == null || !s.tracks || !s.tracks[track] || !ctx) return null;
  if (!hbChains || hbChains.song !== s) hbChains = { song: s, chains: new Map(), buses: new Map() };
  const key = track + "|" + destKey;
  if (!hbChains.chains.has(key)) {
    // a reverb / echo bus only where a track actually sends to one: a convolver
    // runs flat out even when nothing reaches it (the heaviest node there is)
    const fx = s.tracks[track].fx, sends = (fx.reverb && fx.reverb.on) || (fx.delay && fx.delay.on);
    let buses = sends ? hbChains.buses.get(destKey) : null;
    if (sends && !buses) {
      buses = HB_CHAIN.buildSendBuses(ctx, dest);
      buses.setReverb(s.fxBus.reverbDecay);
      buses.setDelay(s.fxBus.delayTime, s.fxBus.delayFb);
      hbChains.buses.set(destKey, buses);
    }
    const chain = HB_CHAIN.buildChain(ctx, dest, buses);
    chain.update(s.tracks[track].fx, true);
    hbChains.chains.set(key, chain);
  }
  return hbChains.chains.get(key).input;
}

// --- calibration ----------------------------------------------------------
let calibration = loadCalib();   // seconds, subtracted from every press time
let calib = null;                // active session: { hits: number[] }

// --- freestyle mode ---------------------------------------------------------
// "drum" = chart + timing judgement, as before. "free" = no chart notes, no
// timing judgement, no timing-chart entries: every lane press plays its drum
// immediately at velocity 1.0. Metronome click and ghost loops keep working
// exactly as in drum mode (presses are still recorded into ghosts).
let mode = "drum";
let session = null;

function loadCalib() {
  try {
    const v = parseFloat(localStorage.getItem(CALIB_KEY));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function makeCalibrateButton() {
  const btn = document.createElement("button");
  btn.textContent = "Calibrate";
  btn.style.cssText =
    "position:fixed;bottom:24px;left:8px;z-index:21;font:13px monospace;" +
    "padding:6px 14px;background:#131;color:#fc6;border:1px solid #fc6;cursor:pointer";
  btn.addEventListener("click", () => {
    if (!clock || calib) return;
    calib = { hits: [] };
    offsets = [];
  });
  document.body.appendChild(btn);
  return btn;
}

function makeStartButton() {
  const btn = document.createElement("button");
  btn.textContent = "Start";
  btn.style.cssText =
    "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:21;font:22px system-ui;border-radius:12px;" +
    "padding:18px 48px;background:#2a1606;color:#ffd27a;border:2px solid #ffb84a;cursor:pointer;box-shadow:0 0 30px rgba(255,170,60,.45)";
  btn.addEventListener("click", async () => {
    bootlog("start tapped");
    if (ctx) return;
    // phones / tablets: a bigger audio buffer — the tiny default crackles on
    // Android whenever the audio work spikes (owner, 2026-10-03). The press
    // timing reads the real output clock, so the added delay is allowed for.
    ctx = new AudioContext(IS_TOUCH ? { latencyHint: "playback" } : {});
    await ctx.resume();
    bootlog("audio", { rate: ctx.sampleRate, base: +(ctx.baseLatency || 0).toFixed(4), out: +(ctx.outputLatency || 0).toFixed(4), hint: IS_TOUCH ? "playback" : "interactive" });
    mixer = createMixer(ctx, { light: IS_TOUCH });
    for (const k of ["master", "hits", "metronome"]) mixer.setVolume(k, SET[k]);
    masterGain = mixer.master;

    drums = await makeDrums(ctx.sampleRate);
    await roundsReady;
    BPM = Math.round((song().bpm || 80) * RUN.tempo * 10) / 10;   // the song's own tempo x the run's tempo
    bootlog("run", { hitbox: RUN.hitbox, tempo: RUN.tempo, patterns: RUN.patterns, lockSize: RUN.lock === Infinity ? "all" : RUN.lock, damage: RUN.damage, bpm: BPM, mult: scoreMultiplier(RUN).total });
    await buildMelodyVoices();   // fallback bar voices
    await loadRoundSamples();    // the round's own sounds (from Hackbeat)
    pool = new VoicePool(ctx, { max: IS_TOUCH ? 12 : 24 });   // phones: fewer voices at once (crackle when busy)

    clock = startClock(ctx, {
      bpm: BPM,
      onBeat: (time, n) => {
        const active = bell && bell.state !== "idle";
        if (active) setTimeout(() => hudUI.tick(), Math.max(0, (time - ctx.currentTime) * 1000));
        pool.noteOn({
          channel: 0,
          midi: active ? 84 : 72,          // the bell ticks brighter while it counts / records
          baseNote: 60,
          buffer: drums.click,
          velocity: active ? 0.9 : 0.35,
          when: time,
          destination: mixer.metronome,
          settings: voiceSettings({ voice: VOICE_PRESETS["One shot"] }),
        });
      },
    });

    bell = new Bell({ first: clock.first, beatDur: clock.beatDur });
    loops = new Loops(4 * clock.beatDur);
    ghosts = loops;   // the scheduler below replays loop layers
    addBacking();
    defend = new Defend({ notes: song().playNotes || song().notes, bars: song().bars }, { lockSize: RUN.lock, beatDur: clock.beatDur });
    stage3d.setBeat(clock.first, clock.beatDur);   // the cues count in on the song's beat
    defendFrom = clock.first + Math.ceil((ctx.currentTime + 1.5 - clock.first) / (4 * clock.beatDur)) * 4 * clock.beatDur;   // misses count from the next bar after a breath
    hudUI.hideBell();
    defend.nowBeat = (((ctx.currentTime - clock.first) / clock.beatDur) % defend.loopBeats + defend.loopBeats) % defend.loopBeats;
    defend.leadBeats = leadFor() / clock.beatDur;   // so even the first note comes just after its lead
    defend.drain();
    session = new SessionLog({
      bpm: BPM,
      loopBeats: CHART.loopBeats,
      layout: LAYOUT,
    });
    scheduledUntil = clock.first;
    setInterval(scheduleGhosts, 25);
    makeBackBus();
    setInterval(scheduleBack, 25);
    audioStarted = true;
    applyStage();   // with the audio up: background levels, and Easy previews the first step

    btn.remove();
    hud.textContent = modeStr();
  });
  document.body.appendChild(btn);
  return btn;
}

// --- BACKGROUND MUSIC --------------------------------------------------------
// Each section's BACK track (Hackbeat: DRUM BACK / BASS BACK / TREBLE BACK)
// loops with the song, in time, on its own fader. It plays from the start,
// quiet but audible, grows as the section's steps lock, and is at FULL — the
// level set in Hackbeat — once the section is unlocked (owner, 2026-10-03).
// Full goes through the same stage as the Hackbeat tracks (mixer.hackbeat),
// so it sits in the mix exactly as it does in Hackbeat.
const backGain = {};
let backUntil = 0, backCh = 0;
function makeBackBus() {
  for (const m of ["drums", "bass", "treble"]) {
    const g = ctx.createGain();
    g.gain.value = backLevel(0);
    g.connect(mixer.hackbeat);
    backGain[m] = g;
  }
}
function scheduleBack() {
  if (!ctx || !clock || !pool || !backGain.drums || !song().back) return;
  const period = song().bars * 4 * clock.beatDur;
  const from = Math.max(backUntil, ctx.currentTime), until = ctx.currentTime + 0.15;
  for (const m of ["drums", "bass", "treble"]) {
    for (const e of song().back[m]) {
      const buf = backBuffer(e.path, e.track);   // stretched to the game's tempo, pitch kept (phones: baked first)
      if (!buf) continue;
      for (let k = Math.ceil((from - clock.first - e.beat * clock.beatDur) / period); ; k++) {
        const t = clock.first + k * period + e.beat * clock.beatDur;
        if (t >= until) break;
        if (t >= from) pool.noteOn({ channel: 300 + (e.track ?? (backCh++ % 24)), mono: true, midi: e.note, baseNote: 60, buffer: buf, velocity: e.vel, keep: true,
          when: t, destination: (BAKE ? phoneTrack(e.track, backGain[m], "back " + m, m) : hbTrack(e.track, backGain[m], "back " + m)) || backGain[m],
          settings: hbVoice(e.voice) });
      }
    }
  }
  backUntil = until;
}
function updateBackLevels() {
  if (!ctx || !backGain.drums) return;
  const prog = defend ? { drums: defend.progress("drums"), bass: defend.progress("bass"), treble: defend.progress("treble") } : sectionProgress(song().parts, stageIdx);
  for (const m of ["drums", "bass", "treble"]) {
    backGain[m].gain.setTargetAtTime(backLevel(prog[m]), ctx.currentTime, 1.2);
    // phones: the background's reverb / echo sends follow its fade too
    if (backSends[m]) for (const g of [backSends[m].reverbIn, backSends[m].delayIn]) g.gain.setTargetAtTime(backLevel(prog[m]), ctx.currentTime, 1.2);
  }
}

// --- LISTEN (hint) ---------------------------------------------------------
// Plays the parts of this section you HAVEN'T locked yet, once, as one loop
// (owner, 2026-10-03), from the next loop line — then the game carries on as
// normal. Each note sounds through its instrument, its target flashes and the
// ghost hands play it. (The locked parts are already playing as ghosts.)
let hint = null;   // { notes: [{laneIdx, time, velocity, flashed}], end }
function unlockedParts() {
  if (defend) return defend.done ? [] : [{ part: defend.unlocked(), bars: song().bars }];
  const mode = partMode();
  return song().parts.slice(stageIdx).filter((p) => p.mode === mode);
}
function playHint(only = null, label = null) {
  if (!ctx || !clock || !pool || !drums) { hudUI.say("Press Start first", "bad", 1500); return; }
  if (songDone()) { hudUI.say("Everything's locked in — nothing left to hear", "", 2000); return; }
  const parts = only || unlockedParts();   // only: just these steps (Easy's preview of a new step)
  const bars = Math.max(1, ...parts.map((p) => p.phraseBars || p.bars || 1));     // one loop that holds every part (a placed bar: its song phrase)
  const phrase = 4 * clock.beatDur * bars;
  const now = ctx.getOutputTimestamp().contextTime;
  const start = clock.first + Math.ceil((now + 0.15 - clock.first) / phrase) * phrase;
  hint = { notes: [], end: start + phrase };
  for (const p of parts) {
    const pb = p.bars || 1;
    for (let k = 0; k < bars / pb; k++) for (const n of p.part) {     // a short part repeats to fill the loop
      if (p.atBar != null && k > 0) break;                             // a placed bar plays once, in its own bar
      const entry = KEYMAP_BY_LANE[n.lane];
      if (!entry) continue;
      const time = start + (n.beat + (p.atBar != null ? 4 * p.atBar : 4 * pb * k)) * clock.beatDur;
      pool.noteOn({ channel: entry.idx + 70, midi: 60, baseNote: 60, ...laneSound(entry.ln, n.midi), velocity: 0.8,
        when: time });
      hint.notes.push({ laneIdx: entry.idx, time, velocity: 0.9, flashed: false });
    }
  }
  const left = parts.length;
  hudUI.say(label || `👂 Listen — what's left to learn here (${left} part${left > 1 ? "s" : ""}${bars > 1 ? `, ${bars} bars` : ""})`, "good", Math.max(2500, (start + phrase - now) * 1000));
}

// --- ghost loops -----------------------------------------------------------
// What was played in a pass replays as a ghost from the NEXT pass on, quieter
// than live play, on its own channels (laneIndex + 10) so live presses never
// cut a ghost. Recorded exactly as played — never snapped. G toggles.
let ghosts = null;
let ghostsOn = true;
let scheduledUntil = 0;

function scheduleGhosts() {
  if (!ghosts || !ctx || !pool || !ghostsOn) return;
  const until = ctx.currentTime + 0.1;
  const evs = ghosts.events(scheduledUntil, until, clock.first);
  for (const e of evs) {
    const entry = KEYMAP_BY_LANE[e.lane];
    if (!entry) continue;
    pool.noteOn({
      channel: entry.idx + 40,   // ghosts on their own channels: live play never cuts them
      midi: 60,
      baseNote: 60,
      ...laneSound(entry.ln, e.midi),
      velocity: e.velocity * 0.85,   // exactly as played, a touch under live play
      when: e.time,
    });
    if (defend && isGun(e.lane)) stage3d.fireCannon(entry.idx, e.time);   // the band's cannons fire on their notes
  }
  scheduledUntil = until;
}

// --- keydown ---------------------------------------------------------------
// Drum mode: each lane key plays that lane's drum IMMEDIATELY on its own
// channel; timing only changes loudness (velocityFor) — never delay or snap
// the sound. Calibration keeps its old F/Space taps against the metronome.
function onKey(e) {
  // start-up guard: drums, pool and clock must all exist before a press
  if (e.repeat || !ctx || !drums || !pool || !clock) return;

  // press time on the audio clock, from the event's own timestamp
  const ts = ctx.getOutputTimestamp();
  const press =
    ts.contextTime + (e.timeStamp - ts.performanceTime) / 1000 - calibration;

  if (e.key === "Tab") { e.preventDefault(); playHint(); return; }   // LISTEN to the whole section

  // at the bars: A S D F G H J K = bottom row (bars 1-8), Q W E R T Y U I = top row (9-16); Shift+letter = the shortcuts
  if (isMelody() && !e.shiftKey) {
    const slot = MELODY_KEYS[e.key.toLowerCase()];
    if (slot != null) {
      e.preventDefault();
      const entry = MELODY_ENTRY[partMode()][slot];
      hitLane(entry.idx, entry.ln, press, 1);
      return;
    }
  }

  if (e.shiftKey && e.key.toLowerCase() === "g") {
    e.preventDefault();
    ghostsOn = !ghostsOn;
    return;
  }

  if (e.shiftKey && e.key.toLowerCase() === "m") {
    e.preventDefault();
    mode = mode === "drum" ? "free" : "drum";
    if (clock) hud.textContent = modeStr();
    return;
  }

  if (e.shiftKey && e.key.toLowerCase() === "p") {
    e.preventDefault();
    saveSession();
    return;
  }

  if (e.key === " ") {
    e.preventDefault();
    ringBell();
    return;
  }

  if (e.shiftKey && e.key.toLowerCase() === "a") {   // auto-correct on/off
    e.preventDefault();
    autoCorrect = !autoCorrect;
    settingsUI.set("autoCorrect", autoCorrect);
    showDifficulty();
    hudUI.say(autoCorrect ? "Auto-correct ON — hits inside the box record on the beat" : "Auto-correct OFF — loops record exactly as played", "", 1800);
    return;
  }

  if (e.shiftKey && e.key.toLowerCase() === "h") {   // developer timing chart
    e.preventDefault();
    chart.style.display = chart.style.display === "block" ? "none" : "block";
    resize();
    return;
  }

  if (e.shiftKey && e.key.toLowerCase() === "f") {
    e.preventDefault();
    const j = nearestOnGrid(clock.first, clock.beatDur, press);
    const vel = velocityFor(j.offset);
    pool.noteOn({
      channel: 0,
      midi: 36,
      baseNote: 60,
      buffer: drums.kick,
      velocity: vel,
      when: ctx.currentTime,
      destination: mixer.lane("kick"),
      settings: voiceSettings({ voice: VOICE_PRESETS["One shot"] }),
    });
    recordPress(j.offset, vel, "kick", label(j.offset));
    return;
  }

  const entry = KEYMAP[e.key];
  if (!entry) return;   // keys outside the layout do nothing, HUD untouched
  e.preventDefault();
  hitLane(entry.idx, entry.ln, press, 1);
}

// ONE drum hit, from any input: keyboard, MIDI pad, game controller, VR stick.
// press = time on the heard audio clock; padVel = the input's own force (0..1,
// 1 for keys) — it scales the loudness on top of the timing.
// --- drum pads and game controllers -------------------------------------------
const pads = createPads({
  melodyMode: () => isMelody(),
  onHint: () => playHint(),
  onMelody: (slots, force, ts) => {
    if (!ctx || !drums || !pool || !clock) return;
    const o = ctx.getOutputTimestamp();
    const press = o.contextTime + (ts - o.performanceTime) / 1000 - calibration;
    // a button covers two guns: fire the one whose note is due nearest the press (else the first)
    const pick = (slot) => MELODY_ENTRY[partMode()][slot];
    let entry = pick(slots[0]), best = Infinity;
    for (const s of slots) for (const u of lastUp) if (u.laneIdx === pick(s).idx && Math.abs(u.time - press) < best) { best = Math.abs(u.time - press); entry = pick(s); }
    hitLane(entry.idx, entry.ln, press, force);
  },
  onHit: (laneName, force, ts) => {
    if (!ctx || !drums || !pool || !clock) return;
    const entry = KEYMAP_BY_LANE[laneName];
    if (!entry) return;
    // the device's own timestamp, on the heard audio clock (like a key press)
    const o = ctx.getOutputTimestamp();
    hitLane(entry.idx, entry.ln, o.contextTime + (ts - o.performanceTime) / 1000 - calibration, force);
  },
  onBell: () => ringBell(),
  onStatus: (st) => {
    // a controller in hand: the bars show its buttons instead of keyboard letters
    padConnected = st.pads.length > 0;
    for (const k of ["bass", "treble"]) stage3d.melodyStations[k].setLabels(padConnected ? PAD_LABELS : MELODY_LETTERS);
    stageMessage();
    const parts = [...st.midi.map((n) => "🥁 " + n), ...st.pads.map((n) => "🎮 " + n.split("(")[0].trim())];
    if (parts.length) hudUI.say("Connected: " + parts.join(" · "), "good", 3000);
  },
});

// --- VR: a stick tip entering a drumhead (force = stick speed) --------------
const KEYMAP_BY_IDX = [];
for (const e of Object.values(KEYMAP)) KEYMAP_BY_IDX[e.idx] = e;
for (const kind of ["bass", "treble"]) for (const e of MELODY_ENTRY[kind]) KEYMAP_BY_IDX[e.idx] = e;
stage3d.setVrHitHandler((idx, force, ms) => {
  if (!ctx || !drums || !pool || !clock) return;
  const entry = KEYMAP_BY_IDX[idx];
  if (!entry) return;
  const o = ctx.getOutputTimestamp();
  hitLane(entry.idx, entry.ln, o.contextTime + (ms - o.performanceTime) / 1000 - calibration, force);
});
stage3d.setVrBellHandler(() => ringBell());
stage3d.addVrButton();

function hitLane(idx, lane, press, padVel = 1) {

  // timing against this lane's chart notes, loop-wrapped
  const partBeats = currentPart().filter((n) => n.lane === lane.name).map((n) => n.beat);
  const j = partBeats.length
    ? nearestInLoop(partBeats, 4 * partBars(), clock.first, clock.beatDur, press)
    : null;
  // off-chart: no note nearby at all — play quietly, label OFF, stay out of the chart
  const free = mode === "free" || songDone() || !partBeats.length;   // not in this part: just play
  let vel, lab, off = false;
  if (free) {
    // freestyle: no judgement, no timing-chart entry — always full velocity
    vel = 0.9;
    lab = "FREE";
  } else {
    // off-chart: no note nearby at all — play quietly, label OFF, stay out of the chart
    off = !j || Math.abs(j.offset) > OFF_CHART;
    vel = off ? OFF_VEL : velocityFor(j.offset);   // off-chart: barely there (-30 dB)
    lab = off ? "OFF" : label(j.offset);
    roundOffsets.push(off ? null : j.offset);
  }
  vel *= padVel;   // a soft pad hit / a slow VR swing plays softer
  // the note it found sounds AS WRITTEN (octave and all); no note near it: the bar's own note
  const found = j && !off && !free ? currentPart().find((n) => n.lane === lane.name && Math.abs(n.beat - j.beat) < 1e-6) : null;
  const midi = found ? found.midi : undefined;
  if (defend && !life.over && !defend.done) {
    const box = judgeDiff().window, inBox = found && Math.abs(j.offset) <= box;
    const p = stage3d.drumScreen(idx);
    if (inBox) {
      const loop = 4 * song().bars * clock.beatDur;
      occDone.add(found.id + "@" + Math.round((j.time - clock.first - found.beat * clock.beatDur) / loop));   // this occurrence is hit, not a miss
      const r = defend.hit(found.id, { offset: j.offset, velocity: vel });
      if (isGun(lane.name)) stage3d.fireCannon(idx, ctx.getOutputTimestamp().contextTime);   // your cannon
      if (r !== "wrong") { const L = LIFE[RUN.damage] || LIFE.normal; life.you += L.heal; life.town += L.heal; }
      if (p) showStamp(Math.round(Math.max(0, 1 - Math.abs(j.offset) / box) * 100) + "%", p.x, p.y - 4, { size: 30, ms: 900 });
    } else {
      defend.stray();   // nothing offered there: breaks a run under way
      if (p && found) showStamp("0%", p.x, p.y - 4, { size: 26, color: "#ff9a7a", ms: 700 });
    }
    defendEvents();
  }
  if (window.__gr) (window.__gr.hits ||= []).push({ lane: lane.name, lab, force: +padVel.toFixed(2), vel: +vel.toFixed(3) });   // harness readout

  // record exactly as played (real timing, real velocity, mistakes and OFF
  // included) — it becomes this lane's ghost from the next pass on
  // AUTO-CORRECT (quantize): a hit inside the scoring box for its note is
  // RECORDED on the exact beat at full strength; the live sound still fired
  // the instant you hit. Outside the box it's recorded exactly as played.
  if (bell) bell.add({ lane: lane.name, midi, ...autoCorrectHit(press, vel, j, free) });

  // the player IS the instrument: play immediately, on this lane's channel
  pool.noteOn({
    channel: idx,
    midi: 60,
    baseNote: 60,
    ...laneSound(lane, midi),
    velocity: vel,
    when: ctx.currentTime,
  });

  // every press, both modes, lands in the session log
  if (session) session.add({
    lane: lane.name,
    drum: lane.drum,
    t: press,
    velocity: vel,
    mode,
    label: lab,
  });

  // the scene reacts: every press flashes the drum; judged presses also mark
  // the arrow they struck (HIT vanishes at once, NEAR sticks briefly)
  stage3d.press(idx, lab);
  stage3d.strike(idx, lab);   // the player's hand hits that drum, right now
  if (!free && !off) {
    stage3d.hit(idx, j.time, lab === "HIT" ? "HIT" : "NEAR", vel);   // vel = how close to the magic peak
  }

  recordPress(idx, free ? null : (off ? null : j.offset), vel, lane.name, lab);
}

// --- freestyle + save -------------------------------------------------------
function modeStr() {
  return `${mode === "free" ? "FREESTYLE" : "DRUM"}  [M] mode   [P] save`;
}

function saveSession() {
  if (!session || !clock) return;
  const data = session.toJSON(clock.first, { toData: () => ({ layers: loops ? loops._layers : [] }) });
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, "0");
  a.download =
    `garden-rhythm-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.json`;
  a.href = URL.createObjectURL(blob);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
  hud.textContent = `${modeStr()}   saved ${data.hits.length} hits`;
}

function recordPress(idx, offsetSec, vel, laneName, lab) {
  const ms = offsetSec == null ? null : offsetSec * 1000;
  flashes.push({
    idx,
    kind: lab === "HIT" ? "hit" : lab === "OFF" ? "off" : "miss",
    until: performance.now() + 120,
  });

  if (calib) {
    if (offsetSec != null) {
      calib.hits.push(offsetSec);
      if (calib.hits.length >= 16) {
        calibration = median(calib.hits);
        try { localStorage.setItem(CALIB_KEY, String(calibration)); } catch {}
        calib = null;
      }
    }
  } else if (offsetSec != null) {
    offsets.push(ms);
  }

  const ghostStr = ghosts
    ? `  loops: ${loops ? loops.count : 0} (${ghostsOn ? "on" : "off"}) [G]`
    : "";
  const modeStr2 = mode === "free"
    ? "  FREESTYLE"
    : "  DRUM";
  hud.textContent =
    `${laneName}  ${lab}${modeStr2}  ` +
    (ms == null
      ? "free"
      : `${ms >= 0 ? "+" : ""}${ms.toFixed(1)} ms  vel ${vel.toFixed(2)}`) +
    `  lat ${(ctx.outputLatency * 1000).toFixed(1)} ms  ` +
    `calib: ${calibration >= 0 ? "+" : ""}${(calibration * 1000).toFixed(1)} ms` +
    ghostStr;
}

// --- upcoming notes (the arrows) -------------------------------------------
// Every chart note for both rows within the next APPROACH window, as
// { laneIdx, time } on the audio clock. Freestyle passes nothing.
const APPROACH_S = 3.2;   // must match stage3d.js

function buildUpcoming(heardNow) {
  // arrows only for the part you're learning; none in free play
  if (mode === "free" || songDone()) return [];
  const part = (window.__gr && window.__gr.game && window.__gr.game.testPart) || currentPart();   // testPart: harness only
  if (defend) {
    // the engine: an arrow only for an occurrence after its note's lead time
    const loop = 4 * partBars() * clock.beatDur, out = [];
    for (const n of part) for (const a of partArrows([n], (x) => LANE_INDEX[x], clock.first, loop, clock.beatDur, heardNow - 0.6, heardNow + APPROACH_S)) {
      if (a.time >= readyAt(n.id)) out.push(a);
    }
    return out.sort((a, b) => a.time - b.time);
  }
  return partArrows(part, (n) => LANE_INDEX[n], clock.first, 4 * partBars() * clock.beatDur,
                    clock.beatDur, heardNow - 0.6, heardNow + APPROACH_S);
}

// --- timing chart (its own canvas) ------------------------------------------
const BIN_MS = 10, LO = -150, NBINS = 30;
const CHART_H = 120;   // CSS px height of the chart band

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function stddev(xs) {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length);
}

function drawChart() {
  const W = chart.clientWidth, H = chart.clientHeight;
  ctx2d.fillStyle = "rgba(10,14,18,0.9)";
  ctx2d.fillRect(0, 0, W, H);
  ctx2d.strokeStyle = "#223";
  ctx2d.strokeRect(0.5, 0.5, W - 1, H - 1);

  if (!offsets.length) {
    ctx2d.fillStyle = "#456";
    ctx2d.font = "11px monospace";
    ctx2d.fillText("no presses yet", 8, 16);
    return;
  }

  const bins = new Array(NBINS).fill(0);
  for (const ms of offsets) {
    let i = Math.floor((ms - LO) / BIN_MS);
    if (i < 0) i = 0;
    if (i >= NBINS) i = NBINS - 1;   // clamp outside values into the end bins
    bins[i]++;
  }
  const max = Math.max(...bins);
  const bw = (W - 20) / NBINS;
  for (let i = 0; i < NBINS; i++) {
    const h = max ? (bins[i] / max) * (H - 24) : 0;
    ctx2d.fillStyle = "#2a6";
    ctx2d.fillRect(10 + i * bw, H - 4 - h, Math.max(1, bw - 1), h);
  }

  const m = mean(offsets), sd = stddev(offsets);
  ctx2d.fillStyle = "#8f8";
  ctx2d.font = "11px monospace";
  ctx2d.fillText(
    `n ${offsets.length}   mean ${m >= 0 ? "+" : ""}${m.toFixed(1)} ms   ` +
    `spread ${sd.toFixed(1)} ms`,
    10, 14,
  );
}

function resize() {
  stage3d.resize();
  const dpr = window.devicePixelRatio || 1;
  chart.width = Math.round(chart.clientWidth * dpr);
  chart.height = Math.round(chart.clientHeight * dpr);
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function frame() {
  if (clock && ctx) {
    const heardNow = ctx.getOutputTimestamp().contextTime;
    // loop hits around now, so each spirit stick can lift BEFORE its beat
    const ghostHits = (loops && ghostsOn)
      ? loops.events(heardNow - 0.3, heardNow + 0.6, clock.first)
          .map((e) => ({ laneIdx: LANE_INDEX[e.lane], time: e.time, velocity: e.velocity }))
      : [];
    // LISTEN: the ghost hands demonstrate the hint, and each note's target flashes as it sounds
    if (hint) {
      for (const n of hint.notes) {
        if (n.time > heardNow - 0.3 && n.time < heardNow + 0.6) ghostHits.push(n);
        if (!n.flashed && heardNow >= n.time) { n.flashed = true; stage3d.press(n.laneIdx, "HIT"); }
      }
      if (heardNow > hint.end + 0.4) hint = null;
    }
    // arrows for the drums; the guns get their own cues (a fuse, a falling shell) — arrows can't pass the shield
    const up = buildUpcoming(heardNow);
    lastUp = up;
    stage3d.setGunCues(defend ? up.filter((u) => u.laneIdx >= 6) : []);
    stage3d.update(heardNow, defend ? up.filter((u) => u.laneIdx < 6) : up, ghostHits);
    if (defend) tickDefend(heardNow); else tickBell(heardNow);
  } else {
    // before Start: keep the courtyard (and its drums) visible, no arrows
    stage3d.update(0, []);
  }
  pads.poll();
  // the mouse's nudge drifts back to centre once the mouse rests
  const tNow = performance.now();
  const mdt = Math.min(0.05, (tNow - mouseLook.tFrame) / 1000);
  mouseLook.tFrame = tNow;
  if (tNow - mouseLook.tMove > 150) {
    const d = Math.exp(-mdt * 1.6);
    mouseLook.x *= d; mouseLook.y *= d;
  }
  // look around: arrow keys + thumbsticks + mouse (VR ignores it: the head looks)
  const k = (key) => (lookKeys.has(key) ? 1 : 0);
  stage3d.setLookInput(k("ArrowRight") - k("ArrowLeft") + pads.look.x + mouseLook.x,
    k("ArrowUp") - k("ArrowDown") + pads.look.y + mouseLook.y);
  drawChart();
}

// arrow keys held = look around a little
const lookKeys = new Set();
window.addEventListener("keydown", (e) => { if (e.key.startsWith("Arrow")) { lookKeys.add(e.key); e.preventDefault(); } });

window.addEventListener("keyup", (e) => lookKeys.delete(e.key));
window.addEventListener("blur", () => lookKeys.clear());

// mouse look: moving the mouse nudges the view (~300 px = the full turn);
// when it rests, the view eases back to forward. The cursor stays free, and
// the settings panel / buttons never steer the camera.
const mouseLook = { x: 0, y: 0, tMove: 0, tFrame: performance.now() };
let lastTouch = -1e9;

// TOUCH / PEN / CLICK on the 3D view: hit the drum under the finger (any number
// of fingers at once). A finger that lands off the drums drags the view instead.
const drags = new Map();   // pointerId -> last x, y (look-around drags)
const recentTaps = [];     // dev log: where taps landed and which drum they picked
stage.style.touchAction = "none";
stage.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "touch") lastTouch = performance.now();
  // phone Easy: a tap snaps to the nearest target this step wants, from well off it
  // a big hitbox reaches in space too: a tap snaps to the nearest target this step wants
  const reach = RUN.hitbox >= 0.1 ? Math.round(40 + RUN.hitbox * 650) : 0;   // 0.14 -> 131 px, 0.25 -> 202 px
  const wanted = reach && !songDone() ? currentPart().map((n) => LANE_INDEX[n.lane]) : null;
  const lane = stage3d.pickDrum(e.clientX, e.clientY, wanted ? { prefer: wanted, reach } : undefined);
  recentTaps.push(`${Math.round(e.clientX)},${Math.round(e.clientY)}->${lane}`);
  if (recentTaps.length > 12) recentTaps.shift();
  if (lane < 0 || !ctx || !drums || !pool || !clock) {
    if (e.pointerType !== "mouse") { drags.set(e.pointerId, { x: e.clientX, y: e.clientY }); try { stage.setPointerCapture(e.pointerId); } catch { /* not a live pointer: the drag still works without capture */ } }
    return;
  }
  e.preventDefault();
  const entry = KEYMAP_BY_IDX[lane];
  // the touch's own timestamp, on the heard audio clock (like a key press)
  const o = ctx.getOutputTimestamp();
  const force = e.pointerType === "pen" && e.pressure > 0 ? 0.4 + 0.6 * e.pressure : 1;
  hitLane(entry.idx, entry.ln, o.contextTime + (e.timeStamp - o.performanceTime) / 1000 - calibration, force);
});
stage.addEventListener("pointermove", (e) => {
  const d = drags.get(e.pointerId);
  if (!d) return;
  if (e.pointerType === "touch") lastTouch = performance.now();
  mouseLook.x = Math.max(-1, Math.min(1, mouseLook.x + (e.clientX - d.x) / 250));
  mouseLook.y = Math.max(-1, Math.min(1, mouseLook.y - (e.clientY - d.y) / 250));
  mouseLook.tMove = performance.now();
  d.x = e.clientX; d.y = e.clientY;
});
for (const ev of ["pointerup", "pointercancel"]) stage.addEventListener(ev, (e) => drags.delete(e.pointerId));

// held upright on a phone/tablet: suggest turning it sideways (once per visit)
let toldRotate = false;
function maybeSuggestLandscape() {
  if (toldRotate || !IS_TOUCH || innerWidth >= innerHeight) return;
  toldRotate = true;
  hudUI.say("Turn sideways for the best view ↻", "good", 4000);
}
window.addEventListener("resize", maybeSuggestLandscape);
setTimeout(maybeSuggestLandscape, 1200);
window.addEventListener("mousemove", (e) => {
  if (e.target.closest && e.target.closest("#gr-set, button, input, select, a")) return;
  if (performance.now() - lastTouch < 800) return;   // phones fire fake mouse events after a tap: not a look
  mouseLook.x = Math.max(-1, Math.min(1, mouseLook.x + e.movementX / 300));
  mouseLook.y = Math.max(-1, Math.min(1, mouseLook.y - e.movementY / 300));
  mouseLook.tMove = performance.now();
});

const startBtn = makeStartButton();
// THE START MENU: level (unlocked ones) -> the run's settings -> Start
roundsReady.then(() => {
  const list = LESSONS || BASE_ROUNDS;
  let at = "title";
  try { at = sessionStorage.getItem("gr.menuAt") || "title"; sessionStorage.removeItem("gr.menuAt"); } catch { /* storage blocked: title */ }
  createMenu({
    levels: list.map((r) => ({ name: r.name, title: r.title, bpm: r.bpm })),
    unlocked: Math.min(unlockedLevel(), list.length - 1),
    level: +(localStorage.getItem("gr.level") || 0),
    run: RUN, startAt: at,
    onStart: (level, run) => {
      try { localStorage.setItem("gr.run", JSON.stringify({ ...run, lock: run.lock === Infinity ? "all" : run.lock })); localStorage.setItem("gr.level", level); } catch { /* not remembered */ }
      Object.assign(RUN, run);
      roundIdx = level;
      buildLessons();
      showDifficulty();
      startBtn.click();   // inside the menu's tap: the audio may start
    },
  });
});
makeCalibrateButton();
window.addEventListener("keydown", onKey);
resize();
window.addEventListener("resize", resize);
stage3d.setLoop(frame);
// test hook (the harness robot reads the song state through this)
if (window.__gr) window.__gr.game = {
  get clock() { return clock; }, get ctx() { return ctx; }, get bell() { return bell; },
  get stageIdx() { return stageIdx; }, get roundIdx() { return roundIdx; },
  setBackLevel: (v) => { for (const g of Object.values(backGain)) g.gain.value = v; },   // harness: backgrounds at full
  get defend() { return defend; }, get life() { return life; }, laneOf: (i) => KEYMAP_BY_IDX[i] && KEYMAP_BY_IDX[i].ln.name,
  get mixer() { return mixer; }, get pool() { return pool; }, laneSound: (ln, midi) => laneSound(ln, midi),
  backInfo: () => ({ bpm: BPM, songBpm: song().bpm, loopSeconds: +(song().bars * 4 * clock.beatDur).toFixed(3),
    stretched: [...backCache].map(([k, b]) => [k, +b.duration.toFixed(3)]) }),
  upcoming: () => (ctx ? buildUpcoming(ctx.getOutputTimestamp().contextTime) : []),
  part: () => currentPart(),
  song: () => song(),
  get hint() { return hint; },
  source: () => (LESSONS ? "files" : "built-in"),
  tier: TIER,
  backLevels: () => Object.fromEntries(Object.entries(backGain).map(([m, g]) => [m, +g.gain.value.toFixed(2)])),
  samples: () => [...sampleCache].map(([p, b]) => `${p}: ${b ? b.duration.toFixed(2) + " s" : "FAILED"}`), get calibration() { return calibration; }, get loops() { return loops; },
};   // screen or headset: the renderer drives the frames
