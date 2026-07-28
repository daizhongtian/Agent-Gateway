import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { validateConfiguration } = require("app-builder-lib/out/util/config/config.js");
const fromRoot = (...segments) => path.join(projectRoot, ...segments);
const packageJson = JSON.parse(readFileSync(fromRoot("package.json"), "utf8"));
const packageLock = JSON.parse(readFileSync(fromRoot("package-lock.json"), "utf8"));
const build = packageJson.build ?? {};
const nsis = build.nsis ?? {};
const portable = build.portable ?? {};

assert.match(packageJson.version, /^\d+\.\d+\.\d+$/, "package version must be a stable semver");
assert.equal(packageJson.private, true, "private=true must remain enabled to prevent accidental npm publication");
assert.equal(packageJson.license, "MIT", "package license must match LICENSE");
assert.match(readFileSync(fromRoot("LICENSE"), "utf8"), /^MIT License/m, "LICENSE must contain the MIT license");
assert.equal(packageLock.version, packageJson.version, "package-lock version must match package.json");
assert.equal(packageLock.packages?.[""]?.version, packageJson.version, "lockfile root version must match package.json");
assert.equal(packageLock.packages?.[""]?.license, "MIT", "lockfile root license must be MIT");
assert.match(packageJson.repository?.url ?? "", /daizhongtian\/Agent-Gateway(?:\.git)?$/i, "repository metadata is missing");
assert.match(packageJson.homepage ?? "", /^https:\/\/github\.com\/daizhongtian\/Agent-Gateway/i, "homepage metadata is missing");
assert.match(packageJson.bugs?.url ?? "", /^https:\/\/github\.com\/daizhongtian\/Agent-Gateway\/issues\/?$/i, "bugs metadata is missing");
assert.ok(packageJson.author?.name, "author metadata is missing");
assert.ok(packageJson.copyright, "copyright metadata is missing");

assert.equal(build.directories?.output, "release", "all distributables must be written to release/");
assert.equal(build.directories?.buildResources, "build", "build resources directory must be build/");
assert.equal(build.win?.icon, "build/icon.ico", "Windows builds must use the release ICO");
assert.deepEqual(
  (build.win?.target ?? []).map((entry) => entry.target).sort(),
  ["nsis", "portable"],
  "Windows targets must include NSIS and portable",
);
assert.equal(nsis.oneClick, false, "the NSIS installer must be assisted");
assert.equal(nsis.perMachine, false, "the installer must default to per-user installation");
assert.equal(nsis.selectPerMachineByDefault, false, "per-user installation must be the default");
assert.equal(nsis.allowElevation, false, "the normal installer flow must not require administrator elevation");
assert.equal(nsis.allowToChangeInstallationDirectory, true, "users must be able to choose the install directory");
assert.equal(nsis.createDesktopShortcut, true, "the installer must create a desktop shortcut");
assert.equal(nsis.createStartMenuShortcut, true, "the installer must create a Start menu shortcut");
assert.equal(nsis.displayLanguageSelector, true, "the installer must allow language selection");
assert.equal(nsis.multiLanguageInstaller, true, "the installer must embed multiple languages");
assert.deepEqual([...nsis.installerLanguages].sort(), ["en_US", "zh_CN"], "the installer must include English and Simplified Chinese");
assert.equal(nsis.deleteAppDataOnUninstall, false, "installer upgrades/uninstalls must preserve userData");
assert.match(nsis.artifactName ?? "", /Setup.*\$\{version\}.*\$\{arch\}/, "setup artifactName must contain version and architecture");
assert.match(portable.artifactName ?? "", /Portable.*\$\{version\}.*\$\{arch\}/, "portable artifactName must contain version and architecture");
assert.equal(portable.requestExecutionLevel, "user", "portable build must run as the current user");
assert.ok(
  (build.asarUnpack ?? []).some((pattern) => /@openai\/codex-win32-/u.test(pattern)),
  "Windows Codex native runtimes must be unpacked from app.asar",
);
assert.ok(
  (build.extraResources ?? []).some((entry) => entry?.from === "build/icon.ico" && entry?.to === "icon.ico"),
  "the Windows tray icon must be copied to resources/icon.ico",
);

for (const script of ["dist:portable", "dist:setup", "dist:all", "check:release"]) {
  assert.ok(packageJson.scripts?.[script], `missing npm script: ${script}`);
}
for (const file of [
  "build/icon.svg",
  "build/icon.ico",
  "PRIVACY.md",
  "SECURITY.md",
  "THIRD_PARTY_NOTICES.md",
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
]) {
  assert.ok(existsSync(fromRoot(file)), `missing release file: ${file}`);
}

const thirdPartyNotices = readFileSync(fromRoot("THIRD_PARTY_NOTICES.md"), "utf8");
assert.ok(
  thirdPartyNotices.includes(`Generated from \`package-lock.json\` for Agent Gateway v${packageJson.version}.`),
  `THIRD_PARTY_NOTICES.md must identify v${packageJson.version}; run npm run generate:notices`,
);
for (const [lockPath, metadata] of Object.entries(packageLock.packages ?? {})) {
  if (!lockPath.startsWith("node_modules/") || metadata.dev === true) continue;
  const leaf = lockPath.replaceAll("\\", "/").split("node_modules/").at(-1).split("/");
  const packageName = leaf[0].startsWith("@") ? `${leaf[0]}/${leaf[1]}` : leaf[0];
  assert.ok(
    thirdPartyNotices.includes(`| \`${packageName}\` | \`${metadata.version}\` |`),
    `THIRD_PARTY_NOTICES.md is missing ${packageName}@${metadata.version}; run npm run generate:notices`,
  );
}

const ico = readFileSync(fromRoot("build/icon.ico"));
assert.ok(ico.length > 10_000, "build/icon.ico is unexpectedly small");
assert.equal(ico.readUInt16LE(0), 0, "invalid ICO reserved field");
assert.equal(ico.readUInt16LE(2), 1, "invalid ICO type");
assert.ok(ico.readUInt16LE(4) >= 7, "ICO must contain multiple Windows icon sizes");

if (process.env.GITHUB_REF_TYPE === "tag") {
  assert.equal(process.env.GITHUB_REF_NAME, `v${packageJson.version}`, "release tag must match package version");
}

await validateConfiguration(build, { isEnabled: false, add() {} });

console.log(`Release configuration and electron-builder schema are valid for Agent Gateway v${packageJson.version}.`);
