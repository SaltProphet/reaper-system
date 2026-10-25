import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "undici";
import test from "node:test";
import { connectNodes, defaultState, orderedNodes, type Graph } from "../engine.ts";
import { EXECUTORS, getExecutor } from "./registry.ts";
import { createRuntimeRun, stepRuntime, validateWorkflowDefinition } from "./step.ts";
import { ANALYSIS_INSTRUCTIONS, classifyModelError, createProviderDependencies, modelAgentOptions, modelAuth, modelConfig, postJson, REAPER_ANALYSIS_SCHEMA, responseOutputText, SOURCE_CONTENT_CAP } from "./providers.server.ts";
import type { RuntimeDependencies, WorkflowDefinition } from "./types.ts";
import { ProviderError } from "./errors.ts";
import { runFilePath, writeRunFile, writeTerminalRunFile } from "./run-file.server.ts";

const source = {
  id: "SRC-001",
  url: "https://example.com/research",
  title: "Research",
  retrievedAt: "2026-10-24T00:00:00.000Z",
  content: "Verified source content.",
};

function dependencies(overrides: Partial<RuntimeDependencies> = {}): RuntimeDependencies {
  return {
    research: async () => [source],
    analyze: async () => ({
      summary: "Source-linked result.",
      claims: [{ text: "Supported claim", sourceIds: ["SRC-001"], supported: false }],
      limitations: [],
      model: "test-model",
    }),
    now: () => "2026-10-24T00:00:00.000Z",
    id: (prefix) => `${prefix}-fixed`,
    ...overrides,
  };
}

function workflow(graph: Graph): WorkflowDefinition {
  return {
    schemaVersion: 1,
    objective: { goal: "Research the test subject", constraints: "Cite sources", doneWhen: "A record exists" },
    graphs: [graph],
  };
}

async function runToEnd(definition: WorkflowDefinition, deps = dependencies()) {
  let run = createRuntimeRun("workflow-1", 1, definition);
  for (let i = 0; i < 24 && run.status !== "done" && run.status !== "failed"; i += 1) {
    run = await stepRuntime(definition, run, deps);
  }
  return run;
}

test("registers each built-in executor with a unique contract", () => {
  assert.deepEqual(EXECUTORS.map((executor) => executor.id), [
    "builtin.objective",
    "builtin.research",
    "builtin.analysis",
    "builtin.condition",
    "builtin.record",
  ]);
  assert.equal(new Set(EXECUTORS.map((executor) => executor.id)).size, EXECUTORS.length);
  assert.deepEqual(getExecutor("builtin.condition")?.outputs, { analysis: "analysis", matched: "boolean" });
});

test("rejects an edge that routes the wrong value type", () => {
  const graph = defaultState().graphs[0];
  graph.edges = [{ id: "bad", from: "objective", to: "results", fromPort: "objective", toPort: "analysis" }];
  assert.match(validateWorkflowDefinition(workflow(graph)).join(" "), /routes objective into analysis/);
});

test("routes typed values through the real built-in executor chain", async () => {
  const graph = defaultState().graphs[0];
  const run = await runToEnd(workflow(graph));
  assert.equal(run.status, "done");
  assert.equal(run.caps.searchCallsLeft, 0);
  assert.equal(run.caps.modelCallsLeft, 0);
  assert.equal(run.artifacts.some((artifact) => artifact.type === "sources"), true);
  const analysis = run.artifacts.find((artifact) => artifact.type === "analysis");
  assert.equal((analysis?.data as { claims: { supported: boolean }[] }).claims[0].supported, true);
});

test("never marks a claim supported when its citation is outside the run", async () => {
  const deps = dependencies({
    analyze: async () => ({
      summary: "Bad citation.",
      claims: [{ text: "Unsupported", sourceIds: ["SRC-999"], supported: true }],
      limitations: [],
      model: "test-model",
    }),
  });
  const run = await runToEnd(workflow(defaultState().graphs[0]), deps);
  const analysis = run.artifacts.find((artifact) => artifact.type === "analysis");
  assert.equal((analysis?.data as { claims: { supported: boolean }[] }).claims[0].supported, false);
});

test("retries one clearly transient provider failure and records both attempts", async () => {
  let calls = 0;
  const deps = dependencies({
    research: async () => {
      calls += 1;
      if (calls === 1) throw new Error("503 temporary upstream failure");
      return [source];
    },
  });
  const run = await runToEnd(workflow(defaultState().graphs[0]), deps);
  assert.equal(run.status, "done");
  assert.equal(calls, 2);
  assert.equal(run.nodes["workbench:research"].attempts, 2);
  assert.match(run.log.map((entry) => entry.text).join("\n"), /retried/);
});

