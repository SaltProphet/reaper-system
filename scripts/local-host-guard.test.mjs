import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeBind, authEnabledFrom, isLoopbackAddress, isLoopbackHost, loopbackGuardPlugin, loopbackOnlyMiddleware } from "./local-host-guard.mjs";

test("loopback hosts", () => {
  for (const host of ["127.0.0.1", "localhost", "::1", "[::1]", " LOCALHOST ", undefined]) assert.equal(isLoopbackHost(host), true, String(host));
  for (const host of ["0.0.0.0", "::", true, "192.168.1.5", "100.64.0.2", "shadow-pc"]) assert.equal(isLoopbackHost(host), false, String(host));
});

test("auth flag mirrors the server: only the string false turns it off", () => {
  assert.equal(authEnabledFrom("false"), false);
  assert.equal(authEnabledFrom(" false "), false);
  assert.equal(authEnabledFrom(undefined), true);
  assert.equal(authEnabledFrom("true"), true);
});

test("refuses auth-off on a non-loopback host, naming the host", () => {
  assert.throws(() => assertSafeBind({ host: "0.0.0.0", authEnabled: false }), /Refusing to start.*0\.0\.0\.0/);
  assert.throws(() => assertSafeBind({ host: true, authEnabled: false }), /all interfaces/);
  assert.doesNotThrow(() => assertSafeBind({ host: "127.0.0.1", authEnabled: false }));
  assert.doesNotThrow(() => assertSafeBind({ host: "0.0.0.0", authEnabled: true }));
});

function withAuthEnv(value, fn) {
  const old = process.env.VITE_AUTH_ENABLED;
  if (value === undefined) delete process.env.VITE_AUTH_ENABLED; else process.env.VITE_AUTH_ENABLED = value;
  try { return fn(); } finally { if (old === undefined) delete process.env.VITE_AUTH_ENABLED; else process.env.VITE_AUTH_ENABLED = old; }
}

test("vite preview checks preview.host, not server.host", () => withAuthEnv("false", () => {
  const plugin = loopbackGuardPlugin();
  plugin.config({}, { command: "serve", mode: "production", isPreview: true });
  assert.throws(() => plugin.configResolved({ server: { host: "127.0.0.1" }, preview: { host: "0.0.0.0" }, env: {} }), /0\.0\.0\.0/);
  assert.doesNotThrow(() => plugin.configResolved({ server: { host: "0.0.0.0" }, preview: { host: "127.0.0.1" }, env: {} }));
  const dev = loopbackGuardPlugin();
  dev.config({}, { command: "serve", mode: "development", isPreview: false });
  assert.throws(() => dev.configResolved({ server: { host: "0.0.0.0" }, preview: { host: "127.0.0.1" }, env: {} }), /0\.0\.0\.0/);
}));

test("loopback socket addresses", () => {
  for (const address of ["127.0.0.1", "127.8.0.3", "::1", "::ffff:127.0.0.1"]) assert.equal(isLoopbackAddress(address), true, address);
  for (const address of ["192.168.1.5", "100.64.0.2", "::ffff:10.0.0.1", "fe80::1", "", undefined]) assert.equal(isLoopbackAddress(address), false, String(address));
});

function fakeRes() {
  return { statusCode: 200, headers: {}, body: "", setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b ?? ""; } };
}

test("auth off: a request that arrived on a non-loopback local address is rejected", () => {
  const guard = loopbackOnlyMiddleware(() => false);
  let nexted = 0;
  const res = fakeRes();
  guard({ socket: { localAddress: "192.168.1.5" } }, res, () => { nexted += 1; });
  assert.equal(nexted, 0);
  assert.equal(res.statusCode, 403);
  guard({ socket: { localAddress: "::ffff:127.0.0.1" } }, fakeRes(), () => { nexted += 1; });
  assert.equal(nexted, 1);
  loopbackOnlyMiddleware(() => true)({ socket: { localAddress: "192.168.1.5" } }, fakeRes(), () => { nexted += 1; });
  assert.equal(nexted, 2);
});

test("the plugin installs the middleware on both the dev and the preview server", () => withAuthEnv("false", () => {
  const plugin = loopbackGuardPlugin();
  plugin.config({}, { command: "serve", mode: "development", isPreview: false });
  plugin.configResolved({ server: { host: "127.0.0.1" }, preview: { host: "127.0.0.1" }, env: {} });
  for (const hook of ["configureServer", "configurePreviewServer"]) {
    const used = [];
    plugin[hook]({ middlewares: { use: (fn) => used.push(fn) } });
    assert.equal(used.length, 1, hook);
    const res = fakeRes();
    used[0]({ socket: { localAddress: "10.0.0.7" } }, res, () => assert.fail("must not pass"));
    assert.equal(res.statusCode, 403, hook);
  }
}));
