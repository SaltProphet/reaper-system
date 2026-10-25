#!/usr/bin/env node
/** Start Reaper as a local station: auth off, bound to 127.0.0.1 only. Prints no secrets. */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { assertSafeBind } from "./local-host-guard.mjs";
import { exitStatusFromChild, isMainModule, projectRoot } from "./with-app-env.mjs";

export const LOCAL_HOST = "127.0.0.1";
// Local-station defaults live here only; the app's code defaults stay cloud (OpenAI) so a deploy works.
export const LOCAL_MODEL_BASE_URL = "http://127.0.0.1:11434/v1";
export const LOCAL_MODEL = "gpt-oss-20b-32k";
export const MIN_NUM_CTX = 32768;
const pick = (value, fallback) => (typeof value === "string" && value.trim() ? value.trim() : fallback);

export function buildLocalEnv(processEnv) {
  if (pick(processEnv.DATABASE_URL, "")) {
    throw new Error("DATABASE_URL is set in this shell. The local station uses in-memory PGLite with auth off; run `Remove-Item Env:DATABASE_URL` in this shell only, then retry.");
  }
  return {
    ...processEnv,
    VITE_AUTH_ENABLED: "false",
    OPENAI_BASE_URL: pick(processEnv.OPENAI_BASE_URL, LOCAL_MODEL_BASE_URL),
    OPENAI_MODEL: pick(processEnv.OPENAI_MODEL, LOCAL_MODEL),
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

/** Ollama's native API root for an OpenAI-compatible base URL (drops the trailing /v1). */
export function ollamaRoot(baseUrl) {
  const url = new URL(baseUrl);
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "") || "/";
  return url.toString().replace(/\/+$/, "");
}

function isLoopbackUrl(baseUrl) {
  const host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "::1" || /^127\.\d+\.\d+\.\d+$/.test(host);
}

/**
 * One POST to Ollama /api/show for the model (read-only). Refuses to start if the model is
 * missing or its num_ctx is below 32768, because Ollama truncates long prompts silently.
 * Returns the num_ctx.
 */
export async function checkOllamaModel({ baseUrl, model, fetchImpl = fetch, minCtx = MIN_NUM_CTX }) {
  const root = ollamaRoot(baseUrl);
  let response;
  try {
    response = await fetchImpl(`${root}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new Error(`Refusing to start: Ollama is not reachable at ${root} (${error?.message ?? error}). Start Ollama, then retry.`);
  }
  if (response.status === 404) {
    throw new Error(`Refusing to start: model ${model} was not found in Ollama at ${root}. Create it with a Modelfile that sets num_ctx ${minCtx}, or set OPENAI_MODEL.`);
  }
  if (!response.ok) throw new Error(`Refusing to start: Ollama /api/show for ${model} returned HTTP ${response.status}.`);
  const payload = await response.json().catch(() => ({}));
  const match = /(?:^|\n)\s*num_ctx\s+(\d+)/.exec(typeof payload?.parameters === "string" ? payload.parameters : "");
  if (!match) {
    throw new Error(`Refusing to start: model ${model} has no num_ctx parameter (Ollama's default is below ${minCtx} and truncates silently). Create it with PARAMETER num_ctx ${minCtx}.`);
  }
  const numCtx = Number(match[1]);
  if (numCtx < minCtx) {
    throw new Error(`Refusing to start: model ${model} has num_ctx ${numCtx}, below the required ${minCtx}. Recreate it with PARAMETER num_ctx ${minCtx}.`);
  }
  return numCtx;
}

async function main() {
  const env = buildLocalEnv(process.env);
  const port = localPort(process.env);
  assertSafeBind({ host: LOCAL_HOST, authEnabled: env.VITE_AUTH_ENABLED !== "false" });
  console.log(`[start-local] model ${env.OPENAI_MODEL} at ${env.OPENAI_BASE_URL}; data dir ${env.REAPER_DATA_DIR}; http://${LOCAL_HOST}:${port}`);
  if (isLoopbackUrl(env.OPENAI_BASE_URL)) {
    const numCtx = await checkOllamaModel({ baseUrl: env.OPENAI_BASE_URL, model: env.OPENAI_MODEL });
    console.log(`[start-local] Ollama model ${env.OPENAI_MODEL} num_ctx ${numCtx}`);
  } else {
    console.log("[start-local] model base URL is not loopback; skipping the Ollama num_ctx check");
  }
  console.log(`[start-local] FIRECRAWL_API_KEY ${pick(env.FIRECRAWL_API_KEY, "") ? "present" : "MISSING (research nodes will fail; run npm run firecrawl:check)"}`);
  const root = projectRoot();
  const child = spawn(process.execPath, localViteArgs(root, port), { cwd: root, stdio: "inherit", env });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("exit", (code, signal) => process.exit(exitStatusFromChild(code, signal)));
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(`[start-local] ${error.message}`);
    process.exit(1);
  });
}
