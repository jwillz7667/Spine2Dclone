import { describe, expect, it } from 'vitest';
import { symbolId } from '@marionette/format/slot';
import type {
  SymbolId,
  SlotScene,
  GridConfig,
  TumbleChoreography,
} from '@marionette/format/slot-types';
import { MOCK_SCENARIOS } from '@marionette/math-bridge';
import type { SpinResult } from '@marionette/math-bridge/types';
import { sequence, compareDirectives } from '../src/slot/sequence';
import { solveCascadeStep } from '../src/slot/drop-solver';
import type { PresentationDirective, SymbolMove, GridCell } from '../src/slot/timeline';

// WP-4.10 cascade / tumble stage (phase-4 section 5.4.1 construction-order STAGE 5, section 5.4.3 CASCADE-WIN
// model, section 5.5.1 column-down gravity). The cascade stage only runs for a cascade spin (result.cascades
// non-empty); it starts from initialGrid, emits one explode/win/drop/refill cycle per step, and forms the
// contiguous per-step counterRollup chain. LAW 1: it reads engine cascade VALUE TYPES only and decides
// nothing; presentation reads cumulativeWin, never sums stepWin.

const S = symbolId;

// An authored TumbleChoreography with distinct non-zero timings so the atMs accumulation is observable.
function tumble(): TumbleChoreography {
  return {
    explodeMs: 100,
    dropMs: 200,
    dropEasing: 'easeOutQuad',
    refillStaggerMs: 30,
    settleMs: 50,
    stepGapMs: 70,
    rollupCurve: 'easeInOutCubic',
  };
}

// A scene matching the tumble-cascade mock board (6 cols x 5 rows scatterPay), with an inert win sequencer
// (no rollupStart step, so the WP-4.8 single rollup is structurally absent too) and a single-base flow.
function cascadeScene(t: TumbleChoreography = tumble()): SlotScene {
  const grid: GridConfig = {
    topology: 'scatterPay',
    cols: 6,
    rows: 5,
    cellWidth: 100,
    cellHeight: 100,
    cellGap: 0,
    reelStopStaggerMs: 0,
    gravity: 'column-down',
    anticipation: { triggerSymbols: [S('scatter')], thresholdCount: 99, maxAnticipatingCols: 1 },
  };
  return {
    grid,
    symbols: {},
    winSequencer: {
      sequences: { base: { steps: [] } },
      thresholds: { big: 100000, mega: 500000, epic: 1000000 },
      defaultSequence: 'base',
    },
    featureFlows: { states: { base: {} }, transitions: [], entry: 'base' },
    tumble: t,
  };
}

const tumbleResult = (): SpinResult => MOCK_SCENARIOS['tumble-cascade'].result;

// Forward-apply the cascade directives (cascadeDrop moves + cascadeRefill) to initialGrid to reconstruct the
// rendered board, exactly the way the renderer would. This is the DIRECTIVE-implied board: apply each step's
// drop moves (survivor slides) then place each refill column top-down, in directive order. The result must
// equal SpinResult.grid (the structural fact the math-bridge validator already enforces on receipt).
function applyDirectivesForward(
  initialGrid: readonly (readonly SymbolId[])[],
  directives: readonly PresentationDirective[],
  rows: number,
  cols: number,
): SymbolId[][] {
  // Mutable working board (copy).
  let cur: (SymbolId | undefined)[][] = initialGrid.map((r) => r.slice());
  for (const d of directives) {
    if (d.kind === 'cascadeDrop') {
      // First clear every survivor source cell, then place each at its destination (a step's moves are
      // disjoint in destinations; clearing sources first avoids clobbering a cell another move targets).
      const next: (SymbolId | undefined)[][] = cur.map((r) => r.slice());
      for (const m of d.moves) next[m.from.row]![m.from.col] = undefined;
      for (const m of d.moves) next[m.to.row]![m.to.col] = m.symbol;
      cur = next;
    } else if (d.kind === 'cascadeRefill') {
      // Refills enter the TOP empty cells of the column, top-down in symbols order.
      const col = d.col;
      let writeRow = 0;
      for (const sym of d.symbols) {
        // Advance to the next empty (undefined) cell from the top.
        while (writeRow < rows && cur[writeRow]![col] !== undefined) writeRow += 1;
        cur[writeRow]![col] = sym;
        writeRow += 1;
      }
    }
  }
  // Every cell must now be defined.
  const out: SymbolId[][] = [];
  for (let r = 0; r < rows; r += 1) {
    const row: SymbolId[] = [];
    for (let c = 0; c < cols; c += 1) {
      const v = cur[r]![c];
      if (v === undefined) throw new Error(`forward board cell [${r},${c}] is empty`);
      row.push(v);
    }
    out.push(row);
  }
  return out;
}

