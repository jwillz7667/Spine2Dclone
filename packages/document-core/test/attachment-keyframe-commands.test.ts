import { describe, expect, it } from 'vitest';
import {
  CommandTargetMissingError,
  DeleteAttachmentKeyframeCommand,
  DeleteSlotCommand,
  SetAttachmentKeyframeCommand,
  exportDocument,
  loadDocument,
  type AttachmentFrameEntity,
  type Document,
  type AnimationId,
  type SlotId,
} from '../src';
import { makeTestEnv, seeds } from './seeds';

function slotIdByName(doc: Document, name: string): SlotId {
  const slot = doc.model.slots().find((s) => s.name === name);
  if (!slot) throw new Error(`no slot named ${name}`);
  return slot.id;
}

function attachmentOf(
  doc: Document,
  animId: AnimationId,
  slotId: SlotId,
): readonly AttachmentFrameEntity[] {
  return doc.model.getAnimation(animId)?.slots.get(slotId)?.attachment ?? [];
}

describe('WP attachment-keyframe commands', () => {
  it('SetAttachmentKeyframe inserts at a new time and REPLACES at an existing time (no duplicate)', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const animation = doc.model.animations().find((a) => a.name === 'move')!;
    const slotId = slotIdByName(doc, 'mesh_slot');

    // Insert a resolvable swap at a free time (0.5) between the seed's frames at 0 and 1.
    doc.history.execute(new SetAttachmentKeyframeCommand(animation.id, slotId, 0.5, 'panel'));
    let at05 = attachmentOf(doc, animation.id, slotId).filter((f) => f.time === 0.5);
    expect(at05).toHaveLength(1);
    expect(at05[0]!.name).toBe('panel');

    // A second set at the SAME time replaces the existing frame (keeps its id) instead of duplicating.
    const priorId = at05[0]!.id;
    doc.history.execute(new SetAttachmentKeyframeCommand(animation.id, slotId, 0.5, null));
    at05 = attachmentOf(doc, animation.id, slotId).filter((f) => f.time === 0.5);
    expect(at05).toHaveLength(1);
    expect(at05[0]!.name).toBeNull();
    expect(at05[0]!.id).toBe(priorId);

    // The channel stays strictly time-sorted.
    const times = attachmentOf(doc, animation.id, slotId).map((f) => f.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('SetAttachmentKeyframe keeps the channel strictly ascending on an out-of-order insert', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const animation = doc.model.animations().find((a) => a.name === 'move')!;
    const slotId = slotIdByName(doc, 'mesh_slot');

    // Insert BEFORE both seed frames (t=0, t=1): the new frame at 0.25 must land in strict order.
    doc.history.execute(new SetAttachmentKeyframeCommand(animation.id, slotId, 0.25, 'panel'));
    const times = attachmentOf(doc, animation.id, slotId).map((f) => f.time);
    expect(times).toEqual([0, 0.25, 1]);
  });

  it('SetAttachmentKeyframe do/undo round-trips deep-equal for a new frame and a replace', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const animation = doc.model.animations().find((a) => a.name === 'move')!;
    const slotId = slotIdByName(doc, 'mesh_slot');
    const before = doc.model.snapshot();

    // New frame.
    doc.history.execute(new SetAttachmentKeyframeCommand(animation.id, slotId, 0.5, 'panel'));
    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);

    // Replace an existing frame's name at t=0 (panel -> null), then undo.
    doc.history.execute(new SetAttachmentKeyframeCommand(animation.id, slotId, 0, null));
    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('SetAttachmentKeyframe hides the slot with a null name and round-trips', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const animation = doc.model.animations().find((a) => a.name === 'move')!;
    const slotId = slotIdByName(doc, 'mesh_slot');
    const before = doc.model.snapshot();

    doc.history.execute(new SetAttachmentKeyframeCommand(animation.id, slotId, 0.5, null));
    const at05 = attachmentOf(doc, animation.id, slotId).find((f) => f.time === 0.5);
    expect(at05?.name).toBeNull();

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('SetAttachmentKeyframe rejects a non-resolving attachment name with no mutation', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const animation = doc.model.animations().find((a) => a.name === 'move')!;
    const slotId = slotIdByName(doc, 'mesh_slot');
    const before = doc.model.snapshot();

    expect(() =>
      doc.history.execute(new SetAttachmentKeyframeCommand(animation.id, slotId, 0.5, 'ghost')),
    ).toThrow(CommandTargetMissingError);
    expect(doc.model.snapshot()).toEqual(before); // no partial mutation
    expect(doc.history.canUndo).toBe(false); // no empty history entry
  });

  it('SetAttachmentKeyframe rejects an unknown animation and an unknown slot', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const animation = doc.model.animations().find((a) => a.name === 'move')!;
    const slotId = slotIdByName(doc, 'mesh_slot');
    const before = doc.model.snapshot();

    const unknownAnim = doc.ids.mint('animation');
    expect(() =>
      doc.history.execute(new SetAttachmentKeyframeCommand(unknownAnim, slotId, 0.5, null)),
    ).toThrow(CommandTargetMissingError);

    const unknownSlot = doc.ids.mint('slot');
    expect(() =>
      doc.history.execute(new SetAttachmentKeyframeCommand(animation.id, unknownSlot, 0.5, null)),
    ).toThrow(CommandTargetMissingError);

    expect(doc.model.snapshot()).toEqual(before);
    expect(doc.history.canUndo).toBe(false);
  });

  it('DeleteAttachmentKeyframe removes the frame at exactly time and undo restores it', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const animation = doc.model.animations().find((a) => a.name === 'move')!;
    const slotId = slotIdByName(doc, 'mesh_slot');
    const before = doc.model.snapshot();

    doc.history.execute(new DeleteAttachmentKeyframeCommand(animation.id, slotId, 0));
    const times = attachmentOf(doc, animation.id, slotId).map((f) => f.time);
    expect(times).toEqual([1]); // the t=0 frame is gone, the t=1 frame survives

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('DeleteAttachmentKeyframe rejects a missing frame time with no mutation', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const animation = doc.model.animations().find((a) => a.name === 'move')!;
    const slotId = slotIdByName(doc, 'mesh_slot');
    const before = doc.model.snapshot();

    expect(() =>
      doc.history.execute(new DeleteAttachmentKeyframeCommand(animation.id, slotId, 0.42)),
    ).toThrow(CommandTargetMissingError);
    expect(doc.model.snapshot()).toEqual(before);
    expect(doc.history.canUndo).toBe(false);
  });
});

