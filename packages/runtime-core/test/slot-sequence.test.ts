import { describe, expect, it } from 'vitest';
import { symbolId } from '@marionette/format/slot';
import type { SymbolId, SlotScene, GridConfig, SymbolAnimSet } from '@marionette/format/slot-types';
import { MOCK_SCENARIOS } from '@marionette/math-bridge';
import type { SpinResult } from '@marionette/math-bridge/types';
import { sequence } from '../src/slot/sequence';
import { compareDirectives } from '../src/slot/sequence';
import type { PresentationDirective, PresentationTimeline } from '../src/slot/timeline';

// WP-4.7 SlotPresentationSequencer CORE (phase-4 section 5.4): the determinism boundary (LAW 1). These
// suites pin referential transparency, the exact landing encoding of initialGrid, the provably-total
// (atMs, seq) comparator (no hidden KIND_PRIORITY key, so a non-stable runtime sort is safe), the
// anticipation counting math (direct AND differential, section 10.4), and the iteration-order invariance
// of the symbols Record (the no-Record-iteration guard).

const S = symbolId;

// Build a board (rows of columns) from string symbol ids; board[row][col], matching SpinResult.initialGrid.
function board(rows: readonly (readonly string[])[]): SymbolId[][] {
  return rows.map((r) => r.map(S));
}

// A minimal SymbolAnimSet (the sequencer reads symbols by keyed lookup only, never these field values).
function animSet(): SymbolAnimSet {
  return { skeletonRef: 'sk', idle: 'idle', land: 'land', win: 'win' };
}

// Hand-build a typed SlotScene. `symbolKeys` controls the INSERTION ORDER of the symbols Record (the
// iteration-invariance test shuffles it). The win/flow/tumble sub-configs are minimal valid stubs: WP-4.7
// emits no directives from them, so their content does not affect the output.
function makeScene(opts: {
  rows: number;
  cols: number;
  reelStopStaggerMs: number;
  triggerSymbols: readonly string[];
  thresholdCount: number;
  maxAnticipatingCols: number;
  symbolKeys?: readonly string[];
}): SlotScene {
  const grid: GridConfig = {
    topology: 'reelStrip',
    cols: opts.cols,
    rows: opts.rows,
    cellWidth: 100,
    cellHeight: 100,
    cellGap: 0,
    reelStopStaggerMs: opts.reelStopStaggerMs,
    gravity: 'column-down',
    anticipation: {
      triggerSymbols: opts.triggerSymbols.map(S),
      thresholdCount: opts.thresholdCount,
      maxAnticipatingCols: opts.maxAnticipatingCols,
    },
  };
  const symbols: Record<SymbolId, SymbolAnimSet> = {};
  for (const key of opts.symbolKeys ?? []) symbols[S(key)] = animSet();
  return {
    grid,
    symbols,
    winSequencer: { sequences: {}, thresholds: { big: 10, mega: 50, epic: 100 } },
    featureFlows: { entry: 'base', states: { base: {} }, transitions: [] },
    tumble: {
      explodeMs: 100,
      dropMs: 100,
      dropEasing: 'linear',
      refillStaggerMs: 50,
      settleMs: 50,
      stepGapMs: 50,
      rollupCurve: 'linear',
    },
  };
}

// A non-cascade SpinResult from a board (initialGrid === grid), no wins/features (WP-4.7 ignores them).
function spinFromBoard(spinId: string, b: SymbolId[][]): SpinResult {
  return {
    spinId,
    bet: 100,
    initialGrid: b.map((r) => r.slice()),
    grid: b.map((r) => r.slice()),
    wins: [],
    totalWin: 0,
    features: [],
  };
}

// Collect the (col-sorted) set of columns that received an `anticipation` directive.
function anticipatingCols(tl: PresentationTimeline): number[] {
  const cols = new Set<number>();
  for (const d of tl.directives) {
    if (d.kind === 'symbolAnimate' && d.set === 'anticipation') cols.add(d.col);
  }
  return [...cols].sort((a, b) => a - b);
}

