// level geometry is editable (2026-10-08): a click registers a piece under its PATH from its level root, and a saved
// edit for that path finds the same piece on the next load
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

test("a level piece's id is its path; a saved edit for that path moves the same piece on load", async () => {
  const scene = new THREE.Scene(), root = new THREE.Group(); root.name = "courtyard"; scene.add(root);
  const wall = new THREE.Group(); root.add(new THREE.Group(), wall);
  const block = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)); wall.add(new THREE.Object3D(), block);
  const outside = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)); scene.add(outside);   // not level geometry (like a drum)
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ "@courtyard/1.1": { p: [4, 5, 6], q: [0, 0, 0, 1], s: [2, 2, 2], hidden: true } }) });
  const E = await import("../src/scene/editables.js");
  E.setLevelScene(scene);
  await E.loadEdits();
  assert.deepEqual(block.position.toArray(), [4, 5, 6]); assert.equal(block.scale.x, 2); assert.equal(block.visible, false);
  assert.equal(E.levelPieceOf(block).userData.editId, "@courtyard/1.1");   // a click on it selects it, same id
  assert.equal(E.levelPieceOf(outside), null);                             // outside the level roots: never selectable
});
