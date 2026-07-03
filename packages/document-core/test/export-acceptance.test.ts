import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDocument, verifyContentHash } from '@marionette/format';
import type { SkeletonDocument } from '@marionette/format/types';
import { describe, expect, it } from 'vitest';
import { exportDocument, loadDocument } from '../src';
import { makeTestEnv, seeds } from './seeds';

// Ascend from this test file to the monorepo root (the directory owning pnpm-workspace.yaml) so the
// grep below resolves the atlas source regardless of the process cwd (Turbo runs Vitest per package).
function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('repo root (pnpm-workspace.yaml) not found above the test file');
    }
    dir = parent;
  }
  return dir;
}

describe('export acceptance (WP-1.10)', () => {
  it('computes the content hash only in the exporter, never in the atlas pipeline', () => {
    // Hash ownership lives in exportDocument: it stamps the hash exactly once via computeContentHash.
    // The atlas packer is a pure geometry/pixel step and must NOT compute a hash. This reads the pack
    // source as TEXT (not an import: the contract here is about the absence of a call, not behavior), so
    // a future `computeContentHash` call in the packer fails this gate. It lives in document-core because
    // hash ownership is the exporter's contract. The packer moved to the shared @marionette/atlas-pack
    // package (ADR-0007), so the gate reads it there rather than from the editor main process.
    const packSource = readFileSync(
      join(repoRoot(), 'packages', 'atlas-pack', 'src', 'pack.ts'),
      'utf8',
    );

    expect(packSource).not.toContain('computeContentHash');
  });

  it('rejects a tampered export: a stale hash fails verification with HASH_MISMATCH', () => {
    const { model } = loadDocument(seeds.slotted, makeTestEnv().env);
    const exported = exportDocument(model);
    // Precondition (the positive half): a clean export carries a matching hash. The bare round-trip
    // positive (verifyContentHash(exportDocument(model)) === true) is already proven in save-load.test.ts,
    // so this only establishes the tamper baseline rather than duplicating that test.
    expect(verifyContentHash(exported)).toBe(true);

    // Mutate content WITHOUT recomputing the hash, so the stored 64-hex digest goes stale. Flipping a
    // bone rotation keeps the document structurally and semantically valid, so ONLY the hash layer fails
    // (a hash string tampered to a non-64-hex value would fail the schema layer instead, masking the case).
    const firstBone = exported.bones[0]!;
    const tampered: SkeletonDocument = {
      ...exported,
      bones: [{ ...firstBone, rotation: firstBone.rotation + 90 }, ...exported.bones.slice(1)],
    };

    expect(verifyContentHash(tampered)).toBe(false);

    const report = validateDocument(tampered, { verifyHash: true });
    expect(report.ok).toBe(false);
    // HASH_MISMATCH (packages/format FORMAT_ERROR_CODES, emitted by validate/index.ts hashLayer at
    // /hash) is the EXACT code, and it is the ONLY error: the tamper changed content, not shape or refs.
    expect(report.errors.map((error) => error.code)).toEqual(['HASH_MISMATCH']);
    expect(report.errors[0]!.path).toBe('/hash');
  });
});