test("does not retry ambiguous failures", async () => {
  let calls = 0;
  const deps = dependencies({
    research: async () => {
      calls += 1;
      throw new Error("Provider returned malformed source data");
    },
  });
  const run = await runToEnd(workflow(defaultState().graphs[0]), deps);
  assert.equal(run.status, "failed");
  assert.equal(calls, 1);
});

test("condition edges skip the unselected branch and its descendants", async () => {
  const graph: Graph = {
    id: "branch",
    name: "Branch",
    nodes: [
      { id: "objective", name: "Objective", kind: "human", implId: "builtin.objective", inputs: [], outputs: ["objective"] },
      { id: "research", name: "Research", kind: "tool", implId: "builtin.research", inputs: ["objective"], outputs: ["sources"] },
      { id: "analysis", name: "Analysis", kind: "agent", implId: "builtin.analysis", inputs: ["objective", "sources"], outputs: ["analysis"] },
      { id: "condition", name: "Condition", kind: "tool", implId: "builtin.condition", inputs: ["analysis"], outputs: ["analysis", "matched"], config: { path: "claims.0.supported", value: true } },
      { id: "yes", name: "Yes record", kind: "tool", implId: "builtin.record", inputs: ["analysis"], outputs: ["record"] },
      { id: "no", name: "No record", kind: "tool", implId: "builtin.record", inputs: ["analysis"], outputs: ["record"] },
      { id: "no-child", name: "No child", kind: "tool", implId: "builtin.record", inputs: ["analysis"], outputs: ["record"] },
    ],
    edges: [
      { id: "o-r", from: "objective", to: "research", fromPort: "objective", toPort: "objective" },
      { id: "r-a", from: "research", to: "analysis", fromPort: "sources", toPort: "sources" },
      { id: "a-c", from: "analysis", to: "condition", fromPort: "analysis", toPort: "analysis" },
      { id: "c-y", from: "condition", to: "yes", fromPort: "analysis", toPort: "analysis", branch: true },
      { id: "c-n", from: "condition", to: "no", fromPort: "analysis", toPort: "analysis", branch: false },
      { id: "n-c", from: "no", to: "no-child", fromPort: "record", toPort: "__control" },
    ],
  };
  const run = await runToEnd(workflow(graph));
  assert.equal(run.status, "done");
  assert.equal(run.nodes["branch:yes"].status, "succeeded");
  assert.equal(run.nodes["branch:no"].status, "skipped");
  assert.equal(run.nodes["branch:no-child"].status, "skipped");
});

test("rejects a cycle before execution", () => {
  const state = defaultState();
  const graph = state.graphs[0];
  assert.ok(orderedNodes(graph));
  const result = connectNodes(state, graph.id, "results", "objective");
  assert.match(result.error ?? "", /cycle/i);
});

test("passes explicit values into a child graph and returns its output", async () => {
  const root = defaultState().graphs[0];
  const analysisNode = root.nodes.find((node) => node.id === "child")!;
  analysisNode.name = "Child workflow";
  analysisNode.kind = "framework";
  analysisNode.implId = "builtin.subworkflow";
  analysisNode.inputs = ["analysis"];
  analysisNode.outputs = ["record"];
  analysisNode.childGraphId = "child-graph";
  root.nodes = root.nodes.filter((node) => node.id !== "results");
  root.edges = [
    { id: "o-r", from: "objective", to: "research", fromPort: "objective", toPort: "objective" },
    { id: "r-a", from: "research", to: "analysis-producer", fromPort: "sources", toPort: "sources" },
  ];
  root.nodes.splice(2, 0, {
    id: "analysis-producer",
    name: "Analysis",
    kind: "agent",
    implId: "builtin.analysis",
    inputs: ["objective", "sources"],
    outputs: ["analysis"],
  });
  root.edges.push({ id: "a-c", from: "analysis-producer", to: "child", fromPort: "analysis", toPort: "analysis" });
  const child: Graph = {
    id: "child-graph",
    name: "Child",
    nodes: [{ id: "record", name: "Record", kind: "tool", implId: "builtin.record", inputs: ["analysis"], outputs: ["record"] }],
    edges: [],
  };
  const definition = { ...workflow(root), graphs: [root, child] };
  assert.deepEqual(validateWorkflowDefinition(definition), []);
  const run = await runToEnd(definition);
  assert.equal(run.status, "done");
  assert.equal(run.values["workbench:child:record"].type, "record");
});

