import { describe, expect, it } from 'vitest';
import {
  DeletePhysicsKeyframeCommand,
  KeyframeCollisionError,
  MovePhysicsKeyframeCommand,
  SetPhysicsKeyframeCommand,
  assertInvariants,
  loadDocument,
  type Document,
} from '../src';
import { makeTestEnv, physicsedSeed } from './seeds';

// PP-D12 physics timeline authoring: the round-trip harness proves each keyframe command's do/undo is bit-exact
// on the 'physicsed' seed; this file pins the insert/update semantics, the coalesced move merged sequence and
// its time-collision rejection, and the track prune on the last delete.

function jiggleTrack(doc: Document) {
  const animation = doc.model.animations().find((a) => a.name === 'jiggle')!;
  const entry = [...animation.physics][0]!;
  return { animation, constraintId: entry[0], frames: entry[1] };
}

describe('SetPhysicsKeyframe', () => {
  it('inserts a new keyframe at a free time and undoes', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(physicsedSeed, env);
    const { animation, constraintId, frames } = jiggleTrack(doc);
    const before = doc.model.snapshot();
    const time = (frames[0]!.time + frames[1]!.time) / 2;

    doc.history.execute(
      new SetPhysicsKeyframeCommand(animation.id, constraintId, time, {
        mix: 0.5,
        inertia: undefined,
        strength: undefined,
        damping: undefined,
        wind: 2.5,
        gravity: undefined,
      }),
    );
    const after = doc.model.animations().find((a) => a.name === 'jiggle')!;
    expect(after.physics.get(constraintId)).toHaveLength(frames.length + 1);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('updates an existing keyframe in place (same time, no new id)', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(physicsedSeed, env);
    const { animation, constraintId, frames } = jiggleTrack(doc);
    const first = frames[0]!;

    doc.history.execute(
      new SetPhysicsKeyframeCommand(animation.id, constraintId, first.time, {
        mix: 0.25,
        inertia: undefined,
        strength: undefined,
        damping: undefined,
        wind: undefined,
        gravity: undefined,
      }),
    );
    const after = doc.model.animations().find((a) => a.name === 'jiggle')!;
    const track = after.physics.get(constraintId)!;
    expect(track).toHaveLength(frames.length); // updated, not inserted
    expect(track.find((kf) => kf.id === first.id)!.mix).toBe(0.25);
  });
});

describe('MovePhysicsKeyframe', () => {
  it('coalesces a keyframe drag into one undo step', () => {
    const { env, advance } = makeTestEnv();
    const doc = loadDocument(physicsedSeed, env);
    const { animation, constraintId, frames } = jiggleTrack(doc);
    const preStroke = doc.model.snapshot();
    const moving = frames[frames.length - 1]!;

    doc.history.beginInteraction();
    doc.history.execute(new MovePhysicsKeyframeCommand(animation.id, constraintId, moving.id, 0.6));
    advance(300);
    doc.history.execute(new MovePhysicsKeyframeCommand(animation.id, constraintId, moving.id, 0.7));
    advance(300);
    doc.history.execute(new MovePhysicsKeyframeCommand(animation.id, constraintId, moving.id, 0.8));
    doc.history.endInteraction('Move Physics Keyframe');

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(preStroke); // one undo restores the pre-drag times
    expect(doc.history.canUndo).toBe(false);
    expect(() => assertInvariants(doc.model)).not.toThrow();
  });

  it('rejects a move onto a time another keyframe occupies (KeyframeCollisionError)', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(physicsedSeed, env);
    const { animation, constraintId, frames } = jiggleTrack(doc);
    const before = doc.model.snapshot();
    const first = frames[0]!;
    const second = frames[1]!;

    expect(() =>
      doc.history.execute(
        new MovePhysicsKeyframeCommand(animation.id, constraintId, first.id, second.time),
      ),
    ).toThrow(KeyframeCollisionError);
    expect(doc.model.snapshot()).toEqual(before); // rejected before any mutation
  });
});

describe('DeletePhysicsKeyframe', () => {
  it('removes a keyframe and prunes the track when it empties', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(physicsedSeed, env);
    const { animation, constraintId, frames } = jiggleTrack(doc);
    const before = doc.model.snapshot();

    // Delete every frame; the track must prune to absent.
    for (const kf of frames) {
      doc.history.execute(new DeletePhysicsKeyframeCommand(animation.id, constraintId, kf.id));
    }
    const emptied = doc.model.animations().find((a) => a.name === 'jiggle')!;
    expect(emptied.physics.has(constraintId)).toBe(false);

    while (doc.history.canUndo) doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });
});
