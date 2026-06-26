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
  it('flags packages and runtimes outside the Phase-0 allowed set', () => {
    root = mkdtempSync(join(tmpdir(), 'mc-package-guard-'));
    mkdirSync(join(root, 'packages', 'format'), { recursive: true });
    mkdirSync(join(root, 'packages', 'math-bridge'), { recursive: true });
    mkdirSync(join(root, 'runtimes', 'unity'), { recursive: true });

    const violations = findForbiddenPackages(root);

    expect(violations).toContain('packages/math-bridge');
    expect(violations).toContain('runtimes/unity');
    expect(violations).not.toContain('packages/format');
  });

  it('passes for a clean Phase-0 layout', () => {
    root = mkdtempSync(join(tmpdir(), 'mc-package-guard-'));
    for (const pkg of ['format', 'runtime-core', 'runtime-web']) {
      mkdirSync(join(root, 'packages', pkg), { recursive: true });
    }
    mkdirSync(join(root, 'apps', 'editor'), { recursive: true });

    expect(findForbiddenPackages(root)).toEqual([]);
  });
});
