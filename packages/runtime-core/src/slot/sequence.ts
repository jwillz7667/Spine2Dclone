// The SlotPresentationSequencer CORE (phase-4 section 5.4, WP-4.7): the pure, deterministic function
// `sequence(result, scene) -> PresentationTimeline`. THIS IS THE DETERMINISM BOUNDARY (LAW 1): the full
// visual presentation is a pure function of a SpinResult from the certified engine plus the authored
// SlotScene; the same inputs ALWAYS yield a deep-equal timeline, every time, on every runtime.
//
// runtime-core/slot is PixiJS-free, clock-free, RNG-free: this function reads only `result` (engine
// outcome VALUE TYPES) and `scene` (authored config). It NEVER reads a clock or RNG, NEVER decides a
// symbol or a payout, and has no channel back to the engine. The near-miss temptation is rejected by
// construction (section 10.4): anticipation is computed strictly from `result.initialGrid` plus the fixed
// left-to-right stop order; nothing here can synthesize a tease the result does not imply.
//
// WP-4.7 EMITS only the landing + anticipation directives. Win / feature-flow / cascade / escalation
// emission (construction-order stages 3 to 6, section 5.4.1) is added by WP-4.8/4.9/4.10 as additional
// `emit*` stages between the marked seams below; each new stage appends to the SAME builder before the
// single sort, so `seq` stays globally monotonic and the comparator stays total across all stages.

import type { SpinResult } from '@marionette/math-bridge/types';
import type { SlotScene } from '@marionette/format/slot-types';
import type { PresentationDirective, PresentationTimeline } from './timeline';

// A directive without its `seq`: the builder assigns `seq` at push time in construction order, so the
// caller never picks a `seq` by hand (which would risk a duplicate and break comparator totality). The
// Omit is DISTRIBUTED over the union (`T extends unknown ? Omit<T, 'seq'> : never`) so each member keeps
// its own `kind`-correlated fields rather than collapsing to the shared keys; the generic `push` below
// re-pairs a single member draft with its `seq` to reconstruct that exact member.
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
type DirectiveDraft = DistributiveOmit<PresentationDirective, 'seq'>;

// The emission builder: accumulates directives in construction order, assigning each a globally unique
// 0-based monotonic `seq` at push time. After all stages have pushed, `build()` sorts the array by the
// TWO-KEY total comparator (atMs asc, seq asc) (NO KIND_PRIORITY key, section 5.4.1) and returns it.
// Because `seq` is globally unique, the comparator never returns 0 for distinct directives, so a
// non-stable runtime sort (C# List.Sort, Godot) produces the identical order.
class DirectiveBuilder {
  private readonly directives: PresentationDirective[] = [];
  private nextSeq = 0;

  // Push one directive, stamping the next `seq`. The generic `D` binds to a SINGLE union member draft
  // (inferred from the call-site object literal), so `D & { seq: number }` reconstructs exactly that
  // member with its `kind`-correlated fields intact (no discriminated-union widening, no assertion).
  push<D extends DirectiveDraft>(draft: D): void {
    const seq = this.nextSeq;
    this.nextSeq += 1;
    const directive: D & { seq: number } = { ...draft, seq };
    this.directives.push(directive);
  }

  // Sort the accumulated directives by the two-key total comparator and return the frozen result. The
  // sort is on a COPY-IN-PLACE of the internal array; the builder is single-use per `sequence` call.
  build(): readonly PresentationDirective[] {
    this.directives.sort(compareDirectives);
    return this.directives;
  }
}

// The provably-total directive comparator (phase-4 section 5.4.1): TWO keys only, (atMs asc, seq asc).
// There is NO third KIND_PRIORITY key. Because `seq` is globally unique across all emission stages, the
// second key alone decides every same-atMs tie, so the comparator never returns 0 for two distinct
// directives and the ordering is independent of the sort algorithm's stability (Phase 5 portability).
// Exported (NOT via the barrel) so the comparator-totality test can prove a shuffled pre-sort array
// sorts to the identical output; the public slot/runtime-core API stays just `sequence`.
export function compareDirectives(a: PresentationDirective, b: PresentationDirective): number {
  if (a.atMs !== b.atMs) return a.atMs - b.atMs;
  return a.seq - b.seq;
}

// Landing phase (TASK-4.7.1, construction-order stage 1). Per column LEFT-TO-RIGHT, per row
// TOP-TO-BOTTOM: emit `reelStop` (once, before the column's cells), then for each cell `symbolLand`
// followed by `symbolAnimate(idle)`. Every directive in column c shares atMs = c * reelStopStaggerMs; the
// order among same-atMs directives is decided entirely by `seq` (the push order here). Placement is the
// engine's: `symbolLand`/idle read `result.initialGrid[row][col]` (for a non-cascade spin
// initialGrid === grid, so this is also the final board). `scene.symbols` is touched by KEYED LOOKUP only
// further down (the anticipation set check); landing does not iterate the symbols Record.
function emitLanding(
  builder: DirectiveBuilder,
  result: SpinResult,
  staggerMs: number,
  rows: number,
  cols: number,
): void {
  for (let col = 0; col < cols; col += 1) {
    const atMs = col * staggerMs;
    builder.push({ kind: 'reelStop', col, atMs });
    for (let row = 0; row < rows; row += 1) {
      const symbol = result.initialGrid[row]![col]!;
      builder.push({ kind: 'symbolLand', row, col, symbol, atMs });
      builder.push({ kind: 'symbolAnimate', row, col, set: 'idle', atMs });
    }
  }
}

