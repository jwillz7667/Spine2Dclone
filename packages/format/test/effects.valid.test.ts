import { describe, expect, it } from 'vitest';
import { validateEffectsDocument } from '../src/effects/validate';
import minimal from './fixtures/effects/minimal.fx.json';

// WP-3.0: the canonical valid effects fixture (one emitter, one static region, one bundle) passes
// clean under the default (verifyHash: true) path, with zero errors and zero warnings, so its
// committed content hash is correct.
describe('effects valid corpus', () => {
  it('minimal.fx.json validates with zero errors and zero warnings', () => {
    const report = validateEffectsDocument(minimal);

    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.document).not.toBeNull();
  });
});
