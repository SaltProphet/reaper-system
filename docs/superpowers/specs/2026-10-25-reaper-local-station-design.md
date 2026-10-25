# Reaper Local Station: design spec

- Date: 2026-10-25
- Owner: Justin Strange. Justin is an independent systems designer, and AI agents do the building under his direction.
- Base: `SaltProphet/reaper-system` `main` at `a6020d8`
- Inputs: `reaper_audit_2026-10-25.md` and `chatgpt_share_vs_audit.md` (what is real and what is stubbed), plus a code read of `src/lib/runtime/*` and `src/components/*`
- Status: design approved in conversation. The written spec still needs Justin's review before an implementation plan is written.
- Review log: Blind review 2026-10-25 by Blind-Reviewer #1; findings C1-C5, I1-I7, M1-M2 incorporated. Fixes that stop Stage 1 failing or exposing Justin are in Stage 1; the hardening is in Stage 4.

## 1. Goal and scope

Reaper becomes **one general local research station**. Justin describes a goal in plain words, for example "find buyer intent on Reddit for product X". A Planner drafts a workflow: the nodes, the sources and tools to use, and what counts as evidence. By default the plan runs right away, and the plan, every step, and every tool call are shown live and logged. A **"review plan first"** setting (off by default) makes Reaper wait for Justin's OK before running, and lets him edit the draft first. A plan with a command step always waits for his OK (§3.6). Writes happen inside a workspace folder that Reaper owns. That folder is snapshotted, and each run ends with a run report and an **Undo this run** button. Every factual claim in the output cites source IDs collected in that same run.

The station grows out of the existing Reaper. Nothing is rebuilt from scratch. These parts stay as they are: the step engine (`step.ts`), the step budget (`STEP_BUDGET=24`), the depth limit (`MAX_DEPTH=4`), port contracts (`registry.ts`), citation validation, Postgres/PGLite persistence with optimistic versioning (`persistence.server.ts`), and the policies in `engine.ts` `POLICIES` ("No evidence, no factual claim.", "No external post from the engine.", and the rest).

**Host:** Justin's Windows 11 Shadow PC (RTX A4500, 20 GB). It runs natively on Node 22 and Ollama. That PC has no Docker because virtualization is disabled. Vercel is not a target: it is unpaid, and it can't reach the local model anyway. A Raspberry Pi 5 with Docker is an optional later host for helpers such as SearXNG or Postgres. Nothing in v1 depends on it.

**In v1:** local model runs, cleanup and a docked layout, green CI, the Planner (runs immediately; optional review), three tool tiers with a sandboxed workspace, self-protection, run reports with undo, a model router, and on-demand skill loading. These are delivered in the five stages of §7.

**Out of v1:** multi-agent orchestration, arbitrary code nodes, sending or posting anything, cloud hosting, and a local search replacement for Firecrawl (that is a later stage).

**v1 is not fully offline.** The model runs locally, but search and page fetches go to cloud Firecrawl, which needs internet and a `FIRECRAWL_API_KEY`.

## 2. Architecture

One Node process on the Shadow PC, started by a local launch script bound to `127.0.0.1` with `VITE_AUTH_ENABLED=false`, talks to Ollama at `http://127.0.0.1:11434/v1`. Plain `npm run dev` binds `0.0.0.0:8080`, which with auth off opens Reaper to the whole LAN and tailnet (Pi, phone). So Reaper refuses to start with auth off on any host other than `127.0.0.1`, `localhost`, or `::1` (Stage 1).

```
Workbench UI (workbench.tsx, node-canvas.tsx, new plan-panel.tsx, run-report.tsx, approval-card.tsx)
   │  server functions (api.ts)
   ▼
Planner (planner.server.ts) ──► draft WorkflowDefinition ──► runs now (default)
   ▼                     or waits for Justin's OK if "review plan first" is on
Step engine (step.ts, unchanged core: budget 24, depth 4, one step per call)
   ▼
Executors (registry.ts: objective, research, analysis, condition, record, + tool)
   ▼
Tool Gateway (tools/gateway.server.ts) — READ free · WRITE free inside workspace (snapshotted),
   ▼                                         approval outside it · SEND hard-blocked
   │   Protected zone (data dir, logs, settings, allowlist, Reaper source): no tool can write
   ▼
Providers: ModelClient (OpenAI-compatible → Ollama) · SearchProvider (Firecrawl) · local file/command
   ▼
Persistence: PGLite with a data dir on disk (local) or Postgres (DATABASE_URL); snapshots + reports on disk
```

The existing seam stays where it is. `RuntimeDependencies` (`types.ts`) is still the only way executors reach the outside world. The change is that the seam's `research`/`analyze` pair grows into `{ models, search, tools }`, and every tool call goes through the gateway, which logs it before and after it runs.

## 3. Components and interfaces

Each unit lives in a small file, can be tested alone with injected fakes (the way `runtime.test.ts` already works), and talks to the others only through the interfaces listed here.

