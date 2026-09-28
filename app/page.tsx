"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Brain, Check, FileImage, FileVideo, FolderOpen, HardDrive, Image as ImageIcon, RotateCcw, Search, ShieldCheck, Sparkles, Trash2, Video } from "lucide-react";
import type { DuplicateGroup, MediaFile, ScanProgress, ScanResult, SimilarResult } from "./types";

const EMPTY_PROGRESS: ScanProgress = { phase: "walking", current: 0, total: 0, message: "Preparing scan…" };

function bytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** index;
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function duration(value: number) {
  if (value < 1000) return `${value} ms`;
  if (value < 60000) return `${(value / 1000).toFixed(1)} sec`;
  return `${Math.floor(value / 60000)}m ${Math.round((value % 60000) / 1000)}s`;
}

function MediaPreview({ file }: { file: MediaFile }) {
  if (file.kind === "video") {
    return <video src={file.previewUrl} muted playsInline preload="metadata" controls />;
  }
  return <img src={file.previewUrl} alt="" loading="lazy" />;
}

export default function Home() {
  const [runtime, setRuntime] = useState<{ desktop: boolean; platform: string; ffmpeg: boolean; modelReady: boolean; videoModelReady: boolean } | null>(null);
  const [folder, setFolder] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [similarResult, setSimilarResult] = useState<SimilarResult | null>(null);
  const [imageThreshold, setImageThreshold] = useState(90);
  const [videoThreshold, setVideoThreshold] = useState(85);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress>(EMPTY_PROGRESS);
  const [dragging, setDragging] = useState(false);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "image" | "video">("all");
  const [keeperByGroup, setKeeperByGroup] = useState<Record<string, string>>({});
  const [pendingDelete, setPendingDelete] = useState<{ group: DuplicateGroup; file: MediaFile } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  useEffect(() => {
    window.sameframe?.getRuntimeInfo().then(setRuntime).catch(() => setRuntime({ desktop: false, platform: "browser", ffmpeg: false, modelReady: false, videoModelReady: false }));
    const unsubscribe = window.sameframe?.onProgress(setProgress);
    return () => unsubscribe?.();
  }, []);

  async function chooseFolder() {
    if (!window.sameframe) return setNotice({ tone: "bad", text: "Open the app with ‘npm run dev’ to access local folders." });
    const selected = await window.sameframe.chooseFolder();
    if (selected) await runScan(selected);
  }

  async function runScan(selected = folder) {
    if (!selected || !window.sameframe) return;
    setFolder(selected);
    setScanning(true);
    setResult(null);
    setProgress(EMPTY_PROGRESS);
    setNotice(null);
    try {
      const next = await window.sameframe.scanFolder(selected);
      setResult(next);
      setKeeperByGroup(Object.fromEntries(next.groups.map((group) => [group.id, group.files[0].path])));
    } catch (error) {
      setNotice({ tone: "bad", text: error instanceof Error ? error.message : "The scan could not finish." });
    } finally {
      setScanning(false);
    }
  }

  async function runSimilar() {
    if (!folder || !window.sameframe) return;
    if (!runtime?.modelReady || !runtime?.videoModelReady) {
      setNotice({ tone: "bad", text: "The local AI models are not installed in this build." });
      return;
    }
    setScanning(true);
    setProgress({ phase: "ai-images", current: 0, total: 0, message: "Loading local vision models…" });
    setNotice(null);
    try {
      const next = await window.sameframe.scanSimilar(folder, { image: imageThreshold / 100, video: videoThreshold / 100 });
      setSimilarResult(next);
    } catch (error) {
      setNotice({ tone: "bad", text: error instanceof Error ? error.message : "The AI similarity scan could not finish." });
    } finally { setScanning(false); }
  }

  async function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    const item = event.dataTransfer.files[0];
    if (!item || !window.sameframe) return;
    try {
      const droppedPath = window.sameframe.pathForFile(item);
      if (!droppedPath) throw new Error("That folder path could not be read.");
      await runScan(droppedPath);
    } catch (error) {
      setNotice({ tone: "bad", text: error instanceof Error ? error.message : "Drop a folder, not an individual file." });
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || !window.sameframe) return;
    const keeperPath = keeperByGroup[pendingDelete.group.id];
    setDeleting(true);
    try {
      await window.sameframe.trashFile({ targetPath: pendingDelete.file.path, keeperPath, expectedHash: pendingDelete.group.hash });
      const reclaimed = pendingDelete.file.size;
      setResult((current) => {
        if (!current) return current;
        const groups = current.groups.map((group) => group.id === pendingDelete.group.id ? { ...group, files: group.files.filter((file) => file.id !== pendingDelete.file.id) } : group).filter((group) => group.files.length > 1);
        return { ...current, groups, duplicateFiles: Math.max(0, current.duplicateFiles - 1), reclaimableBytes: Math.max(0, current.reclaimableBytes - reclaimed) };
      });
      setNotice({ tone: "good", text: `${pendingDelete.file.name} moved to Trash. It can still be restored.` });
      setPendingDelete(null);
    } catch (error) {
      setNotice({ tone: "bad", text: error instanceof Error ? error.message : "Nothing was deleted." });
    } finally { setDeleting(false); }
  }

  const filteredGroups = useMemo(() => {
    if (!result) return [];
    const normalized = query.trim().toLowerCase();
    return result.groups.filter((group) => {
      if (kind !== "all" && group.kind !== kind) return false;
      return !normalized || group.files.some((file) => file.path.toLowerCase().includes(normalized));
    });
  }, [result, query, kind]);

  const filteredSimilar = useMemo(() => {
    if (!similarResult) return [];
    const normalized = query.trim().toLowerCase();
    return similarResult.pairs.filter((pair) => {
      if (kind !== "all" && pair.kind !== kind) return false;
      return !normalized || pair.files.some((file) => file.path.toLowerCase().includes(normalized));
    });
  }, [similarResult, query, kind]);

  return (
    <main className="app-shell" onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={handleDrop}>
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><span /><span /></div><span>Sameframe</span></div>
        <div className="local-pill"><ShieldCheck size={15} /> 100% local · nothing is uploaded</div>
      </header>

      {!result && !scanning ? (
        <section className={`welcome ${dragging ? "is-dragging" : ""}`}>
          <div className="welcome-copy">
            <div className="eyebrow">PRIVATE MEDIA CLEANUP</div>
            <h1>Keep the memories.<br /><span>Lose the copies.</span></h1>
            <p>Choose one folder containing all your phone and computer photos and videos. Sameframe only marks files whose every byte is identical.</p>
            <button className="primary-button" onClick={chooseFolder}><FolderOpen size={20} /> Choose a folder</button>
            <p className="drop-hint">or drop a folder anywhere in this window</p>
          </div>
          <div className="proof-card">
            <div className="proof-orbit"><div className="proof-file left"><ImageIcon size={33} /></div><div className="proof-file right"><ImageIcon size={33} /></div><div className="proof-check"><Check size={28} /></div></div>
            <div className="proof-row"><span>Matching method</span><strong>SHA-256 + byte re-check</strong></div>
            <div className="proof-row"><span>Deletion method</span><strong>Move to system Trash</strong></div>
            <div className="proof-row"><span>Cloud uploads</span><strong>Never</strong></div>
          </div>
        </section>
      ) : scanning ? (
        <section className="scan-state">
          <div className="scanner-visual"><div className="scan-line" /><HardDrive size={58} /></div>
          <div className="eyebrow">{progress.phase.startsWith("ai-") ? "LOCAL AI ANALYSIS" : progress.phase === "comparing" ? "MATCHING EMBEDDINGS" : progress.phase === "walking" ? "INDEXING MEDIA" : "VERIFYING BYTES"}</div>
          <h1>{progress.message}</h1>
          <p className="folder-path">{folder}</p>
          <div className="progress-track"><span style={{ width: progress.total ? `${Math.max(4, progress.current / progress.total * 100)}%` : "38%" }} /></div>
          <p className="safe-note">Read-only scan. No file can be changed at this stage.</p>
        </section>
      ) : result ? (
        <section className="workspace">
          <div className="summary-head">
            <div><div className="eyebrow">SCAN COMPLETE</div><h1>{result.duplicateFiles ? `${result.duplicateFiles} extra ${result.duplicateFiles === 1 ? "copy" : "copies"} found` : "No exact copies found"}</h1><p title={result.root}>{result.root}</p></div>
            <button className="secondary-button" onClick={() => runScan()}><RotateCcw size={17} /> Scan again</button>
          </div>

          <div className="stats-grid">
            <div className="stat accent"><span>Space recoverable</span><strong>{bytes(result.reclaimableBytes)}</strong></div>
            <div className="stat"><span>Duplicate sets</span><strong>{result.groups.length}</strong></div>
            <div className="stat"><span>Media checked</span><strong>{result.mediaFiles.toLocaleString()}</strong></div>
            <div className="stat"><span>Scan time</span><strong>{duration(result.durationMs)}</strong></div>
          </div>

          <div className="controls">
            <div className="search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search paths or filenames" /></div>
            <div className="segmented">
              <button className={kind === "all" ? "active" : ""} onClick={() => setKind("all")}>All</button>
              <button className={kind === "image" ? "active" : ""} onClick={() => setKind("image")}><FileImage size={15} /> Photos</button>
              <button className={kind === "video" ? "active" : ""} onClick={() => setKind("video")}><FileVideo size={15} /> Videos</button>
            </div>
          </div>

          {filteredGroups.length ? <div className="groups">
            {filteredGroups.map((group, index) => {
              const keeper = keeperByGroup[group.id] || group.files[0].path;
              return <article className="duplicate-group" key={group.id}>
                <div className="group-head"><div className="group-title">{group.kind === "image" ? <ImageIcon size={19} /> : <Video size={19} />}<div><strong>Exact match set {String(index + 1).padStart(2, "0")}</strong><span>{group.files.length} identical files · {bytes(group.size)} each · SHA-256 {group.hash.slice(0, 12)}…</span></div></div><span className="verified"><ShieldCheck size={15} /> verified exact</span></div>
                <div className="file-grid">
                  {group.files.map((file) => {
                    const isKeeper = keeper === file.path;
                    return <div className={`file-card ${isKeeper ? "keeper" : ""}`} key={file.id}>
                      <div className="preview"><MediaPreview file={file} /><span className="kind-badge">{file.kind}</span></div>
                      <div className="file-detail">
                        <div className="file-name" title={file.name}>{file.name}</div>
                        <div className="path" title={file.path}>{file.path}</div>
                        <div className="metadata"><span>{bytes(file.size)}</span><span>{formatDate(file.modifiedMs)}</span></div>
                        <div className="file-actions">
                          <label className={`keep-choice ${isKeeper ? "selected" : ""}`}><input type="radio" name={`keeper-${group.id}`} checked={isKeeper} onChange={() => setKeeperByGroup((current) => ({ ...current, [group.id]: file.path }))} /><span>{isKeeper ? <Check size={14} /> : null}</span> Keep this copy</label>
                          <button className="reveal" onClick={() => window.sameframe?.revealFile(file.path)}>Show in folder</button>
                          {!isKeeper && <button className="trash" onClick={() => setPendingDelete({ group, file })}><Trash2 size={15} /> Trash</button>}
                        </div>
                      </div>
                    </div>;
                  })}
                </div>
              </article>;
            })}
          </div> : <div className="empty-state"><Check size={30} /><h2>{result.groups.length ? "No matches for this filter" : "Everything is already tidy"}</h2><p>{result.groups.length ? "Try a different filename or media type." : "No byte-for-byte duplicate photos or videos were found."}</p></div>}

          <section className="similar-section">
            <div className="similar-intro">
              <div className="similar-icon"><Brain size={26} /></div>
              <div><div className="eyebrow">OPTIONAL LOCAL AI REVIEW</div><h2>Find edited, compressed or resized copies</h2><p>DINOv3 ViT-B compares photos. V-JEPA 2 ViT-L understands video sequences. Results are suggestions only—AI matches never get a delete button.</p></div>
              <button className="ai-button" onClick={runSimilar}><Sparkles size={18} /> {similarResult ? "Run again" : "Find similar media"}</button>
            </div>
            <div className="thresholds">
              <label><span>Photo similarity <strong>{imageThreshold}%</strong></span><input type="range" min="75" max="99" value={imageThreshold} onChange={(event) => setImageThreshold(Number(event.target.value))} /></label>
              <label><span>Video similarity <strong>{videoThreshold}%</strong></span><input type="range" min="75" max="99" value={videoThreshold} onChange={(event) => setVideoThreshold(Number(event.target.value))} /></label>
              <div className="model-state"><span className={runtime?.modelReady && runtime?.videoModelReady ? "ready-dot" : "missing-dot"} />{runtime?.modelReady && runtime?.videoModelReady ? "Both models ready offline" : "Models unavailable"}</div>
            </div>

            {similarResult && <>
              <div className="ai-summary"><strong>{similarResult.pairs.length} review {similarResult.pairs.length === 1 ? "pair" : "pairs"}</strong><span>{similarResult.analyzedImages} photos · {similarResult.analyzedVideos} videos analyzed in {duration(similarResult.durationMs)}</span></div>
              {filteredSimilar.length ? <div className="similar-pairs">{filteredSimilar.map((pair) => <article className="similar-pair" key={pair.id}>
                <div className="group-head"><div className="group-title">{pair.kind === "image" ? <ImageIcon size={19} /> : <Video size={19} />}<div><strong>{Math.round(pair.score * 1000) / 10}% visually similar</strong><span>{pair.model} · manual review required</span></div></div><span className="ai-verified"><Sparkles size={14} /> AI suggestion</span></div>
                <div className="file-grid">{pair.files.map((file) => <div className="file-card" key={file.id}>
                  <div className="preview"><MediaPreview file={file} /><span className="kind-badge">{file.kind}</span></div>
                  <div className="file-detail"><div className="file-name" title={file.name}>{file.name}</div><div className="path" title={file.path}>{file.path}</div><div className="metadata"><span>{bytes(file.size)}</span><span>{formatDate(file.modifiedMs)}</span></div><div className="file-actions"><button className="reveal" onClick={() => window.sameframe?.revealFile(file.path)}>Show in folder</button></div></div>
                </div>)}</div>
              </article>)}</div> : <div className="empty-state compact"><Check size={26} /><h2>No likely matches at these thresholds</h2><p>Lower the confidence slightly and run the AI scan again if you want a broader review.</p></div>}
            </>}
          </section>
        </section>
      ) : null}

      {dragging && <div className="drop-overlay"><FolderOpen size={48} /><strong>Drop the folder to scan</strong><span>Subfolders will be included automatically</span></div>}
      {notice && <div className={`notice ${notice.tone}`}><span>{notice.tone === "good" ? <Check size={18} /> : <AlertTriangle size={18} />}</span>{notice.text}<button onClick={() => setNotice(null)}>×</button></div>}
      {pendingDelete && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleting) setPendingDelete(null); }}>
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-title">
          <div className="modal-icon"><Trash2 size={24} /></div><h2 id="delete-title">Move this copy to Trash?</h2>
          <p>The app will hash both files and compare every byte again immediately before moving anything. If even one byte changed, the action stops.</p>
          <div className="delete-file"><span>Move</span><strong>{pendingDelete.file.path}</strong></div>
          <div className="delete-file keep"><span>Keep</span><strong>{keeperByGroup[pendingDelete.group.id]}</strong></div>
          <div className="modal-actions"><button className="secondary-button" disabled={deleting} onClick={() => setPendingDelete(null)}>Cancel</button><button className="danger-button" disabled={deleting} onClick={confirmDelete}>{deleting ? "Verifying…" : "Verify & move to Trash"}</button></div>
        </div>
      </div>}
    </main>
  );
}
