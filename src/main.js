/* main.js — Fortissimo (folder GardenRhythm) beat core.
   Start button -> AudioContext (created inside the click), drums rendered,
   metronome click scheduled ahead of the audio clock, instant kicks on lane
   keys with timing judged against the chart (known in advance), mapped to
   velocity. First-person 3D courtyard on canvas#stage: flaming arrows fly in
   on the audio clock (the arrows ARE the notes). The timing histogram lives on
   its own canvas#chart. A calibration mode removes the player's systematic
   offset. */

import "./audio/voices.js";
import { Conductor } from "./game/conductor.js";
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
import { Loops } from "./game/loops.js";
import { ROUNDS, partArrows, songOf } from "./game/stages.js";
import { loadRoundFiles } from "./game/roundfiles.js";
import { backLevel } from "./game/backing.js";
import { normalize, judgeFor, simplifyNotes, scoreMultiplier, levelOf, LEVELS } from "./game/run.js";
import { fillKit, kitPlan } from "./game/kit.js";
const runName = (r) => { const lv = levelOf(r); return lv ? `Level ${lv}` : "Custom"; };
import { createMenu } from "./ui/menu.js";
import { createLoading } from "./ui/loading.js";
import { initNative, wake, haptic } from "./app/native.js";
import { pickSounds } from "./ui/maker-ui.js";
import { createMode } from "./modes/create.js";
import { hydraMode } from "./modes/hydra.js";
import { Draft, draftToSong } from "./game/maker.js";
import { Defend, LIFE } from "./game/defend.js";
import { Siege, ARMY } from "./game/siege.js";
import { gradeRound } from "./game/grade.js";
import { createResults } from "./ui/results.js";
import { showStamp } from "./ui/locked.js";
import { createHud } from "./ui/hud.js";
import { createMixer } from "./audio/mixer.js";
import { loadSettings, createSettings } from "./ui/settings.js";
import { createPads } from "./input/pads.js";
import { bootlog } from "./bootlog.js";
import { migrate as migrateSave } from "./game/save.js";
migrateSave();   // an older save brought up to date before anything reads it
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
// gr.run2: the run settings since the ±250 ms hitbox (2026-10-03) — the old ones (gr.run) are left behind
// a NEW player (nothing saved) starts on Level 1 — single notes, slower (2026-10-07: "a gentler start")
const RUN = (() => { try { return normalize(JSON.parse(localStorage.getItem("gr.run2") || "null") || { ...LEVELS[0] }); } catch { return normalize({ ...LEVELS[0] }); } })();
let BPM = 80;   // set at Start: the song's own tempo x the run's tempo
// levels unlock one by one: finishing level N opens N + 1
const UNLOCKED_KEY = "gr.unlocked";
const unlockedLevel = () => { try { return +localStorage.getItem(UNLOCKED_KEY) || 0; } catch { return 0; } };

const CALIB_KEY = "gr.calib";

// --- drum colours (hex strings; shared by the 3D stage and the chart) ------
// every lane its OWN colour, strong and easy to tell apart (owner, 2026-10-03)
const DRUM_COLOR = {
  hat: "#3adcff", snare: "#ff4fa0", crash: "#a8ff3a",
  kick: "#9a5cff", tomLow: "#ffd23a", tomHigh: "#ff5a24",
};

// --- the 3D stage (created once at load; canvas#stage becomes WebGL) --------
// GRAPHICS LEVEL: high | medium | low | lowest. Settings can fix it; on Auto the
// game starts from a guess (touch screen -> medium) and MEASURES the frame rate
// after loading: too slow and it steps down a level and reloads, remembering the
// level for this device. ?quality=... in the URL forces one (mobile = medium).
const TIERS = ["high", "medium", "low", "lowest", "potato", "bare"];   // bare (10-09): no textures, flat colours, simplest light, no shadows
const urlQ = new URLSearchParams(location.search).get("quality");
const IS_TOUCH = window.matchMedia("(pointer: coarse)").matches || urlQ === "mobile";   // touch layout, separate from graphics
// THE PHONE VERSION (owner, 2026-10-09: "different versions for phone — it auto-detects and does the phone thing"): a phone ALWAYS runs
// the phone path (no full-screen effects, plain fountain, phone sea, small shadow maps…) whatever the graphics setting says; the
// setting only adjusts quality inside it. ?device=phone forces it (tests).
const PHONE = new URLSearchParams(location.search).get("device") === "phone"
  || (IS_TOUCH && (Math.min(screen.width, screen.height) < 600 || /Android|iPhone|iPod|Mobile/i.test(navigator.userAgent)));
const AUTO_GFX = !urlQ && (SET.quality || "auto") === "auto";
let savedTier = null;
try { savedTier = localStorage.getItem("gr.autoTier"); } catch { /* storage blocked: guess each time */ }
const TIER = urlQ === "mobile" ? "medium" : TIERS.includes(urlQ) ? urlQ
  : !AUTO_GFX && TIERS.includes(SET.quality) ? SET.quality
  : TIERS.includes(savedTier) ? savedTier : IS_TOUCH ? "medium" : "high";
let stage3d = null;   // built for the round once the songs are known (buildStage): its kit depends on the song
stage.addEventListener("webglcontextlost", () => bootlog("WEBGL CONTEXT LOST"));
// DEV PHOTO: ?shot=<seconds> posts the rendered canvas as a PNG to the dev sink on :8899
// (scratchpad/sink.py) that many seconds after load — headless --screenshot fires before
// the models arrive, this fires when I say. Harmless without the sink.
// &face=bass|treble turns to that station first (1.5 s for the turn), so the gun courts can be photographed too.
if (import.meta.env.DEV) { const sec = +new URLSearchParams(location.search).get("shot"), face = new URLSearchParams(location.search).get("face");
  const snap = () => { const c = stage.tagName === "CANVAS" ? stage : stage.querySelector("canvas");   // #stage is the canvas itself
    if (!c) { bootlog("shot", { error: "no canvas" }); return; }
    let png = ""; try { png = c.toDataURL("image/png"); } catch (e) { bootlog("shot", { error: String(e) }); return; }
    fetch(`http://127.0.0.1:8899/png/game-${face || "drums"}${new URLSearchParams(location.search).get("tag") ? "-" + new URLSearchParams(location.search).get("tag") : ""}`, { method: "POST", body: png })
      .then((r) => bootlog("shot", { face, bytes: png.length, sink: r.status }), (e) => bootlog("shot", { face, bytes: png.length, error: String(e) })); };
  if (sec > 0) setTimeout(() => { if (face && stage3d) { stage3d.setStation(face); setTimeout(snap, 1500); } else snap(); }, sec * 1000); }
