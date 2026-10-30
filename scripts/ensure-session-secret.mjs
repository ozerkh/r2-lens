#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const NAME = "SESSION_SECRET";
const SETTINGS = [
  "ALLOWED_ACCOUNT_IDS",
  "CF_OAUTH_CLIENT_ID",
  "CF_OAUTH_CLIENT_SECRET",
  "CF_OAUTH_REFRESH",
  "TOKEN_LOGIN",
  "READ_ONLY",
  "ACCESS_TEAM_DOMAIN",
  "ACCESS_AUD",
];
const root = new URL("..", import.meta.url);
const devVarsPath = new URL(".dev.vars", root);
const newSecret = () => randomBytes(32).toString("hex");

function ensureLocal() {
  if (!existsSync(devVarsPath)) {
    writeFileSync(devVarsPath, [`${NAME}=${newSecret()}`, ...SETTINGS.map((name) => `${name}=`)].join("\n") + "\n");
    console.log("Created .dev.vars");
    return;
  }
  const text = readFileSync(devVarsPath, "utf8");
  const current = /^SESSION_SECRET=(.*)$/m.exec(text)?.[1].trim() ?? "";
  if (current.length >= 32) return;
  const line = `${NAME}=${newSecret()}`;
  const next = /^SESSION_SECRET=.*$/m.test(text)
    ? text.replace(/^SESSION_SECRET=.*$/m, line)
    : `${text.replace(/\n*$/, text ? "\n" : "")}${line}\n`;
  writeFileSync(devVarsPath, next);
  console.log(`Created ${NAME} in .dev.vars`);
}

const MANUAL = `openssl rand -hex 32 | npx wrangler secret put ${NAME}`;

function wrangler(args, input) {
  const result = spawnSync("npx", ["wrangler", ...args], {
    cwd: root,
    input,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: (result.stderr ?? result.error?.message ?? "").trim() };
}

function parseSecretList(stdout) {
  for (const candidate of [stdout, ...stdout.split("\n")]) {
    const text = candidate.trim();
    if (!text.startsWith("[")) continue;
    try {
      const value = JSON.parse(text);
      if (Array.isArray(value)) return value;
    } catch {}
  }
  return null;
}

function ensureRemote() {
  const list = wrangler(["secret", "list", "--format", "json"]);
  const secrets = list.ok ? parseSecretList(list.stdout) : null;
  if (!secrets) {
    console.warn(`Could not check the Worker's secrets.${list.stderr ? `\n${list.stderr}` : ""}`);
    console.warn(`If ${NAME} is missing, set it with:\n  ${MANUAL}`);
    return;
  }
  if (secrets.some((secret) => secret.name === NAME)) return;
  const put = wrangler(["secret", "put", NAME], newSecret());
  if (!put.ok) {
    console.error(`Could not set ${NAME}.${put.stderr ? `\n${put.stderr}` : ""}`);
    console.error(`Set it with:\n  ${MANUAL}`);
    process.exit(1);
  }
  console.log(`Created ${NAME} on the Worker`);
}

const mode = process.argv[2];
if (mode === "local") ensureLocal();
else if (mode === "remote") ensureRemote();
else {
  console.error("Usage: ensure-session-secret.mjs <local|remote>");
  process.exit(1);
}
