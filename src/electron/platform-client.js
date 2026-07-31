import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { RelayAgent } from "./relay-agent.js";

const SESSION_FILE = "platform-session.json";
export const DEFAULT_PLATFORM_URL = "https://platform.agentgatewayplatform.cc";

class PlatformRequestError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "PlatformRequestError";
    this.status = status;
    this.code = code;
  }
}

function normalizedBaseUrl(value) {
  const parsed = new URL(String(value || DEFAULT_PLATFORM_URL).trim());
  const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname.toLowerCase());
  if ((parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback))
    || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Platform URL must use HTTPS, except for an HTTP loopback development address.");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

function validateCredentials(email, password, { registration = false } = {}) {
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  const normalizedPassword = String(password ?? "");
  if (normalizedEmail.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error("Enter a valid email address.");
  }
  if (!normalizedPassword || normalizedPassword.length > 72 || (registration && normalizedPassword.length < 12)) {
    throw new Error(registration ? "The password must contain at least 12 characters." : "Enter your password.");
  }
  return { email: normalizedEmail, password: normalizedPassword };
}

export class PlatformClient {
  constructor({
    userDataPath,
    secretProtector,
    fetchImpl = globalThis.fetch,
    baseUrl = process.env.CODING_AGENT_PLATFORM_URL || DEFAULT_PLATFORM_URL,
    appVersion = "0.0.0",
    deviceName = os.hostname(),
    localPortProvider = () => 4310,
    relayAgent = new RelayAgent(),
  }) {
    if (!userDataPath || !secretProtector?.encrypt || !secretProtector?.decrypt || typeof fetchImpl !== "function") {
      throw new Error("PlatformClient requires storage, encryption, and fetch support.");
    }
    this.userDataPath = userDataPath;
    this.sessionPath = path.join(userDataPath, SESSION_FILE);
    this.secretProtector = secretProtector;
    this.fetchImpl = fetchImpl;
    this.baseUrl = normalizedBaseUrl(baseUrl);
    this.appVersion = String(appVersion).slice(0, 40);
    this.deviceName = String(deviceName || "Windows PC").trim().slice(0, 80) || "Windows PC";
    if (this.deviceName.length < 2) this.deviceName = "Windows PC";
    if (typeof localPortProvider !== "function" || !relayAgent?.start || !relayAgent?.stop) {
      throw new Error("PlatformClient requires Relay agent support.");
    }
    this.localPortProvider = localPortProvider;
    this.relayAgent = relayAgent;
    this.session = this.#load();
    this.refreshPromise = null;
  }

