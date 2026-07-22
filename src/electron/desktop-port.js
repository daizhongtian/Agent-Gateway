import net from "node:net";

export const DEFAULT_DESKTOP_PORT = 4310;

export function parseDesktopPort(value, { allowZero = false, label = "API port" } = {}) {
  const port = Number(value);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isInteger(port) || port < minimum || port > 65_535) {
    throw new RangeError(`${label} must be an integer between ${minimum} and 65535.`);
  }
  return port;
}

export function resolveDesktopPort({ environment = process.env, preferences = {} } = {}) {
  const environmentValue = environment?.CODEX_DESKTOP_PORT;
  if (environmentValue !== undefined && environmentValue !== null && String(environmentValue).trim() !== "") {
    return parseDesktopPort(environmentValue, { allowZero: true, label: "CODEX_DESKTOP_PORT" });
  }
  return parseDesktopPort(preferences?.port ?? DEFAULT_DESKTOP_PORT);
}

export function desktopPortManagedByEnvironment(environment = process.env) {
  const value = environment?.CODEX_DESKTOP_PORT;
  return value !== undefined && value !== null && String(value).trim() !== "";
}

export function checkLoopbackPort(port, { host = "127.0.0.1", createServer = () => net.createServer() } = {}) {
  const requestedPort = parseDesktopPort(port);
  return new Promise((resolve, reject) => {
    const server = createServer();
    let settled = false;
    const finish = (result, error = null) => {
      if (settled) return;
      settled = true;
      server.removeAllListeners();
      if (error) reject(error);
      else resolve(Object.freeze(result));
    };
    server.once("error", (error) => {
      if (["EADDRINUSE", "EACCES"].includes(error?.code)) {
        finish({ available: false, port: requestedPort, code: error.code });
        return;
      }
      finish(null, error);
    });
    server.once("listening", () => {
      server.close((error) => {
        if (error) finish(null, error);
        else finish({ available: true, port: requestedPort, code: null });
      });
    });
    server.unref?.();
    server.listen(requestedPort, host);
  });
}