describe('sequence: referential transparency (LAW 1)', () => {
  it('produces deep-equal timelines across 1000 repeated calls', () => {
    const scene = makeScene({
      rows: 3,
      cols: 5,
      reelStopStaggerMs: 200,
      triggerSymbols: ['scatter'],
      thresholdCount: 2,
      maxAnticipatingCols: 2,
      symbolKeys: ['H1', 'scatter', 'L1'],
    });
    const result = MOCK_SCENARIOS['base-win'].result;
    const first = sequence(result, scene);
    for (let i = 0; i < 1000; i += 1) {
      expect(sequence(result, scene)).toEqual(first);
    }
  });
});

describe('sequence: landing encodes initialGrid exactly (TASK-4.7.1)', () => {
  const rows = 3;
  const cols = 4;
  const stagger = 150;
  const b = board([
    ['A', 'B', 'C', 'D'],
    ['E', 'F', 'G', 'H'],
    ['I', 'J', 'K', 'L'],
  ]);
  const scene = makeScene({
    rows,
    cols,
    reelStopStaggerMs: stagger,
    triggerSymbols: ['scatter'],
    thresholdCount: 99, // unreachable: isolate the landing assertions from anticipation.
    maxAnticipatingCols: 2,
  });
  const tl = sequence(spinFromBoard('land', b), scene);

  it('emits one reelStop per column at col * stagger', () => {
    const stops = tl.directives.filter((d) => d.kind === 'reelStop');
    expect(stops).toHaveLength(cols);
    for (const d of stops) {
      if (d.kind !== 'reelStop') throw new Error('narrowing');
      expect(d.atMs).toBe(d.col * stagger);
    }
  });

  it('emits a symbolLand for every cell with the right symbol and atMs', () => {
    const lands = tl.directives.filter((d) => d.kind === 'symbolLand');
    expect(lands).toHaveLength(rows * cols);
    for (const d of lands) {
      if (d.kind !== 'symbolLand') throw new Error('narrowing');
      expect(d.symbol).toBe(b[d.row]![d.col]);
      expect(d.atMs).toBe(d.col * stagger);
    }
  });

  it('emits a symbolAnimate(idle) for every landed cell', () => {
    const idles = tl.directives.filter((d) => d.kind === 'symbolAnimate' && d.set === 'idle');
    expect(idles).toHaveLength(rows * cols);
  });

  it('durationMs is the last reel stop atMs (no anticipation here)', () => {
    expect(tl.durationMs).toBe((cols - 1) * stagger);
  });

  it('within a column reelStop precedes its symbolLand which precedes idle (seq order)', () => {
    // For column 0 (atMs 0) the construction order is reelStop, then per row land then idle. Verify the
    // first three directives at atMs 0 are reelStop(0), symbolLand(0,0), symbolAnimate(0,0,idle).
    const col0 = tl.directives.filter((d) => d.atMs === 0);
    expect(col0[0]!.kind).toBe('reelStop');
    expect(col0[1]!.kind).toBe('symbolLand');
    expect(col0[2]!.kind).toBe('symbolAnimate');
  });
});

