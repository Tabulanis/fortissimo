/* mixer.js — the mixing desk. Every sound in the game goes through here.

   lane strips (one per drum): EQ -> pan -> level -> drum bus, plus a reverb send
   drum bus:   glue compression, so the kit sounds like one kit
   reverb:     a generated stereo hall (the courtyard's space), returned to master
   metronome / backing: their own faders, straight to master
   master:     a limiter last, so loud passages never clip

   Pan positions follow where each drum sits in front of the player, kept
   inside a natural drummer's-eye spread (kick dead centre). Faders are linear
   gain; setVolume() takes 0..1 from the settings screen. */

// Per-drum voicing. eq: [type, freq, gain dB, Q]; send = reverb amount.
const STRIPS = {
  kick:      { pan: 0.0,   level: 1.0,  send: 0.05, eq: [["highpass", 28, 0, 0.7], ["lowshelf", 70, 3, 0], ["peaking", 380, -4, 1.1], ["highshelf", 4500, 3, 0]] },
  snare:     { pan: 0.05,  level: 0.85, send: 0.24, eq: [["highpass", 90, 0, 0.7], ["peaking", 200, 2, 1.0], ["peaking", 900, -2, 1.2], ["highshelf", 6000, 3, 0]] },
  hat:       { pan: -0.35, level: 0.55, send: 0.08, eq: [["highpass", 380, 0, 0.7], ["highshelf", 9000, 2, 0]] },
  crash:     { pan: 0.42,  level: 0.5,  send: 0.3,  eq: [["highpass", 300, 0, 0.7], ["peaking", 3500, -2, 1.0]] },
  "tom low": { pan: -0.15, level: 0.85, send: 0.2,  eq: [["highpass", 50, 0, 0.7], ["peaking", 320, -3, 1.0]] },
  "tom high":{ pan: 0.3,   level: 0.8,  send: 0.2,  eq: [["highpass", 70, 0, 0.7], ["peaking", 450, -3, 1.0]] },
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
  master.gain.value = 0.9;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2.5;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.12;
  master.connect(limiter).connect(ctx.destination);

  // --- drum bus: glue compression
  const drumBus = ctx.createGain();
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -16;
  glue.knee.value = 8;
  glue.ratio.value = 3;
  glue.attack.value = 0.012;
  glue.release.value = 0.16;
  const drumFader = ctx.createGain();
  drumFader.gain.value = 1.0;
  drumBus.connect(glue).connect(drumFader).connect(master);

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
    level.gain.value = s.level;
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
