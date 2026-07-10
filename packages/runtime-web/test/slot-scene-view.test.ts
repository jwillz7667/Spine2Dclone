import { describe, expect, it } from 'vitest';
import { rollupValueAt } from '@marionette/runtime-core';
import type {
  GridConfig,
  PresentationDirective,
  PresentationTimeline,
  SymbolAnimSet,
} from '@marionette/runtime-core';
import { symbolId } from '@marionette/format/slot';
import type { Animation, SkeletonDocument } from '@marionette/format/types';
import {
  SlotSceneView,
  applyDirective,
  cellCenter,
  cellIndex,
  gridMetrics,
  gridSize,
  makeSlotSceneState,
  resetSlotSceneState,
  type ResolvedSymbol,
} from '../src';
import { bone, makeDocument, region, slot } from './rig';

// PP-C4 GL slot renderer. The pure grid layout and board reducer are exercised directly; the SlotSceneView
// board dispatch, symbol mounting, rollup / vfx callbacks, and win highlight are exercised headlessly.

const A = symbolId('A');
const B = symbolId('B');
const C = symbolId('C');

function grid2x2(): GridConfig {
  return {
    topology: 'reelStrip',
    cols: 2,
    rows: 2,
    cellWidth: 100,
    cellHeight: 100,
    cellGap: 10,
    reelStopStaggerMs: 0,
    gravity: 'column-down',
    anticipation: { triggerSymbols: [], thresholdCount: 1, maxAnticipatingCols: 1 },
  };
}

function emptyAnim(): Animation {
  return {
    duration: 1,
    bones: {},
    slots: {},
    ik: {},
    transform: {},
    deform: {},
    drawOrder: [],
    events: [],
  } as unknown as Animation;
}

// A minimal symbol skeleton with the idle / land / win animations a SymbolAnimSet names.
function symbolDoc(): SkeletonDocument {
  return makeDocument({
    bones: [bone('root', null)],
    slots: [slot('body', 'root', 'body')],
    skin: { body: { body: region('sym') } },
    animations: { idle: emptyAnim(), land: emptyAnim(), win: emptyAnim() },
  });
}

const ANIM_SET: SymbolAnimSet = { skeletonRef: 'sym', idle: 'idle', land: 'land', win: 'win' };

function symbolResolver(): (s: unknown) => ResolvedSymbol {
  const document = symbolDoc();
  return () => ({ document, animSet: ANIM_SET });
}

// A spin timeline (already sorted by (atMs, seq), as the sequencer emits): fill a 2x2 board at t=0, then at
// t=100 animate (0,0) to win, burst a vfx at that cell, and start a counter rollup.
function spinTimeline(): PresentationTimeline {
  const directives: PresentationDirective[] = [
    { kind: 'reelStop', col: 0, atMs: 0, seq: 0 },
    { kind: 'reelStop', col: 1, atMs: 0, seq: 1 },
    { kind: 'symbolLand', row: 0, col: 0, symbol: A, atMs: 0, seq: 2 },
    { kind: 'symbolLand', row: 0, col: 1, symbol: B, atMs: 0, seq: 3 },
    { kind: 'symbolLand', row: 1, col: 0, symbol: A, atMs: 0, seq: 4 },
    { kind: 'symbolLand', row: 1, col: 1, symbol: C, atMs: 0, seq: 5 },
    { kind: 'symbolAnimate', row: 0, col: 0, set: 'win', atMs: 100, seq: 6 },
    {
      kind: 'vfxBurst',
      preset: 'coin',
      anchor: { kind: 'cell', row: 0, col: 0 },
      atMs: 100,
      seq: 7,
    },
    {
      kind: 'counterRollup',
      fromUnits: 0,
      toUnits: 500,
      startMs: 100,
      endMs: 600,
      curve: 'linear',
      atMs: 100,
      seq: 8,
    },
  ];
  return { spinId: 'spin-1', durationMs: 600, directives };
}

describe('PP-C4 grid-layout (pure)', () => {
  it('centers cells at half-cell plus stride offsets', () => {
    const m = gridMetrics(grid2x2());
    expect(cellCenter(m, 0, 0)).toEqual({ x: 50, y: 50 });
    expect(cellCenter(m, 0, 1)).toEqual({ x: 160, y: 50 }); // col stride 110
    expect(cellCenter(m, 1, 1)).toEqual({ x: 160, y: 160 });
  });

  it('sizes the grid as cells plus interior gaps', () => {
    expect(gridSize(gridMetrics(grid2x2()))).toEqual({ width: 210, height: 210 });
  });
});