// once running: a heartbeat with the frame rate, so a later crash shows when
{ let frames = 0; const tick = () => { frames++; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  setInterval(() => {
    const a = stage3d && stage3d.debugArrows ? stage3d.debugArrows() : {};
    bootlog("alive", { fps: Math.round(frames / 5), started: !!ctx,
      round: roundIdx + 1, wants: [...new Set(currentPart().map((n) => n.lane))],
      flying: a.flying, shown: a.shown && a.shown.map((v) => (v ? 1 : 0)).join(""), taps: recentTaps.splice(0) });
    frames = 0;
  }, 5000); }
if (IS_TOUCH) document.documentElement.classList.add("touch");   // touch layout (no keyboard hints)
const loading = createLoading();   // the loading screen (index.html) — lifted once the stage is built and the files have landed
{ const v = document.querySelector("#gr-loading .ver"); if (v) v.textContent = `v${typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev"}`; }
window.__gr = import.meta.env.DEV ? {} : null;   // debug handle for the browser harness (stage3d joins it when built) — never in a release

// --- the song: parts unlock two drums at a time; the ghost bell locks them ---
const BARS = 16;                          // per station: bottom row 1-8, top row 9-16 (owner, 2026-10-03)
const LANE_INDEX = {};                    // lane name -> target 0..37
[...LAYOUT.top, ...LAYOUT.bottom].forEach((ln, i) => { LANE_INDEX[ln.name] = i; });
// melody bars: "bass 1".."bass 16" -> 6..21, "treble 1".."treble 16" -> 22..37
for (let k = 0; k < BARS; k++) { LANE_INDEX[`bass ${k + 1}`] = 6 + k; LANE_INDEX[`treble ${k + 1}`] = 6 + BARS + k; }
let loops = null;                         // locked measures, replayed exactly as played
// 3 ROUNDS in the same arena; each ends with an accuracy grade
let roundIdx = 0;
// the songs: Hackbeat projects (public/rounds, or Hackbeat's own copies while
// developing); the built-in ROUNDS only if those can't be read. The run's
// pattern difficulty picks the notes you play; the rest goes to the backing (it still sounds)
let SONGS = ROUNDS.map(songOf), songsFromFiles = false;
// CREATE (the song-maker, owner 2026-10-07): the menu's Create screen picks the sounds and reloads into
// the arena with those picks (sessionStorage gr.create); ?create=1 = the default picks (harnesses).
// The arena then plays ONE blank song carrying every lane's sound, all guns built, no army, no chart.
let CREATE = (() => { try { const c = JSON.parse(sessionStorage.getItem("gr.create") || "null"); sessionStorage.removeItem("gr.create"); return c; } catch { return null; } })()
  || (new URLSearchParams(location.search).has("create") ? { world: "rome", title: "My level" } : null);
let BANKS = null, recorder = null;
// ROUND 4, THE HYDRA (2026-10-07): a level's round 4 — you conduct the music of its rounds 1-3 (one
// movement each) and fight the hydra (hydrafight.js). Entered from round 3's results or the level list:
// sessionStorage gr.hydra = { rounds: [i, j, k], title }; ?hydra=0,1,2 for harnesses.
let HYDRA = (() => {   // (10-09: let — round 3's boss can turn the page into round 4 in place: bigToDo) try { const h = JSON.parse(sessionStorage.getItem("gr.hydra") || "null"); sessionStorage.removeItem("gr.hydra"); if (h) return h; } catch { /* below */ }
  const q = new URLSearchParams(location.search).get("hydra"); return q ? { rounds: q.split(",").map(Number), title: "The Hydra" } : null; })();
/** the levels in the song list: Rome = the songs no made level owns (the first three), then each made level's three rounds */
function levelGroups(list) {
  const groups = [], rome = list.map((s, i) => (s.level ? -1 : i)).filter((i) => i >= 0).slice(0, 3);
  if (rome.length === 3) groups.push({ title: "Rome", rounds: rome });
  const made = new Map(); list.forEach((s, i) => { if (s.level) (made.get(s.level) || made.set(s.level, []).get(s.level)).push(i); });
  for (const [slug, idx] of made) if (idx.length === 3) groups.push({ title: (list[idx[0]].title || slug), rounds: idx });
  return groups;
}
function goHydra(group) {
  try { sessionStorage.setItem("gr.hydra", JSON.stringify({ rounds: group.rounds, title: group.title })); sessionStorage.setItem("gr.autostart", JSON.stringify({ ...RUN, lock: RUN.lock === Infinity ? "all" : RUN.lock })); } catch { /* the url below */ }
  location.href = location.pathname + (sessionStorage.getItem("gr.hydra") ? "" : `?hydra=${group.rounds.join(",")}`);
}
let LESSONS = null;
const judgeDiff = () => judgeFor(RUN);   // what a hit is judged by
const song = () => LESSONS[roundIdx];
const lastRound = () => roundIdx >= LESSONS.length - 1;
// THE BOSS STATION (owner, 2026-10-04): the song's top-row treble notes (bars 9-16) come DOWN onto the
// mortars of the same column (pitch kept) — the two crystals aren't song notes: the mortar fire CHARGES
// them, and you hit one when it's READY (THE LIGHTNING, below)
const toCrystals = (n) => { const m = /^treble (\d+)$/.exec(n.lane); if (!m || +m[1] < 9) return n; return { ...n, lane: `treble ${+m[1] - 8}` }; };
// FILL THE KIT (owner, 2026-10-04; kit.js): every empty drum / gun slot stands in for one of the
// song's busiest instruments in its group, playing that instrument's sound, the notes dealt round
const DRUM_LANES = [...LAYOUT.top, ...LAYOUT.bottom].map((l) => l.name);
const ROW_LANES = (kind, lo) => Array.from({ length: 8 }, (_, i) => `${kind} ${lo + i}`);
const KIT_GROUPS = [DRUM_LANES, ROW_LANES("bass", 1), ROW_LANES("bass", 9), ROW_LANES("treble", 1)];   // treble's top row is the crystals
const kitFor = (s) => (s._kit ||= fillKit(s.notes.map(toCrystals), KIT_GROUPS));   // the round's kit: computed once per song
function buildLessons() {
  LESSONS = SONGS.map((s) => {
    const { notes, aliases } = kitFor(s);
    const sounds = { ...(s.sounds || {}) };
    for (const [standIn, owner] of Object.entries(aliases)) if (sounds[owner]) sounds[standIn] = sounds[owner];   // a stand-in plays its owner's sample
    const { play, backing } = simplifyNotes(notes, RUN.patterns);
    bootlog("kit", { song: s.name, standIns: aliases });
    return { ...s, notes, sounds, aliases, playNotes: play, backingNotes: backing };
  });
}
buildLessons();
const roundsReady = (CREATE ? fetch(`/banks/${CREATE.world || "rome"}.json`).then((r) => r.json()).then((banks) => {
  BANKS = banks;
  for (const k of ["kit", "bass", "treble"]) CREATE[k] ||= (k === "kit" ? banks.drums : banks[k])[0].id;
  SONGS = [{ ...draftToSong(new Draft(CREATE), { name: "Create", title: CREATE.title || "My level", banks }), warnings: [] }];
  roundIdx = 0; buildLessons(); songsFromFiles = true;
  bootlog("create", { kit: CREATE.kit, bass: CREATE.bass, treble: CREATE.treble, mood: CREATE.mood, tempo: CREATE.tempo });
}) : loadRoundFiles().then((songs) => {
  if (!songs.length) return;
  SONGS = songs; songsFromFiles = true;
  buildLessons();
  if (typeof applyStage === "function") applyStage();
  bootlog("rounds from files", { n: songs.length, warnings: songs.flatMap((r) => r.warnings) });
})).catch((e) => { console.warn("round files unavailable — playing the built-in songs", e); bootlog("rounds: built-in", { why: String(e) }); });
// THE CORE LOOP (defend.js, owner 2026-10-04): the song's notes STREAM at you in song
// order, a few always in flight; a correct hit locks (by the run's keep rule). Before Start: nothing.
let defend = null;
let siege = null;                // the enemy: arrows always coming, the shield's life, the army (siege.js)
let waveSection = null;          // the section whose army is out
let defendFrom = 0;              // misses count from here (a breath after Start)
const songDone = () => !!defend && defend.done;
const currentPart = () => (defend ? defend.offered() : []);
const partObj = () => (defend && !defend.done ? { mode: defend.section, bars: song().bars, part: defend.offered() } : null);
const partBars = () => song().bars;   // the whole song is the loop
const partMode = () => (recorder ? recorder.part : (partObj() && partObj().mode) || "drums");       // "drums" | "bass" | "treble"
const isMelody = () => partMode() !== "drums";
let padConnected = false;   // a game controller is plugged in (the bars then show its buttons)
// the notes this run's pattern difficulty leaves out. NOTHING plays that you
// haven't played (owner, 2026-10-03: "random horns"): an instrument's left-out
// notes join only once that instrument is finished, as a locked loop.
let backingJoined = new Set();   // lanes whose left-out notes are already playing
function addBacking() { backingJoined = new Set(); joinBacking(); }   // a fresh round: nothing joined yet
function joinBacking() {
  const b = song().backingNotes;
  if (!loops || !clock || !defend || !b || !b.length) return;
  const done = new Set(b.filter((n) => defend.progress(n.lane.startsWith("bass") ? "bass" : n.lane.startsWith("treble") ? "treble" : "drums") >= 1).map((n) => n.lane));
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
const hudUI = createHud({ onHint: () => playHint() });
let autoCorrect = SET.autoCorrect;   // A toggles; also in settings
function showDifficulty() { hudUI.setDifficulty(`${runName(RUN)} ×${scoreMultiplier(RUN).total}${autoCorrect ? " · Auto ✓" : ""}`); }
showDifficulty();
initNative({ onBack: () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })) });   // the phone's back button = Escape
// PAUSE (10-09, "make it professional"): opening Settings — the gear, Escape, the phone's back button, or the app going to the
// background — freezes the song by suspending the audio clock (the same trick dev mode uses); closing it counts 3-2-1 back in.
let pausedSong = false, resumeTimer = null;
function pauseSong() {
  if (pausedSong || !ctx || ctx.state !== "running" || !clock) return;
  ctx.suspend(); pausedSong = true; wake.off(); bootlog("paused");
}
function resumeSong() {
  if (!pausedSong || !ctx) return;
  clearTimeout(resumeTimer);
  let n = 3; const step = () => { if (!pausedSong) return; if (n > 0) { hudUI.say(String(n), "good", 700); n--; resumeTimer = setTimeout(step, 750); return; }
    ctx.resume(); pausedSong = false; wake.on(); hudUI.say("Go!", "good", 500); bootlog("resumed"); };
  step();
}
document.addEventListener("visibilitychange", () => { if (document.hidden && ctx && ctx.state === "running" && clock) settingsUI.open(); });
const settingsUI = createSettings({
  onOpen: () => pauseSong(), onClose: () => resumeSong(),
  onCalibrate: () => startCalibration(),
  onChange: (k, v) => {
    if (k === "autoCorrect") { autoCorrect = v; showDifficulty(); return; }
    if (mixer) mixer.setVolume(k, v);
  },
  onRestart: () => location.reload(),   // difficulty sets the tempo; graphics rebuild the scene
  onEditor: () => { if (stage3d && !stage3d.fly) toggleFly(); },   // the level editor without a keyboard (10-08)
});
settingsUI.setAutoNote(`Auto — measures this device (now: ${TIER})`);

