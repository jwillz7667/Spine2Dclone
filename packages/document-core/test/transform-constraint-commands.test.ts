import { describe, expect, it } from 'vitest';
import { CreateTransformConstraintCommand } from '../src/commands/create-transform-constraint.command';
import { DeleteTransformConstraintCommand } from '../src/commands/delete-transform-constraint.command';
import { DeleteTransformKeyframeCommand } from '../src/commands/delete-transform-keyframe.command';
import { SetTransformConstraintParamsCommand } from '../src/commands/set-transform-constraint-params.command';
import { SetTransformConstraintVariantsCommand } from '../src/commands/set-transform-constraint-variants.command';
import { SetTransformKeyframeCommand } from '../src/commands/set-transform-keyframe.command';
import { assertInvariants, ConstraintError, loadDocument, type Document } from '../src';
import { makeTestEnv, seeds } from './seeds';

// The zero-valued mix/offset params a fresh transform constraint takes when the test only cares about the
// constraint's existence, not its drive (mixRotate 1 so the constraint is a real driver).
const ZERO_PARAMS = {
  mixRotate: 1,
  mixX: 0,
  mixY: 0,
  mixScaleX: 0,
  mixScaleY: 0,
  mixShearY: 0,
  offsetRotation: 0,
  offsetX: 0,
  offsetY: 0,
  offsetScaleX: 0,
  offsetScaleY: 0,
  offsetShearY: 0,
} as const;

// Resolve the first transform constraint and the 'move' animation's first transform track on the 'rigged'
// seed (the WP-2.7 target seed).
function firstConstraint(doc: Document): {
  id: ReturnType<Document['model']['transformConstraints']>[number]['id'];
} {
  const c = doc.model.transformConstraints()[0];
  if (!c) throw new Error('rigged seed had no transform constraint');
  return { id: c.id };
}

describe('CreateTransformConstraint', () => {
  it('creates a constraint and undo removes it', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rig, env);
    assertInvariants(doc.model);
    const before = doc.model.snapshot();
    const bones = doc.model.bones();

    doc.history.execute(
      new CreateTransformConstraintCommand(
        doc.ids.mint('transformConstraint'),
        'tc_new',
        [bones[1]!.id],
        bones[0]!.id,
        ZERO_PARAMS,
      ),
    );
    assertInvariants(doc.model);
    expect(doc.model.transformConstraints()).toHaveLength(1);

    doc.history.undo();
    assertInvariants(doc.model);
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('rejects a cycle when the constrained bone is an ancestor of the target', () => {
    const { env } = makeTestEnv();
    // In 'rig', child is parented to root, so root is an ancestor of child: a constraint on [root] target
    // child would not resolve.
    const doc = loadDocument(seeds.rig, env);
    const [root, child] = doc.model.bones();
    const before = doc.model.snapshot();

    expect(() =>
      doc.history.execute(
        new CreateTransformConstraintCommand(
          doc.ids.mint('transformConstraint'),
          'tc_cycle',
          [root!.id],
          child!.id,
          ZERO_PARAMS,
        ),
      ),
    ).toThrow(ConstraintError);
    expect(doc.model.snapshot()).toEqual(before); // nothing mutated, no history entry
    expect(doc.history.canUndo).toBe(false);
    assertInvariants(doc.model);
  });

  it('rejects a duplicate name across both constraint arrays', () => {
    const { env } = makeTestEnv();
    // 'rigged' already carries a transform constraint named 'follow'.
    const doc = loadDocument(seeds.rigged, env);
    const bones = doc.model.bones();
    const before = doc.model.snapshot();

    expect(() =>
      doc.history.execute(
        new CreateTransformConstraintCommand(
          doc.ids.mint('transformConstraint'),
          'follow',
          [bones[1]!.id],
          bones[0]!.id,
          ZERO_PARAMS,
        ),
      ),
    ).toThrow(ConstraintError);
    expect(doc.model.snapshot()).toEqual(before);
    assertInvariants(doc.model);
  });
});

