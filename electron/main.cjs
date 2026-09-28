const { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const { filesEqual, isInside, scanFolder, sha256 } = require("./scanner.cjs");
const { scanSimilar } = require("./similarity.cjs");

protocol.registerSchemesAsPrivileged([{ scheme: "sameframe-media", privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);

let selectedRoot = null;
let mainWindow = null;

function modelPath() {
  return app.isPackaged ? path.join(process.resourcesPath, "models") : path.join(app.getAppPath(), "models");
}

function similarityOptions(thresholds = {}) {
  const resources = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return {
    imageModelRoot: path.join(modelPath(), "dinov3-vitb", "onnx-community", "dinov3-vitb16-pretrain-lvd1689m-ONNX"),
    modelRoot: path.join(modelPath(), "vjepa2-vitl"),
    pythonPath: app.isPackaged ? path.join(resources, "python-vjepa", "bin", "python") : path.join(resources, ".venv-vjepa", "bin", "python"),
    workerPath: app.isPackaged ? path.join(resources, "vjepa_worker.py") : path.join(resources, "electron", "vjepa_worker.py"),
    cachePath: path.join(app.getPath("userData"), "similarity-cache-v2.json"),
    imageThreshold: Math.min(0.995, Math.max(0.75, Number(thresholds.image) || 0.9)),
    videoThreshold: Math.min(0.995, Math.max(0.75, Number(thresholds.video) || 0.85)),
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 680,
    backgroundColor: "#0b0d12",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const devUrl = process.env.DUPLICATES_DEV_URL;
  if (devUrl) mainWindow.loadURL(devUrl);
  else mainWindow.loadFile(path.join(app.getAppPath(), "out", "index.html"));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (devUrl ? !url.startsWith(devUrl) : !url.startsWith("file:")) event.preventDefault();
  });
}

app.whenReady().then(() => {
  protocol.handle("sameframe-media", (request) => {
    try {
      const encoded = new URL(request.url).pathname.slice(1);
      const filePath = Buffer.from(encoded, "base64url").toString("utf8");
      if (!selectedRoot || (!isInside(selectedRoot, filePath) && path.resolve(filePath) !== path.resolve(selectedRoot))) return new Response("Forbidden", { status: 403 });
      return net.fetch(pathToFileURL(filePath).toString());
    } catch { return new Response("Not found", { status: 404 }); }
  });
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

ipcMain.handle("choose-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory", "createDirectory"], title: "Choose your photos and videos folder" });
  if (result.canceled || !result.filePaths[0]) return null;
  selectedRoot = path.resolve(result.filePaths[0]);
  return selectedRoot;
});

ipcMain.handle("scan-folder", async (event, folderPath) => {
  selectedRoot = path.resolve(folderPath);
  return scanFolder(selectedRoot, (payload) => event.sender.send("scan-progress", payload));
});

ipcMain.handle("scan-similar", async (event, { folderPath, thresholds }) => {
  selectedRoot = path.resolve(folderPath);
  return scanSimilar(selectedRoot, similarityOptions(thresholds), (payload) => event.sender.send("scan-progress", payload));
});

ipcMain.handle("reveal-file", async (_event, filePath) => {
  if (!selectedRoot || !isInside(selectedRoot, filePath)) throw new Error("File is outside the selected folder.");
  shell.showItemInFolder(filePath);
});

ipcMain.handle("trash-file", async (_event, { targetPath, keeperPath, expectedHash }) => {
  if (!selectedRoot || !isInside(selectedRoot, targetPath) || !isInside(selectedRoot, keeperPath)) throw new Error("File is outside the selected folder.");
  if (path.resolve(targetPath) === path.resolve(keeperPath)) throw new Error("The kept copy cannot be deleted.");
  const [targetStat, keeperStat] = await Promise.all([fsp.stat(targetPath), fsp.stat(keeperPath)]);
  if (!targetStat.isFile() || !keeperStat.isFile() || targetStat.size !== keeperStat.size) throw new Error("Files changed since the scan. Scan again.");
  const [targetHash, keeperHash] = await Promise.all([sha256(targetPath), sha256(keeperPath)]);
  if (targetHash !== expectedHash || keeperHash !== expectedHash || targetHash !== keeperHash) throw new Error("Exact-match verification failed. Nothing was deleted.");
  if (!(await filesEqual(targetPath, keeperPath))) throw new Error("Byte comparison failed. Nothing was deleted.");
  await shell.trashItem(targetPath);
  return { ok: true };
});

ipcMain.handle("runtime-info", async () => ({
  desktop: true,
  platform: process.platform,
  ffmpeg: spawnSync(process.platform === "win32" ? "where" : "which", ["ffmpeg"], { stdio: "ignore" }).status === 0,
  modelReady: fs.existsSync(path.join(modelPath(), "dinov3-vitb", "READY.json")),
  videoModelReady: fs.existsSync(path.join(modelPath(), "vjepa2-vitl", "READY.json")),
}));
