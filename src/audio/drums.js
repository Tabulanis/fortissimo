/* drums.js — synthesizes the drum kit (kick, click, snare, hat, crash,
   toms) offline. Rendered once with an OfflineAudioContext and handed back
   as AudioBuffers, so triggering them later is a plain buffer-source start. */

/**
 * Render the full drum kit.
 * @param {number} sampleRate output sample rate (use ctx.sampleRate)
 * @returns {Promise<{kick, click, snare, hat, crash, tomLow, tomHigh: AudioBuffer}>}
 */
export async function makeDrums(sampleRate) {
  const [kick, click, snare, hat, crash, tomLow, tomHigh] = await Promise.all([
    renderKick(sampleRate),
    renderClick(sampleRate),
    renderSnare(sampleRate),
    renderHat(sampleRate),
    renderCrash(sampleRate),
    renderTom(sampleRate, 110, 70, 0.25, 0.4, 0.9),
    renderTom(sampleRate, 180, 120, 0.2, 0.35, 0.9),
  ]);
  return { kick, click, snare, hat, crash, tomLow, tomHigh };
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

// white-noise buffer for noise-based voices
function noiseBuffer(off, dur) {
  const len = Math.ceil(dur * off.sampleRate);
  const buf = off.createBuffer(2, len, off.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return buf;
}

// noise voice: white noise through a highpass, exponential gain decay
async function renderNoise(sampleRate, dur, hpFreq, peak) {
  const off = new OfflineAudioContext(2, Math.ceil(dur * sampleRate), sampleRate);

  const src = off.createBufferSource();
  src.buffer = noiseBuffer(off, dur);

  const hp = off.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = hpFreq;

  const g = off.createGain();
  g.gain.setValueAtTime(peak, 0);
  g.gain.exponentialRampToValueAtTime(0.001, dur);

  src.connect(hp);
  hp.connect(g);
  g.connect(off.destination);
  src.start(0);
  src.stop(dur);

  return off.startRendering();
}

// hat: 0.06 s — white noise through highpass 7000 Hz, gain 0.5 -> 0.001
function renderHat(sampleRate) {
  return renderNoise(sampleRate, 0.06, 7000, 0.5);
}

// crash: 1.4 s — white noise through highpass 4500 Hz, gain 0.6 -> 0.001
function renderCrash(sampleRate) {
  return renderNoise(sampleRate, 1.4, 4500, 0.6);
}

// snare: 0.22 s — noise through highpass 1200 Hz (gain 0.8 -> 0.001)
// mixed with a 185 Hz triangle (gain 0.5 -> 0.001 over 0.12 s)
async function renderSnare(sampleRate) {
  const dur = 0.22;
  const off = new OfflineAudioContext(2, Math.ceil(dur * sampleRate), sampleRate);

  const src = off.createBufferSource();
  src.buffer = noiseBuffer(off, dur);

  const hp = off.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 1200;

  const gNoise = off.createGain();
  gNoise.gain.setValueAtTime(0.5, 0);
  gNoise.gain.exponentialRampToValueAtTime(0.001, dur);

  const osc = off.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(185, 0);

  const gTone = off.createGain();
  gTone.gain.setValueAtTime(0.3, 0);
  gTone.gain.exponentialRampToValueAtTime(0.001, 0.12);

  src.connect(hp);
  hp.connect(gNoise);
  gNoise.connect(off.destination);
  osc.connect(gTone);
  gTone.connect(off.destination);
  src.start(0);
  src.stop(dur);
  osc.start(0);
  osc.stop(dur);

  return off.startRendering();
}

// toms: sine with exponential pitch drop and exponential gain decay
async function renderTom(sampleRate, f0, f1, pitchDur, dur, peak) {
  const off = new OfflineAudioContext(2, Math.ceil(dur * sampleRate), sampleRate);

  const osc = off.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(f0, 0);
  osc.frequency.exponentialRampToValueAtTime(f1, pitchDur);

  const g = off.createGain();
  g.gain.setValueAtTime(peak, 0);
  g.gain.exponentialRampToValueAtTime(0.001, dur);

  osc.connect(g);
  g.connect(off.destination);
  osc.start(0);
  osc.stop(dur);

  return off.startRendering();
}
