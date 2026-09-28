import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { moveDuplicates } = require("../electron/archive.cjs");
const { sha256 } = require("../electron/scanner.cjs");

test("verified duplicate moves into hidden archive and preserves relative path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sameframe-archive-"));
  const phone = path.join(root, "phone", "photo.jpg");
  const computer = path.join(root, "computer", "renamed.jpg");
  await mkdir(path.dirname(phone));
  await mkdir(path.dirname(computer));
  await writeFile(phone, "same-media-bytes");
  await writeFile(computer, "same-media-bytes");
  const expectedHash = await sha256(phone);

  const result = await moveDuplicates(root, [{ targetPath: computer, keeperPath: phone, expectedHash }]);
  assert.equal(result.failed.length, 0);
  assert.equal(result.moved.length, 1);
  assert.equal(result.moved[0].destinationPath, path.join(root, ".duplicates", "computer", "renamed.jpg"));
  assert.equal(await readFile(phone, "utf8"), "same-media-bytes");
  assert.equal(await readFile(result.moved[0].destinationPath, "utf8"), "same-media-bytes");
  await assert.rejects(() => access(computer));
});

test("archive never overwrites an existing path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sameframe-collision-"));
  const keeper = path.join(root, "keep.jpg");
  const extra = path.join(root, "folder", "copy.jpg");
  const occupied = path.join(root, ".duplicates", "folder", "copy.jpg");
  await mkdir(path.dirname(extra));
  await mkdir(path.dirname(occupied), { recursive: true });
  await writeFile(keeper, "same");
  await writeFile(extra, "same");
  await writeFile(occupied, "older archived file");
  const expectedHash = await sha256(keeper);

  const result = await moveDuplicates(root, [{ targetPath: extra, keeperPath: keeper, expectedHash }]);
  assert.match(result.moved[0].destinationPath, /copy \(1\)\.jpg$/);
  assert.equal(await readFile(occupied, "utf8"), "older archived file");
});

test("non-identical target is left untouched", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sameframe-reject-"));
  const keeper = path.join(root, "keep.mp4");
  const target = path.join(root, "target.mp4");
  await writeFile(keeper, "keeper");
  await writeFile(target, "target");
  const result = await moveDuplicates(root, [{ targetPath: target, keeperPath: keeper, expectedHash: await sha256(keeper) }]);
  assert.equal(result.moved.length, 0);
  assert.equal(result.failed.length, 1);
  assert.equal(await readFile(target, "utf8"), "target");
});
