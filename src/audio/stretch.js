/* stretch.js — change a sound's length WITHOUT changing its pitch (WSOLA).
 *
 * The background tracks (DRUM BACK...) are recordings at the song's Hackbeat
 * tempo; the game plays at the difficulty's tempo (Easy 60 ... Expert 112).
 * Every other note is triggered on the beat so it follows the tempo by itself;
 * a recording has to be stretched to fit (owner, 2026-10-03: match the game's
 * speed, keep the pitch).
 *
 * WSOLA: the output is built from overlapping windowed grains of the input,
 * each taken where it lines up best (cross-correlation) with how the previous
 * grain naturally continues — so waveforms join without phasing, and the pitch
 * never moves. Pure: Float32Array in, Float32Array out.
 */

const N = 2048;          // grain length (~43 ms at 48 kHz)
const HS = N / 2;        // output hop: 50% overlap
const DELTA = 256;       // how far a grain may slide to line up
const STEP = 4;          // correlation sub-sampling (speed)

/**
 * @param {Float32Array} input
 * @param {number} factor output length / input length (>1 = slower)
 * @param {number} [outLen] exact output length (default round(input.length * factor))
 * @returns {Float32Array}
 */
export function timeStretch(input, factor, outLen = Math.round(input.length * factor)) {
  if (Math.abs(factor - 1) < 1e-6) return input.slice(0, outLen);
  const out = new Float32Array(outLen);
  const norm = new Float32Array(outLen);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const ha = HS / factor;                       // input hop
  const at = (i) => (i >= 0 && i < input.length ? input[i] : 0);
  let prev = 0;                                 // where the previous grain came from (input)
  for (let k = 0, o = 0; o < outLen; k++, o += HS) {
    const ideal = Math.round(k * ha);
    let pos = ideal;
    if (k > 0) {
      // the previous grain's natural continuation: input at prev + HS
      const nat = prev + HS;
      let best = -Infinity;
      for (let d = -DELTA; d <= DELTA; d += 2) {
        const c = ideal + d;
        let s = 0;
        for (let i = 0; i < HS; i += STEP) s += at(nat + i) * at(c + i);
        if (s > best) { best = s; pos = c; }
      }
    }
    for (let i = 0; i < N && o + i < outLen; i++) {
      out[o + i] += at(pos + i) * win[i];
      norm[o + i] += win[i];
    }
    prev = pos;
  }
  for (let i = 0; i < outLen; i++) if (norm[i] > 1e-3) out[i] /= norm[i];
  return out;
}

/** Stretch every channel of an AudioBuffer-like {numberOfChannels, getChannelData, sampleRate}. */
export function stretchBuffer(ctx, buf, factor) {
  const len = Math.round(buf.length * factor);
  const out = ctx.createBuffer(buf.numberOfChannels, len, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(timeStretch(buf.getChannelData(c), factor, len), c);
  return out;
}
