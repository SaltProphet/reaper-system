# Reaper Stage 1: Runs Locally on Ollama, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One complete source-backed research run (Objective → Research → Analysis → Condition → Record) finishes `done` on Justin's Shadow PC with `gpt-oss:20b` on local Ollama, with validated citations, at least one supported claim, and a run file on disk.

**Architecture:** Keep the existing step engine, registry, citation check and persistence untouched. Change only the provider seam in `src/lib/runtime/providers.server.ts` (configurable base URL, optional key, timeout that really holds via an undici `Agent`, message-only parsing, non-retryable local errors, 7,000-char source cap), teach `step.ts` `transient()` to honor a `retryable` tag, write a run file at the end of each run from `api.ts` `stepServerRun`, and add a loopback-only launch script plus a Vite guard that refuses auth-off on non-loopback hosts.

**Tech Stack:** TypeScript, TanStack Start + Vite 8, Node 24 (`node --test --experimental-strip-types`), PGLite in memory, Ollama ≥ 0.13.3 OpenAI-compatible `/v1/responses`, Firecrawl v2 search (cloud), `undici` (new dependency).

**Spec:** `docs/superpowers/specs/2026-10-25-reaper-local-station-design.md` §2, §3.2, §3.3, §4.9, §5, §6, §7 Stage 1.

## Global Constraints

- Host: Windows 11 Shadow PC `SHADOW-9RO04NE7`, RTX A4500 20 GB, Node 24 (v24.22.1, bundles undici 7), Ollama. No Docker (virtualization disabled). No Vercel.
- Model defaults (spec §3.1): `OPENAI_BASE_URL=http://127.0.0.1:11434/v1`, `OPENAI_MODEL=gpt-oss:20b`, `REAPER_MODEL_TIMEOUT_MS=600000`. The key is required only when the base URL host is `api.openai.com`.
- `REAPER_MODEL_CONTEXT` is **not** used in Stage 1 (the context check is Stage 3). The window is set on the Ollama side.
- Per-source content cap: 7,000 characters (was 20,000).
- Run caps stay as today: 1 search, 5 pages, 1 model call. `STEP_BUDGET=24`, `MAX_DEPTH=4` unchanged.
- A local model timeout or refused connection is **not retryable**. Firecrawl 429/5xx keeps its one retry.
- Reaper refuses to start with auth off (`VITE_AUTH_ENABLED=false`) on any host other than `127.0.0.1`, `localhost`, `::1`.
- `FIRECRAWL_API_KEY` must come from the process environment of the shell that starts Reaper (`with-app-env.mjs` only merges `VITE_` keys).
- Run file: `C:\ReaperData\runs\<runId>.json` (from `REAPER_DATA_DIR`, default `C:\ReaperData`).
- Stage 1 adds **no** sandbox, allowlist, write tools, settings file, durable storage, or new stress tests.
- No paid services. No pushes, no PRs. Local branch `design/local-station` only.
- `src/routeTree.gen.ts` is modified and uncommitted: **never `git add` it**. Always `git add` explicit paths, never `git add -A` / `git add .`.

---

## 0. Capability, scope and boundaries (read before any step)

Justin's methodology (Workstation `Methodology.md`): define capability, scope and boundaries first; verify infrastructure before adding workloads; check before changing; one change at a time.

**Capability Stage 1 must deliver:** one research run with a fully local model and cloud Firecrawl search, reachable only on this PC.

**In scope:** the items in spec §7 Stage 1, nothing else.

**Out of scope (do not touch):** the Planner, docked layout, demo cleanup, settings file, durable PGLite, router, skills, tool gateway, sandbox. If a fix seems to need one of these, stop and report.

**Boundaries on Justin's PC (hard rules):**
- Never restart, stop or reconfigure **Paperclip**, **Postgres**, or **Ollama** (no `ollama serve` restarts, no service restarts, no killing `ollama.exe`).
- Never stop **PID 33740**. Never run `Stop-Process`/`taskkill` on anything except a Reaper dev server this plan started, and only by its own PID.
- No system-wide environment variable changes by an agent. Env vars are set per shell (`$env:X = ...`) or by Justin himself.
- Never read, print, copy or log secrets (`FIRECRAWL_API_KEY`, any `.env`). Scripts print only "present"/"missing".
- No sending, posting, purchasing, or paid APIs. Firecrawl free-tier credits only (the pre-check uses 1 search, the live run uses 1 search).
- Every step marked **[needs Justin's OK]** writes to the PC or uses the GPU. Ask before running it; if Justin does it himself, record that.

**Working rules for every step:**
- **Check before changing:** read the file or run the read-only check listed in the step first.
- **One change at a time:** one commit per task; the message states what, why, and undo (`git revert <hash>` plus any manual step).
- **Two-attempt limit:** at most 2 attempts per step. After the second failure, stop, do not loop, and report the exact output.
- **Change Log:** after each task, add one entry in `C:\Obsidian Vault\Workstation\08 Governance\Change Log\` named `YYYY-MM-DD HHMM <title>.md` using Appendix A (what, files, commit, verification, undo). Writing it is a PC write **[needs Justin's OK]**; Justin may give one standing OK for Change Log entries at Step 0.5.
- Code work and unit tests happen in the box checkout `/workspace/audit/reaper-system` (Linux, Node 24 via `npx -y node@24`, same major as the PC). Live checks happen on the PC.

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/lib/runtime/errors.ts` | Create | `ProviderError` with a `retryable` tag |
| `src/lib/runtime/providers.server.ts` | Modify | model config, `postJson` options, undici agent, message-only parsing, error classification, source cap, exported schema |
| `src/lib/runtime/step.ts:120-123` | Modify | `transient()` honors the `retryable` tag first |
| `src/lib/runtime/run-file.server.ts` | Create | `runFilePath`, `writeRunFile` |
| `src/lib/runtime/api.ts:56-71` | Modify | `stepServerRun` writes the run file at `done`/`failed` |
| `src/lib/runtime/runtime.test.ts` | Modify | provider, retry, parsing, run-file tests (spec §6: Stage 1 extends this file) |
| `src/lib/runtime/fixtures/ollama-responses-request.json` | Create | exact curl request body (schema source of truth) |
| `src/lib/runtime/fixtures/ollama-responses-reaper-analysis.json` | Create | recorded Ollama reply |
| `scripts/local-host-guard.mjs` (+ `.test.mjs`) | Create | loopback check + Vite plugin |
| `scripts/start-local.mjs` (+ `.test.mjs`) | Create | loopback-only launch script |
| `scripts/firecrawl-check.mjs` (+ `.test.mjs`) | Create | Firecrawl key + one-search pre-check |
| `vite.config.ts` | Modify | register `loopbackGuardPlugin()` |
| `package.json` | Modify | `undici` dependency; `start:local`, `firecrawl:check` scripts |

Order of work: Tasks 0–2 verify infrastructure and record the fixture (no code). Tasks 3–10 are code on the box, one commit each. Tasks 11–13 move the branch to the PC and do the live run.

---

### Task 0: Preflight (read-only) and baseline

**Files:** none changed.

- [ ] **Step 0.1: Confirm the box checkout state.**
```bash
cd /workspace/audit/reaper-system && git branch --show-current && git status --short && git log --oneline -1
```
Expected: `design/local-station`, only ` M src/routeTree.gen.ts`, HEAD at the plan commit (child of `3baaed9`). Anything else modified: stop and report. Undo: none.

- [ ] **Step 0.2: Get Node 24 on the box (box only, never the PC).** The box has Node 20.19, which lacks `--experimental-strip-types`.
```bash
node --version
# box has v20; use the PC's major:
npx -y node@24 --version
```
Expected: `v24.x`. Run box tests with `npx -y node@24` instead of installing nvm; nothing is installed. Undo: none needed.

- [ ] **Step 0.3: Baseline test, typecheck, lint on the box.**
```bash
npm test 2>&1 | tail -30; npm run typecheck 2>&1 | tail -5; npm run lint 2>&1 | tail -5
node --experimental-strip-types --test src/lib/runtime/runtime.test.ts 2>&1 | tail -15
```
Expected: record exact counts. The spec notes 12 failing **script** tests already exist (Stage 2 fixes them), and `npm test`'s `&&` hides the TS tests when a script test fails, so the second command runs the runtime tests directly: all 12 should pass. This is the baseline every later task compares against. Undo: none.

- [ ] **Step 0.4: Read-only PC infrastructure inventory** (PowerShell on `SHADOW-9RO04NE7`; read-only, no OK needed):
```powershell
node --version; git --version; ollama --version
ollama list; ollama ps
nvidia-smi --query-gpu=name,memory.total,memory.used --format=csv
Get-NetTCPConnection -LocalPort 8080,11434 -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess
Get-Process -Id 33740 -ErrorAction SilentlyContinue | Select-Object Id,ProcessName
Test-Path C:\ReaperData; Test-Path C:\Reaper\reaper-system
if ($env:DATABASE_URL) { "DATABASE_URL is set in this shell" } else { "DATABASE_URL not set" }
if ($env:FIRECRAWL_API_KEY) { "FIRECRAWL_API_KEY present" } else { "FIRECRAWL_API_KEY missing" }
```
Expected: Node `v24.x` (v22.6+ also works); Ollama ≥ `0.13.3`; `gpt-oss:20b` listed; 11434 listening; note what `ollama ps` has loaded and free VRAM; note whether 8080 is taken (then use `REAPER_PORT` in Task 13); record PID 33740's name (never touched). If Ollama < 0.13.3 or `gpt-oss:20b` is missing: stop and report (upgrading Ollama restarts it; that is Justin's call).

