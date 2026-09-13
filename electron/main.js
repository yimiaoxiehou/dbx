// dbx Electron main process.
//
// Responsibilities:
//   1. Launch (or connect to) the dbx-web Rust backend on http://127.0.0.1:4224.
//   2. Open a BrowserWindow that loads that origin (dbx-web also serves the built
//      frontend from DBX_STATIC_DIR).
//   3. Auto-provision a web-access password on first run so the user never sees a
//      login screen (parity with the Tauri build, which has no login prompt).
//   4. Expose genuinely native capabilities (local filesystem, window controls,
//      app close lifecycle) to the renderer through ipcMain handlers that the
//      preload bridges onto window.electronAPI.

const { app, BrowserWindow, ipcMain, dialog, shell, session } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");
const net = require("net");

const REPO_ROOT = path.resolve(__dirname, "..");
let BACKEND_URL = process.env.DBX_BACKEND_URL || "http://127.0.0.1:4224";
const FRONTEND_DIST = process.env.DBX_STATIC_DIR || path.join(REPO_ROOT, "dist");

let mainWindow = null;
let backendProc = null;
let allowRealQuit = false;

// Pending open queues (deep links / file associations). Phase 1 keeps them empty.
const pendingOpen = { sqlFiles: [], dbFiles: [], connectionLinks: [], aiConfigLinks: [] };

// ---------------------------------------------------------------------------
// Backend (dbx-web) lifecycle
// ---------------------------------------------------------------------------

function resolveDbxWebBin() {
  if (process.env.DBX_WEB_BIN) return process.env.DBX_WEB_BIN;
  const candidates = [
    path.join(REPO_ROOT, "target", "release", "dbx-web"),
    path.join(REPO_ROOT, "target", "debug", "dbx-web"),
  ];
  return candidates.find((c) => fs.existsSync(c)) || candidates[0];
}

async function waitForBackend(timeoutMs) {
  timeoutMs = timeoutMs || 30000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // Probe an endpoint that responds even when unauthenticated: dbx-web
      // enforces password auth on API routes, so /api/version returns 401
      // until a session exists. /api/auth/check answers without auth, so any
      // HTTP response (2xx, 401, even 500) means the server is listening and
      // serving - the session is established separately by ensureAuth().
      const res = await fetch(BACKEND_URL + "/api/auth/check");
      if (res && typeof res.status === "number") return;
    } catch (_) {
      // not up yet (connection refused / ECONNREFUSED)
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("dbx-web did not become ready at " + BACKEND_URL);
}

async function findFreePort(startPort, tries) {
  return new Promise((resolve) => {
    const attempt = (port) => {
      const srv = net.createServer();
      srv.once("error", () => {
        if (port - startPort < tries) attempt(port + 1);
        else resolve(startPort);
      });
      srv.once("listening", () => {
        const bound = srv.address().port;
        srv.close(() => resolve(bound));
      });
      srv.listen(port, "127.0.0.1");
    };
    attempt(startPort);
  });
}

async function ensureBackend() {
  if (process.env.DBX_BACKEND_URL) return; // assume an external instance is running
  const bin = resolveDbxWebBin();
  if (!fs.existsSync(bin)) {
    console.warn("[electron] dbx-web binary not found at", bin,
      "- set DBX_BACKEND_URL to point at a running instance, or build it (cargo build -p dbx-web).");
    return;
  }
  const freePort = await findFreePort(4224, 20);
  BACKEND_URL = "http://127.0.0.1:" + freePort;
  console.log("[electron] Spawning dbx-web on port", freePort, "(static=" + FRONTEND_DIST + ")");
  backendProc = spawn(bin, [], {
    env: { ...process.env, DBX_STATIC_DIR: FRONTEND_DIST, DBX_PORT: String(freePort), RUST_BACKTRACE: "1" },
    stdio: "inherit",
  });
  backendProc.on("exit", (code) => console.log("[electron] dbx-web exited with code", code));
  await waitForBackend();
}

// ---------------------------------------------------------------------------
// Auth auto-provisioning (so there is no login prompt)
// ---------------------------------------------------------------------------

function authStorePath() {
  return path.join(app.getPath("userData"), "electron-auth.json");
}

