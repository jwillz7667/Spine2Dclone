import { describe, expect, it } from 'vitest';
import { computeContentHash } from '../src/hash/hash';
import { isRecord } from '../src/internal/guards';
import type { SkeletonDocument } from '../src/types';
import minimal from './fixtures/minimal.json';
import { cloneMinimal } from './helpers';

// Deeply reverse every object's key insertion order while preserving array order, producing content
// that is identical but serialized in a different key order. The canonical hash must be invariant to
// this; array order, which is semantic, must NOT be touched here.
function deepReverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepReverseKeys);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).reverse()) out[key] = deepReverseKeys(value[key]);
    return out;
  }
  return value;
}

// WP-0.3: content hashing is stable across runs and independent of object key insertion order, but
// it is sensitive to array order (array order is semantic in this format).
describe('content hash stability', () => {
  it('matches the committed hash of the minimal fixture (stable across runs)', () => {
    expect(computeContentHash(cloneMinimal())).toBe(minimal.hash);
  });

  it('is independent of object key insertion order', () => {
    const doc = cloneMinimal();
    const shuffled = deepReverseKeys(doc) as unknown as SkeletonDocument;

    expect(computeContentHash(shuffled)).toBe(computeContentHash(doc));
  });

  it('ignores the existing hash field when computing', () => {
    const withHash = cloneMinimal();
    const withoutHash: SkeletonDocument = { ...withHash, hash: '' };

    expect(computeContentHash(withoutHash)).toBe(computeContentHash(withHash));
  });

  it('changes when the bones array is reordered', () => {
    const doc = cloneMinimal();
    doc.bones.push({ ...doc.bones[0]!, name: 'child', parent: 'root' });
    const reordered: SkeletonDocument = { ...doc, bones: [...doc.bones].reverse() };

    expect(computeContentHash(reordered)).not.toBe(computeContentHash(doc));
  });
});
