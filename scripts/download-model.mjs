import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env, pipeline } from "@huggingface/transformers";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelDirectory = path.join(root, "models", "dinov3-vitb");
const modelId = "onnx-community/dinov3-vitb16-pretrain-lvd1689m-ONNX";

await mkdir(modelDirectory, { recursive: true });
env.cacheDir = modelDirectory;
env.allowRemoteModels = true;

let lastPercent = -1;
process.stdout.write(`Downloading ${modelId} for offline use…\n`);
const extractor = await pipeline("image-feature-extraction", modelId, {
  dtype: "fp32",
  progress_callback: (event) => {
    if (event.status === "progress" && typeof event.progress === "number") {
      const percent = Math.floor(event.progress);
      if (percent >= lastPercent + 10) {
        lastPercent = percent;
        process.stdout.write(`${event.file || "model"}: ${percent}%\n`);
      }
    }
  },
});

await writeFile(path.join(modelDirectory, "READY.json"), JSON.stringify({ modelId, dtype: "fp32", downloadedAt: new Date().toISOString() }, null, 2));
await extractor.dispose?.();
process.stdout.write(`Model ready at ${modelDirectory}\n`);
