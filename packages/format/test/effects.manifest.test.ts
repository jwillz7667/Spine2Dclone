import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateProjectManifest } from '../src/effects/validate/manifest';
import type { ResolvedMemberHashes } from '../src/effects/validate/manifest';

// WP-3.0 TASK-3.0.6: the ProjectManifest validator. Structural shape, then integrity against a
// caller-supplied resolver (member path -> recomputed content hash, or null when absent). The
// validator is a pure function: the test plays the role the FS-bearing caller plays in production.
function loadManifest(fileName: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/manifest/${fileName}`, import.meta.url), 'utf8'),
  );
}

const valid = loadManifest('valid.project.json');

// The hashes the manifest lists for its two members (from the generator).
const SKEL_HASH = 'b'.repeat(64);
const FX_HASH = JSON.parse(
  readFileSync(new URL('./fixtures/effects/minimal.fx.json', import.meta.url), 'utf8'),
).hash;

describe('project manifest', () => {
  it('accepts a manifest whose members all resolve with matching hashes', () => {
    const resolved: ResolvedMemberHashes = {
      'demo.skel.json': SKEL_HASH,
      'demo.fx.json': FX_HASH,
    };
    const report = validateProjectManifest(valid, resolved);
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.manifest).not.toBeNull();
  });

  it('validates shape only when no resolver is supplied', () => {
    const report = validateProjectManifest(valid);
    expect(report.ok).toBe(true);
  });

  it('rejects a dangling member (listed but unresolved) with PROJECT_MEMBER_MISSING and a path', () => {
    const resolved: ResolvedMemberHashes = {
      'demo.skel.json': SKEL_HASH,
      'demo.fx.json': null, // absent / unreadable
    };
    const report = validateProjectManifest(valid, resolved);
    expect(report.ok).toBe(false);
    const error = report.errors.find((e) => e.code === 'PROJECT_MEMBER_MISSING');
    expect(error?.path).toBe('/members/1/path');
  });

  it('rejects a content-hash mismatch with PROJECT_MEMBER_HASH_MISMATCH and a path', () => {
    const resolved: ResolvedMemberHashes = {
      'demo.skel.json': SKEL_HASH,
      'demo.fx.json': 'c'.repeat(64), // drifted
    };
    const report = validateProjectManifest(valid, resolved);
    expect(report.ok).toBe(false);
    const error = report.errors.find((e) => e.code === 'PROJECT_MEMBER_HASH_MISMATCH');
    expect(error?.path).toBe('/members/1/hash');
  });

  it('rejects a malformed manifest shape with PROJECT_SCHEMA_SHAPE', () => {
    const report = validateProjectManifest(loadManifest('PROJECT_SCHEMA_SHAPE.json'));
    expect(report.ok).toBe(false);
    expect(report.errors.map((e) => e.code)).toContain('PROJECT_SCHEMA_SHAPE');
  });
});