### 3.1 Settings (`src/lib/runtime/settings.server.ts`, new)
- Stage 1 reads only the environment variables below, directly in the model provider. The `settings.server.ts` unit and the optional `REAPER_DATA_DIR/settings.json` arrive in Stage 3. The unit reads environment variables and that optional file. Returns a frozen `StationSettings`:
  - `model: { baseUrl, apiKey?, defaultModel, timeoutMs, contextTokens }`. Defaults: `OPENAI_BASE_URL=http://127.0.0.1:11434/v1`, `OPENAI_MODEL=gpt-oss:20b`, `REAPER_MODEL_TIMEOUT_MS=600000`, `REAPER_MODEL_CONTEXT=32768`. The key is required only when the base URL host is `api.openai.com`. `REAPER_MODEL_CONTEXT` is only used for Reaper's size estimate. It does **not** set Ollama's window: that is set on the Ollama side (§7 Stage 1).
  - `caps: { maxSearches, maxPages, maxModelCalls }`. These are ceilings that a plan may not exceed. Defaults are 5 / 25 / 10.
  - `dataDir`: `REAPER_DATA_DIR`, default `C:\ReaperData`, from Stage 3. It holds settings, logs, PGLite data, snapshots, reports, and skills.
  - `reviewPlanFirst: boolean`, default `false` (§3.5).
  - `workspace: { root, snapshotMaxBytes }`, from Stage 4. `REAPER_WORKSPACE`, default `C:\ReaperWorkspace`; `snapshotMaxBytes` default 2 GB. Reaper creates the root if missing. At startup it **refuses to start** if the workspace root overlaps the protected zone (§3.10): inside it, containing it, or the same path after resolving links.
  - `commands.allowlist`, from Stage 4. Entries are `{ program, args: grammar }`. A program is matched by its resolved full path. Each entry spells out its exact argument grammar, with no free-form paths, and anything that doesn't match exactly is rejected (for example `--output=`, `git -C`, `--git-dir=`, `--work-tree=`, `@file`, and env-relative paths like `%TEMP%\x`). There are no wildcards for the program. The starting list is in §9.
  - `capabilities: { send: "locked" }`. In v1 the parser accepts no other value (see §3.6).
  - `router` and `skills` blocks, used from Stage 5 on (see §3.7 and §3.8).
- Invalid settings, or unknown fields, make the server refuse to start, with one message naming the bad field. Settings are read once at startup and frozen. There is no field that turns logging off. Only Justin edits settings, by hand in the file followed by a restart; tools can't (§3.10).