// Anticipation phase (TASK-4.7.2, construction-order stage 2, section 10.4). PURELY a function of
// `result.initialGrid` and `scene.grid.anticipation`. Walk columns LEFT-TO-RIGHT in stop order; after
// each column stops, count the `triggerSymbols` that have landed in ALREADY-STOPPED columns (columns 0..c
// inclusive, since column c has just stopped). The FIRST time the running count reaches `thresholdCount`,
// emit `symbolAnimate(anticipation)` for the next `maxAnticipatingCols` NOT-YET-STOPPED columns
// (c+1, c+2, ...), one anticipation directive per anticipating column, left-to-right. Each anticipating
// column's directive uses THAT column's reelStop atMs (col * staggerMs), so the anticipation animation
// starts as that reel is about to stop. The emission happens once (a crossed flag), so no column gets a
// duplicate anticipation directive. There is NO randomness and NO tease the result does not imply.
function emitAnticipation(
  builder: DirectiveBuilder,
  result: SpinResult,
  scene: SlotScene,
  staggerMs: number,
  rows: number,
  cols: number,
): void {
  const { triggerSymbols, thresholdCount, maxAnticipatingCols } = scene.grid.anticipation;
  // A non-positive threshold or empty trigger vocabulary cannot anticipate (the validator enforces
  // thresholdCount >= 1 and a non-empty vocabulary, but the core stays defensive and deterministic).
  if (thresholdCount < 1 || triggerSymbols.length === 0 || maxAnticipatingCols < 1) return;
  // Trigger-symbol membership by KEYED set (iteration guard, section 5.4.1): the lookup is order-free, so
  // the directive output cannot depend on any Record / array iteration order downstream.
  const triggers = new Set<string>(triggerSymbols);

  let landedTriggers = 0;
  let crossed = false;
  for (let col = 0; col < cols && !crossed; col += 1) {
    // Count trigger symbols in the column that just stopped (column c), adding to already-stopped columns.
    for (let row = 0; row < rows; row += 1) {
      if (triggers.has(result.initialGrid[row]![col]!)) landedTriggers += 1;
    }
    if (landedTriggers < thresholdCount) continue;
    // Threshold crossed: anticipate the next not-yet-stopped columns, capped by maxAnticipatingCols and
    // by the grid edge. col + 1 is the first not-yet-stopped column.
    crossed = true;
    const lastCol = Math.min(cols - 1, col + maxAnticipatingCols);
    for (let antCol = col + 1; antCol <= lastCol; antCol += 1) {
      const atMs = antCol * staggerMs;
      for (let row = 0; row < rows; row += 1) {
        builder.push({ kind: 'symbolAnimate', row, col: antCol, set: 'anticipation', atMs });
      }
    }
  }
}

// The single public entry (TASK-4.7.7). `sequence(result, scene)` is referentially transparent (LAW 1):
// it allocates one builder, runs the emission stages in construction order, sorts once, and returns the
// timeline. `durationMs` is the max atMs across emitted directives (or 0 if none), an integer. The editor
// preview (passing a snapshot projection) and runtime-web (passing the validated scene) call THIS exact
// symbol: one code path, no second sequencer.
export function sequence(result: SpinResult, scene: SlotScene): PresentationTimeline {
  const { rows, cols, reelStopStaggerMs } = scene.grid;
  const builder = new DirectiveBuilder();

  // Stage 1: landing (reelStop + symbolLand + symbolAnimate(idle)).
  emitLanding(builder, result, reelStopStaggerMs, rows, cols);
  // Stage 2: anticipation (symbolAnimate(anticipation) for anticipating columns).
  emitAnticipation(builder, result, scene, reelStopStaggerMs, rows, cols);
  // SEAM: WP-4.8 win sequence (stage 3), WP-4.9 feature flow (stage 4), WP-4.10 cascades (stage 5), and
  // win-tier escalation (stage 6) push their directives HERE, before the single build()/sort. Each new
  // stage appends to the same builder so `seq` remains globally monotonic and the comparator stays total.

  const directives = builder.build();
  let durationMs = 0;
  for (let i = 0; i < directives.length; i += 1) {
    const atMs = directives[i]!.atMs;
    if (atMs > durationMs) durationMs = atMs;
  }
  return { spinId: result.spinId, durationMs, directives };
}
