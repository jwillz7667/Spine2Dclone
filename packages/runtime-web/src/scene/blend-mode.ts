import type { BLEND_MODES } from 'pixi.js';
import type { BlendMode } from '@marionette/format/types';

// The single format-BlendMode -> PixiJS-blend mapping (phase-3-vfx-particles.md section 7.4, WP-3.5
// TASK-3.5.1). The format's four blend modes (`normal | additive | multiply | screen`) map to PixiJS v8
// blend-mode strings. This is the ONE mapping in the renderer: the Phase 1 per-slot sprite path and the
// Phase 3 particle / sprite-animator / ribbon path BOTH call it, so there is no second blend code path
// and no chance the slot renderer and the particle renderer disagree (the conformance check in section
// 7.4: "the four modes map to the same PixiJS constants used by slots"). Renderer-only: this lives in
// runtime-web, never in runtime-core (the solve is blend-agnostic; blend is a draw-state concern).
//
// PixiJS v8 names additive blending `'add'` (not `'additive'`); the other three names coincide with the
// format spelling. Keeping the table total and exhaustive (a `satisfies` over every BlendMode) means a
// future BlendMode addition fails to compile here until its PixiJS mapping is supplied.
const BLEND_MODE_TO_PIXI = {
  normal: 'normal',
  additive: 'add',
  multiply: 'multiply',
  screen: 'screen',
} as const satisfies Record<BlendMode, BLEND_MODES>;

// Map a format BlendMode to the PixiJS v8 blend-mode string a Container/Sprite/Mesh consumes via its
// `.blendMode` setter. Total over the BlendMode union (no default branch, no throw): the type system
// guarantees every case is covered.
export function blendModeToPixi(mode: BlendMode): BLEND_MODES {
  return BLEND_MODE_TO_PIXI[mode];
}
