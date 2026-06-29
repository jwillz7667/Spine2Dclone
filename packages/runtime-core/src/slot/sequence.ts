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

import type { SpinResult, WinLine } from '@marionette/math-bridge/types';
import type {
  SlotScene,
  WinSequenceConfig,
  WinSequenceStep,
  EscalationTier,
} from '@marionette/format/slot-types';
import type { PresentationDirective, PresentationTimeline } from './timeline';
import type { CurveType } from './rollup';

// The authored duration of the single line-win counter rollup (WP-4.8 / section 5.4.3). The rollupStart
// step pins the rollup START (its atMs); the rollup END is START + this fixed authored window, so the
// rollup directive's [startMs, endMs] is fully determined by the authored step plus this committed
// constant. A fixed window keeps the cross-runtime golden byte-exact (one number, not a per-step field);
// a future schema field could parameterize it, but the contract today is this constant.
const ROLLUP_AUTHORED_DURATION_MS = 1000;

// The ascending escalation tiers (section 5.4.1 stage 6: escalation is emitted in ascending tier order).
const ESCALATION_TIERS_ASCENDING: readonly EscalationTier[] = ['big', 'mega', 'epic'];

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

// Whether tier `t` is crossed by this spin (TASK-4.8.4, integer-safe). A tier threshold is a totalWin/bet
// MULTIPLE, so the tier is crossed when `totalWin >= threshold * bet`. We compare totalWin against
// threshold*bet rather than dividing totalWin/bet, avoiding any float division (the comparison is exact for
// integer totalWin/bet and an integer/finite threshold). bet is positive (validated on receipt), so the
// multiply is well-defined and monotone in totalWin: lowering totalWin below threshold*bet un-crosses it.
function tierCrossed(
  result: SpinResult,
  thresholds: WinSequenceConfig['thresholds'],
  tier: EscalationTier,
): boolean {
  return result.totalWin >= thresholds[tier] * result.bet;
}

// Deterministically SELECT the win sequence to play (TASK-4.8.3). The selection rule, documented exactly:
//   1. Compute the HIGHEST crossed tier (epic, then mega, then big) where `totalWin >= tier * bet`.
//   2. If a tier is crossed AND a sequence named EXACTLY that tier ('big' | 'mega' | 'epic') exists in
//      `sequences`, select it; otherwise (no tier crossed, or no tier-named sequence) select
//      `defaultSequence`.
//   3. The selected name's steps are walked. If the name does not resolve to a sequence (an authoring gap),
//      the step list is empty (no throw) so the function stays total.
// The selection reads only `totalWin`, `bet`, the threshold table, and the sequence NAMES (a keyed lookup,
// never a Record iteration), so it is order-free and identical on every runtime.
function selectSequenceSteps(
  result: SpinResult,
  config: WinSequenceConfig,
): readonly WinSequenceStep[] {
  let selectedName = config.defaultSequence;
  // Highest crossed tier first: epic, then mega, then big. The first crossed tier that also names a
  // sequence wins; a crossed tier without a matching named sequence falls through to defaultSequence.
  for (let i = ESCALATION_TIERS_ASCENDING.length - 1; i >= 0; i -= 1) {
    const tier = ESCALATION_TIERS_ASCENDING[i]!;
    if (tierCrossed(result, config.thresholds, tier)) {
      if (config.sequences[tier] !== undefined) selectedName = tier;
      break;
    }
  }
  const selected = config.sequences[selectedName];
  return selected ? selected.steps : [];
}

