/* maker.js — the SONG-MAKER's core, pure (owner, 2026-10-07: "Create" on the main menu — pick the
   instruments, write the level by PLAYING, quantize for loose players — "so any idiot can do it").
   No audio, no DOM: tested in node.

   TIMING HELP (what the screen calls it): how hard a played note is pulled onto the grid.
     HELP.off      as played
     HELP.little   eighths, pulled halfway (keeps the feel)
     HELP.tidy     sixteenths, all the way          ← the default
     HELP.robot    eighths, all the way
   A Take is everything played in one pass of the loop on one part; the Draft holds the takes per
   part (drums / bass / treble), layered, with undo and "start this part again". Notes are stored
   AS PLAYED plus the help they were made with, so turning the help up afterwards re-tidies them.

   The draft turns into a Fortissimo song file ({ format: "fortissimo-song", ... }) with
   draftToSong(): lanes, sounds from the chosen kit / sets, pitches from the chosen mood. */

export const HELP = {
  off:    { label: "Off",      grid: 0,   strength: 0 },
  little: { label: "A little", grid: 0.5, strength: 0.5 },
  tidy:   { label: "Tidy",     grid: 0.25, strength: 1 },
  robot:  { label: "Robot",    grid: 0.5, strength: 1 },
};
export const DEFAULT_HELP = "tidy";

/** where a beat lands with this help (beats, within a loop of `loopBeats`) */
export function tidyBeat(beat, help = DEFAULT_HELP, loopBeats = 16) {
  const h = HELP[help] || HELP[DEFAULT_HELP];
  if (!h.grid || !h.strength) return wrap(beat, loopBeats);
  const snapped = Math.round(beat / h.grid) * h.grid;
  return wrap(beat + (snapped - beat) * h.strength, loopBeats);
}
const wrap = (b, L) => { const r = ((b % L) + L) % L; return Math.abs(r - L) < 1e-6 ? 0 : +r.toFixed(6); };

// MOODS (what the screen calls keys/scales): semitone steps from the root, eight bars a row
export const MOODS = {
  bright:     { label: "Bright",     scale: "major",      steps: [0, 2, 4, 5, 7, 9, 11, 12] },
  dark:       { label: "Dark",       scale: "minor",      steps: [0, 2, 3, 5, 7, 8, 10, 12] },
  mysterious: { label: "Mysterious", scale: "phrygian",   steps: [0, 1, 3, 5, 7, 8, 10, 12] },
  heroic:     { label: "Heroic",     scale: "mixolydian", steps: [0, 2, 4, 5, 7, 9, 10, 12] },
};
export const TEMPOS = { slow: { label: "Slow", bpm: 72 }, medium: { label: "Medium", bpm: 92 }, fast: { label: "Fast", bpm: 116 } };

export const PARTS = ["drums", "bass", "treble"];
export const DRUMS = ["hat", "snare", "crash", "kick", "tom low", "tom high"];
/** the lanes a part plays: drums by name, bass / treble bars 1..16 (row 1 = bars 1-8, row 2 = 9-16) */
export const lanesOf = (part) => (part === "drums" ? DRUMS : Array.from({ length: 16 }, (_, i) => `${part} ${i + 1}`));

export class Draft {
  constructor({ world = "rome", bars = 4, tempo = "medium", mood = "bright", rootMidi = 48, help = DEFAULT_HELP, kit = null, bass = null, treble = null } = {}) {
    Object.assign(this, { world, bars, tempo, mood, rootMidi, help, kit, bass, treble });
    this.takes = { drums: [], bass: [], treble: [] };   // part -> [ [{ lane, played, vel }] ], oldest first
    this.open = null;                                    // the take being recorded: { part, notes }
  }
  get loopBeats() { return this.bars * 4; }
  get bpm() { return (TEMPOS[this.tempo] || TEMPOS.medium).bpm; }