describe('SetTransformConstraintParams', () => {
  it('sets a channel and undo restores the prior value', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const { id } = firstConstraint(doc);
    const before = doc.model.snapshot();

    doc.history.execute(new SetTransformConstraintParamsCommand(id, { mixX: 0.75 }));
    assertInvariants(doc.model);
    expect(doc.model.getTransformConstraint(id)!.mixX).toBe(0.75);

    doc.history.undo();
    assertInvariants(doc.model);
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('collapses a slider stroke into a single undo step keeping the original before', () => {
    const t = makeTestEnv();
    const doc = loadDocument(seeds.rigged, t.env);
    const { id } = firstConstraint(doc);
    const originalMixRotate = doc.model.getTransformConstraint(id)!.mixRotate;
    const before = doc.model.snapshot();

    // A slider drag: the SAME channel is re-set each step, with 300ms gaps (beyond the 250ms window) to
    // prove the SESSION, not the time window, drives the merge.
    t.setNow(0);
    doc.history.beginInteraction();
    doc.history.execute(new SetTransformConstraintParamsCommand(id, { mixRotate: 0.2 }));
    t.advance(300);
    doc.history.execute(new SetTransformConstraintParamsCommand(id, { mixRotate: 0.5 }));
    t.advance(300);
    doc.history.execute(new SetTransformConstraintParamsCommand(id, { mixRotate: 0.9 }));
    const event = doc.history.endInteraction('Set Transform Constraint');
    expect(event?.kind).toBe('transform.setParams'); // one merged command, not 'composite'
    assertInvariants(doc.model);
    expect(doc.model.getTransformConstraint(id)!.mixRotate).toBe(0.9); // final value applied

    let steps = 0;
    while (doc.history.canUndo) {
      doc.history.undo();
      steps += 1;
    }
    expect(steps).toBe(1); // one undo step for the whole stroke
    assertInvariants(doc.model);
    expect(doc.model.getTransformConstraint(id)!.mixRotate).toBe(originalMixRotate);
    expect(doc.model.snapshot()).toEqual(before);
  });
});

describe('SetTransformConstraintVariants (PP-D10)', () => {
  it('sets local / relative and undo restores the prior values', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const { id } = firstConstraint(doc);
    // The rigged seed carries the migrated defaults (local false, relative false).
    expect(doc.model.getTransformConstraint(id)!.local).toBe(false);
    expect(doc.model.getTransformConstraint(id)!.relative).toBe(false);
    const before = doc.model.snapshot();

    doc.history.execute(new SetTransformConstraintVariantsCommand(id, { local: true, relative: true }));
    assertInvariants(doc.model);
    expect(doc.model.getTransformConstraint(id)!.local).toBe(true);
    expect(doc.model.getTransformConstraint(id)!.relative).toBe(true);

    doc.history.undo();
    assertInvariants(doc.model);
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('patches only the named flag (the other keeps its value)', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const { id } = firstConstraint(doc);
    doc.history.execute(new SetTransformConstraintVariantsCommand(id, { relative: true }));
    expect(doc.model.getTransformConstraint(id)!.relative).toBe(true);
    expect(doc.model.getTransformConstraint(id)!.local).toBe(false); // untouched
  });
});

describe('SetTransformKeyframe', () => {
  it('inserts a keyframe, updates one in place, and undo restores the channel', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const animation = doc.model.animations()[0]!;
    const [constraintId, frames] = [...animation.transform][0]!;
    const before = doc.model.snapshot();
    const beforeCount = frames.length;

    // Insert at the midpoint of the first two existing keys.
    const midTime = (frames[0]!.time + frames[1]!.time) / 2;
    doc.history.execute(
      new SetTransformKeyframeCommand(animation.id, constraintId, midTime, {
        mixRotate: 0.5,
        mixX: undefined,
        mixY: undefined,
        mixScaleX: undefined,
        mixScaleY: undefined,
        mixShearY: undefined,
      }),
    );
    assertInvariants(doc.model);
    const afterInsert = doc.model.getAnimation(animation.id)!.transform.get(constraintId)!;
    expect(afterInsert).toHaveLength(beforeCount + 1);

    // Update the SAME time in place: the count is unchanged, the mix changes.
    doc.history.execute(
      new SetTransformKeyframeCommand(animation.id, constraintId, midTime, {
        mixRotate: 0.8,
        mixX: undefined,
        mixY: undefined,
        mixScaleX: undefined,
        mixScaleY: undefined,
        mixShearY: undefined,
      }),
    );
    assertInvariants(doc.model);
    const afterUpdate = doc.model.getAnimation(animation.id)!.transform.get(constraintId)!;
    expect(afterUpdate).toHaveLength(beforeCount + 1);
    expect(afterUpdate.find((kf) => kf.time === midTime)!.mixRotate).toBe(0.8);

    doc.history.undo(); // undo the update
    assertInvariants(doc.model);
    doc.history.undo(); // undo the insert
    assertInvariants(doc.model);
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('rejects a missing animation', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const { id } = firstConstraint(doc);
    const ghostAnim = doc.ids.mint('animation');
    expect(() =>
      doc.history.execute(
        new SetTransformKeyframeCommand(ghostAnim, id, 0.5, {
          mixRotate: 0.5,
          mixX: undefined,
          mixY: undefined,
          mixScaleX: undefined,
          mixScaleY: undefined,
          mixShearY: undefined,
        }),
      ),
    ).toThrow();
    assertInvariants(doc.model);
  });
});

describe('DeleteTransformKeyframe', () => {
  it('removes a keyframe and undo restores it', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const animation = doc.model.animations()[0]!;
    const [constraintId, frames] = [...animation.transform][0]!;
    const before = doc.model.snapshot();
    const beforeCount = frames.length;
    const firstKeyId = frames[0]!.id;

    doc.history.execute(new DeleteTransformKeyframeCommand(animation.id, constraintId, firstKeyId));
    assertInvariants(doc.model);
    const after = doc.model.getAnimation(animation.id)!.transform.get(constraintId)!;
    expect(after).toHaveLength(beforeCount - 1);
    expect(after.some((kf) => kf.id === firstKeyId)).toBe(false);

    doc.history.undo();
    assertInvariants(doc.model);
    expect(doc.model.snapshot()).toEqual(before);
  });
});

describe('DeleteTransformConstraint', () => {
  it('removes the constraint and cascades its transform timeline, with undo restoring both', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const { id } = firstConstraint(doc);
    const animation = doc.model.animations()[0]!;
    const before = doc.model.snapshot();

    // The 'move' animation has a transform track keyed to this constraint before the delete.
    expect(doc.model.getAnimation(animation.id)!.transform.has(id)).toBe(true);

    doc.history.execute(new DeleteTransformConstraintCommand(id));
    assertInvariants(doc.model);
    expect(doc.model.getTransformConstraint(id)).toBeUndefined();
    // The cascaded timeline is gone too (no track keys a constraint that no longer exists).
    expect(doc.model.getAnimation(animation.id)!.transform.has(id)).toBe(false);

    doc.history.undo();
    assertInvariants(doc.model);
    expect(doc.model.getTransformConstraint(id)).toBeDefined();
    expect(doc.model.getAnimation(animation.id)!.transform.has(id)).toBe(true);
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('rejects deleting a constraint id that does not exist', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const ghost = doc.ids.mint('transformConstraint');
    expect(() => doc.history.execute(new DeleteTransformConstraintCommand(ghost))).toThrow(
      ConstraintError,
    );
    assertInvariants(doc.model);
  });
});