- [ ] **Step 0.5: Get Justin's go-ahead** for the steps in "Steps that need Justin's OK" (end of plan) and ask whether he gives one standing OK for per-task Change Log entries. Record his answer in the first Change Log entry.

---

### Task 1: Context window on the Ollama side **[needs Justin's OK — Justin does it]**

Ollama's OpenAI-compatible endpoints ignore per-request `num_ctx`, so the window is set in Ollama. **Recommended: Option A (Modelfile variant)** because it does not restart Ollama. Option B (`OLLAMA_CONTEXT_LENGTH`) needs an Ollama restart, which agents must never do; only Justin may choose it and do it himself.

**Files (PC):** Create `C:\ReaperData\ollama\Modelfile.gpt-oss-20b-32k`

- [ ] **Step 1.1: Check.** `ollama show gpt-oss:20b --parameters` and `nvidia-smi`. Expected: no `num_ctx 32768` yet; roughly ≥ 14 GB VRAM free. If Paperclip has a model loaded, Justin picks the time for Step 1.3 (loading may evict it).

- [ ] **Step 1.2: Create the variant [needs Justin's OK, PC write].**
```powershell
New-Item -ItemType Directory -Force C:\ReaperData\ollama | Out-Null
Set-Content -Encoding ascii C:\ReaperData\ollama\Modelfile.gpt-oss-20b-32k "FROM gpt-oss:20b`nPARAMETER num_ctx 32768"
ollama create gpt-oss-20b-32k -f C:\ReaperData\ollama\Modelfile.gpt-oss-20b-32k
```
Verify: `ollama show gpt-oss-20b-32k --parameters` lists `num_ctx 32768`.
Undo: `ollama rm gpt-oss-20b-32k; Remove-Item C:\ReaperData\ollama\Modelfile.gpt-oss-20b-32k`.

- [ ] **Step 1.3: Load once and confirm the window [needs Justin's OK, GPU].**
```powershell
ollama run gpt-oss-20b-32k "Reply with OK." --keepalive 10m
ollama ps
```
Expected: `gpt-oss-20b-32k`, `CONTEXT 32768`, `100% GPU`. If it shows a CPU/GPU split, 32k does not fit: attempt 2 with `num_ctx 24576` (variant `gpt-oss-20b-24k`) and note that the source cap may need to drop. Stop after attempt 2.
Undo: unloads after keepalive; `ollama stop gpt-oss-20b-32k` unloads that one model now (it does not restart Ollama).

- [ ] **Step 1.4: Change Log entry** "Reaper Stage 1 Ollama 32k context variant" (Appendix A). **[PC write]**

---

### Task 2: Curl check and test fixture **[needs Justin's OK — PC write + GPU]**

Before any Stage 1 code: one call with the exact `reaper_analysis` schema (copied verbatim from today's `providers.server.ts`).

**Files:**
- Create (box, committed in Task 3): `src/lib/runtime/fixtures/ollama-responses-request.json`
- Create (PC, copied back to the box in Step 2.6): `C:\ReaperData\fixtures\ollama-responses-reaper-analysis.json`

- [ ] **Step 2.1: Write the request body on the box** — `src/lib/runtime/fixtures/ollama-responses-request.json`:
```json
{
  "model": "gpt-oss-20b-32k",
  "instructions": "Analyze only the supplied source records. Every factual claim must cite one or more supplied source IDs. Put uncertainty and missing evidence in limitations. Do not invent IDs or facts.",
  "input": "{\"objective\":{\"goal\":\"Does Ollama support the OpenAI Responses API?\",\"constraints\":\"Cite sources\",\"doneWhen\":\"A record exists\"},\"sources\":[{\"id\":\"SRC-001\",\"url\":\"https://example.com/ollama-responses\",\"title\":\"Ollama release notes\",\"retrievedAt\":\"2026-10-25T00:00:00.000Z\",\"content\":\"Ollama 0.13.3 adds an OpenAI-compatible /v1/responses endpoint.\"},{\"id\":\"SRC-002\",\"url\":\"https://example.com/structured-output\",\"title\":\"Structured outputs\",\"retrievedAt\":\"2026-10-25T00:00:00.000Z\",\"content\":\"Ollama supports JSON schema structured outputs via the format field.\"}]}",
  "text": {
    "format": {
      "type": "json_schema",
      "name": "reaper_analysis",
      "strict": true,
      "schema": {
        "type": "object",
        "additionalProperties": false,
        "required": ["summary", "claims", "limitations"],
        "properties": {
          "summary": { "type": "string" },
          "claims": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": ["text", "sourceIds"],
              "properties": {
                "text": { "type": "string" },
                "sourceIds": { "type": "array", "items": { "type": "string" } }
              }
            }
          },
          "limitations": { "type": "array", "items": { "type": "string" } }
        }
      }
    }
  }
}
```
Verify: `node -e "JSON.parse(require('fs').readFileSync('src/lib/runtime/fixtures/ollama-responses-request.json','utf8'));console.log('ok')"` → `ok`. Undo: delete the file. Do not commit yet.

- [ ] **Step 2.2: Copy the request to the PC [needs Justin's OK, PC write].** `New-Item -ItemType Directory -Force C:\ReaperData\fixtures`, then CopyFromBox the file to `C:\ReaperData\fixtures\ollama-responses-request.json`.
Undo: `Remove-Item -Recurse C:\ReaperData\fixtures`.

- [ ] **Step 2.3: Call `/v1/responses` [needs Justin's OK, GPU].**
```powershell
curl.exe -sS --max-time 900 http://127.0.0.1:11434/v1/responses -H "Content-Type: application/json" --data-binary "@C:\ReaperData\fixtures\ollama-responses-request.json" -o C:\ReaperData\fixtures\ollama-responses-reaper-analysis.json -w "HTTP %{http_code} in %{time_total}s`n"
```
Verify:
```powershell
$r = Get-Content -Raw C:\ReaperData\fixtures\ollama-responses-reaper-analysis.json | ConvertFrom-Json
$r.output | ForEach-Object { $_.type }
$msg = ($r.output | Where-Object type -eq 'message' | Select-Object -First 1).content[0].text
$a = $msg | ConvertFrom-Json; $a.summary; $a.claims.Count; $a.claims | ForEach-Object { $_.sourceIds }
```
**Pass** = HTTP 200; an `output` item of type `message` whose text parses as JSON with exactly `summary` (string), `claims` (array of `{text, sourceIds[]}`), `limitations` (array of strings), and every source ID is `SRC-001` or `SRC-002`. Also record whether a `reasoning` item comes first and whether top-level `output_text` exists (Task 4 depends on this). HTTP 404/400 or schema not honored → Step 2.4. A second attempt here is only for a transient failure (e.g. timeout while the model loads).

- [ ] **Step 2.4 (only if 2.3 fails): Fallback A, `/v1/chat/completions` with `response_format` [needs Justin's OK, GPU].** On the box, generate the body from the Step 2.1 file:
```bash
node -e '
const fs=require("fs");const r=JSON.parse(fs.readFileSync("src/lib/runtime/fixtures/ollama-responses-request.json","utf8"));
fs.writeFileSync("src/lib/runtime/fixtures/ollama-chat-request.json",JSON.stringify({model:r.model,stream:false,
 messages:[{role:"system",content:r.instructions},{role:"user",content:r.input}],
 response_format:{type:"json_schema",json_schema:{name:"reaper_analysis",strict:true,schema:r.text.format.schema}}},null,2));'
