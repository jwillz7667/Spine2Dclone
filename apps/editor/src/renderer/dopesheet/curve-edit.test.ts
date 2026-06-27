import { describe, expect, it } from 'vitest';
import {
  buildPose,
  getRotationDeg,
  MAT2X3_STRIDE,
  sampleSkeleton,
  type Mat2x3,
} from '@marionette/runtime-core';
import type { SkeletonDocument } from '@marionette/format/types';
import {
  SetCurveCommand,
  exportDocument,
  type AnimationId,
  type BoneId,
  type Document,
  type KeyframeId,
  type KeyframeTarget,
} from '../document';
import { clampControlX, IDENTITY_BEZIER, setKeyframeCurve, withHandle } from './curve-edit';
import { indexKeyframes } from './keyframe-index';
import {
  addAnimation,
  addBone,
  createEmptyDocument,
  rotateKeyframes,
  setRotateKeys,
} from './seed-document';

const ANIMATION_NAME = 'idle';
const DURATION = 2;

interface Rig {
  readonly doc: Document;
  readonly animId: AnimationId;
  readonly boneId: BoneId;
  readonly target: KeyframeTarget;
  readonly keyId: KeyframeId;
}

// Two rotate keys (angle 0 at t=0, angle 20 at t=0.4), default 'linear' curve. The first key is the one
// the curve editor edits.
function rig(): Rig {
  const doc = createEmptyDocument();
  const boneId = addBone(doc, 'root');
  const animId = addAnimation(doc, ANIMATION_NAME, DURATION);
  setRotateKeys(doc, animId, boneId, [
    { time: 0.0, value: { angle: 0 } },
    { time: 0.4, value: { angle: 20 } },
  ]);
  const first = rotateKeyframes(doc, animId, boneId)[0]!;
  const target: KeyframeTarget = { kind: 'bone', boneId, channel: 'rotate' };
  return { doc, animId, boneId, target, keyId: first.id };
}

function countCommits(doc: Document, run: () => void): number {
  let commits = 0;
  const unsubscribe = doc.history.subscribe(() => {
    commits += 1;
  });
  run();
  unsubscribe();
  return commits;
}

// Sample the single root bone's world rotation (degrees) at time t through runtime-core, so the test
// observes exactly what the runtime plays. The root has setup rotation 0, so the world rotation equals
// the channel value applied by sampleSkeleton.
function rootRotationAt(document: SkeletonDocument, animationName: string, t: number): number {
  const pose = buildPose(document);
  sampleSkeleton(document, animationName, t, pose);
  const base = 0 * MAT2X3_STRIDE;
  const world: Mat2x3 = [
    pose.world[base]!,
    pose.world[base + 1]!,
    pose.world[base + 2]!,
    pose.world[base + 3]!,
    pose.world[base + 4]!,
    pose.world[base + 5]!,
  ];
  return getRotationDeg(world);
}

describe('curve editor SetCurve wiring (WP-1.7, LAW 2 / 4)', () => {
  it('clamps a bezier control x to [0, 1] and leaves y unclamped (pure mapping)', () => {
    expect(clampControlX(1.3)).toBe(1);
    expect(clampControlX(-0.2)).toBe(0);
    expect(clampControlX(0.5)).toBe(0.5);

    const right = withHandle(IDENTITY_BEZIER, 'p2', 1.3, 1.0);
    expect(right.cx2).toBe(1);
    expect(right.cy2).toBe(1.0);

    const left = withHandle(IDENTITY_BEZIER, 'p1', -0.5, -0.3);
    expect(left.cx1).toBe(0);
    expect(left.cy1).toBe(-0.3); // anticipation (negative y) is preserved
  });

  it('SetCurve stores cx <= 1 when a handle is dragged past 1 (author-time clamp)', () => {
    const { doc, animId, target, keyId } = rig();

    setKeyframeCurve(
      doc.history,
      animId,
      target,
      keyId,
      withHandle(IDENTITY_BEZIER, 'p2', 1.3, 1.0),
    );

    const resolved = indexKeyframes(doc.model.getAnimation(animId)!).get(keyId)!;
    expect(resolved.curve).toEqual({ type: 'bezier', cx1: 1 / 3, cy1: 1 / 3, cx2: 1, cy2: 1 });
  });

  it('switching linear -> bezier -> stepped -> linear and undoing four times restores the start', () => {
    const { doc, animId, target, keyId } = rig();
    const before = doc.model.snapshot();

    setKeyframeCurve(doc.history, animId, target, keyId, 'linear');
    setKeyframeCurve(doc.history, animId, target, keyId, IDENTITY_BEZIER);
    setKeyframeCurve(doc.history, animId, target, keyId, 'stepped');
    setKeyframeCurve(doc.history, animId, target, keyId, 'linear');

    doc.history.undo();
    doc.history.undo();
    doc.history.undo();
    doc.history.undo();

    expect(doc.model.snapshot()).toEqual(before);
  });

  it('coalesces a 40-step bezier handle drag into one undo step', () => {
    const { doc, animId, target, keyId } = rig();
    setKeyframeCurve(doc.history, animId, target, keyId, IDENTITY_BEZIER);
    const before = doc.model.snapshot();

    const commits = countCommits(doc, () => {
      doc.history.beginInteraction();
      for (let i = 1; i <= 40; i += 1) {
        const next = withHandle(IDENTITY_BEZIER, 'p2', i / 40, 1.0);
        doc.history.execute(new SetCurveCommand(animId, target, keyId, next));
      }
      doc.history.endInteraction('Set Curve');
    });

    expect(commits).toBe(1);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before); // one undo restores the pre-drag curve
  });

  it('plays a stepped curve as a held start value at the segment midpoint (runtime-core)', () => {
    const { doc, animId, target, keyId } = rig();

    // Linear baseline: the midpoint of [0, 0.4] interpolates the angle to 10.
    expect(rootRotationAt(exportDocument(doc.model), ANIMATION_NAME, 0.2)).toBeCloseTo(10, 6);

    // Author 'stepped' through the editor command, re-export, and sample: the midpoint now holds the
    // start angle (0) with no interpolation.
    setKeyframeCurve(doc.history, animId, target, keyId, 'stepped');
    expect(rootRotationAt(exportDocument(doc.model), ANIMATION_NAME, 0.2)).toBeCloseTo(0, 6);
  });
});