test("enforces the depth and step limits", async () => {
  const graphs: Graph[] = Array.from({ length: 5 }, (_, index) => ({
    id: `depth-${index + 1}`,
    name: `Depth ${index + 1}`,
    nodes: index === 4 ? [] : [{
      id: `child-${index + 1}`,
      name: `Child ${index + 1}`,
      kind: "framework",
      implId: "builtin.subworkflow",
      inputs: [],
      outputs: ["text"],
      childGraphId: `depth-${index + 2}`,
    }],
    edges: [],
  }));
  const definition: WorkflowDefinition = { ...workflow(graphs[0]), graphs };
  let run = createRuntimeRun("workflow-1", 1, definition);
  for (let i = 0; i < 6 && run.status !== "failed"; i += 1) run = await stepRuntime(definition, run, dependencies());
  assert.equal(run.status, "failed");
  assert.match(run.error ?? "", /depth limit/i);

  const normal = workflow(defaultState().graphs[0]);
  const exhausted = { ...createRuntimeRun("workflow-1", 1, normal), budgetLeft: 0 };
  const failed = await stepRuntime(normal, exhausted, dependencies());
  assert.equal(failed.status, "failed");
  assert.match(failed.error ?? "", /budget/i);
});

test("normalizes mocked Firecrawl results and parses OpenAI structured output", async () => {
  const oldFetch = globalThis.fetch;
  process.env.FIRECRAWL_API_KEY = "test-firecrawl";
  process.env.OPENAI_API_KEY = "test-openai";
  const oldBase = process.env.OPENAI_BASE_URL;
  const oldModel = process.env.OPENAI_MODEL;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_MODEL;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: { web: [{ url: source.url, title: source.title, markdown: source.content }] } }), { status: 200 });
  const modelFetch = async () => new Response(JSON.stringify({
    output_text: JSON.stringify({ summary: "Structured", claims: [{ text: "Claim", sourceIds: ["SRC-001"] }], limitations: [] }),
  }), { status: 200 });
  try {
    const providers = createProviderDependencies({ modelFetch });
    const sources = await providers.research("query", 5);
    assert.equal(sources[0].id, "SRC-001");
    const result = await providers.analyze(workflow(defaultState().graphs[0]).objective, sources);
    assert.equal(result.summary, "Structured");
    assert.equal(result.model, "gpt-5.4-mini");
  } finally {
    if (oldBase === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = oldBase;
    if (oldModel === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = oldModel;
    globalThis.fetch = oldFetch;
    delete process.env.FIRECRAWL_API_KEY;
    delete process.env.OPENAI_API_KEY;
  }
});

test("provider adapters fail visibly for missing credentials, empty results, and malformed model output", async () => {
  const oldFetch = globalThis.fetch;
  delete process.env.FIRECRAWL_API_KEY;
  delete process.env.OPENAI_API_KEY;
  await assert.rejects(() => createProviderDependencies().research("query", 5), /FIRECRAWL_API_KEY/);

  process.env.FIRECRAWL_API_KEY = "test-firecrawl";
  globalThis.fetch = async () => new Response(JSON.stringify({ data: { web: [] } }), { status: 200 });
  assert.deepEqual(await createProviderDependencies().research("query", 5), []);

  process.env.OPENAI_API_KEY = "test-openai";
  const modelFetch = async () => new Response(JSON.stringify({ output_text: "not json" }), { status: 200 });
  await assert.rejects(
    () => createProviderDependencies({ modelFetch }).analyze(workflow(defaultState().graphs[0]).objective, [source]),
    /JSON|malformed/i,
  );
  globalThis.fetch = oldFetch;
  delete process.env.FIRECRAWL_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

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

test("model config keeps the pre-Stage-1 cloud defaults (OpenAI, gpt-5.4-mini) so a deploy does not break", () => withEnv(
  { OPENAI_BASE_URL: undefined, OPENAI_API_KEY: undefined, OPENAI_MODEL: undefined, REAPER_MODEL_TIMEOUT_MS: undefined, REAPER_MODEL_API_KEY: undefined },
  () => {
    assert.throws(() => modelConfig(), /OPENAI_API_KEY/);
    process.env.OPENAI_API_KEY = "k";
    assert.deepEqual(modelConfig(), { baseUrl: "https://api.openai.com/v1", apiKey: "k", model: "gpt-5.4-mini", timeoutMs: 600_000 });
  },
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
  const seen: { url: string; headers: Record<string, string>; body: any }[] = [];
  const modelFetch = async (url: string, init: Record<string, unknown>) => {
    seen.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ output_text: JSON.stringify({ summary: "s", claims: [], limitations: [] }) }), { status: 200 });
  };
  await withEnv({ OPENAI_BASE_URL: "http://127.0.0.1:11434/v1", OPENAI_API_KEY: undefined, REAPER_MODEL_API_KEY: undefined, OPENAI_MODEL: "gpt-oss-20b-32k" }, async () => {
    const result = await createProviderDependencies({ modelFetch }).analyze(workflow(defaultState().graphs[0]).objective, [source]);
    assert.equal(result.model, "gpt-oss-20b-32k");
  });
  assert.equal(seen[0].url, "http://127.0.0.1:11434/v1/responses");
  assert.equal("Authorization" in seen[0].headers, false);
  assert.equal(seen[0].body.text.format.strict, true);
});

