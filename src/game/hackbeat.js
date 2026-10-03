/* hackbeat.js — a round's SONG lives in a Hackbeat project. Pure, no DOM.
 *
 * ONE FILE PER ROUND, ONE FULL SONG (owner, 2026-10-02): every track plays
 * together; the game decides how to teach it (lesson.js). Tracks are matched by
 * NAME, any order, any case — one track per sample:
 *   drums     "Bass drum" (or "kick"), "snare", "hihat" (or "hat"), "crash"
 *             (+ optional "tom low", "tom high")
 *   bars      "Bass instrument top" / "Bass instrument bottom",
 *             "Treble instrument top" / "Treble instrument bottom"
 *             (also "bass top" etc.) — each row is its own instrument with FOUR
 *             bars: the four note NAMES written on it, low -> high; OCTAVES FOLD
 *             (same name, other octave = same bar, sounding in the row's
 *             most-used octave). Bottom row = bars 1-4, top row = bars 5-8.
 *   back      "DRUM BACK", "BASS BACK", "TREBLE BACK" — background music that
 *             fades in as that section's steps lock, full when it's done
 *   anything else is ignored (with a warning).
 * The song is the patterns in play ORDER, end to end. A note's `inst` counts
 * from 1 (Hackbeat's slots 01, 02...); empty = Hackbeat's selected instrument.
 * The sample on a track is its sound, pitched like Hackbeat (note 60 = as
 * recorded). Volume column 0..64 (empty = full) is the velocity. Swing: write
 * it in Hackbeat (split a row in 3) or set `swing` in the round manifest.
 */
import { instrumentNotes, BASS_OCTAVE, TREBLE_OCTAVE } from "./scales.js";

export const DRUM_LANES = ["hat", "snare", "crash", "kick", "tom low", "tom high"];   // = lane index 0..5
export const BASE_NOTE = 60;
const DRUM_ALIASES = {
  kick: ["bass drum", "kick", "kick drum", "bd"], snare: ["snare", "snare drum", "sd"],
  hat: ["hihat", "hi hat", "hi-hat", "hat", "hh"], crash: ["crash", "crash cymbal", "cymbal"],
  "tom low": ["tom low", "low tom"], "tom high": ["tom high", "high tom"],
};
export const BACK_SECTIONS = ["drums", "bass", "treble"];

const norm = (s) => String(s || "").trim().toLowerCase().replace(/[\s_]+/g, " ");
/** what a track is: {drum} | {kind,row} | {back} | null */
export function trackRole(name) {
  const n = norm(name);
  for (const [lane, names] of Object.entries(DRUM_ALIASES)) if (names.includes(n)) return { drum: lane };
  const m = n.match(/^(bass|treble)( instrument)? (top|bottom)$/);
  if (m) return { kind: m[1], row: m[3] === "top" ? 1 : 0 };
  const b = n.match(/^(drum|drums|bass|treble) ?back$/);
  if (b) return { back: b[1].startsWith("drum") ? "drums" : b[1] };
  return null;
}

/** one Hackbeat cell -> [{frac, note, inst, vol}] (split cells = sub-row timing) */
export function cellEvents(cell) {
  if (!cell) return [];
  const off = +cell.off || 0;   // a note dragged off the grid in Hackbeat, in rows
  if (cell.split && cell.subs) {
    const out = [];
    cell.subs.forEach((sub, i) => { if (sub && sub.note != null) out.push({ frac: i / cell.split + off, note: sub.note, inst: sub.inst, vol: sub.vol }); });
    return out;
  }
  return cell.note != null ? [{ frac: off, note: cell.note, inst: cell.inst, vol: cell.vol }] : [];
}

const swingBeat = (b, swing) => (swing && Math.abs((b % 1) - 0.5) < 1e-6 ? Math.floor(b) + swing : b);
const round6 = (x) => Math.round(x * 1e6) / 1e6;
const mostUsed = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
const pcOf = (n) => ((n % 12) + 12) % 12;

/**
 * Hackbeat project -> the round's SONG.
 * @param {object} project a Hackbeat project (as saved)
 * @param {{name?:string, title?:string, swing?:number}} meta from the round manifest
 * @returns {{name, title, bpm, bars, notes, sounds, back, warnings}}
 *   notes: [{lane, beat, vel}] over the whole song; sounds: lane -> {path, note};
 *   back: {drums|bass|treble: [{beat, note, path, vel}]}
 */
