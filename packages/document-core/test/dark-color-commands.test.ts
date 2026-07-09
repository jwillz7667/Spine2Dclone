import { describe, expect, it } from 'vitest';
import {
  SetKeyframeCommand,
  SetSlotDarkColorCommand,
  TimelineError,
  assertInvariants,
  exportDocument,
  loadDocument,
  type Document,
  type KeyframeTarget,
  type SlotId,
} from '../src';
import { makeTestEnv, seeds } from './seeds';

// PP-D10 (Stage F2) two-color dark tint (ADR-0009 section 4.3). SetSlotDarkColor sets the setup dark color;
// keying the `dark` timeline (via the generic SetKeyframe on a slot 'dark' target) requires that setup dark
// color (the format's ANIM_DARK_NO_SETUP). The generic round-trip harness covers slot.darkColor; these tests
// pin the setup coalescing, the darkNoSetup guard, and the dark-key round-trip + export.

function firstSlot(doc: Document): SlotId {
  const slot = doc.model.slots()[0];
  if (!slot) throw new Error('seed had no slots');
  return slot.id;
}

describe('SetSlotDarkColor', () => {
  it('sets and clears the setup dark color, round-tripping', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.slotted, env);
    const slotId = firstSlot(doc);
    expect(doc.model.getSlot(slotId)!.darkColor).toBeNull();
    const before = doc.model.snapshot();

    doc.history.execute(new SetSlotDarkColorCommand(slotId, { r: 0.2, g: 0.1, b: 0.4, a: 1 }));
    expect(doc.model.getSlot(slotId)!.darkColor).toEqual({ r: 0.2, g: 0.1, b: 0.4, a: 1 });
    assertInvariants(doc.model);

    doc.history.execute(new SetSlotDarkColorCommand(slotId, null));
    expect(doc.model.getSlot(slotId)!.darkColor).toBeNull();

    doc.history.undo();
    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('coalesces a picker stroke into one undo step', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.slotted, env);
    const slotId = firstSlot(doc);
    const before = doc.model.snapshot();

    doc.history.beginInteraction();
    for (let i = 1; i <= 4; i += 1) {
      doc.history.execute(new SetSlotDarkColorCommand(slotId, { r: i / 10, g: 0, b: 0, a: 1 }));
    }
    const event = doc.history.endInteraction('Set Slot Dark Color');
    expect(event?.kind).toBe('slot.darkColor');
    let steps = 0;
    while (doc.history.canUndo) {
      doc.history.undo();
      steps += 1;
    }
    expect(steps).toBe(1);
    expect(doc.model.snapshot()).toEqual(before);
  });
});

describe('dark timeline (keyable two-color)', () => {
  it('rejects keying dark on a slot with no setup dark color (darkNoSetup)', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.animated, env);
    const animId = doc.model.animations()[0]!.id;
    const slotId = firstSlot(doc);
    const target: KeyframeTarget = { kind: 'slot', slotId, channel: 'dark' };
    const before = doc.model.snapshot();
    try {
      doc.history.execute(new SetKeyframeCommand(animId, target, 0.5, { color: { r: 0, g: 0, b: 0, a: 1 } }));
      throw new Error('expected TimelineError');
    } catch (error) {
      expect(error).toBeInstanceOf(TimelineError);
      expect((error as TimelineError).reason).toBe('darkNoSetup');
    }
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('keys the dark channel once setup dark color exists, and round-trips through export', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.animated, env);
    const animId = doc.model.animations()[0]!.id;
    const slotId = firstSlot(doc);
    const target: KeyframeTarget = { kind: 'slot', slotId, channel: 'dark' };

    doc.history.execute(new SetSlotDarkColorCommand(slotId, { r: 0.1, g: 0.1, b: 0.1, a: 1 }));
    const before = doc.model.snapshot();

    doc.history.execute(new SetKeyframeCommand(animId, target, 0.5, { color: { r: 1, g: 0, b: 0, a: 1 } }));
    const darkKeys = doc.model.getAnimation(animId)!.slots.get(slotId)!.dark;
    expect(darkKeys).toHaveLength(1);
    assertInvariants(doc.model);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);

    // Redo and confirm the dark timeline survives export + reload deep-equal.
    doc.history.redo();
    const reloaded = loadDocument(exportDocument(doc.model), makeTestEnv().env);
    expect(reloaded.model.snapshot()).toEqual(doc.model.snapshot());
  });
});
