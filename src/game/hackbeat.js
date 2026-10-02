/* hackbeat.js — rounds <-> Hackbeat projects. Pure, no DOM.
 *
 * A ROUND is authored as an ordinary Hackbeat project (Hackbeat stays
 * unchanged; we only agree on channel NAMES, any order, any case):
 *   "hat" "snare" "crash" "kick" "tom low" "tom high"   the six drums
 *   "bass bottom"   "bass top"                          the bass station's two rows
 *   "treble bottom" "treble top"                        the treble station's two rows
 *   anything else                                       backing music
 * Each ROW is its own instrument with FOUR bars: the four different notes you
 * write on that channel across the song, low -> high. OCTAVES FOLD (owner):
 * the same note name in another octave is the same bar, and the bar sounds in
 * the octave used most on that row (freestyle mode will get an octave switch) (owner, 2026-10-02: e.g.
 * bass top = horns, bass bottom = bells; treble top = xylophone, bottom =
 * strings). Bottom row = bars 1-4 (D-pad), top row = bars 5-8 (X A B Y).
 * SOUNDS come from the project: the sample on a channel is that drum's / row's
 * sound, pitched exactly like Hackbeat pitches it (note 60 = the sample as
 * recorded) — what you hear in Hackbeat is what the game plays.
 * PARTS: each pattern in the play ORDER is one part, as long as the pattern
 * (whole bars), in the mode of the instrument it uses (drums / bass / treble).
 * Swing: write it in Hackbeat (split a row in 3) or set `swing` in the round
 * manifest — straight "and"s are then played at that fraction.
 * Volume column 0..64 (empty = full) becomes the note's velocity.
 * A note's `inst` counts from 1 (Hackbeat's slots 01, 02...); empty = the
 * instrument selected in Hackbeat (ui.curInstrument, from 0).
 */

export const DRUM_LANES = ["hat", "snare", "crash", "kick", "tom low", "tom high"];   // = lane index 0..5
export const ROW_CHANNELS = {
  "bass bottom": { kind: "bass", row: 0 }, "bass top": { kind: "bass", row: 1 },
  "treble bottom": { kind: "treble", row: 0 }, "treble top": { kind: "treble", row: 1 },
};
export const BASE_NOTE = 60;   // Hackbeat plays a sample at its own pitch on C-5

/** one Hackbeat cell -> [{frac, note, inst, vol}] (split cells = sub-row timing) */
export function cellEvents(cell) {
  if (!cell) return [];
  if (cell.split && cell.subs) {
    const out = [];
    cell.subs.forEach((sub, i) => { if (sub && sub.note != null) out.push({ frac: i / cell.split, note: sub.note, inst: sub.inst, vol: sub.vol }); });
    return out;
  }
  return cell.note != null ? [{ frac: 0, note: cell.note, inst: cell.inst, vol: cell.vol }] : [];
}

const swingBeat = (b, swing) => (swing && Math.abs((b % 1) - 0.5) < 1e-6 ? Math.floor(b) + swing : b);
const round6 = (x) => Math.round(x * 1e6) / 1e6;
const nameOf = (ch) => String(ch.name || "").trim().toLowerCase();
const mostUsed = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];

/**
 * Hackbeat project -> game round.
 * @param {object} project a Hackbeat project (as saved)
 * @param {{name?:string, title?:string, swing?:number}} meta from the game's round manifest
 * @returns {{name, title, bpm, swing, parts, sounds, warnings}}
 *   sounds: lane -> {path, note} (sample path relative to the samples folder, Hackbeat note)
 */