```
Copy it to `C:\ReaperData\fixtures\` and run:
```powershell
curl.exe -sS --max-time 900 http://127.0.0.1:11434/v1/chat/completions -H "Content-Type: application/json" --data-binary "@C:\ReaperData\fixtures\ollama-chat-request.json" -o C:\ReaperData\fixtures\ollama-chat-reaper-analysis.json -w "HTTP %{http_code}`n"
(Get-Content -Raw C:\ReaperData\fixtures\ollama-chat-reaper-analysis.json | ConvertFrom-Json).choices[0].message.content | ConvertFrom-Json
```
Same pass criteria. Fails → Step 2.5.

- [ ] **Step 2.5 (only if 2.4 fails): Fallback B, native `/api/chat` with `format` [needs Justin's OK, GPU].** Same generator, writing `ollama-native-request.json` as `{ model, stream: false, messages: [same two], format: <schema> }`; POST to `http://127.0.0.1:11434/api/chat`; parse `.message.content`. If this also fails, **stop Stage 1** and report that no endpoint honors the schema.

- [ ] **Step 2.6: Bring the passing reply back to the box.** CopyToBox into `src/lib/runtime/fixtures/` (same filename). Record which endpoint passed: **R** (`/v1/responses`), **A** (chat completions) or **B** (`/api/chat`). Task 4 branches on this letter. Undo: delete the box file.

- [ ] **Step 2.7: Change Log entry** "Reaper Stage 1 Ollama schema fixture" (endpoint letter, HTTP code, time, reasoning item yes/no). **[PC write]**

---

### Task 3: Model configuration (base URL, optional key, timeout, default model)

**Files:**
- Create: `src/lib/runtime/errors.ts`
- Modify: `src/lib/runtime/providers.server.ts` (`postJson` lines 23-33, Firecrawl call 60-67, `analyze` 91-142)
- Test: `src/lib/runtime/runtime.test.ts`

**Interfaces:**
- Produces: `ModelConfig = { baseUrl: string; apiKey?: string; model: string; timeoutMs: number }`; `modelConfig(): ModelConfig`; `postJson(url: string, body: unknown, options: PostOptions): Promise<JsonObject>` with `PostOptions = { apiKey?: string; timeoutMs: number; dispatcher?: unknown }`; constants `DEFAULT_MODEL_BASE_URL`, `DEFAULT_MODEL`, `DEFAULT_MODEL_TIMEOUT_MS`, `ANALYSIS_INSTRUCTIONS`, `REAPER_ANALYSIS_SCHEMA`; class `ProviderError(message: string, retryable: boolean)` in `errors.ts`.

- [ ] **Step 3.1: Check.** `grep -rn "postJson\|OPENAI_\|createProviderDependencies" src scripts` → users only in `providers.server.ts`, `api.ts`, `runtime.test.ts`.

- [ ] **Step 3.2: Write failing tests.** In `runtime.test.ts` add `import { readFileSync } from "node:fs";`, extend the providers import to `import { createProviderDependencies, modelConfig, REAPER_ANALYSIS_SCHEMA } from "./providers.server.ts";`, and append:
```ts
async function withEnv(vars: Record<string, string | undefined>, fn: () => unknown): Promise<void> {
  const old: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    old[key] = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test("model config defaults to local Ollama with no key", () => withEnv(
  { OPENAI_BASE_URL: undefined, OPENAI_API_KEY: undefined, OPENAI_MODEL: undefined, REAPER_MODEL_TIMEOUT_MS: undefined },
  () => assert.deepEqual(modelConfig(), { baseUrl: "http://127.0.0.1:11434/v1", apiKey: undefined, model: "gpt-oss:20b", timeoutMs: 600_000 }),
));

test("model config requires a key only for api.openai.com and validates the timeout", () => withEnv(
  { OPENAI_BASE_URL: "https://api.openai.com/v1/", OPENAI_API_KEY: undefined, REAPER_MODEL_TIMEOUT_MS: undefined },
  () => {
    assert.throws(() => modelConfig(), /OPENAI_API_KEY/);
    process.env.OPENAI_API_KEY = "k";
    assert.equal(modelConfig().baseUrl, "https://api.openai.com/v1");
    process.env.REAPER_MODEL_TIMEOUT_MS = "abc";
    assert.throws(() => modelConfig(), /REAPER_MODEL_TIMEOUT_MS/);
  },
));

test("analysis posts to the configured base URL without an Authorization header when no key is set", async () => {
  const oldFetch = globalThis.fetch;
  const seen: { url: string; headers: Record<string, string>; body: any }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ output_text: JSON.stringify({ summary: "s", claims: [], limitations: [] }) }), { status: 200 });
  }) as typeof fetch;
  try {
    await withEnv({ OPENAI_BASE_URL: "http://127.0.0.1:11434/v1", OPENAI_API_KEY: undefined, OPENAI_MODEL: "gpt-oss-20b-32k" }, async () => {
      const result = await createProviderDependencies().analyze(workflow(defaultState().graphs[0]).objective, [source]);
      assert.equal(result.model, "gpt-oss-20b-32k");
    });
    assert.equal(seen[0].url, "http://127.0.0.1:11434/v1/responses");
    assert.equal("Authorization" in seen[0].headers, false);
    assert.equal(seen[0].body.text.format.strict, true);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("the code schema is exactly the schema in the recorded fixture request", () => {
  const request = JSON.parse(readFileSync(new URL("./fixtures/ollama-responses-request.json", import.meta.url), "utf8"));
  assert.deepEqual(request.text.format.schema, REAPER_ANALYSIS_SCHEMA);
});
```
In the existing test "normalizes mocked Firecrawl results and parses OpenAI structured output", change `assert.equal(result.model, "gpt-5.4-mini");` to `assert.equal(result.model, "gpt-oss:20b");`.

- [ ] **Step 3.3: Run, expect FAIL.** `node --experimental-strip-types --test src/lib/runtime/runtime.test.ts` → fails: `modelConfig` / `REAPER_ANALYSIS_SCHEMA` not exported.

- [ ] **Step 3.4: Implement.** Create `src/lib/runtime/errors.ts`:
```ts
/** A provider failure that says whether the engine may retry it once. */
export class ProviderError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "ProviderError";
    this.retryable = retryable;
  }
}
```
In `providers.server.ts`, below the imports:
```ts
export const DEFAULT_MODEL_BASE_URL = "http://127.0.0.1:11434/v1";
export const DEFAULT_MODEL = "gpt-oss:20b";
export const DEFAULT_MODEL_TIMEOUT_MS = 600_000;
export const ANALYSIS_INSTRUCTIONS =
  "Analyze only the supplied source records. Every factual claim must cite one or more supplied source IDs. Put uncertainty and missing evidence in limitations. Do not invent IDs or facts.";
export const REAPER_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "claims", "limitations"],
  properties: {
    summary: { type: "string" },
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "sourceIds"],
        properties: { text: { type: "string" }, sourceIds: { type: "array", items: { type: "string" } } },
      },
    },
    limitations: { type: "array", items: { type: "string" } },
  },
};

export type ModelConfig = { baseUrl: string; apiKey?: string; model: string; timeoutMs: number };

export function modelConfig(): ModelConfig {
  const baseUrl = (env("OPENAI_BASE_URL") ?? DEFAULT_MODEL_BASE_URL).replace(/\/+$/, "");
  let host: string;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    throw new Error(`OPENAI_BASE_URL is not a valid URL: ${baseUrl}`);
  }
  const apiKey = env("OPENAI_API_KEY");
  if (host === "api.openai.com" && !apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  const rawTimeout = env("REAPER_MODEL_TIMEOUT_MS");
  const timeoutMs = rawTimeout === undefined ? DEFAULT_MODEL_TIMEOUT_MS : Number(rawTimeout);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000) {
    throw new Error(`REAPER_MODEL_TIMEOUT_MS must be a whole number of milliseconds >= 1000, got "${rawTimeout}".`);
  }
  return { baseUrl, apiKey, model: env("OPENAI_MODEL") ?? DEFAULT_MODEL, timeoutMs };
}
```
Replace `postJson`:
```ts
type PostOptions = { apiKey?: string; timeoutMs: number; dispatcher?: unknown };

export async function postJson(url: string, body: unknown, options: PostOptions): Promise<JsonObject> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`;
  const init = {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs),
    ...(options.dispatcher ? { dispatcher: options.dispatcher } : {}),
  };
  const response = await fetch(url, init as RequestInit);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status}: ${messageFor(response, payload)}`);
  return payload as JsonObject;
}
```
Firecrawl call: `postJson("https://api.firecrawl.dev/v2/search", { …body unchanged… }, { apiKey: key, timeoutMs: 60_000 })`.
In `analyze`, replace the key check, `model` line and request with:
```ts
      const config = modelConfig();
      const model = config.model;
      const payload = await postJson(`${config.baseUrl}/responses`, {
        model,
        instructions: ANALYSIS_INSTRUCTIONS,
        input: JSON.stringify({ objective, sources }),
        text: { format: { type: "json_schema", name: "reaper_analysis", strict: true, schema: REAPER_ANALYSIS_SCHEMA } },
      }, { apiKey: config.apiKey, timeoutMs: config.timeoutMs });
```
Change the two `"OpenAI returned …"` messages to `"Model returned …"`.

