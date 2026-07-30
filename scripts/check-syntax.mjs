import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoots = ["src", "public", "test", "scripts", "platform/frontend/e2e"];
const extensions = new Set([".js", ".mjs", ".cjs"]);

function collect(directory) {
  const absoluteDirectory = path.join(projectRoot, directory);
  const files = [];
  for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collect(relative));
    else if (entry.isFile() && extensions.has(path.extname(entry.name))) files.push(relative);
  }
  return files;
}

const files = sourceRoots.flatMap(collect).sort((left, right) => left.localeCompare(right, "en"));
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.error) {
    throw new Error(`Syntax checker could not run for ${file}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`Syntax check failed: ${file}`);
  }
}

console.log(`Syntax check passed for ${files.length} JavaScript files.`);
