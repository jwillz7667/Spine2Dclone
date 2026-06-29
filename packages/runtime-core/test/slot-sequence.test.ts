import { describe, expect, it } from 'vitest';
import { symbolId } from '@marionette/format/slot';
import type {
  SymbolId,
  SlotScene,
  GridConfig,
  SymbolAnimSet,
  WinSequenceConfig,
} from '@marionette/format/slot-types';
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
  sequences?: WinSequenceConfig['sequences'];
  thresholds?: WinSequenceConfig['thresholds'];
  defaultSequence?: string;
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
    winSequencer: {
      sequences: opts.sequences ?? {},
      thresholds: opts.thresholds ?? { big: 10, mega: 50, epic: 100 },
      defaultSequence: opts.defaultSequence ?? 'base',
    },
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

// WP-4.8 win sequencer (section 5.4.3 LINE-WIN model + escalation). The base-win scenario is a 5x3 line
// win (initialGrid === grid, no cascades); the mega-escalation scenario is a 6x5 big win whose
// totalWin/bet crosses big + mega (but not epic) against the default thresholds.
describe('sequence: win sequence stage 3 (WP-4.8 TASK-4.8.3)', () => {
  // An authored sequence that animates all winning cells, fires a VFX preset per cell, and starts the
  // single line-win rollup. Used by the base-win assertions below.
  function baseWinScene(): SlotScene {
    return makeScene({
      rows: 3,
      cols: 5,
      reelStopStaggerMs: 200,
      triggerSymbols: ['scatter'],
      thresholdCount: 99, // unreachable: isolate the win-sequence assertions from anticipation.
      maxAnticipatingCols: 2,
      thresholds: { big: 10, mega: 50, epic: 100 },
      defaultSequence: 'base',
      sequences: {
        base: {
          steps: [
            { atMs: 1000, target: { kind: 'allWinningCells' }, action: { kind: 'animateWin' } },
            {
              atMs: 1000,
              target: { kind: 'allWinningCells' },
              action: { kind: 'vfx', preset: 'sparkle', anchorRule: 'eachCell' },
            },
            {
              atMs: 1200,
              target: { kind: 'allWinningCells' },
              action: { kind: 'rollupStart', curve: 'linear' },
            },
          ],
        },
      },
    });
  }

  it('animates exactly the cells in wins[].positions (set-equality)', () => {
    const result = MOCK_SCENARIOS['base-win'].result; // wins[0].positions = [1,0],[1,1],[1,2]
    const tl = sequence(result, baseWinScene());
    const animated = tl.directives
      .filter((d) => d.kind === 'symbolAnimate' && d.set === 'win')
      .map((d) => (d.kind === 'symbolAnimate' ? `${d.row},${d.col}` : ''));
    const expected = new Set(result.wins.flatMap((w) => w.positions.map(([r, c]) => `${r},${c}`)));
    expect(new Set(animated)).toEqual(expected);
    expect(animated).toHaveLength(expected.size); // no duplicate directive per cell
  });

  it('fires the authored VFX preset once per targeted cell (eachCell)', () => {
    const result = MOCK_SCENARIOS['base-win'].result;
    const tl = sequence(result, baseWinScene());
    const bursts = tl.directives.filter((d) => d.kind === 'vfxBurst');
    const cellCount = result.wins.flatMap((w) => w.positions).length;
    expect(bursts).toHaveLength(cellCount);
    for (const d of bursts) {
      if (d.kind !== 'vfxBurst') throw new Error('narrowing');
      expect(d.preset).toBe('sparkle');
      expect(d.anchor.kind).toBe('cell');
    }
  });

  it('fires ONE gridCenter VFX burst at the screen origin', () => {
    const result = MOCK_SCENARIOS['base-win'].result;
    const scene = makeScene({
      rows: 3,
      cols: 5,
      reelStopStaggerMs: 200,
      triggerSymbols: ['scatter'],
      thresholdCount: 99,
      maxAnticipatingCols: 2,
      defaultSequence: 'base',
      sequences: {
        base: {
          steps: [
            {
              atMs: 500,
              target: { kind: 'allWinningCells' },
              action: { kind: 'vfx', preset: 'rays', anchorRule: 'gridCenter' },
            },
          ],
        },
      },
    });
    const bursts = sequence(result, scene).directives.filter((d) => d.kind === 'vfxBurst');
    expect(bursts).toHaveLength(1);
    const burst = bursts[0]!;
    if (burst.kind !== 'vfxBurst') throw new Error('narrowing');
    expect(burst.anchor).toEqual({ kind: 'screen', x: 0, y: 0 });
  });

  it('emits exactly ONE counterRollup with toUnits === totalWin (line-win model)', () => {
    const result = MOCK_SCENARIOS['base-win'].result;
    const tl = sequence(result, baseWinScene());
    const rollups = tl.directives.filter((d) => d.kind === 'counterRollup');
    expect(rollups).toHaveLength(1);
    const rollup = rollups[0]!;
    if (rollup.kind !== 'counterRollup') throw new Error('narrowing');
    expect(rollup.fromUnits).toBe(0);
    expect(rollup.toUnits).toBe(result.totalWin);
    expect(rollup.startMs).toBe(1200);
    expect(rollup.endMs).toBeGreaterThan(rollup.startMs);
    expect(rollup.curve).toBe('linear');
  });

  it('SUPPRESSES the line-win rollup when result.cascades is non-empty', () => {
    const base = MOCK_SCENARIOS['base-win'].result;
    // Synthesize a cascade marker on a copy (the suppression key is `cascades` non-empty).
    const cascadeResult: SpinResult = {
      ...base,
      cascades: [{ removed: [], refill: [], stepWin: 0, cumulativeWin: base.totalWin }],
    };
    const tl = sequence(cascadeResult, baseWinScene());
    expect(tl.directives.filter((d) => d.kind === 'counterRollup')).toHaveLength(0);
  });

  it('byLine and bySymbol target rules resolve to the right cells', () => {
    const result = MOCK_SCENARIOS['mega-escalation'].result; // wins[0]: line 0, symbol H1, 5 cells
    const byLine = makeScene({
      rows: 5,
      cols: 6,
      reelStopStaggerMs: 0,
      triggerSymbols: ['scatter'],
      thresholdCount: 99,
      maxAnticipatingCols: 1,
      defaultSequence: 'base',
      sequences: {
        base: {
          steps: [
            { atMs: 0, target: { kind: 'byLine', index: 0 }, action: { kind: 'animateWin' } },
          ],
        },
      },
    });
    const lineCells = sequence(result, byLine).directives.filter(
      (d) => d.kind === 'symbolAnimate' && d.set === 'win',
    );
    expect(lineCells).toHaveLength(5);

    const missLine = makeScene({
      rows: 5,
      cols: 6,
      reelStopStaggerMs: 0,
      triggerSymbols: ['scatter'],
      thresholdCount: 99,
      maxAnticipatingCols: 1,
      defaultSequence: 'base',
      sequences: {
        base: {
          steps: [
            { atMs: 0, target: { kind: 'byLine', index: 7 }, action: { kind: 'animateWin' } },
          ],
        },
      },
    });
    expect(
      sequence(result, missLine).directives.filter(
        (d) => d.kind === 'symbolAnimate' && d.set === 'win',
      ),
    ).toHaveLength(0);

    const bySymbol = makeScene({
      rows: 5,
      cols: 6,
      reelStopStaggerMs: 0,
      triggerSymbols: ['scatter'],
      thresholdCount: 99,
      maxAnticipatingCols: 1,
      defaultSequence: 'base',
      sequences: {
        base: {
          steps: [
            {
              atMs: 0,
              target: { kind: 'bySymbol', symbol: symbolId('H1') },
              action: { kind: 'animateWin' },
            },
          ],
        },
      },
    });
    expect(
      sequence(result, bySymbol).directives.filter(
        (d) => d.kind === 'symbolAnimate' && d.set === 'win',
      ),
    ).toHaveLength(5);
  });

  it('resolves targeted cells in (col, row) order', () => {
    // A two-win result on a 3x3 board, deliberately authored out of (col,row) order, to pin the sort.
    const result: SpinResult = {
      spinId: 'order',
      bet: 100,
      initialGrid: board([
        ['A', 'B', 'C'],
        ['D', 'E', 'F'],
        ['G', 'H', 'I'],
      ]),
      grid: board([
        ['A', 'B', 'C'],
        ['D', 'E', 'F'],
        ['G', 'H', 'I'],
      ]),
      wins: [
        {
          symbol: symbolId('A'),
          positions: [
            [2, 1],
            [0, 0],
            [1, 1],
            [0, 2],
          ],
          amount: 10,
        },
      ],
      totalWin: 10,
      features: [],
    };
    const scene = makeScene({
      rows: 3,
      cols: 3,
      reelStopStaggerMs: 0,
      triggerSymbols: ['scatter'],
      thresholdCount: 99,
      maxAnticipatingCols: 1,
      defaultSequence: 'base',
      sequences: {
        base: {
          steps: [{ atMs: 0, target: { kind: 'allWinningCells' }, action: { kind: 'animateWin' } }],
        },
      },
    });
    const winCells = sequence(result, scene)
      .directives.filter((d) => d.kind === 'symbolAnimate' && d.set === 'win')
      .map((d) => (d.kind === 'symbolAnimate' ? [d.col, d.row] : []));
    // (col,row) ascending: (0,0),(1,1),(1,2),(2,0).
    expect(winCells).toEqual([
      [0, 0],
      [1, 1],
      [1, 2],
      [2, 0],
    ]);
  });

  it('selects the tier-named sequence when its tier is crossed, else defaultSequence', () => {
    // mega-escalation crosses mega; a 'mega' sequence (animates) is selected over 'base' (no steps).
    const result = MOCK_SCENARIOS['mega-escalation'].result;
    const scene = makeScene({
      rows: 5,
      cols: 6,
      reelStopStaggerMs: 0,
      triggerSymbols: ['scatter'],
      thresholdCount: 99,
      maxAnticipatingCols: 1,
      thresholds: { big: 10, mega: 50, epic: 100 },
      defaultSequence: 'base',
      sequences: {
        base: { steps: [] },
        mega: {
          steps: [{ atMs: 0, target: { kind: 'allWinningCells' }, action: { kind: 'animateWin' } }],
        },
      },
    });
    const winCells = sequence(result, scene).directives.filter(
      (d) => d.kind === 'symbolAnimate' && d.set === 'win',
    );
    expect(winCells.length).toBeGreaterThan(0); // the 'mega' sequence ran, not the empty 'base'
  });
});

