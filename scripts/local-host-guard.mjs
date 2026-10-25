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

/** A socket's local address is loopback (127.0.0.0/8, ::1, or IPv4-mapped 127.x). */
export function isLoopbackAddress(address) {
  const value = String(address ?? "").trim().toLowerCase();
  if (!value) return false;
  if (value === "::1") return true;
  const v4 = value.startsWith("::ffff:") ? value.slice(7) : value;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}

/**
 * Defense in depth behind assertSafeBind: with auth off, refuse any request that reached us
 * on a non-loopback local address (e.g. a port forward or a host alias that resolved wide).
 */
export function loopbackOnlyMiddleware(isAuthEnabled) {
  return function reaperLoopbackOnly(req, res, next) {
    if (isAuthEnabled() || isLoopbackAddress(req.socket?.localAddress)) {
      next();
      return;
    }
    res.statusCode = 403;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end("Forbidden: auth is off, so Reaper only answers on loopback.");
  };
}

export function loopbackGuardPlugin() {
  let isPreview = false;
  let authEnabled = true;
  const install = (server) => {
    server.middlewares.use(loopbackOnlyMiddleware(() => authEnabled));
  };
  return {
    name: "reaper:loopback-guard",
    apply: "serve",
    config(_config, configEnv) {
      isPreview = Boolean(configEnv?.isPreview);
    },
    configResolved(config) {
      authEnabled = authEnabledFrom(process.env.VITE_AUTH_ENABLED ?? config.env?.VITE_AUTH_ENABLED);
      // `vite preview` listens on preview.host, not server.host.
      assertSafeBind({ host: isPreview ? config.preview?.host : config.server?.host, authEnabled });
    },
    configureServer: install,
    configurePreviewServer: install,
  };
}
