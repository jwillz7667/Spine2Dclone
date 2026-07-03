// Phase-0 forbidden-package guard (LAW 5, phase-0-foundations.md section 7).
// Fails if any directory under packages/, apps/, or runtimes/ falls outside the Phase-0
// allowed set. This is the CI half of "build in order, do not scaffold everything at once".
//
// Exposed as a pure function (findForbiddenPackages) so it is unit-tested, plus a CLI wrapper.

import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ALLOWED = {
  // document-core hosts the renderer-agnostic command/history spine so both the editor and the
  // headless MCP server (WP-M.1) drive the same commands (ADR-0001). mcp-server lands in WP-M.1.
  // conformance is the Phase-1 cross-runtime conformance suite (conformance-and-ci.md WP-V.0): the
  // committed rigs, sample-specs, fixtures generated from runtime-core, and the compare engine.
  packages: new Set([
    'format',
    'runtime-core',
    'runtime-web',
    'document-core',
    'mcp-server',
    'conformance',
    // render-preview is the headless CPU rasterizer for render-to-PNG authoring feedback (ADR-0006):
    // pure TypeScript (format + runtime-core + pngjs), no GL, byte-deterministic. It is the render side
    // of the LLM-authoring loop (the mcp-server render_frame tool consumes it) and depends on nothing
    // beyond the sanctioned solve/format packages, so it joins the allowed set.
    'render-preview',
    // math-bridge is introduced in Phase 4 (the engine OUTCOME boundary: SpinResult + MathEngine +
    // MockMathEngine + the non-transacting real adapter), per phase-4-slot-composer.md section 5.3. It
    // does not exist before Phase 4 (LAW 5); it lands with WP-4.1.
    'math-bridge',
  ]),
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

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const root = process.argv[2] ?? join(fileURLToPath(import.meta.url), '..', '..');
  const violations = findForbiddenPackages(root);
  if (violations.length > 0) {
    console.error('package-guard FAILED: directories outside the Phase-0 allowed set:');
    for (const v of violations) console.error(`  ${v}`);
    console.error(
      '\nThe allowed set is packages/{format,runtime-core,runtime-web,document-core,mcp-server,' +
        'conformance} and apps/editor (LAW 5; document-core/mcp-server per ADR-0001; ' +
        'conformance per conformance-and-ci.md WP-V.0).',
    );
    process.exit(1);
  }
  console.log('package-guard OK: only allowed packages are present.');
}
