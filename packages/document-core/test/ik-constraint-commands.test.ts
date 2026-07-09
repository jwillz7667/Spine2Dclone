import { describe, expect, it } from 'vitest';
import { CreateIkConstraintCommand } from '../src/commands/create-ik-constraint.command';
import { DeleteIkConstraintCommand } from '../src/commands/delete-ik-constraint.command';
import { DeleteIkKeyframeCommand } from '../src/commands/delete-ik-keyframe.command';
import { SetIkBendPositiveCommand } from '../src/commands/set-ik-bend-positive.command';
import { SetIkKeyframeCommand } from '../src/commands/set-ik-keyframe.command';
import { SetIkMixCommand } from '../src/commands/set-ik-mix.command';
import { SetIkDepthParamsCommand } from '../src/commands/set-ik-depth-params.command';
import { assertInvariants, ConstraintError, loadDocument, type Document } from '../src';
import { makeTestEnv, seeds } from './seeds';

// Resolve a bone's internal id by name on a loaded document (the seeds carry stable names).
function boneId(doc: Document, name: string): string {
  const bone = doc.model.findBoneByName(name);
  if (!bone) throw new Error(`seed missing bone ${name}`);
  return bone.id;
}

// Assert do then undo leaves the model deep-equal to the pre-command snapshot, and the invariants hold
// after every transition. Returns nothing; throws (via expect) on a mismatch.
function expectRoundTrip(doc: Document, run: () => void): void {
  const before = doc.model.snapshot();
  run();
  expect(() => assertInvariants(doc.model)).not.toThrow();
  doc.history.undo();
  expect(doc.model.snapshot()).toEqual(before);
  expect(() => assertInvariants(doc.model)).not.toThrow();
}

describe('CreateIkConstraint', () => {
  it('rejects a cycle (a chain bone that is an ancestor of the target)', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const before = doc.model.snapshot();
    // root is a strict ancestor of upper, so chain=[root] target=upper would not resolve.
    const cmd = new CreateIkConstraintCommand(
      doc.ids.mint('ikConstraint'),
      'cyclic',
      [boneId(doc, 'root')],
      boneId(doc, 'upper'),
      1,
      true,
    );
    expect(() => doc.history.execute(cmd)).toThrow(ConstraintError);
    expect(() => doc.history.execute(cmd)).toThrow(expect.objectContaining({ reason: 'cycle' }));
    expect(doc.model.snapshot()).toEqual(before); // nothing mutated, no history entry
    expect(doc.history.canUndo).toBe(false);
  });

  it('rejects a chain of three bones (chainArity)', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const cmd = new CreateIkConstraintCommand(
      doc.ids.mint('ikConstraint'),
      'too-long',
      [boneId(doc, 'root'), boneId(doc, 'upper'), boneId(doc, 'lower')],
      boneId(doc, 'target'),
      1,
      true,
    );
    expect(() => doc.history.execute(cmd)).toThrow(
      expect.objectContaining({ name: 'ConstraintError', reason: 'chainArity' }),
    );
  });

  it('rejects a duplicate constraint name', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    // 'limb-ik' already exists; a valid one-bone chain (follower) reaching root must still be rejected.
    const cmd = new CreateIkConstraintCommand(
      doc.ids.mint('ikConstraint'),
      'limb-ik',
      [boneId(doc, 'follower')],
      boneId(doc, 'root'),
      1,
      true,
    );
    expect(() => doc.history.execute(cmd)).toThrow(
      expect.objectContaining({ name: 'ConstraintError', reason: 'duplicateName' }),
    );
  });

  it('creates a valid one-bone chain and undo removes it (round-trip)', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const beforeCount = doc.model.ikConstraints().length;
    expectRoundTrip(doc, () => {
      doc.history.execute(
        new CreateIkConstraintCommand(
          doc.ids.mint('ikConstraint'),
          'follow-ik',
          [boneId(doc, 'follower')],
          boneId(doc, 'root'),
          0.5,
          false,
        ),
      );
      expect(doc.model.ikConstraints().length).toBe(beforeCount + 1);
    });
  });
});

