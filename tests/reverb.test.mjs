import assert from "node:assert";
import { makeCourtyardIR, T_SIDE, T_FAR, T_COLUMNS } from "../src/audio/courtyardIR.js";

const SR = 48000;
const [L, R] = makeCourtyardIR(SR, 2.0);
assert.strictEqual(L.length, SR * 2); assert.strictEqual(R.length, SR * 2);
for (const ch of [L, R]) for (const v of ch) assert.ok(Number.isFinite(v), "no NaN / Infinity");

// energy in a small window around time t (both channels)
const energy = (t, w = 0.003) => {
  let e = 0;
  for (let i = Math.max(0, Math.round((t - w) * SR)); i < Math.round((t + w) * SR); i++) e += L[i] * L[i] + R[i] * R[i];
  return e;
};
// an echo is heard as a PEAK standing above the background: compare the peak
// around t with the RMS of the stretch just before it
const peak = (t, w = 0.003) => { let p = 0; for (let i = Math.round((t - w) * SR); i < Math.round((t + w) * SR); i++) p = Math.max(p, Math.abs(L[i]), Math.abs(R[i])); return p; };
const rmsBefore = (t) => { let e = 0, k = 0; for (let i = Math.round((t - 0.016) * SR); i < Math.round((t - 0.008) * SR); i++) { e += L[i] * L[i] + R[i] * R[i]; k += 2; } return Math.sqrt(e / k); };

// the reflections land where the courtyard's walls put them, standing well clear of what's just before
assert.ok(Math.abs(T_SIDE - 0.0536) < 0.001, "side walls: 53.6 ms");
assert.ok(Math.abs(T_FAR - 0.2706) < 0.001, "far wall: 270.6 ms");
for (const [name, t] of [["columns", T_COLUMNS], ["side wall", T_SIDE], ["flutter #2", 2 * T_SIDE], ["far wall slapback", T_FAR]]) {
  assert.ok(peak(t) > 4 * rmsBefore(t), `${name} reflection stands out at ${(t * 1000).toFixed(1)} ms (peak ${peak(t).toFixed(4)} vs ${rmsBefore(t).toFixed(4)})`);
}
// nothing before the first reflection (the dry sound is mixed separately)
assert.ok(energy(0.015, 0.012) === 0, "silent before the first reflection");
// the flutter decays: each bounce quieter than the last
assert.ok(energy(T_SIDE) > energy(2 * T_SIDE) && energy(2 * T_SIDE) > energy(3 * T_SIDE), "flutter decays");
// the tail dies away: the last 0.3 s is far quieter than the first reflections
let tail = 0; for (let i = Math.round(1.7 * SR); i < 2 * SR; i++) tail += L[i] * L[i];
assert.ok(tail < energy(T_SIDE) * 0.05, "tail has died away by 2 s");
// same response every time (seeded)
const [L2] = makeCourtyardIR(SR, 2.0);
assert.ok(L.every((v, i) => v === L2[i]), "deterministic");

console.log("reverb ok");
