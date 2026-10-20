export const MAX_DEPTH = 4;
export const STEP_BUDGET = 24;
const STORE_KEY = "reaper-workbench-v1";

export type Kind = "agent" | "tool" | "human" | "framework";
export type EvidenceStatus = "present" | "missing";

export type NodeDef = {
  id: string;
  name: string;
  kind: Kind;
  implId: string;
  inputs: string[];
  outputs: string[];
  childGraphId?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
};

export type Edge = { id: string; from: string; to: string };

export type Graph = {
  id: string;
  name: string;
  nodes: NodeDef[];
  edges?: Edge[];
};

export type ImplSpec = {
  id: string;
  label: string;
  kind: Kind;
  inputs: string[];
  outputs: string[];
  does: string;
  childGraphId?: string;
};

export type Artifact = {
  id: string;
  graphId: string;
  nodeId: string;
  port: string;
  body: string;
  status: EvidenceStatus;
};

export type LogLine = {
  t: string;
  level: "system" | "module" | "error" | "child";
  text: string;
};

export type Frame = { graphId: string; index: number; depth: number };

export type Run = {
  id: string;
  rootGraphId: string;
  status: "running" | "paused" | "done" | "failed";
  budgetLeft: number;
  stack: Frame[];
  artifacts: Artifact[];
  log: LogLine[];
  error?: string;
  updatedAt: string;
};

export type Objective = {
  goal: string;
  constraints: string;
  doneWhen: string;
};

export type Persisted = {
  objective: Objective;
  graphs: Graph[];
  runs: Run[];
  activeRunId: string | null;
  layout?: number;
};

const LAYOUT = 2;

export const POLICIES = [
  "No evidence, no factual claim.",
  "No decision without prioritization.",
  "No cycle without recordkeeping.",
  "No external post from the engine.",
  `Depth limit ${MAX_DEPTH}. Step budget ${STEP_BUDGET}.`,
];

export const IMPLS: ImplSpec[] = [
  {
    id: "reaper.decision-deck",
    label: "Decision Deck",
    kind: "framework",
    inputs: ["sources"],
    outputs: ["record"],
    does: "Run the six-stage decision deck and return one record.",
    childGraphId: "decision-deck",
  },
  {
    id: "reaper.compact",
    label: "Compact pass",
    kind: "framework",
    inputs: ["sources"],
    outputs: ["record"],
    does: "Return one record in a single pass. Same ports as the deck.",
  },
  {
    id: "reaper.bad-ports",
    label: "Bad ports",
    kind: "framework",
    inputs: ["sources", "budget"],
    outputs: ["record"],
    does: "Asks for a budget input this box does not have.",
  },
];

const same = (a: string[], b: string[]) => a.join("|") === b.join("|");

export function portsMatch(node: NodeDef, impl: ImplSpec) {
  return node.kind === impl.kind && same(node.inputs, impl.inputs) && same(node.outputs, impl.outputs);
}

export function layoutGraph(graph: Graph): Graph {
  const count = graph.nodes.length;
  const nodes = graph.nodes.map((node, index) => ({
    ...node,
    x: typeof node.x === "number" ? node.x : count <= 4 ? 24 + index * 220 : 32 + (index % 3) * 250,
    y: typeof node.y === "number" ? node.y : count <= 4 ? 64 : 48 + Math.floor(index / 3) * 160,
  }));
  const edges =
    graph.edges && graph.edges.length > 0
      ? graph.edges
      : nodes.slice(1).map((node, index) => ({
          id: `${nodes[index].id}>${node.id}`,
          from: nodes[index].id,
          to: node.id,
        }));
  return { ...graph, nodes, edges };
}

