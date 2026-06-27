import { describe, expect, it } from 'vitest';
import {
  buildPose,
  decompose,
  MAT2X3_STRIDE,
  sampleSkeleton,
  type Mat2x3,
  type Pose,
} from '@marionette/runtime-core';
import {
  CreateAnimationCommand,
  CreateBoneCommand,
  createDocument,
  exportDocument,
  makeIdFactory,
  newDocState,
  type AnimationId,
  type BoneId,
  type Document,
  type KeyframeValue,
} from '../document';
import { dispatchBoneTransform, type EditDispatchContext } from './edit-dispatcher';
import type { SetupTransform } from './setup-delta';

// End-to-end proof of R1.4: an edit authored through the dispatcher at a playhead reproduces the gizmo
// pose when sampleSkeleton runs the real export -> buildPose -> sampleSkeleton pipeline at that playhead.
// The setup poses here are intentionally NON-identity (the case storing the absolute local value would
// silently break). The document is built through the real command spine with a fixed zero clock.

function makeDoc(setup: SetupTransform): { doc: Document; boneId: BoneId } {
  const doc = createDocument(newDocState('rt'), { now: () => 0, createIds: makeIdFactory });
  const boneId = doc.ids.mint('bone');
  doc.history.execute(
    new CreateBoneCommand(boneId, null, {
      name: 'torso',
      length: 100,
      x: setup.x,
      y: setup.y,
      rotation: setup.rotation,
      scaleX: setup.scaleX,
      scaleY: setup.scaleY,
      shearX: setup.shearX,
      shearY: setup.shearY,
      transformMode: 'normal',
    }),
  );
  return { doc, boneId };
}

function addIdle(doc: Document, duration = 1): AnimationId {
  const animId = doc.ids.mint('animation');
  doc.history.execute(new CreateAnimationCommand(animId, 'idle', duration));
  return animId;
}

function animationCtx(
  activeAnimation: AnimationId | null,
  overrides: Partial<EditDispatchContext> = {},
): EditDispatchContext {
  return { mode: 'animation', autoKey: true, activeAnimation, playhead: 0.5, ...overrides };
}

// Solve the exported document at `t` and read the bone's local transform back (index 0 is the only bone).
function solveLocalAt(doc: Document, animationName: string, t: number): Mat2x3 {
  const exported = exportDocument(doc.model);
  const pose: Pose = buildPose(exported);
  sampleSkeleton(exported, animationName, t, pose);
  const base = 0 * MAT2X3_STRIDE;
  const l = pose.local;
  return [l[base]!, l[base + 1]!, l[base + 2]!, l[base + 3]!, l[base + 4]!, l[base + 5]!];
}

function angleOf(value: KeyframeValue): number {
  if (!('angle' in value)) throw new Error('expected a rotate value');
  return value.angle;
}

const SETUP_DEFAULTS: SetupTransform = {
  rotation: 0,
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  shearX: 0,
  shearY: 0,
};

