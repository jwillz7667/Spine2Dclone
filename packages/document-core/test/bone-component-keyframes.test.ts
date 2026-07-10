import { describe, expect, it } from 'vitest';
import {
  DeleteKeyframeCommand,
  MoveKeyframeCommand,
  SetCurveCommand,
  SetKeyframeCommand,
  TimelineError,
  exportDocument,
  loadDocument,
  type AnimationId,
  type BoneId,
  type Document,
  type KeyframeTarget,
} from '../src';
import { makeTestEnv, seeds } from './seeds';

// Stage F2 (ADR-0009 section 4.1, PP-D10) per-component bone tracks (translateX/Y, scaleX/Y, shearX/Y),
// promoted from carried format arrays to first-class editable id-keyed keyframes served by the generic
// SetKeyframe / MoveKeyframe / DeleteKeyframe / SetCurve commands. The generic round-trip harness proves
// do/undo/redo is bit-exact on every seed; these tests pin the split-channel behaviors the harness does
// not: the joint/split coexistence ban, sibling-component coexistence, and lossless load/export promotion.

function animatedDoc(): Document {
  const { env } = makeTestEnv();
  return loadDocument(seeds.animated, env);
}

function ids(doc: Document): { animId: AnimationId; boneId: BoneId } {
  const animation = doc.model.animations()[0];
  const bone = doc.model.bones()[0];
  if (!animation || !bone) throw new Error('animated seed lost its animation/bone');
  return { animId: animation.id, boneId: bone.id };
}

function scaleXKeys(doc: Document, animId: AnimationId, boneId: BoneId) {
  const animation = doc.model.animations().find((a) => a.id === animId);
  return animation?.bones.get(boneId)?.scaleX ?? [];
}

describe('per-component bone keyframes (Stage F2)', () => {
  it('keys a split component channel and round-trips do/undo', () => {
    const doc = animatedDoc();
    const { animId, boneId } = ids(doc);
    const before = doc.model.snapshot();

    const target: KeyframeTarget = { kind: 'bone', boneId, channel: 'scaleX' };
    doc.history.execute(new SetKeyframeCommand(animId, target, 0.5, { value: 0.4 }));

    const keys = scaleXKeys(doc, animId, boneId);
    expect(keys.map((k) => ('value' in k.value ? k.value.value : NaN))).toEqual([0.4]);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('allows two sibling components of the same group to coexist', () => {
    const doc = animatedDoc();
    const { animId, boneId } = ids(doc);

    doc.history.execute(
      new SetKeyframeCommand(animId, { kind: 'bone', boneId, channel: 'scaleX' }, 0.25, {
        value: 0.4,
      }),
    );
    // scaleY is a sibling of scaleX, NOT its joint, so keying it is legal.
    expect(() =>
      doc.history.execute(
        new SetKeyframeCommand(animId, { kind: 'bone', boneId, channel: 'scaleY' }, 0.25, {
          value: 0.7,
        }),
      ),
    ).not.toThrow();
  });

  it('rejects keying a split component while the joint channel is keyed (componentConflict)', () => {
    const doc = animatedDoc();
    const { animId, boneId } = ids(doc);
    // The animated seed already keys the JOINT `translate` channel on root.
    const before = doc.model.snapshot();

    let thrown: unknown;
    try {
      doc.history.execute(
        new SetKeyframeCommand(animId, { kind: 'bone', boneId, channel: 'translateX' }, 0.5, {
          value: 3,
        }),
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TimelineError);
    expect((thrown as TimelineError).reason).toBe('componentConflict');
    // The rejected command left the document untouched (no partial mutation).
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('rejects keying the joint channel while a split component is keyed (componentConflict)', () => {
    const doc = animatedDoc();
    const { animId, boneId } = ids(doc);
    // scale is unkeyed on root; key its split component first, then the joint must be rejected.
    doc.history.execute(
      new SetKeyframeCommand(animId, { kind: 'bone', boneId, channel: 'scaleX' }, 0.5, {
        value: 0.4,
      }),
    );

    expect(() =>
      doc.history.execute(
        new SetKeyframeCommand(animId, { kind: 'bone', boneId, channel: 'scale' }, 0.5, {
          x: 1,
          y: 1,
        }),
      ),
    ).toThrowError(TimelineError);
  });

  it('moves, recurves, and deletes a split component keyframe with clean undo', () => {
    const doc = animatedDoc();
    const { animId, boneId } = ids(doc);
    const target: KeyframeTarget = { kind: 'bone', boneId, channel: 'shearX' };
    doc.history.execute(new SetKeyframeCommand(animId, target, 0.25, { value: 5 }));

    const before = doc.model.snapshot();
    const keyId = doc.model
      .animations()
      .find((a) => a.id === animId)!
      .bones.get(boneId)!.shearX[0]!.id;

    doc.history.execute(new MoveKeyframeCommand(animId, target, keyId, 0.75));
    doc.history.execute(new SetCurveCommand(animId, target, keyId, 'stepped'));
    doc.history.execute(new DeleteKeyframeCommand(animId, target, keyId));
    expect(scaleXKeys(doc, animId, boneId)).toEqual([]);

    doc.history.undo();
    doc.history.undo();
    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('promotes a per-component track losslessly through load and export', () => {
    const doc = animatedDoc();
    const { animId, boneId } = ids(doc);
    doc.history.execute(
      new SetKeyframeCommand(animId, { kind: 'bone', boneId, channel: 'scaleX' }, 0.5, {
        value: 0.4,
      }),
    );

    const exported = exportDocument(doc.model);
    const boneTimelines = Object.values(exported.animations)[0]?.bones;
    const onlyBone = boneTimelines ? Object.values(boneTimelines)[0] : undefined;
    expect(onlyBone?.scaleX).toEqual([{ time: 0.5, value: { value: 0.4 }, curve: 'linear' }]);

    // Reloading the exported document promotes the track again and re-exports identically.
    const { env } = makeTestEnv();
    const reloaded = loadDocument(exported, env);
    expect(exportDocument(reloaded.model)).toEqual(exported);
  });
});
