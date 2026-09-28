const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { listMedia } = require("./scanner.cjs");

let imageExtractor = null;

function cosine(a, b) {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return dot / (Math.sqrt(aa) * Math.sqrt(bb) || 1);
}

function cacheKey(file, model) {
  return `${model}:${file.path}:${file.size}:${Math.round(file.modifiedMs)}`;
}

async function readCache(cachePath) {
  try { return JSON.parse(await fsp.readFile(cachePath, "utf8")); }
  catch { return {}; }
}

async function writeCache(cachePath, cache) {
  await fsp.mkdir(path.dirname(cachePath), { recursive: true });
  const temporary = `${cachePath}.tmp`;
  await fsp.writeFile(temporary, JSON.stringify(cache));
  await fsp.rename(temporary, cachePath);
}

async function getImageExtractor(modelRoot) {
  if (imageExtractor) return imageExtractor;
  const { env, pipeline } = await import("@huggingface/transformers");
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.useFSCache = false;
  imageExtractor = await pipeline("image-feature-extraction", modelRoot, { dtype: "fp32", local_files_only: true });
  return imageExtractor;
}

async function imageEmbeddings(files, modelRoot, cache, progress) {
  const modelName = "dinov3-vitb16-fp32";
  const missing = files.filter((file) => !cache[cacheKey(file, modelName)]);
  if (missing.length) {
    const extractor = await getImageExtractor(modelRoot);
    const { RawImage } = await import("@huggingface/transformers");
    for (let index = 0; index < missing.length; index += 1) {
      const file = missing[index];
      try {
        const image = await RawImage.read(file.path);
        const output = await extractor(image);
        const hiddenSize = output.dims.at(-1);
        // DINOv3 returns CLS + register + patch tokens. The first token is the
        // compact global image descriptor and avoids a ~200x larger cache.
        cache[cacheKey(file, modelName)] = Array.from(output.data.slice(0, hiddenSize));
      } catch {
        cache[cacheKey(file, modelName)] = null;
      }
      progress?.({ phase: "ai-images", current: index + 1, total: missing.length, message: `Understanding photo ${index + 1} of ${missing.length}` });
    }
  }
  return files.map((file) => ({ file, embedding: cache[cacheKey(file, modelName)] })).filter((item) => Array.isArray(item.embedding));
}

function runVideoWorker(files, options, progress) {
  return new Promise((resolve, reject) => {
    if (!files.length) return resolve([]);
    const child = spawn(options.pythonPath, [options.workerPath, "--model", options.modelRoot], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      for (const line of text.split("\n")) {
        try {
          const event = JSON.parse(line);
          if (event.type === "progress") progress?.({ phase: "ai-videos", current: event.current, total: event.total, message: `Understanding video ${event.current} of ${event.total}` });
        } catch { /* model diagnostics are retained for errors */ }
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`V-JEPA 2 worker failed: ${stderr.slice(-800)}`));
      try { resolve(JSON.parse(stdout)); }
      catch { reject(new Error("V-JEPA 2 returned an invalid result.")); }
    });
    child.stdin.end(JSON.stringify({ paths: files.map((file) => file.path) }));
  });
}

async function videoEmbeddings(files, options, cache, progress) {
  const modelName = "vjepa2-vitl-fpc64-256";
  const missing = files.filter((file) => !cache[cacheKey(file, modelName)]);
  if (missing.length) {
    const results = await runVideoWorker(missing, options, progress);
    for (let index = 0; index < missing.length; index += 1) cache[cacheKey(missing[index], modelName)] = results[index]?.embedding || null;
  }
  return files.map((file) => ({ file, embedding: cache[cacheKey(file, modelName)] })).filter((item) => Array.isArray(item.embedding));
}

function bestPairs(items, threshold) {
  const candidates = [];
  for (let first = 0; first < items.length; first += 1) {
    for (let second = first + 1; second < items.length; second += 1) {
      const score = cosine(items[first].embedding, items[second].embedding);
      if (score >= threshold) candidates.push({ id: `${items[first].file.id}:${items[second].file.id}`, score, files: [items[first].file, items[second].file] });
    }
  }
  return candidates.sort((a, b) => b.score - a.score);
}

async function scanSimilar(root, options, progress) {
  const started = Date.now();
  const media = await listMedia(root, (event) => progress?.({ ...event, phase: "walking" }));
  const cache = await readCache(options.cachePath);
  const images = media.files.filter((file) => file.kind === "image");
  const videos = media.files.filter((file) => file.kind === "video");
  // Run large vision models sequentially to stay within a 16 GB local machine.
  const imageItems = await imageEmbeddings(images, options.imageModelRoot, cache, progress);
  const videoItems = await videoEmbeddings(videos, options, cache, progress);
  await writeCache(options.cachePath, cache);
  progress?.({ phase: "comparing", current: 1, total: 1, message: "Comparing local embeddings" });
  const pairs = [
    ...bestPairs(imageItems, options.imageThreshold).map((pair) => ({ ...pair, kind: "image", model: "DINOv3 ViT-B/16" })),
    ...bestPairs(videoItems, options.videoThreshold).map((pair) => ({ ...pair, kind: "video", model: "V-JEPA 2 ViT-L" })),
  ].sort((a, b) => b.score - a.score);
  return {
    root: media.root,
    mediaFiles: media.files.length,
    analyzedImages: imageItems.length,
    analyzedVideos: videoItems.length,
    skipped: media.skipped + images.length - imageItems.length + videos.length - videoItems.length,
    pairs,
    durationMs: Date.now() - started,
    thresholds: { image: options.imageThreshold, video: options.videoThreshold },
  };
}

module.exports = { bestPairs, cosine, scanSimilar };
