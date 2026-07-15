import { createHash } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import { badRequest, notFound } from "./errors.js";

function comparable(filePath) {
  const normalized = path.resolve(filePath).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function canonicalDirectory(input, field = "path") {
  if (typeof input !== "string" || !input.trim() || input.length > 32_767 || input.includes("\0")) {
    throw badRequest("INVALID_PROJECT_PATH", `${field} must be a valid directory path.`);
  }
  try {
    const canonical = realpathSync.native(path.resolve(input.trim()));
    if (!statSync(canonical).isDirectory()) throw new Error("not a directory");
    return canonical;
  } catch {
    throw badRequest("INVALID_PROJECT_PATH", "The project directory does not exist or is not accessible.");
  }
}

function isWithin(candidate, root) {
  const child = comparable(candidate);
  const parent = comparable(root);
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

function safeName(value, directory) {
  if (value === undefined || value === null || value === "") return path.basename(directory) || directory;
  if (typeof value !== "string" || !value.trim() || value.length > 120 || /[\r\n\0]/.test(value)) {
    throw badRequest("INVALID_PROJECT_NAME", "name must be a non-empty single-line string up to 120 characters.");
  }
  return value.trim();
}

export class ProjectRegistry {
  constructor(options = {}) {
    this.projects = new Map();
    this.byPath = new Map();
    this.roots = [];
    this.selectedProjectIds = new Map();
    for (const root of options.allowedRoots ?? []) this.addAllowedRoot(root);
    for (const project of options.initialProjects ?? []) {
      const input = typeof project === "string" ? { path: project } : project;
      this.register(input, { ownerId: "local-desktop" });
    }
  }

  addAllowedRoot(root) {
    const canonical = canonicalDirectory(root, "allowed root");
    if (!this.roots.some((current) => comparable(current) === comparable(canonical))) this.roots.push(canonical);
    return canonical;
  }

  #assertAllowed(directory) {
    if (this.roots.length && !this.roots.some((root) => isWithin(directory, root))) {
      throw badRequest("PROJECT_PATH_NOT_ALLOWED", "The project is outside the configured allowed roots.");
    }
  }

  register(input = {}, context = {}) {
    const ownerId = context.ownerId ?? "local-desktop";
    const directory = canonicalDirectory(input.path);
    this.#assertAllowed(directory);
    const pathKey = `${ownerId}\0${comparable(directory)}`;
    const existingId = this.byPath.get(pathKey);
    if (existingId) {
      const existing = this.projects.get(existingId);
      if (input.name !== undefined) existing.name = safeName(input.name, directory);
      return this.public(existing, context);
    }

    const id = `project_${createHash("sha256").update(pathKey).digest("hex").slice(0, 20)}`;
    const project = {
      id,
      ownerId,
      name: safeName(input.name, directory),
      path: directory,
      createdAt: new Date().toISOString(),
    };
    this.projects.set(id, project);
    this.byPath.set(pathKey, id);
    if (!this.selectedProjectIds.has(ownerId)) this.selectedProjectIds.set(ownerId, id);
    return this.public(project, context);
  }

  get(id, context = {}) {
    const project = this.projects.get(id);
    if (!project) throw notFound("Project not found.");
    if (!context.allowAll && project.ownerId !== (context.ownerId ?? "local-desktop")) {
      throw notFound("Project not found.");
    }
    return project;
  }

  getByPath(projectPath, context = {}) {
    const ownerId = context.ownerId ?? "local-desktop";
    const directory = canonicalDirectory(projectPath);
    const id = this.byPath.get(`${ownerId}\0${comparable(directory)}`);
    if (!id) throw badRequest("PROJECT_NOT_REGISTERED", "Register this project before creating a task.");
    return this.get(id, context);
  }

  resolve(input = {}, context = {}) {
    const ownerId = context.ownerId ?? "local-desktop";
    if (input.projectId) return this.get(input.projectId, context);
    if (input.projectPath) return this.getByPath(input.projectPath, context);
    const selectedProjectId = this.selectedProjectIds.get(ownerId);
    if (selectedProjectId) return this.get(selectedProjectId, context);
    throw badRequest("PROJECT_REQUIRED", "A registered project is required.");
  }

  select(input = {}, context = {}) {
    const project = input.id || input.projectId
      ? this.get(input.id ?? input.projectId, context)
      : this.getByPath(input.path, context);
    this.selectedProjectIds.set(project.ownerId, project.id);
    return this.public(project, context);
  }

  list(context = {}) {
    const ownerId = context.ownerId ?? "local-desktop";
    return [...this.projects.values()]
      .filter((project) => context.allowAll || project.ownerId === ownerId)
      .map((project) => this.public(project, context));
  }

  revalidate(projectOrId, context = {}) {
    const project = typeof projectOrId === "string" ? this.get(projectOrId, context) : projectOrId;
    const canonical = canonicalDirectory(project.path);
    this.#assertAllowed(canonical);
    if (comparable(canonical) !== comparable(project.path)) {
      throw badRequest("PROJECT_PATH_CHANGED", "The project path now resolves to a different location.");
    }
    return project;
  }

  public(project, context = {}) {
    return {
      id: project.id,
      name: project.name,
      path: project.path,
      createdAt: project.createdAt,
      selected: project.id === this.selectedProjectIds.get(project.ownerId),
    };
  }
}