export function orderedNodes(graph: Graph): NodeDef[] | null {
  const edges = graph.edges ?? [];
  const incoming = new Map(graph.nodes.map((node) => [node.id, 0]));
  const next = new Map<string, string[]>();
  for (const edge of edges) {
    if (!incoming.has(edge.to) || !incoming.has(edge.from)) return null;
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    next.set(edge.from, [...(next.get(edge.from) ?? []), edge.to]);
  }
  const queue = graph.nodes.filter((node) => incoming.get(node.id) === 0);
  const ordered: NodeDef[] = [];
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) break;
    ordered.push(node);
    for (const id of next.get(node.id) ?? []) {
      const count = (incoming.get(id) ?? 1) - 1;
      incoming.set(id, count);
      if (count === 0) {
        const found = byId.get(id);
        if (found) queue.push(found);
      }
    }
  }
  return ordered.length === graph.nodes.length ? ordered : null;
}

function replaceGraph(state: Persisted, graph: Graph): Persisted {
  return { ...state, graphs: state.graphs.map((item) => (item.id === graph.id ? graph : item)) };
}

export function resizeNode(
  state: Persisted,
  graphId: string,
  nodeId: string,
  w: number,
  h: number,
): Persisted {
  const graph = state.graphs.find((item) => item.id === graphId);
  if (!graph) return state;
  return replaceGraph(state, {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id === nodeId ? { ...node, w: Math.max(140, Math.round(w)), h: Math.max(72, Math.round(h)) } : node,
    ),
  });
}

export function moveNode(state: Persisted, graphId: string, nodeId: string, x: number, y: number): Persisted {
  const graph = state.graphs.find((item) => item.id === graphId);
  if (!graph) return state;
  return replaceGraph(state, {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id === nodeId ? { ...node, x: Math.max(0, x), y: Math.max(0, y) } : node,
    ),
  });
}

export function connectNodes(
  state: Persisted,
  graphId: string,
  fromId: string,
  toId: string,
): { state: Persisted; error?: string } {
  const graph = state.graphs.find((item) => item.id === graphId);
  const from = graph?.nodes.find((node) => node.id === fromId);
  const to = graph?.nodes.find((node) => node.id === toId);
  if (!graph || !from || !to) return { state, error: "Missing module." };
  if (from.id === to.id) return { state, error: "A module cannot wire to itself." };
  const port = from.outputs[0];
  if (!port || (to.inputs.length > 0 && !to.inputs.includes(port))) {
    return { state, error: `${from.name} output [${port ?? "none"}] does not match ${to.name}.` };
  }
  if (graph.edges?.some((edge) => edge.from === from.id && edge.to === to.id)) {
    return { state, error: "That wire already exists." };
  }
  const edges = [...(graph.edges ?? []), { id: `${from.id}>${to.id}`, from: from.id, to: to.id }];
  if (!orderedNodes({ ...graph, edges })) {
    return { state, error: "Wire rejected. It would cycle." };
  }
  return {
    state: appendLog(replaceGraph(state, { ...graph, edges }), "system", `Wired ${from.name} → ${to.name} on ${port}.`),
  };
}

export function cutIncoming(state: Persisted, graphId: string, nodeId: string): Persisted {
  const graph = state.graphs.find((item) => item.id === graphId);
  if (!graph) return state;
  return replaceGraph(state, {
    ...graph,
    edges: (graph.edges ?? []).filter((edge) => edge.to !== nodeId),
  });
}

function nowStamp() {
  return new Date().toISOString().slice(11, 19);
}