describe('sequence: comparator totality + stability independence (TASK-4.7.3)', () => {
  // Across several results, no two distinct directives share a seq, and shuffling the pre-sort array then
  // sorting by (atMs, seq) yields the identical output (proving a non-stable runtime sort is safe). Each
  // MOCK scenario is paired with a scene matching its grid dimensions (WP-4.1 validates this on receipt).
  // One pairing uses stagger 0 to force MANY same-atMs directives (the hard tiebreak case where seq alone
  // must totally order the output); the others use a non-zero stagger.
  const cases: { result: SpinResult; scene: SlotScene }[] = (
    ['base-win', 'freespin-trigger', 'mega-escalation', 'retrigger'] as const
  ).flatMap((id) => {
    const { result, gridSize } = MOCK_SCENARIOS[id];
    return [0, 120].map((reelStopStaggerMs) => ({
      result,
      scene: makeScene({
        rows: gridSize.rows,
        cols: gridSize.cols,
        reelStopStaggerMs,
        triggerSymbols: ['scatter'],
        thresholdCount: 1,
        maxAnticipatingCols: 3,
      }),
    }));
  });

  it('assigns a globally unique seq to every directive (comparator never ties)', () => {
    for (const { result, scene } of cases) {
      const tl = sequence(result, scene);
      const seqs = tl.directives.map((d) => d.seq);
      expect(new Set(seqs).size).toBe(seqs.length);
      // seq is the 0-based contiguous emission index.
      expect([...seqs].sort((a, b) => a - b)).toEqual(seqs.map((_v, i) => i));
      // The output is in strictly increasing (atMs, seq) order (no distinct-directive tie).
      for (let i = 1; i < tl.directives.length; i += 1) {
        expect(compareDirectives(tl.directives[i - 1]!, tl.directives[i]!)).toBeLessThan(0);
      }
    }
  });

  it('a shuffled pre-sort array sorts to the identical output (non-stable sort safe)', () => {
    // freespin-trigger (5x6) with stagger 0: every directive shares atMs, so seq alone decides the order.
    const result = MOCK_SCENARIOS['freespin-trigger'].result;
    const scene = makeScene({
      rows: 5,
      cols: 6,
      reelStopStaggerMs: 0,
      triggerSymbols: ['scatter'],
      thresholdCount: 1,
      maxAnticipatingCols: 3,
    });
    const sorted = sequence(result, scene).directives;
    // A deterministic shuffle (index-based, no RNG) of the sorted array, then re-sort by the comparator.
    const shuffled: PresentationDirective[] = [...sorted];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = (i * 7 + 3) % (i + 1);
      const tmp = shuffled[i]!;
      shuffled[i] = shuffled[j]!;
      shuffled[j] = tmp;
    }
    shuffled.sort(compareDirectives);
    expect(shuffled).toEqual([...sorted]);
  });
});

