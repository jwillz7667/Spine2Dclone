import { describe, expect, it } from 'vitest';
import { symbolId } from '@marionette/format/slot';
import type { GridConfig, SymbolAnimSet } from '@marionette/format/slot-types';
import { MapSymbolAnimSetCommand } from '../src/commands/map-symbol-anim-set.command';
import { SetGridConfigCommand } from '../src/commands/set-grid-config.command';
import {
  assertInvariants,
  createDocument,
  exportDocument,
  loadDocument,
  newDocState,
  SlotEditError,
  type Document,
} from '../src';
import { makeTestEnv, seeds } from './seeds';

// A fresh document carrying the always-present DEFAULT slot scene (a 5x3 reelStrip grid, no symbols).
function newSceneDoc(): Document {
  return createDocument(newDocState('scene'), makeTestEnv().env);
}

// Count how many undo steps the history holds (drains the stack).
function countUndoSteps(doc: Document): number {
  let steps = 0;
  while (doc.history.canUndo) {
    doc.history.undo();
    steps += 1;
  }
  return steps;
}

// A valid 6x5 scatterPay grid (distinct from the default 5x3 reelStrip).
function scatterPayGrid(): GridConfig {
  return {
    topology: 'scatterPay',
    cols: 6,
    rows: 5,
    cellWidth: 1,
    cellHeight: 1,
    cellGap: 0,
    reelStopStaggerMs: 0,
    gravity: 'column-down',
    anticipation: {
      triggerSymbols: [symbolId('scatter')],
      thresholdCount: 1,
      maxAnticipatingCols: 6,
    },
  };
}

const heroAnimSet: SymbolAnimSet = { skeletonRef: 'hero', idle: 'idle', land: 'land', win: 'win' };

