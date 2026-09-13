// dbx Electron preload - exposes a minimal, typed bridge on window.electronAPI.
const { contextBridge, ipcRenderer } = require("electron");

function invoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args);
}

contextBridge.exposeInMainWorld("electronAPI", {
  // Version / support info
  getAppVersion: () => invoke("electron:getAppVersion"),
  getAppSupportInfo: () => invoke("electron:getAppSupportInfo"),

  // Local filesystem (external SQL files, folders, backup files)
  readExternalSqlFileSnapshot: (p, max) => invoke("electron:readExternalSqlFileSnapshot", p, max),
  writeExternalSqlFile: (p, content, options) => invoke("electron:writeExternalSqlFile", p, content, options),
  saveExternalSqlFile: (defaultFileName, content) => invoke("electron:saveExternalSqlFile", defaultFileName, content),
  inspectExternalSqlFile: (p) => invoke("electron:inspectExternalSqlFile", p),
  listSqlFilesInFolder: (folderPath, fileFilter) => invoke("electron:listSqlFilesInFolder", folderPath, fileFilter),
  createSqlFileInFolder: (rootPath, directoryPath, fileName) => invoke("electron:createSqlFileInFolder", rootPath, directoryPath, fileName),
  renameSqlFileInFolder: (rootPath, filePath, fileName) => invoke("electron:renameSqlFileInFolder", rootPath, filePath, fileName),
  deleteSqlFileInFolder: (rootPath, filePath) => invoke("electron:deleteSqlFileInFolder", rootPath, filePath),
  openSavedSqlStorageDir: (dir) => invoke("electron:openSavedSqlStorageDir", dir),
  revealPathInFileManager: (p) => invoke("electron:revealPathInFileManager", p),
  isSqliteDatabaseFile: (p) => invoke("electron:isSqliteDatabaseFile", p),
  deleteDatabaseBackupFiles: (paths, allowedRoots) => invoke("electron:deleteDatabaseBackupFiles", paths, allowedRoots),
  savedSqlStorageDir: () => invoke("electron:savedSqlStorageDir"),
  getDriverStorePath: () => invoke("electron:getDriverStorePath"),

  // Pending open queues (deep links / file associations)
  pendingOpenSqlFiles: () => invoke("electron:pendingOpenSqlFiles"),
  pendingOpenDbFiles: () => invoke("electron:pendingOpenDbFiles"),
  pendingOpenConnectionLinks: () => invoke("electron:pendingOpenConnectionLinks"),
  pendingOpenAiConfigLinks: () => invoke("electron:pendingOpenAiConfigLinks"),

  // App close lifecycle
  requestAppClose: () => invoke("electron:requestAppClose"),
  completeAppClose: (action) => invoke("electron:completeAppClose", action),
  onAppCloseRequest: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on("dbx-app-close-requested", listener);
    return () => ipcRenderer.removeListener("dbx-app-close-requested", listener);
  },

  // Window controls
  minimize: () => invoke("electron:window:minimize"),
  toggleMaximize: () => invoke("electron:window:toggleMaximize"),
  isMaximized: () => invoke("electron:window:isMaximized"),
  isFullscreen: () => invoke("electron:window:isFullscreen"),
  onResized: (cb) => {
    const listener = () => cb();
    ipcRenderer.on("electron:window:resized", listener);
    return () => ipcRenderer.removeListener("electron:window:resized", listener);
  },
});
