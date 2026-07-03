import { describe, expect, it } from 'vitest';
import { symbolId } from '@marionette/format/slot';
import type { SymbolAnimSet } from '@marionette/format/slot-types';
import {
  CreateWinSequenceCommand,
  MapSymbolAnimSetCommand,
  SetGridConfigCommand,
  SetTumbleChoreographyCommand,
  createDocument,
  makeIdFactory,
  newDocState,
  type Document,
  type DocumentEnvironment,
} from '../document';

// The Slot panel drives the slot-scene commands on the SAME live History as the skeleton (the slotScene is
// part of the main DocumentModel). These tests prove the wiring the panel relies on at the LOGIC level:
// each command the panel dispatches actually changes the model, and a single undo reverses it (LAW 2, the
// do/undo round-trip). The panel is glue over exactly these calls, so a green suite here means the panel's
// buttons/handlers mutate through the correct command surface. A deterministic id factory + a fixed clock
// keep the history reproducible (no Electron, no DOM: pure document-core through the editor barrel).
function newSlotDoc(): Document {
  const env: DocumentEnvironment = { now: () => 0, createIds: makeIdFactory };
  return createDocument(newDocState('slot-panel-test'), env);
}

describe('SlotPanel grid wiring', () => {
  it('a fresh document carries the default 5x3 reelStrip grid', () => {
    const doc = newSlotDoc();
    const grid = doc.model.slotGrid();
    expect(grid.topology).toBe('reelStrip');
    expect(grid.cols).toBe(5);
    expect(grid.rows).toBe(3);
  });

  it('the scatterPay preset swaps the grid and undo restores the reelStrip default', () => {
    const doc = newSlotDoc();
    const before = doc.model.snapshot();

    doc.history.execute(SetGridConfigCommand.scatterPay6x5());

    const after = doc.model.slotGrid();
    expect(after.topology).toBe('scatterPay');
    expect(after.cols).toBe(6);
    expect(after.rows).toBe(5);
    // The grid genuinely changed (a real delta, not a no-op).
    expect(doc.model.snapshot()).not.toEqual(before);

    doc.history.undo();
    expect(doc.model.slotGrid().topology).toBe('reelStrip');
    expect(doc.model.slotGrid().cols).toBe(5);
    // One undo returns to the exact pre-command state (bit-exact round-trip).
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('the cluster preset applies a square cluster grid and undo reverses it', () => {
    const doc = newSlotDoc();
    doc.history.execute(SetGridConfigCommand.cluster7x7());
    const grid = doc.model.slotGrid();
    expect(grid.topology).toBe('cluster');
    expect(grid.cols).toBe(7);
    expect(grid.rows).toBe(7);
    doc.history.undo();
    expect(doc.model.slotGrid().topology).toBe('reelStrip');
  });
});

describe('SlotPanel symbol-map wiring', () => {
  const heroAnimSet: SymbolAnimSet = {
    skeletonRef: 'hero',
    idle: 'idle',
    land: 'land',
    win: 'win',
  };

  it('maps a symbol to its anim set and getSymbolAnimSet reflects it', () => {
    const doc = newSlotDoc();
    const id = symbolId('sym_wild');
    expect(doc.model.getSymbolAnimSet(id)).toBeUndefined();

    doc.history.execute(new MapSymbolAnimSetCommand(id, { animSet: heroAnimSet }));

    const mapped = doc.model.getSymbolAnimSet(id);
    expect(mapped).toBeDefined();
    expect(mapped?.skeletonRef).toBe('hero');
    expect(mapped?.idle).toBe('idle');
    // The mapping also registered the skeleton ref (single-undo bookkeeping the panel relies on).
    expect(doc.model.slotScene().refs.skeletons.some((ref) => ref.name === 'hero')).toBe(true);
  });

  it('undo removes a freshly mapped symbol and its skeleton ref in one step', () => {
    const doc = newSlotDoc();
    const id = symbolId('sym_wild');
    const before = doc.model.snapshot();

    doc.history.execute(new MapSymbolAnimSetCommand(id, { animSet: heroAnimSet }));
    expect(doc.model.getSymbolAnimSet(id)).toBeDefined();

    doc.history.undo();
    expect(doc.model.getSymbolAnimSet(id)).toBeUndefined();
    expect(doc.model.slotScene().refs.skeletons).toHaveLength(0);
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('removing a mapping via a null anim set clears it and undo restores it', () => {
    const doc = newSlotDoc();
    const id = symbolId('sym_wild');
    doc.history.execute(new MapSymbolAnimSetCommand(id, { animSet: heroAnimSet }));
    const afterMap = doc.model.snapshot();

    doc.history.execute(new MapSymbolAnimSetCommand(id, { animSet: null }));
    expect(doc.model.getSymbolAnimSet(id)).toBeUndefined();

    doc.history.undo();
    expect(doc.model.getSymbolAnimSet(id)).toBeDefined();
    expect(doc.model.snapshot()).toEqual(afterMap);
  });
});

describe('SlotPanel summary-affordance wiring', () => {
  it('creates a named win sequence and undo removes it', () => {
    const doc = newSlotDoc();
    const before = doc.model.snapshot();
    expect(Object.keys(doc.model.slotScene().winSequencer.sequences)).toEqual(['base']);

    doc.history.execute(new CreateWinSequenceCommand('bonus'));
    expect('bonus' in doc.model.slotScene().winSequencer.sequences).toBe(true);

    doc.history.undo();
    expect('bonus' in doc.model.slotScene().winSequencer.sequences).toBe(false);
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('toggles the tumble drop easing and undo restores the prior easing', () => {
    const doc = newSlotDoc();
    const before = doc.model.slotScene().tumble;
    expect(before.dropEasing).toBe('linear');

    doc.history.execute(new SetTumbleChoreographyCommand({ ...before, dropEasing: 'easeOutQuad' }));
    expect(doc.model.slotScene().tumble.dropEasing).toBe('easeOutQuad');

    doc.history.undo();
    expect(doc.model.slotScene().tumble.dropEasing).toBe('linear');
  });
});
