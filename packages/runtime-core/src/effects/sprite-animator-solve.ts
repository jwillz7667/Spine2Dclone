import type { SpriteAnimatorLayer } from '@marionette/format/types';
import {
  evalLifeCurveNumber,
  evalLifeCurveRgbInto,
  prepareLifeCurveNumber,
  prepareLifeCurveRgb,
} from './life-curve';
import type { PreparedLifeCurveNumber, PreparedLifeCurveRgb } from './life-curve';

// The SpriteAnimatorLayer SOLVE (phase-3-vfx-particles.md section 8.6, WP-3.3): a single animated quad
// for god rays, glow + pulse, and the screen flash. PixiJS-free, deterministic, no PRNG draws (sprite
// animators are fully deterministic without a seed). Local time advances with the same fixed
// simulationDt; rotation is CONTINUOUS (rotationDegPerSec * lt, never wrapped) for smooth god-ray spin;
// scale/color/alpha come from the over-life curves at u. The render layer reads the solved fields.

// A sprite animator prepared for allocation-free stepping. Over-life curve tables are built once.
export interface PreparedSpriteAnimator {
  readonly layer: SpriteAnimatorLayer;
  readonly dt: number;
  readonly scaleOverLife: PreparedLifeCurveNumber;
  readonly alphaOverLife: PreparedLifeCurveNumber;
  readonly colorOverLife: PreparedLifeCurveRgb;
}

// The solved state of one sprite-animator instance, written each step. The renderer maps this quad
// through the anchor transform (world space) or to a viewport-cover transform (screen space, section
// 8.6). Color is three channels held in single-slot scratch arrays so the RGB eval can write into them
// without a tuple allocation.
export interface SpriteAnimatorState {
  rotationDeg: number;
  scale: number;
  alpha: number;
  // RGB stored in length-1 typed arrays so evalLifeCurveRgbInto can write into them allocation-free.
  readonly r: Float64Array;
  readonly g: Float64Array;
  readonly b: Float64Array;
  // The number of fixed-dt steps elapsed (the integer clock); lt = stepIndex * dt.
  stepIndex: number;
}

export function prepareSpriteAnimator(
  layer: SpriteAnimatorLayer,
  dt: number,
): PreparedSpriteAnimator {
  return {
    layer,
    dt,
    scaleOverLife: prepareLifeCurveNumber(layer.scaleOverLife),
    alphaOverLife: prepareLifeCurveNumber(layer.alphaOverLife),
    colorOverLife: prepareLifeCurveRgb(layer.colorOverLife),
  };
}

export function makeSpriteAnimatorState(): SpriteAnimatorState {
  return {
    rotationDeg: 0,
    scale: 1,
    alpha: 1,
    r: new Float64Array(1),
    g: new Float64Array(1),
    b: new Float64Array(1),
    stepIndex: 0,
  };
}

// Advance one fixed-dt step. lt = stepIndex * dt (local time). If loop, u = (lt mod layerDuration) /
// layerDuration; else u = clamp(lt / layerDuration, 0, 1). Rotation is continuous: rotationDegPerSec *
// lt. Scale/color/alpha sample the over-life curves at u. Allocation-free.
export function stepSpriteAnimatorOnce(
  prepared: PreparedSpriteAnimator,
  state: SpriteAnimatorState,
): void {
  state.stepIndex += 1;
  const layer = prepared.layer;
  const lt = state.stepIndex * prepared.dt;
  const dur = layer.layerDuration;
  let u: number;
  if (layer.loop) {
    // mod that stays in [0, dur); JS % can be 0 for exact multiples, which maps to u = 0 (cycle start).
    const m = lt - Math.floor(lt / dur) * dur;
    u = m / dur;
  } else {
    u = lt / dur;
    if (u < 0) u = 0;
    else if (u > 1) u = 1;
  }
  state.rotationDeg = layer.rotationDegPerSec * lt;
  state.scale = evalLifeCurveNumber(prepared.scaleOverLife, u);
  state.alpha = evalLifeCurveNumber(prepared.alphaOverLife, u);
  evalLifeCurveRgbInto(prepared.colorOverLife, u, state.r, state.g, state.b, 0);
}

// Whether a non-looping sprite animator has completed one cycle (lt >= layerDuration). A looping layer
// never reports done (it runs until the effect is stopped). Pure read.
export function isSpriteAnimatorDone(
  prepared: PreparedSpriteAnimator,
  state: SpriteAnimatorState,
): boolean {
  if (prepared.layer.loop) return false;
  return state.stepIndex * prepared.dt >= prepared.layer.layerDuration;
}

// A viewport-cover transform for an `anchorSpace: 'screen'` layer (section 8.6): the quad is placed at
// the viewport center and scaled to cover the full rect. Written into a caller-owned 2x3 lane buffer
// [a, b, c, d, tx, ty] so the render layer (and the DoD assertion 12.2 step 6) can map the unit quad's
// corners exactly. NOTE: section 8.6 says screen-space "covers the viewport scaled to cover"; the
// simplest portable reading is a centered, axis-aligned scale of a unit quad spanning [-0.5, 0.5] to the
// viewport rect, so transformPoint of the four unit-quad corners hits the viewport corners exactly. This
// is EXCLUDED from the cross-runtime conformance rig set (section 8.9, viewport size is a render input).
export function screenCoverTransformInto(
  out: Float64Array,
  outOffset: number,
  viewportWidth: number,
  viewportHeight: number,
): void {
  // Scale a unit quad on [-0.5, 0.5] x [-0.5, 0.5] to the viewport, centered. a = w, d = h, tx/ty center.
  out[outOffset] = viewportWidth; // a (scaleX)
  out[outOffset + 1] = 0; // b
  out[outOffset + 2] = 0; // c
  out[outOffset + 3] = viewportHeight; // d (scaleY)
  out[outOffset + 4] = viewportWidth * 0.5; // tx (center x)
  out[outOffset + 5] = viewportHeight * 0.5; // ty (center y)
}
