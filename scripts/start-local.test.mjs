import assert from "node:assert/strict";
import test from "node:test";
import { LOCAL_HOST, MIN_NUM_CTX, buildLocalEnv, checkOllamaModel, localPort, localViteArgs, ollamaRoot } from "./start-local.mjs";

test("local env forces auth off and fills local model defaults", () => {
  const env = buildLocalEnv({ PATH: "x" });
  assert.equal(env.VITE_AUTH_ENABLED, "false");
  assert.equal(env.OPENAI_BASE_URL, "http://127.0.0.1:11434/v1");
  assert.equal(env.OPENAI_MODEL, "gpt-oss-20b-32k");
  assert.equal(env.REAPER_MODEL_TIMEOUT_MS, "600000");
  assert.equal(env.REAPER_DATA_DIR, "C:\\ReaperData");
  assert.equal(buildLocalEnv({ OPENAI_MODEL: "other-model" }).OPENAI_MODEL, "other-model");
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

const reply = (status, body) => async () => new Response(JSON.stringify(body), { status });

test("Ollama root strips the OpenAI-compatible /v1 suffix", () => {
  assert.equal(ollamaRoot("http://127.0.0.1:11434/v1"), "http://127.0.0.1:11434");
  assert.equal(ollamaRoot("http://127.0.0.1:11434/v1/"), "http://127.0.0.1:11434");
  assert.equal(MIN_NUM_CTX, 32768);
});

test("startup check: one POST to /api/show, returns num_ctx when >= 32768", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ parameters: "num_ctx                        32768\nstop \"<|end|>\"" }), { status: 200 });
  };
  assert.equal(await checkOllamaModel({ baseUrl: "http://127.0.0.1:11434/v1", model: "gpt-oss-20b-32k", fetchImpl }), 32768);
  assert.deepEqual(calls, [{ url: "http://127.0.0.1:11434/api/show", method: "POST", body: { model: "gpt-oss-20b-32k" } }]);
});

test("startup check refuses a missing model, a small num_ctx, or no num_ctx", async () => {
  const args = { baseUrl: "http://127.0.0.1:11434/v1", model: "gpt-oss-20b-32k" };
  await assert.rejects(() => checkOllamaModel({ ...args, fetchImpl: reply(404, { error: "model 'gpt-oss-20b-32k' not found" }) }), /gpt-oss-20b-32k.*not found/);
  await assert.rejects(() => checkOllamaModel({ ...args, fetchImpl: reply(200, { parameters: "num_ctx 8192" }) }), /num_ctx 8192.*32768/);
  await assert.rejects(() => checkOllamaModel({ ...args, fetchImpl: reply(200, { parameters: "stop x" }) }), /no num_ctx/);
  await assert.rejects(() => checkOllamaModel({ ...args, fetchImpl: async () => { throw new TypeError("fetch failed"); } }), /not reachable/);
});
