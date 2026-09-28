const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("sameframe", {
  chooseFolder: () => ipcRenderer.invoke("choose-folder"),
  pathForFile: (file) => webUtils.getPathForFile(file),
  scanFolder: (folderPath) => ipcRenderer.invoke("scan-folder", folderPath),
  scanSimilar: (folderPath, thresholds) => ipcRenderer.invoke("scan-similar", { folderPath, thresholds }),
  moveDuplicates: (items) => ipcRenderer.invoke("move-duplicates", items),
  revealFile: (filePath) => ipcRenderer.invoke("reveal-file", filePath),
  getRuntimeInfo: () => ipcRenderer.invoke("runtime-info"),
  onProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("scan-progress", listener);
    return () => ipcRenderer.removeListener("scan-progress", listener);
  },
});
