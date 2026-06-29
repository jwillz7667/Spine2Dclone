import { symbolId } from '@marionette/format/slot';
import type { SymbolId } from '@marionette/format/slot';
import type {
  CascadeStep,
  FeatureEvent,
  MathEngine,
  SpinInput,
  SpinResult,
  WinLine,
} from '../types';
import { validateSpinResult } from '../validate';
import type { GridSize } from '../validate';
import type { NonTransactingResolveClient } from './client';
import type { NativeResolveOutput } from './native';

// RealEngineAdapter (phase-4 WP-4.3): the thin adapter mapping the certified engine's NON-TRANSACTING
// resolve output into a SpinResult, behind the same MathEngine interface, isolated under
// math-bridge/src/real/ so runtime-core never imports it (the boundary lint already bans
// @marionette/math-bridge/* from runtime-core; WP-4.7 carves out value-type imports for the sequencer but
// NEVER /real). The mapping is a PURE PROJECTION: it adds no symbol, win, or feature not present in the
// engine output (LAW 1, never alters an outcome). The mapped result is validated on receipt (LAW 3); a
// malformed or structurally inconsistent engine result is a typed error, not a silent pass.

export type RealAdapterErrorCode =
  | 'initialBoardUnavailable'
  | 'cumulativeWinUnavailable'
  | 'validation';

export class RealEngineMappingError extends Error {
  constructor(
    readonly code: RealAdapterErrorCode,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'RealEngineMappingError';
  }
}

// Translate a native symbol code to a canonical SymbolId. The optional map lets a model rename its codes;
// the default is identity. symbolId() is the single sanctioned brand point (no `as` here).
export type SymbolMap = (nativeSymbol: string) => string;

function mapBoard(board: readonly (readonly string[])[], map: SymbolMap): SymbolId[][] {
  return board.map((row) => row.map((s) => symbolId(map(s))));
}

function mapFeature(bonus: NativeResolveOutput['bonuses'][number]): FeatureEvent {
  // Copy array payload values to mutable arrays (the boundary type is a mutable number[]); scalars pass
  // through. No outcome is invented: every field traces to the engine bonus payload.
  const data: Record<string, number | string | boolean | number[]> = {};
  for (const [key, value] of Object.entries(bonus.payload)) {
    // A readonly number[] is the only object-typed payload value; copy it to a mutable array. Scalars
    // (string / number / boolean) pass through. Array.isArray cannot narrow a readonly array, so the
    // narrowing is by typeof.
    data[key] = typeof value === 'object' ? [...value] : value;
  }
  return { type: bonus.kind, data };
}

export class RealEngineAdapter implements MathEngine {
  private readonly client: NonTransactingResolveClient;
  private readonly gridSize: GridSize;
  private readonly symbolMap: SymbolMap;

  constructor(
    client: NonTransactingResolveClient,
    gridSize: GridSize,
    symbolMap: SymbolMap = (s) => s,
  ) {
    this.client = client;
    this.gridSize = gridSize;
    this.symbolMap = symbolMap;
  }

  // Resolve a spin (non-transacting), map the native output to a SpinResult, and validate it. Throws a
  // RealEngineMappingError for an unavailable initial board / cumulative or a validation failure.
  async spin(input: SpinInput): Promise<SpinResult> {
    const native = await this.client.resolve(input);
    const mapped = this.project(native);
    const validated = validateSpinResult(mapped, this.gridSize);
    if (!validated.ok) {
      throw new RealEngineMappingError(
        'validation',
        `mapped engine result failed validation: ${validated.error.code} at ${validated.error.path}`,
        validated.error,
      );
    }
    return validated.value;
  }

  // Pure projection of the native output into a SpinResult (no synthesized outcome).
  private project(native: NativeResolveOutput): SpinResult {
    const grid = mapBoard(native.boardFinal, this.symbolMap);
    const tumbles = native.tumbles ?? [];

    let initialGrid: SymbolId[][];
    let cascades: CascadeStep[] | undefined;
    if (tumbles.length > 0) {
      // A genuine cascade: the engine MUST expose the pre-cascade board and a per-step running total.
      // The adapter never fabricates either (phase-4 section 5.5/5.6).
      if (native.boardInitial === undefined) {
        throw new RealEngineMappingError(
          'initialBoardUnavailable',
          'cascade result has no pre-cascade board (boardInitial); the adapter does not fabricate it.',
        );
      }
      initialGrid = mapBoard(native.boardInitial, this.symbolMap);
      cascades = tumbles.map((t, i) => {
        if (t.runningTotal === undefined) {
          throw new RealEngineMappingError(
            'cumulativeWinUnavailable',
            `cascade step ${i} has no authoritative running total (runningTotal); the adapter does not fabricate it.`,
          );
        }
        const step: CascadeStep = {
          removed: t.removedCells.map((c) => [c[0], c[1]]),
          refill: t.fill.map((f) => ({
            col: f.column,
            symbols: f.pieces.map((p) => symbolId(this.symbolMap(p))),
          })),
          stepWin: t.winThisStep,
          cumulativeWin: t.runningTotal,
        };
        return step;
      });
    } else {
      // Non-cascade: the board that lands IS the final board (lossless identity, section 5.5).
      initialGrid = grid.map((r) => r.slice());
      cascades = undefined;
    }

    const wins: WinLine[] = native.paylines.map((p) => {
      const win: WinLine = {
        symbol: symbolId(this.symbolMap(p.sym)),
        positions: p.cells.map((c) => [c[0], c[1]]),
        amount: p.pay,
        ...(p.line === undefined ? {} : { lineIndex: p.line }),
      };
      return win;
    });

    const result: SpinResult = {
      spinId: native.id,
      bet: native.stake,
      initialGrid,
      grid,
      wins,
      totalWin: native.total,
      features: native.bonuses.map(mapFeature),
      ...(cascades === undefined ? {} : { cascades }),
      ...(native.proof === undefined ? {} : { rngProof: native.proof }),
    };
    return result;
  }
}
