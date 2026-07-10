import { describe, expect, it } from 'vitest';
import {
  ConstraintError,
  ReorderConstraintsCommand,
  assertInvariants,
  loadDocument,
  type Document,
} from '../src';
import { makeTestEnv, seeds } from './seeds';

// PP-D10 (Stage F2) cross-array constraint solve order (ADR-0009 section 1.3). The rigged seed carries one
// IK constraint ('limb-ik') and one transform constraint ('follow'), both without an explicit order (the
// migrated default). The generic round-trip harness proves do/undo/redo bit-exact; these tests pin the
// dense/unique validation, the clear-restores-default path, and that a cleared constraint is byte-identical
// to one that never had an order (no lingering `order: undefined`).

function rigged(): Document {
  const { env } = makeTestEnv();
  return loadDocument(seeds.rigged, env);
}

function combinedIds(doc: Document): string[] {
  return [
    ...doc.model.ikConstraints().map((c) => c.id),
    ...doc.model.transformConstraints().map((c) => c.id),
  ];
}

function orders(doc: Document): (number | undefined)[] {
  return [
    ...doc.model.ikConstraints().map((c) => c.order),
    ...doc.model.transformConstraints().map((c) => c.order),
  ];
}

describe('ReorderConstraints', () => {
  it('assigns a dense permutation and one undo restores the default (absent) order', () => {
    const doc = rigged();
    const ids = combinedIds(doc);
    expect(orders(doc)).toEqual([undefined, undefined]); // default: no explicit order
    const before = doc.model.snapshot();

    doc.history.execute(new ReorderConstraintsCommand([...ids].reverse()));
    assertInvariants(doc.model);
    // ids were [ik, transform]; reversed order puts transform first (order 0) and ik second (order 1).
    const ik = doc.model.ikConstraints()[0]!;
    const tc = doc.model.transformConstraints()[0]!;
    expect(ik.order).toBe(1);
    expect(tc.order).toBe(0);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before); // exact restore, no lingering order key
    assertInvariants(doc.model);
  });

  it('clears the order on every constraint, restoring the default, and round-trips', () => {
    const doc = rigged();
    const ids = combinedIds(doc);
    // First assign an explicit order, then clear it.
    doc.history.execute(new ReorderConstraintsCommand([...ids].reverse()));
    const afterAssign = doc.model.snapshot();

    doc.history.execute(new ReorderConstraintsCommand(null));
    expect(orders(doc)).toEqual([undefined, undefined]);
    // A cleared constraint is byte-identical to one that never had an order: the snapshot omits `order`.
    for (const c of [...doc.model.ikConstraints(), ...doc.model.transformConstraints()]) {
      expect('order' in c).toBe(false);
    }

    doc.history.undo(); // undo the clear -> back to the assigned order
    expect(doc.model.snapshot()).toEqual(afterAssign);
  });

  it('rejects a wrong-length permutation with no mutation', () => {
    const doc = rigged();
    const ids = combinedIds(doc);
    const before = doc.model.snapshot();
    expect(() => doc.history.execute(new ReorderConstraintsCommand([ids[0]!]))).toThrow(
      ConstraintError,
    );
    expect(doc.model.snapshot()).toEqual(before);
    expect(doc.history.canUndo).toBe(false);
  });

  it('rejects a duplicated id with no mutation', () => {
    const doc = rigged();
    const ids = combinedIds(doc);
    const before = doc.model.snapshot();
    expect(() => doc.history.execute(new ReorderConstraintsCommand([ids[0]!, ids[0]!]))).toThrow(
      ConstraintError,
    );
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('rejects an unknown id with no mutation', () => {
    const doc = rigged();
    const ids = combinedIds(doc);
    const before = doc.model.snapshot();
    expect(() => doc.history.execute(new ReorderConstraintsCommand([ids[0]!, 'ghost']))).toThrow(
      ConstraintError,
    );
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('carries the orderInvalid reason on the typed error', () => {
    const doc = rigged();
    try {
      doc.history.execute(new ReorderConstraintsCommand(['ghost', 'ghost2']));
      throw new Error('expected a ConstraintError');
    } catch (error) {
      expect(error).toBeInstanceOf(ConstraintError);
      expect((error as ConstraintError).reason).toBe('orderInvalid');
    }
  });
});