describe('PP-C4 slot-scene-state reducer (pure)', () => {
  it('folds landings, reel stops, and animation phases into the board', () => {
    const state = makeSlotSceneState(2, 2);
    applyDirective(state, { kind: 'symbolLand', row: 1, col: 0, symbol: A, atMs: 0, seq: 0 });
    expect(state.symbols[cellIndex(state, 1, 0)]).toBe(A);
    expect(state.phases[cellIndex(state, 1, 0)]).toBe('land');

    applyDirective(state, { kind: 'reelStop', col: 0, atMs: 0, seq: 1 });
    expect(state.reelStopped[0]).toBe(true);

    applyDirective(state, { kind: 'symbolAnimate', row: 1, col: 0, set: 'win', atMs: 0, seq: 2 });
    expect(state.phases[cellIndex(state, 1, 0)]).toBe('win');
  });

  it('applies a cascade explode / drop / refill to the resulting board', () => {
    const state = makeSlotSceneState(2, 1); // one column, two rows
    applyDirective(state, { kind: 'symbolLand', row: 0, col: 0, symbol: A, atMs: 0, seq: 0 });
    applyDirective(state, { kind: 'symbolLand', row: 1, col: 0, symbol: B, atMs: 0, seq: 1 });

    // Explode the bottom cell, drop the survivor A from row 0 to row 1, refill row 0 with C.
    applyDirective(state, {
      kind: 'cascadeExplode',
      cells: [{ row: 1, col: 0 }],
      atMs: 10,
      seq: 2,
    });
    applyDirective(state, {
      kind: 'cascadeDrop',
      moves: [{ from: { row: 0, col: 0 }, to: { row: 1, col: 0 }, symbol: A }],
      atMs: 20,
      seq: 3,
    });
    applyDirective(state, { kind: 'cascadeRefill', col: 0, symbols: [C], atMs: 30, seq: 4 });

    expect(state.symbols[cellIndex(state, 0, 0)]).toBe(C); // refill on top
    expect(state.symbols[cellIndex(state, 1, 0)]).toBe(A); // survivor fell to the bottom
  });

  it('resets the board in place', () => {
    const state = makeSlotSceneState(2, 2);
    applyDirective(state, { kind: 'symbolLand', row: 0, col: 0, symbol: A, atMs: 0, seq: 0 });
    resetSlotSceneState(state);
    expect(state.symbols.every((s) => s === null)).toBe(true);
    expect(state.reelStopped.every((r) => !r)).toBe(true);
    expect(state.activeRollup).toBeNull();
  });
});

describe('PP-C4 SlotSceneView', () => {
  it('fills the board and mounts a symbol skeleton per landed cell', () => {
    const view = new SlotSceneView(grid2x2(), { symbolResolver: symbolResolver() });
    view.setTimeline(spinTimeline());
    view.update(0);

    const scene = view.describe();
    expect(scene.symbols).toEqual([
      [A, B],
      [A, C],
    ]);
    expect(scene.reelStopped).toEqual([true, true]);
    expect(scene.mountedCells).toHaveLength(4); // every landed cell mounts a SkeletonView
  });

  it('drives the counter rollup and vfx burst callbacks with pinned values and cell pixels', () => {
    const rollups: number[] = [];
    const bursts: Array<{ preset: string; x: number; y: number; atMs: number }> = [];
    const view = new SlotSceneView(grid2x2(), {
      symbolResolver: symbolResolver(),
      callbacks: {
        onRollup: (value) => rollups.push(value),
        onVfxBurst: (preset, x, y, atMs) => bursts.push({ preset, x, y, atMs }),
      },
    });
    view.setTimeline(spinTimeline());

    view.update(0);
    view.update(600); // past the win / vfx / rollup directives at t = 100

    // The vfx burst fired once, anchored to cell (0,0)'s center in grid pixels.
    expect(bursts).toEqual([{ preset: 'coin', x: 50, y: 50, atMs: 100 }]);
    // The rollup display value is the pinned rollupValueAt (0->500 over [100,600], linear) = 500 at 600ms.
    expect(rollups.at(-1)).toBe(rollupValueAt(0, 500, 100, 600, 600, 'linear'));
    expect(rollups.at(-1)).toBe(500);

    const scene = view.describe();
    expect(scene.phases[0]![0]).toBe('win'); // (0,0) animated to win
    expect(scene.highlightedCells).toEqual([[0, 0]]);
  });

  it('replays from the start on a backward seek', () => {
    const view = new SlotSceneView(grid2x2(), { symbolResolver: symbolResolver() });
    view.setTimeline(spinTimeline());
    view.update(600);
    expect(view.describe().phases[0]![0]).toBe('win');

    view.update(0); // backward seek: reset + re-advance to 0, win has not fired yet
    const scene = view.describe();
    expect(scene.phases[0]![0]).toBe('land');
    expect(scene.highlightedCells).toHaveLength(0);
  });

  it('does nothing without a timeline', () => {
    const view = new SlotSceneView(grid2x2(), { symbolResolver: symbolResolver() });
    expect(() => view.update(100)).not.toThrow();
    expect(view.describe().mountedCells).toHaveLength(0);
  });
});
