import type { SymbolId } from '@marionette/format/slot';
import { spinResultSchema } from './schema';
import type { CascadeStep, SpinResult } from './types';

// validateSpinResult (phase-4 WP-4.1 TASK-4.1.3/4.1.4): validate engine output ON RECEIPT (LAW 3, fail
// loudly), returning a discriminated Result, never throwing for an expected malformation and never
// returning null. The checks are split so `totalWin` stays AUTHORITATIVE (LAW 1: presentation does not
// re-check the engine's money arithmetic):
//   - shape / closed unions / finiteness / bounds (gates receipt),
//   - STRUCTURAL placement check: forward-apply `cascades` to `initialGrid` under column-down gravity
//     (phase-4 section 5.5.1) and assert the result deep-equals `grid` (non-cascade: initialGrid === grid),
//   - STRUCTURAL rollup check: `cascades[last].cumulativeWin === totalWin` and non-decreasing cumulative.
// It NEVER sums `stepWin`, NEVER recomputes amounts, and the default build performs NO `totalWin` sum
// check (a real engine legitimately differs from a naive sum because of global multipliers).

export interface GridSize {
  readonly rows: number;
  readonly cols: number;
}

export type MathBridgeErrorCode =
  | 'schema'
  | 'dimensionMismatch'
  | 'outOfBounds'
  | 'nonCascadeBoardMismatch'
  | 'cascadeInconsistent'
  | 'cumulativeInconsistent';

// A typed boundary error carrying a JSON path (never a bare string). `stepIndex` is present for the
// cascade-structural failures so a malformed cascade points at the failing step.
export interface MathBridgeError {
  readonly code: MathBridgeErrorCode;
  readonly path: string;
  readonly message: string;
  readonly stepIndex?: number;
}

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}
function err(error: MathBridgeError): Result<never, MathBridgeError> {
  return { ok: false, error };
}

// True iff `board` is exactly `rows` x `cols`.
function isRectangular(
  board: readonly (readonly SymbolId[])[],
  rows: number,
  cols: number,
): boolean {
  if (board.length !== rows) return false;
  for (const row of board) if (row.length !== cols) return false;
  return true;
}

function boardsEqual(
  a: readonly (readonly SymbolId[])[],
  b: readonly (readonly SymbolId[])[],
): boolean {
  if (a.length !== b.length) return false;
  for (let r = 0; r < a.length; r += 1) {
    const ra = a[r]!;
    const rb = b[r]!;
    if (ra.length !== rb.length) return false;
    for (let c = 0; c < ra.length; c += 1) if (ra[c] !== rb[c]) return false;
  }
  return true;
}

// One forward cascade step under column-down gravity (phase-4 section 5.5.1): remove the cells at
// `removed`, let survivors fall to the lowest cells preserving relative vertical order, and refill the
// now-empty top cells from `refill[col].symbols` top-down. Returns the next board, or null if the refill
// count for any column does not exactly fill its emptied cells (a structurally inconsistent step).
// Exported so scenario authoring (WP-4.2) can derive a guaranteed-consistent final board from an
// initialGrid plus steps, using the SAME rule the validator checks against (one forward rule, no drift).
export function forwardColumnDownStep(
  board: readonly (readonly SymbolId[])[],
  step: CascadeStep,
  rows: number,
  cols: number,
): SymbolId[][] | null {
  const removed = new Set<number>();
  for (const [r, c] of step.removed) removed.add(r * cols + c);
  const refillByCol = new Map<number, readonly SymbolId[]>();
  for (const rf of step.refill) refillByCol.set(rf.col, rf.symbols);

  const next: SymbolId[][] = Array.from({ length: rows }, () => new Array<SymbolId>(cols));
  for (let c = 0; c < cols; c += 1) {
    const survivors: SymbolId[] = [];
    for (let r = 0; r < rows; r += 1) {
      if (!removed.has(r * cols + c)) survivors.push(board[r]![c]!);
    }
    const emptyCount = rows - survivors.length;
    const refill = refillByCol.get(c) ?? [];
    if (refill.length !== emptyCount) return null;
    // Top-to-bottom: refill (top-down) then survivors (preserving their top-to-bottom order, so they
    // occupy the lowest cells in their original relative order).
    const column = [...refill, ...survivors];
    for (let r = 0; r < rows; r += 1) next[r]![c] = column[r]!;
  }
  return next;
}

