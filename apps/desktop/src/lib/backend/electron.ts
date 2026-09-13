// Electron backend bridge.
//
// Electron reuses the web/HTTP backend (dbx-web) for all command routing — every
// `invoke("command", args)` in the Tauri build maps to a POST to `dbx-web`'s
// `/api/command` endpoint, which `./http` already implements. The only thing the
// web backend deliberately does NOT provide is desktop-local filesystem access
// (opening/saving external SQL files, revealing a path in the file manager, etc.),
// because a browser has no local FS. In Electron those operations are performed by
// the main process and exposed through the `window.electronAPI` preload bridge.
//
// So this module mirrors `./http` and overrides exactly the desktop-only
// functions that `./http` throws on. Everything else is forwarded to dbx-web over
// HTTP, identical to the browser build.

export * from "./http";

import type { ExternalSqlFileSnapshot, ExternalSqlFileWriteResult, ExternalSqlFileStatus, AppSupportInfo } from "./tauri";
import type { SqlFileEntry } from "./http";
import type { DriverStorePathInfo } from "./http";
import type { ExternalSqlFileVersion } from "@/types/database";

/**
 * The subset of the preload bridge that the Electron backend relies on. The full
 * bridge is declared/exposed in `electron/preload.js`.
 */
export interface ElectronApi {
  getAppVersion(): Promise<string>;
  getAppSupportInfo(): Promise<AppSupportInfo>;
  readExternalSqlFileSnapshot(path: string, maxSizeBytes?: number): Promise<ExternalSqlFileSnapshot>;
  writeExternalSqlFile(path: string, content: string, options?: { expectedContentHash?: string; expectedMissing?: boolean }): Promise<ExternalSqlFileWriteResult>;
  saveExternalSqlFile(defaultFileName: string, content: string, filterExtension?: string): Promise<{ path: string; version: ExternalSqlFileVersion } | null>;
  inspectExternalSqlFile(path: string): Promise<ExternalSqlFileStatus>;
  listSqlFilesInFolder(folderPath: string, fileFilter?: string): Promise<SqlFileEntry[]>;
  createSqlFileInFolder(rootPath: string, directoryPath: string, fileName: string): Promise<string>;
  renameSqlFileInFolder(rootPath: string, filePath: string, fileName: string): Promise<string>;
  deleteSqlFileInFolder(rootPath: string, filePath: string): Promise<void>;
  openSavedSqlStorageDir(dir?: string | null): Promise<void>;
  revealPathInFileManager(path: string): Promise<void>;
  isSqliteDatabaseFile(path: string): Promise<boolean>;
  deleteDatabaseBackupFiles(paths: string[], allowedRoots?: string[]): Promise<number>;
  savedSqlStorageDir(): Promise<string>;
  pendingOpenSqlFiles(): Promise<string[]>;
  pendingOpenDbFiles(): Promise<string[]>;
  pendingOpenConnectionLinks(): Promise<string[]>;
  pendingOpenAiConfigLinks(): Promise<string[]>;
  requestAppClose(): Promise<void>;
  completeAppClose(action: "quit" | "hide"): Promise<void>;
  getDriverStorePath(): Promise<DriverStorePathInfo>;
}

function getElectronApi(): ElectronApi {
  const api = (window as unknown as { electronAPI?: ElectronApi }).electronAPI;
  if (!api) throw new Error("electronAPI bridge is unavailable (not running inside the Electron shell)");
  return api;
}

// --- Desktop-only local filesystem operations (implemented by the main process) ---

export async function readExternalSqlFileSnapshot(path: string, maxSizeBytes?: number): Promise<ExternalSqlFileSnapshot> {
  return getElectronApi().readExternalSqlFileSnapshot(path, maxSizeBytes);
}

export async function writeExternalSqlFile(path: string, content: string, options: { expectedContentHash?: string; expectedMissing?: boolean } = {}): Promise<ExternalSqlFileWriteResult> {
  return getElectronApi().writeExternalSqlFile(path, content, options);
}

export async function saveExternalSqlFile(defaultFileName: string, content: string, filterExtension?: string): Promise<{ path: string; version: ExternalSqlFileVersion } | null> {
  return getElectronApi().saveExternalSqlFile(defaultFileName, content, filterExtension);
}

export async function inspectExternalSqlFile(path: string): Promise<ExternalSqlFileStatus> {
  return getElectronApi().inspectExternalSqlFile(path);
}

export async function listSqlFilesInFolder(folderPath: string, fileFilter?: string): Promise<SqlFileEntry[]> {
  return getElectronApi().listSqlFilesInFolder(folderPath, fileFilter);
}

export async function createSqlFileInFolder(rootPath: string, directoryPath: string, fileName: string): Promise<string> {
  return getElectronApi().createSqlFileInFolder(rootPath, directoryPath, fileName);
}

export async function renameSqlFileInFolder(rootPath: string, filePath: string, fileName: string): Promise<string> {
  return getElectronApi().renameSqlFileInFolder(rootPath, filePath, fileName);
}

export async function deleteSqlFileInFolder(rootPath: string, filePath: string): Promise<void> {
  return getElectronApi().deleteSqlFileInFolder(rootPath, filePath);
}

export async function openSavedSqlStorageDir(dir?: string | null): Promise<void> {
  return getElectronApi().openSavedSqlStorageDir(dir);
}

export async function revealPathInFileManager(path: string): Promise<void> {
  return getElectronApi().revealPathInFileManager(path);
}

export async function isSqliteDatabaseFile(path: string): Promise<boolean> {
  return getElectronApi().isSqliteDatabaseFile(path);
}

export async function deleteDatabaseBackupFiles(paths: string[], allowedRoots: string[] = []): Promise<number> {
  return getElectronApi().deleteDatabaseBackupFiles(paths, allowedRoots);
}

export async function savedSqlStorageDir(): Promise<string> {
  return getElectronApi().savedSqlStorageDir();
}

export async function pendingOpenSqlFiles(): Promise<string[]> {
  return getElectronApi().pendingOpenSqlFiles();
}

export async function pendingOpenDbFiles(): Promise<string[]> {
  return getElectronApi().pendingOpenDbFiles();
}

export async function pendingOpenConnectionLinks(): Promise<string[]> {
  return getElectronApi().pendingOpenConnectionLinks();
}

export async function pendingOpenAiConfigLinks(): Promise<string[]> {
  return getElectronApi().pendingOpenAiConfigLinks();
}

// --- Application close flow (Electron window lifecycle) ---

export async function requestAppClose(): Promise<void> {
  return getElectronApi().requestAppClose();
}

export async function completeAppClose(action: "quit" | "hide"): Promise<void> {
  return getElectronApi().completeAppClose(action);
}

// --- Driver store path (local agents directory) ---

export async function getDriverStorePath(): Promise<DriverStorePathInfo> {
  return getElectronApi().getDriverStorePath();
}

// --- Version / support info (report runtime as a real desktop shell) ---

export async function getAppVersion(): Promise<string> {
  return getElectronApi().getAppVersion();
}

export async function getAppSupportInfo(): Promise<AppSupportInfo> {
  return getElectronApi().getAppSupportInfo();
}
