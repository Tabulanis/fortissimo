/* bake.js — phones play baked sounds instead of live effect chains
 * (owner, 2026-10-03: crackle when busy).
 *
 * On a desktop every Hackbeat track runs its own live chain (hbchain.js:
 * EQ, drive, crush, chorus with an always-running oscillator, pan, volume)
 * the whole time it plays. On a phone each track's sample is instead rendered
 * through that chain ONCE when the round loads — one baked sample per
 * (sample, track); every note on the track plays it at its own pitch.
 *
 * Reverb and echo are NOT baked (a tail baked into each hit is chopped when
 * the same target hits again): every track feeds one shared reverb and one
 * shared echo at its own send amount, through a "lite track" — a few gains.
 */

const BAKE_TAIL = 0.12;   // seconds kept after the sample: the chorus delay's last echo

/**
 * @param {AudioBuffer} buf the sample
 * @param {object} fx the Hackbeat track's fx (hbchain.js shape)
 * @param {{buildChain: Function}} HB the shared chain code (window.HB_CHAIN)
 * @param {{loop?: boolean}} [opts] loop: a background loop — the tail wraps round onto the start, length unchanged
 * @returns {Promise<AudioBuffer>} the sample through the track's dry-path effects (vol + pan included)
 */
export async function bakeThroughTrack(buf, fx, HB, { loop = false } = {}) {
  const oc = new OfflineAudioContext(2, buf.length + Math.ceil(BAKE_TAIL * buf.sampleRate), buf.sampleRate);
  const chain = HB.buildChain(oc, oc.destination, null);   // no send buses: reverb / echo stay live, shared
  chain.update(fx, true);
  const src = oc.createBufferSource();
  src.buffer = buf;
  src.connect(chain.input);
  src.start(0);
  const out = await oc.startRendering();
  if (!loop) return out;
  const n = buf.length, wrapped = new AudioBuffer({ numberOfChannels: 2, length: n, sampleRate: buf.sampleRate });
  for (let c = 0; c < 2; c++) {
    const a = out.getChannelData(c), w = wrapped.getChannelData(c);
    for (let i = 0; i < a.length; i++) w[i % n] += a[i];
  }
  return wrapped;
}

/**
 * A baked track's live part: dry -> dest, plus its reverb / echo sends into the
 * shared buses (post-fader, as in Hackbeat: the baked sound already holds the fader).
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} dest
 * @param {object} fx
 * @param {{reverbIn: AudioNode, delayIn: AudioNode} | null} sends where the sends go (null: none)
 * @returns {AudioNode} where the track's notes go
 */
export function liteTrack(ctx, dest, fx, sends) {
  const input = ctx.createGain();
  input.connect(dest);
  if (sends) {
    if (fx.reverb && fx.reverb.on) { const g = ctx.createGain(); g.gain.value = fx.reverb.send; input.connect(g); g.connect(sends.reverbIn); }
    if (fx.delay && fx.delay.on) { const g = ctx.createGain(); g.gain.value = fx.delay.send; input.connect(g); g.connect(sends.delayIn); }
  }
  return input;
}

/** does a track send to reverb or echo at all? */
export const sendsAny = (fx) => !!((fx.reverb && fx.reverb.on) || (fx.delay && fx.delay.on));
