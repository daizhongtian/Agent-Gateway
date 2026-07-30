import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const allowedMethods = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

export function parseOpenApiOperations(source) {
  const operations = [];
  let currentPath = null;
  let currentMethod = null;
  for (const line of source.split(/\r?\n/)) {
    const pathMatch = /^  (\/[^:]+):\s*$/.exec(line);
    if (pathMatch) {
      currentPath = pathMatch[1];
      currentMethod = null;
      continue;
    }
    const methodMatch = /^    ([a-z]+):\s*$/.exec(line);
    if (methodMatch && allowedMethods.has(methodMatch[1])) {
      currentMethod = methodMatch[1].toUpperCase();
      continue;
    }
    const operationMatch = /^      operationId:\s*([^\s#]+)\s*$/.exec(line);
    if (operationMatch && currentPath && currentMethod) {
      operations.push({ operationId: operationMatch[1], method: currentMethod, path: currentPath });
    }
  }
  return operations;
}

export async function validateApiPermissionMatrix(root = repositoryRoot) {
  const matrixPath = path.join(root, "security", "API_PERMISSION_MATRIX.json");
  const matrix = JSON.parse(await readFile(matrixPath, "utf8"));
  const failures = [];
  const knownIds = new Set();

  for (const [serviceName, service] of Object.entries(matrix.services ?? {})) {
    const specPath = path.join(root, service.openapi);
    const documented = parseOpenApiOperations(await readFile(specPath, "utf8"));
    const declared = new Map();
    for (const policy of service.operations ?? []) {
      if (declared.has(policy.operationId) || knownIds.has(policy.operationId)) {
        failures.push(`Duplicate permission policy: ${policy.operationId}`);
      }
      declared.set(policy.operationId, policy);
      knownIds.add(policy.operationId);
      if (!policy.auth || !policy.ownership || !policy.rateLimit) {
        failures.push(`${serviceName}:${policy.operationId} must declare auth, ownership, and rateLimit`);
      }
      if (policy.auth === "public" && (policy.scope || policy.role)) {
        failures.push(`${serviceName}:${policy.operationId} is public but declares an authenticated scope or role`);
      }
    }
    for (const operation of documented) {
      if (!declared.has(operation.operationId)) {
        failures.push(`${serviceName}:${operation.method} ${operation.path} (${operation.operationId}) has no permission policy`);
      }
    }
    const documentedIds = new Set(documented.map((operation) => operation.operationId));
    for (const operationId of declared.keys()) {
      if (!documentedIds.has(operationId)) failures.push(`${serviceName}:${operationId} is not present in ${service.openapi}`);
    }
    if (documentedIds.size !== documented.length) failures.push(`${serviceName}:${service.openapi} contains duplicate operationId values`);
  }

  for (const route of matrix.services?.platform?.runtimeOnly ?? []) {
    if (!route.method || !route.path || !route.auth || !route.ownership || !route.rateLimit) {
      failures.push("Every runtime-only relay route must declare method, path, auth, ownership, and rateLimit");
    }
    if (route.path.includes("/v1/") && route.downstreamAuth !== "gateway_key") {
      failures.push(`${route.method} ${route.path} must preserve downstream Gateway Key authentication`);
    }
  }

  return { failures, operationCount: knownIds.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await validateApiPermissionMatrix();
  if (result.failures.length) {
    for (const failure of result.failures) console.error(`ERROR: ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`API permission matrix covers ${result.operationCount} documented operations.`);
  }
}
