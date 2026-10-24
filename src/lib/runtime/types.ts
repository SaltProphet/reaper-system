import type { Graph, Objective } from "../engine.ts";

export type ValueType = "objective" | "sources" | "analysis" | "boolean" | "record" | "text";

export type PortValue<T = unknown> = {
  type: ValueType;
  value: T;
};

export type SourceRecord = {
  id: string;
  url: string;
  title: string;
  retrievedAt: string;
  content: string;
};

export type AnalysisClaim = {
  text: string;
  sourceIds: string[];
  supported: boolean;
};

export type AnalysisResult = {
  summary: string;
  claims: AnalysisClaim[];
  limitations: string[];
  model: string;
};

export type RuntimeArtifact = {
  id: string;
  graphId: string;
  nodeId: string;
  port: string;
  type: ValueType;
  body: string;
  data: unknown;
  sourceIds: string[];
  status: "present" | "missing";
  createdAt: string;
};

export type RuntimeLog = {
  t: string;
  level: "system" | "module" | "error" | "child";
  text: string;
};

export type NodeExecution = {
  status: "pending" | "running" | "succeeded" | "failed" | "skipped";
  attempts: number;
  error?: string;
};

export type RuntimeFrame = {
  graphId: string;
  index: number;
  depth: number;
  parentNodeId?: string;
  inputs?: Record<string, PortValue>;
};

export type RunCaps = {
  searchCallsLeft: number;
  sourcePagesLeft: number;
  modelCallsLeft: number;
};

export type RuntimeRun = {
  id: string;
  workflowId: string;
  workflowVersion: number;
  rootGraphId: string;
  status: "running" | "paused" | "done" | "failed";
  version: number;
  budgetLeft: number;
  stack: RuntimeFrame[];
  values: Record<string, PortValue>;
  nodes: Record<string, NodeExecution>;
  artifacts: RuntimeArtifact[];
  log: RuntimeLog[];
  caps: RunCaps;
  error?: string;
  updatedAt: string;
};

export type WorkflowDefinition = {
  schemaVersion: 1;
  objective: Objective;
  graphs: Graph[];
};

export type StoredWorkflow = {
  id: string;
  name: string;
  version: number;
  definition: WorkflowDefinition;
  createdAt: string;
  updatedAt: string;
};

export type ResearchProvider = (query: string, limit: number) => Promise<SourceRecord[]>;
export type AnalysisProvider = (objective: Objective, sources: SourceRecord[]) => Promise<AnalysisResult>;

export type RuntimeDependencies = {
  research: ResearchProvider;
  analyze: AnalysisProvider;
  now?: () => string;
  id?: (prefix: string) => string;
};
