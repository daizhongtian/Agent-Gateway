import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ignoredDirectories = new Set([
  ".git", ".cache", ".m2-local", ".tmp", "artifacts", "coverage", "dist", "node_modules",
  "release", "release-staging", "target", "test-results",
]);
const ignoredFiles = new Set([".env"]);
const textExtensions = new Set([
  "", ".cjs", ".css", ".dockerignore", ".example", ".gitignore", ".html", ".java", ".js",
  ".json", ".md", ".mjs", ".properties", ".ps1", ".sql", ".svg", ".ts", ".tsx", ".txt",
  ".xml", ".yaml", ".yml",
]);

async function collectTextFiles(directory, root = directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    if (entry.isFile() && ignoredFiles.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectTextFiles(absolute, root));
    else if (entry.isFile() && textExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push({ absolute, relative: path.relative(root, absolute).replaceAll("\\", "/") });
    }
  }
  return files;
}

function requireText(source, expected, label, failures) {
  if (!source.includes(expected)) failures.push(`${label} must contain ${JSON.stringify(expected)}`);
}

export async function runStaticSecurityCheck(root = repositoryRoot) {
  const failures = [];
  const files = await collectTextFiles(root);
  const secretPatterns = [
    ["Gateway Key", /ccc_live_[A-Za-z0-9_-]{32,}/g],
    ["OpenAI-style secret", /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g],
    ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
    ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/g],
  ];
  for (const file of files) {
    const source = await readFile(file.absolute, "utf8");
    for (const [label, pattern] of secretPatterns) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        const documentedPlaceholder = label === "Gateway Key"
          && match[0] === "ccc_live_GatewayKeyAssignedByTheHostAdmin";
        if (!documentedPlaceholder) {
          failures.push(`${file.relative}:${source.slice(0, match.index).split(/\r?\n/).length} contains a possible ${label}`);
        }
      }
    }
  }

  const electronMain = await readFile(path.join(root, "src/electron/main.js"), "utf8");
  requireText(electronMain, "contextIsolation: true", "Electron BrowserWindow", failures);
  requireText(electronMain, "sandbox: true", "Electron BrowserWindow", failures);
  requireText(electronMain, "nodeIntegration: false", "Electron BrowserWindow", failures);
  requireText(electronMain, "webSecurity: true", "Electron BrowserWindow", failures);
  requireText(electronMain, "setWindowOpenHandler", "Electron external navigation guard", failures);
  requireText(electronMain, 'on("will-navigate"', "Electron navigation guard", failures);

  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const fuses = packageJson.build?.electronFuses ?? {};
  if (fuses.enableNodeOptionsEnvironmentVariable !== false) failures.push("Electron NODE_OPTIONS fuse must be disabled");
  if (fuses.enableNodeCliInspectArguments !== false) failures.push("Electron CLI inspect fuse must be disabled");
  if (fuses.enableEmbeddedAsarIntegrityValidation !== true) failures.push("Electron ASAR integrity validation must be enabled");
  if (fuses.onlyLoadAppFromAsar !== true) failures.push("Electron must load application code only from ASAR");

  const rootDockerfile = await readFile(path.join(root, "Dockerfile"), "utf8");
  const backendDockerfile = await readFile(path.join(root, "platform/backend/Dockerfile"), "utf8");
  const compose = await readFile(path.join(root, "platform/compose.yaml"), "utf8");
  const frontendDockerfile = await readFile(path.join(root, "platform/frontend/Dockerfile"), "utf8");
  const nginx = await readFile(path.join(root, "platform/frontend/nginx.conf"), "utf8");
  const wrapperProperties = await readFile(path.join(root,
    "platform/backend/.mvn/wrapper/maven-wrapper.properties"), "utf8");
  const gitignore = await readFile(path.join(root, ".gitignore"), "utf8");
  requireText(rootDockerfile, "USER node", "Desktop Gateway Dockerfile", failures);
  requireText(backendDockerfile, "USER platform", "Platform backend Dockerfile", failures);
  requireText(compose, '"127.0.0.1:${POSTGRES_PORT:-5432}:5432"', "PostgreSQL development port", failures);
  requireText(compose, '"127.0.0.1:${PLATFORM_PORT:-8088}:8080"', "Platform development port", failures);
  requireText(compose, "no-new-privileges:true", "Platform containers", failures);
  for (const [label, dockerfile] of [
    ["Desktop Gateway Dockerfile", rootDockerfile],
    ["Platform backend Dockerfile", backendDockerfile],
    ["Platform frontend Dockerfile", frontendDockerfile],
  ]) {
    for (const line of dockerfile.split(/\r?\n/).filter((entry) => /^FROM\s+/i.test(entry))) {
      if (!/@sha256:[a-f0-9]{64}(?:\s|$)/i.test(line)) failures.push(`${label} has an unpinned base image: ${line}`);
    }
  }
  requireText(compose, "postgres:18-alpine@sha256:", "PostgreSQL container", failures);
  requireText(nginx, "proxy_set_header X-Forwarded-For $remote_addr;", "Reverse proxy client address", failures);
  if (nginx.includes("$proxy_add_x_forwarded_for")) failures.push("Reverse proxy must overwrite, not append, untrusted X-Forwarded-For");
  requireText(wrapperProperties, "wrapperSha256Sum=", "Maven Wrapper JAR", failures);
  requireText(gitignore, ".env.*", "Git ignore policy", failures);

  for (const workflowName of ["ci.yml", "release.yml", "security.yml", "security-nightly.yml"]) {
    const workflow = await readFile(path.join(root, ".github/workflows", workflowName), "utf8");
    for (const match of workflow.matchAll(/^\s*uses:\s*[^@\s]+@([^\s#]+)/gm)) {
      if (!/^[a-f0-9]{40}$/i.test(match[1])) {
        failures.push(`.github/workflows/${workflowName} uses a mutable action reference: ${match[0].trim()}`);
      }
    }
  }

  const securityConfiguration = await readFile(path.join(root,
    "platform/backend/src/main/java/com/codexcontrol/platform/security/SecurityConfiguration.java"), "utf8");
  requireText(securityConfiguration, '.requestMatchers("/api/v1/admin/**").hasRole("ADMIN")', "Admin API policy", failures);
  requireText(securityConfiguration, ".anyRequest().authenticated()", "Platform default authorization policy", failures);
  requireText(securityConfiguration, "frame-ancestors 'none'", "Platform CSP", failures);

  return { failures, filesScanned: files.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runStaticSecurityCheck();
  if (result.failures.length) {
    for (const failure of result.failures) console.error(`ERROR: ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`Static security checks passed across ${result.filesScanned} text files.`);
  }
}
