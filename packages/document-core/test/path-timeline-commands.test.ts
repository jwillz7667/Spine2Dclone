import { describe, expect, it } from 'vitest';
import {
  DeletePathKeyframeCommand,
  MovePathKeyframeCommand,
  SetPathKeyframeCommand,
  loadDocument,
  type AnimationId,
  type Document,
  type PathConstraintId,
} from '../src';
import { makeTestEnv, pathedSeed } from './seeds';

// PP-D11 path timeline authoring: the round-trip harness proves each command's do/undo is bit-exact on the
// 'pathed' seed; this file pins the insert/update semantics, the coalesced move sequence, and the collision
// rejection.

const NO_CHANNELS = {
  position: undefined,
  spacing: undefined,
  mixRotate: undefined,
  mixX: undefined,
  mixY: undefined,
};

function glidePathTrack(doc: Document): { animId: AnimationId; constraintId: PathConstraintId } {
  const animation = doc.model.animations().find((a) => a.name === 'glide')!;
  const entry = [...animation.path][0]!;
  return { animId: animation.id, constraintId: entry[0] };
}

describe('SetPathKeyframe', () => {
  it('inserts a new keyframe and updates an existing one in place', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(pathedSeed, env);
    const { animId, constraintId } = glidePathTrack(doc);
    const animation = doc.model.getAnimation(animId)!;
    const startCount = animation.path.get(constraintId)!.length;

    // Insert at t=0.5 (a free time between the seed's t=0 and t=1 keys).
    doc.history.execute(
      new SetPathKeyframeCommand(animId, constraintId, 0.5, {
        ...NO_CHANNELS,
        position: 0.5,
      }),
    );
    let frames = doc.model.getAnimation(animId)!.path.get(constraintId)!;
    expect(frames.length).toBe(startCount + 1);
    const inserted = frames.find((f) => f.time === 0.5)!;
    expect(inserted.position).toBe(0.5);

    // Update the same time in place: count unchanged, value replaced.
    doc.history.execute(
      new SetPathKeyframeCommand(animId, constraintId, 0.5, {
        ...NO_CHANNELS,
        position: 0.9,
      }),
    );
    frames = doc.model.getAnimation(animId)!.path.get(constraintId)!;
    expect(frames.length).toBe(startCount + 1);
    expect(frames.find((f) => f.time === 0.5)!.position).toBe(0.9);
  });
});

describe('DeletePathKeyframe', () => {
  it('removes one keyframe and prunes the track when it empties', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(pathedSeed, env);
    const { animId, constraintId } = glidePathTrack(doc);
    const frames = doc.model.getAnimation(animId)!.path.get(constraintId)!;

    // Delete both keys; the second delete empties the track, which the mutator prunes.
    for (const kf of [...frames]) {
      doc.history.execute(new DeletePathKeyframeCommand(animId, constraintId, kf.id));
    }
    expect(doc.model.getAnimation(animId)!.path.has(constraintId)).toBe(false);
  });
});

describe('MovePathKeyframe', () => {
  it('coalesces a keyframe drag into one undo step and rejects a collision', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(pathedSeed, env);
    const { animId, constraintId } = glidePathTrack(doc);
    const frames = doc.model.getAnimation(animId)!.path.get(constraintId)!;
    const last = frames[frames.length - 1]!;
    const before = doc.model.snapshot();

    doc.history.beginInteraction();
    for (let i = 1; i <= 5; i += 1) {
      doc.history.execute(
        new MovePathKeyframeCommand(animId, constraintId, last.id, 0.5 + i * 0.02),
      );
    }
    const event = doc.history.endInteraction('Move Path Keyframe');
    expect(event?.kind).toBe('path.moveKeyframe');

    let steps = 0;
    while (doc.history.canUndo) {
      doc.history.undo();
      steps += 1;
    }
    expect(steps).toBe(1);
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('rejects a move onto an occupied time and mutates nothing', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(pathedSeed, env);
    const { animId, constraintId } = glidePathTrack(doc);
    const frames = doc.model.getAnimation(animId)!.path.get(constraintId)!;
    const first = frames[0]!;
    const second = frames[1]!;
    const before = doc.model.snapshot();

    expect(() =>
      doc.history.execute(new MovePathKeyframeCommand(animId, constraintId, second.id, first.time)),
    ).toThrow();
    expect(doc.model.snapshot()).toEqual(before);
  });
});
