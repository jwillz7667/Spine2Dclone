// Phase-0 forbidden-package guard (LAW 5, phase-0-foundations.md section 7).
// Fails if any directory under packages/, apps/, or runtimes/ falls outside the Phase-0
// allowed set. This is the CI half of "build in order, do not scaffold everything at once".
//
// Exposed as a pure function (findForbiddenPackages) so it is unit-tested, plus a CLI wrapper.

import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ALLOWED = {
  packages: new Set(['format', 'runtime-core', 'runtime-web']),
  apps: new Set(['editor']),
  runtimes: new Set(), // Unity and Godot are Phase 5; none may exist yet.
};

/**
 * Return the list of "<dir>/<name>" workspace directories that are not allowed in Phase 0.
 * @param {string} root repository root
 * @returns {string[]}
 */
export function findForbiddenPackages(root) {
  const violations = [];
  for (const [dir, allow] of Object.entries(ALLOWED)) {
    const abs = join(root, dir);
    if (!existsSync(abs)) continue;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;
      if (!allow.has(entry.name)) violations.push(`${dir}/${entry.name}`);
    }
  }
  return violations;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const root = process.argv[2] ?? join(fileURLToPath(import.meta.url), '..', '..');
  const violations = findForbiddenPackages(root);
  if (violations.length > 0) {
    console.error('package-guard FAILED: directories outside the Phase-0 allowed set:');
    for (const v of violations) console.error(`  ${v}`);
    console.error('\nPhase 0 allows only packages/{format,runtime-core,runtime-web} and apps/editor (LAW 5).');
    process.exit(1);
  }
  console.log('package-guard OK: only Phase-0 packages are present.');
}