describe('dispatchBoneTransform: animation mode + auto-key', () => {
  it('keys the setup-relative rotation delta and sampleSkeleton reproduces the gizmo pose', () => {
    const { doc, boneId } = makeDoc({ ...SETUP_DEFAULTS, rotation: 90 });
    const animId = addIdle(doc);

    const outcome = dispatchBoneTransform(
      doc.history,
      doc.model,
      boneId,
      { channel: 'rotate', rotation: 130 },
      animationCtx(animId),
    );

    expect(outcome.kind).toBe('keyed');
    const set = doc.model.getAnimation(animId)?.bones.get(boneId);
    expect(set?.rotate.length).toBe(1);
    expect(set?.rotate[0]?.time).toBe(0.5);
    expect(angleOf(set!.rotate[0]!.value)).toBeCloseTo(40, 12); // desired 130 - setup 90
    // The R1.4 inverse: the solved local pose at the playhead is the gizmo's desired rotation, not 220.
    expect(decompose(solveLocalAt(doc, 'idle', 0.5)).rotationDeg).toBeCloseTo(130, 9);
  });

  it('keys the translation delta against a non-zero setup origin and reproduces it', () => {
    const { doc, boneId } = makeDoc({ ...SETUP_DEFAULTS, x: 10, y: -5 });
    const animId = addIdle(doc);

    dispatchBoneTransform(
      doc.history,
      doc.model,
      boneId,
      { channel: 'translate', x: 40, y: 20 },
      animationCtx(animId),
    );

    const local = decompose(solveLocalAt(doc, 'idle', 0.5));
    expect(local.x).toBeCloseTo(40, 9);
    expect(local.y).toBeCloseTo(20, 9);
  });

  it('keys the scale quotient against a non-unit setup scale and reproduces it', () => {
    const { doc, boneId } = makeDoc({ ...SETUP_DEFAULTS, scaleX: 2, scaleY: 0.5 });
    const animId = addIdle(doc);

    dispatchBoneTransform(
      doc.history,
      doc.model,
      boneId,
      { channel: 'scale', scaleX: 3, scaleY: 2 },
      animationCtx(animId),
    );

    const local = decompose(solveLocalAt(doc, 'idle', 0.5));
    expect(local.scaleX).toBeCloseTo(3, 9); // setup 2 * delta 1.5
    expect(local.scaleY).toBeCloseTo(2, 9); // setup 0.5 * delta 4
  });

  it('editing the same bone at the same playhead updates the keyframe (no duplicate)', () => {
    const { doc, boneId } = makeDoc({ ...SETUP_DEFAULTS, rotation: 90 });
    const animId = addIdle(doc);

    dispatchBoneTransform(
      doc.history,
      doc.model,
      boneId,
      { channel: 'rotate', rotation: 130 },
      animationCtx(animId),
    );
    dispatchBoneTransform(
      doc.history,
      doc.model,
      boneId,
      { channel: 'rotate', rotation: 150 },
      animationCtx(animId),
    );

    const set = doc.model.getAnimation(animId)?.bones.get(boneId);
    expect(set?.rotate.length).toBe(1);
    expect(angleOf(set!.rotate[0]!.value)).toBeCloseTo(60, 12); // 150 - 90, the updated value
  });

  it('collapses a coalesced drag session to one undo step that restores the pre-drag state', () => {
    const { doc, boneId } = makeDoc({ ...SETUP_DEFAULTS, rotation: 90 });
    const animId = addIdle(doc);

    doc.history.beginInteraction();
    for (const rotation of [100, 110, 130]) {
      dispatchBoneTransform(
        doc.history,
        doc.model,
        boneId,
        { channel: 'rotate', rotation },
        animationCtx(animId),
      );
    }
    doc.history.endInteraction('Key Bone Rotation');

    const set = doc.model.getAnimation(animId)?.bones.get(boneId);
    expect(set?.rotate.length).toBe(1);
    expect(angleOf(set!.rotate[0]!.value)).toBeCloseTo(40, 12); // last desired 130 - setup 90

    doc.history.undo();
    expect(doc.model.getAnimation(animId)?.bones.get(boneId)).toBeUndefined(); // the key is gone
    expect(doc.model.getBone(boneId)).toBeDefined(); // only the drag was undone, not CreateBone
    expect(doc.model.getAnimation(animId)).toBeDefined(); // nor CreateAnimation
  });

  it('does nothing and reports "not-keying" when auto-key is off', () => {
    const { doc, boneId } = makeDoc({ ...SETUP_DEFAULTS, rotation: 90 });
    const animId = addIdle(doc);
    const revision = doc.model.revision;
    const canUndo = doc.history.canUndo;

    const outcome = dispatchBoneTransform(
      doc.history,
      doc.model,
      boneId,
      { channel: 'rotate', rotation: 130 },
      animationCtx(animId, { autoKey: false }),
    );

    expect(outcome.kind).toBe('not-keying');
    expect(doc.model.revision).toBe(revision);
    expect(doc.history.canUndo).toBe(canUndo);
  });

  it('does nothing and reports "no-active-animation" when no animation is active', () => {
    const { doc, boneId } = makeDoc({ ...SETUP_DEFAULTS, rotation: 90 });
    addIdle(doc);
    const revision = doc.model.revision;

    const outcome = dispatchBoneTransform(
      doc.history,
      doc.model,
      boneId,
      { channel: 'rotate', rotation: 130 },
      animationCtx(null),
    );

    expect(outcome.kind).toBe('no-active-animation');
    expect(doc.model.revision).toBe(revision);
  });
});

describe('dispatchBoneTransform: setup mode', () => {
  it('edits the setup pose and writes no keyframe', () => {
    const { doc, boneId } = makeDoc({ ...SETUP_DEFAULTS, rotation: 90 });
    const animId = addIdle(doc);
    const animationsBefore = doc.model.snapshot().animations;

    const ctx: EditDispatchContext = {
      mode: 'setup',
      autoKey: true,
      activeAnimation: animId,
      playhead: 0.5,
    };
    const outcome = dispatchBoneTransform(
      doc.history,
      doc.model,
      boneId,
      { channel: 'rotate', rotation: 130 },
      ctx,
    );

    expect(outcome.kind).toBe('setup');
    expect(doc.model.getBone(boneId)?.rotation).toBe(130); // the setup pose changed
    expect(doc.model.snapshot().animations).toEqual(animationsBefore); // no keyframe authored
  });
});
