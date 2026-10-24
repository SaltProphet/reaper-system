import assert from "node:assert/strict";
import test from "node:test";
import { connectNodes, defaultState, orderedNodes, type Graph } from "../engine.ts";
import { EXECUTORS, getExecutor } from "./registry.ts";
import { createRuntimeRun, stepRuntime, validateWorkflowDefinition } from "./step.ts";
import { createProviderDependencies } from "./providers.server.ts";
import type { RuntimeDependencies, WorkflowDefinition } from "./types.ts";

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
  let request = 0;
  globalThis.fetch = async () => {
    request += 1;
    if (request === 1) {
      return new Response(JSON.stringify({ data: { web: [{ url: source.url, title: source.title, markdown: source.content }] } }), { status: 200 });
    }
    return new Response(JSON.stringify({
      output_text: JSON.stringify({ summary: "Structured", claims: [{ text: "Claim", sourceIds: ["SRC-001"] }], limitations: [] }),
    }), { status: 200 });
  };
  try {
    const providers = createProviderDependencies();
    const sources = await providers.research("query", 5);
    assert.equal(sources[0].id, "SRC-001");
    const result = await providers.analyze(workflow(defaultState().graphs[0]).objective, sources);
    assert.equal(result.summary, "Structured");
    assert.equal(result.model, "gpt-5.4-mini");
  } finally {
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
  globalThis.fetch = async () => new Response(JSON.stringify({ output_text: "not json" }), { status: 200 });
  await assert.rejects(
    () => createProviderDependencies().analyze(workflow(defaultState().graphs[0]).objective, [source]),
    /JSON|malformed/i,
  );
  globalThis.fetch = oldFetch;
  delete process.env.FIRECRAWL_API_KEY;
  delete process.env.OPENAI_API_KEY;
});
