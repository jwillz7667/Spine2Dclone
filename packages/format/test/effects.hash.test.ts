import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeEffectsContentHash, verifyEffectsContentHash } from '../src/effects/hash/hash';
import { parseEffectsDocument } from '../src/effects/validate';

// WP-3.0: content-hash support mirroring the skeletal format. The hash is the SHA-256 of the
// canonical JSON with the `hash` field removed (the one canonicalizer in the system), so it is stable
// across runs and excludes itself.
const minimal = JSON.parse(
  readFileSync(new URL('./fixtures/effects/minimal.fx.json', import.meta.url), 'utf8'),
);

describe('effects content hash', () => {
  it('the committed fixture hash matches the recomputed content hash', () => {
    const doc = parseEffectsDocument(minimal);
    expect(verifyEffectsContentHash(doc)).toBe(true);
  });

  it('is stable across repeated computations (deterministic)', () => {
    const doc = parseEffectsDocument(minimal);
    expect(computeEffectsContentHash(doc)).toBe(computeEffectsContentHash(doc));
  });

  it('ignores the stored hash field (self-exclusion)', () => {
    const doc = parseEffectsDocument(minimal);
    const withEmptyHash = { ...doc, hash: '' };
    const withWrongHash = { ...doc, hash: 'd'.repeat(64) };
    expect(computeEffectsContentHash(withEmptyHash)).toBe(computeEffectsContentHash(withWrongHash));
  });

  it('changes when content changes (cache-busting)', () => {
    const doc = parseEffectsDocument(minimal);
    const mutated = { ...doc, name: `${doc.name}-changed` };
    expect(computeEffectsContentHash(mutated)).not.toBe(computeEffectsContentHash(doc));
  });
});
