# Reaper Local Station: design spec

- Date: 2026-10-25
- Owner: Justin Strange. Justin is an independent systems designer, and AI agents do the building under his direction.
- Base: `SaltProphet/reaper-system` `main` at `a6020d8`
- Inputs: `reaper_audit_2026-10-25.md` and `chatgpt_share_vs_audit.md` (what is real and what is stubbed), plus a code read of `src/lib/runtime/*` and `src/components/*`
- Status: design approved in conversation. The written spec still needs Justin's review before an implementation plan is written.

## 1. Goal and scope

Reaper becomes **one general local research station**. Justin describes a goal in plain words, for example "find buyer intent on Reddit for product X". A Planner drafts a workflow: the nodes, the sources and tools to use, and what counts as evidence. Justin reviews the draft, edits it if he wants, and approves it. Only then does it run. Every factual claim in the output cites source IDs collected in that same run.

The station grows out of the existing Reaper. Nothing is rebuilt from scratch. These parts stay as they are: the step engine (`step.ts`), the step budget (`STEP_BUDGET=24`), the depth limit (`MAX_DEPTH=4`), port contracts (`registry.ts`), citation validation, Postgres/PGLite persistence with optimistic versioning (`persistence.server.ts`), and the policies in `engine.ts` `POLICIES` ("No evidence, no factual claim.", "No external post from the engine.", and the rest).

**Host:** Justin's Windows 11 Shadow PC (RTX A4500, 20 GB). It runs natively on Node 22 and Ollama. That PC has no Docker because virtualization is disabled. Vercel is not a target: it is unpaid, and it can't reach the local model anyway. A Raspberry Pi 5 with Docker is an optional later host for helpers such as SearXNG or Postgres. Nothing in v1 depends on it.

**In v1:** local model runs, cleanup and a docked layout, green CI, the Planner with an approval gate, three tool tiers, a model router, and on-demand skill loading. These are delivered in the five stages of §7.

**Out of v1:** multi-agent orchestration, arbitrary code nodes, sending or posting anything, cloud hosting, and a local search replacement for Firecrawl (that is a later stage).

## 2. Architecture

One Node process on the Shadow PC (`npm run dev` with `VITE_AUTH_ENABLED=false`) talks to Ollama at `http://127.0.0.1:11434/v1`.

```
Workbench UI (workbench.tsx, node-canvas.tsx, new plan-panel.tsx, approval-card.tsx)
   │  server functions (api.ts)
   ▼
Planner (planner.server.ts) ──► draft WorkflowDefinition ──► Justin edits/approves
   ▼                                               (approved_version == version)
Step engine (step.ts, unchanged core: budget 24, depth 4, one step per call)
   ▼
Executors (registry.ts: objective, research, analysis, condition, record, + tool)
   ▼
Tool Gateway (tools/gateway.server.ts) — tier check: READ / WRITE(approval) / SEND(blocked)
   ▼
Providers: ModelClient (OpenAI-compatible → Ollama) · SearchProvider (Firecrawl) · local file/command
   ▼
Persistence: PGLite with a data dir on disk (local) or Postgres (DATABASE_URL)
```

The existing seam stays where it is. `RuntimeDependencies` (`types.ts`) is still the only way executors reach the outside world. The change is that the seam's `research`/`analyze` pair grows into `{ models, search, tools }`, and every tool call goes through the gateway.

## 3. Components and interfaces

Each unit lives in a small file, can be tested alone with injected fakes (the way `runtime.test.ts` already works), and talks to the others only through the interfaces listed here.

### 3.1 Settings (`src/lib/runtime/settings.server.ts`, new)
- Stage 1 reads only the environment variables below, directly in the model provider. The `settings.server.ts` unit and the optional `REAPER_DATA_DIR/settings.json` arrive in Stage 3. The unit reads environment variables and that optional file. Returns a frozen `StationSettings`:
  - `model: { baseUrl, apiKey?, defaultModel, timeoutMs, contextTokens }`. Defaults: `OPENAI_BASE_URL=http://127.0.0.1:11434/v1`, `OPENAI_MODEL=gpt-oss:20b`, `REAPER_MODEL_TIMEOUT_MS=600000`, `REAPER_MODEL_CONTEXT=32768`. The key is required only when the base URL host is `api.openai.com`.
  - `caps: { maxSearches, maxPages, maxModelCalls }`. These are ceilings that a plan may not exceed. Defaults are 5 / 25 / 10.
  - `capabilities: { send: "locked" }`. In v1 the parser accepts no other value (see §3.6).
  - `router` and `skills` blocks, used from Stage 5 on (see §3.7 and §3.8).
