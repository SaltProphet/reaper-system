import type { NodeDef, Objective } from "../engine.ts";
import type {
  AnalysisResult,
  PortValue,
  RuntimeArtifact,
  RuntimeDependencies,
  SourceRecord,
  ValueType,
} from "./types.ts";

export type ExecutorContext = {
  graphId: string;
  node: NodeDef;
  objective: Objective;
  inputs: Record<string, PortValue>;
  dependencies: RuntimeDependencies;
  limits: { search: number; pages: number; model: number };
};

export type ExecutorOutput = {
  outputs: Record<string, PortValue>;
  artifacts: Omit<RuntimeArtifact, "id" | "graphId" | "nodeId" | "createdAt">[];
  usage?: { search?: number; pages?: number; model?: number };
  /** Extra node-log lines (token counts, rejected source IDs). */
  notes?: string[];
};

export type ExecutorDefinition = {
  id: string;
  label: string;
  kind: NodeDef["kind"];
  inputs: Record<string, ValueType>;
  outputs: Record<string, ValueType>;
  validateConfig: (value: Record<string, unknown>) => string | null;
  run: (context: ExecutorContext) => Promise<ExecutorOutput>;
};

const anyConfig = () => null;

function artifact(port: string, value: PortValue, body: string, sourceIds: string[] = []) {
  return {
    port,
    type: value.type,
    body,
    data: value.value,
    sourceIds,
    status: (value.value == null ? "missing" : "present") as "missing" | "present",
  };
}

function required<T>(inputs: Record<string, PortValue>, port: string, type: ValueType): T {
  const value = inputs[port];
  if (!value || value.type !== type) throw new Error(`Missing ${type} input on ${port}.`);
  return value.value as T;
}

const objective: ExecutorDefinition = {
  id: "builtin.objective",
  label: "Objective",
  kind: "human",
  inputs: {},
  outputs: { objective: "objective" },
  validateConfig: anyConfig,
  async run({ objective: value }) {
    const out: PortValue<Objective> = { type: "objective", value };
    return { outputs: { objective: out }, artifacts: [artifact("objective", out, value.goal)] };
  },
};

const research: ExecutorDefinition = {
  id: "builtin.research",
  label: "Research",
  kind: "tool",
  inputs: { objective: "objective" },
  outputs: { sources: "sources" },
  validateConfig: anyConfig,
  async run({ inputs, dependencies, limits }) {
    if (limits.search < 1) throw new Error("Research call cap exhausted.");
    const value = required<Objective>(inputs, "objective", "objective");
    const sources = await dependencies.research(value.goal, Math.min(5, limits.pages));
    if (sources.length === 0) throw new Error("Research returned no source records.");
    const out: PortValue<SourceRecord[]> = { type: "sources", value: sources };
    return {
      outputs: { sources: out },
      artifacts: [artifact("sources", out, `${sources.length} source records retrieved.`, sources.map((s) => s.id))],
      usage: { search: 1, pages: sources.length },
    };
  },
};

const analysis: ExecutorDefinition = {
  id: "builtin.analysis",
  label: "Analysis",
  kind: "agent",
  inputs: { objective: "objective", sources: "sources" },
  outputs: { analysis: "analysis" },
  validateConfig: anyConfig,
  async run({ inputs, objective: fallback, dependencies, limits }) {
    if (limits.model < 1) throw new Error("Model call cap exhausted.");
    const objectiveValue = (inputs.objective?.value as Objective | undefined) ?? fallback;
    const sources = required<SourceRecord[]>(inputs, "sources", "sources");
    const result = await dependencies.analyze(objectiveValue, sources);
    const validIds = new Set(sources.map((source) => source.id));
    const checked: AnalysisResult = {
      ...result,
      claims: result.claims.map((claim) => ({
        ...claim,
        sourceIds: [...new Set(claim.sourceIds)],
        supported: claim.sourceIds.length > 0 && claim.sourceIds.every((id) => validIds.has(id)),
      })),
    };
    const out: PortValue<AnalysisResult> = { type: "analysis", value: checked };
    const notes: string[] = [];
    if (result.tokens) notes.push(`Model tokens: input ${result.tokens.input ?? "?"}, output ${result.tokens.output ?? "?"}.`);
    // R3: logged verbatim (JSON-quoted, never normalized) so a look-alike ID is visible as-is.
    const rejected = [...new Set(result.claims.flatMap((claim) => claim.sourceIds).filter((id) => !validIds.has(id)))];
    if (rejected.length) notes.push(`Rejected source IDs (not in this run): ${rejected.map((id) => JSON.stringify(id)).join(", ")}.`);
    return {
      outputs: { analysis: out },
      ...(notes.length ? { notes } : {}),
      artifacts: [artifact("analysis", out, checked.summary, checked.claims.flatMap((claim) => claim.sourceIds))],
      usage: { model: 1 },
    };
  },
};

