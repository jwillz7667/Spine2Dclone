import { describe, expect, it } from 'vitest';
import type { TumbleChoreography } from '@marionette/format/slot-types';
import { SetTumbleChoreographyCommand } from '../src/commands/set-tumble-choreography.command';
import {
  assertInvariants,
  createDocument,
  newDocState,
  SlotEditError,
  type Document,
} from '../src';
import { makeTestEnv } from './seeds';

// WP-4.10 SetTumbleChoreography command (command-history catalog slot.tumble.set). The do/undo round-trip is
// bit-exact (the generic harness also covers it); these targeted tests pin the set/undo, the negative-timing
// rejection, and the documented coalescing windows (Session for a timing-slider drag, Window for two discrete
// edits within 250ms), mirroring SetGridConfig.

function newSceneDoc(): Document {
  return createDocument(newDocState('scene'), makeTestEnv().env);
}

function countUndoSteps(doc: Document): number {
  let steps = 0;
  while (doc.history.canUndo) {
    doc.history.undo();
    steps += 1;
  }
  return steps;
}

function choreo(overrides: Partial<TumbleChoreography> = {}): TumbleChoreography {
  return {
    explodeMs: 120,
    dropMs: 200,
    dropEasing: 'easeOutQuad',
    refillStaggerMs: 40,
    settleMs: 80,
    stepGapMs: 150,
    rollupCurve: 'easeInOutCubic',
    ...overrides,
  };
}

describe('SetTumbleChoreography (slot.tumble.set)', () => {
  it('default document carries the all-zero linear tumble choreography', () => {
    const doc = newSceneDoc();
    expect(doc.model.slotScene().tumble).toEqual({
      explodeMs: 0,
      dropMs: 0,
      dropEasing: 'linear',
      refillStaggerMs: 0,
      settleMs: 0,
      stepGapMs: 0,
      rollupCurve: 'linear',
    });
    expect(() => assertInvariants(doc.model)).not.toThrow();
  });

  it('sets the choreography and restores it on undo (bit-exact)', () => {
    const doc = newSceneDoc();
    const before = doc.model.snapshot();
    doc.history.execute(new SetTumbleChoreographyCommand(choreo()));
    expect(doc.model.slotScene().tumble).toEqual(choreo());
    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
    expect(doc.model.slotScene().tumble).toEqual({
      explodeMs: 0,
      dropMs: 0,
      dropEasing: 'linear',
      refillStaggerMs: 0,
      settleMs: 0,
      stepGapMs: 0,
      rollupCurve: 'linear',
    });
  });

  it('slotTumble() reads the same value as slotScene().tumble', () => {
    const doc = newSceneDoc();
    doc.history.execute(new SetTumbleChoreographyCommand(choreo({ dropMs: 333 })));
    expect(doc.model.slotTumble()).toEqual(doc.model.slotScene().tumble);
    expect(doc.model.slotTumble().dropMs).toBe(333);
  });

  it.each([
    ['negative explodeMs', choreo({ explodeMs: -1 })],
    ['non-integer dropMs', choreo({ dropMs: 12.5 })],
    ['negative settleMs', choreo({ settleMs: -50 })],
    ['non-finite stepGapMs', choreo({ stepGapMs: Number.POSITIVE_INFINITY })],
  ] as const)('rejects %s with a typed SlotEditError and no mutation', (_label, bad) => {
    const doc = newSceneDoc();
    const before = doc.model.snapshot();
    expect(() => doc.history.execute(new SetTumbleChoreographyCommand(bad))).toThrow(SlotEditError);
    expect(doc.model.snapshot()).toEqual(before);
    expect(doc.history.canUndo).toBe(false);
  });

  it('coalesces a timing-slider drag into one undo step keeping the original before (Session)', () => {
    const doc = newSceneDoc();
    const before = doc.model.snapshot();
    doc.history.beginInteraction();
    for (let dropMs = 100; dropMs <= 300; dropMs += 50) {
      doc.history.execute(new SetTumbleChoreographyCommand(choreo({ dropMs })));
    }
    const event = doc.history.endInteraction('Set Tumble Choreography');
    expect(event?.kind).toBe('slot.tumble.set'); // single command, not a composite
    expect(doc.model.slotScene().tumble.dropMs).toBe(300); // final metric applied
    expect(countUndoSteps(doc)).toBe(1);
    expect(doc.model.snapshot()).toEqual(before); // one undo restores the pre-session choreography
  });

  it('window-merges two discrete edits within 250ms and not beyond it', () => {
    const within = makeTestEnv();
    const a = createDocument(newDocState('a'), within.env);
    within.setNow(0);
    a.history.execute(new SetTumbleChoreographyCommand(choreo({ settleMs: 10 })));
    within.setNow(100);
    a.history.execute(new SetTumbleChoreographyCommand(choreo({ settleMs: 20 })));
    expect(countUndoSteps(a)).toBe(1);

    const beyond = makeTestEnv();
    const b = createDocument(newDocState('b'), beyond.env);
    beyond.setNow(0);
    b.history.execute(new SetTumbleChoreographyCommand(choreo({ settleMs: 10 })));
    beyond.setNow(300);
    b.history.execute(new SetTumbleChoreographyCommand(choreo({ settleMs: 20 })));
    expect(countUndoSteps(b)).toBe(2);
  });
});