describe('cascade stage (WP-4.10 TASK-4.10.3)', () => {
  it('emits exactly cascades.length explode/drop/refill cycles in order, starting from initialGrid', () => {
    const result = tumbleResult();
    const tl = sequence(result, cascadeScene());
    const explodes = tl.directives.filter((d) => d.kind === 'cascadeExplode');
    const drops = tl.directives.filter((d) => d.kind === 'cascadeDrop');
    const n = result.cascades!.length;
    expect(n).toBeGreaterThanOrEqual(3); // the mock scenario has >= 3 cascades
    expect(explodes).toHaveLength(n);
    expect(drops).toHaveLength(n);
    // Each step has at least one refilled column in this scenario; total refills >= n.
    const refills = tl.directives.filter((d) => d.kind === 'cascadeRefill');
    expect(refills.length).toBeGreaterThanOrEqual(n);
  });

  it('the per-step counterRollup chain is contiguous (each fromUnits === the previous toUnits, first is 0) and terminal toUnits === totalWin', () => {
    const result = tumbleResult();
    const tl = sequence(result, cascadeScene());
    const links = tl.directives.filter(
      (d): d is Extract<PresentationDirective, { kind: 'counterRollup' }> =>
        d.kind === 'counterRollup',
    );
    expect(links).toHaveLength(result.cascades!.length);
    let prev = 0;
    for (let k = 0; k < links.length; k += 1) {
      expect(links[k]!.fromUnits).toBe(prev); // contiguous: starts where the previous ended
      expect(links[k]!.toUnits).toBe(result.cascades![k]!.cumulativeWin); // reads cumulativeWin
      prev = links[k]!.toUnits;
    }
    expect(prev).toBe(result.totalWin); // terminal equals the engine's authoritative totalWin
  });

  it('reads cumulativeWin verbatim (never sums stepWin)', () => {
    const result = tumbleResult();
    const tl = sequence(result, cascadeScene());
    const toUnits = tl.directives
      .filter((d) => d.kind === 'counterRollup')
      .map((d) => (d.kind === 'counterRollup' ? d.toUnits : -1));
    expect(toUnits).toEqual(result.cascades!.map((s) => s.cumulativeWin));
  });

  it('the directive-implied forward board equals result.grid exactly', () => {
    const result = tumbleResult();
    const tl = sequence(result, cascadeScene());
    const implied = applyDirectivesForward(result.initialGrid, tl.directives, 5, 6);
    expect(implied).toEqual(result.grid);
  });

  it('refill symbols equal the engine refill symbols (no synthesized symbols)', () => {
    const result = tumbleResult();
    const tl = sequence(result, cascadeScene());
    const refills = tl.directives.filter(
      (d): d is Extract<PresentationDirective, { kind: 'cascadeRefill' }> =>
        d.kind === 'cascadeRefill',
    );
    // Collect the engine's refill (col -> symbols) per step, then compare the emitted refills in order.
    const expected: { col: number; symbols: SymbolId[] }[] = [];
    for (const step of result.cascades!) {
      for (const rf of [...step.refill].sort((a, b) => a.col - b.col)) {
        expected.push({ col: rf.col, symbols: [...rf.symbols] });
      }
    }
    expect(refills.map((r) => ({ col: r.col, symbols: [...r.symbols] }))).toEqual(expected);
  });

  it('accumulates atMs by explodeMs + dropMs + settleMs + stepGapMs per step (within a step explode/win/drop/refill share the step start)', () => {
    const result = tumbleResult();
    const t = tumble();
    const tl = sequence(result, cascadeScene(t));
    const span = t.explodeMs + t.dropMs + t.settleMs + t.stepGapMs;
    const explodes = tl.directives.filter((d) => d.kind === 'cascadeExplode');
    for (let k = 0; k < explodes.length; k += 1) {
      expect(explodes[k]!.atMs).toBe(k * span);
    }
    // Each step's rollup link spans [stepStart, stepStart + dropMs].
    const links = tl.directives.filter((d) => d.kind === 'counterRollup');
    for (let k = 0; k < links.length; k += 1) {
      const link = links[k]!;
      if (link.kind !== 'counterRollup') throw new Error('narrowing');
      expect(link.startMs).toBe(k * span);
      expect(link.endMs).toBe(k * span + t.dropMs);
    }
  });

  it('the WP-4.8 single line-win rollup is absent for the cascade spin (only the chain links appear)', () => {
    const result = tumbleResult();
    // A scene WITH a rollupStart win-sequence step: it would emit the WP-4.8 single rollup for a non-cascade
    // spin, but must be suppressed here. The only counterRollups are the WP-4.10 chain (one per step).
    const scene = cascadeScene();
    scene.winSequencer.sequences['base'] = {
      steps: [
        {
          atMs: 999999,
          target: { kind: 'allWinningCells' },
          action: { kind: 'rollupStart', curve: 'linear' },
        },
      ],
    };
    const tl = sequence(result, scene);
    const links = tl.directives.filter((d) => d.kind === 'counterRollup');
    // Exactly cascades.length links; none of them is the WP-4.8 rollup (which would have startMs 999999).
    expect(links).toHaveLength(result.cascades!.length);
    for (const d of links) {
      if (d.kind !== 'counterRollup') throw new Error('narrowing');
      expect(d.startMs).not.toBe(999999);
    }
  });

  it('emits NO cascade directives for a non-cascade spin', () => {
    const base = MOCK_SCENARIOS['base-win'].result; // no cascades, 5x3 reelStrip board
    // A scene matching the base-win 5x3 board (the landing loop reads initialGrid[row][col] for every cell).
    const scene: SlotScene = {
      grid: {
        topology: 'reelStrip',
        cols: 5,
        rows: 3,
        cellWidth: 100,
        cellHeight: 100,
        cellGap: 0,
        reelStopStaggerMs: 0,
        gravity: 'column-down',
        anticipation: {
          triggerSymbols: [S('scatter')],
          thresholdCount: 99,
          maxAnticipatingCols: 1,
        },
      },
      symbols: {},
      winSequencer: {
        sequences: { base: { steps: [] } },
        thresholds: { big: 100000, mega: 500000, epic: 1000000 },
        defaultSequence: 'base',
      },
      featureFlows: { states: { base: {} }, transitions: [], entry: 'base' },
      tumble: tumble(),
    };
    const tl = sequence(base, scene);
    expect(tl.directives.filter((d) => d.kind === 'cascadeExplode')).toHaveLength(0);
    expect(tl.directives.filter((d) => d.kind === 'cascadeDrop')).toHaveLength(0);
    expect(tl.directives.filter((d) => d.kind === 'cascadeRefill')).toHaveLength(0);
  });

  it('referential transparency: same (result, scene) yields a deep-equal timeline, and the comparator stays total', () => {
    const result = tumbleResult();
    const scene = cascadeScene();
    const a = sequence(result, scene);
    const b = sequence(result, scene);
    expect(a).toEqual(b);
    // Comparator totality over the full tumble timeline: no two distinct directives share a seq, and a
    // shuffle-then-sort reproduces the sorted order (stability-independence).
    const seqs = new Set(a.directives.map((d) => d.seq));
    expect(seqs.size).toBe(a.directives.length);
    const shuffled = [...a.directives].reverse().sort(compareDirectives);
    expect(shuffled).toEqual([...a.directives]);
  });
});

