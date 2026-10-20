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

  return {
    Research: {
      title: "Source records",
      body: `SRC-001  public complaint — "Spent three days debugging a broken n8n + CRM flow. No one owns the failure."\nSRC-002  platform note — X accepts blunt posts and has a discovery feed.\nSRC-003  account snapshot — a public profile with no recent detectable posts.\nSRC-004  constraint sheet — objective locked: ${short}`,
    },
    Evidence: {
      title: "Traceable evidence",
      body: `EV-001  ownership_gap  status: present\n  "No one owns the failure."  ← SRC-001\nEV-002  constraint_fit  status: present\n  X supports real-name, non-corporate posts.  ← SRC-002\nEV-003  low_activity  status: present\n  No recent public posts returned.  ← SRC-003\nEV-004  audience_size  status: missing\n  No source states a market size.`,
    },
    Analysis: {
      title: "Hypotheses only",
      body: `CF-001  Operators need someone to own a broken automation.\n  Hypothesis: "workflow rescue" is a credible known-for for boutique technical services.\n  Supporting: EV-001, EV-002\n  Validation: Do buyers search this phrase? Is there a public willingness-to-pay quote?\n  Missing: pricing quotes, repeat purchase, post engagement.`,
    },
    Prioritization: {
      title: "Ranked options",
      body: `1. One public failure-diagnosis post on X.\n   evidence × ability to act × constraint fit\n2. Mirror the same piece on a personal site for persistence.\nKilled: LinkedIn (voice mismatch).\nKilled: daily posting calendar (cost constraint).\nKilled: multi-platform launch (no baseline).`,
    },
    Execution: {
      title: "One primary action",
      body: `Primary: publish one diagnosis thread on X today.\nSecondary: mirror it for persistence.\nDo not open new platforms until the post produces any signal.\nGate: this console records the action. It does not post for you.`,
    },
    Recordkeeping: {
      title: "Cycle record",
      body: `Decision: one X diagnosis post.\nEvidence used: EV-001, EV-002, EV-003.\nRejected: LinkedIn, daily cadence, multi-platform.\nResult: pending — no post URL yet.\nNext cycle source: post URL + initial metrics.`,
    },
  };
}

export function objectIndexForStage(stageIndex: number): number {
  return Math.min(stageIndex + 1, OBJECTS.length - 1);
}
