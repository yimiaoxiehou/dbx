export function isTauriRuntime(globalObject: Record<string, unknown> = globalThis as Record<string, unknown>): boolean {
  return Boolean(globalObject.__TAURI_INTERNALS__ || globalObject.__TAURI__);
}

/**
 * True when running inside the Electron shell. The preload script
 * (electron/preload.js) exposes a `window.electronAPI` bridge, which we use as
 * the detection signal. Electron reuses the HTTP backend (dbx-web) for all
 * command routing and implements the desktop-only local-file operations in the
 * main process, so it is a "desktop runtime" but NOT a Tauri runtime.
 */
export function isElectronRuntime(globalObject: Record<string, unknown> = globalThis as Record<string, unknown>): boolean {
  return Boolean(globalObject.electronAPI);
}

/** True for any bundled desktop shell (Tauri or Electron). */
export function isDesktopRuntime(globalObject: Record<string, unknown> = globalThis as Record<string, unknown>): boolean {
  return isTauriRuntime(globalObject) || isElectronRuntime(globalObject);
}
