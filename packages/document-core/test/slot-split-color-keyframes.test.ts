import { describe, expect, it } from 'vitest';
import {
  CreateAnimationCommand,
  DeleteKeyframeCommand,
  MoveKeyframeCommand,
  SetCurveCommand,
  SetKeyframeCommand,
  TimelineError,
  exportDocument,
  loadDocument,
  type AnimationId,
  type Document,
  type KeyframeTarget,
  type SlotId,
} from '../src';
import { makeTestEnv, seeds } from './seeds';

// Stage F2 (ADR-0009 section 4.2, PP-D10) split slot-color tracks (`rgb`, an RGB triple; `alpha`, a lone
// channel), promoted from carried format arrays to first-class editable id-keyed keyframes served by the
// generic SetKeyframe / MoveKeyframe / DeleteKeyframe / SetCurve commands. These tests pin the split-channel
// behaviors the generic harness does not: the joint-color/split coexistence ban and lossless load/export.

function animatedDoc(): Document {
  const { env } = makeTestEnv();
  return loadDocument(seeds.animated, env);
}

function bodySlotId(doc: Document): SlotId {
  const slot = doc.model.slots()[0];
  if (!slot) throw new Error('animated seed lost its slot');
  return slot.id;
}

// A fresh empty animation (the seed idle animation already keys the JOINT color on body, which the split
// promotion tests must avoid).
function freshAnim(doc: Document): AnimationId {
  const id = doc.ids.mint('animation');
  doc.history.execute(new CreateAnimationCommand(id, 'split', 1));
  return id;
}

function rgbKeys(doc: Document, animId: AnimationId, slotId: SlotId) {
  return doc.model.animations().find((a) => a.id === animId)?.slots.get(slotId)?.rgb ?? [];
}

describe('split slot-color keyframes (Stage F2)', () => {
  it('keys the split rgb and alpha channels and round-trips do/undo', () => {
    const doc = animatedDoc();
    const slotId = bodySlotId(doc);
    const animId = freshAnim(doc);
    const before = doc.model.snapshot();

    const rgbTarget: KeyframeTarget = { kind: 'slot', slotId, channel: 'rgb' };
    const alphaTarget: KeyframeTarget = { kind: 'slot', slotId, channel: 'alpha' };
    doc.history.execute(new SetKeyframeCommand(animId, rgbTarget, 0.5, { rgb: { r: 1, g: 0, b: 0 } }));
    doc.history.execute(new SetKeyframeCommand(animId, alphaTarget, 0.5, { alpha: 0.5 }));

    const keys = rgbKeys(doc, animId, slotId);
    expect(keys.map((k) => ('rgb' in k.value ? k.value.rgb : null))).toEqual([{ r: 1, g: 0, b: 0 }]);

    doc.history.undo();
    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('rejects keying a split channel while the joint color is keyed (componentConflict)', () => {
    const doc = animatedDoc();
    const slotId = bodySlotId(doc);
    // The seed idle animation already keys the JOINT color channel on body.
    const animation = doc.model.animations()[0]!;
    const before = doc.model.snapshot();

    let thrown: unknown;
    try {
      doc.history.execute(
        new SetKeyframeCommand(animation.id, { kind: 'slot', slotId, channel: 'rgb' }, 0.5, {
          rgb: { r: 1, g: 1, b: 1 },
        }),
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TimelineError);
    expect((thrown as TimelineError).reason).toBe('componentConflict');
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('rejects keying the joint color while a split channel is keyed (componentConflict)', () => {
    const doc = animatedDoc();
    const slotId = bodySlotId(doc);
    const animId = freshAnim(doc);
    doc.history.execute(
      new SetKeyframeCommand(animId, { kind: 'slot', slotId, channel: 'alpha' }, 0.5, { alpha: 1 }),
    );

    expect(() =>
      doc.history.execute(
        new SetKeyframeCommand(animId, { kind: 'slot', slotId, channel: 'color' }, 0.5, {
          color: { r: 1, g: 1, b: 1, a: 1 },
        }),
      ),
    ).toThrowError(TimelineError);
  });

  it('moves, recurves, and deletes a split keyframe with clean undo', () => {
    const doc = animatedDoc();
    const slotId = bodySlotId(doc);
    const animId = freshAnim(doc);
    const target: KeyframeTarget = { kind: 'slot', slotId, channel: 'alpha' };
    doc.history.execute(new SetKeyframeCommand(animId, target, 0.25, { alpha: 0.3 }));

    const before = doc.model.snapshot();
    const keyId = doc.model.animations().find((a) => a.id === animId)!.slots.get(slotId)!.alpha[0]!
      .id;

    doc.history.execute(new MoveKeyframeCommand(animId, target, keyId, 0.75));
    doc.history.execute(new SetCurveCommand(animId, target, keyId, 'stepped'));
    doc.history.execute(new DeleteKeyframeCommand(animId, target, keyId));

    doc.history.undo();
    doc.history.undo();
    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('promotes split tracks losslessly through load and export', () => {
    const doc = animatedDoc();
    const slotId = bodySlotId(doc);
    const animId = freshAnim(doc);
    doc.history.execute(
      new SetKeyframeCommand(animId, { kind: 'slot', slotId, channel: 'rgb' }, 0.5, {
        rgb: { r: 0.2, g: 0.4, b: 0.6 },
      }),
    );
    doc.history.execute(
      new SetKeyframeCommand(animId, { kind: 'slot', slotId, channel: 'alpha' }, 0.5, { alpha: 0.8 }),
    );

    const exported = exportDocument(doc.model);
    const splitAnim = exported.animations['split'];
    const onlySlot = splitAnim ? Object.values(splitAnim.slots)[0] : undefined;
    expect(onlySlot?.rgb).toEqual([{ time: 0.5, value: { rgb: { r: 0.2, g: 0.4, b: 0.6 } }, curve: 'linear' }]);
    expect(onlySlot?.alpha).toEqual([{ time: 0.5, value: { alpha: 0.8 }, curve: 'linear' }]);

    const { env } = makeTestEnv();
    const reloaded = loadDocument(exported, env);
    expect(exportDocument(reloaded.model)).toEqual(exported);
  });
});