// Resolve a win-sequence step's target rule to the affected cells, returned in (col, row) order (section
// 5.4.1 stage 3: "targets resolved in (col, row) order"). The rules read `result.wins` FIELD NAMES only
// (positions, lineIndex, symbol), never an authored board: allWinningCells unions every win's positions;
// byLine(index) takes the positions of wins whose lineIndex === index; bySymbol(id) takes the positions of
// wins whose symbol === id. `WinLine.positions` are [row, col] tuples (the engine board coordinate). Cells
// are de-duplicated (a cell shared by two wins emits one directive) by a (col,row) key, then sorted
// (col asc, then row asc) so the emission order is a pure function of the inputs.
function resolveTargetCells(
  step: WinSequenceStep,
  wins: readonly WinLine[],
): readonly { readonly row: number; readonly col: number }[] {
  const seen = new Set<string>();
  const cells: { row: number; col: number }[] = [];
  const consider = (win: WinLine): void => {
    for (const [row, col] of win.positions) {
      const key = `${col},${row}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cells.push({ row, col });
    }
  };
  const target = step.target;
  for (const win of wins) {
    if (target.kind === 'allWinningCells') {
      consider(win);
    } else if (target.kind === 'byLine') {
      if (win.lineIndex === target.index) consider(win);
    } else {
      if (win.symbol === target.symbol) consider(win);
    }
  }
  cells.sort((a, b) => (a.col !== b.col ? a.col - b.col : a.row - b.row));
  return cells;
}

// Win sequence phase (TASK-4.8.3, construction-order stage 3, section 5.4.3 LINE-WIN model). Select the
// sequence deterministically, then walk its steps IN AUTHORED ORDER; within a step resolve the target to
// cells in (col, row) order and emit per the action:
//   - animateWin   -> one symbolAnimate(win) per targeted cell (col-major then row).
//   - vfx          -> vfxBurst{preset, anchor}: anchorRule 'eachCell' emits one per targeted cell anchored
//                     {kind:'cell',row,col}; 'gridCenter' emits ONE anchored at the documented grid-center
//                     screen anchor {kind:'screen', x:0, y:0}.
//   - rollupStart  -> the SINGLE counterRollup {fromUnits:0, toUnits:result.totalWin, startMs:atMs,
//                     endMs:atMs+ROLLUP_AUTHORED_DURATION_MS, curve}. Emitted ONLY when result.cascades is
//                     empty/absent (LINE-WIN model); SUPPRESSED for cascade spins (WP-4.10 owns the chain).
//                     The rollup TARGET is always result.totalWin exactly. A second authored rollupStart in
//                     the same sequence would emit a second rollup; the LINE-WIN contract is one rollupStart
//                     per sequence (the authoring panel pins one), and the suppression key is `cascades`.
//   - escalationBanner -> a no-op here. Escalation is driven by the threshold table in STAGE 6
//                     (emitEscalation) so the crossed-tier banners are a pure function of totalWin/bet,
//                     independent of authored step placement; the authored tier is recorded intent only.
// All times are integer ms; all amounts integer base units. The function reads `result.wins`/`totalWin`/
// `bet`/`cascades` and the authored config; it never reads a clock/RNG and never decides an outcome.
function emitWinSequence(builder: DirectiveBuilder, result: SpinResult, scene: SlotScene): void {
  const steps = selectSequenceSteps(result, scene.winSequencer);
  const cascadeSpin = result.cascades !== undefined && result.cascades.length > 0;
  for (const step of steps) {
    const atMs = step.atMs;
    const action = step.action;
    if (action.kind === 'animateWin') {
      const cells = resolveTargetCells(step, result.wins);
      for (const { row, col } of cells) {
        builder.push({ kind: 'symbolAnimate', row, col, set: 'win', atMs });
      }
    } else if (action.kind === 'vfx') {
      if (action.anchorRule === 'eachCell') {
        const cells = resolveTargetCells(step, result.wins);
        for (const { row, col } of cells) {
          builder.push({
            kind: 'vfxBurst',
            preset: action.preset,
            anchor: { kind: 'cell', row, col },
            atMs,
          });
        }
      } else {
        // gridCenter: one burst at the documented grid-center anchor (screen origin {0,0}).
        builder.push({
          kind: 'vfxBurst',
          preset: action.preset,
          anchor: { kind: 'screen', x: 0, y: 0 },
          atMs,
        });
      }
    } else if (action.kind === 'rollupStart') {
      // The single line-win rollup, suppressed for cascade spins (WP-4.10 emits the per-step chain).
      if (!cascadeSpin) {
        const curve: CurveType = action.curve;
        builder.push({
          kind: 'counterRollup',
          fromUnits: 0,
          toUnits: result.totalWin,
          startMs: atMs,
          endMs: atMs + ROLLUP_AUTHORED_DURATION_MS,
          curve,
          atMs,
        });
      }
    }
    // action.kind === 'escalationBanner' is intentionally a no-op (escalation is stage 6, below).
  }
}

// Escalation phase (TASK-4.8.4, construction-order stage 6, section 5.4.1). Emit one `escalation{tier}`
// directive for EACH crossed tier in ASCENDING tier order (big, then mega, then epic), driven PURELY by
// `totalWin/bet` against the threshold table (the engine amount decides the tier; the author decides the
// visuals). This is independent of the authored win-sequence steps: an authored escalationBanner action is
// a no-op, and a crossed tier always emits here even if no step named it. A tier is crossed iff
// `totalWin >= threshold * bet` (integer-safe). All escalation directives share atMs 0 (they are banners
// for the whole spin); their relative order is pinned by `seq` (ascending tier order, the push order here).
function emitEscalation(builder: DirectiveBuilder, result: SpinResult, scene: SlotScene): void {
  const thresholds = scene.winSequencer.thresholds;
  for (const tier of ESCALATION_TIERS_ASCENDING) {
    if (tierCrossed(result, thresholds, tier)) {
      builder.push({ kind: 'escalation', tier, atMs: 0 });
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
  // Stage 3: win sequence (WP-4.8): the selected sequence's animateWin / vfx / rollupStart directives
  // (the single line-win counterRollup, suppressed for cascade spins).
  emitWinSequence(builder, result, scene);
  // SEAM: WP-4.9 feature flow (stage 4) and WP-4.10 cascades (stage 5) push their directives HERE, between
  // stage 3 (win sequence) and stage 6 (escalation), before the single build()/sort. Each new stage appends
  // to the same builder so `seq` remains globally monotonic and the comparator stays total.
  // Stage 6: win-tier escalation (WP-4.8): one escalation{tier} per crossed tier in ascending order.
  emitEscalation(builder, result, scene);

  const directives = builder.build();
  let durationMs = 0;
  for (let i = 0; i < directives.length; i += 1) {
    const atMs = directives[i]!.atMs;
    if (atMs > durationMs) durationMs = atMs;
  }
  return { spinId: result.spinId, durationMs, directives };
}
