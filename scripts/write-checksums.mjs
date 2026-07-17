import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDirectory = path.join(projectRoot, "release");
const names = (await readdir(releaseDirectory))
  .filter((name) => name.toLowerCase().endsWith(".exe"))
  .sort((a, b) => a.localeCompare(b, "en"));

if (names.length === 0) {
  throw new Error("No Windows .exe artifacts were found in release/");
}

const lines = [];
for (const name of names) {
  const digest = createHash("sha256").update(await readFile(path.join(releaseDirectory, name))).digest("hex");
  lines.push(`${digest}  ${name}`);
}
await writeFile(path.join(releaseDirectory, "SHA256SUMS.txt"), `${lines.join("\n")}\n`, "utf8");
console.log(`Wrote SHA256SUMS.txt for ${names.length} Windows artifact(s).`);
