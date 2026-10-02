/* scales.js — a round's key + scale -> the 8 notes of an instrument. Pure.
 *
 * Bass and Treble each play EIGHT notes: one octave of the scale, plus the
 * octave on top (do re mi fa so la ti do). The round manifest says the key and
 * scale; the instrument says which octave. Expert mode adds a note below and
 * a note above (10). MIDI numbers: 60 = middle C. */

export const SCALES = {
  major:        [0, 2, 4, 5, 7, 9, 11],
  minor:        [0, 2, 3, 5, 7, 8, 10],   // natural minor
  dorian:       [0, 2, 3, 5, 7, 9, 10],
  mixolydian:   [0, 2, 4, 5, 7, 9, 10],
  harmonicMinor:[0, 2, 3, 5, 7, 8, 11],
};

const KEYS = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };

/** octave numbering: C4 = 60 (middle C) */
export function keyRoot(key, octave) {
  if (!(key in KEYS)) throw new Error(`unknown key "${key}"`);
  return 12 * (octave + 1) + KEYS[key];
}

/** degree d of the scale (0 = root, 7 = octave above, -1 = the note below the root, 8 = the 9th) */
export function degree(intervals, root, d) {
  const n = intervals.length;
  const oct = Math.floor(d / n), i = ((d % n) + n) % n;
  return root + 12 * oct + intervals[i];
}

/**
 * The instrument's notes.
 * @param {{key?:string, scale?:string, octave:number, expert?:boolean}} o
 * @returns {number[]} 8 MIDI notes low -> high (10 with expert: one below + the 8 + one above)
 */
export function instrumentNotes({ key = "C", scale = "major", octave, expert = false }) {
  const iv = SCALES[scale];
  if (!iv) throw new Error(`unknown scale "${scale}"`);
  const root = keyRoot(key, octave);
  const first = expert ? -1 : 0, last = expert ? 8 : 7;
  const out = [];
  for (let d = first; d <= last; d++) out.push(degree(iv, root, d));
  return out;
}

/** which of the instrument's slots plays MIDI note m (-1 = not on this instrument) */
export function slotOf(notes, m) { return notes.indexOf(m); }

/** default registers: bass two octaves below middle C, treble one above */
export const BASS_OCTAVE = 2, TREBLE_OCTAVE = 5;

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const noteName = (m) => NAMES[m % 12] + (Math.floor(m / 12) - 1);
