export type MediaKind = "image" | "video";

export type MediaFile = {
  id: string;
  path: string;
  name: string;
  relativePath: string;
  size: number;
  modifiedMs: number;
  kind: MediaKind;
  previewUrl: string;
};

export type DuplicateGroup = {
  id: string;
  hash: string;
  size: number;
  kind: MediaKind;
  files: MediaFile[];
};

export type ScanResult = {
  root: string;
  scanned: number;
  mediaFiles: number;
  skipped: number;
  duplicateFiles: number;
  duplicateBytes: number;
  groups: DuplicateGroup[];
  durationMs: number;
};

export type ScanProgress = {
  phase: "walking" | "hashing" | "done" | "ai-images" | "ai-videos" | "comparing";
  current: number;
  total: number;
  message: string;
};

export type DesktopApi = {
  chooseFolder(): Promise<string | null>;
  pathForFile(file: File): string;
  scanFolder(path: string): Promise<ScanResult>;
  scanSimilar(path: string, thresholds: { image: number; video: number }): Promise<SimilarResult>;
  moveDuplicates(items: Array<{ targetPath: string; keeperPath: string; expectedHash: string }>): Promise<{ archivePath: string; moved: Array<{ sourcePath: string; destinationPath: string }>; failed: Array<{ sourcePath: string; error: string }> }>;
  revealFile(path: string): Promise<void>;
  onProgress(callback: (progress: ScanProgress) => void): () => void;
  getRuntimeInfo(): Promise<{ desktop: boolean; platform: string; ffmpeg: boolean; modelReady: boolean; videoModelReady: boolean }>;
};

export type SimilarPair = {
  id: string;
  score: number;
  kind: MediaKind;
  model: string;
  files: [MediaFile, MediaFile];
};

export type SimilarResult = {
  root: string;
  mediaFiles: number;
  analyzedImages: number;
  analyzedVideos: number;
  skipped: number;
  pairs: SimilarPair[];
  durationMs: number;
  thresholds: { image: number; video: number };
};

declare global {
  interface Window { sameframe?: DesktopApi; }
}
