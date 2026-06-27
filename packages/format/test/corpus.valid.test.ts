import { describe, expect, it } from 'vitest';
import { validateDocument } from '../src/validate';
import minimal from './fixtures/minimal.json';

// WP-0.3: the canonical valid fixture passes clean under the default (verifyHash: true) path, with
// zero errors and zero warnings, so its committed content hash is correct.
describe('valid corpus', () => {
  it('minimal.json validates with zero errors and zero warnings', () => {
    const report = validateDocument(minimal);

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.document).not.toBeNull();
  });
});
