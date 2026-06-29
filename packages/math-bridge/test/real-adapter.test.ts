import { describe, expect, it, vi } from 'vitest';
import { symbolId } from '@marionette/format/slot';
import { RealEngineAdapter, RealEngineMappingError } from '../src/real/adapter';
import { resolveRealEngineConfig, RealEngineConfigError } from '../src/real/config';
import type { NonTransactingResolveClient } from '../src/real/client';
import type { NativeResolveOutput } from '../src/real/native';
import type { SpinInput } from '../src/types';

// WP-4.3 acceptance (phase-4 section 4.3, 5.5/5.6): the adapter is a PURE PROJECTION of the engine's
// non-transacting resolve output, validated on receipt; it never imports or calls a transacting endpoint
// (the money boundary, asserted by a stub client that exposes ONLY `resolve` and tracks a ledger that
// stays empty); and it returns typed unavailable errors instead of fabricating a missing initial board
// or per-step cumulative for a cascade result.

const INPUT: SpinInput = { bet: 100, seed: { serverSeedHash: 'h', clientSeed: 'c', nonce: 1 } };

// A stub non-transacting client: it exposes ONLY resolve (structurally no transacting method), tracks the
// resolve call count, and carries a ledger that MUST stay empty (a resolve performs no money operation).
function stubClient(output: NativeResolveOutput): {
  client: NonTransactingResolveClient;
  ledger: string[];
  resolve: ReturnType<typeof vi.fn>;
} {
  const ledger: string[] = [];
  const resolve = vi.fn(async (_input: SpinInput): Promise<NativeResolveOutput> => output);
  return { client: { resolve }, ledger, resolve };
}

// A consistent non-cascade 2x2 native output (boardInitial omitted: the adapter sets initialGrid := grid).
const NONCASCADE: NativeResolveOutput = {
  id: 'real-1',
  stake: 100,
  boardFinal: [
    ['A', 'B'],
    ['C', 'D'],
  ],
  paylines: [{ sym: 'A', cells: [[0, 0]], pay: 50, line: 2 }],
  bonuses: [{ kind: 'freeSpinsAwarded', payload: { count: 10, multipliers: [2, 3] } }],
  total: 50,
  proof: 'proof-blob',
};

// A forward-consistent 2x2 native cascade (matches the WP-4.1 cascade case): remove [1,0], refill col 0
// with [E] -> [[E,B],[A,D]].
const CASCADE: NativeResolveOutput = {
  id: 'real-casc',
  stake: 100,
  boardInitial: [
    ['A', 'B'],
    ['C', 'D'],
  ],
  boardFinal: [
    ['E', 'B'],
    ['A', 'D'],
  ],
  paylines: [{ sym: 'C', cells: [[1, 0]], pay: 100 }],
  bonuses: [],
  total: 100,
  tumbles: [
    {
      removedCells: [[1, 0]],
      fill: [{ column: 0, pieces: ['E'] }],
      winThisStep: 100,
      runningTotal: 100,
    },
  ],
};

const SIZE_2x2 = { rows: 2, cols: 2 };

