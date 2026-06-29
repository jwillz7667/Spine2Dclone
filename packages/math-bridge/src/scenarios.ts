import { symbolId } from '@marionette/format/slot';
import type { SymbolId } from '@marionette/format/slot';
import type { CascadeStep, SpinResult } from './types';
import { forwardColumnDownStep } from './validate';

// The MockMathEngine canned scenarios (phase-4 WP-4.2, section 9.2). Each is a deterministic, committed
// SpinResult the mock returns verbatim (as a deep clone) so the entire slot layer is built and tested
// before the real engine is wired. They carry NO RNG and NO clock; presentation never computes them
// (LAW 1). The five scenarios collectively exercise a base win, a free-spin feature, a cascade, an
// escalation tier crossing, and a retrigger (the coverage assertion lives in the WP-4.2 test).
//
// Authoring note: a cascade scenario's `grid` is DERIVED from its `initialGrid` + steps by forward-
// applying the SAME column-down rule the validator checks (forwardColumnDownStep), so the fixture is
// guaranteed structurally consistent (validateSpinResult passes by construction). This is build-time
// authoring convenience, not per-spin outcome logic: the resulting SpinResult is a fixed canned value.

export type MockScenarioId =
  | 'base-win'
  | 'freespin-trigger'
  | 'tumble-cascade'
  | 'mega-escalation'
  | 'retrigger';

const S = symbolId;
function board(rows: readonly (readonly string[])[]): SymbolId[][] {
  return rows.map((r) => r.map(S));
}

// Forward-apply a step list to derive the final board (scenario authoring helper). Throws if a step is
// inconsistent, which would be an authoring bug surfaced loudly at module load.
function deriveGrid(
  initialGrid: readonly (readonly SymbolId[])[],
  steps: readonly CascadeStep[],
  rows: number,
  cols: number,
): SymbolId[][] {
  let current: readonly (readonly SymbolId[])[] = initialGrid;
  for (let i = 0; i < steps.length; i += 1) {
    const next = forwardColumnDownStep(current, steps[i]!, rows, cols);
    if (next === null) throw new Error(`tumble scenario step ${i} is inconsistent (authoring bug)`);
    current = next;
  }
  return current.map((r) => r.slice());
}

// --- base-win: a 5x3 reelStrip line win (initialGrid === grid, single rollup) ---
function baseWin(): SpinResult {
  const grid = board([
    ['H2', 'H3', 'L1', 'L2', 'L3'],
    ['H1', 'H1', 'H1', 'L1', 'L2'],
    ['L3', 'H2', 'H3', 'wild', 'scatter'],
  ]);
  return {
    spinId: 'mock-base-win',
    bet: 100,
    initialGrid: grid.map((r) => r.slice()),
    grid,
    wins: [
      {
        symbol: S('H1'),
        positions: [
          [1, 0],
          [1, 1],
          [1, 2],
        ],
        amount: 200,
        lineIndex: 4,
      },
    ],
    totalWin: 200,
    features: [],
  };
}

// --- freespin-trigger: a 6x5 scatterPay with three scatters awarding free spins (initialGrid === grid) ---
function freespinTrigger(): SpinResult {
  const grid = board([
    ['scatter', 'H1', 'H2', 'L1', 'L2', 'L3'],
    ['H3', 'L1', 'L2', 'H1', 'H2', 'H3'],
    ['L1', 'L2', 'scatter', 'L3', 'H1', 'H2'],
    ['H2', 'H3', 'L1', 'L2', 'L3', 'H1'],
    ['L3', 'H1', 'H2', 'H3', 'L1', 'scatter'],
  ]);
  return {
    spinId: 'mock-freespin-trigger',
    bet: 100,
    initialGrid: grid.map((r) => r.slice()),
    grid,
    wins: [],
    totalWin: 0,
    features: [{ type: 'freeSpinsAwarded', data: { count: 10 } }],
  };
}