function rid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultState(): Persisted {
  return {
    objective: {
      goal: "Be known for reliable workflow rescue under the real name Justin Strange.",
      constraints: "Real name. Blunt, non-corporate voice. Low daily posting cost.",
      doneWhen: "One primary action is chosen and a record exists. Nothing is posted.",
    },
    graphs: [
      layoutGraph({
        id: "workbench",
        name: "Workbench",
        nodes: [
          {
            id: "objective",
            name: "Objective",
            kind: "human",
            implId: "human.objective",
            inputs: [],
            outputs: ["objective"],
          },
          {
            id: "research",
            name: "Research",
            kind: "tool",
            implId: "tool.research",
            inputs: ["objective"],
            outputs: ["sources"],
          },
          {
            id: "child",
            name: "Child REAPER",
            kind: "framework",
            implId: "reaper.decision-deck",
            inputs: ["sources"],
            outputs: ["record"],
            childGraphId: "decision-deck",
          },
          {
            id: "results",
            name: "Results",
            kind: "agent",
            implId: "agent.results",
            inputs: ["record"],
            outputs: ["report"],
          },
        ],
      }),
      layoutGraph({
        id: "decision-deck",
        name: "Decision Deck",
        nodes: [
          ["research", "Research", "tool"],
          ["evidence", "Evidence", "tool"],
          ["analysis", "Analysis", "agent"],
          ["prioritization", "Prioritization", "agent"],
          ["execution", "Execution", "human"],
          ["recordkeeping", "Recordkeeping", "tool"],
        ].map(([id, name, kind]) => ({
          id,
          name,
          kind: kind as Kind,
          implId: `stage.${id}`,
          inputs: ["packet"],
          outputs: ["packet"],
        })),
      }),
    ],
    runs: [],
    activeRunId: null,
    layout: LAYOUT,
  };
}

export function loadState(): Persisted {
  if (typeof window === "undefined") return defaultState();
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Persisted;
    if (!parsed.graphs?.length || !parsed.objective) return defaultState();
    const graphs =
      parsed.layout === LAYOUT
        ? parsed.graphs
        : parsed.graphs.map((graph) => ({
            ...graph,
            nodes: graph.nodes.map(({ x: _x, y: _y, ...node }) => node),
          }));
    return { ...parsed, layout: LAYOUT, graphs: graphs.map(layoutGraph) };
  } catch {
    return defaultState();
  }
}

export function saveState(state: Persisted) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

function line(level: LogLine["level"], text: string): LogLine {
  return { t: nowStamp(), level, text };
}

function graphOf(state: Persisted, id: string) {
  const graph = state.graphs.find((g) => g.id === id);
  if (!graph) throw new Error(`Missing graph ${id}`);
  return graph;
}

export function swapImpl(
  state: Persisted,
  graphId: string,
  nodeId: string,
  implId: string,
): { state: Persisted; error?: string } {
  const impl = IMPLS.find((item) => item.id === implId);
  const graph = state.graphs.find((g) => g.id === graphId);
  const node = graph?.nodes.find((n) => n.id === nodeId);
  if (!impl || !graph || !node) {
    return { state, error: "Module or implementation not found." };
  }
  if (!portsMatch(node, impl)) {
    return {
      state: appendLog(state, "error", `Swap rejected. ${impl.label} ports do not match ${node.name}.`),
      error: `${impl.label} is incompatible. Inputs [${impl.inputs.join(", ")}] vs [${node.inputs.join(", ")}].`,
    };
  }
  const next: Persisted = {
    ...state,
    graphs: state.graphs.map((g) =>
      g.id !== graphId
        ? g
        : {
            ...g,
            nodes: g.nodes.map((n) =>
              n.id !== nodeId
                ? n
                : { ...n, implId: impl.id, childGraphId: impl.childGraphId },
            ),
          },
    ),
  };
  return {
    state: appendLog(next, "system", `Swapped ${node.name} to ${impl.label}. Parent edges unchanged.`),
  };
}

function appendLog(state: Persisted, level: LogLine["level"], text: string): Persisted {
  const run = active(state);
  if (!run) {
    const idle: Run = {
      id: "idle",
      rootGraphId: "workbench",
      status: "paused",
      budgetLeft: STEP_BUDGET,
      stack: [],
      artifacts: [],
      log: [line(level, text)],
      updatedAt: new Date().toISOString(),
    };
    return { ...state, runs: [idle, ...state.runs].slice(0, 8), activeRunId: "idle" };
  }
  return updateRun(state, { ...run, log: [...run.log, line(level, text)] });
}