// AUTO GRAPHICS CHECK: after a 2.5 s warm-up, count frames for 4 s (only while
// the page is visible). Under 28 fps -> step down a level and reload (or, once
// a game has started, just remember it for next time).
// Measured TWICE: on the loaded stage (a very slow device drops a tier and reloads before
// it ever plays) and again IN PLAY, once the battle is on (2026-10-05: a phone passed the
// quiet check at 60 fps and then played at 21). Each verdict is kept for next time.
function measureFps(delayMs, onDone) {
  let frames = 0, t0 = 0, measuring = false, done = false;
  const begin = () => { frames = 0; t0 = performance.now(); measuring = document.visibilityState === "visible"; };
  const onVis = () => { if (document.visibilityState === "visible") begin(); else measuring = false; };
  const count = () => {
    if (done) return;
    if (measuring && ++frames && performance.now() - t0 >= 4000) {
      done = true; document.removeEventListener("visibilitychange", onVis);
      onDone(frames / ((performance.now() - t0) / 1000)); return;
    }
    requestAnimationFrame(count);
  };
  setTimeout(() => { begin(); document.addEventListener("visibilitychange", onVis); requestAnimationFrame(count); }, delayMs);
}
if (AUTO_GFX) measureFps(2500, (fps) => judgeGraphics(fps, "loaded"));
function judgeGraphics(measured, when) {
  const fake = +new URLSearchParams(location.search).get("fakefps");   // TEST ONLY: pretend this frame rate
  const fps = fake || measured;
  const i = TIERS.indexOf(TIER), next = TIERS[i + 1];
  bootlog("graphics check", { tier: TIER, fps: Math.round(fps), when });
  const remember = (t) => { try { localStorage.setItem("gr.autoTier", t); } catch { /* fine */ } };
  if (fps >= 28 || !next) { remember(TIER); return; }
  remember(next);
  if (ctx) { hudUI.say(`Graphics are slow here — next time this device uses ${next}`, "", 3500); return; }
  hudUI.say(`Adjusting graphics for this device: ${next}…`, "", 2500);
  setTimeout(() => location.reload(), 1200);
}

// LIFE: you and the town, 100 each; a missed rocket arrow hurts you, an arrow or a soldier that gets through hurts the town, a hit heals both
const life = { you: 100, town: 100, over: false };
hudUI.setLife(100, 100);
hudUI.setShield(0);

function applyStage() {
  if (!stage3d) return;
  const used = new Set(song().notes.map((n) => LANE_INDEX[n.lane]));   // every drum stands (owner); the guns the song never plays are dimmed
  for (let i = 0; i < 6 + 2 * BARS; i++) stage3d.setDrumVisible(i, i < 6 || used.has(i) || (CREATE && i < 6 + BARS + 8));   // creating: every gun you can write for
  stage3d.setStation(CONDUCT || HYDRA ? "sea" : isMelody() ? partMode() : "drums");   // bass: turn right, treble: turn left; conducting: the podium
  if (audioStarted) updateBackLevels();                      // the sections' background music follows progress
  stageMessage();
  if (audioStarted) joinBacking();   // a finished instrument's left-out notes join in
}

// the standing instruction for where you are in the song
function stageMessage() {
  if (!defend) return;   // before Start: the menu is up
  if (defend.done) { hudUI.setPart(`${song().name} done`); return; }
  const sec = defend.section, pct = Math.round(defend.progress(sec) * 100);
  hudUI.setPart(`${song().name} · ${sec} ${pct}%`);
  const how = sec === "drums" ? (IS_TOUCH ? "tap the drums" : "top Q W E · bottom A S D")
    : sec === "treble" ? `mortar fire charges the crystals — hit one when it's READY, on its count (${IS_TOUCH ? "tap it" : padConnected ? "LB / RB" : "Q-R left, T-I right"})`
    : IS_TOUCH ? "tap the buttons" : padConnected ? "D-pad + X A B Y = the 8 columns (the game picks the gun)" : "mortars A S D F G H J K · cannons Q W E R T Y U I";
  const rule = RUN.lock === 1 ? "every note you hit locks"
    : RUN.keep === "any" ? `groups of ${RUN.lock === Infinity ? "the whole section" : RUN.lock}: every note you hit locks`
    : RUN.keep === "half" ? `groups of ${RUN.lock === Infinity ? "the whole section" : RUN.lock}, in order — break it and half of your hits still lock`
    : RUN.lock === Infinity ? "hit them ALL, in order, to lock the section" : `hit all ${RUN.lock}, in order, to lock them`;
  hudUI.say(`${sec === "drums" ? "Drums" : sec === "bass" ? "Bass — turned right" : "Treble — turned left"}: ${how} — ${rule}`);
}

