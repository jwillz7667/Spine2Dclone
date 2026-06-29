// The PresentationTimeline and the typed PresentationDirective union (phase-4 section 5.4, WP-4.7). This
// is THE determinism surface: a flat, time-ordered, fully resolved list of typed directives produced by
// the pure sequencer (sequence.ts). It contains no live objects, no functions, no engine handles: pure
// data, JSON serializable, deep-equal comparable, the artifact the golden-playback test pins (section 10).
//
// Cross-runtime stability decisions pinned here (so Phase 5 Unity/Godot reproduce byte-for-byte):
//   - All times are INTEGER MILLISECONDS (atMs, startMs, endMs, durationMs). Conversion to seconds happens
//     only at the renderer edge (a single / 1000). No float seconds are ever stored.
//   - Win amounts in directives are INTEGER BASE UNITS (cents/credits as the engine reports), never floats.
//   - Every directive carries a globally unique, deterministic emission index `seq` (section 5.4.1), so the
//     two-key comparator (atMs asc, seq asc) is a TOTAL order with no hidden priority key and a non-stable
//     runtime sort (C# List.Sort, Godot sorts) yields the identical sequence.
//
// runtime-core/slot is PixiJS-free, clock-free, RNG-free (LAW 1 / INV): the directive union references only
// the authored SymbolId brand (a format type) and pure scalar data. The full directive union (ALL kinds,
// section 5.4) is declared here; WP-4.7 EMITS only the landing + anticipation kinds (reelStop, symbolLand,
// symbolAnimate), and WP-4.8/4.9/4.10 emit the win/flow/tumble/escalation kinds by extending sequence.ts.

import type { SymbolId } from '@marionette/format/slot-types';
import type { CurveType } from './rollup';

// Escalation banner tiers (win presentation, WP-4.8). big < mega < epic in ascending order.
export type EscalationTier = 'big' | 'mega' | 'epic';

// The per-symbol animation phase a symbolAnimate directive selects (maps to a SymbolAnimSet slot).
export type SymbolAnimSlot = 'idle' | 'anticipation' | 'win' | 'land';

// A grid cell coordinate (row top-to-bottom, col left-to-right), integer indices.
export interface GridCell {
  row: number;
  col: number;
}

// A survivor move in a cascade drop (WP-4.10): the symbol slides from one cell to a lower cell.
export interface SymbolMove {
  from: GridCell;
  to: GridCell;
  symbol: SymbolId;
}

// Where a VFX burst / multiplier orb anchors: a grid cell or an absolute screen position.
export type GridAnchor =
  | { kind: 'cell'; row: number; col: number }
  | { kind: 'screen'; x: number; y: number };

// The fully resolved presentation timeline for one spin. `directives` is sorted by (atMs asc, seq asc).
export interface PresentationTimeline {
  spinId: string; // copied from SpinResult, for traceability only.
  durationMs: number; // total resolved length, integer milliseconds (max atMs across directives, or 0).
  directives: readonly PresentationDirective[]; // sorted by (atMs asc, seq asc); see section 5.4.1.
}

// Every directive carries an integer atMs and a globally unique, deterministic emission index `seq`.
interface DirectiveBase {
  atMs: number;
  seq: number;
}

// The closed directive union (phase-4 section 5.4). WP-4.7 emits only reelStop / symbolLand /
// symbolAnimate; the remaining kinds are emitted by WP-4.8 (win + escalation), WP-4.9 (flow + orbs), and
// WP-4.10 (cascade). The union is declared in full now so the renderer and the golden corpus type against
// the final shape and the later WPs only ADD emission code, never widen this type.
export type PresentationDirective =
  | ({ kind: 'reelStop'; col: number } & DirectiveBase)
  | ({ kind: 'symbolLand'; row: number; col: number; symbol: SymbolId } & DirectiveBase)
  | ({ kind: 'symbolAnimate'; row: number; col: number; set: SymbolAnimSlot } & DirectiveBase)
  | ({ kind: 'vfxBurst'; preset: string; anchor: GridAnchor } & DirectiveBase)
  | ({
      kind: 'counterRollup';
      fromUnits: number;
      toUnits: number;
      startMs: number;
      endMs: number;
      curve: CurveType;
    } & DirectiveBase)
  | ({ kind: 'escalation'; tier: EscalationTier } & DirectiveBase)
  | ({ kind: 'flowEnter'; state: string } & DirectiveBase)
  | ({ kind: 'flowExit'; state: string } & DirectiveBase)
  | ({ kind: 'multiplierOrb'; valueX: number; anchor: GridAnchor } & DirectiveBase)
  | ({ kind: 'cascadeExplode'; cells: readonly GridCell[] } & DirectiveBase)
  | ({ kind: 'cascadeDrop'; moves: readonly SymbolMove[] } & DirectiveBase)
  | ({ kind: 'cascadeRefill'; col: number; symbols: readonly SymbolId[] } & DirectiveBase);