export function roundFromProject(project, meta = {}) {
  const rpb = project.rowsPerBeat, barRows = rpb * 4;
  const warnings = [];
  const drumOf = project.channels.map((ch) => (DRUM_LANES.includes(nameOf(ch)) ? nameOf(ch) : null));
  const rowOf = project.channels.map((ch) => ROW_CHANNELS[nameOf(ch)] || null);
  const patterns = project.order.map((pi) => project.patterns[pi]).filter(Boolean);

  // pass 1: each row's four bars = the distinct NOTE NAMES written on it
  // (octaves fold), each sounding in its most-used octave, low -> high
  const rowUse = {};                                     // "bass 0" -> {pitch class: {note: count}}
  patterns.forEach((pat) => pat.data.forEach((row) => row.forEach((cell, c) => {
    if (!rowOf[c]) return;
    const key = `${rowOf[c].kind} ${rowOf[c].row}`;
    for (const ev of cellEvents(cell)) {
      const pc = ((ev.note % 12) + 12) % 12;
      ((rowUse[key] ||= {})[pc] ||= {})[ev.note] = ((rowUse[key][pc] || {})[ev.note] || 0) + 1;
    }
  })));
  const rowNotes = {};                                   // "bass 0" -> the bars' sounding notes, low -> high
  const rowPc = {};                                      // "bass 0" -> the bars' pitch classes, same order
  for (const [key, byPc] of Object.entries(rowUse)) {
    const bars = Object.entries(byPc).map(([pc, notes]) => ({ pc: +pc, note: +mostUsed(notes) })).sort((a, b) => a.note - b.note);
    if (bars.length > 4) warnings.push(`${project.channels[rowOf.findIndex((r) => r && `${r.kind} ${r.row}` === key)].name}: ${bars.length} different notes — a row has 4 bars, so the highest ${bars.length - 4} are left out`);
    rowNotes[key] = bars.slice(0, 4).map((b) => b.note);
    rowPc[key] = bars.slice(0, 4).map((b) => b.pc);
  }

  // pass 2: the parts
  const used = new Set();
  const instCount = {};                                  // lane -> {inst: n};  noteCount: drum lane -> {note: n}
  const noteCount = {};
  const parts = patterns.map((pat, k) => {
    const part = [], music = [];
    const bars = Math.max(1, Math.round(pat.rows / barRows));
    for (let r = 0; r < Math.min(pat.rows, barRows * bars); r++) {
      (pat.data[r] || []).forEach((cell, c) => {
        for (const ev of cellEvents(cell)) {
          const beat = round6(swingBeat((r + ev.frac) / rpb, meta.swing));
          const vel = ev.vol == null ? 1 : ev.vol / 64;
          if (ev.inst == null) ev.inst = ((project.ui && project.ui.curInstrument) || 0) + 1;   // empty = Hackbeat's selected instrument
          const drum = drumOf[c], row = rowOf[c];
          if (drum) {
            part.push({ lane: drum, beat, vel });
            used.add(DRUM_LANES.indexOf(drum));
            (instCount[drum] ||= {})[ev.inst] = (instCount[drum][ev.inst] || 0) + 1;
            (noteCount[drum] ||= {})[ev.note] = (noteCount[drum][ev.note] || 0) + 1;
          } else if (row) {
            const slot = rowPc[`${row.kind} ${row.row}`].indexOf(((ev.note % 12) + 12) % 12);   // octaves fold
            if (slot < 0) continue;                       // one of the left-out notes
            const lane = `${row.kind} ${row.row * 4 + slot + 1}`;
            part.push({ lane, beat, vel });
            (instCount[`${row.kind} ${row.row}`] ||= {})[ev.inst] = (instCount[`${row.kind} ${row.row}`][ev.inst] || 0) + 1;
          } else {
            music.push({ ch: c, beat, note: ev.note, inst: ev.inst, vel });
          }
        }
      });
    }
    part.sort((a, b) => a.beat - b.beat || a.lane.localeCompare(b.lane));
    const tally = { drums: 0, bass: 0, treble: 0 };
    for (const n of part) tally[n.lane.startsWith("bass ") ? "bass" : n.lane.startsWith("treble ") ? "treble" : "drums"]++;
    const mode = Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
    const mixed = Object.values(tally).filter(Boolean).length > 1;
    if (mixed) warnings.push(`pattern ${k + 1} mixes ${Object.keys(tally).filter((m) => tally[m]).join(" + ")} — it plays as a ${mode} part`);
    const label = mode === "drums" ? `Drums ${k + 1}` : mode === "bass" ? "Bass" : "Treble";
    return { label, mode, bars, show: [...used], part, music };
  });

  // the sounds: each drum / bar -> the sample used on its channel, at its pitch
  const sounds = {};
  const pathOf = (inst) => (project.instruments[+inst - 1] || {}).path;   // Hackbeat slots count from 1
  for (const drum of DRUM_LANES) {
    if (instCount[drum]) sounds[drum] = { path: pathOf(mostUsed(instCount[drum])), note: +mostUsed(noteCount[drum]) };
  }
  for (const [key, notes] of Object.entries(rowNotes)) {
    const [kind, row] = key.split(" ");
    const path = instCount[key] ? pathOf(mostUsed(instCount[key])) : null;
    notes.forEach((note, i) => { if (path) sounds[`${kind} ${+row * 4 + i + 1}`] = { path, note }; });
  }
  return { name: meta.name || "Round", title: meta.title || "Untitled", bpm: project.bpm, swing: meta.swing || 0, parts, sounds, warnings };
}

