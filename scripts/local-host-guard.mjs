/**
 * Reaper must never serve with auth off on anything but loopback (spec §2):
 * with VITE_AUTH_ENABLED=false every request is the dev user, so a LAN or
 * tailnet bind hands the station to any device that can reach the port.
 */
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function isLoopbackHost(host) {
  if (host === undefined || host === null || host === false) return true; // Vite default: localhost
  if (host === true) return false; // Vite: all interfaces
  return LOOPBACK.has(String(host).trim().toLowerCase());
}

/** Same rule as src/lib/auth/server.ts: only "false" turns auth off. */
export function authEnabledFrom(value) {
  return String(value ?? "").trim() !== "false";
}

export function assertSafeBind({ host, authEnabled }) {
  if (authEnabled || isLoopbackHost(host)) return;
  const where = host === true ? "all interfaces" : String(host);
  throw new Error(
    `Refusing to start: auth is off (VITE_AUTH_ENABLED=false) and the server would listen on ${where}. ` +
      "Bind to 127.0.0.1, localhost or ::1 (use npm run start:local).",
  );
}

export function loopbackGuardPlugin() {
  return {
    name: "reaper:loopback-guard",
    apply: "serve",
    configResolved(config) {
      assertSafeBind({
        host: config.server.host,
        authEnabled: authEnabledFrom(process.env.VITE_AUTH_ENABLED ?? config.env?.VITE_AUTH_ENABLED),
      });
    },
  };
}
