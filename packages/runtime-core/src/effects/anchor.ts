import { compose } from '../math/affine';
import type { Mat2x3 } from '../math/affine';

// The anchor model (phase-3-vfx-particles.md section 8.7, WP-3.4). An EffectAnchor names WHERE an
// effect instantiates; resolution maps it to a world 2x3 matrix the solve transforms effect-local space
// through. The anchor is sampled ONCE per rendered frame and held constant across all fixed-dt sub-steps
// (section 8.4). PixiJS-free, math-bridge-free: anchors carry no outcome, only placement (LAW 1).

// EffectAnchor mirrors the format-side trigger surface (section 8.7). `world` is a fixed pose; `bone`
// resolves against a running skeleton instance's world transform each frame (so a coin trail can follow
// a bone tip); `gridCell` is resolved by Phase 4 (identity in Phase 3, with the row/col carried for the
// later hook); `screen` is viewport-relative (the screen flash) and resolves to identity here, the
// render layer applying the viewport-cover transform (section 8.6).
export type EffectAnchor =
  | { readonly space: 'world'; readonly x: number; readonly y: number; readonly rotation: number }
  | { readonly space: 'bone'; readonly skeletonInstanceId: string; readonly pointOrBone: string }
  | { readonly space: 'gridCell'; readonly row: number; readonly col: number }
  | { readonly space: 'screen' };

// A resolver the EffectSystem injects so runtime-core stays decoupled from any concrete skeleton-instance
// registry: given a skeleton instance id and a bone/point name, return its CURRENT-frame world 2x3, or
// null if unknown. The system calls this once per frame for a `bone` anchor (section 8.4 timing: after
// the skeleton world + deform passes, before draw). A null result falls back to identity so a missing
// bone never crashes a presentation pass; the system can surface a warning.
export type BoneAnchorResolver = (skeletonInstanceId: string, pointOrBone: string) => Mat2x3 | null;

// Resolve an anchor to a world 2x3 matrix (section 8.7). `world` composes a translate+rotate (no scale,
// scale 1); `bone` calls the injected resolver; `gridCell` and `screen` resolve to identity in Phase 3.
// Pure; the caller owns when it is invoked (once per frame). Returns a fresh Mat2x3 tuple, which is
// acceptable here because anchor resolution runs once per frame per instance, NOT per particle sub-step
// (the per-step hot path in emitter-solve never calls this).
export function resolveAnchor(
  anchor: EffectAnchor,
  resolveBone: BoneAnchorResolver | null,
): Mat2x3 {
  switch (anchor.space) {
    case 'world':
      return compose(anchor.x, anchor.y, anchor.rotation, 1, 1, 0, 0);
    case 'bone': {
      const m = resolveBone ? resolveBone(anchor.skeletonInstanceId, anchor.pointOrBone) : null;
      return m ?? compose(0, 0, 0, 1, 1, 0, 0);
    }
    case 'gridCell':
      // Phase 4 hook: a grid resolver will map (row, col) to a cell-center world transform. Identity in
      // Phase 3 keeps the API stable without leaking any Phase 4 grid concept into runtime-core (LAW 5).
      return compose(0, 0, 0, 1, 1, 0, 0);
    case 'screen':
      // Screen-space placement is a render input (viewport size, section 8.6); the solve uses identity
      // and the renderer applies screenCoverTransformInto. Excluded from the cross-runtime rig (8.9).
      return compose(0, 0, 0, 1, 1, 0, 0);
  }
}