describe('WP attachment-keyframe delete cascade', () => {
  it('DeleteSlot prunes the slot attachment track in one undo step and undo restores it', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const animation = doc.model.animations().find((a) => a.name === 'move')!;
    const slotId = slotIdByName(doc, 'mesh_slot');
    const before = doc.model.snapshot();
    expect(attachmentOf(doc, animation.id, slotId).length).toBeGreaterThan(0);

    doc.history.execute(new DeleteSlotCommand(slotId));
    expect(doc.model.getAnimation(animation.id)?.slots.has(slotId)).toBe(false); // track pruned

    let steps = 0;
    while (doc.history.canUndo) {
      doc.history.undo();
      steps += 1;
    }
    expect(steps).toBe(1); // slot + its attachment track removed in ONE undo step
    expect(doc.model.snapshot()).toEqual(before); // slot AND its attachment track restored
  });
});

describe('WP attachment-keyframe save/load round-trip', () => {
  it('an authored attachment timeline survives export and reload deep-equal', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const animation = doc.model.animations().find((a) => a.name === 'move')!;
    const slotId = slotIdByName(doc, 'mesh_slot');

    doc.history.execute(new SetAttachmentKeyframeCommand(animation.id, slotId, 0.5, 'panel'));
    const exported = exportDocument(doc.model);

    const reloaded = loadDocument(exported, makeTestEnv().env);
    // Re-export the reloaded document: the authored frame survives the format round-trip byte-for-byte.
    expect(exportDocument(reloaded.model)).toEqual(exported);

    const move = reloaded.model.animations().find((a) => a.name === 'move')!;
    const reloadedSlotId = reloaded.model.slots().find((s) => s.name === 'mesh_slot')!.id;
    const frames = move.slots.get(reloadedSlotId)?.attachment ?? [];
    expect(frames.map((f) => ({ time: f.time, name: f.name }))).toEqual([
      { time: 0, name: 'panel' },
      { time: 0.5, name: 'panel' },
      { time: 1, name: null },
    ]);
  });
});
