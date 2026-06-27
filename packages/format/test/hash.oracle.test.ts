import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJsonExcludingKey } from '../src/hash/canonicalize';
import { computeContentHash } from '../src/hash/hash';
import minimal from './fixtures/minimal.json';
import { cloneMinimal } from './helpers';

// Independent SHA-256 from Node's built-in crypto (a different implementation than @noble/hashes).
function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

// WP-0.3: the content hash is verified against an INDEPENDENT oracle, not only against a value this
// same code produced. The canonical string is pinned by hand to the format-contract section 9.2 rules
// (keys sorted ascending recursively, array order preserved, -0 normalized to 0, undefined skipped,
// the named field excluded), and the digest is cross-checked with node:crypto.
describe('content hash oracle', () => {
  it('canonicalizes by the section 9.2 rules (hand-computed expected string)', () => {
    const canonical = canonicalJsonExcludingKey(
      { b: 2, a: 1, hash: 'excluded', c: { y: -0, x: [3, 1, 2] }, d: undefined },
      'hash',
    );

    expect(canonical).toBe('{"a":1,"b":2,"c":{"x":[3,1,2],"y":0}}');
  });

  it('agrees with node:crypto over the canonical bytes of the minimal document', () => {
    const canonical = canonicalJsonExcludingKey({ ...minimal }, 'hash');
    const independent = sha256Hex(canonical);

    expect(computeContentHash(cloneMinimal())).toBe(independent);
    expect(minimal.hash).toBe(independent);
  });

  it('treats negative zero as zero (hash unaffected)', () => {
    const withZero = cloneMinimal();
    const withNegativeZero = cloneMinimal();
    withZero.bones[0]!.x = 0;
    withNegativeZero.bones[0]!.x = -0;

    expect(computeContentHash(withNegativeZero)).toBe(computeContentHash(withZero));
  });
});
