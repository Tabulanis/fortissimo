import assert from "node:assert";
import { timeStretch } from "../src/audio/stretch.js";

const SR = 48000;
const freqOf = (x) => { let z = 0; for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) z++; return (z / x.length) * SR; };

// a 440 Hz tone keeps its pitch, slower and faster (Easy 80->60 = 4/3, Expert 80->112 = 5/7)
const tone = Float32Array.from({ length: SR }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / SR));
for (const f of [4 / 3, 5 / 7]) {
  const y = timeStretch(tone, f);
  assert.strictEqual(y.length, Math.round(SR * f), "exact length");
  const hz = freqOf(y.subarray(4096, y.length - 4096));
  assert.ok(Math.abs(hz - 440) < 4, `pitch kept at x${f.toFixed(2)}: ${hz.toFixed(1)} Hz`);
}

// clicks every 0.5 s land every 0.5*f s: the tempo follows
const clicks = new Float32Array(SR * 2);
for (let t = 0; t < 4; t++) for (let i = 0; i < 400; i++) clicks[t * SR / 2 + i] = Math.sin(i * 0.3) * Math.exp(-i / 80);
const f = 4 / 3, y = timeStretch(clicks, f);
const onsets = [];
for (let i = 0, last = -SR; i < y.length; i++) if (Math.abs(y[i]) > 0.3 && i - last > SR / 4) { onsets.push(i / SR); last = i; }
assert.strictEqual(onsets.length, 4, `4 clicks (${onsets})`);
onsets.forEach((t, k) => assert.ok(Math.abs(t - k * 0.5 * f) < 0.02, `click ${k} at ${t.toFixed(3)} s, want ${(k * 0.5 * f).toFixed(3)}`));
console.log("stretch ok");
