import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { filesEqual, isInside, mediaKind, scanFolder, sha256 } = require("../electron/scanner.cjs");

test("detects supported media without treating documents as media", () => {
  assert.equal(mediaKind("photo.HEIC"), "image");
  assert.equal(mediaKind("clip.MOV"), "video");
  assert.equal(mediaKind("notes.pdf"), null);
});

test("path containment rejects siblings", async () => {
  const root = path.join(os.tmpdir(), "sameframe-root");
  assert.equal(isInside(root, path.join(root, "nested", "photo.jpg")), true);
  assert.equal(isInside(root, path.join(os.tmpdir(), "sameframe-root-copy", "photo.jpg")), false);
});

test("scanner returns only byte-identical duplicate media", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sameframe-test-"));
  await mkdir(path.join(root, "phone"));
  await mkdir(path.join(root, "pc"));
  await writeFile(path.join(root, "phone", "one.jpg"), "identical-media-bytes");
  await writeFile(path.join(root, "pc", "renamed.jpg"), "identical-media-bytes");
  await writeFile(path.join(root, "pc", "same-size.jpg"), "different-media-contents");
  await writeFile(path.join(root, "pc", "not-media.txt"), "identical-media-bytes");
  const result = await scanFolder(root);
  assert.equal(result.mediaFiles, 3);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].files.length, 2);
  assert.equal(result.duplicateFiles, 1);
});

test("SHA-256 changes when one byte changes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sameframe-hash-"));
  const a = path.join(root, "a.mp4");
  const b = path.join(root, "b.mp4");
  await writeFile(a, "abc");
  await writeFile(b, "abd");
  assert.notEqual(await sha256(a), await sha256(b));
  assert.equal(await filesEqual(a, b), false);
  await writeFile(b, "abc");
  assert.equal(await filesEqual(a, b), true);
});