// THE CORE LOOP, every frame: an offered note whose moment went by unhit is a
// miss (hurts you and the town); then whatever the engine reports happens
function tickDefend(heardNow) {
  if (!defend || life.over) return;
  // the STREAM (defend.js): the engine gets the time in beats, how far ahead the rockets fly, the hitbox
  defend.now = (heardNow - clock.first) / clock.beatDur;
  defend.windowBeats = APPROACH_S / clock.beatDur;
  defend.graceBeats = judgeDiff().window / clock.beatDur;
  defend.missFrom = (defendFrom - clock.first) / clock.beatDur;
  defend.tick();   // what went by unhit is a miss
  // the targets glow up WITH their rocket / cart (owner, 2026-10-04): the rocket's progress down the lane
  const lv = {};
  for (const n of defend.offered()) {
    const i = LANE_INDEX[n.lane];
    if (i == null) continue;
    const t = clock.first + n.at * clock.beatDur;
    lv[i] = Math.max(lv[i] || 0, Math.min(1, Math.max(0, 1 - (t - heardNow) / APPROACH_S)));
  }
  stage3d.setPending(lv);
  if (defend.section === "treble") tickCrystals(heardNow);
  tickSiege(heardNow);
  defendEvents();
}
// THE SIEGE (owner, 2026-10-03): arrows rain in the whole time. The shield rises with
// the drums; under its height they're zapped, over it they hurt you and the town.
// Once it's full it has its own life; broken, it drops until locks heal it back.
function tickSiege(heardNow) {
  if (!siege || heardNow < defendFrom) return;
  const drumsDone = defend.progress("drums") >= 1;
  siege.rise = defend.progress("drums");
  if (drumsDone && !siege.full) { siege.full = true; showShield(); hudUI.say("🛡 The shield is up — it takes the hits now", "good", 2600); }
  siege.paused = life.over;
  // THE ARMY: bass brings soldiers, treble the BOSS (its life: 2 hits for every treble note you'll play)
  const sec = defend.section;
  if (sec !== waveSection) {
    if (waveSection === "bass" || waveSection === "treble") siege.endWave();
    if (sec === "bass" || sec === "treble") {
      const trebleNotes = (song().playNotes || song().notes).filter((n) => n.lane.startsWith("treble")).length;
      siege.startWave(sec, { bossHp: Math.max(12, trebleNotes * ARMY.bossHpPerNote) });
      if (sec === "treble") hudUI.say("⚠ THE BOSS IS COMING — keep the guns firing!", "bad", 3500);
      else hudUI.say("Here they come — every note fires a gun", "good", 3000);
    }
    waveSection = sec;
  }
  siege.tick(heardNow);
  for (const e of siege.drain()) {
    if (e.type === "arrow") stage3d.volley({ part: defend.section || "drums", ...e });
    else if (e.type === "arrowHit") life.town -= e.dmg;   // the archers' arrows threaten the TOWN
    else if (e.type === "shieldBroken") { showShield(); hudUI.say("The shield broke! Lock notes to raise it", "bad", 2600); }
    else if (e.type === "shieldBack") { showShield(); hudUI.say("🛡 Shield back up", "good", 2000); }
    else if (e.type === "spawn") stage3d.troopSpawn(e.enemy);
    else if (e.type === "killed") { stage3d.troopKill(e.enemy, e.by); if (e.enemy.kind === "boss") hudUI.say("💥 THE BOSS IS DOWN!", "good", 4000); }
    else if (e.type === "bossHit") stage3d.bossHit(e.enemy);
    else if (e.type === "wallHit") life.town -= e.dmg;   // no shield: they're at the town
    else if (e.type === "balloonRocket") stage3d.enemyRocket(e.enemy, e.landAt, heardNow);   // a balloon fires at the cannons
    else if (e.type === "rocketHit") life.town -= e.dmg;   // ...and the town takes it
  }
  hudUI.setShield(siege.full ? siege.hp : 100 * siege.rise, siege.full ? (siege.broken ? "broken" : "up") : "building");
}
// the dome: each section's part shimmers as it's built and stands once it's up
function showShield() {
  // the whole dome rises with the drums (owner: "by the end of drums you get it to the top");
  // broken, it's down until it's healed back
  const st = siege && siege.broken ? { progress: 0, up: false } : { progress: defend.progress("drums"), up: defend.progress("drums") >= 1 };
  stage3d.setShield({ drums: st, bass: st, treble: st });
}
/** keyboard: letter k of a row -> the bar slot (0..15) of the k-th gun present in this round's kit, or null */
function slotForKey(kind, letterIdx) {
  const row = letterIdx < 8 ? "bottom" : "top", k = letterIdx % 8, slots = stage3d ? stage3d.kit[kind][row] : [0, 1, 2, 3, 4, 5, 6, 7];
  return slots[k] == null ? null : slots[k] + (row === "top" ? 8 : 0);
}
/** the round's letters for a station: present guns get A S D... / Q W E... left to right; the rest none */
function lettersFor(kind) {
  const out = Array(16).fill(""), kit = stage3d.kit[kind];
  kit.bottom.forEach((slot, k) => { out[slot] = "ASDFGHJK"[k]; });
  if (kind === "treble") { out[8] = "Q"; out[12] = "T"; } else kit.top.forEach((slot, k) => { out[8 + slot] = "QWERTYUI"[k]; });
  return out;
}
function padLabelsFor(kind) {
  const out = Array(16).fill(""), st = stage3d.melodyStations[kind];
  st.grid.bottom.forEach((bar, c) => { if (bar >= 0) out[bar] = PAD_ROW[c]; else if (st.grid.top[c] >= 0) out[st.grid.top[c]] = PAD_ROW[c]; });
  if (kind === "treble") { out[8] = "LB"; out[12] = "RB"; }
  return out;
}
// ONE BUTTON PER COLUMN (owner, 2026-10-04): a press on a gun column fires whichever of its two
// guns has a note due nearest the press; nothing due: the row the stream is on (else the bottom).
// rowForce "top" / "bottom" (the pad's LT / RT) overrides, for free play.
function resolveColumn(kind, col, press, rowForce = null) {
  const st = stage3d.melodyStations[kind], base = kind === "bass" ? 6 : 6 + BARS;
  if (col < 0 || col >= st.grid.cols) return null;
  const bottom = st.grid.bottom[col] >= 0 ? base + st.grid.bottom[col] : null, top = st.grid.top[col] >= 0 ? base + st.grid.top[col] : null;
  if (bottom == null && top == null) return null;
  if (bottom == null || top == null) return KEYMAP_BY_IDX[bottom ?? top];   // one gun in this column
  if (rowForce === "top") return KEYMAP_BY_IDX[top];
  if (rowForce === "bottom") return KEYMAP_BY_IDX[bottom];
  let best = null, bestD = Infinity, rowNext = null, nextAt = Infinity;
  if (defend) for (const n of defend.offered()) {
    const i = LANE_INDEX[n.lane], t = clock.first + n.at * clock.beatDur;
    if (i >= base && i < base + 2 * PER_ROW_GUNS && t < nextAt) { nextAt = t; rowNext = i >= base + PER_ROW_GUNS ? top : bottom; }   // the stream's current row
    if (i !== bottom && i !== top) continue;
    const d = Math.abs(t - press);
    if (d < bestD) { bestD = d; best = i; }
  }
  return KEYMAP_BY_IDX[best != null && bestD <= 0.6 ? best : rowNext != null ? rowNext : bottom];
}
/** a gun lane (touch / VR hit its column's button): the column's due gun */
function resolveGun(idx, press, rowForce = null) {
  const kind = idx < 6 + BARS ? "bass" : "treble", b = stage3d.melodyStations[kind].bars[(idx - 6) % BARS];
  return (b && b.column >= 0 ? resolveColumn(kind, b.column, press, rowForce) : null) || KEYMAP_BY_IDX[idx];
}
const PER_ROW_GUNS = 8;
// a gun fires: siege.js aims the shell at the enemy nearest the wall (it lands where they'll be)
function fireGun(idx, lane, at, acc = 0.8) {
  const side = lane.startsWith("bass") ? "bass" : "treble";
  if (isCrystal(lane)) return;   // the crystals aren't guns (hitCrystal)
  if (side === "treble") chargeCrystals(acc);   // the boss: every mortar shot charges a crystal
  const kind = +lane.split(" ")[1] >= 9 ? "balloon" : "soldier";   // cannons hunt the balloon guys, mortars the soldiers
  const target = siege ? siege.shoot(side, at + stage3d.gunFlight(idx), undefined, kind) : null;
  stage3d.fireCannon(idx, at, target);
}
const isGun = (lane) => /^(bass|treble) \d+$/.test(lane);   // every bar is a gun now: cannons on top, mortars below
const isCrystal = (lane) => /^treble (9|1[0-6])$/.test(lane);   // treble's top row (owner, 2026-10-04)
// THE LIGHTNING (owner, 2026-10-04): every MORTAR hit at the boss (yours, the band's, a filler's)
// charges a crystal — left and right in turn — by how good the hit was. A full crystal is READY:
// it lights and counts 3, 2, 1 to a beat; hit it (LB / RB, Q-R / T-I, tap) and the tower fires a
// bolt at the boss — a quarter of its life, times how close to the count you hit. Miss the count
// and it stays ready, counting to the next bar.
const CRYSTAL_NEED = 4;   // good mortar hits to charge one
const lightning = { crystals: [{ charge: 0, ready: false, moment: 0 }, { charge: 0, ready: false, moment: 0 }], next: 0 };
function nextCrystalMoment(from) {   // the first beat at least 3 beats on: a full 3, 2, 1
  const b = Math.ceil((from - clock.first) / clock.beatDur) + 3;
  return clock.first + b * clock.beatDur;
}
function chargeCrystals(acc = 0.8) {
  const cs = lightning.crystals;
  let i = lightning.next; if (cs[i].ready) i ^= 1; if (cs[i].ready) return;   // both ready: nothing to add
  const c = cs[i];   // ONE crystal fills at a time (left, then right): one lights up every few good hits
  c.charge = Math.min(CRYSTAL_NEED, c.charge + Math.max(0.3, acc));
  if (c.charge >= CRYSTAL_NEED - 1e-9) { c.ready = true; c.moment = nextCrystalMoment(ctx.getOutputTimestamp().contextTime); lightning.next = i ^ 1; hudUI.say(`${i ? "Right" : "Left"} crystal READY — hit it on the count`, "good", 1800); }
  pushCrystalState();
}
function tickCrystals(heardNow) {
  const box = judgeDiff().window;
  for (const c of lightning.crystals) if (c.ready && heardNow > c.moment + box) c.moment = nextCrystalMoment(heardNow - 2 * clock.beatDur);   // missed the count: it counts again
  pushCrystalState();
}
function pushCrystalState() { stage3d.setCrystalState(lightning.crystals.map((c) => ({ charge: c.charge / CRYSTAL_NEED, ready: c.ready, moment: c.moment }))); }
/** a crystal struck (side 0 left / 1 right): READY -> the bolt, by accuracy to its count; else a fizzle */
function hitCrystal(side, press) {
  const c = lightning.crystals[side], idx = 6 + BARS + 8 + (side ? 4 : 0), entry = KEYMAP_BY_IDX[idx];
  const p = stage3d.drumScreen(idx);
  stage3d.press(idx, "HIT"); stage3d.strike(idx, "HIT");
  if (!c.ready) { pool.noteOn({ channel: entry.idx + 40, midi: 60, baseNote: 60, ...laneSound(entry.ln), velocity: 0.35, when: ctx.currentTime }); if (p) showStamp("not ready", p.x, p.y - 20, { size: 20, color: "#9fd4ff", ms: 600 }); return; }
  // NO COUNTDOWN (owner, 2026-10-07: "once it's built up, you just release it"): a ready crystal always gives the full bolt
  const acc = 1, a = 0, off = 0;
  c.ready = false; c.charge = 0;
  pool.noteOn({ channel: entry.idx + 40, midi: 60, baseNote: 60, ...laneSound(entry.ln), velocity: Math.min(1.1, 0.6 + 0.5 * acc), when: ctx.currentTime });
  if (p) showStamp("⚡", p.x, p.y - 4, { size: 30, ms: 700 });
  stage3d.crystalHit(idx);
  const b = siege && siege.boss && siege.boss.alive ? siege.boss : null;
  if (b) { const dmg = Math.max(1, Math.round((b.of / 4) * Math.min(1.1, acc))); stage3d.lightningStrike(stage3d.enemyPos("treble", b.dist, b.lat, 3.4)); siege.zapBoss(dmg); hudUI.say(`⚡ LIGHTNING ${Math.round(acc * 100)}%`, "good", 1200); }
  else stage3d.lightningStrike(stage3d.enemyPos("treble", 12, 0, 1.5));
  pushCrystalState();
}
// a red flash round the edge of the screen: you got hit
let hurtEl = null;
function hurtFlash() {
  if (!hurtEl) {
    hurtEl = document.createElement("div");
    hurtEl.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:45;opacity:0;transition:opacity 0.5s;box-shadow:inset 0 0 120px 40px rgba(255,30,10,0.75)";
    document.body.appendChild(hurtEl);
  }
  hurtEl.style.transition = "none"; hurtEl.style.opacity = "1";
  requestAnimationFrame(() => { hurtEl.style.transition = "opacity 0.6s"; hurtEl.style.opacity = "0"; });
}
function defendEvents() {
  const L = LIFE[RUN.damage] || LIFE.normal;
  for (const e of defend.drain()) {
    if (e.type === "bonusHit") continue;   // a filler note: the sound, the stamp and the gun already happened
    if (e.type === "miss") {
      if (e.note.section !== "drums") continue;   // at the guns a miss just doesn't fire: the enemy is the threat
      life.you -= L.miss;   // a missed rocket arrow blows up at the drum: it hurts YOU (owner: rockets threaten the player, arrows the town)
      hurtFlash();
      const idx = LANE_INDEX[e.note.lane], p = idx != null && stage3d.drumScreen(idx);
      if (p) showStamp("MISS", p.x, p.y, { size: 26, color: "#ff7a5a", ms: 800 });
    } else if (e.type === "lock") {
      // locked notes join the band: they play every pass from the next one on
      const loop = 4 * song().bars * clock.beatDur, k = Math.floor((ctx.currentTime - clock.first) / loop);
      loops.add({ bars: song().bars, startBar: (k + 1) * song().bars,
        hits: e.notes.map((n) => { const h = e.hits.find((x) => x.id === n.id) || {}; return { lane: n.lane, pos: n.beat * clock.beatDur + (autoCorrect ? 0 : h.offset || 0), velocity: h.velocity ?? 0.9, midi: n.midi }; }) });
      const last = e.notes[e.notes.length - 1], idx = LANE_INDEX[last.lane], p = idx != null && stage3d.drumScreen(idx);
      if (p) showStamp("LOCKED!", p.x, p.y - 30, { size: e.notes.length > 1 ? 56 : 40, ms: 1600 });
      if (siege) siege.heal();
      showShield();
      stageMessage();
    } else if (e.type === "progress") {
      hudUI.say(`${e.hit} / ${e.of} — keep going, in order`, "good", 1200);
    } else if (e.type === "chunkFail") {
      hudUI.say(`Broke the run (${e.why}) — those come round again`, "bad", 1600);
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
    run: { name: runName(RUN), mult: scoreMultiplier(RUN).total },
    onNext: () => { try { sessionStorage.setItem("gr.menuAt", "setup"); } catch { /* menu from the top */ } location.reload(); },
    onMenu: () => { try { sessionStorage.setItem("gr.menuAt", "levels"); } catch { /* fine */ } location.reload(); },
  }), 1400);
}