- [ ] **Step 3.5: Run, expect PASS** (12 old + 4 new). Then `npm run typecheck` → no new errors vs baseline.

- [ ] **Step 3.6: Commit (explicit paths only).**
```bash
git add src/lib/runtime/errors.ts src/lib/runtime/providers.server.ts src/lib/runtime/runtime.test.ts src/lib/runtime/fixtures/ollama-responses-request.json
git commit -m "feat(runtime): configurable model base URL, optional key, timeout, gpt-oss:20b default" -m "Why: Stage 1 runs the analysis on local Ollama (spec 3.2). Undo: git revert <this commit>"
git status --short   # expect only ' M src/routeTree.gen.ts'
```

- [ ] **Step 3.7: Change Log entry.** **[PC write]**

---

### Task 4: Message-only parsing against the recorded fixture

**Files:** Modify `src/lib/runtime/providers.server.ts` (`responseOutputText`, lines 43-54); add the Task 2 reply under `src/lib/runtime/fixtures/`; test in `runtime.test.ts`.

**Interfaces:** Consumes `ModelConfig`, `postJson`, `REAPER_ANALYSIS_SCHEMA` (Task 3). Produces `export function responseOutputText(payload: JsonObject): string` (throws `"Model returned no answer text."`).

- [ ] **Step 4.1: Write failing tests** (add `responseOutputText` to the providers import):
```ts
test("reads only message items, never reasoning text", () => {
  const payload = {
    output_text: "reasoning leaked here",
    output: [
      { type: "reasoning", content: [{ type: "reasoning_text", text: "thinking..." }] },
      { type: "message", content: [{ type: "output_text", text: "{\"summary\":\"answer\"}" }] },
    ],
  };
  assert.equal(responseOutputText(payload), "{\"summary\":\"answer\"}");
});

test("uses output_text only when there is no output array", () => {
  assert.equal(responseOutputText({ output_text: "x" }), "x");
});

test("a reasoning-only reply fails with no answer text", () => {
  assert.throws(
    () => responseOutputText({ output: [{ type: "reasoning", content: [{ type: "reasoning_text", text: "t" }] }] }),
    /Model returned no answer text/,
  );
});

test("parses the recorded Ollama reply into a schema-valid analysis", () => {
  const reply = JSON.parse(readFileSync(new URL("./fixtures/ollama-responses-reaper-analysis.json", import.meta.url), "utf8"));
  const parsed = JSON.parse(responseOutputText(reply));
  assert.equal(typeof parsed.summary, "string");
  assert.ok(Array.isArray(parsed.claims) && Array.isArray(parsed.limitations));
  for (const claim of parsed.claims) for (const id of claim.sourceIds) assert.match(id, /^SRC-00[12]$/);
});
```

- [ ] **Step 4.2: Run, expect FAIL** (first test returns "reasoning leaked here").

- [ ] **Step 4.3: Implement** (endpoint **R**):
```ts
export function responseOutputText(payload: JsonObject): string {
  if (Array.isArray(payload.output)) {
    for (const item of payload.output) {
      const record = asRecord(item);
      if (record.type !== "message") continue;
      const content = Array.isArray(record.content) ? record.content : [];
      for (const part of content) {
        const object = asRecord(part);
        const isAnswer = object.type === undefined || object.type === "output_text";
        if (isAnswer && typeof object.text === "string" && object.text.trim()) return object.text;
      }
    }
    throw new Error("Model returned no answer text.");
  }
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text;
  throw new Error("Model returned no answer text.");
}
```
Make sure `src/lib/runtime/fixtures/ollama-responses-reaper-analysis.json` is the Task 2 reply.

**Only if Task 2 passed on endpoint A (chat completions):** in `analyze`, post to `${config.baseUrl}/chat/completions` with body
`{ model, stream: false, messages: [{ role: "system", content: ANALYSIS_INSTRUCTIONS }, { role: "user", content: JSON.stringify({ objective, sources }) }], response_format: { type: "json_schema", json_schema: { name: "reaper_analysis", strict: true, schema: REAPER_ANALYSIS_SCHEMA } } }`
and parse with
```ts
export function chatOutputText(payload: JsonObject): string {
  const choice = asRecord(Array.isArray(payload.choices) ? payload.choices[0] : undefined);
  const content = asRecord(choice.message).content;
  if (typeof content === "string" && content.trim()) return content;
  throw new Error("Model returned no answer text.");
}
```
(the message's `reasoning` field is ignored). The fixture test then reads `ollama-chat-reaper-analysis.json` through `chatOutputText`, the reasoning-only test passes `{ choices: [{ message: { content: "", reasoning: "t" } }] }`, and the Task 3 URL assertion becomes `/v1/chat/completions`.
**Only if endpoint B (`/api/chat`):** post to `${config.baseUrl.replace(/\/v1$/, "")}/api/chat` with `{ model, stream: false, messages: [same two], format: REAPER_ANALYSIS_SCHEMA }` and parse `asRecord(payload.message).content` the same way (the `thinking` field is ignored).

- [ ] **Step 4.4: Run, expect PASS**; `npm run typecheck`.

- [ ] **Step 4.5: Commit.**
```bash
git add src/lib/runtime/providers.server.ts src/lib/runtime/runtime.test.ts src/lib/runtime/fixtures/ollama-responses-reaper-analysis.json
git commit -m "fix(runtime): read only message items from the model reply" -m "Why: gpt-oss emits reasoning items; the old parser could return reasoning text (spec 3.2). Undo: git revert <this commit>"
```
(Use the A/B fixture filename instead if that endpoint was chosen.)

- [ ] **Step 4.6: Change Log entry.** **[PC write]**

---

### Task 5: Timeout that holds (undici Agent)

Node's built-in fetch has a 300 s `headersTimeout`, and Ollama sends no headers until it finishes, so a long run dies at 5 minutes with "fetch failed". Chosen fix: an undici `Agent` as the fetch `dispatcher`, with `headersTimeout` and `bodyTimeout` = `timeoutMs`. (Streaming is the alternative; it becomes a separate decision for Justin only if this task fails twice.)

**Files:** Modify `package.json`, `package-lock.json`, `src/lib/runtime/providers.server.ts`; test in `runtime.test.ts`.

**Interfaces:** Consumes `postJson` with `dispatcher` (Task 3). Produces `modelAgentOptions(timeoutMs: number): { headersTimeout: number; bodyTimeout: number }` and internal `modelAgent(timeoutMs: number): Agent`.

- [ ] **Step 5.1: Check.** Pin `undici@7` (matches Node 24.22.1's bundled undici 7.30.1; tested on the box under Node 24 and Node 22 with built-in fetch and undici's own fetch; `undici@6` also works on Node 24 but is a different major from the bundled one). `npm view undici@7 version engines` to confirm `engines.node` (`>=20.18.1`) accepts the PC's Node 24.x (from Step 0.4). Free npm package. Do not take newer majors untested.

- [ ] **Step 5.2: Install on the box.** `npm install undici@7`. Verify: `node -e "import('undici').then(m=>console.log(typeof m.Agent))"` → `function`. Undo: `npm uninstall undici`.

- [ ] **Step 5.3: Write failing tests.** Add imports `import { createServer } from "node:http"; import type { AddressInfo } from "node:net"; import { Agent } from "undici";` and `postJson, modelAgentOptions` to the providers import, then:
```ts
test("model agent timeouts match the configured model timeout", () => {
  assert.deepEqual(modelAgentOptions(600_000), { headersTimeout: 600_000, bodyTimeout: 600_000 });
});

async function slowServer(delayMs: number) {
  const server = createServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{\"ok\":true}");
    }, delayMs);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/` };
}

