import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

function comparable(filePath) {
  const normalized = path.resolve(filePath).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isWithin(candidate, root) {
  const child = comparable(candidate);
  const parent = comparable(root);
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

function workspaceError(message) {
  const error = new Error(message);
  error.code = "SCRATCH_WORKSPACE_INVALID";
  return error;
}

export class ScratchWorkspaceManager {
  constructor(options = {}) {
    const requestedRoot = options.root ?? path.join(os.tmpdir(), "codex-control-center", "projectless");
    mkdirSync(requestedRoot, { recursive: true, mode: 0o700 });
    this.root = realpathSync.native(path.resolve(requestedRoot));
    this.active = new Map();
  }

  create(ownerId = "local-desktop") {
    const directory = realpathSync.native(mkdtempSync(path.join(this.root, "task-")));
    if (!isWithin(directory, this.root)) throw workspaceError("The temporary workspace is outside its managed root.");
    const workspace = {
      id: `scratch_${randomUUID()}`,
      ownerId,
      name: "无项目（临时工作区）",
      path: directory,
      createdAt: new Date().toISOString(),
      selected: false,
      projectless: true,
      ephemeral: true,
    };
    this.active.set(workspace.id, directory);
    return workspace;
  }

  revalidate(workspace) {
    const tracked = this.active.get(workspace?.id);
    if (!tracked || comparable(tracked) !== comparable(workspace.path)) {
      throw workspaceError("The temporary workspace is no longer registered.");
    }
    try {
      const canonical = realpathSync.native(tracked);
      if (!statSync(canonical).isDirectory()
        || !isWithin(canonical, this.root)
        || comparable(canonical) !== comparable(tracked)) {
        throw new Error("workspace changed");
      }
    } catch {
      throw workspaceError("The temporary workspace is no longer safe to use.");
    }
    return workspace;
  }

  public(workspace) {
    return {
      id: null,
      name: "无项目",
      path: null,
      createdAt: workspace.createdAt,
      selected: false,
      projectless: true,
      ephemeral: true,
    };
  }

  release(workspace) {
    const directory = this.active.get(workspace?.id);
    if (!directory) return;
    this.active.delete(workspace.id);
    if (!isWithin(directory, this.root)) return;
    try {
      if (existsSync(directory)) {
        const canonical = realpathSync.native(directory);
        if (!isWithin(canonical, this.root) || comparable(canonical) !== comparable(directory)) return;
      }
      rmSync(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 });
    } catch {
      // A locked temporary file may remain until the OS cleans its temp area.
    }
  }

  close() {
    for (const id of [...this.active.keys()]) this.release({ id });
  }
}
