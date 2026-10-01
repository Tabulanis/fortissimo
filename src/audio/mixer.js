/* mixer.js — the mixing desk. Every sound in the game goes through here.

   lane strips (one per drum): EQ -> pan -> level -> drum bus, plus a reverb send
   drum bus:   glue compression, so the kit sounds like one kit
   reverb:     a generated stereo hall (the courtyard's space), returned to master
   metronome / backing: their own faders, straight to master
   master:     a limiter last, so loud passages never clip

   Pan positions follow where each drum sits in front of the player, kept
   inside a natural drummer's-eye spread (kick dead centre). Faders are linear
   gain; setVolume() takes 0..1 from the settings screen. */

// Drum samples are normalised near full scale; this leaves ~9 dB of headroom
// so several drums + reverb sum without touching the limiter.
const HEADROOM = 0.35;

// Per-drum voicing. eq: [type, freq, gain dB, Q]; send = reverb amount.
const STRIPS = {
  kick:      { pan: 0.0,   level: 1.0,  drive: 0,  send: 0.05, eq: [["highpass", 28, 0, 0.7], ["lowshelf", 70, 3, 0], ["peaking", 380, -4, 1.1], ["highshelf", 4500, 3, 0]] },
  snare:     { pan: 0.05,  level: 5.0,  drive: 12, send: 0.24, eq: [["highpass", 90, 0, 0.7], ["peaking", 200, 2, 1.0], ["peaking", 900, -2, 1.2], ["highshelf", 6000, 3, 0]] },
  hat:       { pan: -0.35, level: 3.1,  drive: 18, send: 0.08, eq: [["highpass", 380, 0, 0.7], ["highshelf", 9000, 2, 0]] },
  crash:     { pan: 0.42,  level: 0.85, drive: 8,  send: 0.3,  eq: [["highpass", 300, 0, 0.7], ["peaking", 3500, -2, 1.0]] },
  "tom low": { pan: -0.15, level: 0.98, drive: 0,  send: 0.2,  eq: [["highpass", 50, 0, 0.7], ["peaking", 320, -3, 1.0]] },
  "tom high":{ pan: 0.3,   level: 1.07, drive: 0,  send: 0.2,  eq: [["highpass", 70, 0, 0.7], ["peaking", 450, -3, 1.0]] },
};

/** A stereo hall impulse: decaying noise that darkens as it decays. */
function makeHall(ctx, seconds = 2.2, predelay = 0.015) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * (seconds + predelay));
  const ir = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    const start = Math.floor(predelay * rate);
    for (let i = start; i < len; i++) {
      const t = (i - start) / rate;
      const env = Math.pow(1 - t / seconds, 2.2) * Math.exp(-t * 1.6);
      // one-pole lowpass whose cutoff falls with time: highs die first, like a real room
      const k = 0.55 - 0.45 * (t / seconds);
      lp += k * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * env;
    }
  }
  return ir;
}

export function createMixer(ctx) {
  // --- master: fader -> limiter -> speakers
  const master = ctx.createGain();
  master.gain.value = 1.6;   // ~+4 dB: a single block lands near -6 dBFS, plenty of room before the limiter
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1.0;   // safety only: touches nothing but the very top
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.12;
  master.connect(limiter).connect(ctx.destination);

  // --- drum bus: glue compression
  const drumBus = ctx.createGain();
  const glue = ctx.createDynamicsCompressor();
  // gentle: glue the kit without flattening it — a block must stay audibly
  // louder than a near miss (only the loudest hits reach the threshold)
  glue.threshold.value = -9;
  glue.knee.value = 6;
  glue.ratio.value = 2;
  glue.attack.value = 0.012;
  glue.release.value = 0.16;
  const drumFader = ctx.createGain();
  drumFader.gain.value = 1.0;
  // NO glue compression in the path: loudness IS the game's reward (a block must
  // be clearly louder than a near miss) and a bus compressor flattened that —
  // measured 2026-10-01: block vs 50 ms near miss went from 10.7 dB apart to 1.1.
  void glue;
  drumBus.connect(drumFader).connect(master);

  // --- reverb: the courtyard
  const reverb = ctx.createConvolver();
  reverb.buffer = makeHall(ctx);
  const reverbReturn = ctx.createGain();
  reverbReturn.gain.value = 0.32;
  reverb.connect(reverbReturn).connect(master);

  // --- lane strips
  const strips = {};
  for (const [name, s] of Object.entries(STRIPS)) {
    const input = ctx.createGain();
    let node = input;
    if (s.drive) {
      // saturation: tanh(k*x)/tanh(k) — rounds a spiky hit so its body comes
      // up without the peak growing (spiky snares/hats otherwise sound faint)
      const k = Math.pow(10, s.drive / 20);
      const curve = new Float32Array(2048);
      for (let i = 0; i < curve.length; i++) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        curve[i] = Math.tanh(k * x) / Math.tanh(k);
      }
      const sat = ctx.createWaveShaper();
      sat.curve = curve;
      sat.oversample = "4x";
      node.connect(sat);
      node = sat;
    }
    for (const [type, freq, gain, q] of s.eq) {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.gain.value = gain;
      if (q) f.Q.value = q;
      node.connect(f);
      node = f;
    }
    const pan = ctx.createStereoPanner();
    pan.pan.value = s.pan;
    const level = ctx.createGain();
    level.gain.value = s.level * HEADROOM;
    const send = ctx.createGain();
    send.gain.value = s.send;
    node.connect(pan).connect(level).connect(drumBus);
    level.connect(send).connect(reverb);
    strips[name] = { input, level, send, pan };
  }

  // --- metronome and backing: own faders, no reverb on the click
  const metronome = ctx.createGain();
  metronome.gain.value = 0.5;
  metronome.connect(master);
  const backing = ctx.createGain();
  backing.gain.value = 0.6;
  const backingSend = ctx.createGain();
  backingSend.gain.value = 0.12;
  backing.connect(master);
  backing.connect(backingSend).connect(reverb);

  return {
    /** Where a drum's notes go: mixer.lane("snare") */
    lane(name) { return (strips[name] || strips.snare).input; },
    /** debug/tuning: a lane's strip nodes */
    strip(name) { return strips[name]; },
    get metronome() { return metronome; },
    get backing() { return backing; },
    get master() { return master; },
    /** which: "master" | "hits" | "backing" | "metronome"; v: 0..1 */
    setVolume(which, v) {
      const g = Math.max(0, Math.min(1, v));
      const node = { master, hits: drumFader, backing, metronome }[which];
      if (node) node.gain.setTargetAtTime(which === "master" ? g * 1.0 : g, ctx.currentTime, 0.02);
    },
  };
}