test("global fetch honors the undici dispatcher's headersTimeout", async () => {
  const { server, url } = await slowServer(2_500); // undici timers have ~1 s resolution: keep the gap > 1 s
  const short = new Agent({ headersTimeout: 200, bodyTimeout: 200 });
  const long = new Agent({ headersTimeout: 5_000, bodyTimeout: 5_000 });
  try {
    await assert.rejects(
      () => postJson(url, {}, { timeoutMs: 10_000, dispatcher: short }),
      (error: any) => error?.cause?.code === "UND_ERR_HEADERS_TIMEOUT",
    );
    assert.deepEqual(await postJson(url, {}, { timeoutMs: 10_000, dispatcher: long }), { ok: true });
  } finally {
    await short.close();
    await long.close();
    server.close();
  }
});
```

- [ ] **Step 5.4: Run, expect FAIL** (`modelAgentOptions` not exported).

- [ ] **Step 5.5: Implement** in `providers.server.ts`:
```ts
import { Agent } from "undici";

export function modelAgentOptions(timeoutMs: number) {
  return { headersTimeout: timeoutMs, bodyTimeout: timeoutMs };
}

const modelAgents = new Map<number, Agent>();
function modelAgent(timeoutMs: number): Agent {
  let agent = modelAgents.get(timeoutMs);
  if (!agent) {
    agent = new Agent(modelAgentOptions(timeoutMs));
    modelAgents.set(timeoutMs, agent);
  }
  return agent;
}
```
In `analyze`, add `dispatcher: modelAgent(config.timeoutMs)` to the model `postJson` options.

- [ ] **Step 5.6: Run, expect PASS.** If the dispatcher test fails because Node's bundled fetch rejects the package `Agent` (attempt 2): use undici's own fetch for model calls only.
  - Add `fetchImpl?: typeof fetch` to `PostOptions` and call `(options.fetchImpl ?? fetch)(url, init as RequestInit)` in `postJson`.
  - `import { Agent, fetch as undiciFetch } from "undici";` and pass `fetchImpl: undiciFetch as unknown as typeof fetch` in the model call only.
  - Give `createProviderDependencies(options: { modelFetch?: typeof fetch } = {})` an optional override used instead of `undiciFetch`; the tests that mock `globalThis.fetch` for `analyze` call `createProviderDependencies({ modelFetch: globalThis.fetch })`.
  - In the dispatcher test, pass `fetchImpl: undiciFetch as unknown as typeof fetch` to both `postJson` calls.
  If that also fails, stop and report (streaming then becomes a decision for Justin).

- [ ] **Step 5.7: Commit.**
```bash
git add package.json package-lock.json src/lib/runtime/providers.server.ts src/lib/runtime/runtime.test.ts
git commit -m "fix(runtime): model fetch header/body timeouts follow REAPER_MODEL_TIMEOUT_MS" -m "Why: undici's 300 s headersTimeout killed long local runs (spec 3.2). Adds dependency undici. Undo: git revert <this commit> && npm install"
```

- [ ] **Step 5.8: Change Log entry.** **[PC write]**

---

### Task 6: No retry on a local timeout or refused connection

**Files:** Modify `src/lib/runtime/providers.server.ts`, `src/lib/runtime/step.ts:120-123`; test in `runtime.test.ts`.

**Interfaces:** Consumes `ProviderError` (Task 3), `ModelConfig`, `modelAgent` (Task 5). Produces `classifyModelError(error: unknown, config: Pick<ModelConfig, "baseUrl" | "timeoutMs">): Error`.

- [ ] **Step 6.1: Check.** `grep -n "transient\|executeWithRetry" src/lib/runtime/*.ts` → only `step.ts`.

- [ ] **Step 6.2: Write failing tests** (`import { ProviderError } from "./errors.ts";`, add `classifyModelError` to the providers import):
```ts
test("does not retry a provider error tagged non-retryable even if its text says timeout", async () => {
  let calls = 0;
  const deps = dependencies({
    analyze: async () => {
      calls += 1;
      throw new ProviderError("Model call timeout after 600 s at http://127.0.0.1:11434/v1.", false);
    },
  });
  const run = await runToEnd(workflow(defaultState().graphs[0]), deps);
  assert.equal(run.status, "failed");
  assert.equal(calls, 1);
  assert.match(run.error ?? "", /timeout/);
});

test("classifies local timeouts and refused connections as not retryable", () => {
  const config = { baseUrl: "http://127.0.0.1:11434/v1", timeoutMs: 600_000 };
  const refused = classifyModelError(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }), config);
  assert.equal((refused as ProviderError).retryable, false);
  assert.match(refused.message, /Model server not reachable at http:\/\/127\.0\.0\.1:11434\/v1/);
  const headers = classifyModelError(Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_HEADERS_TIMEOUT" } }), config);
  assert.equal((headers as ProviderError).retryable, false);
  const aborted = classifyModelError(new DOMException("timed out", "TimeoutError"), config);
  assert.match(aborted.message, /timed out after 600 s/);
  const other = new Error("503 upstream");
  assert.equal(classifyModelError(other, config), other);
});
```

- [ ] **Step 6.3: Run, expect FAIL.** `classifyModelError` is not exported, and the first test sees `calls === 2`: the message contains the word `timeout`, so today's regex in `transient()` retries it. That is exactly the bug: the tag must win over the regex.

- [ ] **Step 6.4: Implement.** `step.ts`:
```ts
function transient(error: unknown): boolean {
  if (error && typeof error === "object" && typeof (error as { retryable?: unknown }).retryable === "boolean") {
    return (error as { retryable: boolean }).retryable;
  }
  if (!(error instanceof Error)) return false;
  return /\b(408|409|425|429|500|502|503|504|timeout|temporar|rate limit|network)\b/i.test(error.message);
}
```
`providers.server.ts` (`import { ProviderError } from "./errors.ts";`):
```ts
const TIMEOUT_CODES = new Set(["UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_CONNECT_TIMEOUT"]);
const UNREACHABLE_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EHOSTUNREACH", "UND_ERR_SOCKET"]);

export function classifyModelError(error: unknown, config: Pick<ModelConfig, "baseUrl" | "timeoutMs">): Error {
  const name = (error as { name?: unknown } | null)?.name;
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  if (name === "TimeoutError" || name === "AbortError" || (typeof code === "string" && TIMEOUT_CODES.has(code))) {
    return new ProviderError(`Model call timed out after ${Math.round(config.timeoutMs / 1000)} s at ${config.baseUrl}.`, false);
  }
  if (typeof code === "string" && UNREACHABLE_CODES.has(code)) {
    return new ProviderError(`Model server not reachable at ${config.baseUrl}.`, false);
  }
  return error instanceof Error ? error : new Error(String(error));
}
```
Wrap the model call in `analyze`:
```ts
      let payload: JsonObject;
      try {
        payload = await postJson(`${config.baseUrl}/responses`, {
          model,
          instructions: ANALYSIS_INSTRUCTIONS,
          input: JSON.stringify({ objective, sources }),
          text: { format: { type: "json_schema", name: "reaper_analysis", strict: true, schema: REAPER_ANALYSIS_SCHEMA } },
        }, { apiKey: config.apiKey, timeoutMs: config.timeoutMs, dispatcher: modelAgent(config.timeoutMs) });
      } catch (error) {
        throw classifyModelError(error, config);
      }
```
(Use the Task 4 A/B endpoint and body if one of those was chosen.)

- [ ] **Step 6.5: Run, expect PASS**, including the existing "retries one clearly transient provider failure" test (untagged errors still use the regex).

- [ ] **Step 6.6: Commit.**
```bash
git add src/lib/runtime/providers.server.ts src/lib/runtime/step.ts src/lib/runtime/runtime.test.ts
git commit -m "fix(runtime): never retry a local model timeout or refused connection" -m "Why: a retry doubles GPU load; 600 s retried is about 20 min (spec 3.2, 5). Undo: git revert <this commit>"
```

- [ ] **Step 6.7: Change Log entry.** **[PC write]**

---

### Task 7: Per-source content cap 7,000 characters

**Files:** Modify `src/lib/runtime/providers.server.ts` (the `.slice(0, 20_000)` in `research`); test in `runtime.test.ts`.

**Interfaces:** Produces `export const SOURCE_CONTENT_CAP = 7_000;`

- [ ] **Step 7.1: Write failing test** (add `SOURCE_CONTENT_CAP` to the providers import):
```ts
test("caps each Firecrawl source at 7,000 characters", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    data: { web: [{ url: "https://example.com/long", title: "Long", markdown: "x".repeat(10_000) }] },
  }), { status: 200 })) as typeof fetch;
  try {
    await withEnv({ FIRECRAWL_API_KEY: "test-firecrawl" }, async () => {
      const [record] = await createProviderDependencies().research("q", 5);
      assert.equal(SOURCE_CONTENT_CAP, 7_000);
      assert.equal(record.content.length, 7_000);
    });
  } finally {
    globalThis.fetch = oldFetch;
  }
});
```
- [ ] **Step 7.2: Run, expect FAIL** (`SOURCE_CONTENT_CAP` not exported; length would be 10,000).
- [ ] **Step 7.3: Implement:** add `export const SOURCE_CONTENT_CAP = 7_000;` and change `.slice(0, 20_000)` to `.slice(0, SOURCE_CONTENT_CAP)`.
- [ ] **Step 7.4: Run, expect PASS.**
- [ ] **Step 7.5: Commit.**
```bash
git add src/lib/runtime/providers.server.ts src/lib/runtime/runtime.test.ts
git commit -m "fix(runtime): cap each source at 7,000 chars" -m "Why: 5 sources plus reasoning must fit the local window (spec 3.2). Undo: git revert <this commit>"
```
- [ ] **Step 7.6: Change Log entry.** **[PC write]**

---

### Task 8: Run log to file

**Files:** Create `src/lib/runtime/run-file.server.ts`; modify `src/lib/runtime/api.ts` (`stepServerRun`, lines 56-71); test in `runtime.test.ts`.

**Interfaces:** Produces `runFilePath(dataDir: string, runId: string): string` and `writeRunFile(run: RuntimeRun, dataDir?: string): Promise<string | null>`. It returns `null` and writes nothing when `REAPER_DATA_DIR` is unset, so CI and the Grok sandbox never write files.

- [ ] **Step 8.1: Write failing tests** (`import { mkdtempSync, rmSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path"; import { runFilePath, writeRunFile } from "./run-file.server.ts";`):
```ts
test("writes the finished run to <dataDir>/runs/<runId>.json", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reaper-runs-"));
  try {
    const run = await runToEnd(workflow(defaultState().graphs[0]));
    const path = await writeRunFile(run, dir);
    assert.equal(path, join(dir, "runs", `${run.id}.json`));
    const saved = JSON.parse(readFileSync(path!, "utf8"));
    assert.equal(saved.run.status, "done");
    assert.equal(saved.run.log.length, run.log.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writes nothing without a data dir and refuses odd run ids", async () => {
  const run = await runToEnd(workflow(defaultState().graphs[0]));
  await withEnv({ REAPER_DATA_DIR: undefined }, async () => assert.equal(await writeRunFile(run), null));
  assert.throws(() => runFilePath("C:\\ReaperData", "..\\..\\evil"), /unexpected run id/);
});
```
- [ ] **Step 8.2: Run, expect FAIL** (module missing).
- [ ] **Step 8.3: Implement** `src/lib/runtime/run-file.server.ts`:
```ts
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "../env.server.ts";
import type { RuntimeRun } from "./types.ts";

const RUN_ID = /^run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function runFilePath(dataDir: string, runId: string): string {
  if (!RUN_ID.test(runId)) throw new Error(`Refusing to write a run file for unexpected run id ${runId}.`);
  return join(dataDir, "runs", `${runId}.json`);
}

/** Write the final run record outside the repo. Off unless REAPER_DATA_DIR is set. */
export async function writeRunFile(run: RuntimeRun, dataDir = env("REAPER_DATA_DIR")): Promise<string | null> {
  if (!dataDir) return null;
  const target = runFilePath(dataDir, run.id);
  await mkdir(join(dataDir, "runs"), { recursive: true });
  const temp = `${target}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify({ writtenAt: new Date().toISOString(), run }, null, 2)}\n`, "utf8");
  await rename(temp, target);
  return target;
}
```
In `api.ts` `stepServerRun`, replace `return replaceRun(context.userId, claimed.version, next);` with:
```ts
    const saved = await replaceRun(context.userId, claimed.version, next);
    if (saved.status === "done" || saved.status === "failed") {
      try {
        const { writeRunFile } = await import("./run-file.server");
        const path = await writeRunFile(saved);
        if (path) console.info(`[reaper] run file written: ${path}`);
      } catch (error) {
        console.error("[reaper] run file not written:", error);
      }
    }
    return saved;