export function roundFromProject(project, meta = {}) {
  const rpb = project.rowsPerBeat, barRows = rpb * 4;
  const warnings = [];
  const roles = project.channels.map((ch) => trackRole(ch.name));
  roles.forEach((r, c) => { if (!r) warnings.push(`track "${project.channels[c].name}" isn't one the game knows — ignored`); });
  const defaultInst = ((project.ui && project.ui.curInstrument) || 0) + 1;
  const instOf = (ev) => (ev.inst == null ? defaultInst : +ev.inst);
  const pathOf = (inst) => (project.instruments[inst - 1] || {}).path;   // slots count from 1
  // the slot's Pitch (semitones) + Tune (cents) from Hackbeat's voice panel
  const shiftOf = (inst) => { const i = project.instruments[inst - 1] || {}; return (+i.transpose || 0) + (+i.tune || 0) / 100; };
  // the song: patterns in play order, end to end
  const seq = [];
  let offsetBeats = 0;
  for (const pi of project.order) {
    const pat = project.patterns[pi];
    if (!pat) continue;
    const pb = Math.max(1, Math.round(pat.rows / barRows));
    seq.push({ pat, off: offsetBeats, pb });
    offsetBeats += pb * 4;
  }
  const bars = offsetBeats / 4;
  const events = [];   // {c, beat, ev}
  for (const { pat, off, pb } of seq) {
    for (let r = 0; r < Math.min(pat.rows, pb * barRows); r++) {
      (pat.data[r] || []).forEach((cell, c) => {
        if (!roles[c]) return;
        // the track's Nudge (ms, Hackbeat's per-track timing slide) in beats at the song's tempo
        const nudge = ((project.channels[c].fx && +project.channels[c].fx.nudge) || 0) / 1000 * (project.bpm || 120) / 60;
        for (const ev of cellEvents(cell)) events.push({ c, beat: round6(off + swingBeat((r + ev.frac) / rpb, meta.swing) + nudge), ev });
      });
    }
  }
  // each row's four bars: note NAMES (octaves fold), sounding in the most-used octave
  const rowUse = {};
  for (const { c, ev } of events) {
    const role = roles[c];
    if (role.kind == null) continue;
    const key = `${role.kind} ${role.row}`, pc = pcOf(ev.note);
    ((rowUse[key] ||= {})[pc] ||= {})[ev.note] = (rowUse[key][pc][ev.note] || 0) + 1;
  }
  const rowBars = {};   // "bass 0" -> [{pc, note}] low -> high, max 4
  for (const [key, byPc] of Object.entries(rowUse)) {
    const list = Object.entries(byPc).map(([pc, n]) => ({ pc: +pc, note: +mostUsed(n) })).sort((a, b) => a.note - b.note);
    const [kind, row] = key.split(" ");
    if (list.length > 4) warnings.push(`${kind} ${+row ? "top" : "bottom"}: ${list.length} different notes — a row has 4 bars, so the highest ${list.length - 4} are left out`);
    rowBars[key] = list.slice(0, 4);
  }
  const notes = [], back = { drums: [], bass: [], treble: [] };
  const instCount = {}, noteCount = {}, trackCount = {};
  for (const { c, beat, ev } of events) {
    const role = roles[c], vel = ev.vol == null ? 1 : ev.vol / 64;
    if (role.back) { const path = pathOf(instOf(ev)); if (path) back[role.back].push({ beat, note: ev.note + shiftOf(instOf(ev)), path, vel, track: c }); continue; }
    let lane;
    if (role.drum) {
      lane = role.drum;
      (noteCount[lane] ||= {})[ev.note] = (noteCount[lane][ev.note] || 0) + 1;
    } else {
      const slot = rowBars[`${role.kind} ${role.row}`].findIndex((b) => b.pc === pcOf(ev.note));
      if (slot < 0) continue;   // a left-out fifth note name
      lane = `${role.kind} ${role.row * 4 + slot + 1}`;
    }
    (instCount[lane] ||= {})[instOf(ev)] = (instCount[lane][instOf(ev)] || 0) + 1;
    (trackCount[lane] ||= {})[c] = (trackCount[lane][c] || 0) + 1;
    notes.push({ lane, beat, vel });
  }
  notes.sort((a, b) => a.beat - b.beat || a.lane.localeCompare(b.lane));
  const sounds = {};
  for (const [lane, counts] of Object.entries(instCount)) {
    const inst = +mostUsed(counts), path = pathOf(inst);
    if (!path) continue;
    // + the track it's written on: its effects play in the game too
    const extra = { track: +mostUsed(trackCount[lane]) };
    if (DRUM_LANES.includes(lane)) sounds[lane] = { path, note: +mostUsed(noteCount[lane]) + shiftOf(inst), ...extra };
    else {
      const [kind, bar] = lane.split(" ");
      sounds[lane] = { path, note: rowBars[`${kind} ${+bar > 4 ? 1 : 0}`][(+bar - 1) % 4].note + shiftOf(inst), ...extra };
    }
  }
  // every track's effects (EQ, pan, drive, crush, chorus, sends, volume) + the song's shared delay/reverb
  const tracks = project.channels.map((ch) => ({ name: ch.name, fx: { ...defaultFx(), ...(ch.fx || {}) } }));
  const fxBus = { reverbDecay: 2.0, delayTime: 0.3, delayFb: 0.35, ...(project.fxBus || {}) };
  return { name: meta.name || "Round", title: meta.title || "Untitled", bpm: project.bpm, bars, notes, sounds, back, tracks, fxBus, warnings };
}

