import { getSql } from "@/lib/db";
import { defaultState, layoutGraph } from "@/lib/engine";
import { createRuntimeRun, validateWorkflowDefinition } from "./step";
import type { RuntimeRun, StoredWorkflow, WorkflowDefinition } from "./types";

type WorkflowRow = {
  id: string;
  name: string;
  version: number;
  definition: unknown;
  created_at: string;
  updated_at: string;
};

type RunRow = {
  id: string;
  workflow_id: string;
  workflow_version: number;
  version: number;
  status: RuntimeRun["status"];
  workflow_snapshot: unknown;
  run_snapshot: unknown;
  created_at: string;
  updated_at: string;
};

function json<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function workflow(row: WorkflowRow): StoredWorkflow {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    definition: json<WorkflowDefinition>(row.definition),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function defaultDefinition(): WorkflowDefinition {
  const state = defaultState();
  return { schemaVersion: 1, objective: state.objective, graphs: state.graphs.map(layoutGraph) };
}

export async function createWorkflow(userId: string, name = "Untitled workflow"): Promise<StoredWorkflow> {
  const sql = await getSql();
  const id = `workflow-${crypto.randomUUID()}`;
  const definition = defaultDefinition();
  const rows = await sql.query<WorkflowRow>(
    `insert into reaper_workflows (id, user_id, name, definition)
     values ($1, $2, $3, $4::jsonb)
     returning id, name, version, definition, created_at, updated_at`,
    [id, userId, name.trim() || "Untitled workflow", JSON.stringify(definition)],
  );
  return workflow(rows[0]);
}

export async function listWorkflows(userId: string): Promise<StoredWorkflow[]> {
  const sql = await getSql();
  const rows = await sql<WorkflowRow>`
    select id, name, version, definition, created_at, updated_at
    from reaper_workflows where user_id = ${userId} order by updated_at desc
  `;
  return rows.map(workflow);
}

export async function ensureWorkspace(userId: string): Promise<{ workflows: StoredWorkflow[]; runs: RuntimeRun[] }> {
  let workflows = await listWorkflows(userId);
  if (workflows.length === 0) {
    await createWorkflow(userId, "Research workflow");
    workflows = await listWorkflows(userId);
  }
  const sql = await getSql();
  const rows = await sql<RunRow>`
    select id, workflow_id, workflow_version, version, status, workflow_snapshot, run_snapshot, created_at, updated_at
    from reaper_runs where user_id = ${userId} order by updated_at desc limit 20
  `;
  const runs: RuntimeRun[] = [];
  for (const row of rows) {
    const storedRun = { ...json<RuntimeRun>(row.run_snapshot), version: row.version };
    if (storedRun.status === "running") {
      runs.push(await replaceRun(userId, row.version, {
        ...storedRun,
        status: "paused",
        log: [...storedRun.log, { t: new Date().toISOString(), level: "system", text: "Interrupted run restored as paused." }],
        updatedAt: new Date().toISOString(),
      }));
    } else {
      runs.push(storedRun);
    }
  }
  return { workflows, runs };
}

export async function saveWorkflow(
  userId: string,
  input: { id: string; name: string; expectedVersion: number; definition: WorkflowDefinition },
): Promise<StoredWorkflow> {
  const validation = validateWorkflowDefinition(input.definition);
  if (validation.length) throw new Error(validation.join(" "));
  const sql = await getSql();
  const rows = await sql.query<WorkflowRow>(
    `update reaper_workflows
       set name = $1, definition = $2::jsonb, version = version + 1, updated_at = now()
     where id = $3 and user_id = $4 and version = $5
     returning id, name, version, definition, created_at, updated_at`,
    [input.name.trim() || "Untitled workflow", JSON.stringify(input.definition), input.id, userId, input.expectedVersion],
  );
  if (!rows[0]) throw new Error("Workflow changed elsewhere. Reload before saving again.");
  return workflow(rows[0]);
}

export async function importWorkflow(userId: string, definition: WorkflowDefinition): Promise<StoredWorkflow> {
  const validation = validateWorkflowDefinition(definition);
  if (validation.length) throw new Error(validation.join(" "));
  const sql = await getSql();
  const existing = await sql<{ id: string; version: number; name: string; legacy_imported_at: string | null }>`
    select id, version, name, legacy_imported_at
    from reaper_workflows where user_id = ${userId} order by created_at asc limit 1
  `;
  if (!existing[0]) throw new Error("No account workflow exists for import.");
  if (!existing[0].legacy_imported_at && existing[0].version === 1 && existing[0].name === "Research workflow") {
    await sql.query(
      `update reaper_workflows
         set definition = $1::jsonb, name = 'Imported workflow', version = version + 1,
             legacy_imported_at = now(), updated_at = now()
       where id = $2 and user_id = $3 and version = 1 and legacy_imported_at is null`,
      [JSON.stringify(definition), existing[0].id, userId],
    );
  }
  return (await listWorkflows(userId))[0];
}

export async function startRun(userId: string, workflowId: string): Promise<RuntimeRun> {
  const sql = await getSql();
  const rows = await sql<WorkflowRow>`
    select id, name, version, definition, created_at, updated_at
    from reaper_workflows where id = ${workflowId} and user_id = ${userId}
  `;
  if (!rows[0]) throw new Error("Workflow not found.");
  const stored = workflow(rows[0]);
  const validation = validateWorkflowDefinition(stored.definition);
  if (validation.length) throw new Error(validation.join(" "));
  const run = createRuntimeRun(stored.id, stored.version, stored.definition);
  await sql.query(
    `insert into reaper_runs
      (id, user_id, workflow_id, workflow_version, version, status, workflow_snapshot, run_snapshot)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)`,
    [run.id, userId, stored.id, stored.version, run.version, run.status, JSON.stringify(stored.definition), JSON.stringify(run)],
  );
  return run;
}

export async function getOwnedRun(
  userId: string,
  runId: string,
): Promise<{ run: RuntimeRun; workflow: WorkflowDefinition }> {
  const sql = await getSql();
  const rows = await sql<RunRow>`
    select id, workflow_id, workflow_version, version, status, workflow_snapshot, run_snapshot, created_at, updated_at
    from reaper_runs where id = ${runId} and user_id = ${userId}
  `;
  if (!rows[0]) throw new Error("Run not found.");
  return {
    run: { ...json<RuntimeRun>(rows[0].run_snapshot), version: rows[0].version },
    workflow: json<WorkflowDefinition>(rows[0].workflow_snapshot),
  };
}

export async function claimRunStep(userId: string, expectedVersion: number, run: RuntimeRun): Promise<RuntimeRun> {
  const sql = await getSql();
  const version = expectedVersion + 1;
  const claimed: RuntimeRun = {
    ...run,
    version,
    status: "running",
    updatedAt: new Date().toISOString(),
  };
  const rows = await sql.query<{ version: number }>(
    `update reaper_runs
       set version = $1, status = 'running', run_snapshot = $2::jsonb, updated_at = now()
     where id = $3 and user_id = $4 and version = $5
     returning version`,
    [version, JSON.stringify(claimed), run.id, userId, expectedVersion],
  );
  if (!rows[0]) throw new Error("Run changed elsewhere. Reload it before stepping again.");
  return claimed;
}

export async function replaceRun(userId: string, expectedVersion: number, next: RuntimeRun): Promise<RuntimeRun> {
  const sql = await getSql();
  const version = expectedVersion + 1;
  const snapshot = { ...next, version };
  const rows = await sql.query<{ version: number }>(
    `update reaper_runs
       set version = $1, status = $2, run_snapshot = $3::jsonb, updated_at = now()
     where id = $4 and user_id = $5 and version = $6
     returning version`,
    [version, snapshot.status, JSON.stringify(snapshot), snapshot.id, userId, expectedVersion],
  );
  if (!rows[0]) throw new Error("Run changed elsewhere. Reload it before stepping again.");
  return snapshot;
}
