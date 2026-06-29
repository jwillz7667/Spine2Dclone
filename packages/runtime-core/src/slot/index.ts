// Barrel for the platform-agnostic slot sequencer (phase-4 section 5.4, WP-4.7). PixiJS-free, clock-free,
// RNG-free: the deterministic (SpinResult, SlotScene) -> PresentationTimeline core that runtime-web plays
// and Unity/Godot reimplement. WP-4.7 carried the pinned integer rollup math first (the cross-runtime
// determinism surface); the landing/anticipation/emit-sort framework and the win/flow/tumble extensions
// (WP-4.8/4.9/4.10) grow this barrel.
export { rollupValueAt, CURVE_TYPES } from './rollup';
export type { CurveType } from './rollup';

// The deterministic sequencer (WP-4.7): the pure (SpinResult, SlotScene) -> PresentationTimeline core.
// WP-4.7 emits the landing + anticipation directives and the emit/sort framework; WP-4.8/4.9/4.10 extend
// `sequence` with the win/flow/tumble/escalation stages. The full directive union TYPE ships now so the
// renderer (runtime-web) and the golden corpus type against the final shape.
export { sequence } from './sequence';
export type {
  PresentationTimeline,
  PresentationDirective,
  EscalationTier,
  SymbolAnimSlot,
  GridCell,
  SymbolMove,
  GridAnchor,
} from './timeline';
