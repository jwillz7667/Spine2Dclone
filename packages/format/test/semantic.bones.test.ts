import { describe, expect, it } from 'vitest';
import { validateDocument } from '../src/validate';
import { cloneMinimal, errorCodes, familyOf } from './helpers';

// WP-0.3: the bone graph checks (format-contract section 5.4) run in a fixed, short-circuiting order
// so a single broken document yields a single bone code. Validated with verifyHash: false because
// the mutations invalidate the committed content hash, which is not what these cases test.
describe('semantic bones', () => {
  it('reports BONE_NAME_DUPLICATE for a repeated bone name', () => {
    const doc = cloneMinimal();
    doc.bones.push({ ...doc.bones[0]!, parent: null });

    expect(errorCodes(validateDocument(doc, { verifyHash: false }))).toContain(
      'BONE_NAME_DUPLICATE',
    );
  });

  it('reports BONE_PARENT_MISSING when a parent does not exist', () => {
    const doc = cloneMinimal();
    doc.bones.push({ ...doc.bones[0]!, name: 'child', parent: 'ghost' });

    expect(errorCodes(validateDocument(doc, { verifyHash: false }))).toContain(
      'BONE_PARENT_MISSING',
    );
  });

  it('reports BONE_ORDER_VIOLATION (at the child parent pointer) when a child precedes its parent', () => {
    const doc = cloneMinimal();
    const root = doc.bones[0]!;
    doc.bones = [{ ...root, name: 'child', parent: 'root' }, root];

    const report = validateDocument(doc, { verifyHash: false });
    expect(errorCodes(report)).toContain('BONE_ORDER_VIOLATION');
    expect(report.errors.find((error) => error.code === 'BONE_ORDER_VIOLATION')?.path).toBe(
      '/bones/0/parent',
    );
  });

  it('reports BONE_ORDER_VIOLATION (not a separate code) for a two-bone cycle, with no cross-family code', () => {
    const doc = cloneMinimal();
    const root = doc.bones[0]!;
    doc.bones = [
      { ...root, name: 'root', parent: 'child' },
      { ...root, name: 'child', parent: 'root' },
    ];

    const codes = errorCodes(validateDocument(doc, { verifyHash: false }));
    expect(codes).toContain('BONE_ORDER_VIOLATION');
    for (const code of codes) {
      expect(familyOf(code)).toBe('BONE');
    }
  });

  it('short-circuits: a document with BOTH a duplicate name and a child-before-parent emits only the duplicate', () => {
    // Without the section 5.4 short-circuit, the name check AND the order check would both fire: bone
    // 'limb' at index 1 names parent 'tip', whose first occurrence is at index 2 (index 2 >= 1, an
    // order violation), and 'tip' is duplicated. 'root' is kept so the slot and animation refs stay
    // valid (no cross-family noise). The short-circuit must leave only BONE_NAME_DUPLICATE.
    const doc = cloneMinimal();
    const root = doc.bones[0]!;
    doc.bones = [
      root,
      { ...root, name: 'limb', parent: 'tip' },
      { ...root, name: 'tip', parent: null },
      { ...root, name: 'tip', parent: null },
    ];

    const codes = errorCodes(validateDocument(doc, { verifyHash: false }));
    expect(codes).toContain('BONE_NAME_DUPLICATE');
    expect(codes).not.toContain('BONE_ORDER_VIOLATION');
    expect(codes).not.toContain('BONE_PARENT_MISSING');
  });
});
