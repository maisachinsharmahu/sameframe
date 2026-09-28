# Privacy

Sameframe is designed to process media locally.

## What stays on your device

- Selected folder paths
- Photo and video contents
- File hashes and byte comparisons
- Model embeddings and similarity scores
- Preview images and video frames
- Cleanup decisions

The app does not include analytics, telemetry, advertising, accounts, or a
cloud API. It does not upload selected media.

## Network access

The application itself does not need network access for scanning. The setup
commands access npm, PyPI, and Hugging Face to download dependencies and model
weights. Once installation is complete, exact and similarity scans run offline.

## Local cache

Similarity embeddings are cached in Electron's application-data directory so
unchanged files do not need to be analyzed again. The cache contains numeric
embeddings and file metadata, not copies of the original media.

Removing Sameframe's application-data directory removes this cache.

## File isolation

Sameframe moves user-confirmed exact copies under a hidden `.duplicates` folder
inside the selected root, preserving their relative folder structure. It does
not erase them. Hidden folders are excluded from every scan. AI similarity
suggestions cannot initiate a move operation.
