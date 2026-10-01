/* drums.js — synthesizes the two rhythm voices (kick, click) offline.
   Rendered once with an OfflineAudioContext and handed back as AudioBuffers,
   so triggering them later is a plain buffer-source start. */

/**
 * Render both drum voices.
 * @param {number} sampleRate output sample rate (use ctx.sampleRate)
 * @returns {Promise<{kick: AudioBuffer, click: AudioBuffer}>}
 */
export async function makeDrums(sampleRate) {
  const kick = await renderKick(sampleRate);
  const click = await renderClick(sampleRate);
  return { kick, click };
}

// kick: 0.45 s, sine 150 Hz -> 45 Hz (exponential, over 0.12 s),
// gain 1 -> 0.001 (exponential over 0.45 s)
async function renderKick(sampleRate) {
  const dur = 0.45;
  const off = new OfflineAudioContext(2, Math.ceil(dur * sampleRate), sampleRate);

  const osc = off.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(150, 0);
  osc.frequency.exponentialRampToValueAtTime(45, 0.12);

  const g = off.createGain();
  g.gain.setValueAtTime(1, 0);
  g.gain.exponentialRampToValueAtTime(0.001, dur);

  osc.connect(g);
  g.connect(off.destination);
  osc.start(0);
  osc.stop(dur);

  return off.startRendering();
}

// click: 0.03 s, square 1800 Hz, gain 0.4 -> 0.001 (exponential)
async function renderClick(sampleRate) {
  const dur = 0.03;
  const off = new OfflineAudioContext(2, Math.ceil(dur * sampleRate), sampleRate);

  const osc = off.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(1800, 0);

  const g = off.createGain();
  g.gain.setValueAtTime(0.4, 0);
  g.gain.exponentialRampToValueAtTime(0.001, dur);

  osc.connect(g);
  g.connect(off.destination);
  osc.start(0);
  osc.stop(dur);

  return off.startRendering();
}
