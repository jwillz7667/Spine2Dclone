// Format semver gate (LAW 3, conformance-and-ci.md WP-V.12) - Phase-0 wiring.
//
// If packages/format/src changed versus the base ref, require an accompanying change to
// CURRENT_FORMAT_VERSION (version/constants.ts, landed in WP-0.3). Phase 0 ships the wiring;
// it is green on a no-op PR and on the foundational commit (no format change). Label-based
// gating (format-break + ADR) is layered on in WP-V.12 hardening once the format surface exists.

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The gate is inactive until the format surface is versioned (CURRENT_FORMAT_VERSION lands in
// WP-0.3). Before then there is no version to bump, so the placeholder format package does not
// trip the gate (this keeps the WP-0.1 PR green while the gate is wired).
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
if (!existsSync(join(repoRoot, 'packages/format/src/version/constants.ts'))) {
  console.log('format-semver: format surface is not yet versioned (pre WP-0.3); gate inactive.');
  process.exit(0);
}

function gitChangedFormatFiles(range) {
  try {
    const out = execSync(`git diff --name-only ${range} -- packages/format/src`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

const baseRef = process.env.GITHUB_BASE_REF
  ? `origin/${process.env.GITHUB_BASE_REF}`
  : process.env.CI
    ? 'origin/main'
    : null;

if (!baseRef) {
  console.log('format-semver: no base ref (local run); nothing to compare.');
  process.exit(0);
}

const changed = gitChangedFormatFiles(`${baseRef}...HEAD`);
if (changed === null) {
  console.log('format-semver: unable to compute a diff against the base ref; skipping.');
  process.exit(0);
}
if (changed.length === 0) {
  console.log('format-semver: no changes under packages/format/src.');
  process.exit(0);
}

const versionBumped = changed.some((f) => f.includes('version/constants.ts'));
if (!versionBumped) {
  console.error('format-semver FAILED: packages/format/src changed without a CURRENT_FORMAT_VERSION bump.');
  console.error('Changed files:');
  for (const f of changed) console.error(`  ${f}`);
  console.error('\nClassify the change MAJOR/MINOR/PATCH (format-contract.md section 10), bump');
  console.error('CURRENT_FORMAT_VERSION with a tested migration and a CHANGELOG entry.');
  process.exit(1);
}
console.log('format-semver OK: format change accompanied by a version bump.');
