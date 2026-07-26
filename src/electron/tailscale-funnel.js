import { execFile } from "node:child_process";
import path from "node:path";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const PUBLIC_HTTPS_PORT = 443;
const DEFAULT_REPAIR_COOLDOWN_MS = 30 * 60 * 1_000;

export class TailscaleFunnelError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "TailscaleFunnelError";
    this.code = code;
    if (options.actionUrl) this.actionUrl = options.actionUrl;
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function tailscaleCommandCandidates({ platform = process.platform, environment = process.env } = {}) {
  const configured = typeof environment.TAILSCALE_PATH === "string"
    ? environment.TAILSCALE_PATH.trim()
    : "";
  if (platform !== "win32") return unique([configured, "tailscale"]);

  return unique([
    configured,
    environment.ProgramFiles && path.join(environment.ProgramFiles, "Tailscale", "tailscale.exe"),
    environment.LOCALAPPDATA && path.join(environment.LOCALAPPDATA, "Tailscale", "tailscale.exe"),
    "tailscale.exe",
    "tailscale",
  ]);
}

function execute(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      encoding: "utf8",
      maxBuffer: MAX_OUTPUT_BYTES,
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      windowsHide: true,
    }, (error, stdout = "", stderr = "") => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function missingExecutable(error) {
  return error?.code === "ENOENT"
    || error?.code === "UNKNOWN"
    || /not recognized|cannot find the file|no such file/i.test(String(error?.message ?? ""));
}

function safeCommandError(error) {
  const raw = [error?.stderr, error?.stdout, error?.message]
    .filter((value) => typeof value === "string" && value.trim())
    .join("\n")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return raw.slice(0, 1_000) || "Tailscale command failed.";
}

function firstWebUrl(value) {
  const match = /https:\/\/[^\s<>"']+/i.exec(String(value ?? ""));
  if (!match) return null;
  try {
    const url = new URL(match[0].replace(/[),.;]+$/, ""));
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function parseJson(output, label) {
  try {
    return JSON.parse(output || "{}");
  } catch (error) {
    throw new TailscaleFunnelError(
      "TAILSCALE_INVALID_OUTPUT",
      `${label}返回了无法识别的数据，请更新 Tailscale 后重试。`,
      { cause: error },
    );
  }
}

function normalizedDnsName(value) {
  return typeof value === "string" ? value.trim().replace(/\.$/, "") : "";
}

function normalizedProxyTarget(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(hostname)) return value.trim();
    const port = Number(url.port || 80);
    return Number.isInteger(port) && port > 0 ? `http://127.0.0.1:${port}` : value.trim();
  } catch {
    return value.trim();
  }
}

