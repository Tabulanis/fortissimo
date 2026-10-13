// a top-row treble note moved down onto a mortar keeps its OWN instrument (10-12: Trojan's violin was playing as harp)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fillKit } from "../src/game/kit.js";

const toCrystals = (n) => { const m = /^treble (\d+)$/.exec(n.lane); if (!m || +m[1] < 9) return n; return { ...n, lane: `treble ${+m[1] - 8}`, sound: n.sound || n.lane }; };
const ROW = (kind, lo) => Array.from({ length: 8 }, (_, i) => `${kind} ${lo + i}`);

test("Trojan: every top-row treble note still plays a top-row (violin) sound after the move and the kit fill", () => {
  const s = JSON.parse(readFileSync(new URL("../public/songs/trojan-1.json", import.meta.url)));
  const tops = s.notes.filter((n) => /^treble (9|1[0-6])$/.test(n.lane)).length;
  assert.ok(tops > 0, "the song has top-row treble notes");
  const { notes } = fillKit(s.notes.map(toCrystals), [ROW("bass", 1), ROW("bass", 9), ROW("treble", 1)]);
  const moved = notes.filter((n) => n.sound && /^treble (9|1[0-6])$/.test(n.sound));
  assert.equal(moved.length, tops, "all of them keep their own sound");
  for (const n of moved) assert.ok(/violin/i.test(s.sounds[n.sound].path), `${n.sound} → ${s.sounds[n.sound].path}`);
});
