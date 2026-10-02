// Write each built-in round as ONE FULL SONG in Hackbeat (owner's layout,
// 2026-10-02): one track per sample, all playing together in one pattern —
//   Bass drum, snare, hihat, crash,
//   Bass instrument top, Bass instrument bottom,
//   Treble instrument top, Treble instrument bottom
// The game splits the song into teaching steps by difficulty. Swing is written
// into the notes (split rows), so Hackbeat plays exactly what the game plays.
//   node tools/make-song-files.mjs     -> Hackbeat/projects/garden-roundN.json
import fs from "node:fs";
import { ROUNDS } from "../src/game/stages.js";
import { instrumentNotes, BASS_OCTAVE, TREBLE_OCTAVE } from "../src/game/scales.js";

const TRACKS = [
  { name: "Bass drum", lane: "kick", sample: "garden/kick.wav" },
  { name: "snare", lane: "snare", sample: "garden/snare.wav" },
  { name: "hihat", lane: "hat", sample: "garden/hat.wav" },
  { name: "crash", lane: "crash", sample: "garden/crash.wav" },
  { name: "Bass instrument top", kind: "bass", row: 1, sample: "garden/bass_bars.wav" },
  { name: "Bass instrument bottom", kind: "bass", row: 0, sample: "garden/bass_bars.wav" },
  { name: "Treble instrument top", kind: "treble", row: 1, sample: "garden/treble_bars.wav" },
  { name: "Treble instrument bottom", kind: "treble", row: 0, sample: "garden/treble_bars.wav" },
];
const RPB = 8;
const fx = () => ({ nudge: 0, vol: 0.85, pan: 0, eq: { low: 0, mid: 0, high: 0 }, dist: { on: false, drive: 0.4 },
  crush: { on: false, bits: 8 }, chorus: { on: false, rate: 1.5, depth: 0.01, mix: 0.5 }, delay: { on: false, send: 0.3 },
  reverb: { on: false, send: 0.3 }, filter: { on: false, type: "lowpass", freq: 2000, q: 1 } });

ROUNDS.forEach((r, i) => {
  // the placeholder bar samples are recorded at C2 (bass) / C5 (treble): note 60 = that pitch
  const melodyNote = {
    bass: instrumentNotes({ key: r.key, scale: r.scale, octave: BASS_OCTAVE }).map((m) => 60 + m - 36),
    treble: instrumentNotes({ key: r.key, scale: r.scale, octave: TREBLE_OCTAVE }).map((m) => 60 + m - 72),
  };
  const bars = Math.max(...r.parts.map((p) => p.bars || 1));
  const rows = RPB * 4 * bars;
  const data = Array.from({ length: rows }, () => Array(TRACKS.length).fill(null));
  const place = (c, beat, cellNote) => {
    const pos = beat * RPB, row = Math.floor(pos + 1e-9), frac = pos - row;
    if (frac < 1e-6) { data[row][c] = cellNote; return; }
    const split = 3, slot = Math.round(frac * split);           // swung "and"s: a row split in thirds
    const cell = data[row][c] && data[row][c].split ? data[row][c] : { split, subs: Array(split).fill(null) };
    cell.subs[slot] = cellNote;
    data[row][c] = cell;
  };
  let dropped = 0;
  for (const p of r.parts) {
    const repeat = bars / (p.bars || 1);                          // a 1-bar drum part repeats under a longer melody
    for (const n of p.part) {
      const [kind, slotTxt] = n.lane.split(" ");
      let c, note;
      if ((kind === "bass" || kind === "treble") && /^\d$/.test(slotTxt || "")) {
        const bar = +slotTxt;
        c = TRACKS.findIndex((t) => t.kind === kind && t.row === (bar <= 4 ? 0 : 1));
        note = melodyNote[kind][bar - 1];
      } else {
        c = TRACKS.findIndex((t) => t.lane === n.lane);
        note = 60;
      }
      if (c < 0) { dropped++; continue; }                         // the toms: not in the owner's track list
      for (let k = 0; k < repeat; k++) place(c, n.beat + k * 4 * (p.bars || 1), { note, inst: c + 1, vol: n.vel == null || n.vel >= 1 ? null : Math.round(n.vel * 64) });
    }
  }
  const project = {
    version: 2, kind: "tracker", bpm: 80, rowsPerBeat: RPB,
    instruments: TRACKS.map((t) => ({ path: t.sample, name: t.name })),
    channels: TRACKS.map((t) => ({ name: t.name, mute: false, solo: false, fx: fx() })),
    patterns: [{ rows, data }], order: [0],
    fxBus: { reverbDecay: 1.4, delayTime: 0.3, delayFb: 0.35 },
    ui: { curPattern: 0, curInstrument: 0, cursor: { row: 0, ch: 0, sub: 0, slot: 0 }, octave: 5, masterVol: 1, showWave: true, showVU: true, zoom: 40 },
  };
  const out = new URL(`../../Hackbeat/projects/garden-round${i + 1}.json`, import.meta.url);
  fs.writeFileSync(out, JSON.stringify(project, null, 2));
  const count = data.flat().filter(Boolean).length;
  console.log(`garden-round${i + 1}: ${bars} bar(s), ${count} cells on ${TRACKS.length} tracks${dropped ? `, ${dropped} tom notes left out` : ""}`);
});
