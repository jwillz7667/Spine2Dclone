import { describe, expect, it } from 'vitest';
import type { WinSequenceStep } from '@marionette/format/slot-types';
import { CreateWinSequenceCommand } from '../src/commands/create-win-sequence.command';
import { SetWinSequenceStepCommand } from '../src/commands/set-win-sequence-step.command';
import { ReorderWinSequenceStepCommand } from '../src/commands/reorder-win-sequence-step.command';
import { SetEscalationThresholdCommand } from '../src/commands/set-escalation-threshold.command';
import {
  assertInvariants,
  createDocument,
  newDocState,
  SlotEditError,
  type Document,
} from '../src';
import { makeTestEnv } from './seeds';

// WP-4.8 win presentation sequencer commands (command-history catalog slot.winseq.*). Each command's
// do/undo round-trip is bit-exact (the generic harness also covers it); these targeted tests pin the
// duplicate-name / unknown-sequence / out-of-range rejections, the threshold set/undo, the step
// append/replace, the reorder permutation, and the documented coalescing windows (Session for step/reorder,
// Window for threshold).

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

const animateStep: WinSequenceStep = {
  atMs: 0,
  target: { kind: 'allWinningCells' },
  action: { kind: 'animateWin' },
};
const vfxStep: WinSequenceStep = {
  atMs: 200,
  target: { kind: 'byLine', index: 4 },
  action: { kind: 'vfx', preset: 'coinShower', anchorRule: 'eachCell' },
};
const rollupStep: WinSequenceStep = {
  atMs: 500,
  target: { kind: 'allWinningCells' },
  action: { kind: 'rollupStart', curve: 'linear' },
};