function defaultFx() {
  return { nudge: 0, vol: 0.85, pan: 0, eq: { low: 0, mid: 0, high: 0 }, dist: { on: false, drive: 0.4 },
    crush: { on: false, bits: 8 }, chorus: { on: false, rate: 1.5, depth: 0.01, mix: 0.5 }, delay: { on: false, send: 0.3 },
    reverb: { on: false, send: 0.3 }, filter: { on: false, type: "lowpass", freq: 2000, q: 1 } };
}

/** the owner's track list for a round's song file */
export const SONG_TRACKS = [
  { name: "Bass drum", lane: "kick", sample: "garden/kick.wav" },
  { name: "snare", lane: "snare", sample: "garden/snare.wav" },
  { name: "hihat", lane: "hat", sample: "garden/hat.wav" },
  { name: "crash", lane: "crash", sample: "garden/crash.wav" },
  { name: "Bass instrument top", kind: "bass", row: 1, sample: "garden/bass_bars.wav" },
  { name: "Bass instrument bottom", kind: "bass", row: 0, sample: "garden/bass_bars.wav" },
  { name: "Treble instrument top", kind: "treble", row: 1, sample: "garden/treble_bars.wav" },
  { name: "Treble instrument bottom", kind: "treble", row: 0, sample: "garden/treble_bars.wav" },
];
export const BACK_TRACKS = ["DRUM BACK", "BASS BACK", "TREBLE BACK"];

/**
 * A built-in round -> ONE FULL SONG project in the owner's track layout (all
 * parts together, swing written into the notes as split rows). The toms aren't
 * in the owner's list: their notes are left out.
 * @returns {{project, dropped}}
 */
export function songProjectFromRound(round, { rowsPerBeat = 8, bpm = 80 } = {}) {
  // placeholder bar samples are recorded at C2 (bass) / C5 (treble): note 60 = that pitch
  const melodyNote = {
    bass: instrumentNotes({ key: round.key || "C", scale: round.scale || "major", octave: BASS_OCTAVE }).map((m) => 60 + m - 36),
    treble: instrumentNotes({ key: round.key || "C", scale: round.scale || "major", octave: TREBLE_OCTAVE }).map((m) => 60 + m - 72),
  };
  const T = SONG_TRACKS;
  const bars = Math.max(...round.parts.map((p) => p.bars || 1));
  const rows = rowsPerBeat * 4 * bars, width = T.length + BACK_TRACKS.length;
  const data = Array.from({ length: rows }, () => Array(width).fill(null));
  const place = (c, beat, cellNote) => {
    const pos = beat * rowsPerBeat, row = Math.floor(pos + 1e-9), frac = pos - row;
    if (frac < 1e-6) { data[row][c] = cellNote; return; }
    const split = 3, slot = Math.round(frac * split);            // swung "and"s: a row split in thirds
    const cell = data[row][c] && data[row][c].split ? data[row][c] : { split, subs: Array(split).fill(null) };
    cell.subs[slot] = cellNote;
    data[row][c] = cell;
  };
  let dropped = 0;
  for (const p of round.parts) {
    const repeat = bars / (p.bars || 1);                           // a 1-bar drum part repeats under a longer melody
    for (const n of p.part) {
      const [kind, slotTxt] = n.lane.split(" ");
      let c, note;
      if ((kind === "bass" || kind === "treble") && /^\d$/.test(slotTxt || "")) {
        const bar = +slotTxt;
        c = T.findIndex((t) => t.kind === kind && t.row === (bar <= 4 ? 0 : 1));
        note = melodyNote[kind][bar - 1];
      } else { c = T.findIndex((t) => t.lane === n.lane); note = BASE_NOTE; }
      if (c < 0) { dropped++; continue; }
      for (let k = 0; k < repeat; k++) place(c, n.beat + k * 4 * (p.bars || 1), { note, inst: c + 1, vol: n.vel == null || n.vel >= 1 ? null : Math.round(n.vel * 64) });
    }
  }
  return {
    dropped,
    project: {
      version: 2, kind: "tracker", bpm, rowsPerBeat,
      instruments: T.map((t) => ({ path: t.sample, name: t.name })),
      channels: [...T.map((t) => t.name), ...BACK_TRACKS].map((name) => ({ name, mute: false, solo: false, fx: defaultFx() })),
      patterns: [{ rows, data }], order: [0],
      fxBus: { reverbDecay: 1.4, delayTime: 0.3, delayFb: 0.35 },
      ui: { curPattern: 0, curInstrument: 0, cursor: { row: 0, ch: 0, sub: 0, slot: 0 }, octave: 5, masterVol: 1, showWave: true, showVU: true, zoom: 40 },
    },
  };
}
