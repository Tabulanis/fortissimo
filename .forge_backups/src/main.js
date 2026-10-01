/* main.js — Garden Rhythm beat core.
   Start button -> AudioContext (created inside the click), drums rendered,
   metronome click scheduled ahead of the audio clock, instant kick on F/Space
   with timing judged against the beat GRID (known in advance), mapped to
   velocity. Lane picture on the canvas, a timing histogram, and a
   calibration mode that removes the player's systematic offset. */

import "./audio/voices.js";
import { makeDrums } from "./audio/drums.js";
import { startClock } from "./audio/clock.js";
import { nearestOnGrid, nearestInLoop, velocityFor, label, OFF_CHART } from "./game/judge.js";
import { LAYOUT, CHART } from "./game/chart.js";
import { Ghosts } from "./game/ghosts.js";
import { SessionLog } from "./game/session.js";

const { VoicePool, VOICE_PRESETS, voiceSettings } = window.HB_VOICES;

const hud = document.querySelector("#hud");
const stage = document.querySelector("#stage");
const ctx2d = stage.getContext("2d");
const BPM = 100;
const CALIB_KEY = "gr.calib";

let ctx = null;
let masterGain = null;
let drums = null;
let pool = null;
let clock = null;

// --- timing chart ---------------------------------------------------------
let offsets = [];          // every press offset (ms), after calibration
let flashes = [];          // lane-segment flashes: { idx, kind, until }