// Validate a parsed-or-raw engine output against the boundary contract for a concrete grid size.
export function validateSpinResult(
  input: unknown,
  gridSize: GridSize,
): Result<SpinResult, MathBridgeError> {
  const { rows, cols } = gridSize;

  // 1. Shape (closed unions, finiteness, integrality). A failure carries the zod path.
  const parsed = spinResultSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    return err({
      code: 'schema',
      path: `/${issue.path.join('/')}`,
      message: issue.message,
    });
  }
  const result = parsed.data;

  // 2. Board dimensions: initialGrid and grid are each rows x cols and equal in shape.
  if (!isRectangular(result.initialGrid, rows, cols)) {
    return err({
      code: 'dimensionMismatch',
      path: '/initialGrid',
      message: `initialGrid is not ${rows}x${cols}`,
    });
  }
  if (!isRectangular(result.grid, rows, cols)) {
    return err({
      code: 'dimensionMismatch',
      path: '/grid',
      message: `grid is not ${rows}x${cols}`,
    });
  }

  // 3. Bounds: win positions, removed cells, and refill columns within the grid.
  for (let w = 0; w < result.wins.length; w += 1) {
    const win = result.wins[w]!;
    for (let p = 0; p < win.positions.length; p += 1) {
      const [r, c] = win.positions[p]!;
      if (r >= rows || c >= cols) {
        return err({
          code: 'outOfBounds',
          path: `/wins/${w}/positions/${p}`,
          message: `cell [${r},${c}] outside ${rows}x${cols}`,
        });
      }
    }
  }
  const cascades = result.cascades ?? [];
  for (let s = 0; s < cascades.length; s += 1) {
    const step = cascades[s]!;
    for (let p = 0; p < step.removed.length; p += 1) {
      const [r, c] = step.removed[p]!;
      if (r >= rows || c >= cols) {
        return err({
          code: 'outOfBounds',
          path: `/cascades/${s}/removed/${p}`,
          message: `cell [${r},${c}] outside ${rows}x${cols}`,
          stepIndex: s,
        });
      }
    }
    for (let f = 0; f < step.refill.length; f += 1) {
      if (step.refill[f]!.col >= cols) {
        return err({
          code: 'outOfBounds',
          path: `/cascades/${s}/refill/${f}/col`,
          message: `refill col ${step.refill[f]!.col} outside ${cols}`,
          stepIndex: s,
        });
      }
    }
  }

  // 4. Structural placement check (phase-4 section 5.5).
  if (cascades.length === 0) {
    // Non-cascade: the board that lands IS the final board (lossless identity).
    if (!boardsEqual(result.initialGrid, result.grid)) {
      return err({
        code: 'nonCascadeBoardMismatch',
        path: '/initialGrid',
        message: 'non-cascade result has initialGrid !== grid',
      });
    }
  } else {
    let board: readonly (readonly SymbolId[])[] = result.initialGrid;
    for (let s = 0; s < cascades.length; s += 1) {
      const next = forwardColumnDownStep(board, cascades[s]!, rows, cols);
      if (next === null) {
        return err({
          code: 'cascadeInconsistent',
          path: `/cascades/${s}`,
          message: `cascade step ${s} refill does not fill the emptied cells`,
          stepIndex: s,
        });
      }
      board = next;
    }
    if (!boardsEqual(board, result.grid)) {
      return err({
        code: 'cascadeInconsistent',
        path: '/grid',
        message: 'forward-applied cascades do not reach grid',
        stepIndex: cascades.length - 1,
      });
    }

    // 5. Structural rollup check (not a money check): non-decreasing cumulative ending on totalWin.
    let prev = 0;
    for (let s = 0; s < cascades.length; s += 1) {
      const cumulative = cascades[s]!.cumulativeWin;
      if (cumulative < prev) {
        return err({
          code: 'cumulativeInconsistent',
          path: `/cascades/${s}/cumulativeWin`,
          message: `cumulativeWin decreased at step ${s}`,
          stepIndex: s,
        });
      }
      prev = cumulative;
    }
    if (prev !== result.totalWin) {
      return err({
        code: 'cumulativeInconsistent',
        path: `/cascades/${cascades.length - 1}/cumulativeWin`,
        message: `cascades[last].cumulativeWin (${prev}) !== totalWin (${result.totalWin})`,
      });
    }
  }

  return ok(result);
}