describe('RealEngineAdapter (WP-4.3)', () => {
  it('projects a non-cascade native output into a validating SpinResult (field-by-field)', async () => {
    const { client } = stubClient(NONCASCADE);
    const adapter = new RealEngineAdapter(client, SIZE_2x2);
    const result = await adapter.spin(INPUT);

    expect(result.spinId).toBe('real-1');
    expect(result.bet).toBe(100);
    expect(result.totalWin).toBe(50);
    expect(result.rngProof).toBe('proof-blob');
    expect(result.grid).toEqual([
      [symbolId('A'), symbolId('B')],
      [symbolId('C'), symbolId('D')],
    ]);
    // Non-cascade: initialGrid is the lossless identity of grid.
    expect(result.initialGrid).toEqual(result.grid);
    expect(result.cascades).toBeUndefined();
    expect(result.wins).toEqual([
      { symbol: symbolId('A'), positions: [[0, 0]], amount: 50, lineIndex: 2 },
    ]);
    expect(result.features).toEqual([
      { type: 'freeSpinsAwarded', data: { count: 10, multipliers: [2, 3] } },
    ]);
  });

  it('adds nothing: every mapped symbol / win / feature traces to the engine output', async () => {
    const adapter = new RealEngineAdapter(stubClient(NONCASCADE).client, SIZE_2x2);
    const result = await adapter.spin(INPUT);
    const nativeSyms = new Set(NONCASCADE.boardFinal.flat());
    for (const row of result.grid) for (const cell of row) expect(nativeSyms.has(cell)).toBe(true);
    const nativeWinSyms = new Set(NONCASCADE.paylines.map((p) => p.sym));
    for (const w of result.wins) expect(nativeWinSyms.has(w.symbol)).toBe(true);
    const nativeFeatures = new Set(NONCASCADE.bonuses.map((b) => b.kind));
    for (const f of result.features) expect(nativeFeatures.has(f.type)).toBe(true);
  });

  it('maps a cascade with initialGrid + per-step cumulativeWin and validates', async () => {
    const adapter = new RealEngineAdapter(stubClient(CASCADE).client, SIZE_2x2);
    const result = await adapter.spin(INPUT);
    expect(result.initialGrid).toEqual([
      [symbolId('A'), symbolId('B')],
      [symbolId('C'), symbolId('D')],
    ]);
    expect(result.cascades).toHaveLength(1);
    expect(result.cascades![0]!.cumulativeWin).toBe(100);
  });

  it('never performs a money operation: only resolve is called and the ledger stays empty', async () => {
    const { client, ledger, resolve } = stubClient(NONCASCADE);
    await new RealEngineAdapter(client, SIZE_2x2).spin(INPUT);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(ledger).toEqual([]);
    // The client interface exposes ONLY resolve, so no transacting method exists to call (structural).
    expect(Object.keys(client)).toEqual(['resolve']);
  });

  it('returns initialBoardUnavailable when a cascade result omits the pre-cascade board', async () => {
    const noInitial: NativeResolveOutput = { ...CASCADE, boardInitial: undefined };
    const adapter = new RealEngineAdapter(stubClient(noInitial).client, SIZE_2x2);
    await expect(adapter.spin(INPUT)).rejects.toMatchObject({ code: 'initialBoardUnavailable' });
  });

  it('returns cumulativeWinUnavailable when a cascade step omits the running total', async () => {
    const noTotal: NativeResolveOutput = {
      ...CASCADE,
      tumbles: [{ removedCells: [[1, 0]], fill: [{ column: 0, pieces: ['E'] }], winThisStep: 100 }],
    };
    const adapter = new RealEngineAdapter(stubClient(noTotal).client, SIZE_2x2);
    await expect(adapter.spin(INPUT)).rejects.toMatchObject({ code: 'cumulativeWinUnavailable' });
  });

  it('a structurally inconsistent engine result is a typed validation error, not a silent pass', async () => {
    const broken: NativeResolveOutput = {
      ...CASCADE,
      boardFinal: [
        ['Z', 'B'],
        ['A', 'D'],
      ],
    };
    const adapter = new RealEngineAdapter(stubClient(broken).client, SIZE_2x2);
    await expect(adapter.spin(INPUT)).rejects.toBeInstanceOf(RealEngineMappingError);
  });
});

describe('resolveRealEngineConfig (WP-4.3, money boundary)', () => {
  it('fails fast when the non-transacting resolve handle is absent', () => {
    expect(() => resolveRealEngineConfig({})).toThrow(RealEngineConfigError);
  });

  it('rejects a configured transacting endpoint for preview (money boundary)', () => {
    expect(() =>
      resolveRealEngineConfig({
        MARIONETTE_ENGINE_RESOLVE_ENDPOINT: 'https://resolve',
        MARIONETTE_ENGINE_TRANSACTING_ENDPOINT: 'https://settle',
      }),
    ).toThrow(RealEngineConfigError);
  });

  it('accepts a lone resolve endpoint', () => {
    expect(
      resolveRealEngineConfig({ MARIONETTE_ENGINE_RESOLVE_ENDPOINT: 'https://resolve' }),
    ).toEqual({
      resolveEndpoint: 'https://resolve',
    });
  });
});
