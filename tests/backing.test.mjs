// backing.js: a section's background comes in as it's learned, full when it's done
import assert from "node:assert";
import { backLevel } from "../src/game/backing.js";

assert.ok(backLevel(0) > 0 && backLevel(0) < 0.5, "quietly there at the start");
assert.ok(backLevel(0.5) > backLevel(0) && backLevel(0.5) < 1, "grows while the section is learned");
assert.strictEqual(backLevel(1), 1, "fully in when the section is done");
console.log("backing ok");
