import { describe, expect, it } from 'vitest';
import { validateDocument } from '../src/validate';
import { CURRENT_FORMAT_VERSION, SUPPORTED_FORMAT_MAJOR } from '../src/version/constants';
import { cloneMinimal, errorCodes } from './helpers';

// WP-0.3 acceptance bullet 3 and format-contract section 8.3 step 1: the version gate. A present but
// unsupported formatVersion (newer, unparseable, or below the current migration key with no chain) is
// UNSUPPORTED_FORMAT_VERSION and stops the pipeline. A MISSING or non-string formatVersion is NOT the
// gate's concern; it falls through to the structural layer as SCHEMA_SHAPE.
describe('version gate', () => {
  it('exposes the current constants', () => {
    expect(CURRENT_FORMAT_VERSION).toBe('0.6.0');
    expect(SUPPORTED_FORMAT_MAJOR).toBe(0);
  });

  it('accepts exactly the current formatVersion', () => {
    expect(validateDocument(cloneMinimal()).ok).toBe(true);
  });

  it('rejects a strictly newer version (major or patch) as UNSUPPORTED_FORMAT_VERSION at /formatVersion', () => {
    const newerMajor = validateDocument({ ...cloneMinimal(), hash: '', formatVersion: '1.0.0' });
    expect(errorCodes(newerMajor)).toContain('UNSUPPORTED_FORMAT_VERSION');
    expect(newerMajor.errors[0]?.path).toBe('/formatVersion');

    // A newer patch within the same minor is still strictly newer than 0.6.0, so it is unsupported.
    expect(
      errorCodes(validateDocument({ ...cloneMinimal(), hash: '', formatVersion: '0.6.1' })),
    ).toContain('UNSUPPORTED_FORMAT_VERSION');
  });

  it('forward-migrates a below-current 0.1.x document instead of rejecting it (ADR-0004, ADR-0008, ADR-0011, ADR-0014)', () => {
    // A 0.1.x document is below the current migration key; the gate runs the chain and the upgraded
    // document validates. cloneMinimal() is already 0.6.0-shaped, so labelling it 0.1.0 with an empty
    // hash exercises the migration path (empties already present, formatVersion stamped, draft hash).
    const report = validateDocument({ ...cloneMinimal(), hash: '', formatVersion: '0.1.0' });
    expect(report.ok).toBe(true);
    expect(report.document?.formatVersion).toBe('0.6.0');
  });

  it('rejects an unparseable version as UNSUPPORTED_FORMAT_VERSION', () => {
    expect(
      errorCodes(validateDocument({ ...cloneMinimal(), hash: '', formatVersion: 'abc' })),
    ).toContain('UNSUPPORTED_FORMAT_VERSION');
  });

  it('rejects a leading-zero (non-canonical) version as UNSUPPORTED_FORMAT_VERSION', () => {
    expect(
      errorCodes(validateDocument({ ...cloneMinimal(), hash: '', formatVersion: '00.1.0' })),
    ).toContain('UNSUPPORTED_FORMAT_VERSION');
  });

  it('routes a below-current pre-1.0 version to UNSUPPORTED (no migration chain in Phase 0)', () => {
    expect(
      errorCodes(validateDocument({ ...cloneMinimal(), hash: '', formatVersion: '0.0.9' })),
    ).toContain('UNSUPPORTED_FORMAT_VERSION');
  });

  it('treats a missing formatVersion as SCHEMA_SHAPE at /formatVersion, not a version error', () => {
    const doc = cloneMinimal();
    const withoutVersion: Record<string, unknown> = { ...doc };
    delete withoutVersion['formatVersion'];

    const report = validateDocument(withoutVersion);
    const codes = errorCodes(report);
    expect(codes).toContain('SCHEMA_SHAPE');
    expect(codes).not.toContain('UNSUPPORTED_FORMAT_VERSION');
    expect(report.errors.some((error) => error.path === '/formatVersion')).toBe(true);
  });

  it('treats a non-string formatVersion as SCHEMA_SHAPE, not a version error', () => {
    const codes = errorCodes(validateDocument({ ...cloneMinimal(), formatVersion: 123 }));
    expect(codes).toContain('SCHEMA_SHAPE');
    expect(codes).not.toContain('UNSUPPORTED_FORMAT_VERSION');
  });
});