```
- [ ] **Step 8.4: Run, expect PASS**; `npm run typecheck`.
- [ ] **Step 8.5: Commit.**
```bash
git add src/lib/runtime/run-file.server.ts src/lib/runtime/api.ts src/lib/runtime/runtime.test.ts
git commit -m "feat(runtime): write finished runs to REAPER_DATA_DIR/runs/<runId>.json" -m "Why: Stage 1 keeps in-memory PGLite; the file is the done-when evidence (spec 4.9). Undo: git revert <this commit>; optionally delete C:\\ReaperData\\runs"
```
- [ ] **Step 8.6: Change Log entry.** **[PC write]**

---

### Task 9: Loopback guard and local launch script

**Files:** Create `scripts/local-host-guard.mjs`, `scripts/local-host-guard.test.mjs`, `scripts/start-local.mjs`, `scripts/start-local.test.mjs`; modify `vite.config.ts` (imports + `plugins` list), `package.json` (`scripts`).

**Interfaces:** Consumes `exitStatusFromChild`, `isMainModule`, `projectRoot` from `scripts/with-app-env.mjs` (existing). Produces `isLoopbackHost(host)`, `authEnabledFrom(value)`, `assertSafeBind({ host, authEnabled })`, `loopbackGuardPlugin()`, `LOCAL_HOST`, `buildLocalEnv(processEnv)`, `localPort(processEnv)`, `localViteArgs(root, port)`.

Note: `npm run dev` binds `0.0.0.0`. With auth **on** (today's default: `.grok/app-env.json` sets no `VITE_AUTH_ENABLED`) it still starts. With auth **off** it now refuses, which is the point. The launch script spawns Vite with `node` directly (no shell, no `.cmd` shim), so it behaves the same in PowerShell and bash.

- [ ] **Step 9.1: Write failing tests.** `scripts/local-host-guard.test.mjs`:
```js
import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeBind, authEnabledFrom, isLoopbackHost } from "./local-host-guard.mjs";

test("loopback hosts", () => {
  for (const host of ["127.0.0.1", "localhost", "::1", "[::1]", " LOCALHOST ", undefined]) assert.equal(isLoopbackHost(host), true, String(host));
  for (const host of ["0.0.0.0", "::", true, "192.168.1.5", "100.64.0.2", "shadow-pc"]) assert.equal(isLoopbackHost(host), false, String(host));
});

test("auth flag mirrors the server: only the string false turns it off", () => {
  assert.equal(authEnabledFrom("false"), false);
  assert.equal(authEnabledFrom(" false "), false);
  assert.equal(authEnabledFrom(undefined), true);
  assert.equal(authEnabledFrom("true"), true);
});

test("refuses auth-off on a non-loopback host, naming the host", () => {
  assert.throws(() => assertSafeBind({ host: "0.0.0.0", authEnabled: false }), /Refusing to start.*0\.0\.0\.0/);
  assert.throws(() => assertSafeBind({ host: true, authEnabled: false }), /all interfaces/);
  assert.doesNotThrow(() => assertSafeBind({ host: "127.0.0.1", authEnabled: false }));
  assert.doesNotThrow(() => assertSafeBind({ host: "0.0.0.0", authEnabled: true }));
});
```
`scripts/start-local.test.mjs`:
```js
import assert from "node:assert/strict";
import test from "node:test";
import { LOCAL_HOST, buildLocalEnv, localPort, localViteArgs } from "./start-local.mjs";