async function extractSessionCookie(res) {
  const setCookie = typeof res.headers.getSetCookie === "function"
    ? res.headers.getSetCookie()
    : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")] : []);
  for (const header of setCookie) {
    const cookieStr = header.split(";")[0];
    const eq = cookieStr.indexOf("=");
    if (eq === -1) continue;
    const name = cookieStr.slice(0, eq).trim();
    const value = cookieStr.slice(eq + 1);
    if (!name || !value) continue;
    await session.defaultSession.cookies.set({
      url: BACKEND_URL,
      name: name,
      value: value,
      path: "/",
      httpOnly: true,
      sameSite: "lax",
    });
  }
}

async function ensureAuth() {
  let password = null;
  try {
    password = JSON.parse(fs.readFileSync(authStorePath(), "utf8")).password;
  } catch (_) {
    password = null;
  }

  if (!password) {
    password = crypto.randomBytes(16).toString("hex");
    try {
      const res = await fetch(BACKEND_URL + "/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        fs.writeFileSync(authStorePath(), JSON.stringify({ password }));
        await extractSessionCookie(res);
      } else {
        console.warn("[electron] /api/auth/setup rejected (a password may already be set); user may need to log in once.");
      }
    } catch (e) {
      console.warn("[electron] auth setup failed:", e.message);
    }
    return;
  }

  // Password already known from a previous run -> log in to obtain a session.
  try {
    const res = await fetch(BACKEND_URL + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) await extractSessionCookie(res);
  } catch (e) {
    console.warn("[electron] auth login failed:", e.message);
  }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: "#1e1e1e",
    title: "dbx",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());

  mainWindow.on("resize", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("electron:window:resized");
    }
  });

  // Intercept the OS close button: ask the frontend to decide (quit vs hide).
  mainWindow.on("close", (event) => {
    if (allowRealQuit) return;
    event.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("dbx-app-close-requested", "settings");
    }
  });

  mainWindow.loadURL(BACKEND_URL).catch((e) => {
    console.error("[electron] failed to load", BACKEND_URL, e.message);
  });

  return mainWindow;
}

// ---------------------------------------------------------------------------
// Native capability handlers (local FS, window controls, app close)
// ---------------------------------------------------------------------------

