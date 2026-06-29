// Barrel for the platform-agnostic slot sequencer (phase-4 section 5.4, WP-4.7). PixiJS-free, clock-free,
// RNG-free: the deterministic (SpinResult, SlotScene) -> PresentationTimeline core that runtime-web plays
// and Unity/Godot reimplement. WP-4.7 carried the pinned integer rollup math first (the cross-runtime
// determinism surface); the landing/anticipation/emit-sort framework and the win/flow/tumble extensions
// (WP-4.8/4.9/4.10) grow this barrel.
export { rollupValueAt, CURVE_TYPES } from './rollup';
export type { CurveType } from './rollup';