test("local env forces auth off and fills local model defaults", () => {
  const env = buildLocalEnv({ PATH: "x" });
  assert.equal(env.VITE_AUTH_ENABLED, "false");
  assert.equal(env.OPENAI_BASE_URL, "http://127.0.0.1:11434/v1");
  assert.equal(env.OPENAI_MODEL, "gpt-oss:20b");
  assert.equal(env.REAPER_MODEL_TIMEOUT_MS, "600000");
  assert.equal(env.REAPER_DATA_DIR, "C:\\ReaperData");
  assert.equal(buildLocalEnv({ OPENAI_MODEL: "gpt-oss-20b-32k" }).OPENAI_MODEL, "gpt-oss-20b-32k");
  assert.equal(buildLocalEnv({ VITE_AUTH_ENABLED: "true" }).VITE_AUTH_ENABLED, "false");
});

test("refuses when DATABASE_URL is set", () => {
  assert.throws(() => buildLocalEnv({ DATABASE_URL: "postgres://x" }), /DATABASE_URL/);
});

test("binds only to 127.0.0.1 with a strict port", () => {
  assert.equal(LOCAL_HOST, "127.0.0.1");
  const args = localViteArgs("/r", 8080);
  assert.deepEqual(args.slice(1), ["dev", "--host", "127.0.0.1", "--port", "8080", "--strictPort"]);
  assert.match(args[0], /node_modules[\\/]vite[\\/]bin[\\/]vite\.js$/);
  assert.equal(localPort({}), 8080);
  assert.equal(localPort({ REAPER_PORT: "8090" }), 8090);
  assert.throws(() => localPort({ REAPER_PORT: "80" }), /REAPER_PORT/);
});
```

- [ ] **Step 9.2: Run, expect FAIL.** `node --test scripts/local-host-guard.test.mjs scripts/start-local.test.mjs` → modules not found.

- [ ] **Step 9.3: Implement.** `scripts/local-host-guard.mjs`:
```js
/**
 * Reaper must never serve with auth off on anything but loopback (spec §2):
 * with VITE_AUTH_ENABLED=false every request is the dev user, so a LAN or
 * tailnet bind hands the station to any device that can reach the port.
 */
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function isLoopbackHost(host) {
  if (host === undefined || host === null || host === false) return true; // Vite default: localhost
  if (host === true) return false; // Vite: all interfaces
  return LOOPBACK.has(String(host).trim().toLowerCase());
}

/** Same rule as src/lib/auth/server.ts: only "false" turns auth off. */
export function authEnabledFrom(value) {
  return String(value ?? "").trim() !== "false";
}

export function assertSafeBind({ host, authEnabled }) {
  if (authEnabled || isLoopbackHost(host)) return;
  const where = host === true ? "all interfaces" : String(host);
  throw new Error(
    `Refusing to start: auth is off (VITE_AUTH_ENABLED=false) and the server would listen on ${where}. ` +
      "Bind to 127.0.0.1, localhost or ::1 (use npm run start:local).",
  );
}

export function loopbackGuardPlugin() {
  return {
    name: "reaper:loopback-guard",
    apply: "serve",
    configResolved(config) {
      assertSafeBind({
        host: config.server.host,
        authEnabled: authEnabledFrom(process.env.VITE_AUTH_ENABLED ?? config.env?.VITE_AUTH_ENABLED),
      });
    },
  };
}
```
`scripts/start-local.mjs`:
```js
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
```
`vite.config.ts`: next to the other JS plugin imports add
```ts
// @ts-expect-error JS plugin alongside the TS vite config
import { loopbackGuardPlugin } from "./scripts/local-host-guard.mjs";
```
and make `loopbackGuardPlugin(),` the first entry of `plugins`.
`package.json` `scripts`: add `"start:local": "node scripts/start-local.mjs",`.

- [ ] **Step 9.4: Run, expect PASS** (`node --test scripts/local-host-guard.test.mjs scripts/start-local.test.mjs`), then `npm run typecheck` and `npm run lint` (no new errors vs baseline).

- [ ] **Step 9.5: Box smoke of the guard (box only).**
```bash
VITE_AUTH_ENABLED=false timeout 40 npx vite dev --host 0.0.0.0 --port 8099 2>&1 | grep -m1 "Refusing to start"
```
Expected: the refusal line. Then (only if 8080 is free on the box; otherwise prefix `REAPER_PORT=8098`):
```bash
(timeout 60 node scripts/start-local.mjs > /tmp/start-local.log 2>&1 &); sleep 30; ss -ltn | grep ':8080'; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/
```
Expected: the listener is `127.0.0.1:8080` only; HTTP 200. `timeout` stops it. Undo: none.

- [ ] **Step 9.6: Commit.**
```bash
git add scripts/local-host-guard.mjs scripts/local-host-guard.test.mjs scripts/start-local.mjs scripts/start-local.test.mjs vite.config.ts package.json
git commit -m "feat: loopback-only local launch; refuse auth-off on non-loopback hosts" -m "Why: auth off + 0.0.0.0 exposes Reaper to the LAN and tailnet (spec 2, 5). Undo: git revert <this commit>"
```
- [ ] **Step 9.7: Change Log entry.** **[PC write]**

---

### Task 10: Firecrawl pre-check script, full gate, independent review

**Files:** Create `scripts/firecrawl-check.mjs`, `scripts/firecrawl-check.test.mjs`; modify `package.json` (`"firecrawl:check": "node scripts/firecrawl-check.mjs"`).

**Interfaces:** Consumes `isMainModule` from `scripts/with-app-env.mjs`. Produces `firecrawlKeyStatus(env): { ok: true } | { ok: false; message: string }`.

- [ ] **Step 10.1: Write failing test** `scripts/firecrawl-check.test.mjs`:
```js
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { firecrawlKeyStatus } from "./firecrawl-check.mjs";

