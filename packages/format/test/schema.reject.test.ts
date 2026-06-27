import { describe, expect, it } from 'vitest';
import { validateDocument } from '../src/validate';
import { cloneMinimal, errorCodes } from './helpers';

// WP-0.3: the structural (shape) layer rejects malformed documents with the right code. Unknown
// keys, non-finite numbers, and empty bones are SCHEMA_SHAPE; out-of-range color and bezier control
// x are the specific refinement codes COLOR_RANGE and CURVE_BEZIER_X_RANGE.
describe('schema reject', () => {
  it('rejects an unknown top-level key as SCHEMA_SHAPE (closed object)', () => {
    const report = validateDocument({ ...cloneMinimal(), unexpectedKey: true });

    expect(report.ok).toBe(false);
    expect(report.document).toBeNull();
    expect(errorCodes(report)).toContain('SCHEMA_SHAPE');
  });

  it('rejects an unknown attachment type as SCHEMA_SHAPE (closed union)', () => {
    const report = validateDocument({
      ...cloneMinimal(),
      skins: [
        { name: 'default', attachments: { body: { body: { type: 'sprite', path: 'body' } } } },
      ],
    });

    expect(report.ok).toBe(false);
    expect(errorCodes(report)).toContain('SCHEMA_SHAPE');
  });

  it('rejects NaN as SCHEMA_SHAPE (every number is finite)', () => {
    const doc = cloneMinimal();
    const root = doc.bones[0];
    if (root === undefined) throw new Error('fixture invariant: root bone');
    root.rotation = NaN;

    expect(errorCodes(validateDocument(doc))).toContain('SCHEMA_SHAPE');
  });

  it('rejects Infinity as SCHEMA_SHAPE', () => {
    const doc = cloneMinimal();
    const root = doc.bones[0];
    if (root === undefined) throw new Error('fixture invariant: root bone');
    root.x = Infinity;

    expect(errorCodes(validateDocument(doc))).toContain('SCHEMA_SHAPE');
  });

  it('rejects an empty bones array as SCHEMA_SHAPE, not a semantic error', () => {
    const doc = cloneMinimal();
    doc.bones = [];

    const codes = errorCodes(validateDocument(doc));
    expect(codes).toContain('SCHEMA_SHAPE');
    expect(codes).not.toContain('BONE_ORDER_VIOLATION');
  });

  it('rejects an out-of-range color channel as COLOR_RANGE', () => {
    const doc = cloneMinimal();
    const slot = doc.slots[0];
    if (slot === undefined) throw new Error('fixture invariant: slot');
    slot.color = { r: 1.5, g: 0, b: 0, a: 1 };

    const report = validateDocument(doc);
    expect(errorCodes(report)).toContain('COLOR_RANGE');
    expect(report.errors.find((error) => error.code === 'COLOR_RANGE')?.path).toBe(
      '/slots/0/color/r',
    );
  });

  it('rejects a bezier control x outside [0, 1] as CURVE_BEZIER_X_RANGE', () => {
    const doc = cloneMinimal();
    const keyframe = doc.animations['idle']?.bones['root']?.rotate?.[1];
    if (keyframe === undefined) throw new Error('fixture invariant: rotate keyframe');
    keyframe.curve = { type: 'bezier', cx1: 1.2, cy1: 0, cx2: 0.5, cy2: 1 };

    expect(errorCodes(validateDocument(doc))).toContain('CURVE_BEZIER_X_RANGE');
  });
});