function active(state: Persisted) {
  return state.runs.find((run) => run.id === state.activeRunId) ?? null;
}

function updateRun(state: Persisted, run: Run): Persisted {
  return {
    ...state,
    activeRunId: run.id,
    runs: [run, ...state.runs.filter((item) => item.id !== run.id)].slice(0, 8),
  };
}

export function startRun(state: Persisted, rootGraphId: string): Persisted {
  const graph = graphOf(state, rootGraphId);
  const run: Run = {
    id: rid("run"),
    rootGraphId,
    status: "running",
    budgetLeft: STEP_BUDGET,
    stack: [{ graphId: rootGraphId, index: 0, depth: 1 }],
    artifacts: [],
    log: [
      line("system", `Run armed on ${graph.name}.`),
      line("system", `${graph.nodes.length} modules. Budget ${STEP_BUDGET}. Depth cap ${MAX_DEPTH}.`),
    ],
    updatedAt: new Date().toISOString(),
  };
  return updateRun(state, run);
}

export function setStatus(state: Persisted, status: Run["status"]): Persisted {
  const run = active(state);
  if (!run || run.status === "done" || run.status === "failed") return state;
  return updateRun(state, {
    ...run,
    status,
    log: [...run.log, line("system", status === "paused" ? "Paused." : "Resumed.")],
    updatedAt: new Date().toISOString(),
  });
}

function bodyFor(node: NodeDef, objective: Objective, prior: Artifact[]): { body: string; status: EvidenceStatus } {
  if (node.implId === "human.objective") {
    return {
      status: "present",
      body: `Goal: ${objective.goal}\nConstraints: ${objective.constraints}\nDone when: ${objective.doneWhen}`,
    };
  }
  if (node.implId === "tool.research") {
    return {
      status: "present",
      body: "SRC-001 ownership gap in broken automations.\nSRC-002 real-name blunt posting is possible on X.\nSRC-003 audience size: missing.",
    };
  }
  if (node.implId === "reaper.compact") {
    return {
      status: "present",
      body: "Compact implementation. Same ports as Decision Deck.\nPrimary: one diagnosis post. Nothing posted.\nParent graph was not edited.",
    };
  }
  if (node.implId === "agent.results") {
    const record = [...prior].reverse().find((item) => item.port === "record" || item.nodeId === "recordkeeping");
    return {
      status: record ? "present" : "missing",
      body: record
        ? `Report bound to ${record.id}.\n${record.body.split("\n")[0]}`
        : "No record artifact. Report withheld.",
    };
  }
  if (node.implId === "stage.research") {
    return { status: "present", body: "Sources accepted from parent. Pattern: ownership_gap." };
  }
  if (node.implId === "stage.evidence") {
    return {
      status: "present",
      body: "EV-001 present. EV-002 present. EV-003 audience size missing.",
    };
  }
  if (node.implId === "stage.analysis") {
    return {
      status: "present",
      body: "Hypothesis only: workflow rescue is a credible known-for. Not a factual market claim.",
    };
  }
  if (node.implId === "stage.prioritization") {
    return {
      status: "present",
      body: "Rank 1: one public diagnosis post.\nKilled: LinkedIn, daily cadence.",
    };
  }
  if (node.implId === "stage.execution") {
    return {
      status: "present",
      body: "Recommendation only. Engine did not post.",
    };
  }
  if (node.implId === "stage.recordkeeping") {
    return {
      status: "present",
      body: "Record written. Evidence used: EV-001, EV-002. Next cycle needs a post URL.",
    };
  }
  return { status: "missing", body: `No executor for ${node.implId}.` };
}