function parseConditionConfig(value: Record<string, unknown>) {
  const path = typeof value.path === "string" && value.path.trim() ? value.path : "claims.0.supported";
  const operator = value.operator === "exists" ? "exists" as const : "equals" as const;
  return { path, operator, value: value.value ?? true };
}

function validateConditionConfig(value: Record<string, unknown>): string | null {
  return value.path !== undefined && (typeof value.path !== "string" || !value.path.trim())
    ? "Condition path must be a non-empty string."
    : null;
}

function pathValue(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (Array.isArray(current) && /^\d+$/.test(key)) return current[Number(key)];
    if (current && typeof current === "object") return (current as Record<string, unknown>)[key];
    return undefined;
  }, value);
}

const condition: ExecutorDefinition = {
  id: "builtin.condition",
  label: "Condition",
  kind: "tool",
  inputs: { analysis: "analysis" },
  outputs: { analysis: "analysis", matched: "boolean" },
  validateConfig: validateConditionConfig,
  async run({ inputs, node }) {
    const config = parseConditionConfig(node.config ?? {});
    const input = inputs.analysis;
    if (!input) throw new Error("Condition requires a value input.");
    const actual = pathValue(input.value, config.path);
    const matched = config.operator === "exists" ? actual !== undefined && actual !== null : actual === config.value;
    const out: PortValue<boolean> = { type: "boolean", value: matched };
    return {
      outputs: { analysis: input, matched: out },
      artifacts: [artifact("matched", out, `Rule ${matched ? "matched" : "did not match"}.`)],
    };
  },
};

const record: ExecutorDefinition = {
  id: "builtin.record",
  label: "Record",
  kind: "tool",
  inputs: { analysis: "analysis" },
  outputs: { record: "record" },
  validateConfig: anyConfig,
  async run({ inputs }) {
    const value = required<AnalysisResult>(inputs, "analysis", "analysis");
    const recordValue = {
      summary: value.summary,
      supportedClaims: value.claims.filter((claim) => claim.supported),
      unsupportedClaims: value.claims.filter((claim) => !claim.supported),
      limitations: value.limitations,
    };
    const out: PortValue<typeof recordValue> = { type: "record", value: recordValue };
    return { outputs: { record: out }, artifacts: [artifact("record", out, value.summary, value.claims.flatMap((c) => c.sourceIds))] };
  },
};

export const EXECUTORS = [objective, research, analysis, condition, record] as const;
const registry = new Map<string, ExecutorDefinition>(EXECUTORS.map((executor) => [executor.id, executor]));

export function getExecutor(id: string): ExecutorDefinition | undefined {
  return registry.get(id);
}

export function validateNodeContract(node: NodeDef, executor = getExecutor(node.implId)): string | null {
  if (!executor) return `No executor registered for ${node.implId}.`;
  const inputNames = Object.keys(executor.inputs);
  const outputNames = Object.keys(executor.outputs);
  if (node.inputs.join("|") !== inputNames.join("|") || node.outputs.join("|") !== outputNames.join("|")) {
    return `${node.name} ports do not match ${executor.label}.`;
  }
  return executor.validateConfig(node.config ?? {});
}
