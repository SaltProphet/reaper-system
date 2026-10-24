import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { RuntimeRun, WorkflowDefinition } from "./types";

const workflowInput = (value: {
  id: string;
  name: string;
  expectedVersion: number;
  definition: WorkflowDefinition;
}) => value;

const runInput = (value: { runId: string; expectedVersion: number }) => value;

export const loadWorkspace = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { ensureWorkspace } = await import("./persistence.server");
    return ensureWorkspace(context.userId);
  });

export const persistWorkflow = createServerFn({ method: "POST" })
  .validator(workflowInput)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const { saveWorkflow } = await import("./persistence.server");
    return saveWorkflow(context.userId, data);
  });

export const createServerWorkflow = createServerFn({ method: "POST" })
  .validator((name: string) => name)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const { createWorkflow } = await import("./persistence.server");
    return createWorkflow(context.userId, data);
  });

export const importLocalWorkflow = createServerFn({ method: "POST" })
  .validator((definition: WorkflowDefinition) => definition)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const { importWorkflow } = await import("./persistence.server");
    return importWorkflow(context.userId, data);
  });

export const beginRun = createServerFn({ method: "POST" })
  .validator((workflowId: string) => workflowId)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const { startRun } = await import("./persistence.server");
    return startRun(context.userId, data);
  });

export const stepServerRun = createServerFn({ method: "POST" })
  .validator(runInput)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const [{ claimRunStep, getOwnedRun, replaceRun }, { createProviderDependencies }, { stepRuntime }] = await Promise.all([
      import("./persistence.server"),
      import("./providers.server"),
      import("./step"),
    ]);
    const owned = await getOwnedRun(context.userId, data.runId);
    if (owned.run.version !== data.expectedVersion) throw new Error("Run version is stale.");
    if (owned.run.status === "done" || owned.run.status === "failed") return owned.run;
    const claimed = await claimRunStep(context.userId, data.expectedVersion, owned.run);
    const next = await stepRuntime(owned.workflow, claimed, createProviderDependencies());
    return replaceRun(context.userId, claimed.version, next);
  });

export const changeRunStatus = createServerFn({ method: "POST" })
  .validator((value: { runId: string; expectedVersion: number; status: "paused" | "running" }) => value)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const { getOwnedRun, replaceRun } = await import("./persistence.server");
    const owned = await getOwnedRun(context.userId, data.runId);
    if (owned.run.version !== data.expectedVersion) throw new Error("Run version is stale.");
    if (owned.run.status === "done" || owned.run.status === "failed") throw new Error("A completed run cannot change status.");
    const next: RuntimeRun = {
      ...owned.run,
      status: data.status,
      updatedAt: new Date().toISOString(),
      log: [...owned.run.log, { t: new Date().toISOString(), level: "system", text: data.status === "paused" ? "Paused." : "Resumed." }],
    };
    return replaceRun(context.userId, data.expectedVersion, next);
  });