export function stepRun(state: Persisted): Persisted {
  const run = active(state);
  if (!run || (run.status !== "running" && run.status !== "paused")) return state;
  if (run.budgetLeft <= 0) {
    return updateRun(state, {
      ...run,
      status: "failed",
      error: "Step budget exhausted.",
      log: [...run.log, line("error", "Step budget exhausted. Run halted.")],
      updatedAt: new Date().toISOString(),
    });
  }

  const frame = run.stack[run.stack.length - 1];
  if (!frame) {
    return updateRun(state, {
      ...run,
      status: "done",
      log: [...run.log, line("system", "Run complete.")],
      updatedAt: new Date().toISOString(),
    });
  }

  const graph = graphOf(state, frame.graphId);
  const order = orderedNodes(graph);
  if (!order) {
    return updateRun(state, {
      ...run,
      status: "failed",
      error: "Cycle in graph.",
      log: [...run.log, line("error", `${graph.name} has a cycle. Run halted.`)],
      updatedAt: new Date().toISOString(),
    });
  }
  if (frame.index >= order.length) {
    const parent = run.stack[run.stack.length - 2];
    const log = [...run.log, line("child", `${graph.name} returned to its parent.`)];
    if (!parent) {
      return updateRun(state, {
        ...run,
        status: "done",
        stack: [],
        log: [...log, line("system", "Root graph complete.")],
        updatedAt: new Date().toISOString(),
      });
    }
    const parentGraph = graphOf(state, parent.graphId);
    const parentOrder = orderedNodes(parentGraph);
    const parentNode = parentOrder?.[parent.index];
    const last = run.artifacts.at(-1);
    const bubbled: Artifact | null = parentNode
      ? {
          id: rid("art"),
          graphId: parent.graphId,
          nodeId: parentNode.id,
          port: parentNode.outputs[0] ?? "out",
          body: last?.body ?? "Child returned no artifact.",
          status: last?.status ?? "missing",
        }
      : null;
    return updateRun(state, {
      ...run,
      artifacts: bubbled ? [...run.artifacts, bubbled] : run.artifacts,
      stack: [...run.stack.slice(0, -2), { ...parent, index: parent.index + 1 }],
      log: [
        ...log,
        line("child", `${parentNode?.name ?? graph.name} emitted ${bubbled?.port ?? "out"} to the parent.`),
      ],
      updatedAt: new Date().toISOString(),
    });
  }

  const node = order[frame.index];
  if (node.childGraphId) {
    const depth = frame.depth + 1;
    if (depth > MAX_DEPTH) {
      return updateRun(state, {
        ...run,
        status: "failed",
        error: "Depth limit.",
        log: [...run.log, line("error", `${node.name} refused. Depth ${depth} exceeds ${MAX_DEPTH}.`)],
        updatedAt: new Date().toISOString(),
      });
    }
    return updateRun(state, {
      ...run,
      budgetLeft: run.budgetLeft - 1,
      stack: [...run.stack, { graphId: node.childGraphId, index: 0, depth }],
      log: [
        ...run.log,
        line("child", `Delegating into ${node.name} (${node.implId}) at depth ${depth}.`),
      ],
      updatedAt: new Date().toISOString(),
    });
  }

  const produced = bodyFor(node, state.objective, run.artifacts);
  const artifact: Artifact = {
    id: rid("art"),
    graphId: graph.id,
    nodeId: node.id,
    port: node.outputs[0] ?? "out",
    body: produced.body,
    status: produced.status,
  };
  return updateRun(state, {
    ...run,
    budgetLeft: run.budgetLeft - 1,
    artifacts: [...run.artifacts, artifact],
    stack: [...run.stack.slice(0, -1), { ...frame, index: frame.index + 1 }],
    log: [
      ...run.log,
      line("module", `${graph.name} / ${node.name} → ${artifact.port} (${artifact.status}).`),
    ],
    updatedAt: new Date().toISOString(),
  });
}

export function currentNode(state: Persisted) {
  const run = active(state);
  const frame = run?.stack[run.stack.length - 1];
  if (!run || !frame) return null;
  const graph = state.graphs.find((g) => g.id === frame.graphId);
  const order = graph ? orderedNodes(graph) : null;
  return order?.[frame.index] ?? null;
}
