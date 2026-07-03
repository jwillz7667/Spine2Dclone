// Proves the Phase-0 forbidden-package guard (LAW 5) flags a future-phase package and passes
// on a clean Phase-0 layout. Backs the CI package-guard job.

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findForbiddenPackages } from '../check-packages.mjs';

let root = '';

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
});

describe('findForbiddenPackages (LAW 5)', () => {
  it('flags packages and runtimes outside the allowed set', () => {
    root = mkdtempSync(join(tmpdir(), 'mc-package-guard-'));
    mkdirSync(join(root, 'packages', 'format'), { recursive: true });
    // A package not in the allowed set is flagged. math-bridge is now ALLOWED (it landed in Phase 4,
    // WP-4.1), so a still-forbidden name is used as the example; runtimes are Phase 5 (none yet).
    mkdirSync(join(root, 'packages', 'not-a-real-package'), { recursive: true });
    mkdirSync(join(root, 'runtimes', 'unity'), { recursive: true });

    const violations = findForbiddenPackages(root);

    expect(violations).toContain('packages/not-a-real-package');
    expect(violations).toContain('runtimes/unity');
    expect(violations).not.toContain('packages/format');
  });

  it('passes for a clean allowed layout', () => {
    root = mkdtempSync(join(tmpdir(), 'mc-package-guard-'));
    // document-core and mcp-server are allowed per ADR-0001 (renderer-agnostic command spine plus the
    // headless MCP control surface); conformance is the Phase-1 conformance suite (WP-V.0).
    for (const pkg of [
      'format',
      'runtime-core',
      'runtime-web',
      'document-core',
      'mcp-server',
      'conformance',
      // atlas-pack is the shared deterministic atlas pipeline extracted so the editor main process and
      // the headless MCP atlas.pack tool can both pack (ADR-0007); a leaf over format.
      'atlas-pack',
      // render-preview is the headless CPU rasterizer for render-to-PNG authoring feedback (ADR-0006).
      'render-preview',
      // math-bridge is allowed from Phase 4 (the engine OUTCOME boundary, WP-4.1).
      'math-bridge',
    ]) {
      mkdirSync(join(root, 'packages', pkg), { recursive: true });
    }
    mkdirSync(join(root, 'apps', 'editor'), { recursive: true });

    expect(findForbiddenPackages(root)).toEqual([]);
  });
});
