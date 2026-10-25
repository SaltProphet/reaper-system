import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "../env.server.ts";
import type { RuntimeRun } from "./types.ts";

const RUN_ID = /^run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function runFilePath(dataDir: string, runId: string): string {
  if (!RUN_ID.test(runId)) throw new Error(`Refusing to write a run file for unexpected run id ${runId}.`);
  return join(dataDir, "runs", `${runId}.json`);
}

/** Write the final run record outside the repo. Off unless REAPER_DATA_DIR is set. */
export async function writeRunFile(run: RuntimeRun, dataDir = env("REAPER_DATA_DIR")): Promise<string | null> {
  if (!dataDir) return null;
  const target = runFilePath(dataDir, run.id);
  await mkdir(join(dataDir, "runs"), { recursive: true });
  const temp = `${target}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify({ writtenAt: new Date().toISOString(), run }, null, 2)}\n`, "utf8");
  await rename(temp, target);
  return target;
}
