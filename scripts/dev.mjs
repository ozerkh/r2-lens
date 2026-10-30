#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { watch } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const shell = process.platform === "win32";
let child = null;
let restarting = false;
let timer = null;

function start() {
  spawnSync(process.execPath, ["scripts/ensure-session-secret.mjs", "local"], { cwd: root, stdio: "inherit" });
  child = spawn("npx", ["vite", ...process.argv.slice(2)], { cwd: root, stdio: "inherit", shell });
  child.on("exit", (code) => {
    child = null;
    if (restarting) {
      restarting = false;
      start();
    } else {
      process.exit(code ?? 0);
    }
  });
}

watch(root, (_event, filename) => {
  if (filename !== ".dev.vars") return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!child) return;
    console.log("\n.dev.vars changed, restarting the dev server…\n");
    restarting = true;
    child.kill("SIGTERM");
  }, 300);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    restarting = false;
    if (child) child.kill(signal);
    else process.exit(0);
  });
}

start();