test("reports a missing key without touching the network", () => {
  assert.equal(firecrawlKeyStatus({}).ok, false);
  assert.equal(firecrawlKeyStatus({ FIRECRAWL_API_KEY: "  " }).ok, false);
  assert.equal(firecrawlKeyStatus({ FIRECRAWL_API_KEY: "fc-x" }).ok, true);
  const script = fileURLToPath(new URL("./firecrawl-check.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script], { env: { PATH: process.env.PATH }, encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /FIRECRAWL_API_KEY is not set/);
});
```
- [ ] **Step 10.2: Run, expect FAIL** (module missing).
- [ ] **Step 10.3: Implement** `scripts/firecrawl-check.mjs`:
```js
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
```
- [ ] **Step 10.4: Run, expect PASS.** Then the full gate on the box: `npm test`, `node --experimental-strip-types --test src/lib/runtime/runtime.test.ts`, `npm run typecheck`, `npm run lint`. Expected: nothing that passed at baseline (Step 0.3) fails; all new tests pass; pre-existing script-test failures are listed as pre-existing (Stage 2).
- [ ] **Step 10.5: Commit.**
```bash
git add scripts/firecrawl-check.mjs scripts/firecrawl-check.test.mjs package.json
git commit -m "feat: Firecrawl key and one-search pre-check" -m "Why: Stage 1 pre-check (spec 7). Undo: git revert <this commit>"
```
- [ ] **Step 10.6: Independent review.** A fresh reviewer subagent reads spec §3.2, §4.9, §5, §7 Stage 1 and `git diff 3baaed9..HEAD -- . ':!src/routeTree.gen.ts'`, and reports gaps. Fix accepted findings as one more commit (max 2 attempts).
- [ ] **Step 10.7: Change Log entry.** **[PC write]**

---

### Task 11: Move the branch to the PC (no push)

**Files (PC):** `C:\ReaperData\transfer\reaper-stage1.bundle`, checkout `C:\Reaper\reaper-system`.

- [ ] **Step 11.1: Check.** From Step 0.4: Git is installed and `C:\Reaper\reaper-system` is absent. If it exists, stop and ask Justin (never overwrite).
- [ ] **Step 11.2: Bundle on the box.** `git bundle create /workspace/reaper-stage1.bundle design/local-station && git bundle verify /workspace/reaper-stage1.bundle` → "is okay". (The uncommitted `routeTree.gen.ts` change is not in the bundle; the dev server regenerates that file.)
- [ ] **Step 11.3: Copy and clone [needs Justin's OK, PC write].** CopyFromBox to `C:\ReaperData\transfer\reaper-stage1.bundle`, then:
```powershell
New-Item -ItemType Directory -Force C:\Reaper | Out-Null
git clone -b design/local-station C:\ReaperData\transfer\reaper-stage1.bundle C:\Reaper\reaper-system
git -C C:\Reaper\reaper-system log --oneline -1
```
Verify: HEAD hash equals the box HEAD. Undo: `Remove-Item -Recurse -Force C:\Reaper\reaper-system, C:\ReaperData\transfer`.
- [ ] **Step 11.4: Install dependencies [needs Justin's OK, PC write + network].** `cd C:\Reaper\reaper-system; npm ci` → exit 0. Undo: `Remove-Item -Recurse -Force node_modules`.
- [ ] **Step 11.5: Tests on Windows.** `node --experimental-strip-types --test src/lib/runtime/runtime.test.ts` and `node --test scripts/local-host-guard.test.mjs scripts/start-local.test.mjs scripts/firecrawl-check.test.mjs` → all pass. (`npm test` itself breaks under `cmd.exe` until Stage 2.)
- [ ] **Step 11.6: Change Log entry** with the clone path and undo. **[PC write]**

---

### Task 12: Firecrawl pre-check on the PC **[needs Justin — he sets the key]**

- [ ] **Step 12.1:** Justin opens a new PowerShell window (the shell that will start Reaper) and sets the key for that shell only, without echoing it: `$env:FIRECRAWL_API_KEY = Read-Host "Firecrawl key" -MaskInput`. Agents never see or handle the key.
- [ ] **Step 12.2:** `cd C:\Reaper\reaper-system; npm run firecrawl:check` → `FIRECRAWL_API_KEY present.` and `Firecrawl OK: 1 result(s)…`. Uses 1 free-tier credit. Max 2 attempts; on 401/402 stop (key or plan issue; Justin decides; no paid upgrade).
- [ ] **Step 12.3: Change Log entry** (result only, never the key). **[PC write]**

---

### Task 13: Live Stage 1 run **[needs Justin's OK — PC write + GPU]**

- [ ] **Step 13.1: Start Reaper** in the same shell as Task 12:
```powershell
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue   # this shell only
$env:OPENAI_MODEL = "gpt-oss-20b-32k"                          # the Task 1 variant
# $env:REAPER_PORT = "8090"   # only if 8080 was taken in Step 0.4
npm run start:local
```
Expected: `[start-local] model gpt-oss-20b-32k at http://127.0.0.1:11434/v1; data dir C:\ReaperData; http://127.0.0.1:8080` and `FIRECRAWL_API_KEY present`. Record the node PID (`Get-NetTCPConnection -LocalPort 8080 -State Listen`). Undo: Ctrl+C in that window, or `Stop-Process -Id <that PID>` only.
- [ ] **Step 13.2: Loopback verification.**
```powershell
Get-NetTCPConnection -LocalPort 8080 -State Listen | Select-Object LocalAddress,LocalPort
curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:8080/
```
Expected: only `127.0.0.1`; HTTP 200. From another device (phone or Pi over Tailscale): `curl -m 5 http://<PC tailscale IP>:8080/` → refused or timeout.
- [ ] **Step 13.3: Negative check.** Second shell: `$env:VITE_AUTH_ENABLED="false"; npx vite dev --host 0.0.0.0 --port 8097` → exits with `Refusing to start … 0.0.0.0`; nothing listens on 8097.
- [ ] **Step 13.4: Build the run in the UI** at `http://127.0.0.1:8080`: set the Objective goal to a real research question (e.g. "What does Ollama's OpenAI-compatible API support for structured outputs?"), constraints "Cite sources", done-when "A record with at least one supported claim". The default graph is Objective → Research → Analysis → Record; the UI can't delete a wire, so: in the inspector remove the default **Record** node; from Integrations → Built-in catalog add **Condition** (default path `claims.0.supported`), then add **Record**; wire Analysis→Condition, then Condition→Record (the first wire out of a Condition is its "true" route), giving Objective → Research → Analysis → Condition → Record. Click Run.
- [ ] **Step 13.5: Watch, do not intervene.** During Analysis, `ollama ps` shows `gpt-oss-20b-32k` with `CONTEXT 32768`. A failure is not retried: record the node error, stop, and report (max 2 runs in total).
- [ ] **Step 13.6: Verify done-when.**
```powershell
$f = Get-ChildItem C:\ReaperData\runs\*.json | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$r = (Get-Content -Raw $f.FullName | ConvertFrom-Json).run
$r.status
($r.artifacts | Where-Object type -eq 'analysis').data.claims | Where-Object supported | Measure-Object | Select-Object -ExpandProperty Count
```
Expected: `done`; supported count ≥ 1; the file name equals the run id in the UI.
- [ ] **Step 13.7: Stop Reaper** (Ctrl+C in its window). Confirm 8080 no longer listens, and that Ollama, Paperclip, Postgres and PID 33740 are untouched (`Get-Process -Id 33740`).
- [ ] **Step 13.8: Stage 1 gate Change Log entry** "Reaper Stage 1 done-when verified": fixture endpoint letter, `ollama ps` line, loopback evidence, run id, run file path, supported-claim count, HEAD commit. Undo for the whole stage: `git revert` the Stage 1 commits (or delete `C:\Reaper\reaper-system`), `ollama rm gpt-oss-20b-32k`, delete `C:\ReaperData`. **[PC write]**

---

## Steps that need Justin's OK

| Step | Why |
|---|---|
| 0.5 | Go-ahead, and optional standing OK for Change Log entries |
| 1.2, 1.3 | Creates an Ollama model variant (PC write) and loads it (GPU). Justin does it. |
| 2.2, 2.3, 2.4, 2.5 | Writes request/reply files to `C:\ReaperData\fixtures`; runs the model (GPU) |
| 11.3, 11.4 | Clones into `C:\Reaper\reaper-system`; `npm ci` (PC write) |
| 12.1, 12.2 | Justin sets the Firecrawl key in his own shell; one free search |
| 13.1 – 13.7 | Starts Reaper, writes `C:\ReaperData\runs`, runs the model (GPU) |
| Change Log steps 1.4, 2.7, 3.7, 4.6, 5.8, 6.7, 7.6, 8.6, 9.7, 10.7, 11.6, 12.3, 13.8 | Each writes a file in the Workstation vault on the PC |

Everything else runs on the box. Step 0.4 and 11.5 run on the PC but are read-only (11.5 writes only OS temp files).

## Appendix A: Change Log entry template

File: `C:\Obsidian Vault\Workstation\08 Governance\Change Log\YYYY-MM-DD HHMM <title>.md` (time in ET, 24 h), matching the existing entries.
```markdown
# YYYY-MM-DD <title>

**Status:** verified YYYY-MM-DD ~HH:MM ET   (or: failed, stopped after attempt 2)

## Before
- <what the check showed>

## Changes (one at a time)
1. <change> (run by <Justin | agent>). Files: <paths>. Commit: <hash or n/a>. Undo: `<exact undo>`

## Verification
- <command> → <result>

## Open
- <anything left, or (none)>
```

## Self-review

- **Spec coverage (§7 Stage 1):** context window → Task 1; curl fixture + fallbacks → Tasks 2, 4; base URL / optional key / timeout / default model → Task 3; message-only parsing incl. `output_text` → Task 4; undici header/body timeouts → Task 5; no local retry + `transient()` tag check → Task 6; ~7,000 cap → Task 7; run file → Task 8; loopback launch + refusal → Task 9; Firecrawl pre-check → Tasks 10, 12; done-when → Task 13. §6 "Stage 1 extends `runtime.test.ts`" → Tasks 3–8. Stage 3 items (context check, settings unit, durable PGLite, run-level source IDs) are deliberately absent.
- **Placeholders:** the undici version is chosen by the Step 5.1 check, by design; endpoint A/B code is given in full in Task 4.
- **Type consistency:** `ModelConfig`, `postJson(url, body, options)`, `ProviderError(message, retryable)`, `classifyModelError(error, config)`, `writeRunFile(run, dataDir?)` have the same signatures in every task.

## Execution handoff

Plan saved. Two options once Justin approves: (1) subagent-driven, a fresh subagent per task with a review between tasks (recommended), or (2) inline execution with executing-plans and checkpoints. Either way, the PC steps wait for Justin's OK.
