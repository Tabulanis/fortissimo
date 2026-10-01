/* main.js — Garden Rhythm beat core.
   Start button -> AudioContext (created inside the click), drums rendered,
   metronome click scheduled ahead of the audio clock, instant kick on F/Space
   with timing judged against the beat GRID (known in advance), mapped to
   velocity. Lane picture on the canvas, a timing histogram, and a
   calibration mode that removes the player's systematic offset. */

import "./audio/voices.js";
import { makeDrums } from "./audio/drums.js";
import { startClock } from "./audio/clock.js";
import { nearestOnGrid, velocityFor, label } from "./game/judge.js";

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
let flashUntil = 0;        // performance-time until which the hit line flashes
let flashHit = false;

// --- calibration ----------------------------------------------------------
let calibration = loadCalib();   // seconds, subtracted from every press time
let calib = null;                // active session: { hits: number[] }

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

    btn.remove();
  });
  document.body.appendChild(btn);
  return btn;
}

function onKey(e) {
  // start-up guard: drums, pool and clock must all exist before a press
  if (e.repeat || !ctx || !drums || !pool || !clock) return;
  if (e.key !== "f" && e.key !== "F" && e.key !== " ") return;
  e.preventDefault();

  // press time on the audio clock, from the event's own timestamp
  const ts = ctx.getOutputTimestamp();
  let press = ts.contextTime + (e.timeStamp - ts.performanceTime) / 1000;

  // calibration removes the player's systematic offset before judging
  press -= calibration;
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

  const ms = j.offset * 1000;
  flashHit = label(j.offset) === "HIT";
  flashUntil = performance.now() + 120;

  if (calib) {
    calib.hits.push(j.offset);
    if (calib.hits.length >= 16) {
      calibration = median(calib.hits);
      try { localStorage.setItem(CALIB_KEY, String(calibration)); } catch {}
      calib = null;
    }
  } else {
    offsets.push(ms);
  }

  hud.textContent =
    `${label(j.offset)}  ${ms >= 0 ? "+" : ""}${ms.toFixed(1)} ms  ` +
    `vel ${vel.toFixed(2)}  lat ${(ctx.outputLatency * 1000).toFixed(1)} ms  ` +
    `calib: ${calibration >= 0 ? "+" : ""}${(calibration * 1000).toFixed(1)} ms`;
}

// --- lane picture ----------------------------------------------------------
const HIT_FRAC = 0.8;      // hit line at 80% down
const PX_PER_S = 300;      // approach speed, px/s

const CHART_BAND = 120;   // chart band, CSS px, pinned to the bottom

function resize() {
  const dpr = window.devicePixelRatio || 1;
  stage.width = Math.round(stage.clientWidth * dpr);
  stage.height = Math.round(stage.clientHeight * dpr);
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawLane(now) {
  const W = stage.clientWidth, H = stage.clientHeight;
  ctx2d.fillStyle = "#0b0e11";
  ctx2d.fillRect(0, 0, W, H);

  const laneX = W / 2;
  const laneH = H - CHART_BAND;
  const hitY = laneH * HIT_FRAC;

  // upcoming beats from the grid, next 2 seconds
  if (clock && ctx) {
    const heardNow = ctx.getOutputTimestamp().contextTime;
    for (let t = heardNow; t < heardNow + 2; t += clock.beatDur) {
      const idx = Math.round((t - clock.first) / clock.beatDur);
      const beatT = clock.first + idx * clock.beatDur;
      const y = hitY - (beatT - heardNow) * PX_PER_S;
      if (y < -20 || y > H + 20) continue;
      ctx2d.beginPath();
      ctx2d.arc(laneX, y, 9, 0, Math.PI * 2);
      ctx2d.fillStyle = "#345";
      ctx2d.fill();
      ctx2d.strokeStyle = "#8f8";
      ctx2d.lineWidth = 1.5;
      ctx2d.stroke();
    }
  }

  // hit line, flashing after each press
  const flashing = performance.now() < flashUntil;
  ctx2d.strokeStyle = flashing
    ? (flashHit ? "#4f4" : "#fa0")
    : "#345";
  ctx2d.lineWidth = flashing ? 4 : 1.5;
  ctx2d.beginPath();
  ctx2d.moveTo(laneX - 40, hitY);
  ctx2d.lineTo(laneX + 40, hitY);
  ctx2d.stroke();

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