// --- tumble-cascade: a 6x5 scatterPay with three cascades down column 0 (grid derived, cumulative ends
// on totalWin) ---
function tumbleCascade(): SpinResult {
  const rows = 5;
  const cols = 6;
  const initialGrid = board([
    ['H1', 'H2', 'L1', 'L2', 'L3', 'H3'],
    ['H1', 'L1', 'L2', 'H2', 'H3', 'L1'],
    ['H1', 'L2', 'H1', 'L3', 'L1', 'H2'],
    ['L1', 'H3', 'L1', 'H1', 'H2', 'L3'],
    ['L1', 'L2', 'H2', 'L1', 'L3', 'H1'],
  ]);
  const steps: CascadeStep[] = [
    {
      removed: [
        [3, 0],
        [4, 0],
      ],
      refill: [{ col: 0, symbols: [S('H2'), S('H3')] }],
      stepWin: 100,
      cumulativeWin: 100,
    },
    {
      removed: [[4, 0]],
      refill: [{ col: 0, symbols: [S('L2')] }],
      stepWin: 150,
      cumulativeWin: 250,
    },
    {
      removed: [[4, 0]],
      refill: [{ col: 0, symbols: [S('L3')] }],
      stepWin: 150,
      cumulativeWin: 400,
    },
  ];
  const grid = deriveGrid(initialGrid, steps, rows, cols);
  return {
    spinId: 'mock-tumble-cascade',
    bet: 100,
    initialGrid,
    grid,
    wins: [
      {
        symbol: S('H1'),
        positions: [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
        amount: 100,
      },
    ],
    totalWin: 400,
    features: [],
    cascades: steps,
  };
}

// --- mega-escalation: a 6x5 scatterPay big win (totalWin/bet = 60x crosses the mega threshold) ---
function megaEscalation(): SpinResult {
  const grid = board([
    ['H1', 'H1', 'H1', 'H1', 'H1', 'L3'],
    ['H3', 'L1', 'L2', 'H1', 'H2', 'H3'],
    ['L1', 'L2', 'H3', 'L3', 'H1', 'H2'],
    ['H2', 'H3', 'L1', 'L2', 'L3', 'H1'],
    ['L3', 'H1', 'H2', 'H3', 'L1', 'L2'],
  ]);
  return {
    spinId: 'mock-mega-escalation',
    bet: 10,
    initialGrid: grid.map((r) => r.slice()),
    grid,
    wins: [
      {
        symbol: S('H1'),
        positions: [
          [0, 0],
          [0, 1],
          [0, 2],
          [0, 3],
          [0, 4],
        ],
        amount: 600,
        lineIndex: 0,
      },
    ],
    totalWin: 600,
    features: [],
  };
}

// --- retrigger: a 6x5 scatterPay free-spin award plus a retrigger feature (count extension) ---
function retrigger(): SpinResult {
  const grid = board([
    ['scatter', 'H1', 'H2', 'L1', 'scatter', 'L3'],
    ['H3', 'L1', 'L2', 'H1', 'H2', 'H3'],
    ['L1', 'L2', 'scatter', 'L3', 'H1', 'H2'],
    ['H2', 'H3', 'L1', 'L2', 'L3', 'H1'],
    ['L3', 'H1', 'H2', 'H3', 'L1', 'L2'],
  ]);
  return {
    spinId: 'mock-retrigger',
    bet: 100,
    initialGrid: grid.map((r) => r.slice()),
    grid,
    wins: [],
    totalWin: 0,
    features: [
      { type: 'freeSpinsAwarded', data: { count: 8 } },
      { type: 'retrigger', data: { count: 5 } },
    ],
  };
}

// The committed scenario table. The grid SIZE each scenario expects (for validateSpinResult) is paired
// here so the engine and the tests validate against the right dimensions.
export interface MockScenario {
  readonly result: SpinResult;
  readonly gridSize: { readonly rows: number; readonly cols: number };
}

export const MOCK_SCENARIOS: Readonly<Record<MockScenarioId, MockScenario>> = {
  'base-win': { result: baseWin(), gridSize: { rows: 3, cols: 5 } },
  'freespin-trigger': { result: freespinTrigger(), gridSize: { rows: 5, cols: 6 } },
  'tumble-cascade': { result: tumbleCascade(), gridSize: { rows: 5, cols: 6 } },
  'mega-escalation': { result: megaEscalation(), gridSize: { rows: 5, cols: 6 } },
  retrigger: { result: retrigger(), gridSize: { rows: 5, cols: 6 } },
};

export const MOCK_SCENARIO_IDS: readonly MockScenarioId[] = [
  'base-win',
  'freespin-trigger',
  'tumble-cascade',
  'mega-escalation',
  'retrigger',
];
