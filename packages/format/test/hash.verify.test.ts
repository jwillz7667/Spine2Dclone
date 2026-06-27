import { describe, expect, it } from 'vitest';
import { computeContentHash, verifyContentHash } from '../src/hash/hash';
import { validateDocument } from '../src/validate';
import { cloneMinimal, errorCodes } from './helpers';

// WP-0.3: hash verification on the import boundary. A tampered hash is HASH_MISMATCH; verifyHash:false
// skips the hash layer entirely; an empty hash is an advisory HASH_ABSENT warning, not an error.
describe('content hash verification', () => {
  it('reports HASH_MISMATCH when the stored hash does not match the content', () => {
    const doc = cloneMinimal();
    const firstChar = doc.hash[0] === '0' ? '1' : '0';
    doc.hash = `${firstChar}${doc.hash.slice(1)}`;

    const report = validateDocument(doc);
    expect(report.ok).toBe(false);
    expect(errorCodes(report)).toContain('HASH_MISMATCH');
  });

  it('skips the hash layer entirely when verifyHash is false', () => {
    const doc = cloneMinimal();
    doc.hash = 'deadbeef'.repeat(8); // 64 hex chars, deliberately wrong

    const report = validateDocument(doc, { verifyHash: false });
    expect(report.ok).toBe(true);
    expect(errorCodes(report)).not.toContain('HASH_MISMATCH');
    expect(report.warnings).toEqual([]);
  });

  it('emits a HASH_ABSENT warning (not an error) for an empty hash on a verifyHash path', () => {
    const doc = cloneMinimal();
    doc.hash = '';

    const report = validateDocument(doc);
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.warnings.map((warning) => warning.code)).toEqual(['HASH_ABSENT']);
  });

  it('verifyContentHash round-trips after assigning the computed hash', () => {
    const doc = cloneMinimal();
    doc.hash = '';
    expect(verifyContentHash(doc)).toBe(false);

    doc.hash = computeContentHash(doc);
    expect(verifyContentHash(doc)).toBe(true);
  });
});
