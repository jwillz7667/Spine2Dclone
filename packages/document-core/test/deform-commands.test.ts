import { describe, expect, it } from 'vitest';
import {
  DeformError,
  assertInvariants,
  loadDocument,
  type AnimationEntity,
  type AnimationId,
  type DeformKeyframeEntity,
  type DeformSkinKey,
  type Document,
  type SlotId,
} from '../src';
import { ClearAttachmentDeformCommand } from '../src/commands/clear-attachment-deform.command';
import { DeleteDeformKeyframeCommand } from '../src/commands/delete-deform-keyframe.command';
import { MoveDeformKeyframeCommand } from '../src/commands/move-deform-keyframe.command';
import { SetDeformKeyframeCommand } from '../src/commands/set-deform-keyframe.command';
import { makeTestEnv, seeds } from './seeds';

// The single deform track the 'rigged' seed authors: default skin, mesh_slot, 'panel' attachment.
interface DeformTrack {
  readonly anim: AnimationEntity;
  readonly skinKey: DeformSkinKey;
  readonly slotId: SlotId;
  readonly attachmentName: string;
  readonly frames: readonly DeformKeyframeEntity[];
}

function moveAnimation(doc: Document): AnimationEntity {
  const anim = doc.model.animations().find((a) => a.name === 'move');
  if (!anim) throw new Error('rigged seed had no "move" animation');
  return anim;
}

function meshSlotId(doc: Document): SlotId {
  const slot = doc.model.slots().find((s) => s.name === 'mesh_slot');
  if (!slot) throw new Error('rigged seed had no "mesh_slot"');
  return slot.id;
}

// The default-skin 'panel' deform track in the 'move' animation (the seed authors exactly one).
function panelTrack(doc: Document): DeformTrack {
  const anim = moveAnimation(doc);
  const slotId = meshSlotId(doc);
  const frames = anim.deform.get('default')?.get(slotId)?.get('panel');
  if (!frames) throw new Error('rigged seed had no default/mesh_slot/panel deform track');
  return { anim, skinKey: 'default', slotId, attachmentName: 'panel', frames };
}

function deformFrames(
  doc: Document,
  animId: AnimationId,
  slotId: SlotId,
): readonly DeformKeyframeEntity[] {
  return doc.model.getAnimation(animId)?.deform.get('default')?.get(slotId)?.get('panel') ?? [];
}

describe('WP-2.9 deform timeline commands', () => {
  it('SetDeformKeyframe rejects an offsets array of the wrong length (offsetLength)', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const { anim, slotId } = panelTrack(doc);
    const before = doc.model.snapshot();

    // The 'panel' mesh has 4 logical vertices (uvs length 8), so offsets must be length 8.
    expect(() =>
      doc.history.execute(
        new SetDeformKeyframeCommand(anim.id, 'default', slotId, 'panel', 0.5, [1, 0, 1]),
      ),
    ).toThrow(DeformError);
    expect(doc.model.snapshot()).toEqual(before); // no partial mutation
    expect(doc.history.canUndo).toBe(false); // no empty history entry
    assertInvariants(doc.model);
  });

  it('SetDeformKeyframe rejects a non-mesh / absent target (notMesh)', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const { anim, slotId } = panelTrack(doc);
    const before = doc.model.snapshot();

    // The default skin has no attachment named 'missing' on mesh_slot, so the target does not resolve.
    expect(() =>
      doc.history.execute(
        new SetDeformKeyframeCommand(
          anim.id,
          'default',
          slotId,
          'missing',
          0.5,
          [0, 0, 0, 0, 0, 0, 0, 0],
        ),
      ),
    ).toThrow(DeformError);
    expect(doc.model.snapshot()).toEqual(before);
    expect(doc.history.canUndo).toBe(false);
    assertInvariants(doc.model);
  });

  it('SetDeformKeyframe coalesces a vertex drag into one undo step', () => {
    const { env, advance } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const { anim, slotId } = panelTrack(doc);
    const before = doc.model.snapshot();

    // The drag first INSERTS a keyframe at a free time, then re-sets the SAME keyframe time repeatedly
    // (a vertex being dragged), with gaps far beyond the 250ms window. All collapse to one undo step.
    doc.history.beginInteraction();
    for (let i = 1; i <= 5; i += 1) {
      if (i > 1) advance(300);
      const offsets = [i, 0, i, 0, i, 0, i, 0];
      doc.history.execute(
        new SetDeformKeyframeCommand(anim.id, 'default', slotId, 'panel', 0.5, offsets),
      );
    }
    const event = doc.history.endInteraction('Set Deform Keyframe');
    expect(event?.kind).toBe('deform.setKeyframe'); // one merged command, not a composite
    assertInvariants(doc.model);

    const at05 = deformFrames(doc, anim.id, slotId).filter((k) => k.time === 0.5);
    expect(at05).toHaveLength(1);
    expect(at05[0]!.offsets).toEqual([5, 0, 5, 0, 5, 0, 5, 0]);

    let steps = 0;
    while (doc.history.canUndo) {
      doc.history.undo();
      steps += 1;
    }
    expect(steps).toBe(1);
    expect(doc.model.snapshot()).toEqual(before); // one undo reverts the whole drag
    assertInvariants(doc.model);
  });

  it('DeleteDeformKeyframe removes one key and undo restores it exactly', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const { anim, slotId, frames } = panelTrack(doc);
    const before = doc.model.snapshot();

    const first = frames[0]!;
    doc.history.execute(
      new DeleteDeformKeyframeCommand(anim.id, 'default', slotId, 'panel', first.id),
    );
    expect(deformFrames(doc, anim.id, slotId).some((k) => k.id === first.id)).toBe(false);
    assertInvariants(doc.model);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
    assertInvariants(doc.model);
  });

  it('MoveDeformKeyframe moves a key to a free time, round-trips, and rejects a collision', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const { anim, slotId, frames } = panelTrack(doc);
    const before = doc.model.snapshot();

    const first = frames[0]!; // t=0
    const second = frames[1]!; // t=1
    const midpoint = (first.time + second.time) / 2; // 0.5, strictly between, free
    doc.history.execute(
      new MoveDeformKeyframeCommand(anim.id, 'default', slotId, 'panel', first.id, midpoint),
    );
    const moved = deformFrames(doc, anim.id, slotId).find((k) => k.id === first.id);
    expect(moved?.time).toBe(midpoint);
    assertInvariants(doc.model);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
    assertInvariants(doc.model);

    // Moving the first key onto the second key's time (1) is rejected with no mutation.
    expect(() =>
      doc.history.execute(
        new MoveDeformKeyframeCommand(anim.id, 'default', slotId, 'panel', first.id, second.time),
      ),
    ).toThrow();
    expect(doc.model.snapshot()).toEqual(before);
    expect(doc.history.canUndo).toBe(false);
    assertInvariants(doc.model);
  });

  it('ClearAttachmentDeform removes the track across animations and undo restores it', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const slotId = meshSlotId(doc);
    const anim = moveAnimation(doc);
    const before = doc.model.snapshot();
    expect(deformFrames(doc, anim.id, slotId).length).toBeGreaterThan(0);

    doc.history.execute(new ClearAttachmentDeformCommand(slotId, 'panel'));
    expect(deformFrames(doc, anim.id, slotId)).toHaveLength(0); // track pruned
    assertInvariants(doc.model);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before); // every cleared track restored deep-equal
    assertInvariants(doc.model);
  });
});
