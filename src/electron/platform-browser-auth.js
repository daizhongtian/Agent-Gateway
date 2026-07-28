import { createHash, randomBytes } from "node:crypto";
import http from "node:http";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1_000;

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

export function createBrowserAuthorizationParameters() {
  const state = base64Url(randomBytes(32));
  const codeVerifier = base64Url(randomBytes(48));
  const codeChallenge = createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
  return Object.freeze({ state, codeVerifier, codeChallenge });
}

function authorizationUrl(platformBaseUrl, callbackPort, parameters) {
  const url = new URL(platformBaseUrl);
  url.searchParams.set("desktop_auth", "1");
  url.searchParams.set("callback_port", String(callbackPort));
  url.searchParams.set("state", parameters.state);
  url.searchParams.set("code_challenge", parameters.codeChallenge);
  return url.href;
}

function callbackPage(success, message) {
  const title = success ? "Sign-in complete" : "Sign-in failed";
  const color = success ? "#8ee2b0" : "#f39aa7";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d0f14;color:#f4f5f8;font:16px system-ui,sans-serif}.card{width:min(520px,calc(100vw - 48px));padding:36px;border:1px solid #2c303b;border-radius:20px;background:#151820;box-shadow:0 24px 80px #0008}.dot{display:inline-block;width:10px;height:10px;margin-right:10px;border-radius:50%;background:${color};box-shadow:0 0 18px ${color}}h1{font-size:26px}p{color:#aeb3c0;line-height:1.6}</style></head><body><main class="card"><h1><span class="dot"></span>${title}</h1><p>${message}</p></main></body></html>`;
}

export async function runPlatformBrowserAuthorization({
  platformBaseUrl,
  openExternal,
  exchangeAuthorization,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (typeof openExternal !== "function" || typeof exchangeAuthorization !== "function") {
    throw new Error("Browser authorization requires browser and token-exchange handlers.");
  }
  const parameters = createBrowserAuthorizationParameters();
  let settled = false;
  let timer;
  let resolveCallback;
  let rejectCallback;
  const callback = new Promise((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  const server = http.createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
    response.setHeader("Referrer-Policy", "no-referrer");
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method !== "GET" || requestUrl.pathname !== "/callback") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    if (requestUrl.searchParams.get("state") !== parameters.state) {
      response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      response.end(callbackPage(false, "The return state did not match. Close this page and try again from the desktop app."));
      return;
    }
    const error = requestUrl.searchParams.get("error");
    const code = requestUrl.searchParams.get("code");
    if (error || !code || code.length > 256) {
      response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      response.end(callbackPage(false, "The platform did not provide a valid authorization code. Return to the desktop app and try again."));
      if (!settled) rejectCallback(new Error(error || "The platform returned an invalid authorization code."));
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(callbackPage(true, "You can close this browser tab and return to Agent Gateway."));
    if (!settled) resolveCallback(code);
  });

  const closeServer = () => new Promise((resolve) => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
  });

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Could not create the secure desktop callback.");
    timer = setTimeout(() => {
      if (!settled) rejectCallback(new Error("Platform sign-in timed out. Try again from the desktop app."));
    }, timeoutMs);
    await openExternal(authorizationUrl(platformBaseUrl, address.port, parameters));
    const code = await callback;
    settled = true;
    return await exchangeAuthorization(code, parameters.codeVerifier);
  } finally {
    settled = true;
    if (timer) clearTimeout(timer);
    await closeServer();
  }
}
