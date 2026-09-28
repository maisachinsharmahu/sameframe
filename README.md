# Sameframe

**Find exact and visually similar photo or video copies without uploading your media.**

Media libraries get messy quickly: exports, phone backups, copied folders,
re-encoded videos, resized photos, and filenames that no longer explain what
anything is. Sameframe scans a folder you choose and separates the problem into
two honest workflows:

- **Exact duplicates** are verified with SHA-256 and a literal byte-for-byte
  comparison. These are safe candidates for cleanup.
- **Similar media** is analyzed locally with vision models and shown only for
  manual review. AI suggestions never receive a move action.

Sameframe is a local Next.js + Electron desktop app. No account, no telemetry,
and no media uploads — see [PRIVACY.md](PRIVACY.md).

## Features

- **Exact photo and video matching** regardless of filename or folder.
- **Pre-move verification** — both files are hashed and compared byte by byte
  again immediately before any action.
- **Non-destructive isolation** — unwanted exact copies move into a hidden
  `.duplicates` folder inside the selected root.
- **One-click bulk move** — choose one keeper per group, then isolate every
  verified extra copy together.
- **Similar-photo review** using DINOv3 ViT-B/16 embeddings.
- **Similar-video review** using V-JEPA 2 ViT-L over sampled video sequences,
  not just a single thumbnail.
- **Adjustable similarity thresholds** for broader or stricter review.
- **Full paths and previews** with one-click reveal in Finder.
- **Cached embeddings** — unchanged files are not reprocessed on later scans.
- **100% local processing.**

## How exact matching works

Sameframe does not use AI to decide whether two files are exact copies.

1. Recursively index supported photos and videos.
2. Group candidates by media type and byte size.
3. SHA-256 hash only same-size candidates.
4. Compare every byte inside matching-hash groups.
5. Before cleanup, stat, hash, and byte-compare the kept and unwanted copies
   again.
6. Abort if anything changed; otherwise preserve its relative path under the
   selected root's hidden `.duplicates` folder.

Dot-prefixed hidden directories are never scanned. This permanently excludes
`.duplicates` from future exact and AI scans without maintaining a separate
ignore database.

Names, timestamps, metadata, thumbnails, and model scores cannot turn a file
into an exact duplicate.

## Install from source

The complete local-AI setup currently targets Apple Silicon macOS. It requires
Node.js 20+ (Node.js 22 recommended), Python 3.11+, and FFmpeg.

```bash
git clone https://github.com/maisachinsharmahu/sameframe.git
cd sameframe
npm install
npm run setup:video-runtime
npm run download:models
npm run dev
```

`npm run download:models` downloads model weights directly from Hugging Face;
weights are deliberately not committed to this repository:

- [DINOv3 ViT-B/16 ONNX](https://huggingface.co/onnx-community/dinov3-vitb16-pretrain-lvd1689m-ONNX)
  — approximately 343 MB, for photos.
- [V-JEPA 2 ViT-L](https://huggingface.co/facebook/vjepa2-vitl-fpc64-256)
  — approximately 1.3 GB, for videos.

The first AI scan is compute-heavy. Later scans reuse a local embedding cache
and process only new or changed files.

## Build the macOS app

After installing the runtime and models:

```bash
npm run package:mac
open "dist/mac-arm64/Sameframe.app"
```

The local build is not code-signed or notarized. If macOS blocks its first
launch, right-click `Sameframe.app`, choose **Open**, then confirm once.

## Development without AI models

Exact scanning, the interface, and automated tests do not require model
downloads:

```bash
npm install
npm run dev
npm test
```

The Similar media section remains unavailable until both local models are
installed.

## Supported media

Images: JPG, JPEG, PNG, GIF, WebP, BMP, TIFF, HEIC, HEIF, and AVIF.

Videos: MP4, MOV, M4V, AVI, MKV, WebM, WMV, FLV, 3GP, MTS, M2TS, MPG, and
MPEG.

Unreadable files and symbolic links are skipped rather than guessed about.

## Model results are suggestions

Similarity is not identity. Crops, color changes, repeated scenes, or visually
similar recordings can produce a high model score. Sameframe therefore keeps
AI results in a separate review-only area with no move action. Use Exact
duplicates for deterministic cleanup.

## Contributing

Issues and pull requests are welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

Sameframe source code is available under the [MIT License](LICENSE).

Downloaded model weights are not covered by the Sameframe license. DINOv3 uses
the [DINOv3 license](https://ai.meta.com/resources/models-and-libraries/dinov3-license/),
and V-JEPA 2 is distributed under its model repository's MIT license. Review
those terms before redistribution or commercial use.
