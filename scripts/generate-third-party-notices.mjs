import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lockfile = JSON.parse(await readFile(path.join(projectRoot, "package-lock.json"), "utf8"));
const outputPath = path.join(projectRoot, "THIRD_PARTY_NOTICES.md");

function packageNameFromLockPath(lockPath) {
  const leaf = lockPath.replaceAll("\\", "/").split("node_modules/").at(-1);
  const parts = leaf.split("/");
  return parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
}

function markdown(value) {
  return String(value ?? "—").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function repositoryUrl(value) {
  const repository = typeof value === "string" ? value : value?.url;
  if (!repository) return null;
  return repository
    .replace(/^git\+/, "")
    .replace(/^git:\/\/github\.com\//, "https://github.com/")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "");
}

const packages = [];
for (const [lockPath, metadata] of Object.entries(lockfile.packages ?? {})) {
  if (!lockPath.startsWith("node_modules/") || metadata.dev === true) continue;
  const name = packageNameFromLockPath(lockPath);
  const installPath = path.join(projectRoot, lockPath);
  let manifest = {};
  if (existsSync(path.join(installPath, "package.json"))) {
    manifest = JSON.parse(await readFile(path.join(installPath, "package.json"), "utf8"));
  }
  const licenseFiles = [];
  if (existsSync(installPath)) {
    for (const file of await readdir(installPath, { withFileTypes: true })) {
      if (!file.isFile() || !/^(licen[cs]e|copying|notice)(?:\..*)?$/i.test(file.name)) continue;
      const contents = await readFile(path.join(installPath, file.name), "utf8");
      licenseFiles.push({ name: file.name, contents: contents.trim() });
    }
  }
  packages.push({
    name,
    version: metadata.version ?? manifest.version ?? "unknown",
    license: metadata.license ?? manifest.license ?? "UNKNOWN",
    repository: repositoryUrl(manifest.repository) ?? manifest.homepage ?? null,
    bundledOnThisMachine: existsSync(installPath),
    licenseFiles,
  });
}

packages.sort((left, right) => left.name.localeCompare(right.name, "en") || left.version.localeCompare(right.version, "en"));
const lines = [
  "# Third-Party Notices",
  "",
  `Generated from \`package-lock.json\` for Agent Gateway v${lockfile.version}. This list includes all non-development npm packages that can be selected for a production build, including platform-specific optional packages. Electron Builder packages only dependencies applicable to the target platform.`,
  "",
  "The application itself is licensed under the MIT License; see `LICENSE`. Third-party packages remain subject to their own license terms.",
  "",
  "| Package | Version | License | Installed in generation environment | Source |",
  "| --- | --- | --- | --- | --- |",
];

for (const item of packages) {
  const packageCell = `\`${markdown(item.name)}\``;
  const sourceCell = item.repository ? `[source](${item.repository})` : "—";
  lines.push(`| ${packageCell} | \`${markdown(item.version)}\` | ${markdown(item.license)} | ${item.bundledOnThisMachine ? "Yes" : "No (optional platform package)"} | ${sourceCell} |`);
}

lines.push("", "## Included license and notice texts", "");
for (const item of packages.filter((entry) => entry.licenseFiles.length > 0)) {
  lines.push(`### ${item.name} ${item.version}`, "");
  for (const file of item.licenseFiles) {
    lines.push(`#### ${file.name}`, "", "```text", file.contents.replaceAll("```", "` ` `"), "```", "");
  }
}

while (lines.at(-1) === "") lines.pop();
await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
console.log(`Wrote THIRD_PARTY_NOTICES.md for ${packages.length} production package entries.`);
