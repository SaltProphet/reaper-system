#!/usr/bin/env node
/** Stage 1 pre-check: key present in this shell + one search succeeds. Never prints the key. */
import { isMainModule } from "./with-app-env.mjs";

export function firecrawlKeyStatus(env) {
  const key = typeof env.FIRECRAWL_API_KEY === "string" ? env.FIRECRAWL_API_KEY.trim() : "";
  return key
    ? { ok: true }
    : { ok: false, message: "FIRECRAWL_API_KEY is not set in this shell. Set it in the shell that starts Reaper; .grok/app-env.json is not read for it." };
}

async function main() {
  const status = firecrawlKeyStatus(process.env);
  if (!status.ok) {
    console.error(status.message);
    process.exit(2);
  }
  console.log("FIRECRAWL_API_KEY present.");
  const response = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "Ollama OpenAI compatible API", limit: 1, sources: [{ type: "web" }] }),
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`Firecrawl search failed: HTTP ${response.status}.`);
    process.exit(1);
  }
  const web = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.data?.web) ? payload.data.web : [];
  if (web.length === 0) {
    console.error("Firecrawl search returned 0 results.");
    process.exit(1);
  }
  console.log(`Firecrawl OK: ${web.length} result(s); first URL ${web[0]?.url ?? "(none)"}.`);
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(`Firecrawl check failed: ${error?.message ?? error}`);
    process.exit(1);
  });
}