applyStage();

// end of a round: the grade, then the next round in the same arena (fresh song,
// fresh loops); after the last round, free play
// THE BIG TO-DO (owner, 2026-10-09: "drums, then guns, then boss, then hydra after a big to-do"): when round 3 of a level is won
// there is no results screen — THE HYDRA RISES, a horn, the view turns to the sea gate and it lifts, the three songs load meanwhile,
// then the flight through the gate, down the dock and up the altar, and the fight — all in this page (a reload would need a key press)
async function bigToDo(g) {
  bootlog("big to-do", { level: g.title, rounds: g.rounds });
  const t0 = performance.now();
  life.over = true; ghostsOn = false;   // round 3 is over: its strikes and its band stop
  for (const m of ["drums", "bass", "treble"]) if (backGain[m]) backGain[m].gain.setTargetAtTime(0, ctx.currentTime, 0.6);
  showStamp("THE HYDRA RISES", window.innerWidth / 2, window.innerHeight * 0.32, { size: 54, color: "#9cff3a", ms: 3200 });
  hudUI.setPart("");
  horn();
  stage3d.setStation("gate"); setTimeout(() => stage3d.openSeaGate(2.6), 900);
  const keep = roundIdx;
  for (const i of [...g.rounds].reverse()) { roundIdx = i; BPM = Math.round((song().bpm || 80) * RUN.tempo * 10) / 10; await loadRoundSamples(); }
  roundIdx = keep;
  await new Promise((r) => setTimeout(r, Math.max(0, 4200 - (performance.now() - t0))));
  HYDRA = { rounds: g.rounds, title: g.title }; roundIdx = g.rounds[0]; defend = null; siege = null; life.over = false;
  stage3d.flyIn(7, () => HYDRA_MODE.startInPage());
}
/** a war horn: three detuned saw voices on a fifth, swelling and fading (no sample needed) */
function horn() {
  const t = ctx.currentTime, out = ctx.createGain(), lp = ctx.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.setValueAtTime(300, t); lp.frequency.linearRampToValueAtTime(1400, t + 0.6); lp.frequency.linearRampToValueAtTime(500, t + 2.6);
  out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(0.35, t + 0.4); out.gain.setValueAtTime(0.35, t + 1.8); out.gain.linearRampToValueAtTime(0, t + 2.8);
  lp.connect(out); out.connect(mixer.master);
  for (const [f, d] of [[110, -6], [110, 5], [164.8, 0], [220, 3]]) { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; o.detune.value = d; o.connect(lp); o.start(t); o.stop(t + 3); }
}

