import assert from "node:assert";
// a stand-in audio engine: just enough for voices.js
const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} });
const node = () => ({ connect() {}, disconnect() {}, gain: param(), frequency: param(), Q: param(), pan: param() });
const ctx = { currentTime: 0,
  createBufferSource: () => ({ ...node(), playbackRate: param(), start() {}, stop() {}, addEventListener() {} }),
  createBiquadFilter: node, createGain: node, createStereoPanner: node };
globalThis.window = {};
await import("../src/audio/voices.js");
const { VoicePool, voiceSettings, VOICE_PRESETS } = window.HB_VOICES;
const settings = voiceSettings({ voice: VOICE_PRESETS["One shot"] });
const buffer = { duration: 1 };

// phones: at most 12 at once, and the background loop is never the one cut
const pool = new VoicePool(ctx, { max: 12 });
const back = pool.noteOn({ channel: 120, midi: 60, baseNote: 60, buffer, settings, destination: node(), keep: true });
for (let i = 0; i < 40; i++) pool.noteOn({ channel: i % 6, midi: 60 + i, baseNote: 60, buffer, settings, destination: node() });
assert.ok(pool.active.length <= 12, `capped at 12 (${pool.active.length})`);
assert.ok(pool.active.includes(back), "the background loop survives a busy moment");
assert.strictEqual(new VoicePool(ctx).max, 24, "desktop keeps 24");
console.log("voicepool ok");
