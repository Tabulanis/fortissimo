import assert from "node:assert";
import { gradeRound, letter } from "../src/game/grade.js";

// dead-on hits: 100%, S
let g = gradeRound([0, 0, 0], 0.1);
assert.strictEqual(g.accuracy, 100); assert.strictEqual(g.grade, "S");

// halfway to the box edge scores 50%
g = gradeRound([0.05, -0.05], 0.1);
assert.strictEqual(g.accuracy, 50); assert.strictEqual(g.grade, "D");
assert.strictEqual(g.biasMs, 0); assert.strictEqual(g.meanMs, 50);

// an off-chart hit counts as 0 and drags the average down
g = gradeRound([0, null], 0.1);
assert.strictEqual(g.accuracy, 50); assert.strictEqual(g.hits, 2); assert.strictEqual(g.onBox, 1);

// beyond the box scores 0, never negative
g = gradeRound([0.3], 0.1);
assert.strictEqual(g.accuracy, 0);

// rushing shows as a negative bias
g = gradeRound([-0.02, -0.04], 0.1);
assert.strictEqual(g.biasMs, -30);

// no hits at all: a D, not a crash
assert.strictEqual(gradeRound([], 0.1).grade, "D");

// grade boundaries
assert.strictEqual(letter(95), "S"); assert.strictEqual(letter(94.9), "A");
assert.strictEqual(letter(88), "A"); assert.strictEqual(letter(78), "B");
assert.strictEqual(letter(65), "C"); assert.strictEqual(letter(64.9), "D");

console.log("grade ok");