describe('SetIkMix', () => {
  it('coalesces a slider stroke into one undo step (window irrelevant inside a session)', () => {
    const { env, advance } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const constraint = doc.model.ikConstraints()[0]!;
    const preStroke = doc.model.snapshot();
    const originalMix = constraint.mix;

    doc.history.beginInteraction();
    doc.history.execute(new SetIkMixCommand(constraint.id, 0.8));
    advance(300); // beyond the 250ms window; a session coalesces regardless
    doc.history.execute(new SetIkMixCommand(constraint.id, 0.6));
    advance(300);
    doc.history.execute(new SetIkMixCommand(constraint.id, 0.2));
    doc.history.endInteraction('Set IK Mix');

    expect(doc.model.getIkConstraint(constraint.id)!.mix).toBe(0.2);
    expect(() => assertInvariants(doc.model)).not.toThrow();

    // ONE undo restores the entire stroke to the pre-interaction state.
    doc.history.undo();
    expect(doc.model.getIkConstraint(constraint.id)!.mix).toBe(originalMix);
    expect(doc.model.snapshot()).toEqual(preStroke);
    expect(doc.history.canUndo).toBe(false);
    expect(() => assertInvariants(doc.model)).not.toThrow();
  });

  it('a single mix edit round-trips', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const constraint = doc.model.ikConstraints()[0]!;
    expectRoundTrip(doc, () => {
      doc.history.execute(new SetIkMixCommand(constraint.id, 0.33));
      expect(doc.model.getIkConstraint(constraint.id)!.mix).toBe(0.33);
    });
  });
});

describe('SetIkDepthParams (PP-D10)', () => {
  it('edits softness / stretch / compress / uniform and round-trips', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const constraint = doc.model.ikConstraints()[0]!;
    // The rigged seed carries the migrated defaults (softness 0, all three booleans false).
    expect(constraint.softness).toBe(0);
    expect(constraint.stretch).toBe(false);

    expectRoundTrip(doc, () => {
      doc.history.execute(
        new SetIkDepthParamsCommand(constraint.id, {
          softness: 12,
          stretch: true,
          compress: true,
          uniform: true,
        }),
      );
      const after = doc.model.getIkConstraint(constraint.id)!;
      expect(after.softness).toBe(12);
      expect(after.stretch).toBe(true);
      expect(after.compress).toBe(true);
      expect(after.uniform).toBe(true);
    });
  });

  it('coalesces a softness slider stroke into one undo step', () => {
    const { env, advance } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const constraint = doc.model.ikConstraints()[0]!;
    const preStroke = doc.model.snapshot();

    doc.history.beginInteraction();
    doc.history.execute(new SetIkDepthParamsCommand(constraint.id, { softness: 4 }));
    advance(300); // beyond the 250ms window; a session coalesces regardless
    doc.history.execute(new SetIkDepthParamsCommand(constraint.id, { softness: 8 }));
    advance(300);
    doc.history.execute(new SetIkDepthParamsCommand(constraint.id, { softness: 15 }));
    doc.history.endInteraction('Set IK Depth');

    expect(doc.model.getIkConstraint(constraint.id)!.softness).toBe(15);

    // ONE undo restores the entire stroke to the pre-interaction state.
    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(preStroke);
    expect(doc.history.canUndo).toBe(false);
    expect(() => assertInvariants(doc.model)).not.toThrow();
  });

  it('does not coalesce across two different IK constraints', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const first = doc.model.ikConstraints()[0]!;
    // A second constraint over the same chain gives a distinct target for the cross-target guard.
    const secondId = doc.ids.mint('ikConstraint');
    doc.history.execute(
      new CreateIkConstraintCommand(secondId, 'limb-ik-2', first.bones, first.target, 1, true),
    );
    // Two depth edits on DISTINCT constraints within the window must stay two undo steps (plus the create).
    doc.history.execute(new SetIkDepthParamsCommand(first.id, { softness: 3 }));
    doc.history.execute(new SetIkDepthParamsCommand(secondId, { softness: 3 }));
    let undoSteps = 0;
    while (doc.history.canUndo) {
      doc.history.undo();
      undoSteps += 1;
    }
    expect(undoSteps).toBe(3); // create + two distinct-target depth edits, none merged
  });
});

