import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { bestPairs, cosine } = require("../electron/similarity.cjs");

test("cosine similarity is scale invariant", () => {
  assert.equal(cosine([1, 2, 3], [2, 4, 6]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
});

test("pair matching respects threshold and sorts strongest first", () => {
  const item = (id, embedding) => ({ file: { id, name: id }, embedding });
  const pairs = bestPairs([
    item("a", [1, 0]),
    item("b", [0.98, 0.2]),
    item("c", [0, 1]),
    item("d", [0.3, 0.95]),
  ], 0.9);
  assert.equal(pairs.length, 2);
  assert.deepEqual(pairs[0].files.map((file) => file.id), ["a", "b"]);
  assert.ok(pairs[0].score > pairs[1].score);
});
