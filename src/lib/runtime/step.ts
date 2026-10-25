import { MAX_DEPTH, STEP_BUDGET, orderedNodes, type Edge, type Graph, type NodeDef } from "../engine.ts";
import { getExecutor, validateNodeContract } from "./registry.ts";
import type { PortValue, RuntimeDependencies, RuntimeFrame, RuntimeRun, WorkflowDefinition } from "./types.ts";

const iso = () => new Date().toISOString();
const randomId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const keyOf = (graphId: string, nodeId: string, port: string) => `${graphId}:${nodeId}:${port}`;
const nodeKey = (graphId: string, nodeId: string) => `${graphId}:${nodeId}`;

function graphOf(workflow: WorkflowDefinition, id: string): Graph {
  const graph = workflow.graphs.find((candidate) => candidate.id === id);
  if (!graph) throw new Error(`Missing graph ${id}.`);
  return graph;
}

function fail(run: RuntimeRun, message: string): RuntimeRun {
  return {
    ...run,
    status: "failed",
    error: message,
    log: [...run.log, { t: iso(), level: "error", text: message }],
    updatedAt: iso(),
  };
}

export function createRuntimeRun(
  workflowId: string,
  workflowVersion: number,
  workflow: WorkflowDefinition,
): RuntimeRun {
  const graph = graphOf(workflow, workflow.graphs[0]?.id ?? "workbench");
  return {
    id: randomId("run"),
    workflowId,
    workflowVersion,
    rootGraphId: graph.id,
    status: "paused",
    version: 1,
    budgetLeft: STEP_BUDGET,
    stack: [{ graphId: graph.id, index: 0, depth: 1 }],
    values: {},
    nodes: {},
    artifacts: [],
    log: [{ t: iso(), level: "system", text: `Run created on ${graph.name}. Budget ${STEP_BUDGET}.` }],
    caps: { searchCallsLeft: 1, sourcePagesLeft: 5, modelCallsLeft: 1 },
    updatedAt: iso(),
  };
}

export function validateWorkflowDefinition(workflow: WorkflowDefinition): string[] {
  const errors: string[] = [];
  if (workflow.schemaVersion !== 1) errors.push("Unsupported workflow schema version.");
  if (!workflow.graphs.length) errors.push("A workflow requires at least one graph.");
  const graphIds = new Set<string>();
  for (const graph of workflow.graphs) {
    if (graphIds.has(graph.id)) errors.push(`Duplicate graph id ${graph.id}.`);
    graphIds.add(graph.id);
    if (!orderedNodes(graph)) errors.push(`${graph.name} contains a cycle or invalid edge.`);
    const nodeIds = new Set<string>();
    for (const node of graph.nodes) {
      if (nodeIds.has(node.id)) errors.push(`${graph.name} has duplicate node id ${node.id}.`);
      nodeIds.add(node.id);
      if (node.childGraphId) {
        if (!workflow.graphs.some((candidate) => candidate.id === node.childGraphId)) {
          errors.push(`${node.name} references missing graph ${node.childGraphId}.`);
        }
      } else {
        const error = validateNodeContract(node);
        if (error) errors.push(error);
      }
    }
    for (const edge of graph.edges ?? []) {
      const from = graph.nodes.find((node) => node.id === edge.from);
      const to = graph.nodes.find((node) => node.id === edge.to);
      if (!from || !to) continue;
      const fromPort = edge.fromPort ?? from.outputs[0];
      const toPort = edge.toPort ?? to.inputs.find((name) => name === fromPort) ?? to.inputs[0];
      if (fromPort && !from.outputs.includes(fromPort)) errors.push(`${edge.id} uses a missing source port.`);
      if (toPort && toPort !== "__control" && !to.inputs.includes(toPort)) errors.push(`${edge.id} uses a missing target port.`);
      if (!from.childGraphId && !to.childGraphId && fromPort && toPort && toPort !== "__control") {
        const fromType = getExecutor(from.implId)?.outputs[fromPort];
        const toType = getExecutor(to.implId)?.inputs[toPort];
        if (fromType && toType && fromType !== toType) errors.push(`${edge.id} routes ${fromType} into ${toType}.`);
      }
    }
  }
  return [...new Set(errors)];
}