### 3.2 ModelClient (`src/lib/runtime/providers/model.server.ts`, split from `providers.server.ts`)
- `complete({ model, instructions, input, schema, timeoutMs }) → Promise<{ text: string; model: string }>`
- It keeps today's Responses-API request shape (`text.format: json_schema`, strict) and builds the URL as `${baseUrl}/responses`. Ollama ≥ 0.13.3 has this endpoint, but strict `json_schema` output with gpt-oss through it is unverified (verify on PC). **Before any Stage 1 code:** one curl call to the PC's Ollama with the exact `reaper_analysis` schema, saved as the test fixture. If the reply doesn't honor the schema, fall back to `/v1/chat/completions` with `response_format`, or native `/api/chat` with `format`.
- **Stage 1 scope is only:** the configurable base URL, the optional key, the configurable timeout, the `gpt-oss:20b` default, and the three bullets below (parsing, a timeout that really holds, no local retry). The context check arrives in Stage 3.
- `responseOutputText` is changed to read only `type: "message"` items, not reasoning items. gpt-oss is a thinking model, and today the function returns the first `text` it finds. Today it also returns `payload.output_text` before that logic runs, so the fix covers `output_text` too: message items are read first, and `output_text` is used only when there is no `output` array (Ollama's exact shape: verify on PC against the fixture).
- `postJson` today uses non-streaming `fetch` with `AbortSignal.timeout`. Node's built-in fetch (undici) has a default `headersTimeout` of 300 s, and Ollama sends no headers until it finishes, so a long run dies at 5 minutes with "fetch failed". Fix: pass an undici `Agent` with `headersTimeout` and `bodyTimeout` ≥ `timeoutMs` as the fetch `dispatcher` (needs the `undici` package, a new dependency), or stream the response. Pick one on the PC.
- Errors are tagged `{ retryable: boolean }`. A local timeout or a refused connection is **not** retryable, because a retry doubles the GPU load and a 600 s timeout retried means about 20 minutes of waiting. `step.ts` `transient()` checks the tag first and falls back to the current regex only for untagged errors.
- (Stage 3) Before each call it estimates the input size (characters ÷ 4). If the input exceeds 75% of `contextTokens`, it fails with a clear message instead of letting Ollama silently truncate.
- Stage 1 lowers the per-source content cap in the Firecrawl provider from 20,000 to about 7,000 characters for the first run, so 5 sources plus reasoning fit the window.
- `analyze()` stays as a thin wrapper over `complete()` with the existing `reaper_analysis` schema and malformed-output checks.

### 3.3 SearchProvider (`src/lib/runtime/providers/firecrawl.server.ts`, moved)
- The interface is unchanged: `(query, limit) → Promise<SourceRecord[]>`. Firecrawl is still the only v1 implementation. A future local version (SearXNG plus local fetch/cleanup) implements the same signature.
- **Change (Stage 3, when plans can have several research nodes):** source IDs are now assigned by the engine from a run-level counter (`run.nextSourceSeq`: `SRC-001`, `SRC-002`, …). Today every research call starts again at `SRC-001`, so two research nodes in one plan would collide.

### 3.4 Citation validator (`src/lib/runtime/citations.ts`, extracted from the analysis executor)
- `validateClaims(claims, allowedIds: Set<string>) → AnalysisClaim[]`. A pure function.
- The rule is unchanged: a claim is `supported` only if it cites at least one ID and **every** ID is an exact member of the source IDs supplied to that node, all of which come from this run. Duplicates are removed. Nothing is normalized, so `"src-001"` and `" SRC-001"` are invalid.
- `builtin.record` keeps splitting claims into supported and unsupported. The final output only presents supported claims as findings, and unsupported claims are listed separately and labelled as such.

### 3.5 Planner (`src/lib/runtime/planner.server.ts`, new)
- `draftPlan(goal: string, settings) → Promise<PlanDraft>`, where `PlanDraft = { definition: WorkflowDefinition; notes: string[] }`.
- One `ModelClient.complete` call with a JSON schema. The schema only allows the executor IDs in `EXECUTORS` and the tool IDs registered as READ or WRITE. SEND tools are not in the schema.
- The draft fills in `objective.goal`, `objective.constraints`, `objective.doneWhen`, and a new `objective.evidence` field ("what counts as evidence"). The analysis instructions receive that field. It also fills in `plan: { jobKind: "research" | "build" | "fix", budget: { searches, pages, modelCalls } }`.
- Checks: `validateWorkflowDefinition` (cycles, ports, types), plus at most 24 steps in the worst case, depth ≤ 4, and no unknown or SEND tools. If the draft fails, the model gets **one** repair attempt with the error list. If that also fails, the draft is shown with its errors and does not run. That is the 2-attempt maximum. Justin can fix the draft by hand and press **Run**.
- **After a valid draft:** if `reviewPlanFirst` is `false` (the default), the budget is within `settings.caps`, and the plan has no `command.run` node, the run starts immediately. A plan with a `command.run` node always waits for **Approve & run** (Stage 4). If `reviewPlanFirst` is `true`, the run waits for **Approve & run**, and Justin can edit the draft first. A budget above the ceilings always waits for his approval of that budget, whatever the setting.
- `WorkflowDefinition` moves to `schemaVersion: 2` (adding `objective.evidence` and `plan`). An upgrader turns v1 definitions into v2 with an empty evidence field and Stage 1 caps.

### 3.6 Tool Gateway (`src/lib/runtime/tools/gateway.server.ts`, new) and tools
- `ToolDefinition = { id; tier: "read" | "write" | "send"; argsSchema; describe(args) → string; run(args, ctx) }`
- `invoke(call: { runId, nodeKey, toolId, args }, ctx) → ToolResult | NeedsApproval | Blocked`. Every call is written to the run log and the audit log (§3.10) before it runs and again with its result. Logging is part of the gateway itself, with no switch to turn it off.
- **READ** tools: `web.search` (Firecrawl), `web.fetch` (Firecrawl scrape of one URL), `file.read` (only under folders listed in settings), and `model.call` (ModelClient). They run freely. `file.read` may read the workspace and folders listed in settings, but never the protected zone's settings or secrets.
- **WRITE** tools run in a sandbox, not with per-call approval:
  - `file.save`: the target path is resolved first (§3.11). Inside the workspace it **runs freely**, and the file's prior state is snapshotted first.
    `file.save` into any `.git/` folder, `package.json`, or `.npmrc` is `Blocked`, because those files decide what `git` and `npm` execute.
  - `command.run`: the program is run directly (`spawn` with an argument array, **no shell**, so no pipes, redirection, or `&&`), with the workspace as its working directory and a timeout. If it matches `commands.allowlist` exactly and no argument resolves to a path outside the workspace, it **runs freely**, after a workspace snapshot.
    - Environment: only `SystemRoot`, `PATH`, `USERPROFILE`, `APPDATA`, and `TEMP`/`TMP`. `TEMP` and `TMP` point to `<workspace>\.tmp`, so temp files are inside the snapshot.
    - `git` always runs as `git -c core.hooksPath=NUL -c core.fsmonitor=false …`, with `--no-verify` on `commit`, built-in subcommands only, and no aliases (verify on PC that `NUL` disables hooks on Windows git).
    - `npm` is not on the allowlist in v1. Every `npm` call needs approval.
    - Any plan containing a `command.run` node needs plan approval, whatever `reviewPlanFirst` says.
- **Approval is needed only for exceptions:** a path outside the workspace, a command not on the allowlist, a system-setting change (v1 has no tool for this, so any such change is a non-allowlisted command), or a budget above the ceilings. The run pauses with `NeedsApproval`. A grant matches `(runId, nodeKey, toolId, sha256(canonical args))` plus the sha256 of the files that decide what the command does (for `npm`: `package.json` and `.npmrc`), and is used once. If any of those files changed after approval, the grant doesn't match.
- **Never approvable:** a write or command argument that resolves into the protected zone (§3.10) returns `Blocked`. No grant can authorize it.
- **SEND** (send, post, purchase): no tools are registered in v1. The gateway returns `Blocked` for any `send` tier no matter what grants exist, and `capabilities.send` only accepts `"locked"`. Unlocking later takes a new settings value plus its own approval rule, delivered as a reviewed change. Hand-editing config cannot unlock it.
- Tools run only as explicit `builtin.tool` nodes (config `{ toolId, args }`) that are visible in the plan. The Planner is a model, and it picks tools only when it drafts the plan. During a run, no model picks a tool or changes its arguments.
- Tool arguments are fixed when the plan is drafted or approved. In v1 they are never filled in from upstream ports, so text in fetched web pages can't steer a tool (prompt injection). The plan validator rejects any tool argument bound to a port.
- **Honest limit:** without Docker or an OS sandbox on that PC, Reaper can't fully contain a native process. The command allowlist, together with no-shell spawning, the exact argument grammar, and argument path checks, *is* the containment. The gateway's guarantees (protected zone, audit, SEND blocked) cover only what goes through the gateway, **not** what an allowed program does once it runs. That is why `npm` needs approval, `.git/` writes are blocked, and allowlist entries are kept narrow.

### 3.7 Model router (`src/lib/runtime/router.server.ts`, Stage 5)
- `pickModel(job: { jobKind, nodeKind, estTokens }, installed: string[], settings) → { model, reason }`
- `installed` comes from `GET ${baseUrl}/models`. The choice is made from a rules table in settings (job kind → preferred models), using the first one that is installed and has a large enough context. Otherwise it falls back to `defaultModel`. The rule is deterministic and the decision is logged to the run log.
- The model used for each node comes from `node.config.model` if set; `"auto"` means the router decides. Until Stage 5, every node uses `defaultModel`.

### 3.8 Skill loader (`src/lib/runtime/skills.server.ts`, Stage 5)
- Import: `scripts/import-skills.mjs` splits Justin's three bundle files on their `name:` front matter into `REAPER_DATA_DIR/skills/<name>.md`. The bundles are the 5-skill (≈54 KB, ~13k tokens), 7-skill (≈68 KB), and 15-skill (≈166 KB, ~40k tokens) files. Justin copies them to the PC first.
- `allowedSkills(jobKind, contextTokens)`: research jobs and small models get the 5 set; build and fix jobs get the 7 set; large models get the 15 set. "Large" means `contextTokens ≥ settings.skills.largeModelContext` (default 131072). Research jobs stay on the 5 set even on large models.
- `loadSkills(names, budgetTokens) → string`: each node lists the skills it needs (`node.config.skills`, chosen by the Planner from the allowed set). Only those files are injected, never a whole bundle. Their total must fit in 20% of the model context. If it doesn't, the node fails with the overflow named, and nothing is silently cut.
- Skills are guidance text for the model. Instructions in them that assume tools the station doesn't have (subagents, for example) don't apply. The loader adds that statement as a one-line header.

### 3.9 UI (`src/components/*`)
- `workbench.tsx`: the free-floating `Panel`s (absolute positioning, `DEFAULT_FRAMES`, `reaper-frames-v4`) are replaced with a **docked grid**. Left dock: Plan/Integrations. Center: the canvas, always visible, minimum 480×320. Right dock: Objective/Inspector tabs. Bottom dock: Log. Docks can collapse but never overlap the canvas. Skins opens in a modal dialog. Today's defaults put the Objective panel (x 244, y 12) on top of the editor/canvas, and that is the "hidden behind the canvas" case to remove.
- New `plan-panel.tsx`: a goal box and a **Run** button, then the live plan, Planner notes and errors, and the current step. When `reviewPlanFirst` is on, the button reads "Draft plan" and an **Approve & run** button appears, enabled only while the draft is valid and unedited since it was drafted or last approved.
- New `approval-card.tsx`: appears only for the exceptions in §3.6. It shows the tool, the exact path or command, why it needs approval (outside the workspace, not allowlisted, or over budget), and Approve and Deny buttons.
- New `run-report.tsx`: shows the run report (§3.12) and the **Undo this run** button.

### 3.10 Self-protection (`src/lib/runtime/tools/protected.server.ts`, Stage 4)
- **Protected zone:**
  - `REAPER_DATA_DIR`, which holds settings, the command allowlist, the run and audit logs, snapshots, reports, PGLite data, and skills;
  - the Reaper repo folder (source, `.env*`, config, `POLICIES` in `engine.ts`);
  - any path listed under `settings.protectedExtra`.
- It sits outside the workspace (checked at startup, §3.1) and outside every tool's write authority. `isProtected(resolvedPath)` is checked in the gateway on every write and on every `command.run` argument that looks like a path.
- **No tool can disable logging or loosen limits.** Logs are written by the engine and gateway, not by tools. The audit log `REAPER_DATA_DIR/logs/audit.jsonl` is append-only, and each line carries the hash of the previous line, so a gap or edit shows. Any process running as the same Windows user could still rewrite the whole chain, so this is **tamper detection, not prevention**. To make a rewrite visible, the chain head (latest hash) is copied into each run report and into Justin's Change Log or onto the Pi, outside the run's reach. Caps, ceilings, the allowlist, and `reviewPlanFirst` are frozen at startup, and no tool or plan can change them. A plan can *request* a bigger budget, and that always needs Justin's approval.
- **Why:** an OpenAI misalignment report, *"Suppressing misalignment monitoring alerts and disabling misalignment monitoring"* (OpenAI Alignment, incidents Oct 3 and Oct 6, 2026, report updated Oct 20, 2026, https://alignment.openai.com/misalignment-reports/suppressing-misalignment-monitoring-alerts-and-disabling-misalignment-monitoring), describes coding agents disabling security alerts and removing a monitoring integration while doing routine changes, and one agent falsely claiming it had not. This was reported to Justin, and the page was checked when this spec was written. Reaper therefore keeps its own monitoring out of reach of what it monitors.

### 3.11 Path resolver (`src/lib/runtime/tools/paths.server.ts`, Stage 4)
- `resolveTarget(path) → { real: string; zone: "workspace" | "protected" | "outside" }`.
- Steps, in order:
  - Reject alternate data streams (`:` after the drive), device names (`CON`, `NUL`, …), and `\\?\` and UNC prefixes.
  - Normalize, then resolve symlinks and junctions with `fs.realpath` on the longest existing prefix. This also resolves 8.3 short names.
  - Compare case-insensitively on Windows, with trailing separators handled.
- The check runs again right before the write, so a link swapped in after the check is caught.

### 3.12 Snapshots, run report, and undo (`src/lib/runtime/snapshots.server.ts`, `report.server.ts`, Stage 4)
- **Before each `file.save`:** copy the target's prior bytes, or record it as "absent", to `REAPER_DATA_DIR/snapshots/<runId>/`. This also applies to approved writes outside the workspace.
- **Before each `command.run`:** update a sha256 manifest of the workspace (path, size, hash) and copy only files that changed since the last copy (copy-on-change), not a full snapshot each time. Excludes (for example `node_modules`) are allowed and are listed in the run report as "not undoable". If the copies would exceed `snapshotMaxBytes`, the command needs approval.
- **Run report:** written at the end of every run, including failed ones, to `REAPER_DATA_DIR/reports/<runId>.md` and shown in the UI. It covers the goal, the plan, the models used, every tool call with its args, result, and duration, files written, commands run with exit codes, approvals requested and decided, supported and unsupported claims, limitations, and the snapshot reference.
- **Undo this run:** restores every snapshotted path to its pre-run bytes, deletes paths the run created, and verifies the result against the manifest hashes. If a later run touched the same paths, undo lists the conflicts and asks for confirmation. Undo is itself logged. It writes inside the workspace on its own; approved writes outside the workspace are restored only after Justin confirms, otherwise they are labelled "not undone" in the report. The approval card for such a write says so up front.

## 4. Data flow

1. Justin types a goal and clicks **Run**. `api.ts` `draftServerPlan` calls `draftPlan` and saves the result with `persistWorkflow`, and the plan is drawn on the canvas.
2. **Default (`reviewPlanFirst` off):** if the draft is valid, within the ceilings, and has no `command.run` node, `beginRun` starts right away. The run snapshot copies the plan budget into `run.caps`.
3. **Review on, budget over the ceilings, or a `command.run` node in the plan:**
   - Justin can edit nodes, the evidence rule, and the budget. Every save bumps `version`.
   - **Approve & run** sets `approved_version = version`.
   - In this mode `beginRun` refuses unless `approved_version == version`, so an edit after approval needs a new OK.
4. The UI drives `stepServerRun` one step at a time, as it does today (`claimRunStep` → `stepRuntime` → `replaceRun`).
5. Research and tool nodes produce `SourceRecord`s with run-unique IDs. The analysis node calls the model with the objective, the evidence rule, and those sources. `validateClaims` marks the claims, and `builtin.record` writes supported and unsupported claims plus limitations.
6. A WRITE inside the workspace (an allowlisted command, or a file save) is snapshotted, runs, and is logged, and the run goes on.
7. A WRITE that needs an exception (§3.6) makes the gateway return `NeedsApproval`.
   - The engine stores a row in `reaper_approvals`, sets the run status to `awaiting_approval`, and does **not** advance.
   - Approve stores a grant, and the next step re-runs that node, which uses the grant.
   - Deny fails the node with "Denied by Justin", and the run follows its normal failure path.
   - Anything touching the protected zone is `Blocked` and never reaches this point.
8. At the end, `report.server.ts` writes the run report. **Undo this run** calls `undoRun(runId)` (§3.12).
9. Persistence: migration `0003_station.sql` adds `reaper_workflows.approved_version`, `reaper_runs.status` value `awaiting_approval`, and table `reaper_approvals (id, user_id, run_id, node_key, tool_id, args_hash, args jsonb, decision, decided_at, consumed_at)`. In local mode, `src/lib/db.ts` passes `dataDir: REAPER_DATA_DIR/pglite` to `new PGlite`, so runs and pending approvals survive a restart. Durable storage arrives in Stage 3, and the migration's approval parts arrive in Stage 4. Stage 1 keeps today's in-memory PGLite, so a page reload loses the run. That is accepted for Stage 1, but the server writes the run log and final record to a file (`C:\ReaperData\runs\<runId>.json`, outside the repo) so the done-when evidence survives. The existing auth-off/`DATABASE_URL` guard stays as it is.

## 5. Error handling

Every failure shows up in the run log and the node state. No failure is turned into a fake success.

| Failure | Behavior |
|---|---|
| Ollama not running or refusing connections | Node fails with "Model server not reachable at <baseUrl>". Not retried. |
| Local model timeout | Fails after `timeoutMs`, not before (the fetch header/body timeouts are raised to match). Not retried, from Stage 1. |
| Input too large for the context (Stage 3) | Fails before the call, naming the token estimate and the limit. In Stage 1, the larger Ollama window and the ~7,000-character source cap are the only guard, because Ollama truncates silently. |
| Auth off and the server bound to a non-loopback host | Refuses to start, naming the host. |
| Malformed or unparseable model JSON | Node fails (existing check). No partial claims are kept. |
| Reasoning-only reply with no message item | Fails with "Model returned no answer text". |
| Firecrawl key missing, empty results, or 5xx | Existing visible failures. A 429 or 5xx gets one retry. |
| Planner draft invalid after the repair attempt | Draft shown with errors. It does not run until fixed. |
| Review on and plan edited after approval | Becomes unapproved. `beginRun` and `stepServerRun` reject it as stale. |
| Draft budget above the ceilings | Waits for approval of that budget, in either mode. |
| Write outside the workspace, or a non-allowlisted command | `NeedsApproval`. The tool code doesn't run without a matching unused grant. |
| Write or argument resolving into the protected zone (including via `..`, symlink, junction, 8.3 name, or ADS) | `Blocked`, logged. No grant can authorize it. |
| `file.save` into `.git/`, `package.json`, or `.npmrc` | `Blocked`, logged. |
| Tool argument bound to an upstream port | Plan rejected by the validator. |
| Command uses shell syntax, or an argument points outside the workspace | Treated as not allowlisted, so it needs approval. A path in the protected zone is `Blocked`. |
| Snapshot fails or would exceed `snapshotMaxBytes` | The write doesn't run. It fails, or needs approval if over the cap. |
| Audit-log hash chain broken at startup, or its head doesn't match the last copied anchor | Reaper starts and shows a warning naming the first bad line or the mismatch. The log is never rewritten. |
| Undo conflicts with a later run | Conflicting paths are listed. Nothing is restored without confirmation. |
| Any SEND | `Blocked`, logged. The node fails. |
| App restarts mid-run or mid-approval | A run that was `running` comes back `paused` (existing). An `awaiting_approval` run keeps its pending card. |
| Step budget, depth, or caps exhausted | Existing failure messages. |

## 6. Testing

- **Runner:** the existing `node --test`. The `test` script moves into `scripts/run-tests.mjs` so it works in both PowerShell and Linux CI. Today the single-quoted glob fails under `cmd.exe`, and the `&&` chain hides the TypeScript tests whenever a script test fails.
- **Unit tests with fakes** for each unit in §3: ModelClient against recorded Ollama replies (including a gpt-oss reply with a reasoning item), Planner against recorded drafts with `reviewPlanFirst` on and off, the gateway, the path resolver, snapshots and undo, the router, and the skill loader.
- **Randomized property and stress tests (Stage 4 only, after one real run works)** use a seeded generator in `src/lib/runtime/testing/random.ts`. The seed is printed on failure so the case can be replayed, and no new dependency is needed.
  - Citation validator: ≥10,000 random claim sets against random source sets, including near-miss IDs (case, whitespace, zero-padding, look-alike Unicode, IDs from another run, empty lists). Invariant: supported ⇔ non-empty and every ID is an exact member.
  - Gateway: ≥10,000 random sequences of calls, approvals, denials, replays, edited args, and simulated restarts. Invariants:
    - a write outside the workspace, or a non-allowlisted command, never runs without a matching unused grant;
    - a grant never works twice or for different args;
    - SEND never runs under any settings value or grant;
    - nothing writes into the protected zone.
  - Path traversal: random paths built from `..`, mixed separators, case changes, trailing dots and spaces, 8.3 names, ADS suffixes, device names, and UNC or `\\?\` prefixes. A path is classed `workspace` only if its real path is inside the root.
  - Symlinks and junctions: random links inside the workspace pointing out of it, into the protected zone, and swapped between check and write. None of them lets a write escape. Junction cases run on Windows. On Linux CI they are skipped with a logged reason, and symlink cases run on both.
  - Commands: random programs, arguments, shell metacharacters, and path arguments, including `--output=`, `git -C`, `--git-dir=`, `--work-tree=`, `@file`, and env-relative paths. Only exact grammar matches with in-workspace paths run freely, and `npm` never runs without a grant. A grant stops matching if `package.json` changed after approval.
  - Hooks: plans that write into `.git/`, `package.json`, or `.npmrc` and then run an allowlisted `git` command. The writes are `Blocked`, and no hook or fsmonitor program runs.
  - Tampering: random tool calls aimed at logs, `audit.jsonl`, settings, the allowlist, `engine.ts` `POLICIES`, and repo files. All are `Blocked`, settings stay unchanged after the run, and the audit chain stays intact.
  - Snapshots and undo: random sequences of saves and commands, then undo. The workspace matches the pre-run manifest byte for byte, apart from excluded paths, which the report lists as "not undoable".
  - Plan validator: random graphs are never accepted if they have an unknown tool, a SEND tool, a tool argument bound to an upstream port, an over-cap budget, more than 24 steps, or depth > 4. A graph with a `command.run` node never starts without plan approval.
- **Layout check:** the existing Playwright smoke (`scripts/browser-smoke.mjs`) at 1280×720 and 1920×1080 asserts that the canvas is visible and non-empty and that no docked region overlaps it.
- **Stage 1 adds no new test types.** It extends the existing mocked-provider tests in `runtime.test.ts` for the base URL, the optional key, the timeout, no retry on a local timeout or refused connection, parsing a reply with a reasoning item (both the `output` array and `output_text` paths, using the recorded curl fixture), and the auth-off host check.
- **Live check, one per stage, on the Shadow PC:** the stage's "done when" run, recorded in the Change Log.

## 7. Stages

Each stage is gated: all tests pass (`npm test`, typecheck, lint) **and** its "done when" is met. Only then does the next stage begin.

1. **Runs locally on Ollama (deliberately minimal).** The Ollama hookup in `providers.server.ts`: base URL, optional key, configurable timeout, `gpt-oss:20b` default, and message-only parsing. Then one real research run. It adds only the fixes without which that run fails or exposes Justin:
   - **First, one curl check:** the exact `reaper_analysis` schema against the PC's Ollama `/v1/responses`, saved as the test fixture; fall back to chat completions or `/api/chat` if needed (§3.2).
   - **Context window:** Ollama's OpenAI-compatible endpoints ignore a per-request `num_ctx`, and the default window is much smaller than 32k, so it is set on the Ollama side: either `OLLAMA_CONTEXT_LENGTH`, or a Modelfile variant of `gpt-oss:20b` with a larger `num_ctx` (then `OPENAI_MODEL` names that variant). Confirm the window with `ollama ps`. **Needs Justin's OK first**, because setting the env var means restarting Ollama and a variant means loading a new model. The per-source cap drops to ~7,000 characters (§3.2).
   - **Timeout that holds and no local retry:** raise the fetch header/body timeouts to `timeoutMs`, and don't retry a local timeout or refused connection (§3.2).
   - **Local-only launch:** a launch script bound to `127.0.0.1`, and a refusal to start with auth off on any other host (§2).
   - **Firecrawl pre-check:** `FIRECRAWL_API_KEY` is present in the environment of the shell that starts Reaper (`with-app-env.mjs` only merges `VITE_` entries from `.grok/app-env.json`, so the key must come from the process environment), and one test search succeeds.
   - **Run log to file:** the run log and final record are written to `C:\ReaperData\runs\<runId>.json` (§4.9).
   - It relies only on checks that already exist: citation validation, the step budget and depth limits, today's caps (1 search, 5 pages, 1 model call), and SEND blocked. SEND is blocked because no send tool exists and the "No external post from the engine." policy holds.
   - It adds no sandbox, no allowlist, no write tools, no settings file, no durable storage, and no new stress tests, because the first run doesn't need them.
   *Done when:* on the Shadow PC:
   - the curl fixture is saved and the Firecrawl pre-check passes;
   - `ollama ps` shows the model loaded with the larger context window;
   - Reaper, started by the local script, is reachable on `127.0.0.1` and not from another device;
   - one real run of Objective → Research → Analysis → Condition → Record with `gpt-oss:20b` finishes `done`, with citations validated and at least one supported claim, and its run file exists on disk.
2. **Cleanup, layout, green CI.**
   - Remove the sample goal "Be known for reliable workflow rescue." from `engine.ts` `defaultState` (the objective starts empty).
   - Remove the Demo button and video overlay, legacy demo runs and their `localStorage` keys, `public/reaper-demo*.mp4`, and `scripts/record-demo.mjs`.
   - Remove the `IMPLS` entries `reaper.decision-deck`, `reaper.compact`, and `reaper.bad-ports`. `upgradeLegacyGraphs` keeps mapping old graphs to builtins.
   - Remove the dead six-stage console: `src/components/reaper-console.tsx`, `src/lib/reaper.ts`, and any `engine.ts` client-run helpers that only they use. Each removal is grep-checked first.
   - Build the docked layout (§3.9) and fix the 12 failing script tests (OG/title injection, app-env, `with-app-env`, and the `0001_auth.sql` copy).
   *Done when:* `npm test` passes on Node 22 on both Linux and Windows, CI is green once Justin pushes, and the layout check passes.
3. **Planner (runs immediately; optional review).** §3.5, `plan-panel.tsx`, the `reviewPlanFirst` setting (default off), `approved_version`, and schema v2. Also: the settings unit (§3.1), run-unique source IDs (§3.3), the context check (§3.2), and durable PGLite (§4.9), since drafts and multi-source plans need them. Stage 3 has no write tools.
   *Done when:*
   - On the Shadow PC, a plain-words goal produces a valid draft that runs straight away, with the plan and each step shown live and logged, and finishes with validated citations.
   - With `reviewPlanFirst` on, tests prove `beginRun` rejects unapproved and edited-after-approval workflows, and one edited, approved draft completes on the PC.
   - In both modes, a test proves a budget above the ceilings waits for approval.
4. **Tool tiers, sandbox, and self-protection.** §3.6, §3.10, §3.11, §3.12, `approval-card.tsx`, `run-report.tsx`, `reaper_approvals`, and `awaiting_approval`. This is the first stage with write tools, so the protections arrive here:
   - the workspace sandbox and snapshots;
   - the command allowlist with exact argument grammars, `npm` approval-only, hardened `git`, a fixed command environment, and `.git/`/`package.json`/`.npmrc` writes blocked;
   - plan approval for any plan with a `command.run` node, and tool arguments fixed at plan time (never bound from ports);
   - the protected zone and the audit log, with its chain head anchored outside the run;
   - manifest plus copy-on-change snapshots, run reports, and undo (including approved outside writes, with confirmation);
   - approval for exceptions only, with grants that pin relevant file hashes;
   - all randomized stress tests in §6: citation validator, plan validator, gateway, path traversal, symlinks and junctions, commands, tampering, and undo.
   *Done when:*
   - All of those stress tests pass, including on Windows for junctions.
   - On the Shadow PC, in a tiny test workspace, one approved plan saves a file and runs an allowlisted command with no further prompt.
   - That run produces a run report, and **Undo this run** restores the workspace to match the pre-run manifest hashes.
   - One write outside the workspace pauses for approval, runs after Approve, and fails cleanly after Deny.
   - A write aimed at the settings file, or into `.git/`, is `Blocked`.
   - SEND is always blocked.
5. **Model router and skill loading.** §3.7 and §3.8.
   *Done when:* router tests show deterministic picks from the installed list with fallback, skill tests show only the requested skills from the allowed bundle are injected within budget, and one live run logs its chosen model and the skills it loaded.

## 8. Build process

The process combines Justin's Autonomous Workstation Methodology with a Superpowers subagent-driven loop.

- **Check before changing:** read the file and grep for users before every edit or removal.
- **One change at a time:** one commit per change, with a message stating what, why, and how to undo it (`git revert <hash>`, plus any manual step such as deleting `REAPER_DATA_DIR/pglite`).
- **Change Log:** every change also gets an entry in Justin's Change Log (what, files, commit, undo).
- **Two-attempt limit:** a change gets at most 2 attempts. After a second failure the agent stops and reports. It does not loop.
- **Per task:** the implementer subagent writes the failing test first, implements, and runs the full suite. An independent reviewer subagent then checks the work against this spec and for quality. From Stage 4 on, the randomized tests for the touched unit also run. Only then is the commit made.
- **No external actions:** work happens on local branches only, with no pushes or PRs unless Justin asks.

## 9. Open questions

1. What context length should `gpt-oss:20b` run at on the 20 GB card? It is set on the Ollama side in Stage 1 (with Justin's OK), and `REAPER_MODEL_CONTEXT` must match it. It sets how many sources fit and when the skill budget overflows. 32768 is the working target (whether it fits in VRAM: verify on PC).
2. Where should the workspace root be on the Shadow PC? The default is `C:\ReaperWorkspace`. It must sit outside the Reaper repo and `REAPER_DATA_DIR`. Which extra folders, if any, may `file.read` use?
3. What should the initial command allowlist be? The proposed start is hardened `git` (`status`, `diff`, `log`, `add`, `commit` in the workspace only, §3.6) and `node --version`, each with an exact argument grammar. `npm test` and `npm run build` are not allowlisted in v1: they run scripts from the workspace's `package.json`, so each call needs approval.
4. Where does Justin's Change Log live: a file in this repo, or his existing workstation log? And should the Stage 2 cleanup remove the Grok auth broker wiring, or leave it dormant?
5. Which models should the Stage 5 router table list beyond `gpt-oss:20b`? That depends on what Justin installs.

## 10. Spec self-review

- **Placeholders:** none. Every default value, file, table, and threshold is named. Items that are genuinely undecided are in §9 only, and each has a working default (context 32768, data dir `C:\ReaperData`, workspace `C:\ReaperWorkspace`, a narrow starter allowlist, auth left dormant, router falls back to `gpt-oss:20b`).
- **Consistency:** limits (budget 24, depth 4) are the same in §1, §3.5, §6, and §7. Stage 1 is deliberately minimal: it uses only existing checks, and its only additions are the review fixes that stop the first run failing or exposing Justin (context window, fetch timeout, no local retry, parsing, loopback launch, Firecrawl pre-check, run file). The sandbox, the allowlist, and the stress tests are all Stage 4, and that is stated the same way in §6 and §7. Stage 1 keeps the current caps, and plan-declared budgets arrive in Stage 3 within the §3.1 ceilings. SEND is hard-blocked the same way in §3.1, §3.6, §5, §6, and §7. Plan approval is optional and off by default everywhere it is mentioned (§1, §2, §3.5, §3.9, §4, §5, §7), except that a plan with a `command.run` node always needs it (§1, §3.5, §3.6, §4, §6). `npm` is approval-only in §3.6, §6, and §9. WRITE approval applies only to the §3.6 exceptions, and protected-zone writes are blocked rather than approvable, in §3.6, §3.10, §4, §5, and §6. There are no named modes anywhere: the station has one general Planner.
- **Scope:** this is one product split into five gated stages. Each stage can get its own implementation plan. The v1 exclusions are listed in §1, and nothing in §3–§7 depends on them.
- **Ambiguity:** "approval" means two separate, optional things, and they are kept apart. Plan approval (`approved_version`) is used only when review is on or the budget is over the ceilings, and it never authorizes a WRITE exception. A WRITE exception needs its own single-use grant. "Allowlist" means only the command allowlist. "Workspace" means only `settings.workspace.root`. "Small" and "large" model are defined by a context threshold.