function endRound() {
  wake.off();
  const stats = gradeRound(roundOffsets, judgeDiff().window);
  { const g = levelGroups(LESSONS).find((x) => x.rounds[2] === roundIdx);   // round 3 of a level: straight into the big to-do
    if (g) { try { if (unlockedLevel() < roundIdx + 1) localStorage.setItem(UNLOCKED_KEY, roundIdx + 1); } catch { /* fine */ } bootlog("round 3 done", stats); bigToDo(g); return; } }
  // finishing a level unlocks the next
  try { if (unlockedLevel() < roundIdx + 1) localStorage.setItem(UNLOCKED_KEY, roundIdx + 1); } catch { /* not remembered */ }
  const toMenu = (where, level) => {
    try { sessionStorage.setItem("gr.menuAt", where); if (level != null) localStorage.setItem("gr.level", level); } catch { /* menu from the top */ }
    location.reload();   // a fresh run: its own tempo and settings
  };
  results.show({
    round: song().name, title: song().title, stats, last: lastRound(),
    run: { name: runName(RUN), mult: scoreMultiplier(RUN).total },
    onNext: () => {
      const g = levelGroups(LESSONS).find((x) => x.rounds[2] === roundIdx);   // round 3 of a level: on to its hydra
      if (g) return goHydra(g);
      if (lastRound()) { stageMessage(); return; } toMenu("setup", roundIdx + 1);
    },
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
// the pad (owner, 2026-10-04): D-pad + X A B Y = the 8 COLUMNS; the game picks the row — one label per column
const PAD_ROW = ["dL", "dD", "dR", "dU", "X", "A", "B", "Y"];
const PAD_DRUM_LABELS = ["LB", "Y", "RB", "A", "X", "RT"];   // by drum lane: hat snare crash / kick tom-low tom-high (input/pads.js PAD_BUTTONS)
function relabel() {   // the letters / pad buttons on the guns and drums, for this round's kit and the controls in hand
  for (const k of ["bass", "treble"]) stage3d.melodyStations[k].setLabels(padConnected ? padLabelsFor(k) : IS_TOUCH ? NO_LABELS : lettersFor(k));
  // the drums show the controller's buttons with a pad in hand (owner, 2026-10-06), the keyboard letters otherwise; tablets: none
  if (IS_TOUCH) stage3d.hideDrumLabels();
  else { stage3d.setDrumLabels(padConnected ? PAD_DRUM_LABELS : null); stage3d.showDrumLabels(); }
}
const NO_LABELS = Array(16).fill("");   // tablets: no letters anywhere (owner, 2026-10-04) — unless a controller is plugged in
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
  // the small copy first: the same sound as Opus (.ogg, tools/compress-samples.sh, ~1/25 the
  // bytes of the WAV); a browser that can't decode it gets the WAV. Counted so device.log shows which.
  const got = { ogg: 0, wav: 0, failed: 0, fellBack: [] };   // fellBack: which WAVs had to stand in, and why
  const fetchDecoded = async (q) => {
    const r = await fetch("/rounds/samples/" + q);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return ctx.decodeAudioData(await r.arrayBuffer());
  };
  await Promise.all(paths.map(async (p) => {
    const ogg = p.replace(/\.wav$/i, ".ogg");
    try {
      if (ogg !== p) {
        try { sampleCache.set(p, await fetchDecoded(ogg)); got.ogg++; return; }
        catch (e) { got.fellBack.push(`${p.split("/").pop()}: ${String(e).slice(0, 60)}`); console.warn(`sample ${ogg} not usable here, trying the WAV: ${e}`); }
      }
      sampleCache.set(p, await fetchDecoded(p)); got.wav++;
    } catch (e) { sampleCache.set(p, null); got.failed++; console.warn(`sample ${p} failed: ${e}`); }
  }));
  if (paths.length) bootlog("samples", got);
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
  const owner = song().aliases && song().aliases[ln.name], oln = owner && KEYMAP_BY_LANE[owner] ? KEYMAP_BY_LANE[owner].ln : ln;   // a stand-in: its owner's built-in sound
  return { buffer: oln.kind ? melodyVoices[oln.kind][oln.slot] : drums[oln.drum], midi: 60, baseNote: 60, destination: laneDest(ln), settings: hbVoice(null) };
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
  btn.addEventListener("click", () => startCalibration());
  if (import.meta.env.DEV) document.body.appendChild(btn);   // (10-09) the dev corner button; players use Options → Calibrate timing
  return btn;
}
// CALIBRATION for players (10-09): Options → "Calibrate timing". Your next 16 hits are measured against the beat and their
// typical offset (the median) is taken off every press from then on — this is what makes a phone's audio delay playable.
function startCalibration() {
  if (calib) return false;
  if (!clock) { hudUI.say("Start a song first, then calibrate while it plays", "", 3000); return false; }
  calib = { hits: [] }; offsets = [];
  setTimeout(() => hudUI.say("Calibrating — play along with the beat for 16 hits", "good", 4000), pausedSong ? 3100 : 0);   // after the count-in
  return true;
}

// the song begins on the first key / tap / pad press after Start: 3, 2, 1, go
let beginSong = null, armed = false, counting = false;
const AUTO_BEGIN = new URLSearchParams(location.search).has("autobegin");
// ROUND 4 feel-test (2026-10-06): ?conduct=1 — the round runs as usual underneath, but you stand at
// the podium facing the sea and CONDUCT the three section buses: 1/2/3 pick a section, U cue, I cut,
// O accent, hold P to swell (conductor.js judges on the bar line). Proper round-4 flow comes after.
const CONDUCT = new URLSearchParams(location.search).has("conduct");   // (dev feel-test only since 2026-10-08: round 4 is drums + notes now)
let touchFly = null;   // the editor's touch controls (dev/touchfly.js), made on first use
function toggleFly() {
  const on = !stage3d.fly; stage3d.setFly(on);
  if (on && !touchFly) import("./dev/touchfly.js").then(({ createTouchFly }) => {
    touchFly = createTouchFly({ stage3d, dom: stage3d.canvas || stage, onDone: () => { if (stage3d.fly) toggleFly(); } });
    touchFly.show(!!stage3d.fly);
  });
  if (touchFly) touchFly.show(on);
  // DEV MODE pauses the game and clears the screen (owner, 2026-10-07: "all on-screen stuff vanish,
  // game pauses if playing"). Suspending the AudioContext freezes the song clock, so every note, cue,
  // enemy and timer that runs on it stops dead and picks up exactly where it was; the water and the
  // fire run on wall-clock time and keep moving, so the world doesn't look dead.
  if (on && ctx && ctx.state === "running") { ctx.suspend(); flyPaused = true; }
  else if (!on && flyPaused && ctx) { ctx.resume(); flyPaused = false; }
  for (const el of [...document.body.children]) {
    if (el === stage || el.dataset.devEditor || el.tagName === "SCRIPT") continue;
    if (on) { el.dataset.devHid = el.style.visibility || "-"; el.style.visibility = "hidden"; }
    else if (el.dataset.devHid) { el.style.visibility = el.dataset.devHid === "-" ? "" : el.dataset.devHid; delete el.dataset.devHid; }
  }
  document.body.classList.toggle("dev-mode", on);   // anything created while editing (stamps) is hidden by the rule below
  bootlog("fly", { on, paused: flyPaused });
}
let flyPaused = false;
{ const st = document.createElement("style"); st.textContent = "body.dev-mode > *:not(#stage):not([data-dev-editor]) { visibility: hidden !important; }"; document.head.appendChild(st); }
window.addEventListener("keyup", (e) => { if (stage3d && stage3d.fly) stage3d.flyKey(e.key, false); });
// DEV MODE mouse look (owner, 2026-10-07: "mouse look is off, really hard to control"): HOLD the RIGHT
// button and the cursor locks and the camera turns like a first-person game — stops dead on release.
// (Before: a plain drag here AND the game's own drag-look both steered, and the game's kept spinning.)
{ let looking = false;
  window.addEventListener("mousedown", (e) => { if (stage3d && stage3d.fly && e.button === 2) { looking = true; stage.requestPointerLock?.(); } });
  window.addEventListener("mouseup", (e) => { if (e.button === 2 && looking) { looking = false; if (document.pointerLockElement) document.exitPointerLock(); } });
  window.addEventListener("mousemove", (e) => { if (looking && stage3d && stage3d.fly) stage3d.flyLook(e.movementX, e.movementY); });
  window.addEventListener("contextmenu", (e) => { if (stage3d && stage3d.fly) e.preventDefault(); });
  window.addEventListener("wheel", (e) => { if (stage3d && stage3d.fly) { e.preventDefault(); stage3d.flySpeed(e.deltaY < 0 ? 1.25 : 0.8); } }, { passive: false }); }
let conductor = null, conductSection = "drums";
const beatsNow = () => (clock && ctx ? (ctx.currentTime - clock.first) / clock.beatDur : 0);
function conductGesture(kind, t = beatsNow()) {
  if (!conductor) return;
  const ev = kind === "release" ? conductor.release(conductSection, t) : conductor[kind](conductSection, t);
  if (!ev) return;
  bootlog("conduct", ev);
  hudUI.say(`${ev.kind.toUpperCase()} ${ev.section} — ${ev.clean ? "on the bar" : `late ${ev.error > 0 ? "+" : ""}${ev.error.toFixed(2)}`}`, ev.clean ? "good" : "", 900);
}
window.addEventListener("keyup", (e) => { if (conductor && e.key.toLowerCase() === "p") conductGesture("release"); });
function beginCount() {
  wake.on();   // the screen stays on through the song (packaged app / phones)
  if (!armed || clock || counting) return;
  counting = true;
  const beat = 60 / BPM, cx = window.innerWidth / 2, cy = window.innerHeight * 0.38;
  hudUI.say("");
  [3, 2, 1].forEach((n, i) => setTimeout(() => {
    showStamp(String(n), cx, cy, { size: 140, color: n === 1 ? "#ff4a3a" : n === 2 ? "#ffa53a" : "#ffe45a", ms: beat * 900 });
    pool.noteOn({ channel: 0, midi: n === 1 ? 84 : 72, baseNote: 60, buffer: drums.click, velocity: 0.9, when: ctx.currentTime, destination: mixer.metronome, settings: voiceSettings({ voice: VOICE_PRESETS["One shot"] }) });
  }, i * beat * 1000));
  setTimeout(() => { beginSong(); counting = false; }, 3 * beat * 1000);
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
    bootlog("run", { hitbox: RUN.hitbox, tempo: RUN.tempo, patterns: RUN.patterns, lockSize: RUN.lock === Infinity ? "all" : RUN.lock, keep: RUN.keep, damage: RUN.damage, bpm: BPM, mult: scoreMultiplier(RUN).total });
    await buildMelodyVoices();   // fallback bar voices
    if (HYDRA) {   // round 4: every movement's sounds now (each at its own tempo), not mid-fight
      for (const i of [...HYDRA.rounds].reverse()) { roundIdx = i; BPM = Math.round((song().bpm || 80) * RUN.tempo * 10) / 10; await loadRoundSamples(); }
    } else await loadRoundSamples();    // the round's own sounds
    pool = new VoicePool(ctx, { max: IS_TOUCH ? 12 : 24 });   // phones: fewer voices at once (crackle when busy)
    btn.remove();
    // READY (owner, 2026-10-04): the song doesn't just start — press a key, tap, or a pad
    // button, and it counts 3, 2, 1 in. (Harnesses: ?autobegin=1 skips the wait.)
    beginSong = () => {
    clock = startClock(ctx, {
      bpm: BPM,
      onBeat: (time, n) => {
        pool.noteOn({
          channel: 0,
          midi: 72,
          baseNote: 60,
          buffer: drums.click,
          velocity: 0.35,
          when: time,
          destination: mixer.metronome,
          settings: voiceSettings({ voice: VOICE_PRESETS["One shot"] }),
        });
      },
    });

    loops = new Loops(4 * clock.beatDur);
    ghosts = loops;   // the scheduler below replays loop layers
    addBacking();
    if (CREATE) startCreating();
    else if (HYDRA) startHydra();
    else if (!HYDRA) defend = new Defend({ notes: song().playNotes || song().notes, bars: song().bars }, { lockSize: RUN.lock, keep: RUN.keep, beatDur: clock.beatDur });
    if (defend) { const sec = new URLSearchParams(location.search).get("section");   // dev: ?section=bass|treble starts the round there (photos of the armies)
      const k = ["drums", "bass", "treble"].indexOf(sec); if (k > 0) defend.sectionIdx = k; }
    stage3d.setBeat(clock.first, clock.beatDur);   // the cues count in on the song's beat
    if (CONDUCT) { conductor = new Conductor({ beatsPerBar: 4 }); if (!HYDRA) hudUI.say("CONDUCT — 1/2/3 pick a section · U cue · I cut · O accent · hold P to swell", "good", 7000); if (stage3d.hydra) stage3d.hydra.rise(); }
    if (AUTO_GFX) measureFps(8000, (fps) => judgeGraphics(fps, "in play"));   // the real test: with the battle on
    else measureFps(8000, (measured) => { const fps = +new URLSearchParams(location.search).get("fakefps") || measured;   // a HAND-PICKED setting that runs slow: say so (10-08: his phone sat on Medium at 20 fps — Low ran 60)
      bootlog("graphics check", { tier: TIER, fps: Math.round(fps), when: "in play (hand-picked)" });
      const lower = TIERS[TIERS.indexOf(TIER) + 1];
      if (fps < 28 && lower) hudUI.say(`Graphics: ${TIER} runs slow on this device (${Math.round(fps)} fps) — try ${lower[0].toUpperCase() + lower.slice(1)} or Auto in ⚙ Settings`, "bad", 7000);
    });
    if (!CREATE && !HYDRA) siege = new Siege({ miss: (LIFE[RUN.damage] || LIFE.normal).miss, beatDur: clock.beatDur });
    defendFrom = clock.first + Math.ceil((ctx.currentTime + 1.5 - clock.first) / (4 * clock.beatDur)) * 4 * clock.beatDur;   // misses count from the next bar after a breath
    if (defend) defend.drain();
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
    hud.textContent = modeStr();
    };
    armed = true;
    if (AUTO_BEGIN) beginSong();
    else if (HYDRA) { hudUI.say("", ""); stage3d.flyIn(7, () => beginCount()); }   // the final battle: fly to the altar, then the count
    else if (autoFromMenu || CREATE) beginCount();
    else hudUI.say(IS_TOUCH ? "Tap to begin" : padConnected ? "Press a button to begin" : "Press any key to begin", "good");
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
  if (HYDRA) { for (const m of ["drums", "bass", "treble"]) backGain[m].gain.setTargetAtTime(backLevel(1), ctx.currentTime, 0.5); return; }   // round 4: the backgrounds at full
  if (conductor && clock) {   // conducting: the band is at full, the gestures shape each section, crisp (0.05 s)
    const t = beatsNow();
    for (const m of ["drums", "bass", "treble"]) backGain[m].gain.setTargetAtTime(conductor.level(m, t), ctx.currentTime, 0.05);
    return;
  }
  const prog = defend ? { drums: defend.progress("drums"), bass: defend.progress("bass"), treble: defend.progress("treble") } : { drums: 0, bass: 0, treble: 0 };
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
  return defend && !defend.done ? [{ part: defend.unlocked(), bars: song().bars }] : [];
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
    if (defend && isGun(e.lane)) fireGun(entry.idx, e.lane, e.time);   // the band's guns fire on their notes
  }
  scheduledUntil = until;
}

// --- keydown ---------------------------------------------------------------
// Drum mode: each lane key plays that lane's drum IMMEDIATELY on its own
// channel; timing only changes loudness (velocityFor) — never delay or snap
// the sound. Calibration keeps its old F/Space taps against the metronome.
function onKey(e) {
  // DEV FLY: the tilde key toggles a free camera (owner, 2026-10-07: "a dev mode so I can look around");
  // while flying, W A S D Q E Shift move it and the game sees none of those keys
  if ((e.key === "`" || e.key === "~") && !e.repeat && stage3d) { e.preventDefault(); toggleFly(); return; }   // the TILDE key (his name for it), shifted or not
  if (stage3d && stage3d.fly) {
    if (stage3d.editor && stage3d.editor.key(e)) return;   // the editor's keys: 1 2 3, Delete, Esc, Ctrl+Z, Ctrl+S
    if (["w", "a", "s", "d", "q", "e", "shift"].includes(e.key.toLowerCase())) { e.preventDefault(); stage3d.flyKey(e.key, true); }
    return;
  }
  if (recorder && recorder.key(e)) return;   // creating: Enter = record on / off
  if (conductor && !e.repeat) {   // conducting: sections and gestures take the keys
    const k = e.key.toLowerCase();
    if (k === "1" || k === "2" || k === "3") { conductSection = ["drums", "bass", "treble"][+k - 1]; hudUI.say(`section: ${conductSection}`, "", 700); return; }
    const g = { u: "cue", i: "cut", o: "accent", p: "swell" }[k];
    if (g) { e.preventDefault(); conductGesture(g); return; }
  }
  if (autoFromMenu && !ctx && !e.repeat) { e.preventDefault(); startBtn.click(); return; }   // after a round switch: this key is the audio's gesture
  if (armed && !clock && !e.repeat) { e.preventDefault(); beginCount(); return; }   // READY: the first key starts the count
  // start-up guard: drums, pool and clock must all exist before a press
  if (e.repeat || !ctx || !drums || !pool || !clock) return;

  // press time on the audio clock, from the event's own timestamp
  const ts = ctx.getOutputTimestamp();
  const press =
    ts.contextTime + (e.timeStamp - ts.performanceTime) / 1000 - calibration;

  if (HYDRA_MODE.active && HYDRA_MODE.key(e, press)) return;   // round 4: both hands, its own keys
  if (e.key === "Tab") { e.preventDefault(); playHint(); return; }   // LISTEN to the whole section

  // at the bars: A S D F G H J K = bottom row (bars 1-8), Q W E R T Y U I = top row (9-16); Shift+letter = the shortcuts
  if (isMelody() && !e.shiftKey) {
    let slot = MELODY_KEYS[e.key.toLowerCase()];
    if (slot != null) {
      e.preventDefault();
      if (partMode() === "treble" && slot >= 8) { if (recorder) return; hitCrystal(slot < 12 ? 0 : 1, press); return; }   // the boss's two crystals: Q W E R left, T Y U I right
      slot = slotForKey(partMode(), slot);   // the k-th letter of a row is the k-th gun this round built
      if (slot == null) return;
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
  rawMode: () => !!HYDRA,   // round 4: the controller's own two-hand layout (modes/hydra.js pad())
  onRaw: (i, ts) => {
    if (autoFromMenu && !ctx) { startBtn.click(); return; }
    if (armed && !clock) { beginCount(); return; }
    if (!ctx || !clock) return;
    const o = ctx.getOutputTimestamp(); HYDRA_MODE.pad(i, o.contextTime + (ts - o.performanceTime) / 1000 - calibration);
  },
  onHint: () => playHint(),
  onCrystal: (side, ts) => {   // LB / RB at the boss
    if (armed && !clock) { beginCount(); return; }
    if (!ctx || !drums || !pool || !clock || partMode() !== "treble") return;
    const o = ctx.getOutputTimestamp();
    hitCrystal(side === "left" ? 0 : 1, o.contextTime + (ts - o.performanceTime) / 1000 - calibration);
  },
  onMelody: (col, force, ts, rowForce) => {
    if (autoFromMenu && !ctx) { startBtn.click(); return; }
    if (armed && !clock) { beginCount(); return; }
    if (!ctx || !drums || !pool || !clock) return;
    const o = ctx.getOutputTimestamp();
    const press = o.contextTime + (ts - o.performanceTime) / 1000 - calibration;
    const entry = resolveColumn(partMode(), col, press, rowForce);
    if (entry) hitLane(entry.idx, entry.ln, press, force);
  },
  onHit: (laneName, force, ts) => {
    if (autoFromMenu && !ctx) { startBtn.click(); return; }
    if (armed && !clock) { beginCount(); return; }
    if (!ctx || !drums || !pool || !clock) return;
    const entry = KEYMAP_BY_LANE[laneName];
    if (!entry) return;
    // the device's own timestamp, on the heard audio clock (like a key press)
    const o = ctx.getOutputTimestamp();
    hitLane(entry.idx, entry.ln, o.contextTime + (ts - o.performanceTime) / 1000 - calibration, force);
  },
  onStatus: (st) => {
    // a controller in hand: the bars show its buttons instead of keyboard letters
    padConnected = st.pads.length > 0;
    if (stage3d) relabel();
    stageMessage();
    const parts = [...st.midi.map((n) => "🥁 " + n), ...st.pads.map((n) => "🎮 " + n.split("(")[0].trim())];
    if (parts.length) hudUI.say("Connected: " + parts.join(" · "), "good", 3000);
  },
});

// --- VR: a stick tip entering a drumhead (force = stick speed) --------------
const KEYMAP_BY_IDX = [];
for (const e of Object.values(KEYMAP)) KEYMAP_BY_IDX[e.idx] = e;
for (const kind of ["bass", "treble"]) for (const e of MELODY_ENTRY[kind]) KEYMAP_BY_IDX[e.idx] = e;
function wireStage() {
stage3d.setVrHitHandler((idx, force, ms) => {
  if (!ctx || !drums || !pool || !clock) return;
  const o = ctx.getOutputTimestamp(), press = o.contextTime + (ms - o.performanceTime) / 1000 - calibration;
  if (idx >= 6 + BARS + 8) { hitCrystal(idx >= 6 + BARS + 12 ? 1 : 0, press); return; }   // a crystal
  const entry = idx >= 6 ? resolveGun(idx, press) : KEYMAP_BY_IDX[idx];   // a gun column's one button: the game picks the gun
  if (!entry) return;
  hitLane(entry.idx, entry.ln, press, force);
});
stage3d.addVrButton();
stage3d.setLoop(frame);
if (window.__gr) window.__gr.stage3d = stage3d;
relabel();
applyStage();
resize();   // now there's a stage to size
}

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
      const r = defend.hit(found.id, { offset: j.offset, velocity: vel });
      if (isGun(lane.name)) fireGun(idx, lane.name, ctx.getOutputTimestamp().contextTime, Math.max(0, 1 - Math.abs(j.offset) / box) * (Math.abs(j.offset) <= 0.02 ? 1.1 : 1));   // your gun — at the boss it charges a crystal, by accuracy
      if (r !== "bonus") { const L = LIFE[RUN.damage] || LIFE.normal; life.you += L.heal; life.town += L.heal; }   // a filler note scores, but doesn't heal
      if (p) showStamp(Math.round(Math.max(0, 1 - Math.abs(j.offset) / box) * 100) + "%", p.x, p.y - 4, { size: 30, ms: 900 });
    } else {
      defend.stray();   // nothing offered there: breaks a run under way
      if (p && found) showStamp("0%", p.x, p.y - 4, { size: 26, color: "#ff9a7a", ms: 700 });
    }
    defendEvents();
  }
  haptic(lab);
  if (window.__gr) (window.__gr.hits ||= []).push({ lane: lane.name, lab, force: +padVel.toFixed(2), vel: +vel.toFixed(3) });   // harness readout

  // record exactly as played (real timing, real velocity, mistakes and OFF
  // included) — it becomes this lane's ghost from the next pass on
  // AUTO-CORRECT (quantize): a hit inside the scoring box for its note is
  // RECORDED on the exact beat at full strength; the live sound still fired
  // the instant you hit. Outside the box it's recorded exactly as played.

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
  if (recorder) recorder.hit(lane.name, (((press - clock.first) / clock.beatDur) % (4 * song().bars) + 4 * song().bars) % (4 * song().bars));
}