  async register(email, password, { termsAccepted = false, termsVersion = "" } = {}) {
    const credentials = validateCredentials(email, password, { registration: true });
    const response = await this.#request("/api/v1/auth/register", {
      method: "POST",
      body: { ...credentials, clientType: "desktop", termsAccepted: termsAccepted === true, termsVersion },
      auth: false,
    });
    this.#acceptAuth(response);
    return this.status();
  }

  async login(email, password, { termsAccepted = false, termsVersion = "" } = {}) {
    const credentials = validateCredentials(email, password);
    const response = await this.#request("/api/v1/auth/login", {
      method: "POST",
      body: { ...credentials, clientType: "desktop", termsAccepted: termsAccepted === true, termsVersion },
      auth: false,
    });
    this.#acceptAuth(response);
    return this.status();
  }

  async exchangeDesktopAuthorization(code, codeVerifier) {
    const response = await this.#request("/api/v1/auth/desktop/exchange", {
      method: "POST",
      body: { code, codeVerifier },
      auth: false,
    });
    this.#acceptAuth(response);
    return this.status();
  }

  async logout() {
    this.relayAgent.stop();
    if (this.session?.accessToken) {
      try {
        await this.#request("/api/v1/auth/logout", { method: "POST" });
      } catch {
        // Local sign-out must still succeed when the platform is temporarily offline.
      }
    }
    this.#clear();
    return this.status();
  }

  async getStatus() {
    if (!this.session?.refreshToken) return this.status();
    try {
      const session = await this.#request("/api/v1/auth/session");
      this.session.user = session.user;
      this.#save();
      const hosts = await this.#request("/api/v1/hosts");
      const host = this.#selectHost(hosts);
      this.session.host = host;
      if (host) this.session.hostId = host.id;
      this.#save();
      return this.status({ host });
    } catch (error) {
      if (error instanceof PlatformRequestError && [401, 403].includes(error.status)) this.#clear();
      return this.status({ error: { code: error.code || "PLATFORM_UNREACHABLE", message: error.message } });
    }
  }

  async setOnline(enabled) {
    if (!this.session?.refreshToken) {
      throw new PlatformRequestError(401, "PLATFORM_LOGIN_REQUIRED", "Sign in to the platform first.");
    }
    const host = enabled ? await this.#ensureOnlineHost() : await this.#disableOnlineHost();
    return this.status({ host });
  }

  async resumeOnlineHost() {
    const status = await this.getStatus();
    if (!status.signedIn || !status.host?.desiredOnline) return status;
    try {
      const host = await this.#ensureRelayConnection(status.host);
      return this.status({ host });
    } catch (error) {
      return this.status({
        host: status.host,
        error: { code: error.code || "RELAY_UNREACHABLE", message: error.message },
      });
    }
  }

  disconnectRelay() {
    return this.relayAgent.stop();
  }

  status({ host = null, error = null } = {}) {
    const selectedHost = host || this.session?.host || null;
    return Object.freeze({
      signedIn: Boolean(this.session?.refreshToken && this.session?.user),
      platformUrl: this.baseUrl,
      user: this.session?.user || null,
      host: selectedHost,
      online: Boolean(selectedHost?.desiredOnline && selectedHost?.status === "online"),
      error,
    });
  }

  async #ensureOnlineHost() {
    let devices = await this.#request("/api/v1/devices");
    let device = devices.find((item) => item.id === this.session.deviceId && item.status !== "revoked")
      || devices.find((item) => item.status !== "revoked");
    if (!device) {
      device = await this.#request("/api/v1/devices", {
        method: "POST",
        body: { name: this.deviceName, platform: "windows" },
      });
    }
    if (device.status !== "active") {
      const pairing = await this.#request(`/api/v1/devices/${device.id}/pairing-code`, { method: "POST" });
      const keys = generateKeyPairSync("ed25519");
      const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
      const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
      const paired = await this.#request("/api/v1/desktop/pair", {
        method: "POST",
        auth: false,
        body: { code: pairing.code, publicKey, appVersion: this.appVersion, platform: "windows" },
      });
      this.session.deviceSecret = paired.deviceSecret;
      this.session.devicePrivateKey = privateKey;
    }
    this.session.deviceId = device.id;

    let hosts = await this.#request("/api/v1/hosts");
    let host = this.#selectHost(hosts, device.id);
    if (!host) {
      host = await this.#request("/api/v1/hosts", {
        method: "POST",
        body: { deviceId: device.id, displayName: `${this.deviceName} Host`.slice(0, 80) },
      });
    }
    if (host.status === "disabled") {
      host = await this.#request(`/api/v1/hosts/${host.id}/enable`, { method: "POST" });
    }
    host = await this.#request(`/api/v1/hosts/${host.id}`, {
      method: "PATCH",
      body: { displayName: host.displayName, desiredOnline: true },
    });
    this.session.hostId = host.id;
    this.session.host = host;
    this.#save();
    if (host.status === "online") return host;
    return this.#ensureRelayConnection(host);
  }

  async #disableOnlineHost() {
    this.relayAgent.stop();
    const hosts = await this.#request("/api/v1/hosts");
    const host = this.#selectHost(hosts);
    if (!host) return null;
    const updated = await this.#request(`/api/v1/hosts/${host.id}`, {
      method: "PATCH",
      body: { displayName: host.displayName, desiredOnline: false },
    });
    this.session.host = updated;
    this.#save();
    return updated;
  }

  async #ensureRelayConnection(host) {
    const config = await this.#request("/api/v1/platform/config", { auth: false });
    if (config?.relayEnabled !== true || config?.localProxyEnabled === true || host?.relayReady !== true) {
      const error = new PlatformRequestError(503, "RELAY_NOT_READY", "The platform Relay is not ready.");
      throw error;
    }
    if (!this.session?.deviceId || !this.session?.deviceSecret || !host?.id) {
      throw new PlatformRequestError(401, "DEVICE_CREDENTIAL_REQUIRED", "Pair this desktop with the platform again.");
    }
    const port = Number(this.localPortProvider());
    await this.relayAgent.start({
      localPort: port,
      getTicket: () => this.#request("/api/v1/desktop/tunnel-token", {
        method: "POST",
        body: {
          deviceId: this.session.deviceId,
          hostId: host.id,
          deviceSecret: this.session.deviceSecret,
        },
      }),
    });
    const online = await this.#waitForOnlineHost(host.id);
    this.session.host = online;
    this.#save();
    return online;
  }

  async #waitForOnlineHost(hostId) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const hosts = await this.#request("/api/v1/hosts");
      const host = hosts.find((item) => item.id === hostId);
      if (host?.desiredOnline && host.status === "online") return host;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new PlatformRequestError(504, "RELAY_PRESENCE_TIMEOUT", "The Relay connected, but Host presence did not become online.");
  }

  #selectHost(hosts, deviceId = null) {
    if (!Array.isArray(hosts)) return null;
    return hosts.find((item) => item.id === this.session?.hostId)
      || hosts.find((item) => (!deviceId || item.deviceId === deviceId) && item.status !== "disabled")
      || hosts.find((item) => !deviceId || item.deviceId === deviceId)
      || null;
  }

  async #request(pathname, { method = "GET", body, auth = true, retry = true } = {}) {
    const headers = { Accept: "application/json", "User-Agent": `Agent-Gateway/${this.appVersion}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth && this.session?.accessToken) headers.Authorization = `Bearer ${this.session.accessToken}`;
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new PlatformRequestError(0, "PLATFORM_UNREACHABLE", "The Agent Gateway platform is not reachable.");
    }
    if (response.status === 401 && auth && retry && this.session?.refreshToken) {
      await this.#refresh();
      return this.#request(pathname, { method, body, auth, retry: false });
    }
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      throw new PlatformRequestError(
        response.status,
        payload?.error?.code || `PLATFORM_HTTP_${response.status}`,
        payload?.error?.message || `Platform request failed (${response.status}).`,
      );
    }
    return payload;
  }

  async #refresh() {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      const response = await this.#request("/api/v1/auth/refresh", {
        method: "POST",
        auth: false,
        retry: false,
        body: { refreshToken: this.session.refreshToken, clientType: "desktop" },
      });
      this.#acceptAuth(response);
    })();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  #acceptAuth(response) {
    if (!response?.accessToken || !response?.refreshToken || !response?.user) {
      throw new Error("The platform returned an incomplete desktop session.");
    }
    this.session = {
      ...(this.session || {}),
      user: response.user,
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      accessExpiresAt: response.accessExpiresAt,
      refreshExpiresAt: response.refreshExpiresAt,
    };
    this.#save();
  }

  #load() {
    try {
      const envelope = JSON.parse(readFileSync(this.sessionPath, "utf8"));
      if (envelope?.version !== 1 || typeof envelope?.encrypted !== "string") return null;
      return JSON.parse(this.secretProtector.decrypt(envelope.encrypted));
    } catch {
      return null;
    }
  }

  #save() {
    mkdirSync(this.userDataPath, { recursive: true });
    const temporary = `${this.sessionPath}.tmp`;
    const envelope = { version: 1, encrypted: this.secretProtector.encrypt(JSON.stringify(this.session)) };
    writeFileSync(temporary, `${JSON.stringify(envelope)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.sessionPath);
  }

  #clear() {
    this.session = null;
    try {
      unlinkSync(this.sessionPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

export { PlatformRequestError };