- Invalid settings make the server refuse to start, with one message naming the bad field.

### 3.2 ModelClient (`src/lib/runtime/providers/model.server.ts`, split from `providers.server.ts`)
- `complete({ model, instructions, input, schema, timeoutMs }) → Promise<{ text: string; model: string }>`
- It keeps today's Responses-API request shape (`text.format: json_schema`, strict) and builds the URL as `${baseUrl}/responses`. Ollama ≥ 0.13.3 supports this.
- **Stage 1 scope is only:** the configurable base URL, the optional key, the configurable timeout, the `gpt-oss:20b` default, and the message-only parsing in the next bullet (gpt-oss replies don't parse without it). The two bullets after that arrive in Stage 3.
- `responseOutputText` is changed to read only `type: "message"` items, not reasoning items. gpt-oss is a thinking model, and today the function returns the first `text` it finds.
- (Stage 3) Errors are tagged `{ retryable: boolean }`. A local timeout or a refused connection is **not** retryable, because a retry doubles the GPU load. `step.ts` `transient()` checks the tag first and falls back to the current regex only for untagged errors.
- (Stage 3) Before each call it estimates the input size (characters ÷ 4). If the input exceeds 75% of `contextTokens`, it fails with a clear message instead of letting Ollama silently truncate.
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
- Checks: `validateWorkflowDefinition` (cycles, ports, types), plus a budget within `settings.caps`, at most 24 steps in the worst case, depth ≤ 4, and no unknown or SEND tools. If the draft fails, the model gets **one** repair attempt with the error list. If that also fails, the draft is shown with its errors and nothing is runnable. That is the 2-attempt maximum.
- `WorkflowDefinition` moves to `schemaVersion: 2` (adding `objective.evidence` and `plan`). An upgrader turns v1 definitions into v2 with an empty evidence field and Stage 1 caps.

### 3.6 Tool Gateway (`src/lib/runtime/tools/gateway.server.ts`, new) and tools
- `ToolDefinition = { id; tier: "read" | "write" | "send"; argsSchema; describe(args) → string; run(args, ctx) }`
- `invoke(call: { runId, nodeKey, toolId, args }, ctx) → ToolResult | NeedsApproval | Blocked`
- **READ** tools: `web.search` (Firecrawl), `web.fetch` (Firecrawl scrape of one URL), `file.read` (only under folders listed in settings), and `model.call` (ModelClient). They run freely, but only if the tool is listed in the approved plan.
- **WRITE** tools: `file.save` (writes under `REAPER_DATA_DIR/outputs` or a folder listed in settings) and `command.run` (a single PowerShell command with a timeout, shown verbatim). Each call needs a fresh approval grant that matches `(runId, nodeKey, toolId, sha256(canonical args))`. A grant is used once. Approving the plan never counts as approving a WRITE.
- **SEND** (send, post, purchase): no tools are registered in v1. The gateway returns `Blocked` for any `send` tier no matter what grants exist, and `capabilities.send` only accepts `"locked"`. Unlocking later takes a new settings value plus its own approval rule, delivered as a reviewed change. Hand-editing config cannot unlock it.
- Tools run only as explicit `builtin.tool` nodes (config `{ toolId, args }`) that are visible in the plan. In v1 a model never picks a tool on its own.

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
- New `plan-panel.tsx`: a goal box and a "Draft plan" button, the draft, Planner notes and errors, and an "Approve & run" button that is enabled only when the draft is valid and unedited since approval.
- New `approval-card.tsx`: shows a pending WRITE as the tool, the exact path or command, and an args preview, with Approve and Deny buttons.

## 4. Data flow

1. Justin types a goal and clicks **Draft plan**. `api.ts` `draftServerPlan` calls `draftPlan` and saves the result with `persistWorkflow`. The workflow's `approved_version` is null.
2. The draft is drawn on the canvas. Justin can edit nodes, the evidence rule, and the budget. Every save bumps `version`, which leaves the workflow unapproved.
3. **Approve & run** calls `approvePlan(workflowId, version)`, which sets `approved_version = version`. `beginRun` refuses unless `approved_version == version`. The run snapshot copies the plan budget into `run.caps`.
4. The UI drives `stepServerRun` one step at a time, as it does today (`claimRunStep` → `stepRuntime` → `replaceRun`).
5. Research and tool nodes produce `SourceRecord`s with run-unique IDs. The analysis node calls the model with the objective, the evidence rule, and those sources. `validateClaims` marks the claims, and `builtin.record` writes supported and unsupported claims plus limitations.
6. When a WRITE is reached, the gateway returns `NeedsApproval`. The engine stores a row in `reaper_approvals`, sets the run status to `awaiting_approval`, and does **not** advance. Approve stores a grant, and the next step re-runs that node, which uses the grant. Deny fails the node with "Denied by Justin" and the run follows its normal failure path.
7. Persistence: migration `0003_station.sql` adds `reaper_workflows.approved_version`, `reaper_runs.status` value `awaiting_approval`, and table `reaper_approvals (id, user_id, run_id, node_key, tool_id, args_hash, args jsonb, decision, decided_at, consumed_at)`. In local mode, `src/lib/db.ts` passes `dataDir: REAPER_DATA_DIR/pglite` to `new PGlite`, so runs and pending approvals survive a restart. Durable storage arrives in Stage 3, and the migration's approval parts arrive in Stage 4. Stage 1 keeps today's in-memory PGLite. The existing auth-off/`DATABASE_URL` guard stays as it is.

## 5. Error handling

Every failure shows up in the run log and the node state. No failure is turned into a fake success.

| Failure | Behavior |
|---|---|
| Ollama not running or refusing connections | Node fails with "Model server not reachable at <baseUrl>". Not retried. |
| Local model timeout | Fails after `timeoutMs`. From Stage 3 it is not retried. In Stage 1 the existing single retry still applies. |
| Input too large for the context (Stage 3) | Fails before the call, naming the token estimate and the limit. |
| Malformed or unparseable model JSON | Node fails (existing check). No partial claims are kept. |
| Reasoning-only reply with no message item | Fails with "Model returned no answer text". |
| Firecrawl key missing, empty results, or 5xx | Existing visible failures. A 429 or 5xx gets one retry. |
| Planner draft invalid after the repair attempt | Draft shown with errors. Approve stays disabled. |
| Plan edited after approval | Becomes unapproved. `beginRun` and `stepServerRun` reject it as stale. |
| WRITE without a matching unused grant | `NeedsApproval`. The tool code never runs. |
| Any SEND | `Blocked`, logged. The node fails. |
| App restarts mid-run or mid-approval | A run that was `running` comes back `paused` (existing). An `awaiting_approval` run keeps its pending card. |
| Step budget, depth, or caps exhausted | Existing failure messages. |

## 6. Testing

- **Runner:** the existing `node --test`. The `test` script moves into `scripts/run-tests.mjs` so it works in both PowerShell and Linux CI. Today the single-quoted glob fails under `cmd.exe`, and the `&&` chain hides the TypeScript tests whenever a script test fails.
- **Unit tests with fakes** for each unit in §3: ModelClient against recorded Ollama replies (including a gpt-oss reply with a reasoning item), Planner against recorded drafts, the gateway, the router, and the skill loader.
- **Randomized property and stress tests (Stage 4 only, after one real run works)** use a seeded generator in `src/lib/runtime/testing/random.ts`. The seed is printed on failure so the case can be replayed, and no new dependency is needed.
  - Citation validator: ≥10,000 random claim sets against random source sets, including near-miss IDs (case, whitespace, zero-padding, look-alike Unicode, IDs from another run, empty lists). Invariant: supported ⇔ non-empty and every ID is an exact member.
  - Gateway: ≥10,000 random sequences of calls, approvals, denials, replays, edited args, and simulated restarts. Invariants: a WRITE tool's `run` is never invoked without a matching unused grant, a grant never works twice or for different args, and a SEND is never invoked under any settings value or grant.
  - Plan validator: random graphs are never accepted if they have an unknown tool, a SEND tool, an over-cap budget, more than 24 steps, or depth > 4.
- **Layout check:** the existing Playwright smoke (`scripts/browser-smoke.mjs`) at 1280×720 and 1920×1080 asserts that the canvas is visible and non-empty and that no docked region overlaps it.
- **Stage 1 adds no new test types.** It extends the existing mocked-provider tests in `runtime.test.ts` for the base URL, the optional key, the timeout, and parsing a reply with a reasoning item.
- **Live check, one per stage, on the Shadow PC:** the stage's "done when" run, recorded in the Change Log.

## 7. Stages

Each stage is gated: all tests pass (`npm test`, typecheck, lint) **and** its "done when" is met. Only then does the next stage begin.

1. **Runs locally on Ollama (deliberately minimal).** The Ollama hookup in `providers.server.ts`: base URL, optional key, configurable timeout, `gpt-oss:20b` default, and message-only parsing. Then one real research run.
   - It relies only on checks that already exist: citation validation, the step budget and depth limits, today's caps (1 search, 5 pages, 1 model call), and SEND blocked. SEND is blocked because no send tool exists and the "No external post from the engine." policy holds.
   - It adds no sandbox, no allowlist, no write tools, no settings file, no durable storage, and no new stress tests, because the first run doesn't need them.
   *Done when:* on the Shadow PC, one real run of Objective → Research → Analysis → Condition → Record with `gpt-oss:20b` finishes `done`, with citations validated and at least one supported claim.
2. **Cleanup, layout, green CI.**
   - Remove the sample goal "Be known for reliable workflow rescue." from `engine.ts` `defaultState` (the objective starts empty).
   - Remove the Demo button and video overlay, legacy demo runs and their `localStorage` keys, `public/reaper-demo*.mp4`, and `scripts/record-demo.mjs`.
   - Remove the `IMPLS` entries `reaper.decision-deck`, `reaper.compact`, and `reaper.bad-ports`. `upgradeLegacyGraphs` keeps mapping old graphs to builtins.
   - Remove the dead six-stage console: `src/components/reaper-console.tsx`, `src/lib/reaper.ts`, and any `engine.ts` client-run helpers that only they use. Each removal is grep-checked first.
   - Build the docked layout (§3.9) and fix the 12 failing script tests (OG/title injection, app-env, `with-app-env`, and the `0001_auth.sql` copy).
   *Done when:* `npm test` passes on Node 22 on both Linux and Windows, CI is green once Justin pushes, and the layout check passes.
3. **Planner.** §3.5, `plan-panel.tsx`, `approved_version`, schema v2. Also: the settings unit (§3.1), run-unique source IDs (§3.3), the retry tag and context check (§3.2), and durable PGLite (§4.7), since drafts and multi-source plans need them.
   *Done when:* a plain-words goal produces a valid draft, nothing runs before approval (a test proves `beginRun` rejects unapproved and edited-after-approval workflows), and one approved, edited draft completes on the Shadow PC with validated citations.
4. **Tool tiers with approval gates and self-protection.** §3.6, `approval-card.tsx`, `reaper_approvals`, `awaiting_approval`. This is the first stage with write tools, so the protections arrive here:
   - the sandbox (allowed folders for `file.read` and `file.save`, and the `command.run` timeout);
   - the allowlist (only tools listed in the approved plan may run);
   - all randomized self-protection stress tests in §6 (citation validator, gateway, plan validator).
   *Done when:* the randomized stress tests pass (no WRITE without approval, SEND always blocked), and one live run on the PC pauses for a `file.save` approval, writes after Approve, and fails cleanly after Deny.
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

1. What context length should `gpt-oss:20b` run at on the 20 GB card (`REAPER_MODEL_CONTEXT`)? It sets how many sources fit and when the skill budget overflows. It should be measured in Stage 1.
2. What are the `file.read` and `file.save` allowed folders on the Shadow PC?
3. Where does Justin's Change Log live: a file in this repo, or his existing workstation log?
4. Should the Stage 2 cleanup also remove the Grok auth broker wiring, or leave it dormant since local mode runs with auth off?
5. Which models should the Stage 5 router table list beyond `gpt-oss:20b`? That depends on what Justin installs.

## 10. Spec self-review

- **Placeholders:** none. Every default value, file, table, and threshold is named. Items that are genuinely undecided are in §9 only, and each has a working default (context 32768, outputs under `REAPER_DATA_DIR/outputs`, auth left dormant, router falls back to `gpt-oss:20b`).
- **Consistency:** limits (budget 24, depth 4) are the same in §1, §3.5, §6, and §7. Stage 1 is deliberately minimal: it uses only existing checks and adds no new safeguards. The sandbox, the allowlist, and the stress tests are all Stage 4, and that is stated the same way in §6 and §7. Stage 1 keeps the current caps, and plan-declared budgets arrive in Stage 3 within the §3.1 ceilings. SEND is blocked the same way in §3.1, §3.6, §5, and §6. There are no named modes anywhere: the station has one general Planner.
- **Scope:** this is one product split into five gated stages. Each stage can get its own implementation plan. The v1 exclusions are listed in §1, and nothing in §3–§7 depends on them.
- **Ambiguity:** "approval" means two separate things, and they are kept apart. Plan approval (`approved_version`) never authorizes a WRITE. A WRITE needs its own single-use grant. "Small" and "large" model are defined by a context threshold.