describe('sequence: escalation stage 6 (WP-4.8 TASK-4.8.4)', () => {
  function escalationScene(thresholds: WinSequenceConfig['thresholds']): SlotScene {
    return makeScene({
      rows: 5,
      cols: 6,
      reelStopStaggerMs: 0,
      triggerSymbols: ['scatter'],
      thresholdCount: 99,
      maxAnticipatingCols: 1,
      thresholds,
      defaultSequence: 'base',
      sequences: { base: { steps: [] } },
    });
  }

  function tiers(tl: PresentationTimeline): string[] {
    return tl.directives
      .filter((d) => d.kind === 'escalation')
      .map((d) => (d.kind === 'escalation' ? d.tier : ''));
  }

  it('emits exactly the crossed tiers in ascending order (mega-escalation crosses big + mega)', () => {
    const result = MOCK_SCENARIOS['mega-escalation'].result; // totalWin 600, bet 10
    // 600 >= 10*10 (big), 600 >= 50*10=500 (mega), 600 < 100*10=1000 (epic not crossed).
    const tl = sequence(result, escalationScene({ big: 10, mega: 50, epic: 100 }));
    expect(tiers(tl)).toEqual(['big', 'mega']);
  });

  it('lowering totalWin below a threshold removes that tier', () => {
    const base = MOCK_SCENARIOS['mega-escalation'].result;
    const scene = escalationScene({ big: 10, mega: 50, epic: 100 });
    // totalWin 499 with bet 10: 499 >= 100 (big), 499 < 500 (mega gone).
    const lowered: SpinResult = { ...base, totalWin: 499 };
    expect(tiers(sequence(lowered, scene))).toEqual(['big']);
    // totalWin 99 with bet 10: 99 < 100, no tier crosses.
    const tiny: SpinResult = { ...base, totalWin: 99 };
    expect(tiers(sequence(tiny, scene))).toEqual([]);
  });

  it('a small line win (base-win) crosses no tier', () => {
    const result = MOCK_SCENARIOS['base-win'].result; // totalWin 200, bet 100 (5x3 grid)
    // 200 < 10*100 = 1000, so no tier is crossed at the default thresholds.
    const scene = makeScene({
      rows: 3,
      cols: 5,
      reelStopStaggerMs: 0,
      triggerSymbols: ['scatter'],
      thresholdCount: 99,
      maxAnticipatingCols: 1,
      thresholds: { big: 10, mega: 50, epic: 100 },
      defaultSequence: 'base',
      sequences: { base: { steps: [] } },
    });
    expect(tiers(sequence(result, scene))).toEqual([]);
  });
});

