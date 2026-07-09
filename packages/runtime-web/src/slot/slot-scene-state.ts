import type { PresentationDirective, SymbolAnimSlot } from '@marionette/runtime-core';
import type { SymbolId } from '@marionette/format/slot-types';

// The pure board-state reducer for the slot scene (phase-4 WP-4.11 / PP-C4). The SlotSceneView advances
// the allocation-free timeline cursor and hands each fired directive here; this module folds the
// board-affecting directives (reel stops, symbol landings, per-symbol animation phase, and the cascade
// explode / drop / refill moves) into a flat, deep-equal-comparable board state the GL adapter reads to
// place and animate the per-cell symbol skeletons. It also pins the active counter-rollup directive so
// the adapter can compute the displayed integer through the shared rollupValueAt (counter TEXT itself is
// out of GL scope, surfaced via a callback). PixiJS-free and deterministic: the same directive sequence
// always yields the same board state, so it is the CI-verifiable heart of the slot renderer, tested
// without a WebGL context. The event-out directives (vfxBurst, escalation, flow, multiplierOrb) carry no
// board state; the adapter dispatches them to host callbacks and this reducer leaves the board untouched.
//
// Cascade move semantics mirror runtime-core's drop-solver exactly: cascadeExplode empties the named
// cells, cascadeDrop slides survivors (a source not itself a destination is cleared), and cascadeRefill
// fills the emptied TOP cells of a column top-down. So the board this reducer holds after a full cascade
// equals the solver's next board, the same structural fact the WP-4.10 solver test pins.

export type CellPhase = SymbolAnimSlot;

// The flat board state: symbol per cell (null = empty), the animation phase per cell, per-column reel-stop
// flags, and the active counter-rollup directive. All arrays are pre-sized to rows*cols (cells) or cols
// (reels) and reused; resetSlotSceneState clears them in place, so replays allocate nothing after warmup.
export interface SlotSceneState {
  readonly rows: number;
  readonly cols: number;
  readonly symbols: (SymbolId | null)[]; // rows*cols, row-major (idx = row*cols + col)
  readonly phases: CellPhase[]; // rows*cols
  readonly reelStopped: boolean[]; // cols
  activeRollup: Extract<PresentationDirective, { kind: 'counterRollup' }> | null;
}

export function makeSlotSceneState(rows: number, cols: number): SlotSceneState {
  const cells = rows * cols;
  return {
    rows,
    cols,
    symbols: new Array<SymbolId | null>(cells).fill(null),
    phases: new Array<CellPhase>(cells).fill('idle'),
    reelStopped: new Array<boolean>(cols).fill(false),
    activeRollup: null,
  };
}

// Clear the board to empty without reallocating (the pooled-replay contract for a backward seek).
export function resetSlotSceneState(state: SlotSceneState): void {
  state.symbols.fill(null);
  state.phases.fill('idle');
  state.reelStopped.fill(false);
  state.activeRollup = null;
}

// Flat cell index for (row, col) in the row-major board.
export function cellIndex(state: SlotSceneState, row: number, col: number): number {
  return row * state.cols + col;
}

function inBounds(state: SlotSceneState, row: number, col: number): boolean {
  return row >= 0 && row < state.rows && col >= 0 && col < state.cols;
}

// Fold ONE fired directive into the board state (the onFire body the adapter drives). Board-affecting
// kinds mutate the flat arrays in place; the event-out kinds are ignored here (the adapter dispatches them
// to host callbacks). Returns true when the directive changed the board (so the adapter can skip re-laying
// an unchanged frame), false for an event-out / no-op. Allocation-free except the transient move sets a
// cascade drop builds, which are off the per-frame steady-state path (a cascade fires a handful of times).
export function applyDirective(state: SlotSceneState, directive: PresentationDirective): boolean {
  switch (directive.kind) {
    case 'reelStop': {
      if (directive.col < 0 || directive.col >= state.cols) return false;
      state.reelStopped[directive.col] = true;
      return true;
    }
    case 'symbolLand': {
      if (!inBounds(state, directive.row, directive.col)) return false;
      const idx = cellIndex(state, directive.row, directive.col);
      state.symbols[idx] = directive.symbol;
      state.phases[idx] = 'land';
      return true;
    }
    case 'symbolAnimate': {
      if (!inBounds(state, directive.row, directive.col)) return false;
      state.phases[cellIndex(state, directive.row, directive.col)] = directive.set;
      return true;
    }
    case 'counterRollup': {
      state.activeRollup = directive;
      return false; // the rollup value is a HUD callback, not a board change
    }
    case 'cascadeExplode': {
      for (const cell of directive.cells) {
        if (!inBounds(state, cell.row, cell.col)) continue;
        const idx = cellIndex(state, cell.row, cell.col);
        state.symbols[idx] = null;
        state.phases[idx] = 'idle';
      }
      return true;
    }
    case 'cascadeDrop': {
      applyCascadeDrop(state, directive.moves);
      return true;
    }
    case 'cascadeRefill': {
      if (directive.col < 0 || directive.col >= state.cols) return false;
      // Refills occupy the emptied TOP cells of the column, top-down (index 0 at row 0), matching the
      // drop-solver's refill placement.
      for (let i = 0; i < directive.symbols.length; i += 1) {
        if (!inBounds(state, i, directive.col)) break;
        const idx = cellIndex(state, i, directive.col);
        state.symbols[idx] = directive.symbols[i]!;
        state.phases[idx] = 'land';
      }
      return true;
    }
    // Event-out directives: no board state (dispatched to host callbacks by the adapter).
    case 'vfxBurst':
    case 'escalation':
    case 'flowEnter':
    case 'flowExit':
    case 'multiplierOrb':
      return false;
  }
}

// Apply one cascade step's survivor moves: assign every destination, then clear any source cell that is not
// itself a destination of another move (a survivor that vacated its cell). This reproduces the drop-solver
// column-down compression: destinations are written from the move symbols, and a source left behind
// becomes empty until a refill fills it.
function applyCascadeDrop(
  state: SlotSceneState,
  moves: readonly { from: { row: number; col: number }; to: { row: number; col: number }; symbol: SymbolId }[],
): void {
  const destinations = new Set<number>();
  for (const move of moves) {
    if (!inBounds(state, move.to.row, move.to.col)) continue;
    const toIdx = cellIndex(state, move.to.row, move.to.col);
    state.symbols[toIdx] = move.symbol;
    state.phases[toIdx] = 'idle';
    destinations.add(toIdx);
  }
  for (const move of moves) {
    if (!inBounds(state, move.from.row, move.from.col)) continue;
    const fromIdx = cellIndex(state, move.from.row, move.from.col);
    if (!destinations.has(fromIdx)) {
      state.symbols[fromIdx] = null;
      state.phases[fromIdx] = 'idle';
    }
  }
}
