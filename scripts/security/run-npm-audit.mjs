import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const isWindows = process.platform === 'win32';
const npmCommand = isWindows ? (process.env.ComSpec || 'cmd.exe') : 'npm';
const npmArguments = isWindows
  ? ['/d', '/s', '/c', 'npm audit --audit-level=high --json']
  : ['audit', '--audit-level=high', '--json'];
const audit = spawnSync(npmCommand, npmArguments, {
  cwd: repositoryRoot,
  encoding: 'utf8',
  shell: false,
});

if (audit.error) {
  throw audit.error;
}

let report;
try {
  report = JSON.parse(audit.stdout);
} catch (error) {
  process.stderr.write(audit.stdout || audit.stderr);
  throw new Error(`npm audit did not return valid JSON: ${error.message}`);
}

if (audit.status === 0) {
  console.log('Root JavaScript dependency audit passed.');
  process.exit(0);
}

if (audit.status !== 1) {
  process.stderr.write(audit.stderr || audit.stdout);
  process.exit(audit.status ?? 1);
}

const vulnerabilities = report.vulnerabilities ?? {};
const braceFinding = vulnerabilities['brace-expansion'];
const advisoryUrl = 'https://github.com/advisories/GHSA-mh99-v99m-4gvg';
const directAdvisories = Object.values(vulnerabilities).flatMap((finding) => (
  finding.via?.filter((entry) => typeof entry === 'object') ?? []
));
const lock = JSON.parse(readFileSync(path.join(repositoryRoot, 'package-lock.json'), 'utf8'));

function compareVersion(left, right) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function isPatchedBraceExpansion(version) {
  const major = Number(version.split('.')[0]);
  const minimumByMajor = new Map([
    [1, '1.1.18'],
    [2, '2.1.4'],
    [3, '3.0.6'],
    [5, '5.0.8'],
  ]);
  if (major > 5) return true;
  const minimum = minimumByMajor.get(major);
  return Boolean(minimum && compareVersion(version, minimum) >= 0);
}

const braceNodes = braceFinding?.nodes ?? [];
const patchedNodes = braceNodes.length > 0 && braceNodes.every((node) => {
  const version = lock.packages?.[node]?.version;
  return Boolean(version && isPatchedBraceExpansion(version));
});
const expectedAdvisory = directAdvisories.length > 0
  && directAdvisories.every((entry) => entry.url === advisoryUrl);

// npm's advisory graph can contain cycles (for example app-builder-lib and
// dmg-builder). Reconcile the complete graph only when its sole direct cause is
// the known advisory and every installed instance is a patched backport.
const ignored = new Set(
  braceFinding && expectedAdvisory && patchedNodes ? Object.keys(vulnerabilities) : [],
);

const remaining = Object.keys(vulnerabilities).filter((name) => !ignored.has(name));
if (remaining.length > 0) {
  console.error(`npm audit found unresolved vulnerabilities: ${remaining.join(', ')}`);
  process.exit(1);
}

console.log(
  `Root JavaScript dependency audit passed with ${ignored.size} transitive alerts reconciled `
  + 'to patched brace-expansion maintenance releases pinned in package-lock.json.',
);
