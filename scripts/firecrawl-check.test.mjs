import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { firecrawlKeyStatus } from "./firecrawl-check.mjs";

test("reports a missing key without touching the network", () => {
  assert.equal(firecrawlKeyStatus({}).ok, false);
  assert.equal(firecrawlKeyStatus({ FIRECRAWL_API_KEY: "  " }).ok, false);
  assert.equal(firecrawlKeyStatus({ FIRECRAWL_API_KEY: "fc-x" }).ok, true);
  const script = fileURLToPath(new URL("./firecrawl-check.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script], { env: { PATH: process.env.PATH }, encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /FIRECRAWL_API_KEY is not set/);
});