describe('sequence: anticipation (section 10.4, TASK-4.7.2)', () => {
  it('DIRECT: a known board + config yields the exact anticipating-column set', () => {
    // 5 cols x 3 rows, trigger = scatter, threshold = 2, cap = 2. One scatter in col 0, one in col 1, so
    // the running count reaches 2 right after col 1 stops; the next 2 not-yet-stopped columns are 2 and 3.
    const b = board([
      ['scatter', 'H1', 'H2', 'H3', 'L1'],
      ['H1', 'scatter', 'L1', 'L2', 'L3'],
      ['L1', 'L2', 'H1', 'H2', 'H3'],
    ]);
    const scene = makeScene({
      rows: 3,
      cols: 5,
      reelStopStaggerMs: 200,
      triggerSymbols: ['scatter'],
      thresholdCount: 2,
      maxAnticipatingCols: 2,
    });
    const tl = sequence(spinFromBoard('antic-direct', b), scene);
    expect(anticipatingCols(tl)).toEqual([2, 3]);
    // Each anticipating column carries one anticipation directive per row, at that column's stop atMs.
    const antDir = tl.directives.filter(
      (d) => d.kind === 'symbolAnimate' && d.set === 'anticipation',
    );
    expect(antDir).toHaveLength(2 * 3); // 2 columns x 3 rows.
    for (const d of antDir) {
      if (d.kind !== 'symbolAnimate') throw new Error('narrowing');
      expect(d.atMs).toBe(d.col * 200);
    }
  });

  it('caps anticipation at the grid edge (cap larger than remaining columns)', () => {
    // Threshold met after col 3 (two scatters by then); cap 5 but only col 4 remains.
    const b = board([
      ['H1', 'H2', 'H3', 'scatter', 'L1'],
      ['scatter', 'L1', 'L2', 'L3', 'H1'],
      ['L1', 'L2', 'H1', 'H2', 'H3'],
    ]);
    const scene = makeScene({
      rows: 3,
      cols: 5,
      reelStopStaggerMs: 100,
      triggerSymbols: ['scatter'],
      thresholdCount: 2,
      maxAnticipatingCols: 5,
    });
    const tl = sequence(spinFromBoard('antic-edge', b), scene);
    expect(anticipatingCols(tl)).toEqual([4]);
  });

  it('emits no anticipation when the threshold is never met', () => {
    const b = board([
      ['H1', 'H2', 'H3', 'L1', 'L2'],
      ['scatter', 'L1', 'L2', 'L3', 'H1'],
      ['L1', 'L2', 'H1', 'H2', 'H3'],
    ]);
    const scene = makeScene({
      rows: 3,
      cols: 5,
      reelStopStaggerMs: 100,
      triggerSymbols: ['scatter'],
      thresholdCount: 2, // only one scatter on the whole board.
      maxAnticipatingCols: 3,
    });
    const tl = sequence(spinFromBoard('antic-none', b), scene);
    expect(anticipatingCols(tl)).toEqual([]);
  });

  it('DIFFERENTIAL: one fewer trigger symbol produces strictly fewer anticipation directives', () => {
    const scene = makeScene({
      rows: 3,
      cols: 5,
      reelStopStaggerMs: 200,
      triggerSymbols: ['scatter'],
      thresholdCount: 2,
      maxAnticipatingCols: 2,
    });
    // With two scatters (cols 0 and 1) the threshold is met after col 1, anticipating cols 2 and 3.
    const withTwo = board([
      ['scatter', 'H1', 'H2', 'H3', 'L1'],
      ['H1', 'scatter', 'L1', 'L2', 'L3'],
      ['L1', 'L2', 'H1', 'H2', 'H3'],
    ]);
    // Remove ONE scatter (col 1 -> H1): only one trigger remains, threshold 2 is never met.
    const withOne = board([
      ['scatter', 'H1', 'H2', 'H3', 'L1'],
      ['H1', 'H1', 'L1', 'L2', 'L3'],
      ['L1', 'L2', 'H1', 'H2', 'H3'],
    ]);
    const tlTwo = sequence(spinFromBoard('diff-two', withTwo), scene);
    const tlOne = sequence(spinFromBoard('diff-one', withOne), scene);
    const countAntic = (tl: PresentationTimeline): number =>
      tl.directives.filter((d) => d.kind === 'symbolAnimate' && d.set === 'anticipation').length;
    expect(countAntic(tlTwo)).toBeGreaterThan(0);
    expect(countAntic(tlOne)).toBe(0);
    expect(countAntic(tlOne)).toBeLessThan(countAntic(tlTwo));
  });
});

describe('sequence: iteration invariance over symbols Record (TASK-4.7.4)', () => {
  it('shuffling symbols insertion order does not change the directive output', () => {
    const b = board([
      ['scatter', 'H1', 'H2', 'H3', 'L1'],
      ['H1', 'scatter', 'L1', 'L2', 'L3'],
      ['L1', 'L2', 'H1', 'H2', 'H3'],
    ]);
    const result = spinFromBoard('iter', b);
    const base = {
      rows: 3,
      cols: 5,
      reelStopStaggerMs: 200,
      triggerSymbols: ['scatter'],
      thresholdCount: 2,
      maxAnticipatingCols: 2,
    } as const;
    // Numeric-looking and named ids in two opposite insertion orders (the object-key reorder hazard).
    const orderA = makeScene({ ...base, symbolKeys: ['1', '2', '10', 'scatter', 'H1', 'L1'] });
    const orderB = makeScene({ ...base, symbolKeys: ['L1', 'H1', 'scatter', '10', '2', '1'] });
    expect(sequence(result, orderA)).toEqual(sequence(result, orderB));
  });
});

describe('sequence: spinId passthrough and empty grid', () => {
  it('copies spinId and yields durationMs 0 for a 0x0 grid', () => {
    const scene = makeScene({
      rows: 0,
      cols: 0,
      reelStopStaggerMs: 100,
      triggerSymbols: ['scatter'],
      thresholdCount: 1,
      maxAnticipatingCols: 1,
    });
    const tl = sequence(spinFromBoard('empty', []), scene);
    expect(tl.spinId).toBe('empty');
    expect(tl.directives).toHaveLength(0);
    expect(tl.durationMs).toBe(0);
  });
});