describe('sequence: WP-4.8 referential transparency + comparator totality', () => {
  // A scene that emits win + vfx + rollup + escalation directives, exercising every WP-4.8 stage at once.
  function fullScene(): SlotScene {
    return makeScene({
      rows: 5,
      cols: 6,
      reelStopStaggerMs: 120,
      triggerSymbols: ['scatter'],
      thresholdCount: 1,
      maxAnticipatingCols: 3,
      thresholds: { big: 10, mega: 50, epic: 100 },
      defaultSequence: 'base',
      sequences: {
        base: {
          steps: [
            { atMs: 1000, target: { kind: 'allWinningCells' }, action: { kind: 'animateWin' } },
            {
              atMs: 1000,
              target: { kind: 'allWinningCells' },
              action: { kind: 'vfx', preset: 'coins', anchorRule: 'eachCell' },
            },
            {
              atMs: 1000,
              target: { kind: 'allWinningCells' },
              action: { kind: 'rollupStart', curve: 'easeOutQuad' },
            },
          ],
        },
        mega: {
          steps: [
            { atMs: 1000, target: { kind: 'allWinningCells' }, action: { kind: 'animateWin' } },
            {
              atMs: 1000,
              target: { kind: 'allWinningCells' },
              action: { kind: 'rollupStart', curve: 'linear' },
            },
          ],
        },
      },
    });
  }

  it('produces deep-equal timelines across 1000 repeated calls', () => {
    const result = MOCK_SCENARIOS['mega-escalation'].result;
    const scene = fullScene();
    const first = sequence(result, scene);
    for (let i = 0; i < 1000; i += 1) {
      expect(sequence(result, scene)).toEqual(first);
    }
  });

  it('the comparator stays total: every directive has a unique seq and the order is strict', () => {
    const result = MOCK_SCENARIOS['mega-escalation'].result;
    const tl = sequence(result, fullScene());
    const seqs = tl.directives.map((d) => d.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    for (let i = 1; i < tl.directives.length; i += 1) {
      expect(compareDirectives(tl.directives[i - 1]!, tl.directives[i]!)).toBeLessThan(0);
    }
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