test("S1: sends Authorization only to api.openai.com, or over https with REAPER_MODEL_API_KEY", () => {
  assert.deepEqual(modelAuth("https://api.openai.com/v1", { OPENAI_API_KEY: "sk-a" }), { apiKey: "sk-a" });
  assert.deepEqual(modelAuth("https://models.example.com/v1", { REAPER_MODEL_API_KEY: "rk-b", OPENAI_API_KEY: "sk-a" }), { apiKey: "rk-b" });
  assert.deepEqual(modelAuth("http://127.0.0.1:11434/v1", {}), {});
  for (const [url, keys] of [
    ["http://127.0.0.1:11434/v1", { OPENAI_API_KEY: "sk-a" }],
    ["https://models.example.com/v1", { OPENAI_API_KEY: "sk-a" }],
    ["http://models.example.com/v1", { REAPER_MODEL_API_KEY: "rk-b" }],
  ] as const) {
    const auth = modelAuth(url, keys);
    assert.equal(auth.apiKey, undefined, url);
    assert.match(auth.warning ?? "", /not sent/, url);
    assert.doesNotMatch(auth.warning ?? "", /sk-a|rk-b/, url);
  }
});

test("S1: a local base URL never receives OPENAI_API_KEY, and the warning omits the value", async () => {
  const seen: Record<string, string>[] = [];
  const warnings: string[] = [];
  const oldWarn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
  const modelFetch = async (_url: string, init: Record<string, unknown>) => {
    seen.push(init.headers as Record<string, string>);
    return new Response(JSON.stringify({ output_text: JSON.stringify({ summary: "s", claims: [], limitations: [] }) }), { status: 200 });
  };
  try {
    await withEnv({ OPENAI_BASE_URL: "http://127.0.0.1:11434/v1", OPENAI_API_KEY: "sk-secret-value", REAPER_MODEL_API_KEY: undefined }, async () => {
      await createProviderDependencies({ modelFetch }).analyze(workflow(defaultState().graphs[0]).objective, [source]);
    });
  } finally {
    console.warn = oldWarn;
  }
  assert.equal("Authorization" in seen[0], false);
  assert.ok(warnings.some((line) => /not sent/.test(line)));
  assert.ok(warnings.every((line) => !line.includes("sk-secret-value")));
});

test("R1: an incomplete reply fails with its reason instead of parsing truncated text", () => {
  assert.throws(
    () => responseOutputText({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [
      { type: "message", content: [{ type: "output_text", text: "{\"summary\":\"trunc" }] },
    ] }),
    /^Error: Model reply incomplete: max_output_tokens$/,
  );
  assert.throws(
    () => responseOutputText({ status: "completed", output: [
      { type: "message", status: "incomplete", content: [{ type: "output_text", text: "{" }] },
    ] }),
    /Model reply incomplete/,
  );
  assert.equal(responseOutputText({ status: "completed", output: [{ type: "message", status: "completed", content: [{ type: "output_text", text: "ok" }] }] }), "ok");
});

test("R1: analysis reports the reply's input and output token counts", async () => {
  const modelFetch = async () => new Response(JSON.stringify({
    status: "completed",
    usage: { input_tokens: 1234, output_tokens: 56 },
    output: [{ type: "message", status: "completed", content: [{ type: "output_text", text: JSON.stringify({ summary: "s", claims: [], limitations: [] }) }] }],
  }), { status: 200 });
  await withEnv({ OPENAI_BASE_URL: "http://127.0.0.1:11434/v1", OPENAI_API_KEY: undefined }, async () => {
    const result = await createProviderDependencies({ modelFetch }).analyze(workflow(defaultState().graphs[0]).objective, [source]);
    assert.deepEqual(result.tokens, { input: 1234, output: 56 });
  });
});