function incoming(graph: Graph, node: NodeDef): Edge[] {
  return (graph.edges ?? []).filter((edge) => edge.to === node.id);
}

function outputForEdge(run: RuntimeRun, graph: Graph, edge: Edge): PortValue | undefined {
  const source = graph.nodes.find((node) => node.id === edge.from);
  if (!source) return undefined;
  return run.values[keyOf(graph.id, source.id, edge.fromPort ?? source.outputs[0] ?? "out")];
}

function selectedByBranch(run: RuntimeRun, graph: Graph, edge: Edge): boolean {
  if (edge.branch === undefined) return true;
  const source = graph.nodes.find((node) => node.id === edge.from);
  const value = source ? run.values[keyOf(graph.id, source.id, "matched")] : undefined;
  return value?.type === "boolean" && value.value === edge.branch;
}

function inputsFor(run: RuntimeRun, graph: Graph, node: NodeDef, frame: RuntimeFrame): Record<string, PortValue> {
  const result = { ...(frame.inputs ?? {}) };
  for (const edge of incoming(graph, node)) {
    if (!selectedByBranch(run, graph, edge)) continue;
    const source = graph.nodes.find((candidate) => candidate.id === edge.from);
    const value = outputForEdge(run, graph, edge);
    const port = edge.toPort ?? node.inputs.find((name) => name === source?.outputs[0]) ?? node.inputs[0];
    if (port && value) result[port] = value;
  }
  return result;
}

function shouldSkip(run: RuntimeRun, graph: Graph, node: NodeDef): boolean {
  const edges = incoming(graph, node);
  if (edges.length === 0) return false;
  const branchEdges = edges.filter((edge) => edge.branch !== undefined);
  if (branchEdges.length > 0 && !branchEdges.some((edge) => selectedByBranch(run, graph, edge))) return true;
  return edges.every((edge) => run.nodes[nodeKey(graph.id, edge.from)]?.status === "skipped");
}

function transient(error: unknown): boolean {
  if (error && typeof error === "object" && typeof (error as { retryable?: unknown }).retryable === "boolean") {
    return (error as { retryable: boolean }).retryable;
  }
  if (!(error instanceof Error)) return false;
  return /\b(408|409|425|429|500|502|503|504|timeout|temporar|rate limit|network)\b/i.test(error.message);
}

async function executeWithRetry<T>(action: () => Promise<T>, onRetry: () => void): Promise<{ value: T; attempts: number }> {
  try {
    return { value: await action(), attempts: 1 };
  } catch (error) {
    if (!transient(error)) throw error;
    onRetry();
    return { value: await action(), attempts: 2 };
  }
}

function completeFrame(run: RuntimeRun, workflow: WorkflowDefinition, frame: RuntimeFrame): RuntimeRun {
  const graph = graphOf(workflow, frame.graphId);
  const parent = run.stack.at(-2);
  if (!parent) {
    return {
      ...run,
      status: "done",
      stack: [],
      log: [...run.log, { t: iso(), level: "system", text: "Root graph complete." }],
      updatedAt: iso(),
    };
  }
  const parentGraph = graphOf(workflow, parent.graphId);
  const parentNode = orderedNodes(parentGraph)?.[parent.index];
  if (!parentNode) return fail(run, "Nested workflow lost its parent node.");
  const lastNode = orderedNodes(graph)?.at(-1);
  const childValue = lastNode
    ? run.values[keyOf(graph.id, lastNode.id, lastNode.outputs[0] ?? "out")]
    : undefined;
  const values = childValue
    ? { ...run.values, [keyOf(parentGraph.id, parentNode.id, parentNode.outputs[0] ?? "out")]: childValue }
    : run.values;
  return {
    ...run,
    values,
    nodes: { ...run.nodes, [nodeKey(parentGraph.id, parentNode.id)]: { status: "succeeded", attempts: 1 } },
    stack: [...run.stack.slice(0, -2), { ...parent, index: parent.index + 1 }],
    log: [...run.log, { t: iso(), level: "child", text: `${graph.name} returned to ${parentNode.name}.` }],
    updatedAt: iso(),
  };
}