  /** start a pass on a part (each pass of the loop is a take; an empty one is dropped) */
  beginTake(part) { this.closeTake(); this.open = { part, notes: [] }; }
  /** a note played at `beat` (loop beats, as played) */
  play(lane, beat, vel = 1) {
    if (!this.open) return null;
    const n = { lane, played: +beat.toFixed(4), vel: Math.max(0.05, Math.min(1, vel)) };
    this.open.notes.push(n); return { ...n, beat: tidyBeat(n.played, this.help, this.loopBeats) };
  }
  closeTake() {
    if (this.open && this.open.notes.length) this.takes[this.open.part].push(this.open.notes);
    this.open = null;
  }
  undo(part) { this.closeTake(); return this.takes[part].pop() || null; }
  clear(part) { this.closeTake(); this.takes[part] = []; }
  setHelp(help) { if (HELP[help]) this.help = help; }

  /** every note of a part, tidied with the CURRENT help; two hits on the same lane and step merge (the louder wins) */
  notes(part) {
    const all = [...this.takes[part].flat(), ...(this.open && this.open.part === part ? this.open.notes : [])];
    const out = new Map();
    for (const n of all) {
      const beat = tidyBeat(n.played, this.help, this.loopBeats), key = `${n.lane}@${beat.toFixed(3)}`;
      const prev = out.get(key); if (!prev || n.vel > prev.vel) out.set(key, { lane: n.lane, beat, vel: n.vel });
    }
    return [...out.values()].sort((a, b) => a.beat - b.beat || a.lane.localeCompare(b.lane));
  }
  noteCount() { return PARTS.reduce((s, p) => s + this.notes(p).length, 0); }
}

/** the pitch a bar plays: bars 1-8 are the mood's octave from the root, bars 9-16 the octave above */
export function barMidi(bar, mood, rootMidi) {
  const steps = (MOODS[mood] || MOODS.bright).steps;
  return rootMidi + steps[(bar - 1) % 8] + (bar > 8 ? 12 : 0);
}

/** a STARTER BEAT (so nobody faces an empty loop): kick on 1 and 3, snare on 2 and 4, hat on the eighths */
export function starterBeat(bars = 4) {
  const notes = [];
  for (let b = 0; b < bars * 4; b++) {
    notes.push({ lane: b % 2 === 0 ? "kick" : "snare", played: b, vel: 0.9 });
    notes.push({ lane: "hat", played: b, vel: 0.6 }, { lane: "hat", played: b + 0.5, vel: 0.45 });
  }
  return notes;
}

/** the finished draft as a Fortissimo song file (the same shape the game loads: roundfiles.js) */
export function draftToSong(draft, { name, title, banks }) {
  const kit = banks.drums.find((k) => k.id === draft.kit) || banks.drums[0];
  const setOf = (part) => banks[part].find((b) => b.id === draft[part]) || banks[part][0];
  const sounds = {};
  for (const d of DRUMS) sounds[d] = { path: kit.sounds[d], note: 60 };
  for (const part of ["bass", "treble"]) {
    const set = setOf(part), base = part === "bass" ? draft.rootMidi : draft.rootMidi + 24;
    for (let bar = 1; bar <= 16; bar++) sounds[`${part} ${bar}`] = { path: set.sample, note: 60 + barMidi(bar, draft.mood, base) - set.root };
  }
  const notes = PARTS.flatMap((p) => draft.notes(p).map((n) => ({ lane: n.lane, beat: n.beat, vel: +n.vel.toFixed(3), midi: sounds[n.lane].note })));
  return {
    format: "fortissimo-song", version: 1, world: draft.world, name, title, swing: 0,
    bpm: draft.bpm, bars: draft.bars, notes, sounds, back: { drums: [], bass: [], treble: [] },
    tracks: [], fxBus: null, masterVol: 1,
    made: { kit: kit.id, bass: setOf("bass").id, treble: setOf("treble").id, mood: draft.mood, tempo: draft.tempo, help: draft.help },
  };
}