function hashContent(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function fileVersion(p) {
  const stat = fs.statSync(p);
  return {
    sizeBytes: stat.size,
    modifiedNs: String(stat.mtimeNs || Math.round(stat.mtimeMs * 1e6)),
    contentHash: hashContent(fs.readFileSync(p)),
  };
}

function registerHandlers() {
  ipcMain.handle("electron:getAppVersion", () => app.getVersion());

  ipcMain.handle("electron:getAppSupportInfo", () => ({
    appVersion: app.getVersion(),
    runtime: "desktop",
    osName: os.type(),
    osVersion: os.release(),
    arch: process.arch,
    userAgent: "dbx-electron/" + app.getVersion(),
  }));

  ipcMain.handle("electron:readExternalSqlFileSnapshot", (_e, p, maxSizeBytes) => {
    if (!fs.existsSync(p)) throw new Error("File not found: " + p);
    const stat = fs.statSync(p);
    if (typeof maxSizeBytes === "number" && stat.size > maxSizeBytes) {
      const err = new Error("SQL file is too large to open in the editor");
      err.code = "tooLarge";
      throw err;
    }
    const buf = fs.readFileSync(p);
    return { content: buf.toString("utf8"), version: fileVersion(p) };
  });

  ipcMain.handle("electron:writeExternalSqlFile", (_e, p, content, options) => {
    const opts = options || {};
    if (fs.existsSync(p) && opts.expectedContentHash) {
      const current = fileVersion(p);
      if (current.contentHash !== opts.expectedContentHash) {
        return { kind: "conflict", currentVersion: current };
      }
    }
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
    return { kind: "written", version: fileVersion(p) };
  });

  ipcMain.handle("electron:saveExternalSqlFile", async (_e, defaultFileName, content) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultFileName || "query.sql",
      filters: [{ name: "SQL", extensions: ["sql"] }],
    });
    if (canceled || !filePath) return null;
    fs.writeFileSync(filePath, content);
    return { path: filePath, version: fileVersion(filePath) };
  });

  ipcMain.handle("electron:inspectExternalSqlFile", (_e, p) => {
    if (!fs.existsSync(p)) return { kind: "missing" };
    const stat = fs.statSync(p);
    return { kind: "present", sizeBytes: stat.size, modifiedNs: String(stat.mtimeNs || Math.round(stat.mtimeMs * 1e6)) };
  });

  ipcMain.handle("electron:listSqlFilesInFolder", (_e, folderPath) => {
    function walk(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      return entries
        .filter((ent) => ent.name !== "node_modules" && !ent.name.startsWith("."))
        .map((ent) => {
          const full = path.join(dir, ent.name);
          const isDir = ent.isDirectory();
          return { name: ent.name, path: full, is_dir: isDir, children: isDir ? walk(full) : [] };
        });
    }
    if (!fs.existsSync(folderPath)) return [];
    return walk(folderPath);
  });

  ipcMain.handle("electron:createSqlFileInFolder", (_e, rootPath, directoryPath, fileName) => {
    const full = path.join(rootPath, directoryPath, fileName);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, "");
    return full;
  });

  ipcMain.handle("electron:renameSqlFileInFolder", (_e, rootPath, filePath, fileName) => {
    const full = path.join(rootPath, filePath, fileName);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.renameSync(path.join(rootPath, filePath), full);
    return full;
  });

  ipcMain.handle("electron:deleteSqlFileInFolder", (_e, rootPath, filePath) => {
    fs.rmSync(path.join(rootPath, filePath), { recursive: true, force: true });
  });

  ipcMain.handle("electron:openSavedSqlStorageDir", (_e, dir) => {
    const target = dir || path.join(app.getPath("userData"), "saved-sql");
    fs.mkdirSync(target, { recursive: true });
    return shell.openPath(target);
  });

  ipcMain.handle("electron:revealPathInFileManager", (_e, p) => shell.showItemInFolder(p));

  ipcMain.handle("electron:isSqliteDatabaseFile", (_e, p) => {
    try {
      const fd = fs.openSync(p, "r");
      const head = Buffer.alloc(16);
      fs.readSync(fd, head, 0, 16, 0);
      fs.closeSync(fd);
      return head.toString("latin1", 0, 15) === "SQLite format 3";
    } catch (_) {
      return false;
    }
  });

  ipcMain.handle("electron:deleteDatabaseBackupFiles", (_e, paths) => {
    let removed = 0;
    for (const p of paths || []) {
      try {
        fs.rmSync(p, { force: true });
        removed++;
      } catch (_) {}
    }
    return removed;
  });

  ipcMain.handle("electron:savedSqlStorageDir", () => path.join(app.getPath("userData"), "saved-sql"));

  ipcMain.handle("electron:getDriverStorePath", () => ({
    dir: path.join(os.homedir(), ".dbx-web", "agents", "drivers"),
  }));

  ipcMain.handle("electron:pendingOpenSqlFiles", () => pendingOpen.sqlFiles);
  ipcMain.handle("electron:pendingOpenDbFiles", () => pendingOpen.dbFiles);
  ipcMain.handle("electron:pendingOpenConnectionLinks", () => pendingOpen.connectionLinks);
  ipcMain.handle("electron:pendingOpenAiConfigLinks", () => pendingOpen.aiConfigLinks);

  // Window controls
  ipcMain.handle("electron:window:minimize", () => mainWindow && mainWindow.minimize());
  ipcMain.handle("electron:window:toggleMaximize", () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.handle("electron:window:isMaximized", () => (mainWindow ? mainWindow.isMaximized() : false));
  ipcMain.handle("electron:window:isFullscreen", () => (mainWindow ? mainWindow.isFullScreen() : false));

  // App close lifecycle
  ipcMain.handle("electron:requestAppClose", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("dbx-app-close-requested", "settings");
    }
  });
  ipcMain.handle("electron:completeAppClose", (_e, action) => {
    if (action === "quit") {
      allowRealQuit = true;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    } else {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
    }
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  registerHandlers();
  try {
    await ensureBackend();
    await ensureAuth();
  } catch (e) {
    console.error("[electron]", e.message);
  }
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (mainWindow && mainWindow.isDestroyed() === false) mainWindow.show();
  });
});

function shutdownBackend() {
  if (backendProc) {
    try {
      backendProc.kill();
    } catch (_) {}
    backendProc = null;
  }
}

app.on("before-quit", () => {
  allowRealQuit = true;
});

app.on("quit", shutdownBackend);
process.on("SIGINT", () => { shutdownBackend(); app.quit(); });
process.on("SIGTERM", () => { shutdownBackend(); app.quit(); });
