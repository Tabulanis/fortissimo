/* drums.js — synthesizes the drum kit (kick, click, snare, hat, crash,
   toms) offline. Each voice is rendered with its own OfflineAudioContext and
   handed back as an AudioBuffer, so triggering them later is a plain
   buffer-source start. Rendered DRY (no EQ/reverb/panning/compression —
   the mixer does that later) and normalised so every peak stays <= 0.95. */

/* ---------- shared helpers ---------- */

// scale every channel so the buffer's peak lands on `target` (default 0.9)
function normalise(buf, target = 0.9) {
  let peak = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
    }
  }
  if (peak <= 0) return buf;
  const scale = target / peak;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] *= scale;
  }
  return buf;
}

// a tanh soft-clip curve, k = 2.5
function softClipCurve(k = 2.5, points = 1024) {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}

// white-noise buffer, independent per channel
function noiseBuffer(off, dur, channels = 2) {
  const len = Math.ceil(dur * off.sampleRate);
  const buf = off.createBuffer(channels, len, off.sampleRate);
  for (let ch = 0; ch < channels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return buf;
}

// six-square metallic cluster: base frequency times the partial ratios,
// summed into one gain node. Returns the summed output AudioNode.
function metallicCluster(off, base) {
  const ratios = [2, 3, 4.16, 5.43, 6.79, 8.21];
  const sum = off.createGain();
  sum.gain.value = 1;
  for (const r of ratios) {
    const osc = off.createOscillator();
    osc.type = "square";
    osc.frequency.value = base * r;
    osc.connect(sum);
    osc.start(0);
  }
  return sum;
}

// exponential gain envelope: peak at start (optional linear attack),
// then exponential decay to 0.001 by `decayEnd`
function envelope(off, peak, dur, decayEnd, attack = 0) {
  const g = off.createGain();
  if (attack > 0) {
    g.gain.setValueAtTime(0.0001, 0);
    g.gain.linearRampToValueAtTime(peak, attack);
    g.gain.exponentialRampToValueAtTime(0.001, decayEnd);
  } else {
    g.gain.setValueAtTime(peak, 0);
    g.gain.exponentialRampToValueAtTime(0.001, decayEnd);
  }
  return g;
}

/* ---------- voices ---------- */

// kick (0.6 s, mono): body sine 180->48 Hz exp over 0.09 s, gain decay over
// 0.55 s; sub sine 48 Hz, gain 0 -> 0.6 at 0.01 s -> 0.001 exp over 0.5 s;
// 4 ms white-noise click through bandpass 3500 Hz Q 0.8, gain 0.5 -> 0.001
// exp; tanh soft-clip (k=2.5) on the summed body+sub for weight.
async function renderKick(sampleRate) {
  const dur = 0.6;
  const off = new OfflineAudioContext(1, Math.ceil(dur * sampleRate), sampleRate);

  // (a) body + (b) sub, summed, through the soft-clip
  const sum = off.createGain();
  sum.gain.value = 1;
  const ws = off.createWaveShaper();
  ws.curve = softClipCurve(2.5);
  sum.connect(ws);
  ws.connect(off.destination);

  const body = off.createOscillator();
  body.type = "sine";
  body.frequency.setValueAtTime(180, 0);
  body.frequency.exponentialRampToValueAtTime(48, 0.09);
  const gBody = off.createGain();
  gBody.gain.setValueAtTime(1, 0);
  gBody.gain.exponentialRampToValueAtTime(0.001, 0.55);
  body.connect(gBody);
  gBody.connect(sum);
  body.start(0);
  body.stop(dur);

  const sub = off.createOscillator();
  sub.type = "sine";
  sub.frequency.value = 48;
  const gSub = off.createGain();
  gSub.gain.setValueAtTime(0.0001, 0);
  gSub.gain.linearRampToValueAtTime(0.6, 0.01);
  gSub.gain.exponentialRampToValueAtTime(0.001, 0.51);
  sub.connect(gSub);
  gSub.connect(sum);
  sub.start(0);
  sub.stop(dur);

  // (c) click: 4 ms noise through bandpass 3500 Hz Q 0.8
  const click = off.createBufferSource();
  click.buffer = noiseBuffer(off, 0.004, 1);
  const bp = off.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 3500;
  bp.Q.value = 0.8;
  const gClick = off.createGain();
  gClick.gain.setValueAtTime(0.5, 0);
  gClick.gain.exponentialRampToValueAtTime(0.001, 0.004);
  click.connect(bp);
  bp.connect(gClick);
  gClick.connect(off.destination);
  click.start(0);
  click.stop(0.004);

  return normalise(await off.startRendering());
}

// snare (0.32 s, stereo): body = two triangles 185 Hz + 330 Hz, gain 0.7 ->
// 0.001 exp over 0.12 s; wires = white noise (independent per channel)
// through highpass 1800 Hz then peaking 5000 Hz +4 dB, gain 0.9 -> 0.001
// exp over 0.28 s; snap = 6 ms noise burst through bandpass 2500 Hz Q 1.2.
async function renderSnare(sampleRate) {
  const dur = 0.32;
  const off = new OfflineAudioContext(2, Math.ceil(dur * sampleRate), sampleRate);

  // (a) body
  const gBody = off.createGain();
  gBody.gain.setValueAtTime(0.7, 0);
  gBody.gain.exponentialRampToValueAtTime(0.001, 0.12);
  gBody.connect(off.destination);
  for (const f of [185, 330]) {
    const osc = off.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = f;
    osc.connect(gBody);
    osc.start(0);
    osc.stop(dur);
  }

  // (b) wires: independent noise per channel
  for (let ch = 0; ch < 2; ch++) {
    const src = off.createBufferSource();
    const buf = off.createBuffer(1, Math.ceil(dur * sampleRate), sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    src.buffer = buf;

    const hp = off.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1800;
    const pk = off.createBiquadFilter();
    pk.type = "peaking";
    pk.frequency.value = 5000;
    pk.gain.value = 4;
    const g = off.createGain();
    g.gain.setValueAtTime(0.9, 0);
    g.gain.exponentialRampToValueAtTime(0.001, 0.28);

    const mer = off.createChannelMerger(2);
    src.connect(hp);
    hp.connect(pk);
    pk.connect(g);
    g.connect(mer, 0, ch);
    mer.connect(off.destination);
    src.start(0);
    src.stop(dur);
  }

  // (c) snap: 6 ms burst through bandpass 2500 Hz Q 1.2
  const snap = off.createBufferSource();
  snap.buffer = noiseBuffer(off, 0.006, 2);
  const bp = off.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 2500;
  bp.Q.value = 1.2;
  const gSnap = off.createGain();
  gSnap.gain.setValueAtTime(0.9, 0);
  gSnap.gain.exponentialRampToValueAtTime(0.001, 0.006);
  snap.connect(bp);
  bp.connect(gSnap);
  gSnap.connect(off.destination);
  snap.start(0);
  snap.stop(0.006);

  return normalise(await off.startRendering());
}

// hat (0.09 s, stereo): six-square metallic cluster (base 205.3 Hz) through
// bandpass 10000 Hz Q 0.9 then highpass 7000 Hz, gain 0.6 -> 0.001 exp over
// 0.08 s.
async function renderHat(sampleRate) {
  const dur = 0.09;
  const off = new OfflineAudioContext(2, Math.ceil(dur * sampleRate), sampleRate);

  const cluster = metallicCluster(off, 205.3);
  const bp = off.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 10000;
  bp.Q.value = 0.9;
  const hp = off.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 7000;
  const g = off.createGain();
  g.gain.setValueAtTime(0.6, 0);
  g.gain.exponentialRampToValueAtTime(0.001, 0.08);

  cluster.connect(bp);
  bp.connect(hp);
  hp.connect(g);
  g.connect(off.destination);

  return normalise(await off.startRendering());
}

// crash (2.2 s, stereo): six-square metallic cluster (base 230 Hz) through
// highpass 5000 Hz, mixed with white noise through highpass 6000 Hz;
// gain 0.8 -> 0.001 exp over 2.1 s with a 3 ms attack.
async function renderCrash(sampleRate) {
  const dur = 2.2;
  const off = new OfflineAudioContext(2, Math.ceil(dur * sampleRate), sampleRate);

  const g = envelope(off, 0.8, dur, 2.1, 0.003);
  g.connect(off.destination);

  const cluster = metallicCluster(off, 230);
  const hpM = off.createBiquadFilter();
  hpM.type = "highpass";
  hpM.frequency.value = 5000;
  cluster.connect(hpM);
  hpM.connect(g);

  const noise = off.createBufferSource();
  noise.buffer = noiseBuffer(off, dur, 2);
  const hpN = off.createBiquadFilter();
  hpN.type = "highpass";
  hpN.frequency.value = 6000;
  noise.connect(hpN);
  hpN.connect(g);
  noise.start(0);
  noise.stop(dur);

  return normalise(await off.startRendering());
}

// toms (mono): sine with exponential pitch drop and exponential gain decay,
// plus a short noise click through a bandpass.
async function renderTom(sampleRate, { f0, f1, pitchDur, decay, dur, clickFreq, clickGain }) {
  const off = new OfflineAudioContext(1, Math.ceil(dur * sampleRate), sampleRate);

  const osc = off.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(f0, 0);
  osc.frequency.exponentialRampToValueAtTime(f1, pitchDur);
  const g = off.createGain();
  g.gain.setValueAtTime(1, 0);
  g.gain.exponentialRampToValueAtTime(0.001, decay);
  osc.connect(g);
  g.connect(off.destination);
  osc.start(0);
  osc.stop(dur);

  const click = off.createBufferSource();
  click.buffer = noiseBuffer(off, 0.005, 1);
  const bp = off.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = clickFreq;
  const gClick = off.createGain();
  gClick.gain.setValueAtTime(clickGain, 0);
  gClick.gain.exponentialRampToValueAtTime(0.001, 0.005);
  click.connect(bp);
  bp.connect(gClick);
  gClick.connect(off.destination);
  click.start(0);
  click.stop(0.005);

  return normalise(await off.startRendering());
}

// click (metronome, 0.03 s, mono): square 1800 Hz, gain 0.4 -> 0.001 exp
async function renderClick(sampleRate) {
  const dur = 0.03;
  const off = new OfflineAudioContext(1, Math.ceil(dur * sampleRate), sampleRate);

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

  return normalise(await off.startRendering());
}

/* ---------- entry point ---------- */

/**
 * Render the full drum kit.
 * @param {number} sampleRate output sample rate (use ctx.sampleRate)
 * @returns {Promise<{kick, snare, hat, crash, tomLow, tomHigh, click: AudioBuffer}>}
 */
export async function makeDrums(sampleRate) {
  const [kick, snare, hat, crash, tomLow, tomHigh, click] = await Promise.all([
    renderKick(sampleRate),
    renderSnare(sampleRate),
    renderHat(sampleRate),
    renderCrash(sampleRate),
    renderTom(sampleRate, { f0: 120, f1: 82, pitchDur: 0.3, decay: 0.65, dur: 0.7, clickFreq: 2000, clickGain: 0.3 }),
    renderTom(sampleRate, { f0: 190, f1: 130, pitchDur: 0.3, decay: 0.5, dur: 0.55, clickFreq: 2000, clickGain: 0.3 }),
    renderClick(sampleRate),
  ]);
  return { kick, snare, hat, crash, tomLow, tomHigh, click };
}
