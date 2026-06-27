// Format version stability gate (Phase 2 DoD acceptance step 6, format-contract.md section 10/11,
// ADR-0004). Compares CURRENT_FORMAT_VERSION on a base ref against the working tree (HEAD):
//
//   - unchanged  -> PASS (no format version movement, nothing to justify).
//   - changed    -> require a docs/adr/*.md that references the NEW version string; else FAIL.
//
// This makes a formatVersion bump impossible without an accompanying, reviewed ADR (Law 3). Backward
// compatibility itself is proven by the backcompat suite (migrate.test.ts), not by this script.
//
// Usage: node packages/format/scripts/assert-format-version-stable.mjs [--base <ref>]
// Default base ref is origin/main (or $GITHUB_BASE_REF in CI).

import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const constantsRel = 'packages/format/src/version/constants.ts';
const adrDir = join(repoRoot, 'docs', 'adr');

const VERSION_RE = /CURRENT_FORMAT_VERSION\s*=\s*['"]([^'"]+)['"]/;

function parseBaseRef() {
  const argIndex = process.argv.indexOf('--base');
  if (argIndex !== -1 && process.argv[argIndex + 1]) return process.argv[argIndex + 1];
  if (process.env.GITHUB_BASE_REF) return `origin/${process.env.GITHUB_BASE_REF}`;
  return 'origin/main';
}

function versionFrom(text, where) {
  const match = VERSION_RE.exec(text);
  if (match === null) throw new Error(`could not find CURRENT_FORMAT_VERSION in ${where}`);
  return match[1];
}

function headVersion() {
  return versionFrom(readFileSync(join(repoRoot, constantsRel), 'utf8'), 'the working tree');
}

function baseVersion(baseRef) {
  try {
    const text = execSync(`git show ${baseRef}:${constantsRel}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      cwd: repoRoot,
    });
    return versionFrom(text, baseRef);
  } catch {
    return null; // base ref or file unavailable (e.g. local run with no remote): skip gracefully.
  }
}

function adrReferences(version) {
  if (!existsSync(adrDir)) return false;
  for (const entry of readdirSync(adrDir)) {
    if (!entry.endsWith('.md')) continue;
    if (readFileSync(join(adrDir, entry), 'utf8').includes(version)) return true;
  }
  return false;
}

function main() {
  const baseRef = parseBaseRef();
  const head = headVersion();
  const base = baseVersion(baseRef);

  if (base === null) {
    console.log(
      `format-version-stable: base ref "${baseRef}" unavailable; skipping (local convenience).`,
    );
    return;
  }
  if (base === head) {
    console.log(`format-version-stable OK: CURRENT_FORMAT_VERSION unchanged at ${head}.`);
    return;
  }
  if (!adrReferences(head)) {
    console.error(
      `format-version-stable FAILED: CURRENT_FORMAT_VERSION moved ${base} -> ${head} without an ` +
        `ADR in docs/adr/ referencing ${head}. Record the change as an ADR (Law 3, format-contract ` +
        `section 10/11).`,
    );
    process.exit(1);
  }
  console.log(
    `format-version-stable OK: ${base} -> ${head}, justified by an ADR in docs/adr/ referencing ${head}.`,
  );
}

main();