// --- the MODES (modes/create.js, modes/hydra.js) get the game's state through G ----------------------
const G = {
  get CREATE() { return CREATE; }, get BANKS() { return BANKS; }, get RUN() { return RUN; }, get HYDRA() { return HYDRA; },
  applyStage: () => applyStage(), relabel: () => relabel(), song: () => song(), laneSound: (ln, midi) => laneSound(ln, midi),
  updateBackLevels: () => updateBackLevels(), hurtFlash: () => hurtFlash(), runName: (r) => runName(r),
  get ctx() { return ctx; }, get pool() { return pool; }, get KEYMAP_BY_LANE() { return KEYMAP_BY_LANE; }, get stage3d() { return stage3d; },
  get hudUI() { return hudUI; }, get results() { return results; }, get drums() { return drums; }, get mixer() { return mixer; }, get life() { return life; },
  get clock() { return clock; }, set clock(v) { clock = v; },
  get mode() { return mode; }, set mode(v) { mode = v; },
  get conductor() { return conductor; }, set conductor(v) { conductor = v; },
  get roundIdx() { return roundIdx; }, set roundIdx(v) { roundIdx = v; },
  get BPM() { return BPM; }, set BPM(v) { BPM = v; },
  get backUntil() { return backUntil; }, set backUntil(v) { backUntil = v; },
  get recorder() { return recorder; }, set recorder(v) { recorder = v; },
  lessonAt: (i) => LESSONS[i], judgeWindow: () => judgeDiff().window,
};
const { makeRecorder, startCreating } = createMode(G);
const HYDRA_MODE = hydraMode(G), { startHydra } = HYDRA_MODE;

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
        hudUI.say(`Calibrated: ${Math.round(calibration * 1000)} ms`, "good", 3500);
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
const APPROACH_S = 4.0;   // must match stage3d.js

