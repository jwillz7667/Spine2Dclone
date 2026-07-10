import { describe, expect, it } from 'vitest';
import { importSpineJson } from '../src';
import type { SpineImportErrorCode } from '../src';

// Every negative asserts the EXACT typed error code (and, for a converted-but-invalid document, the
// underlying format code), so a regression that changes a code fails loudly. No document is ever produced
// on the failure arm.
function expectError(input: unknown, code: SpineImportErrorCode): void {
  const result = importSpineJson(input);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.errors.some((e) => e.code === code)).toBe(true);
}

describe('importSpineJson malformed-input rejections', () => {
  it('rejects a non-object root with SPINE_ROOT_INVALID', () => {
    expectError('not a document', 'SPINE_ROOT_INVALID');
    expectError(42, 'SPINE_ROOT_INVALID');
    expectError(null, 'SPINE_ROOT_INVALID');
    expectError([{ name: 'root' }], 'SPINE_ROOT_INVALID');
  });

  it('rejects a missing version with SPINE_VERSION_MISSING', () => {
    expectError({ bones: [{ name: 'root' }] }, 'SPINE_VERSION_MISSING');
    expectError({ skeleton: {}, bones: [{ name: 'root' }] }, 'SPINE_VERSION_MISSING');
  });

  it('rejects a non-4.x version with SPINE_VERSION_UNSUPPORTED', () => {
    expectError(
      { skeleton: { spine: '3.8.99' }, bones: [{ name: 'root' }] },
      'SPINE_VERSION_UNSUPPORTED',
    );
    expectError(
      { skeleton: { spine: '5.0.0' }, bones: [{ name: 'root' }] },
      'SPINE_VERSION_UNSUPPORTED',
    );
  });

  it('rejects a wrong-shaped field with SPINE_SCHEMA', () => {
    // `bones` must be an array.
    expectError({ skeleton: { spine: '4.1.24' }, bones: { name: 'root' } }, 'SPINE_SCHEMA');
    // A bone `name` must be a string.
    expectError({ skeleton: { spine: '4.1.24' }, bones: [{ name: 5 }] }, 'SPINE_SCHEMA');
    // A bone numeric field must be a finite number.
    expectError(
      { skeleton: { spine: '4.1.24' }, bones: [{ name: 'root', x: 'left' }] },
      'SPINE_SCHEMA',
    );
  });

  it('rejects an unparseable color with SPINE_COLOR_INVALID', () => {
    expectError(
      {
        skeleton: { spine: '4.1.24' },
        bones: [{ name: 'root' }],
        slots: [{ name: 's', bone: 'root', color: 'ZZZZZZZZ' }],
      },
      'SPINE_COLOR_INVALID',
    );
    expectError(
      {
        skeleton: { spine: '4.1.24' },
        bones: [{ name: 'root' }],
        slots: [{ name: 's', bone: 'root', color: 'fff' }],
      },
      'SPINE_COLOR_INVALID',
    );
  });

  it('rejects a converted-but-invalid document with SPINE_DOCUMENT_INVALID and the format code', () => {
    // A bone naming a parent that does not exist survives conversion but fails validateDocument.
    const result = importSpineJson({
      skeleton: { spine: '4.1.24' },
      bones: [{ name: 'root' }, { name: 'child', parent: 'ghost' }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const invalid = result.errors.find((e) => e.code === 'SPINE_DOCUMENT_INVALID');
    expect(invalid?.detail?.['formatCode']).toBe('BONE_PARENT_MISSING');
  });

  it('rejects a slot on a missing bone via the format validator', () => {
    const result = importSpineJson({
      skeleton: { spine: '4.1.24' },
      bones: [{ name: 'root' }],
      slots: [{ name: 's', bone: 'ghostbone' }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.detail?.['formatCode'] === 'SLOT_BONE_MISSING')).toBe(true);
  });

  it('rejects an empty skeleton (no bones) via the format validator', () => {
    const result = importSpineJson({ skeleton: { spine: '4.1.24' } });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.code === 'SPINE_DOCUMENT_INVALID')).toBe(true);
  });
});