test("R1/R3: the node log records token counts and rejected source IDs verbatim", async () => {
  const odd = "SRC\u2011001"; // non-breaking hyphen: must be logged as given, never normalized
  const run = await runToEnd(workflow(defaultState().graphs[0]), dependencies({
    analyze: async () => ({
      summary: "s",
      claims: [{ text: "c", sourceIds: [odd, "SRC-001"], supported: false }, { text: "d", sourceIds: ["SRC-9"], supported: false }],
      limitations: [],
      model: "m",
      tokens: { input: 900, output: 40 },
    }),
  }));
  const lines = run.log.map((entry) => entry.text);
  assert.ok(lines.some((line) => line.includes("input 900") && line.includes("output 40")), lines.join("\n"));
  const rejected = lines.find((line) => line.includes("Rejected source IDs"));
  assert.ok(rejected, lines.join("\n"));
  assert.ok(rejected!.includes(JSON.stringify(odd)) && rejected!.includes("\"SRC-9\""), rejected);
  assert.ok(!rejected!.includes("\"SRC-001\""), rejected);
});

test("R3: the instructions ask for exact ASCII source IDs", () => {
  assert.match(ANALYSIS_INSTRUCTIONS, /Copy source IDs exactly as given, ASCII only\./);
});

test("the code schema is exactly the schema in the recorded fixture request", () => {
  const request = JSON.parse(readFileSync(new URL("./fixtures/ollama-responses-request.json", import.meta.url), "utf8"));
  assert.deepEqual(request.text.format.schema, REAPER_ANALYSIS_SCHEMA);
});

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

test("B1: a dispatcher is always paired with undici's own fetch, never Node's bundled one", async () => {
  const { server, url } = await slowServer(2_500); // undici timers have ~1 s resolution: keep the gap > 1 s
  const short = new Agent({ headersTimeout: 200, bodyTimeout: 200 });
  const long = new Agent({ headersTimeout: 5_000, bodyTimeout: 5_000 });
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("global fetch must not carry an undici@7 Agent"); }) as typeof fetch;
  try {
    await assert.rejects(
      () => postJson(url, {}, { timeoutMs: 10_000, dispatcher: short }),
      (error: any) => error?.cause?.code === "UND_ERR_HEADERS_TIMEOUT",
    );
    assert.deepEqual(await postJson(url, {}, { timeoutMs: 10_000, dispatcher: long }), { ok: true });
  } finally {
    globalThis.fetch = oldFetch;
    await short.close();
    await long.close();
    server.close();
  }
});

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

test("R2: an HTTP error from a loopback model server is not retried; remote behavior is unchanged", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "model runner crashed" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  try {
    const error = await postJson(url, {}, { timeoutMs: 5_000 }).then(() => null, (caught: unknown) => caught);
    assert.ok(error instanceof Error);
    const local = classifyModelError(error, { baseUrl: "http://127.0.0.1:11434/v1", timeoutMs: 600_000 });
    assert.ok(local instanceof ProviderError);
    assert.equal((local as ProviderError).retryable, false);
    assert.match(local.message, /500: model runner crashed/);
    for (const baseUrl of ["http://localhost:11434/v1", "http://[::1]:11434/v1"]) {
      assert.equal((classifyModelError(error, { baseUrl, timeoutMs: 600_000 }) as ProviderError).retryable, false, baseUrl);
    }
    assert.equal(classifyModelError(error, { baseUrl: "https://api.openai.com/v1", timeoutMs: 600_000 }), error);
  } finally {
    server.close();
  }
});

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

test("R5: every terminal state (done and failed) gets a run file; non-terminal states do not", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reaper-runs-"));
  try {
    const failed = await runToEnd(workflow(defaultState().graphs[0]), dependencies({
      analyze: async () => { throw new ProviderError("Model server not reachable at http://127.0.0.1:11434/v1.", false); },
    }));
    assert.equal(failed.status, "failed");
    const path = await writeTerminalRunFile(failed, dir);
    assert.equal(path, join(dir, "runs", `${failed.id}.json`));
    assert.equal(JSON.parse(readFileSync(path!, "utf8")).run.status, "failed");
    const done = await runToEnd(workflow(defaultState().graphs[0]));
    assert.ok(await writeTerminalRunFile(done, dir));
    const paused = createRuntimeRun("workflow-1", 1, workflow(defaultState().graphs[0]));
    assert.equal(await writeTerminalRunFile(paused, dir), null);
    assert.equal(await writeTerminalRunFile({ ...paused, status: "running" }, dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
