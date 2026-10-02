/* melody.js — the two melody instruments' voices, rendered offline like the
   drums: one AudioBuffer per note of the round's scale.

   BASS — a bronze marimba: a struck bar's own overtones (about 4x and 9.9x the
     fundamental), each higher one dying faster, a soft felt-mallet thump, and a
     touch of sub an octave down for weight in the courtyard.
   TREBLE — a chime: a clean struck tone with an octave and a gentle
     inharmonic shimmer (4.2x), long ring. No minor-third overtone (a church
     bell's) so major-key melodies don't sour.
   Every note is peak-normalised; the mixer sets the levels. */

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

const VOICES = {
  bass: {
    dur: 1.8,
    // [frequency ratio, amplitude, decay time-constant s]
    partials: [[0.5, 0.18, 0.6], [1, 1.0, 0.75], [3.93, 0.32, 0.22], [9.86, 0.07, 0.06]],
    mallet: { freq: 900, gain: 0.25, dur: 0.006 },
  },
  treble: {
    dur: 2.2,
    partials: [[1, 1.0, 0.9], [2, 0.22, 0.45], [4.2, 0.09, 0.18], [6.8, 0.03, 0.07]],
    mallet: { freq: 5000, gain: 0.18, dur: 0.003 },
  },
};

async function renderNote(sampleRate, midi, v) {
  const f0 = mtof(midi);
  const off = new OfflineAudioContext(1, Math.ceil(v.dur * sampleRate), sampleRate);
  const out = off.createGain();
  out.connect(off.destination);
  for (const [ratio, amp, tau] of v.partials) {
    const f = f0 * ratio;
    if (f > sampleRate * 0.45) continue;                 // above Nyquist-ish: skip, no aliasing
    const osc = off.createOscillator();
    osc.frequency.value = f;
    const g = off.createGain();
    g.gain.setValueAtTime(0, 0);
    g.gain.linearRampToValueAtTime(amp, 0.002);           // 2 ms strike, no click
    g.gain.setTargetAtTime(0, 0.002, tau);
    osc.connect(g).connect(out);
    osc.start(0);
    osc.stop(v.dur);
  }
  // the mallet: a tiny filtered noise thump at the strike
  const n = Math.ceil(v.mallet.dur * sampleRate);
  const nb = off.createBuffer(1, n, sampleRate);
  const d = nb.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = off.createBufferSource();
  src.buffer = nb;
  const lp = off.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = v.mallet.freq;
  const mg = off.createGain();
  mg.gain.value = v.mallet.gain;
  src.connect(lp).connect(mg).connect(out);
  src.start(0);
  const buf = await off.startRendering();
  // normalise to a -1 dBFS peak
  const ch = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  if (peak > 0) { const k = 0.89 / peak; for (let i = 0; i < ch.length; i++) ch[i] *= k; }
  return buf;
}

/**
 * @param {number} sampleRate
 * @param {number[]} notes MIDI notes (from scales.instrumentNotes)
 * @param {"bass"|"treble"} kind
 * @returns {Promise<AudioBuffer[]>} one buffer per note, same order
 */
export function makeMelodyVoices(sampleRate, notes, kind) {
  const v = VOICES[kind];
  if (!v) throw new Error(`unknown melody voice "${kind}"`);
  return Promise.all(notes.map((m) => renderNote(sampleRate, m, v)));
}