export async function stepRuntime(
  workflow: WorkflowDefinition,
  current: RuntimeRun,
  dependencies: RuntimeDependencies,
): Promise<RuntimeRun> {
  const run = { ...current, status: "running" as const, error: undefined };
  if (run.budgetLeft <= 0) return fail(run, "Step budget exhausted.");
  const frame = run.stack.at(-1);
  if (!frame) return { ...run, status: "done", updatedAt: iso() };
  const graph = graphOf(workflow, frame.graphId);
  const order = orderedNodes(graph);
  if (!order) return fail(run, `${graph.name} contains a cycle.`);
  if (frame.index >= order.length) return completeFrame(run, workflow, frame);

  const node = order[frame.index];
  const stateKey = nodeKey(graph.id, node.id);
  if (shouldSkip(run, graph, node)) {
    return {
      ...run,
      budgetLeft: run.budgetLeft - 1,
      nodes: { ...run.nodes, [stateKey]: { status: "skipped", attempts: 0 } },
      stack: [...run.stack.slice(0, -1), { ...frame, index: frame.index + 1 }],
      log: [...run.log, { t: iso(), level: "module", text: `${graph.name} / ${node.name} skipped by rule.` }],
      updatedAt: iso(),
    };
  }

  const inputs = inputsFor(run, graph, node, frame);
  if (node.childGraphId) {
    const depth = frame.depth + 1;
    if (depth > MAX_DEPTH) return fail(run, `${node.name} exceeds depth limit ${MAX_DEPTH}.`);
    return {
      ...run,
      budgetLeft: run.budgetLeft - 1,
      nodes: { ...run.nodes, [stateKey]: { status: "running", attempts: 1 } },
      stack: [...run.stack, { graphId: node.childGraphId, index: 0, depth, parentNodeId: node.id, inputs }],
      log: [...run.log, { t: iso(), level: "child", text: `Delegating into ${node.name} at depth ${depth}.` }],
      updatedAt: iso(),
    };
  }

  const executor = getExecutor(node.implId);
  const contractError = validateNodeContract(node, executor);
  if (contractError || !executor) return fail(run, contractError ?? `Missing executor ${node.implId}.`);
  let retryLogged = false;
  try {
    const { value: result, attempts } = await executeWithRetry(
      () => executor.run({
        graphId: graph.id,
        node,
        objective: workflow.objective,
        inputs,
        dependencies,
        limits: {
          search: run.caps.searchCallsLeft,
          pages: run.caps.sourcePagesLeft,
          model: run.caps.modelCallsLeft,
        },
      }),
      () => { retryLogged = true; },
    );
    const now = dependencies.now?.() ?? iso();
    const values = { ...run.values };
    for (const [port, value] of Object.entries(result.outputs)) values[keyOf(graph.id, node.id, port)] = value;
    const artifacts = result.artifacts.map((item) => ({
      ...item,
      id: dependencies.id?.("artifact") ?? randomId("artifact"),
      graphId: graph.id,
      nodeId: node.id,
      createdAt: now,
    }));
    return {
      ...run,
      budgetLeft: run.budgetLeft - 1,
      values,
      artifacts: [...run.artifacts, ...artifacts],
      caps: {
        searchCallsLeft: run.caps.searchCallsLeft - (result.usage?.search ?? 0),
        sourcePagesLeft: run.caps.sourcePagesLeft - (result.usage?.pages ?? 0),
        modelCallsLeft: run.caps.modelCallsLeft - (result.usage?.model ?? 0),
      },
      nodes: { ...run.nodes, [stateKey]: { status: "succeeded", attempts } },
      stack: [...run.stack.slice(0, -1), { ...frame, index: frame.index + 1 }],
      log: [
        ...run.log,
        ...(retryLogged ? [{ t: now, level: "system" as const, text: `${node.name} retried after a transient failure.` }] : []),
        { t: now, level: "module", text: `${graph.name} / ${node.name} produced ${Object.keys(result.outputs).join(", ")}.` },
        ...(result.notes ?? []).map((note) => ({ t: now, level: "module" as const, text: `${graph.name} / ${node.name}: ${note}` })),
      ],
      updatedAt: now,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Executor failed.";
    const failed = fail(run, `${node.name}: ${message}`);
    return { ...failed, nodes: { ...failed.nodes, [stateKey]: { status: "failed", attempts: retryLogged ? 2 : 1, error: message } } };
  }
}
