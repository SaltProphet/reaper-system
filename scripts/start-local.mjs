#!/usr/bin/env node
/** Start Reaper as a local station: auth off, bound to 127.0.0.1 only. Prints no secrets. */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { assertSafeBind } from "./local-host-guard.mjs";
import { exitStatusFromChild, isMainModule, projectRoot } from "./with-app-env.mjs";

export const LOCAL_HOST = "127.0.0.1";
const pick = (value, fallback) => (typeof value === "string" && value.trim() ? value.trim() : fallback);

export function buildLocalEnv(processEnv) {
  if (pick(processEnv.DATABASE_URL, "")) {
    throw new Error("DATABASE_URL is set in this shell. The local station uses in-memory PGLite with auth off; run `Remove-Item Env:DATABASE_URL` in this shell only, then retry.");
  }
  return {
    ...processEnv,
    VITE_AUTH_ENABLED: "false",
    OPENAI_BASE_URL: pick(processEnv.OPENAI_BASE_URL, "http://127.0.0.1:11434/v1"),
    OPENAI_MODEL: pick(processEnv.OPENAI_MODEL, "gpt-oss:20b"),
    REAPER_MODEL_TIMEOUT_MS: pick(processEnv.REAPER_MODEL_TIMEOUT_MS, "600000"),
    REAPER_DATA_DIR: pick(processEnv.REAPER_DATA_DIR, "C:\\ReaperData"),
  };
}

export function localPort(processEnv) {
  const raw = pick(processEnv.REAPER_PORT, "8080");
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`REAPER_PORT must be 1024-65535, got "${raw}".`);
  return port;
}

export function localViteArgs(root, port) {
  return [join(root, "node_modules", "vite", "bin", "vite.js"), "dev", "--host", LOCAL_HOST, "--port", String(port), "--strictPort"];
}

function main() {
  const env = buildLocalEnv(process.env);
  const port = localPort(process.env);
  assertSafeBind({ host: LOCAL_HOST, authEnabled: env.VITE_AUTH_ENABLED !== "false" });
  console.log(`[start-local] model ${env.OPENAI_MODEL} at ${env.OPENAI_BASE_URL}; data dir ${env.REAPER_DATA_DIR}; http://${LOCAL_HOST}:${port}`);
  console.log(`[start-local] FIRECRAWL_API_KEY ${pick(env.FIRECRAWL_API_KEY, "") ? "present" : "MISSING (research nodes will fail; run npm run firecrawl:check)"}`);
  const root = projectRoot();
  const child = spawn(process.execPath, localViteArgs(root, port), { cwd: root, stdio: "inherit", env });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("exit", (code, signal) => process.exit(exitStatusFromChild(code, signal)));
}

if (isMainModule(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[start-local] ${error.message}`);
    process.exit(1);
  }
}
