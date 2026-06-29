// The cascade DROP SOLVER (phase-4 section 5.5.1, WP-4.10 TASK-4.10.4): a PURE, deterministic
// column-down gravity resolver. Given the current forward board, one CascadeStep's `removed` cells, and
// that step's `refill`, it produces (a) the ordered `SymbolMove[]` the renderer tweens for the surviving
// symbols that change row, and (b) the resulting NEXT board so the cascade stage can chain steps.
//
// This reimplements EXACTLY the column-down rule the math-bridge validator (`forwardColumnDownStep`)
// checks forward-consistency with, but it produces the MOVE LIST the renderer needs (the validator
// produces only the final board). It deliberately does NOT import the math-bridge internal forward
// (runtime-core depends only on `format`): the rule is small and re-stated here, and a WP-4.10 test
// asserts the next board this solver returns, chained across all steps, equals `SpinResult.grid` (the
// same structural fact the validator already enforces on receipt).
//
// runtime-core/slot is PixiJS-free, clock-free, RNG-free (LAW 1 / INV): this reads only its arguments
// (a board value + the engine's removed/refill VALUE TYPES) and never decides an outcome.
//
// THE DOCUMENTED COLUMN-DOWN RULE (section 5.5.1), per column independently:
//   1. Remove the cells named in `removed` for this column.
//   2. The SURVIVORS (the cells NOT removed) fall straight down, preserving their relative TOP-TO-BOTTOM
//      order, so they occupy the LOWEST cells of the column. A column with `e` removed cells has its `e`
//      lowest cells freed for survivors to compress into and its `e` top cells freed for refills.
//   3. The `e` now-empty TOP cells are filled from `refill[col].symbols` TOP-DOWN (index 0 at row 0).
//
// THE MOVE-EMISSION CONVENTION (documented, consistent): a move is emitted for a SURVIVOR whose row
// CHANGES only. A survivor whose destination row equals its source row (it did not fall) emits NO move,
// so the move list is exactly the set of visible slides the renderer tweens. REFILLS are never moves
// (they are NEW symbols entering from the top, emitted by the stage via `cascadeRefill`, not here). The
// move list is deterministic and stable: columns are walked LEFT-TO-RIGHT and, within a column, survivors
// TOP-TO-BOTTOM, so the same step always yields the byte-identical move list.

import type { SymbolId } from '@marionette/format/slot-types';
import type { GridCell, SymbolMove } from './timeline';

// The result of solving one cascade step: the survivor moves (row changed) and the next forward board.
export interface DropStepResult {
  readonly moves: readonly SymbolMove[];
  readonly board: readonly (readonly SymbolId[])[];
}

// One column's refill symbols, addressed by the engine's `CascadeStep.refill` shape (col + symbols).
interface ColumnRefill {
  readonly col: number;
  readonly symbols: readonly SymbolId[];
}

// Solve one cascade step under column-down gravity (the documented section 5.5.1 rule). Returns the
// ordered survivor moves and the next board. Throws on a structurally inconsistent step (a refill count
// that does not exactly fill the emptied cells): the engine output is validated on receipt (WP-4.1), so a
// mismatch here is a fail-loud LAW 3 backstop, never a silently-wrong board. `removed` and `refill` are
// the step's engine VALUE TYPES; `rows`/`cols` are the authored grid dims.
export function solveCascadeStep(
  board: readonly (readonly SymbolId[])[],
  removed: readonly (readonly [number, number])[],
  refill: readonly ColumnRefill[],
  rows: number,
  cols: number,
): DropStepResult {
  // Removed-cell membership by a (row*cols + col) key (order-free; a column scan below decides ordering).
  const removedKeys = new Set<number>();
  for (const [r, c] of removed) removedKeys.add(r * cols + c);
  // Refill symbols keyed by column (a keyed lookup, never an iteration that affects output order).
  const refillByCol = new Map<number, readonly SymbolId[]>();
  for (const rf of refill) refillByCol.set(rf.col, rf.symbols);

  const moves: SymbolMove[] = [];
  const next: SymbolId[][] = Array.from({ length: rows }, () => new Array<SymbolId>(cols));

  // Columns LEFT-TO-RIGHT (stable move order key 1).
  for (let c = 0; c < cols; c += 1) {
    // Survivors in TOP-TO-BOTTOM order (their relative vertical order is preserved on the way down).
    const survivors: { row: number; symbol: SymbolId }[] = [];
    for (let r = 0; r < rows; r += 1) {
      if (!removedKeys.has(r * cols + c)) survivors.push({ row: r, symbol: board[r]![c]! });
    }
    const emptyCount = rows - survivors.length;
    const colRefill = refillByCol.get(c) ?? [];
    if (colRefill.length !== emptyCount) {
      throw new Error(
        `cascade step column ${c}: refill count ${colRefill.length} does not fill ${emptyCount} emptied cells`,
      );
    }

    // Refills occupy the top `emptyCount` rows, TOP-DOWN in refill order (index 0 at row 0). Refills are
    // NEW symbols (emitted via cascadeRefill by the stage), so they produce NO move here.
    for (let i = 0; i < emptyCount; i += 1) next[i]![c] = colRefill[i]!;

    // Survivors compress into the lowest cells, preserving their top-to-bottom order: the j-th survivor
    // (top-to-bottom) lands at row emptyCount + j. A survivor whose destination row differs from its
    // source row emits a move (TOP-TO-BOTTOM survivor order is stable move key 2).
    for (let j = 0; j < survivors.length; j += 1) {
      const survivor = survivors[j]!;
      const toRow = emptyCount + j;
      next[toRow]![c] = survivor.symbol;
      if (toRow !== survivor.row) {
        const from: GridCell = { row: survivor.row, col: c };
        const to: GridCell = { row: toRow, col: c };
        moves.push({ from, to, symbol: survivor.symbol });
      }
    }
  }

  return { moves, board: next };
}
