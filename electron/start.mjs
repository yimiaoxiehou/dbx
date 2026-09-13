#!/usr/bin/env node
// Builds the frontend and launches the Electron shell.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", ...opts });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(cmd + " " + args.join(" ") + " exited with code " + code));
    });
  });
}

async function main() {
  console.log("[electron:start] building frontend...");
  await run("pnpm", ["build"], { cwd: ROOT });

  const electronBin = path.join(ROOT, "node_modules", ".bin", "electron");
  console.log("[electron:start] launching Electron...");
  await run(electronBin, [path.join(__dirname, "main.js")], { cwd: ROOT });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