describe('SetGridConfig (WP-4.5)', () => {
  it('default document carries a valid 5x3 reelStrip grid', () => {
    const doc = newSceneDoc();
    const grid = doc.model.slotGrid();
    expect(grid.topology).toBe('reelStrip');
    expect(grid.cols).toBe(5);
    expect(grid.rows).toBe(3);
    expect(() => assertInvariants(doc.model)).not.toThrow();
  });

  it('replaces the grid and round-trips on undo (bit-exact)', () => {
    const doc = newSceneDoc();
    const before = doc.model.snapshot();
    doc.history.execute(new SetGridConfigCommand(scatterPayGrid()));
    expect(doc.model.slotGrid().topology).toBe('scatterPay');
    expect(() => assertInvariants(doc.model)).not.toThrow();
    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('preset constructors build the three canonical layouts', () => {
    const doc = newSceneDoc();
    doc.history.execute(SetGridConfigCommand.scatterPay6x5());
    expect(doc.model.slotGrid()).toMatchObject({ topology: 'scatterPay', cols: 6, rows: 5 });
    doc.history.execute(SetGridConfigCommand.cluster7x7());
    expect(doc.model.slotGrid()).toMatchObject({
      topology: 'cluster',
      cols: 7,
      rows: 7,
      gravity: 'cluster-down',
    });
    doc.history.execute(SetGridConfigCommand.reelStrip5x3());
    expect(doc.model.slotGrid()).toMatchObject({ topology: 'reelStrip', cols: 5, rows: 3 });
  });

  // Each invalid grid is rejected BEFORE any mutation: a typed SlotEditError with the right reason, the
  // grid unchanged, and no history entry.
  it.each([
    [
      'clusterNotSquare',
      { ...scatterPayGrid(), topology: 'cluster', cols: 6, rows: 5, gravity: 'cluster-down' },
    ],
    [
      'clusterGravity',
      { ...scatterPayGrid(), topology: 'cluster', cols: 6, rows: 6, gravity: 'column-down' },
    ],
    ['reelStripRows', { ...scatterPayGrid(), topology: 'reelStrip', cols: 5, rows: 7 }],
    ['scatterPayCols', { ...scatterPayGrid(), topology: 'scatterPay', cols: 4, rows: 5 }],
    [
      'anticipationTriggers',
      {
        ...scatterPayGrid(),
        anticipation: { triggerSymbols: [], thresholdCount: 1, maxAnticipatingCols: 1 },
      },
    ],
    [
      'anticipationThreshold',
      {
        ...scatterPayGrid(),
        anticipation: {
          triggerSymbols: [symbolId('s')],
          thresholdCount: 0,
          maxAnticipatingCols: 1,
        },
      },
    ],
    [
      'anticipationCols',
      {
        ...scatterPayGrid(),
        anticipation: {
          triggerSymbols: [symbolId('s')],
          thresholdCount: 1,
          maxAnticipatingCols: 99,
        },
      },
    ],
  ] as const)('rejects an invalid grid (%s) with no mutation', (reason, grid) => {
    const doc = newSceneDoc();
    const before = doc.model.snapshot();
    expect(() => doc.history.execute(new SetGridConfigCommand(grid as GridConfig))).toThrow(
      SlotEditError,
    );
    expect(() => doc.history.execute(new SetGridConfigCommand(grid as GridConfig))).toThrow(
      expect.objectContaining({ reason }),
    );
    expect(doc.model.snapshot()).toEqual(before);
    expect(doc.history.canUndo).toBe(false);
  });

  // Coalescing on the Session window: a sequence of grid-metric edits within one interaction collapses to
  // ONE undo step that restores the pre-session grid (the original before-memento, not an intermediate).
  it('coalesces a grid-metric drag into one undo step keeping the original before', () => {
    const doc = newSceneDoc();
    const before = doc.model.snapshot();
    doc.history.beginInteraction();
    for (let cols = 5; cols <= 7; cols += 1) {
      doc.history.execute(
        new SetGridConfigCommand({
          ...scatterPayGrid(),
          cols,
          anticipation: {
            triggerSymbols: [symbolId('scatter')],
            thresholdCount: 1,
            maxAnticipatingCols: cols,
          },
        }),
      );
    }
    const event = doc.history.endInteraction('Set Grid Config');
    expect(event?.kind).toBe('slot.grid.set'); // single command, not a composite
    expect(doc.model.slotGrid().cols).toBe(7); // final metric applied
    expect(countUndoSteps(doc)).toBe(1);
    expect(doc.model.snapshot()).toEqual(before); // one undo restores the pre-session grid
  });

  // Window-merge (discrete, gestureless): two same-kind edits inside the 250ms window collapse; beyond it
  // they split into two steps.
  it('window-merges discrete grid edits within the window and not beyond it', () => {
    const within = makeTestEnv();
    const a = createDocument(newDocState('a'), within.env);
    within.setNow(0);
    a.history.execute(
      new SetGridConfigCommand({
        ...scatterPayGrid(),
        cols: 5,
        anticipation: {
          triggerSymbols: [symbolId('s')],
          thresholdCount: 1,
          maxAnticipatingCols: 5,
        },
      }),
    );
    within.setNow(100);
    a.history.execute(
      new SetGridConfigCommand({
        ...scatterPayGrid(),
        cols: 6,
        anticipation: {
          triggerSymbols: [symbolId('s')],
          thresholdCount: 1,
          maxAnticipatingCols: 6,
        },
      }),
    );
    expect(countUndoSteps(a)).toBe(1);

    const beyond = makeTestEnv();
    const b = createDocument(newDocState('b'), beyond.env);
    beyond.setNow(0);
    b.history.execute(
      new SetGridConfigCommand({
        ...scatterPayGrid(),
        cols: 5,
        anticipation: {
          triggerSymbols: [symbolId('s')],
          thresholdCount: 1,
          maxAnticipatingCols: 5,
        },
      }),
    );
    beyond.setNow(300);
    b.history.execute(
      new SetGridConfigCommand({
        ...scatterPayGrid(),
        cols: 6,
        anticipation: {
          triggerSymbols: [symbolId('s')],
          thresholdCount: 1,
          maxAnticipatingCols: 6,
        },
      }),
    );
    expect(countUndoSteps(b)).toBe(2);
  });
});

describe('MapSymbolAnimSet (WP-4.6)', () => {
  it('maps a symbol and adds its skeletonRef to refs.skeletons, round-trips on undo', () => {
    const doc = newSceneDoc();
    const before = doc.model.snapshot();
    doc.history.execute(new MapSymbolAnimSetCommand(symbolId('A'), { animSet: heroAnimSet }));
    const scene = doc.model.slotScene();
    expect(scene.symbols[symbolId('A')]).toMatchObject({ skeletonRef: 'hero', idle: 'idle' });
    expect(scene.refs.skeletons.map((r) => r.name)).toContain('hero');
    expect(() => assertInvariants(doc.model)).not.toThrow();
    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('shares a skeletonRef across two symbols and adds only one refs entry', () => {
    const doc = newSceneDoc();
    doc.history.execute(new MapSymbolAnimSetCommand(symbolId('A'), { animSet: heroAnimSet }));
    doc.history.execute(new MapSymbolAnimSetCommand(symbolId('B'), { animSet: heroAnimSet }));
    const refs = doc.model.slotScene().refs;
    expect(refs.skeletons.filter((r) => r.name === 'hero')).toHaveLength(1);
  });

  it('prunes the skeletonRef when the LAST symbol referencing it is removed', () => {
    const doc = newSceneDoc();
    doc.history.execute(new MapSymbolAnimSetCommand(symbolId('A'), { animSet: heroAnimSet }));
    doc.history.execute(new MapSymbolAnimSetCommand(symbolId('B'), { animSet: heroAnimSet }));
    // Removing A keeps 'hero' (B still references it).
    doc.history.execute(new MapSymbolAnimSetCommand(symbolId('A'), { animSet: null }));
    expect(doc.model.slotScene().refs.skeletons.map((r) => r.name)).toContain('hero');
    // Removing B prunes 'hero' (no symbol references it anymore).
    doc.history.execute(new MapSymbolAnimSetCommand(symbolId('B'), { animSet: null }));
    expect(doc.model.slotScene().refs.skeletons.map((r) => r.name)).not.toContain('hero');
    expect(() => assertInvariants(doc.model)).not.toThrow();
  });

  it('undo of a removal restores both the symbol and the pruned refs entry', () => {
    const doc = newSceneDoc();
    doc.history.execute(new MapSymbolAnimSetCommand(symbolId('A'), { animSet: heroAnimSet }));
    const beforeRemove = doc.model.snapshot();
    doc.history.execute(new MapSymbolAnimSetCommand(symbolId('A'), { animSet: null }));
    expect(doc.model.slotScene().refs.skeletons).toHaveLength(0);
    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(beforeRemove); // symbol and refs both restored deep-equal
  });

  it('validates animation names against the injected skeleton animation list', () => {
    const doc = newSceneDoc();
    const before = doc.model.snapshot();
    expect(() =>
      doc.history.execute(
        new MapSymbolAnimSetCommand(symbolId('A'), {
          animSet: { skeletonRef: 'hero', idle: 'idle', land: 'land', win: 'ghost' },
          skeletonAnimationNames: ['idle', 'land'], // 'ghost' (and 'win') missing
        }),
      ),
    ).toThrow(expect.objectContaining({ reason: 'animMissing' }));
    expect(doc.model.snapshot()).toEqual(before); // nothing mutated

    // The same mapping with all names present succeeds.
    doc.history.execute(
      new MapSymbolAnimSetCommand(symbolId('A'), {
        animSet: heroAnimSet,
        skeletonAnimationNames: ['idle', 'land', 'win'],
      }),
    );
    expect(doc.model.slotScene().symbols[symbolId('A')]).toBeDefined();
  });

  it('rejects an empty animation name structurally even without an injected list', () => {
    const doc = newSceneDoc();
    expect(() =>
      doc.history.execute(
        new MapSymbolAnimSetCommand(symbolId('A'), {
          animSet: { skeletonRef: 'hero', idle: '', land: 'land', win: 'win' },
        }),
      ),
    ).toThrow(expect.objectContaining({ reason: 'emptyName' }));
  });

  it('rejects removing a symbol that is not mapped', () => {
    const doc = newSceneDoc();
    expect(() =>
      doc.history.execute(new MapSymbolAnimSetCommand(symbolId('nope'), { animSet: null })),
    ).toThrow(expect.objectContaining({ reason: 'notMapped' }));
  });
});

describe('slot scene save/load + invariants', () => {
  // The skeletal SkeletonDocument carries no slot scene, so a skeleton-only load seeds the DEFAULT scene.
  it('a skeleton-only load seeds the default slot scene', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.minimal, env);
    expect(doc.model.slotGrid().topology).toBe('reelStrip');
    expect(doc.model.slotScene().symbols).toEqual({});
    expect(() => assertInvariants(doc.model)).not.toThrow();
  });

  // The in-model slot scene snapshots and rebuilds cleanly: a built-then-edited scene, exported as a
  // skeleton and reloaded, comes back to the DEFAULT scene (the skeleton envelope carries no scene), and
  // the SAME edits replay to the SAME snapshot, proving the in-model scene round-trips through History.
  it('the in-model slot scene snapshots and rebuilds deterministically', () => {
    const { env } = makeTestEnv();
    // Start from a seed (it has a bone, so the skeleton export validates) and edit its in-model scene.
    const doc = loadDocument(seeds.minimal, env);
    doc.history.execute(SetGridConfigCommand.cluster7x7());
    doc.history.execute(new MapSymbolAnimSetCommand(symbolId('A'), { animSet: heroAnimSet }));
    const authored = doc.model.snapshot();

    // Export the skeleton and reload (skeleton envelope has no scene -> default), then replay the edits.
    const exported = exportDocument(doc.model);
    const reloaded = loadDocument(exported, makeTestEnv().env);
    expect(reloaded.model.slotGrid().topology).toBe('reelStrip'); // default after a skeleton-only load
    reloaded.history.execute(SetGridConfigCommand.cluster7x7());
    reloaded.history.execute(new MapSymbolAnimSetCommand(symbolId('A'), { animSet: heroAnimSet }));
    expect(reloaded.model.snapshot().slotScene).toEqual(authored.slotScene);
  });
});