// ISOLATED drop-solver tests (TASK-4.10.4): hand-built small cascades with KNOWN expected from->to move
// lists, asserting survivors fall to the lowest empty cell and refills enter top-down. The move-emission
// convention: a survivor whose row CHANGES emits a move; a survivor that does not move emits NO move;
// refills are never moves.
describe('drop solver (WP-4.10 TASK-4.10.4)', () => {
  // A tiny single-column helper: a 4x1 grid.
  function col4(a: string, b: string, c: string, d: string): SymbolId[][] {
    return [[S(a)], [S(b)], [S(c)], [S(d)]];
  }
  function move(fromRow: number, toRow: number, col: number, sym: string): SymbolMove {
    const from: GridCell = { row: fromRow, col };
    const to: GridCell = { row: toRow, col };
    return { from, to, symbol: S(sym) };
  }

  it('cascade 1: remove the bottom cell; survivors fall one row; one refill enters at the top', () => {
    // Column [A,B,C,D]; remove row 3 (D). Survivors A,B,C fall to rows 1,2,3; refill X enters at row 0.
    const result = solveCascadeStep(
      col4('A', 'B', 'C', 'D'),
      [[3, 0]],
      [{ col: 0, symbols: [S('X')] }],
      4,
      1,
    );
    expect(result.moves).toEqual([move(0, 1, 0, 'A'), move(1, 2, 0, 'B'), move(2, 3, 0, 'C')]);
    expect(result.board).toEqual(col4('X', 'A', 'B', 'C'));
  });

  it('cascade 2: remove a MIDDLE cell; only the survivors above it move down; refill enters at the top', () => {
    // Column [A,B,C,D]; remove row 1 (B). Survivors A,C,D. A is above the gap, so A falls to row 1; C,D
    // are below the removed cell but there are no removed cells below them, so they DO move because the
    // single empty count pushes the whole survivor stack to the bottom: survivors [A,C,D] occupy rows
    // 1,2,3 (emptyCount = 1). So A:0->1, C:2->2 (no move), D:3->3 (no move). Refill X at row 0.
    const result = solveCascadeStep(
      col4('A', 'B', 'C', 'D'),
      [[1, 0]],
      [{ col: 0, symbols: [S('X')] }],
      4,
      1,
    );
    expect(result.moves).toEqual([move(0, 1, 0, 'A')]); // only A changes row; C and D stay put
    expect(result.board).toEqual(col4('X', 'A', 'C', 'D'));
  });

  it('cascade 3: multi-column, multi-removed; survivors compress to the bottom, refills fill the top in order', () => {
    // 3x2 grid.
    //   col 0: [A,B,C], remove rows 0 and 2 (A,C) -> survivor B falls to the bottom (row 2); refills P,Q
    //          enter rows 0,1 top-down.
    //   col 1: [D,E,F], remove nothing -> no moves, no refill.
    const grid: SymbolId[][] = [
      [S('A'), S('D')],
      [S('B'), S('E')],
      [S('C'), S('F')],
    ];
    const result = solveCascadeStep(
      grid,
      [
        [0, 0],
        [2, 0],
      ],
      [{ col: 0, symbols: [S('P'), S('Q')] }],
      3,
      2,
    );
    // col 0: survivor B at original row 1 -> emptyCount 2, B is the only survivor (index 0) -> row 2. Moves.
    expect(result.moves).toEqual([move(1, 2, 0, 'B')]);
    expect(result.board).toEqual([
      [S('P'), S('D')],
      [S('Q'), S('E')],
      [S('B'), S('F')],
    ]);
  });

  it('a column with NO removed cells emits no moves and is unchanged', () => {
    const result = solveCascadeStep(col4('A', 'B', 'C', 'D'), [], [], 4, 1);
    expect(result.moves).toEqual([]);
    expect(result.board).toEqual(col4('A', 'B', 'C', 'D'));
  });

  it('is deterministic: the same cascade in yields the byte-identical move list out', () => {
    const grid = col4('A', 'B', 'C', 'D');
    const removed: [number, number][] = [[3, 0]];
    const refill = [{ col: 0, symbols: [S('X')] }];
    const a = solveCascadeStep(grid, removed, refill, 4, 1);
    const b = solveCascadeStep(grid, removed, refill, 4, 1);
    expect(a.moves).toEqual(b.moves);
    expect(a.board).toEqual(b.board);
  });

  it('chains across the tumble-cascade mock steps to reach result.grid', () => {
    const result = tumbleResult();
    let board: readonly (readonly SymbolId[])[] = result.initialGrid;
    for (const step of result.cascades!) {
      board = solveCascadeStep(board, step.removed, step.refill, 5, 6).board;
    }
    expect(board.map((r) => [...r])).toEqual(result.grid);
  });

  it('throws (fail-loud) when a refill count does not fill the emptied cells', () => {
    // Remove one cell but provide zero refills: structurally inconsistent (a validated engine never does
    // this; the solver is the LAW 3 backstop).
    expect(() => solveCascadeStep(col4('A', 'B', 'C', 'D'), [[3, 0]], [], 4, 1)).toThrow();
  });
});
