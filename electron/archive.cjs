const fsp = require("node:fs/promises");
const path = require("node:path");
const { filesEqual, isInside, sha256 } = require("./scanner.cjs");

const ARCHIVE_NAME = ".duplicates";

async function availableDestination(archiveRoot, relativePath) {
  const parsed = path.parse(relativePath);
  let attempt = path.join(archiveRoot, relativePath);
  let suffix = 1;
  while (true) {
    try {
      await fsp.access(attempt);
      attempt = path.join(archiveRoot, parsed.dir, `${parsed.name} (${suffix})${parsed.ext}`);
      suffix += 1;
    } catch {
      return attempt;
    }
  }
}

async function verifyDuplicate(root, item) {
  const { targetPath, keeperPath, expectedHash } = item;
  if (!isInside(root, targetPath) || !isInside(root, keeperPath)) throw new Error("File is outside the selected folder.");
  if (path.resolve(targetPath) === path.resolve(keeperPath)) throw new Error("The kept copy cannot be moved.");
  const archiveRoot = path.join(path.resolve(root), ARCHIVE_NAME);
  if (isInside(archiveRoot, targetPath) || isInside(archiveRoot, keeperPath)) throw new Error("Hidden archive files cannot be processed.");

  const [targetStat, keeperStat] = await Promise.all([fsp.stat(targetPath), fsp.stat(keeperPath)]);
  if (!targetStat.isFile() || !keeperStat.isFile() || targetStat.size !== keeperStat.size) throw new Error("Files changed since the scan. Scan again.");
  const [targetHash, keeperHash] = await Promise.all([sha256(targetPath), sha256(keeperPath)]);
  if (targetHash !== expectedHash || keeperHash !== expectedHash || targetHash !== keeperHash) throw new Error("Exact-match verification failed. Nothing was moved.");
  if (!(await filesEqual(targetPath, keeperPath))) throw new Error("Byte comparison failed. Nothing was moved.");
}

async function moveOne(root, item) {
  await verifyDuplicate(root, item);
  const archiveRoot = path.join(path.resolve(root), ARCHIVE_NAME);
  const relativePath = path.relative(path.resolve(root), path.resolve(item.targetPath));
  const destinationPath = await availableDestination(archiveRoot, relativePath);
  await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
  await fsp.rename(item.targetPath, destinationPath);
  return { sourcePath: item.targetPath, destinationPath };
}

async function moveDuplicates(root, items) {
  const moved = [];
  const failed = [];
  for (const item of items) {
    try { moved.push(await moveOne(root, item)); }
    catch (error) { failed.push({ sourcePath: item.targetPath, error: error instanceof Error ? error.message : "Move failed" }); }
  }
  return { archivePath: path.join(path.resolve(root), ARCHIVE_NAME), moved, failed };
}

module.exports = { ARCHIVE_NAME, availableDestination, moveDuplicates, moveOne, verifyDuplicate };