describe('SetIkBendPositive', () => {
  it('toggles bendPositive and undo restores it (round-trip)', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const constraint = doc.model.ikConstraints()[0]!;
    const original = constraint.bendPositive;
    expectRoundTrip(doc, () => {
      doc.history.execute(new SetIkBendPositiveCommand(constraint.id, !original));
      expect(doc.model.getIkConstraint(constraint.id)!.bendPositive).toBe(!original);
    });
  });
});

describe('SetIkKeyframe', () => {
  it('inserts a new keyframe (count + 1) and undo restores the track', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const anim = doc.model.animations().find((a) => a.name === 'move')!;
    const [constraintId, frames] = [...anim.ik][0]!;
    const beforeCount = frames.length;
    const time = (frames[0]!.time + frames[1]!.time) / 2; // a free interior time

    expectRoundTrip(doc, () => {
      doc.history.execute(new SetIkKeyframeCommand(anim.id, constraintId, time, 0.5, true));
      const after = doc.model.getAnimation(anim.id)!.ik.get(constraintId)!;
      expect(after.length).toBe(beforeCount + 1);
    });
  });

  it('updates an existing keyframe in place (count unchanged, value changed) and undo restores it', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const anim = doc.model.animations().find((a) => a.name === 'move')!;
    const [constraintId, frames] = [...anim.ik][0]!;
    const existing = frames[0]!;
    const beforeCount = frames.length;

    expectRoundTrip(doc, () => {
      doc.history.execute(
        new SetIkKeyframeCommand(anim.id, constraintId, existing.time, existing.mix + 0.25, false),
      );
      const after = doc.model.getAnimation(anim.id)!.ik.get(constraintId)!;
      expect(after.length).toBe(beforeCount); // updated in place, no insert
      const updated = after.find((kf) => kf.id === existing.id)!;
      expect(updated.mix).toBe(existing.mix + 0.25);
      expect(updated.bendPositive).toBe(false);
      expect(updated.curve).toBe(existing.curve); // curve preserved on update
    });
  });
});

describe('DeleteIkKeyframe', () => {
  it('removes one keyframe (count - 1) and undo restores it (round-trip)', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const anim = doc.model.animations().find((a) => a.name === 'move')!;
    const [constraintId, frames] = [...anim.ik][0]!;
    const beforeCount = frames.length;
    const target = frames[0]!;

    expectRoundTrip(doc, () => {
      doc.history.execute(new DeleteIkKeyframeCommand(anim.id, constraintId, target.id));
      const after = doc.model.getAnimation(anim.id)!.ik.get(constraintId) ?? [];
      expect(after.length).toBe(beforeCount - 1);
      expect(after.some((kf) => kf.id === target.id)).toBe(false);
    });
  });
});

describe('DeleteIkConstraint', () => {
  it('removes the constraint and its ik timeline; undo restores both (round-trip)', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const constraint = doc.model.ikConstraints()[0]!;
    const anim = doc.model.animations().find((a) => a.name === 'move')!;
    const beforeConstraints = doc.model.ikConstraints().length;
    expect(anim.ik.get(constraint.id)?.length).toBeGreaterThan(0); // a track exists to cascade

    expectRoundTrip(doc, () => {
      doc.history.execute(new DeleteIkConstraintCommand(constraint.id));
      expect(doc.model.getIkConstraint(constraint.id)).toBeUndefined();
      expect(doc.model.ikConstraints().length).toBe(beforeConstraints - 1);
      // The cascaded ik track is gone from the animation.
      expect(doc.model.getAnimation(anim.id)!.ik.get(constraint.id)).toBeUndefined();
    });

    // After undo the constraint and its track are both back.
    expect(doc.model.getIkConstraint(constraint.id)).toBeDefined();
    expect(doc.model.getAnimation(anim.id)!.ik.get(constraint.id)?.length).toBeGreaterThan(0);
  });

  it('rejects deleting an unknown constraint id (notFound)', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rig, env);
    const ghost = doc.ids.mint('ikConstraint');
    expect(() => doc.history.execute(new DeleteIkConstraintCommand(ghost))).toThrow(
      expect.objectContaining({ name: 'ConstraintError', reason: 'notFound' }),
    );
  });
});
