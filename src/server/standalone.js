import { startServer } from "./app.js";
import { secretProtectorFromEnvironment } from "./secret-protector.js";

let handle = null;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await handle?.close();
    if (signal) console.log(`[server] stopped after ${signal}`);
  } catch (error) {
    console.error("[server] shutdown failed", error);
    process.exitCode = 1;
  }
}

try {
  handle = await startServer({
    mode: "standalone",
    apiKeySecretProtector: secretProtectorFromEnvironment(),
  });
  console.log(`[server] Coding Agent Gateway listening on ${handle.url}`);
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
} catch (error) {
  console.error("[server] failed to start", error);
  process.exitCode = 1;
}
