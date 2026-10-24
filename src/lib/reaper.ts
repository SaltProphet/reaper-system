export const STAGES = [
  "Research",
  "Evidence",
  "Analysis",
  "Prioritization",
  "Execution",
  "Recordkeeping",
] as const;

export type StageName = (typeof STAGES)[number];
export type StageStatus = "idle" | "running" | "complete";

export const OBJECTS = [
  "Personal Objective",
  "Source Records",
  "Evidence Objects",
  "Candidate Findings",
  "Strategy Decision",
  "Action Records",
  "Measurement Evidence",
] as const;

export type ObjectName = (typeof OBJECTS)[number];

export const DEFAULT_OBJECTIVE =
  "Be known for reliable workflow rescue in technical services. Constraints: blunt non-corporate voice, low daily posting cost.";

export type StagePayload = {
  title: string;
  body: string;
};

export function buildCycle(objective: string): Record<StageName, StagePayload> {
  const short =
    objective.trim().slice(0, 140) || "Unspecified personal-brand objective";

  const unavailable =
    "Legacy console simulation removed. Run this stage through the authenticated workbench to produce a durable, provider-backed artifact.";

  return {
    Research: {
      title: "Research requires a live run",
      body: `${unavailable}\nObjective: ${short}`,
    },
    Evidence: {
      title: "No retrieved evidence",
      body: unavailable,
    },
    Analysis: {
      title: "No model analysis",
      body: unavailable,
    },
    Prioritization: {
      title: "No ranked result",
      body: unavailable,
    },
    Execution: {
      title: "No execution result",
      body: unavailable,
    },
    Recordkeeping: {
      title: "No durable record",
      body: unavailable,
    },
  };
}

export function objectIndexForStage(stageIndex: number): number {
  return Math.min(stageIndex + 1, OBJECTS.length - 1);
}