function defaultFx() {
  return {
    nudge: 0, vol: 0.85, pan: 0.0,
    eq: { low: 0, mid: 0, high: 0 },
    dist: { on: false, drive: 0.4 },
    crush: { on: false, bits: 8 },
    chorus: { on: false, rate: 1.5, depth: 0.01, mix: 0.5 },
    delay: { on: false, send: 0.3 },
    reverb: { on: false, send: 0.3 },
    filter: { on: false, type: "lowpass", freq: 2000, q: 1 },
  };
}

/**
 * Game round -> Hackbeat project in the row layout (so the built-in songs can
 * be opened in Hackbeat and rewritten). Swung beats are written straight: the
 * swing lives in the manifest.
 * @param {object} round {parts:[{part:[{lane,beat,vel?}], bars?}], swing?}
 * @param {{bpm?:number, samples:Object<string,string>, melody:{bass:{path:string,notes:number[]}, treble:{path:string,notes:number[]}}, rowsPerBeat?:number}} opts
 *   samples: drum lane -> sample path; melody[kind].notes: the 8 bars' Hackbeat notes (bars 1-8)
 */
export function projectFromRound(round, { bpm = 80, samples, melody, rowsPerBeat = 8 } = {}) {
  const ROWS = ["bass bottom", "bass top", "treble bottom", "treble top"];
  const instruments = [...DRUM_LANES.map((lane) => ({ path: samples[lane], name: lane })),
    { path: melody.bass.path, name: "bass" }, { path: melody.treble.path, name: "treble" }];
  const channels = [...DRUM_LANES, ...ROWS, "backing 1", "backing 2"].map((name) => ({ name, mute: false, solo: false, fx: defaultFx() }));
  const unswing = (b) => (round.swing && Math.abs((b % 1) - round.swing) < 1e-6 ? Math.floor(b) + 0.5 : b);
  const patterns = round.parts.map(({ part, bars = 1 }) => {
    const rows = rowsPerBeat * 4 * bars;
    const data = Array.from({ length: rows }, () => Array(channels.length).fill(null));
    for (const n of part) {
      const [kind, slotTxt] = n.lane.split(" ");
      const bar = (kind === "bass" || kind === "treble") && /^\d$/.test(slotTxt || "") ? +slotTxt : 0;
      let c, inst, note;
      if (bar) {
        c = channels.findIndex((ch) => ch.name === `${kind} ${bar <= 4 ? "bottom" : "top"}`);
        inst = DRUM_LANES.length + (kind === "bass" ? 1 : 2);   // slots count from 1
        note = melody[kind].notes[bar - 1];
      } else {
        c = DRUM_LANES.indexOf(n.lane); inst = c + 1; note = BASE_NOTE;
      }
      if (c < 0) continue;
      const cellNote = { note, inst, vol: n.vel == null || n.vel >= 1 ? null : Math.round(n.vel * 64) };
      const pos = unswing(n.beat) * rowsPerBeat;
      const r = Math.floor(pos + 1e-9), frac = pos - r;
      if (frac < 1e-6) data[r][c] = cellNote;
      else {
        // off the grid: split the row into thirds (triplet feel) and place the note in its slot
        const split = 3, slot = Math.round(frac * split);
        const cell = data[r][c] && data[r][c].split ? data[r][c] : { split, subs: Array(split).fill(null) };
        cell.subs[slot] = cellNote;
        data[r][c] = cell;
      }
    }
    return { rows, data };
  });
  return {
    version: 2, kind: "tracker", bpm, rowsPerBeat, instruments, channels, patterns,
    order: patterns.map((_, i) => i),
    fxBus: { reverbDecay: 1.4, delayTime: 0.3, delayFb: 0.35 },
    ui: { curPattern: 0, curInstrument: 0, cursor: { row: 0, ch: 0, sub: 0, slot: 0 }, octave: 5, masterVol: 1, showWave: true, showVU: true, zoom: 40 },
  };
}