describe('CreateWinSequence (slot.winseq.create)', () => {
  it('default document carries one empty "base" sequence and "base" as defaultSequence', () => {
    const doc = newSceneDoc();
    const ws = doc.model.slotScene().winSequencer;
    expect(Object.keys(ws.sequences)).toEqual(['base']);
    expect(ws.sequences['base']?.steps).toEqual([]);
    expect(ws.defaultSequence).toBe('base');
    expect(() => assertInvariants(doc.model)).not.toThrow();
  });

  it('adds a named empty sequence and round-trips on undo (bit-exact)', () => {
    const doc = newSceneDoc();
    const before = doc.model.snapshot();
    doc.history.execute(new CreateWinSequenceCommand('bonus'));
    const ws = doc.model.slotScene().winSequencer;
    expect(ws.sequences['bonus']).toEqual({ steps: [] });
    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('rejects a duplicate name with a typed SlotEditError and no mutation', () => {
    const doc = newSceneDoc();
    const before = doc.model.snapshot();
    expect(() => doc.history.execute(new CreateWinSequenceCommand('base'))).toThrow(SlotEditError);
    expect(() => doc.history.execute(new CreateWinSequenceCommand('base'))).toThrow(
      expect.objectContaining({ reason: 'duplicateSequence' }),
    );
    expect(doc.model.snapshot()).toEqual(before);
    expect(doc.history.canUndo).toBe(false);
  });

  it('rejects an empty name with emptyName and no mutation', () => {
    const doc = newSceneDoc();
    expect(() => doc.history.execute(new CreateWinSequenceCommand(''))).toThrow(
      expect.objectContaining({ reason: 'emptyName' }),
    );
  });
});

describe('SetWinSequenceStep (slot.winseq.step)', () => {
  it('appends then replaces a step, round-trips on undo', () => {
    // Use a controllable clock and step the two edits OUTSIDE the 250ms window so they stay two distinct
    // undo steps (the same-target Window merge is asserted separately below).
    const env = makeTestEnv();
    const doc = createDocument(newDocState('scene'), env.env);
    const before = doc.model.snapshot();
    env.setNow(0);
    doc.history.execute(new SetWinSequenceStepCommand('base', 0, animateStep));
    expect(doc.model.slotScene().winSequencer.sequences['base']?.steps).toEqual([animateStep]);
    // Replace index 0 with the vfx step, beyond the window so it is a separate undo step.
    env.setNow(500);
    doc.history.execute(new SetWinSequenceStepCommand('base', 0, vfxStep));
    expect(doc.model.slotScene().winSequencer.sequences['base']?.steps).toEqual([vfxStep]);
    expect(countUndoSteps(doc)).toBe(2);
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('window-merges two same-target step edits within 250ms into one undo step', () => {
    const env = makeTestEnv();
    const doc = createDocument(newDocState('scene'), env.env);
    const before = doc.model.snapshot();
    env.setNow(0);
    doc.history.execute(new SetWinSequenceStepCommand('base', 0, animateStep));
    env.setNow(100); // inside the 250ms window, same (sequence, index) target
    doc.history.execute(new SetWinSequenceStepCommand('base', 0, vfxStep));
    expect(doc.model.slotScene().winSequencer.sequences['base']?.steps).toEqual([vfxStep]);
    expect(countUndoSteps(doc)).toBe(1);
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('rejects an unknown sequence name with sequenceMissing', () => {
    const doc = newSceneDoc();
    const before = doc.model.snapshot();
    expect(() =>
      doc.history.execute(new SetWinSequenceStepCommand('ghost', 0, animateStep)),
    ).toThrow(expect.objectContaining({ reason: 'sequenceMissing' }));
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('rejects an out-of-range index with stepIndexOutOfRange', () => {
    const doc = newSceneDoc();
    // base has 0 steps, so index 1 is out of [0, 0].
    expect(() =>
      doc.history.execute(new SetWinSequenceStepCommand('base', 1, animateStep)),
    ).toThrow(expect.objectContaining({ reason: 'stepIndexOutOfRange' }));
  });

  it('coalesces same-target step edits (Session) into one undo step keeping the original before', () => {
    const doc = newSceneDoc();
    const before = doc.model.snapshot();
    doc.history.beginInteraction();
    for (let atMs = 0; atMs <= 300; atMs += 100) {
      doc.history.execute(new SetWinSequenceStepCommand('base', 0, { ...animateStep, atMs }));
    }
    const event = doc.history.endInteraction('Set Win Sequence Step');
    expect(event?.kind).toBe('slot.winseq.step'); // single command, not a composite
    expect(doc.model.slotScene().winSequencer.sequences['base']?.steps[0]?.atMs).toBe(300);
    expect(countUndoSteps(doc)).toBe(1);
    expect(doc.model.snapshot()).toEqual(before); // one undo restores the pre-session state
  });

  it('does NOT coalesce edits to a DIFFERENT step index', () => {
    const doc = newSceneDoc();
    doc.history.beginInteraction();
    doc.history.execute(new SetWinSequenceStepCommand('base', 0, animateStep)); // append index 0
    doc.history.execute(new SetWinSequenceStepCommand('base', 1, vfxStep)); // append index 1 (diff target)
    const event = doc.history.endInteraction('edit');
    expect(event?.kind).toBe('composite'); // two distinct targets do not merge
    expect(doc.model.slotScene().winSequencer.sequences['base']?.steps).toHaveLength(2);
  });
});

describe('ReorderWinSequenceStep (slot.winseq.reorder)', () => {
  function populated(): Document {
    const doc = newSceneDoc();
    doc.history.execute(new SetWinSequenceStepCommand('base', 0, animateStep));
    doc.history.execute(new SetWinSequenceStepCommand('base', 1, vfxStep));
    doc.history.execute(new SetWinSequenceStepCommand('base', 2, rollupStep));
    return doc;
  }

  it('reverses the step order and round-trips on undo', () => {
    const doc = populated();
    const before = doc.model.snapshot();
    doc.history.execute(new ReorderWinSequenceStepCommand('base', [2, 1, 0]));
    expect(doc.model.slotScene().winSequencer.sequences['base']?.steps).toEqual([
      rollupStep,
      vfxStep,
      animateStep,
    ]);
    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('rejects a non-permutation order with stepIndexOutOfRange', () => {
    const doc = populated();
    const before = doc.model.snapshot();
    expect(() => doc.history.execute(new ReorderWinSequenceStepCommand('base', [0, 0, 1]))).toThrow(
      expect.objectContaining({ reason: 'stepIndexOutOfRange' }),
    );
    expect(() => doc.history.execute(new ReorderWinSequenceStepCommand('base', [0, 1]))).toThrow(
      expect.objectContaining({ reason: 'stepIndexOutOfRange' }),
    );
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('rejects an unknown sequence with sequenceMissing', () => {
    const doc = populated();
    expect(() => doc.history.execute(new ReorderWinSequenceStepCommand('ghost', [0]))).toThrow(
      expect.objectContaining({ reason: 'sequenceMissing' }),
    );
  });

  it('coalesces successive reorders of the same sequence (Session) into one undo step', () => {
    const doc = populated();
    // Baseline AFTER the three setup edits (each its own undo step); the reorder session must collapse to
    // exactly ONE additional undo step that restores this baseline.
    const afterSetup = doc.model.snapshot();
    doc.history.beginInteraction();
    doc.history.execute(new ReorderWinSequenceStepCommand('base', [1, 0, 2]));
    doc.history.execute(new ReorderWinSequenceStepCommand('base', [2, 1, 0]));
    const event = doc.history.endInteraction('Reorder Win Sequence Steps');
    expect(event?.kind).toBe('slot.winseq.reorder'); // single command, not a composite
    // Both reorders' do already ran in sequence: [A,V,R] -> [V,A,R] -> [R,A,V].
    expect(doc.model.slotScene().winSequencer.sequences['base']?.steps).toEqual([
      rollupStep,
      animateStep,
      vfxStep,
    ]);
    // One undo restores the pre-session order (the merged reorder is ONE step).
    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(afterSetup);
  });
});

describe('SetEscalationThreshold (slot.winseq.threshold)', () => {
  it('sets the thresholds and restores them on undo', () => {
    const doc = newSceneDoc();
    const before = doc.model.snapshot();
    expect(doc.model.slotScene().winSequencer.thresholds).toEqual({ big: 0, mega: 0, epic: 0 });
    doc.history.execute(new SetEscalationThresholdCommand({ big: 10, mega: 25, epic: 100 }));
    expect(doc.model.slotScene().winSequencer.thresholds).toEqual({ big: 10, mega: 25, epic: 100 });
    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
    expect(doc.model.slotScene().winSequencer.thresholds).toEqual({ big: 0, mega: 0, epic: 0 });
  });

  it('rejects a negative threshold with a typed error and no mutation', () => {
    const doc = newSceneDoc();
    const before = doc.model.snapshot();
    expect(() =>
      doc.history.execute(new SetEscalationThresholdCommand({ big: -1, mega: 25, epic: 100 })),
    ).toThrow(SlotEditError);
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('window-merges discrete threshold edits within 250ms and not beyond it', () => {
    const within = makeTestEnv();
    const a = createDocument(newDocState('a'), within.env);
    within.setNow(0);
    a.history.execute(new SetEscalationThresholdCommand({ big: 5, mega: 10, epic: 20 }));
    within.setNow(100);
    a.history.execute(new SetEscalationThresholdCommand({ big: 8, mega: 16, epic: 32 }));
    expect(countUndoSteps(a)).toBe(1);

    const beyond = makeTestEnv();
    const b = createDocument(newDocState('b'), beyond.env);
    beyond.setNow(0);
    b.history.execute(new SetEscalationThresholdCommand({ big: 5, mega: 10, epic: 20 }));
    beyond.setNow(300);
    b.history.execute(new SetEscalationThresholdCommand({ big: 8, mega: 16, epic: 32 }));
    expect(countUndoSteps(b)).toBe(2);
  });
});
