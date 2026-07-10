import { describe, expect, it } from 'vitest';
import {
  MOCK_SCENARIO_IDS,
  MOCK_SCENARIOS,
  MockMathEngine,
  validateSpinResult,
} from '../src/index';
import type { MathEngine, SpinInput, SpinResult } from '../src/index';
// The engine transport lives ONLY on the /real sub-path, never the main barrel (LAW 1): a test importing
// it must reach the sub-path directly, exactly as an editor/runtime host would.
import { createRealHttpEngine } from '../src/real/index';
import type { ResolveFetch } from '../src/real/index';
import type { NativeResolveOutput } from '../src/real/native';

// WP-5.8 conformance shim: prove the HTTP RealEngineAdapter and the MockMathEngine present the IDENTICAL
// MathEngine surface and IDENTICAL validation behavior for the SAME payloads (the swap-in guarantee).
//
// LAW 1: the fake transport REPLAYS committed scenario data. `spinResultToNative` is a pure inverse of the
// adapter's projection: it re-encodes a COMMITTED MockMathEngine SpinResult into the engine's native field
// names. It derives no outcome (no RNG, no symbol/win logic); it only renames fields of fixed data. Feeding
// that native payload back through the real HTTP stack must reproduce the committed SpinResult byte for
// byte, which is exactly the swap-in guarantee: same seed in, identical validated result out.

const INPUT: SpinInput = { bet: 100, seed: { serverSeedHash: 'h', clientSeed: 'c', nonce: 7 } };

// Pure inverse projection of a committed SpinResult into the native resolve shape. Every field traces to
// the committed result; nothing is invented.
function spinResultToNative(result: SpinResult): NativeResolveOutput {
  const hasCascades = result.cascades !== undefined && result.cascades.length > 0;
  return {
    id: result.spinId,
    stake: result.bet,
    boardFinal: result.grid,
    ...(hasCascades ? { boardInitial: result.initialGrid } : {}),
    paylines: result.wins.map((w) => ({
      sym: w.symbol,
      cells: w.positions,
      pay: w.amount,
      ...(w.lineIndex === undefined ? {} : { line: w.lineIndex }),
    })),
    bonuses: result.features.map((f) => ({ kind: f.type, payload: f.data })),
    ...(hasCascades && result.cascades
      ? {
          tumbles: result.cascades.map((c) => ({
            removedCells: c.removed,
            fill: c.refill.map((rf) => ({ column: rf.col, pieces: rf.symbols })),
            winThisStep: c.stepWin,
            runningTotal: c.cumulativeWin,
          })),
        }
      : {}),
    total: result.totalWin,
    ...(result.rngProof === undefined ? {} : { proof: result.rngProof }),
  };
}

function singleShotFetch(native: NativeResolveOutput): ResolveFetch {
  return async () => ({ status: 200, text: async () => JSON.stringify(native) });
}

describe('real HTTP adapter vs MockMathEngine (WP-5.8 swap-in guarantee)', () => {
  for (const scenarioId of MOCK_SCENARIO_IDS) {
    const scenario = MOCK_SCENARIOS[scenarioId];

    it(`presents an identical validated SpinResult for scenario "${scenarioId}"`, async () => {
      const mock: MathEngine = new MockMathEngine(scenarioId);
      const expected = await mock.spin(INPUT);

      const real: MathEngine = createRealHttpEngine({
        config: { baseUrl: 'https://engine.test/resolve' },
        gridSize: scenario.gridSize,
        deps: {
          fetch: singleShotFetch(spinResultToNative(expected)),
          sleep: async () => {},
          random: () => 0,
        },
      });
      const actual = await real.spin(INPUT);

      // Same surface: both are plain MathEngine values whose spin resolves a SpinResult.
      expect(typeof real.spin).toBe('function');
      // Identical validation behavior: the committed mock result validates, and so does the real result
      // against the same grid size.
      expect(validateSpinResult(expected, scenario.gridSize).ok).toBe(true);
      expect(validateSpinResult(actual, scenario.gridSize).ok).toBe(true);
      // Swap-in: the two are deep-equal.
      expect(actual).toEqual(expected);
    });
  }

  it('both surfaces are idempotent for the same input (LAW 1 determinism)', async () => {
    const scenario = MOCK_SCENARIOS['tumble-cascade'];
    const native = spinResultToNative(MOCK_SCENARIOS['tumble-cascade'].result);
    const real: MathEngine = createRealHttpEngine({
      config: { baseUrl: 'https://engine.test/resolve' },
      gridSize: scenario.gridSize,
      deps: { fetch: singleShotFetch(native), sleep: async () => {}, random: () => 0 },
    });

    const first = await real.spin(INPUT);
    const second = await real.spin(INPUT);
    expect(second).toEqual(first);
  });
});