function buildUpcoming(heardNow) {
  // arrows only for the part you're learning; none in free play
  if (mode === "free" || !defend || songDone()) return [];   // no stream (round 4, the song-maker): no arrows
  const part = window.__gr && window.__gr.game && window.__gr.game.testPart;   // testPart: harness only, a fixed part looped
  if (part) return partArrows(part, (n) => LANE_INDEX[n], clock.first, 4 * partBars() * clock.beatDur, clock.beatDur, heardNow - 0.6, heardNow + APPROACH_S);
  // the STREAM's window: every occurrence in flight, at its own time
  return defend.offered().map((n) => ({ laneIdx: LANE_INDEX[n.lane], time: clock.first + n.at * clock.beatDur }))
    .filter((a) => a.laneIdx != null && a.time >= heardNow - 0.6 && a.time <= heardNow + APPROACH_S)
    .sort((a, b) => a.time - b.time);
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
  if (stage3d) stage3d.resize();   // the stage is built once the songs load; the chart below is sized regardless
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
    const up = buildUpcoming(heardNow);
    // ONE cue everywhere (owner, 2026-10-04): a rocket down its lane, for drums and every gun;
    // the guns' red buttons (stage3d's gun cues) light with them
    stage3d.setGunCues(defend ? up.filter((u) => u.laneIdx >= 6) : []);
    stage3d.update(heardNow, up, ghostHits);
    if (defend) tickDefend(heardNow);
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
  const ml = stage3d.fly ? 0 : 1;   // dev mode: only the arrows and a pad's stick turn by rate; the mouse turns directly
  stage3d.setLookInput(k("ArrowRight") - k("ArrowLeft") + pads.look.x + ml * mouseLook.x,
    k("ArrowUp") - k("ArrowDown") + pads.look.y + ml * mouseLook.y);
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
  if (stage3d && stage3d.fly) return;   // dev mode: clicks belong to the editor, not the drums, and no drag-look
  if (e.pointerType === "touch") lastTouch = performance.now();
  if (autoFromMenu && !ctx) { startBtn.click(); return; }
  if (armed && !clock) { beginCount(); return; }   // READY: the first tap starts the count
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
  // the touch's own timestamp, on the heard audio clock (like a key press)
  const o = ctx.getOutputTimestamp();
  if (lane >= 6 + BARS + 8) { hitCrystal(lane >= 6 + BARS + 12 ? 1 : 0, o.contextTime + (e.timeStamp - o.performanceTime) / 1000 - calibration); return; }   // a crystal
  const entry = lane >= 6 ? resolveGun(lane, o.contextTime + (e.timeStamp - o.performanceTime) / 1000 - calibration) : KEYMAP_BY_IDX[lane];   // a gun column's one button
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
function buildStage() {
  const s = SONGS[roundIdx] || SONGS[0];
  const plan = CREATE ? kitPlan(KIT_GROUPS) : kitPlan(kitFor(s).present);   // creating: every slot built (the song is empty)
  stage3d = createStage3D(stage, LAYOUT, DRUM_COLOR, { tier: TIER, kit: plan, touch: IS_TOUCH, phone: PHONE });
  bootlog("device", { phone: PHONE, touch: IS_TOUCH, tier: TIER });
  bootlog("stage3d built", { round: roundIdx + 1, kit: plan });
  loading.stageBuilt();
  if (new URLSearchParams(location.search).has("fly")) setTimeout(() => {   // dev: start in the free camera; &cam=x,y,z,yaw,pitch puts it somewhere exact
    toggleFly();
    const cam = new URLSearchParams(location.search).get("cam");
    if (cam) { const v = cam.split(",").map(Number); if (v.length === 5 && v.every(Number.isFinite)) stage3d.flyPose(...v); }
  }, 300);
  wireStage();
}
let autoFromMenu = false;   // the menu picked another round: the page reloaded into it — the next key starts it
roundsReady.then(() => {
  try { roundIdx = Math.max(0, Math.min(SONGS.length - 1, +(localStorage.getItem("gr.level") || 0))); } catch { roundIdx = 0; }
  if (HYDRA) roundIdx = HYDRA.rounds[0];   // the first movement is round 1's music
  buildStage();
  if (CREATE) { makeRecorder(); applyStage(); relabel(); return; }
  if (HYDRA) {   // round 4: no menu; Start (a click or any key) and the count
    Object.assign(RUN, normalize(JSON.parse(sessionStorage.getItem("gr.autostart") || "null") || RUN)); try { sessionStorage.removeItem("gr.autostart"); } catch { /* fine */ }
    applyStage(); hudUI.setPart(`Round 4 · The Hydra${HYDRA.title ? " · " + HYDRA.title : ""}`);
    autoFromMenu = true; startBtn.style.display = "none";
    hudUI.say(IS_TOUCH ? "Tap to begin" : "Press any key to begin — the hydra is waiting", "good");
    return;
  }   // the song-maker: its panel, then Start
  let auto = null;
  try { auto = JSON.parse(sessionStorage.getItem("gr.autostart") || "null"); sessionStorage.removeItem("gr.autostart"); } catch { auto = null; }
  if (auto) {   // straight into the round the menu picked: no menu, "press any key" (the key is the audio's gesture)
    Object.assign(RUN, normalize(auto)); buildLessons(); showDifficulty(); applyStage();
    autoFromMenu = true; startBtn.style.display = "none";
    hudUI.say(IS_TOUCH ? "Tap to begin" : padConnected ? "Press a button to begin" : "Press any key to begin", "good");
    return;
  }
  const list = LESSONS;
  let at = "title";
  try { at = sessionStorage.getItem("gr.menuAt") || "title"; sessionStorage.removeItem("gr.menuAt"); } catch { /* storage blocked: title */ }
  createMenu({
    levels: list.map((r) => ({ name: r.name, title: r.title, bpm: r.bpm, made: !!r.made })),
    hydras: levelGroups(list).map((g) => ({ ...g, open: g.rounds.every((i) => list[i].made || i <= unlockedLevel()) })),   // round 4 of each level: open once its round 3 is
    onHydra: goHydra,
    onOptions: (back) => settingsUI.open(back),
    onCreate: async (card, back) => {   // the song-maker's first screen draws in the menu card; Start writing reloads into the arena
      const worlds = await (await fetch("/banks/worlds.json")).json(), banks = await (await fetch(`/banks/${worlds[0].id}.json`)).json();
      pickSounds(card, { worlds, banks, onBack: back, onDone: (picks) => {
        try { sessionStorage.setItem("gr.create", JSON.stringify(picks)); } catch { /* storage blocked: the defaults */ }
        location.href = location.pathname + (sessionStorage.getItem("gr.create") ? "" : "?create=1");
      } });
    },
    unlocked: Math.min(unlockedLevel(), list.length - 1),
    level: +(localStorage.getItem("gr.level") || 0),
    run: RUN, startAt: at,
    onStart: (level, run) => {
      const saved = { ...run, lock: run.lock === Infinity ? "all" : run.lock };
      try { localStorage.setItem("gr.run2", JSON.stringify(saved)); localStorage.setItem("gr.level", level); } catch { /* not remembered */ }
      if (level !== roundIdx) {   // another round: its stage is built fresh on a reload, which goes straight to "press any key"
        try { sessionStorage.setItem("gr.autostart", JSON.stringify(saved)); } catch { /* fine */ }
        location.reload(); return;
      }
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
// test hook (the harness robot reads the song state through this)
if (window.__gr) window.__gr.game = {
  get clock() { return clock; }, get ctx() { return ctx; },
  get roundIdx() { return roundIdx; },
  setBackLevel: (v) => { for (const g of Object.values(backGain)) g.gain.value = v; },   // harness: backgrounds at full
  get defend() { return defend; }, get siege() { return siege; }, get lightning() { return lightning; },
  hitCrystal: (side) => hitCrystal(side, ctx.getOutputTimestamp().contextTime),   // harness only
  // fireGun: harness only
  fireGun: (idx, lane) => fireGun(idx, lane, ctx.getOutputTimestamp().contextTime),
  get life() { return life; }, laneOf: (i) => KEYMAP_BY_IDX[i] && KEYMAP_BY_IDX[i].ln.name,
  get hydra() { return HYDRA_MODE; },   // harness: round 4 (its fight, its highway)
  bigToDo: () => { const g = levelGroups(LESSONS).find((x) => x.rounds.includes(roundIdx)); if (g) bigToDo(g); },   // harness: the to-do without playing round 3
  get mixer() { return mixer; }, get pool() { return pool; }, laneSound: (ln, midi) => laneSound(ln, midi),
  backInfo: () => ({ bpm: BPM, songBpm: song().bpm, loopSeconds: +(song().bars * 4 * clock.beatDur).toFixed(3),
    stretched: [...backCache].map(([k, b]) => [k, +b.duration.toFixed(3)]) }),
  upcoming: () => (ctx ? buildUpcoming(ctx.getOutputTimestamp().contextTime) : []),
  part: () => currentPart(),
  song: () => song(),
  get hint() { return hint; },
  source: () => (songsFromFiles ? "files" : "built-in"),
  tier: TIER,
  backLevels: () => Object.fromEntries(Object.entries(backGain).map(([m, g]) => [m, +g.gain.value.toFixed(2)])),
  samples: () => [...sampleCache].map(([p, b]) => `${p}: ${b ? b.duration.toFixed(2) + " s" : "FAILED"}`), get calibration() { return calibration; }, get loops() { return loops; },
};   // screen or headset: the renderer drives the frames