function proxyPort(target) {
  try {
    const value = new URL(target);
    const port = Number(value.port || (value.protocol === "https:" ? 443 : 80));
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

function activeFunnelRoute(config = {}) {
  const allowed = Object.entries(config.AllowFunnel ?? {})
    .filter(([, enabled]) => enabled === true)
    .map(([hostPort]) => hostPort);
  const preferred = allowed.find((hostPort) => hostPort.endsWith(`:${PUBLIC_HTTPS_PORT}`)) ?? allowed[0] ?? null;
  const web = preferred ? config.Web?.[preferred] : null;
  const handlers = web?.Handlers && typeof web.Handlers === "object" ? web.Handlers : {};
  const root = handlers["/"];
  const target = normalizedProxyTarget(root?.Proxy);
  const hostname = preferred
    ? normalizedDnsName(preferred.replace(/:\d+$/, ""))
    : "";
  const httpsPort = preferred && /:(\d+)$/.test(preferred)
    ? Number(preferred.match(/:(\d+)$/)?.[1])
    : PUBLIC_HTTPS_PORT;
  return {
    allowed: Boolean(preferred),
    hostname,
    httpsPort,
    target,
    targetPort: proxyPort(target),
    hasOtherHandlers: Object.keys(handlers).some((mount) => mount !== "/"),
  };
}

function baseStatus(overrides = {}) {
  return Object.freeze({
    installed: false,
    connected: false,
    backendState: "Unavailable",
    version: null,
    dnsName: null,
    active: false,
    online: false,
    conflict: false,
    target: null,
    targetPort: null,
    publicUrl: null,
    baseUrl: null,
    message: "未检测到 Tailscale。",
    ...overrides,
  });
}

function versionFromOutput(output) {
  return String(output ?? "").trim().split(/\s+/)[0] || null;
}

export function serializeTailscaleError(error) {
  return Object.freeze({
    code: typeof error?.code === "string" ? error.code : "TAILSCALE_COMMAND_FAILED",
    message: error?.message || "Tailscale 操作失败。",
    actionUrl: typeof error?.actionUrl === "string" ? error.actionUrl : null,
  });
}

export class TailscaleFunnelController {
  constructor(options = {}) {
    this.runCommand = options.runCommand ?? execute;
    this.candidates = options.commandCandidates ?? tailscaleCommandCandidates(options);
    this.command = options.command ?? null;
    this.now = options.now ?? Date.now;
    this.repairCooldownMs = Number.isInteger(options.repairCooldownMs) && options.repairCooldownMs >= 0
      ? options.repairCooldownMs
      : DEFAULT_REPAIR_COOLDOWN_MS;
    this.lastRepairAt = null;
  }

  async #run(args, options = {}) {
    if (this.command) return this.runCommand(this.command, args, options);
    let lastMissing = null;
    for (const candidate of this.candidates) {
      try {
        const result = await this.runCommand(candidate, args, options);
        this.command = candidate;
        return result;
      } catch (error) {
        if (!missingExecutable(error)) {
          this.command = candidate;
          throw error;
        }
        lastMissing = error;
      }
    }
    throw new TailscaleFunnelError(
      "TAILSCALE_NOT_INSTALLED",
      "未检测到 Tailscale。请先安装并登录 Tailscale，再开启公网 Host。",
      { cause: lastMissing, actionUrl: "https://tailscale.com/download/windows" },
    );
  }

  async status(port) {
    const targetPort = Number(port);
    if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65_535) {
      throw new TailscaleFunnelError("INVALID_PORT", "本地 API 端口无效。");
    }

    let version;
    try {
      version = versionFromOutput((await this.#run(["version"])).stdout);
    } catch (error) {
      if (error instanceof TailscaleFunnelError) {
        return baseStatus({ message: error.message, error: serializeTailscaleError(error) });
      }
      return baseStatus({
        installed: true,
        message: `Tailscale 无法运行：${safeCommandError(error)}`,
        error: serializeTailscaleError(error),
      });
    }

    let network;
    try {
      network = parseJson((await this.#run(["status", "--json"])).stdout, "Tailscale 状态命令");
    } catch (error) {
      return baseStatus({
        installed: true,
        version,
        message: `Tailscale 服务不可用：${safeCommandError(error)}`,
        error: serializeTailscaleError(error),
      });
    }

    const backendState = typeof network.BackendState === "string" ? network.BackendState : "Unknown";
    const dnsName = normalizedDnsName(network.Self?.DNSName);
    const connected = backendState === "Running" && network.Self?.Online !== false;
    if (!connected) {
      const needsLogin = /needslogin|nologin/i.test(backendState);
      return baseStatus({
        installed: true,
        version: version ?? network.Version ?? null,
        backendState,
        dnsName: dnsName || null,
        message: needsLogin
          ? "Tailscale 已安装，但尚未登录。请先在 Tailscale 客户端完成登录。"
          : "Tailscale 已安装，但当前未连接。请先启动并连接 Tailscale。",
      });
    }

    let config = {};
    try {
      config = parseJson((await this.#run(["funnel", "status", "--json"])).stdout, "Funnel 状态命令");
    } catch (error) {
      const detail = safeCommandError(error);
      if (!/no (serve|funnel) config|not configured|empty/i.test(detail)) {
        return baseStatus({
          installed: true,
          connected: true,
          version: version ?? network.Version ?? null,
          backendState,
          dnsName: dnsName || null,
          message: `无法读取 Funnel 状态：${detail}`,
          error: serializeTailscaleError(error),
        });
      }
    }

    const route = activeFunnelRoute(config);
    const expectedTarget = `http://127.0.0.1:${targetPort}`;
    const active = route.allowed && route.target === expectedTarget;
    const conflict = route.allowed && Boolean(route.target) && route.target !== expectedTarget;
    const publicHostname = route.hostname || dnsName;
    const publicUrl = publicHostname
      ? `https://${publicHostname}${route.httpsPort && route.httpsPort !== 443 ? `:${route.httpsPort}` : ""}`
      : null;
    const online = active && connected;

    let message = "Tailscale 已连接，可以开启免费公网 Host。";
    if (active) message = "公网 Host 已开启，其他设备可以使用下面的 base_url。";
    else if (conflict) message = `端口 443 的 Funnel 已用于其他本机服务（${route.target}），本程序不会覆盖它。`;
    else if (route.allowed) message = "Funnel 已开启，但没有可识别的根路径 HTTP 代理。";

    return baseStatus({
      installed: true,
      connected: true,
      backendState,
      version: version ?? network.Version ?? null,
      dnsName: publicHostname || null,
      active,
      online,
      conflict,
      target: route.target,
      targetPort: route.targetPort,
      publicUrl: active ? publicUrl : null,
      baseUrl: active && publicUrl ? `${publicUrl}/v1` : null,
      hasOtherHandlers: route.hasOtherHandlers,
      message,
    });
  }

  async enable(port) {
    let current = await this.status(port);
    if (!current.installed) {
      throw new TailscaleFunnelError(
        "TAILSCALE_NOT_INSTALLED",
        current.message,
        { actionUrl: "https://tailscale.com/download/windows" },
      );
    }
    if (!current.connected) {
      try {
        await this.#run(["up", "--timeout=60s"], { timeoutMs: 75_000 });
      } catch (error) {
        const detail = safeCommandError(error);
        const permission = /administrator|elevat|permission|access (?:is )?denied/i.test(detail);
        throw new TailscaleFunnelError(
          permission ? "TAILSCALE_ADMIN_REQUIRED" : "TAILSCALE_CONNECT_FAILED",
          permission
            ? "连接 Tailscale 需要管理员权限，请打开 Tailscale 客户端完成登录和连接。"
            : `无法连接 Tailscale：${detail}`,
          { cause: error, actionUrl: firstWebUrl(detail) },
        );
      }
      current = await this.status(port);
      if (!current.connected) {
        throw new TailscaleFunnelError("TAILSCALE_NOT_CONNECTED", current.message);
      }
    }
    if (current.conflict) {
      throw new TailscaleFunnelError("TAILSCALE_FUNNEL_CONFLICT", current.message);
    }
    if (current.active) return current;

    const target = `http://127.0.0.1:${Number(port)}`;
    try {
      await this.#run(["funnel", "--bg", "--yes", `--https=${PUBLIC_HTTPS_PORT}`, target], { timeoutMs: 60_000 });
    } catch (error) {
      const detail = safeCommandError(error);
      const actionUrl = firstWebUrl(detail);
      const permission = /administrator|elevat|permission|access (?:is )?denied/i.test(detail);
      throw new TailscaleFunnelError(
        permission ? "TAILSCALE_ADMIN_REQUIRED" : "TAILSCALE_ENABLE_FAILED",
        permission
          ? "开启 Funnel 需要管理员权限。请以管理员身份运行 Tailscale，或在管理员终端中完成首次 Funnel 授权。"
          : `无法开启 Tailscale Funnel：${detail}`,
        { cause: error, actionUrl },
      );
    }

    const updated = await this.status(port);
    if (!updated.active) {
      throw new TailscaleFunnelError(
        "TAILSCALE_ENABLE_UNVERIFIED",
        updated.message || "Funnel 命令已完成，但未能验证公网 Host 状态。",
      );
    }
    this.lastRepairAt = null;
    return updated;
  }

  async disable(port) {
    const current = await this.status(port);
    if (!current.installed || !current.connected || !current.active) return current;
    try {
      await this.#run(["funnel", "--yes", `--https=${PUBLIC_HTTPS_PORT}`, "off"]);
    } catch (error) {
      const detail = safeCommandError(error);
      const permission = /administrator|elevat|permission|access (?:is )?denied/i.test(detail);
      throw new TailscaleFunnelError(
        permission ? "TAILSCALE_ADMIN_REQUIRED" : "TAILSCALE_DISABLE_FAILED",
        permission
          ? "关闭 Funnel 需要管理员权限，请以管理员身份运行 Tailscale 后重试。"
          : `无法关闭 Tailscale Funnel：${detail}`,
        { cause: error, actionUrl: firstWebUrl(detail) },
      );
    }
    const updated = await this.status(port);
    if (!updated.active) this.lastRepairAt = null;
    return updated;
  }

  async repair(port) {
    const current = await this.status(port);
    if (!current.installed || !current.connected || !current.active || current.conflict) {
      throw new TailscaleFunnelError(
        "TAILSCALE_REPAIR_UNAVAILABLE",
        current.message || "当前 Funnel 路由无法自动修复。",
      );
    }
    const now = this.now();
    if (this.lastRepairAt !== null && now - this.lastRepairAt < this.repairCooldownMs) {
      const waitMinutes = Math.max(1, Math.ceil((this.repairCooldownMs - (now - this.lastRepairAt)) / 60_000));
      throw new TailscaleFunnelError(
        "TAILSCALE_REPAIR_COOLDOWN",
        `Funnel 已在最近自动修复过；为避免频繁重建 TLS 路由，请在 ${waitMinutes} 分钟后重试。`,
      );
    }
    const target = `http://127.0.0.1:${Number(port)}`;
    try {
      await this.#run(["funnel", "--yes", `--https=${PUBLIC_HTTPS_PORT}`, "off"]);
      await this.#run(
        ["funnel", "--bg", "--yes", `--https=${PUBLIC_HTTPS_PORT}`, target],
        { timeoutMs: 60_000 },
      );
    } catch (error) {
      const detail = safeCommandError(error);
      const permission = /administrator|elevat|permission|access (?:is )?denied/i.test(detail);
      throw new TailscaleFunnelError(
        permission ? "TAILSCALE_ADMIN_REQUIRED" : "TAILSCALE_REPAIR_FAILED",
        permission
          ? "自动修复 Funnel 需要管理员权限，请打开 Tailscale 客户端后重试。"
          : `无法自动修复 Tailscale Funnel：${detail}`,
        { cause: error, actionUrl: firstWebUrl(detail) },
      );
    }

    const updated = await this.status(port);
    if (!updated.active) {
      throw new TailscaleFunnelError(
        "TAILSCALE_REPAIR_UNVERIFIED",
        updated.message || "Funnel 已重新配置，但无法确认路由恢复。",
      );
    }
    this.lastRepairAt = now;
    return updated;
  }
}