// --- drum-mode lane map ----------------------------------------------------
// key -> { lane index (0..9), lane } built once from the layout.
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
    "position:fixed;top:8px;right:90px;z-index:11;font:14px monospace;" +
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
    "position:fixed;top:8px;right:8px;z-index:11;font:14px monospace;" +
    "padding:6px 14px;background:#123;color:#8f8;border:1px solid #8f8;cursor:pointer";
  btn.addEventListener("click", async () => {
    if (ctx) return;
    ctx = new AudioContext();
    await ctx.resume();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.8;
    masterGain.connect(ctx.destination);

    drums = await makeDrums(ctx.sampleRate);
    pool = new VoicePool(ctx);

    clock = startClock(ctx, {
      bpm: BPM,
      onBeat: (time, n) => {
        pool.noteOn({
          channel: 0,
          midi: 72,
          baseNote: 60,
          buffer: drums.click,
          velocity: 0.5,
          when: time,
          destination: masterGain,
          settings: voiceSettings({ voice: VOICE_PRESETS["One shot"] }),
        });
      },
    });

    ghosts = new Ghosts(CHART.loopBeats * clock.beatDur);
    session = new SessionLog({
      bpm: BPM,
      loopBeats: CHART.loopBeats,
      layout: LAYOUT,
    });
    scheduledUntil = clock.first;
    setInterval(scheduleGhosts, 25);

    btn.remove();
    hud.textContent = modeStr();
  });
  document.body.appendChild(btn);
  return btn;
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
      channel: entry.idx + 10,
      midi: 60,
      baseNote: 60,
      buffer: drums[entry.ln.drum],
      velocity: e.velocity * 0.5,
      when: e.time,
      destination: masterGain,
      settings: voiceSettings({ voice: VOICE_PRESETS["One shot"] }),
    });
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

  if (e.key === "g" || e.key === "G") {
    e.preventDefault();
    ghostsOn = !ghostsOn;
    return;
  }

  if (e.key === "m" || e.key === "M") {
    e.preventDefault();
    mode = mode === "drum" ? "free" : "drum";
    if (clock) hud.textContent = modeStr();
    return;
  }

  if (e.key === "p" || e.key === "P") {
    e.preventDefault();
    saveSession();
    return;
  }

  if (e.key === "f" || e.key === "F" || e.key === " ") {
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
      destination: masterGain,
      settings: voiceSettings({ voice: VOICE_PRESETS["One shot"] }),
    });
    recordPress(j.offset, vel, "kick", label(j.offset));
    return;
  }

  const entry = KEYMAP[e.key];
  if (!entry) return;   // keys outside the layout do nothing, HUD untouched
  e.preventDefault();
  const { idx, ln: lane } = entry;

  // timing against this lane's chart notes, loop-wrapped
  const j = nearestInLoop(
    CHART.notes[lane.drum], CHART.loopBeats,
    clock.first, clock.beatDur, press,
  );
  // off-chart: no note nearby at all — play quietly, label OFF, stay out of the chart
  const free = mode === "free";
  let vel, lab, off = false;
  if (free) {
    // freestyle: no judgement, no timing-chart entry — always full velocity
    vel = 1.0;
    lab = "FREE";
  } else {
    // off-chart: no note nearby at all — play quietly, label OFF, stay out of the chart
    off = !j || Math.abs(j.offset) > OFF_CHART;
    vel = off ? 0.15 : velocityFor(j.offset);
    lab = off ? "OFF" : label(j.offset);
  }

  // record exactly as played (real timing, real velocity, mistakes and OFF
  // included) — it becomes this lane's ghost from the next pass on
  if (ghosts) ghosts.record(lane.name, press, vel, clock.first);

  // the player IS the instrument: play immediately, on this lane's channel
  pool.noteOn({
    channel: idx,
    midi: 60,
    baseNote: 60,
    buffer: drums[lane.drum],
    velocity: vel,
    when: ctx.currentTime,
    destination: masterGain,
    settings: voiceSettings({ voice: VOICE_PRESETS["One shot"] }),
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

  recordPress(idx, free ? null : (off ? null : j.offset), vel, lane.name, lab);
}

// --- freestyle + save -------------------------------------------------------
function modeStr() {
  return `${mode === "free" ? "FREESTYLE" : "DRUM"}  [M] mode   [P] save`;
}

function saveSession() {
  if (!session || !clock) return;
  const data = session.toJSON(clock.first, ghosts);
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
    ? `  ghosts: ${ghosts.lanes.length} lanes (${ghostsOn ? "on" : "off"}) [G]`
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

// --- highway picture -------------------------------------------------------
const TOP_HIT_FRAC = 0.42;   // top hit line at 42% of the playfield height
const BOT_HIT_FRAC = 0.58;   // bottom hit line at 58%
const PX_PER_S = 300;        // approach speed, px/s
const LANE_W = 90;           // highway lane width, CSS px

const CHART_BAND = 120;   // chart band, CSS px, pinned to the bottom

// --- drum colours ----------------------------------------------------------
const DRUM_COLOR = {
  hat: "#8ac", snare: "#f8a", crash: "#ce8",
  kick: "#a8f", tomLow: "#da6", tomHigh: "#fa4",
};

// geometry cache, refreshed on resize
let geo = null;
function computeGeo() {
  const W = stage.clientWidth, H = stage.clientHeight;
  const pfH = H - CHART_BAND;
  const top = {
    hitY: pfH * TOP_HIT_FRAC,
    x0: W / 2 - (LAYOUT.top.length * LANE_W) / 2,
  };
  const bot = {
    hitY: pfH * BOT_HIT_FRAC,
    x0: W / 2 - (LAYOUT.bottom.length * LANE_W) / 2,
  };
  geo = { W, H, pfH, top, bot };
}

function laneX(side, i) {
  return (side === "top" ? geo.top.x0 : geo.bot.x0) + i * LANE_W + LANE_W / 2;
}

function drawHighway(now) {
  const heardNow = ctx.getOutputTimestamp().contextTime;
  const nowP = performance.now();
  const lanes = [...LAYOUT.top, ...LAYOUT.bottom];

  // faint lane dividers + hit segments (flashing after a press)
  for (const side of ["top", "bot"]) {
    const row = side === "top" ? LAYOUT.top : LAYOUT.bottom;
    const x0 = side === "top" ? geo.top.x0 : geo.bot.x0;
    ctx2d.strokeStyle = "#1a222a";
    ctx2d.lineWidth = 1;
    for (let i = 0; i <= row.length; i++) {
      const x = x0 + i * LANE_W;
      ctx2d.beginPath();
      ctx2d.moveTo(x, 0);
      ctx2d.lineTo(x, geo.pfH);
      ctx2d.stroke();
    }
    // hit segments, flashing per lane after a press
    const hitY = side === "top" ? geo.top.hitY : geo.bot.hitY;
    for (let i = 0; i < row.length; i++) {
      const x = x0 + i * LANE_W;
      let color = "#345", width = 1.5;
      for (const f of flashes) {
        const gi = (side === "top" ? f.idx : f.idx + LAYOUT.top.length);
        if (gi !== i || nowP >= f.until) continue;
        color = f.kind === "hit" ? "#4f4" : f.kind === "off" ? "#888" : "#fa0";
        width = 4;
      }
      ctx2d.strokeStyle = color;
      ctx2d.lineWidth = width;
      ctx2d.beginPath();
      ctx2d.moveTo(x + 4, hitY);
      ctx2d.lineTo(x + LANE_W - 4, hitY);
      ctx2d.stroke();
    }
  }
  flashes = flashes.filter((f) => nowP < f.until);

  // notes within the next 2 s
  for (let li = 0; li < lanes.length; li++) {
    const lane = lanes[li];
    const side = li < LAYOUT.top.length ? "top" : "bot";
    const li2 = side === "top" ? li : li - LAYOUT.top.length;
    const hitY = side === "top" ? geo.top.hitY : geo.bot.hitY;
    const beats = CHART.notes[lane.drum];
    if (!beats.length) continue;
    const period = CHART.loopBeats * clock.beatDur;
    const kLo = Math.floor((heardNow - clock.first) / period) - 1;
    const color = DRUM_COLOR[lane.drum] || "#8ac";
    for (let k = Math.max(0, kLo); k <= kLo + 2; k++) {
      for (const b of beats) {
        const noteTime = clock.first + (k * CHART.loopBeats + b) * clock.beatDur;
        const dt = noteTime - heardNow;
        if (dt < -0.12 || dt > 2) continue;
        // after its time a note clamps to the hit line and fades out
        const alpha = dt >= 0 ? 1 : 1 + dt / 0.12;
        let y = side === "top"
          ? geo.top.hitY - dt * PX_PER_S
          : geo.bot.hitY + dt * PX_PER_S;
        if (dt < 0) y = hitY;   // never past the hit line, fade in place
        if (y < -20 || y > geo.pfH + 20) continue;
        const x = laneX(side, li2);
        ctx2d.globalAlpha = alpha;
        ctx2d.beginPath();
        ctx2d.arc(x, y, 8, 0, Math.PI * 2);
        ctx2d.fillStyle = color;
        ctx2d.fill();
        ctx2d.globalAlpha = 1;
      }
    }
  }

  // ghost hits: small HOLLOW circles of the lane colour, moving like notes
  if (ghosts && ghostsOn) {
    for (const ev of ghosts.events(
      heardNow, heardNow + 2, clock.first,
    )) {
      const entry = KEYMAP_BY_LANE[ev.lane];
      if (!entry) continue;
      const side = entry.idx < LAYOUT.top.length ? "top" : "bot";
      const li2 = side === "top" ? entry.idx : entry.idx - LAYOUT.top.length;
      const dt = ev.time - heardNow;
      if (dt < -0.12 || dt > 2) continue;
      const alpha = dt >= 0 ? 1 : 1 + dt / 0.12;
      const hitY = side === "top" ? geo.top.hitY : geo.bot.hitY;
      let y = side === "top"
        ? geo.top.hitY - dt * PX_PER_S
        : geo.bot.hitY + dt * PX_PER_S;
      if (dt < 0) y = hitY;   // never past the hit line, fade in place
      if (y < -20 || y > geo.pfH + 20) continue;
      const x = laneX(side, li2);
      const color = DRUM_COLOR[entry.ln.drum] || "#8ac";
      ctx2d.globalAlpha = alpha;
      ctx2d.beginPath();
      ctx2d.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx2d.strokeStyle = color;
      ctx2d.lineWidth = 1.5;
      ctx2d.stroke();
      ctx2d.globalAlpha = 1;
    }
  }

  // key letter (uppercase) + lane name in the middle gap between the
  // two hit lines: top labels just below the top line, bottom labels
  // just above the bottom line.
  ctx2d.textAlign = "center";
  ctx2d.font = "16px monospace";
  for (let i = 0; i < LAYOUT.top.length; i++) {
    const x = laneX("top", i);
    ctx2d.fillStyle = "#cde";
    ctx2d.fillText(LAYOUT.top[i].key.toUpperCase(), x, geo.top.hitY + 20);
    ctx2d.fillStyle = "#567";
    ctx2d.font = "10px monospace";
    ctx2d.fillText(LAYOUT.top[i].name, x, geo.top.hitY + 40);
    ctx2d.font = "16px monospace";
  }
  for (let i = 0; i < LAYOUT.bottom.length; i++) {
    const x = laneX("bot", i);
    ctx2d.fillStyle = "#cde";
    ctx2d.fillText(LAYOUT.bottom[i].key.toUpperCase(), x, geo.bot.hitY - 20);
    ctx2d.fillStyle = "#567";
    ctx2d.font = "10px monospace";
    ctx2d.fillText(LAYOUT.bottom[i].name, x, geo.bot.hitY - 40);
    ctx2d.font = "16px monospace";
  }
  ctx2d.textAlign = "left";
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  stage.width = Math.round(stage.clientWidth * dpr);
  stage.height = Math.round(stage.clientHeight * dpr);
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  computeGeo();
}

function drawLane(now) {
  const W = stage.clientWidth, H = stage.clientHeight;
  ctx2d.fillStyle = "#0b0e11";
  ctx2d.fillRect(0, 0, W, H);

  if (clock && ctx) drawHighway(now);

  drawChart(now);
}

// --- timing chart ----------------------------------------------------------
const BIN_MS = 10, LO = -150, NBINS = 30;

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function stddev(xs) {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length);
}

function drawChart() {
  const W = stage.clientWidth, H = stage.clientHeight;
  const chH = CHART_BAND;
  const top = H - chH;

  ctx2d.fillStyle = "rgba(10,14,18,0.9)";
  ctx2d.fillRect(0, top, W, chH);
  ctx2d.strokeStyle = "#223";
  ctx2d.strokeRect(0.5, top + 0.5, W - 1, chH - 1);

  if (!offsets.length) {
    ctx2d.fillStyle = "#456";
    ctx2d.font = "11px monospace";
    ctx2d.fillText("no presses yet", 8, top + 16);
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
    const h = max ? (bins[i] / max) * (chH - 24) : 0;
    ctx2d.fillStyle = "#2a6";
    ctx2d.fillRect(10 + i * bw, top + chH - 4 - h, Math.max(1, bw - 1), h);
  }

  const m = mean(offsets), sd = stddev(offsets);
  ctx2d.fillStyle = "#8f8";
  ctx2d.font = "11px monospace";
  ctx2d.fillText(
    `n ${offsets.length}   mean ${m >= 0 ? "+" : ""}${m.toFixed(1)} ms   ` +
    `spread ${sd.toFixed(1)} ms`,
    10, top + 14,
  );
}

function frame() {
  drawLane(performance.now());
  requestAnimationFrame(frame);
}

makeStartButton();
makeCalibrateButton();
window.addEventListener("keydown", onKey);
resize();
window.addEventListener("resize", resize);
requestAnimationFrame(frame);
