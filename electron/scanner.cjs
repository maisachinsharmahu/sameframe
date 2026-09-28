const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".heif", ".avif"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm", ".wmv", ".flv", ".3gp", ".mts", ".m2ts", ".mpg", ".mpeg"]);

function mediaKind(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  return null;
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

async function collectMedia(root, progress, signal) {
  const files = [];
  const directories = [root];
  let visited = 0;
  let skipped = 0;

  while (directories.length) {
    if (signal?.aborted) throw new Error("Scan cancelled");
    const directory = directories.pop();
    let entries;
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true });
    } catch {
      skipped += 1;
      continue;
    }

    for (const entry of entries) {
      if (entry.name === ".DS_Store" || entry.name.startsWith("._")) continue;
      const filePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) { skipped += 1; continue; }
      if (entry.isDirectory()) { directories.push(filePath); continue; }
      if (!entry.isFile()) continue;
      visited += 1;
      const kind = mediaKind(filePath);
      if (!kind) continue;
      try {
        const stat = await fsp.stat(filePath);
        files.push({ path: filePath, size: stat.size, modifiedMs: stat.mtimeMs, kind });
      } catch { skipped += 1; }
      if (visited % 100 === 0) progress?.({ phase: "walking", current: visited, total: 0, message: `Found ${files.length.toLocaleString()} media files` });
    }
  }
  return { files, visited, skipped };
}

async function listMedia(root, progress, signal) {
  const resolvedRoot = path.resolve(root);
  const collected = await collectMedia(resolvedRoot, progress, signal);
  return {
    root: resolvedRoot,
    skipped: collected.skipped,
    scanned: collected.visited,
    files: collected.files.map((file) => ({
      id: crypto.createHash("sha1").update(file.path).digest("hex"),
      path: file.path,
      name: path.basename(file.path),
      relativePath: path.relative(resolvedRoot, file.path),
      size: file.size,
      modifiedMs: file.modifiedMs,
      kind: file.kind,
      previewUrl: toPreviewUrl(file.path),
    })),
  };
}

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function filesEqual(firstPath, secondPath) {
  const [firstStat, secondStat] = await Promise.all([fsp.stat(firstPath), fsp.stat(secondPath)]);
  if (!firstStat.isFile() || !secondStat.isFile() || firstStat.size !== secondStat.size) return false;
  const [first, second] = await Promise.all([fsp.open(firstPath, "r"), fsp.open(secondPath, "r")]);
  const chunkSize = 1024 * 1024;
  const firstBuffer = Buffer.allocUnsafe(chunkSize);
  const secondBuffer = Buffer.allocUnsafe(chunkSize);
  try {
    let position = 0;
    while (position < firstStat.size) {
      const length = Math.min(chunkSize, firstStat.size - position);
      const [a, b] = await Promise.all([
        first.read(firstBuffer, 0, length, position),
        second.read(secondBuffer, 0, length, position),
      ]);
      if (a.bytesRead !== b.bytesRead || !firstBuffer.subarray(0, a.bytesRead).equals(secondBuffer.subarray(0, b.bytesRead))) return false;
      position += a.bytesRead;
    }
    return true;
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return output;
}

function toPreviewUrl(filePath) {
  return `sameframe-media://preview/${Buffer.from(filePath).toString("base64url")}`;
}

async function scanFolder(root, progress, signal) {
  const started = Date.now();
  const resolvedRoot = path.resolve(root);
  const rootStat = await fsp.stat(resolvedRoot);
  if (!rootStat.isDirectory()) throw new Error("Please choose a folder.");

  const collected = await collectMedia(resolvedRoot, progress, signal);
  const bySize = new Map();
  for (const file of collected.files) {
    const key = `${file.kind}:${file.size}`;
    const sameSize = bySize.get(key) || [];
    sameSize.push(file);
    bySize.set(key, sameSize);
  }
  const candidates = [...bySize.values()].filter((group) => group.length > 1).flat();
  let hashed = 0;
  const withHashes = await mapLimit(candidates, 3, async (file) => {
    if (signal?.aborted) throw new Error("Scan cancelled");
    const hash = await sha256(file.path);
    hashed += 1;
    progress?.({ phase: "hashing", current: hashed, total: candidates.length, message: `Verifying ${hashed.toLocaleString()} of ${candidates.length.toLocaleString()}` });
    return { ...file, hash };
  });

  const byHash = new Map();
  for (const file of withHashes) {
    const key = `${file.kind}:${file.size}:${file.hash}`;
    const sameHash = byHash.get(key) || [];
    sameHash.push(file);
    byHash.set(key, sameHash);
  }

  const byteIdenticalGroups = [];
  for (const hashMatches of byHash.values()) {
    if (hashMatches.length < 2) continue;
    const partitions = [];
    for (const file of hashMatches) {
      let matchingPartition = null;
      for (const partition of partitions) {
        if (await filesEqual(partition[0].path, file.path)) { matchingPartition = partition; break; }
      }
      if (matchingPartition) matchingPartition.push(file);
      else partitions.push([file]);
    }
    byteIdenticalGroups.push(...partitions.filter((partition) => partition.length > 1));
  }

  const groups = byteIdenticalGroups
    .map((group) => {
      const sorted = group.sort((a, b) => a.modifiedMs - b.modifiedMs || a.path.localeCompare(b.path));
      return {
        id: sorted[0].hash,
        hash: sorted[0].hash,
        size: sorted[0].size,
        kind: sorted[0].kind,
        files: sorted.map((file) => ({
          id: crypto.createHash("sha1").update(file.path).digest("hex"),
          path: file.path,
          name: path.basename(file.path),
          relativePath: path.relative(resolvedRoot, file.path),
          size: file.size,
          modifiedMs: file.modifiedMs,
          kind: file.kind,
          previewUrl: toPreviewUrl(file.path),
        })),
      };
    })
    .sort((a, b) => (b.size * (b.files.length - 1)) - (a.size * (a.files.length - 1)));

  const duplicateFiles = groups.reduce((sum, group) => sum + group.files.length - 1, 0);
  const reclaimableBytes = groups.reduce((sum, group) => sum + group.size * (group.files.length - 1), 0);
  progress?.({ phase: "done", current: candidates.length, total: candidates.length, message: "Scan complete" });
  return {
    root: resolvedRoot,
    scanned: collected.visited,
    mediaFiles: collected.files.length,
    skipped: collected.skipped,
    duplicateFiles,
    reclaimableBytes,
    groups,
    durationMs: Date.now() - started,
  };
}

module.exports = { filesEqual, isInside, listMedia, mediaKind, scanFolder, sha256 };
