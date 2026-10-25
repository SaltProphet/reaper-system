import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeBind, authEnabledFrom, isLoopbackHost } from "./local-host-guard.mjs";

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
