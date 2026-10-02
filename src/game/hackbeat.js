/* hackbeat.js — rounds <-> Hackbeat projects. Pure, no DOM.
 *
 * A ROUND is authored as an ordinary Hackbeat project (Hackbeat stays
 * unchanged; we only agree on a layout):
 *   channels named like the game's drums -> the beat the arrows teach
 *        "hat", "snare", "crash", "kick", "tom low", "tom high" (any order,
 *        matched by name, case-insensitive); the sample you pick on that
 *        channel is the drum's sound for the round
 *   every other channel -> music for that section (melody, bass, pads...)
 *   each pattern in the play ORDER -> one part of the round; its first bar
 *        (4 beats) is the part
 * Swing: write it in Hackbeat (split a row in 3) or set `swing` in the game's
 * round manifest — straight "and"s are then played at that fraction (2/3 =
 * triplet shuffle).
 * Volume column 0..64 (empty = full) becomes the note's velocity.
 */

export const DRUM_LANES = ["hat", "snare", "crash", "kick", "tom low", "tom high"];   // = lane index 0..5
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

/**
 * Hackbeat project -> game round.
 * @param {object} project a Hackbeat project (as saved)
 * @param {{name?:string, title?:string, swing?:number}} meta from the game's round manifest
 */
export function roundFromProject(project, meta = {}) {
  const rpb = project.rowsPerBeat;
  const barRows = rpb * 4;
  const laneOfChannel = project.channels.map((ch) => {
    const n = String(ch.name || "").trim().toLowerCase();
    return DRUM_LANES.includes(n) ? n : null;
  });
  const used = new Set();
  const drumInst = {};   // lane -> {inst: count}
  const parts = project.order.map((pi, k) => {
    const pat = project.patterns[pi];
    const part = [], music = [];
    for (let r = 0; r < Math.min(pat.rows, barRows); r++) {
      const row = pat.data[r] || [];
      row.forEach((cell, c) => {
        for (const ev of cellEvents(cell)) {
          const beat = round6(swingBeat((r + ev.frac) / rpb, meta.swing));
          const vel = ev.vol == null ? 1 : ev.vol / 64;
          const lane = laneOfChannel[c];
          if (lane) {
            part.push({ lane, beat, vel });
            used.add(DRUM_LANES.indexOf(lane));
            (drumInst[lane] ||= {})[ev.inst] = ((drumInst[lane] || {})[ev.inst] || 0) + 1;
          } else {
            music.push({ ch: c, beat, note: ev.note, inst: ev.inst, vel });
          }
        }
      });
    }
    part.sort((a, b) => a.beat - b.beat || DRUM_LANES.indexOf(a.lane) - DRUM_LANES.indexOf(b.lane));
    // drums shown: every drum the round has used so far (the kit builds up part by part)
    return { label: `Part ${k + 1}`, show: [...used], part, music };
  });
  // each drum's sound: the sample used most on its channel
  const drumSamples = {};
  for (const [lane, counts] of Object.entries(drumInst)) {
    const inst = +Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    const it = project.instruments[inst];
    if (it) drumSamples[lane] = it.path;
  }
  return {
    name: meta.name || "Round",
    title: meta.title || "Untitled",
    bpm: project.bpm,
    swing: meta.swing || 0,
    parts,
    drumSamples,
    instruments: project.instruments,
  };
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
 * Game round -> Hackbeat project (the round's beats as patterns, the music
 * channels empty and ready for a melody). Swung beats are written straight:
 * the swing lives in the manifest.
 * @param {object} round {parts:[{part:[{lane,beat,vel?}]}], swing?}
 * @param {{bpm?:number, samples:Object<string,string>, rowsPerBeat?:number, music?:string[]}} opts
 *        samples: lane -> sample path (relative to Hackbeat's samples folder)
 */
export function projectFromRound(round, { bpm = 80, samples, rowsPerBeat = 8, music = ["melody", "bass", "pad", "extra"] } = {}) {
  const instruments = DRUM_LANES.map((lane) => ({ path: samples[lane], name: lane }));
  const channels = [...DRUM_LANES, ...music].map((name) => ({ name, mute: false, solo: false, fx: defaultFx() }));
  const rows = rowsPerBeat * 4;
  const unswing = (b) => (round.swing && Math.abs((b % 1) - round.swing) < 1e-6 ? Math.floor(b) + 0.5 : b);
  const patterns = round.parts.map(({ part }) => {
    const data = Array.from({ length: rows }, () => Array(channels.length).fill(null));
    for (const n of part) {
      const b = unswing(n.beat);
      const pos = b * rowsPerBeat;
      const r = Math.floor(pos + 1e-9), frac = pos - r;
      const c = DRUM_LANES.indexOf(n.lane);
      const note = { note: BASE_NOTE, inst: c, vol: n.vel == null || n.vel >= 1 ? null : Math.round(n.vel * 64) };
      if (frac < 1e-6) data[r][c] = note;
      else {
        // off the grid: split the row into thirds (triplet feel) and place the note in its slot
        const split = 3, slot = Math.round(frac * split);
        const cell = data[r][c] && data[r][c].split ? data[r][c] : { split, subs: Array(split).fill(null) };
        cell.subs[slot] = note;
        data[r][c] = cell;
      }
    }
    return { rows, data };
  });
  return {
    version: 2,
    kind: "tracker",
    bpm,
    rowsPerBeat,
    instruments,
    channels,
    patterns,
    order: patterns.map((_, i) => i),
    fxBus: { reverbDecay: 1.4, delayTime: 0.3, delayFb: 0.35 },
    ui: { curPattern: 0, curInstrument: 0, cursor: { row: 0, ch: 0, sub: 0, slot: 0 }, octave: 5, masterVol: 1, showWave: true, showVU: true, zoom: 40 },
  };
}
