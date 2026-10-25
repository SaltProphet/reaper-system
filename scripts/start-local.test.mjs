import assert from "node:assert/strict";
import test from "node:test";
import { LOCAL_HOST, buildLocalEnv, localPort, localViteArgs } from "./start-local.mjs";

test("local env forces auth off and fills local model defaults", () => {
  const env = buildLocalEnv({ PATH: "x" });
  assert.equal(env.VITE_AUTH_ENABLED, "false");
  assert.equal(env.OPENAI_BASE_URL, "http://127.0.0.1:11434/v1");
  assert.equal(env.OPENAI_MODEL, "gpt-oss:20b");
  assert.equal(env.REAPER_MODEL_TIMEOUT_MS, "600000");
  assert.equal(env.REAPER_DATA_DIR, "C:\\ReaperData");
  assert.equal(buildLocalEnv({ OPENAI_MODEL: "gpt-oss-20b-32k" }).OPENAI_MODEL, "gpt-oss-20b-32k");
  assert.equal(buildLocalEnv({ VITE_AUTH_ENABLED: "true" }).VITE_AUTH_ENABLED, "false");
});

test("refuses when DATABASE_URL is set", () => {
  assert.throws(() => buildLocalEnv({ DATABASE_URL: "postgres://x" }), /DATABASE_URL/);
});

test("binds only to 127.0.0.1 with a strict port", () => {
  assert.equal(LOCAL_HOST, "127.0.0.1");
  const args = localViteArgs("/r", 8080);
  assert.deepEqual(args.slice(1), ["dev", "--host", "127.0.0.1", "--port", "8080", "--strictPort"]);
  assert.match(args[0], /node_modules[\\/]vite[\\/]bin[\\/]vite\.js$/);
  assert.equal(localPort({}), 8080);
  assert.equal(localPort({ REAPER_PORT: "8090" }), 8090);
  assert.throws(() => localPort({ REAPER_PORT: "80" }), /REAPER_PORT/);
});
