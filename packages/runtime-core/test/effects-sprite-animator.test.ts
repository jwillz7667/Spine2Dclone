import { describe, expect, it } from 'vitest';
import {
  isSpriteAnimatorDone,
  makeSpriteAnimatorState,
  prepareSpriteAnimator,
  screenCoverTransformInto,
  stepSpriteAnimatorOnce,
} from '../src/effects/sprite-animator-solve';
import { transformPoint } from '../src/math/affine';
import type { Mat2x3 } from '../src/math/affine';
import { rampNumber, spriteAnimatorLayer } from './effects-fixtures';

// WP-3.3: the sprite-animator solve (phase-3-vfx-particles.md section 8.6). Rotation is continuous
// (rotationDegPerSec * lt, not wrapped); over-life curves drive scale/color/alpha at u. dt = 1/60.

const DT = 1 / 60;

describe('sprite animator: rotation', () => {
  it('rotation advances by rotationDegPerSec * dt each step (continuous, no wrap)', () => {
    const prepared = prepareSpriteAnimator(
      spriteAnimatorLayer({ rotationDegPerSec: 90, loop: true, layerDuration: 1 }),
      DT,
    );
    const state = makeSpriteAnimatorState();
    stepSpriteAnimatorOnce(prepared, state); // lt = 1*dt
    expect(state.rotationDeg).toBeCloseTo(90 * DT, 9);
    // After many cycles the rotation keeps growing past 360 (continuous, monotonic).
    for (let i = 0; i < 600; i += 1) stepSpriteAnimatorOnce(prepared, state);
    const lt = 601 * DT;
    expect(state.rotationDeg).toBeCloseTo(90 * lt, 6);
    expect(state.rotationDeg).toBeGreaterThan(360); // monotonic past one revolution
  });

  it('rotation is monotonic across a layerDuration loop boundary (no discontinuity)', () => {
    const prepared = prepareSpriteAnimator(
      spriteAnimatorLayer({ rotationDegPerSec: 360, loop: true, layerDuration: 0.5 }),
      DT,
    );
    const state = makeSpriteAnimatorState();
    let prev = -Infinity;
    for (let i = 0; i < 120; i += 1) {
      stepSpriteAnimatorOnce(prepared, state);
      expect(state.rotationDeg).toBeGreaterThan(prev);
      prev = state.rotationDeg;
    }
  });
});

describe('sprite animator: over-life curves', () => {
  it('alpha pulse follows the curve at u = (lt mod layerDuration) / layerDuration when looping', () => {
    // alpha ramps 0 -> 1 over the cycle. At lt = 0.5 of a 1s cycle, u = 0.5 -> alpha ~ 0.5.
    const prepared = prepareSpriteAnimator(
      spriteAnimatorLayer({ loop: true, layerDuration: 1, alphaOverLife: rampNumber(0, 1) }),
      DT,
    );
    const state = makeSpriteAnimatorState();
    for (let i = 0; i < 30; i += 1) stepSpriteAnimatorOnce(prepared, state); // lt = 30*dt = 0.5
    expect(state.alpha).toBeCloseTo(0.5, 6);
  });

  it('non-looping scale clamps u to [0, 1] past layerDuration', () => {
    const prepared = prepareSpriteAnimator(
      spriteAnimatorLayer({ loop: false, layerDuration: 0.5, scaleOverLife: rampNumber(0, 4) }),
      DT,
    );
    const state = makeSpriteAnimatorState();
    for (let i = 0; i < 120; i += 1) stepSpriteAnimatorOnce(prepared, state); // lt = 2s >> 0.5
    expect(state.scale).toBeCloseTo(4, 6); // clamped to the last stop
  });
});

describe('sprite animator: lifecycle', () => {
  it('a looping layer is never done; a non-looping layer is done after one cycle', () => {
    const loop = prepareSpriteAnimator(spriteAnimatorLayer({ loop: true, layerDuration: 0.5 }), DT);
    const loopState = makeSpriteAnimatorState();
    for (let i = 0; i < 120; i += 1) stepSpriteAnimatorOnce(loop, loopState);
    expect(isSpriteAnimatorDone(loop, loopState)).toBe(false);

    const once = prepareSpriteAnimator(
      spriteAnimatorLayer({ loop: false, layerDuration: 0.5 }),
      DT,
    );
    const onceState = makeSpriteAnimatorState();
    expect(isSpriteAnimatorDone(once, onceState)).toBe(false);
    for (let i = 0; i < 30; i += 1) stepSpriteAnimatorOnce(once, onceState); // lt = 0.5
    expect(isSpriteAnimatorDone(once, onceState)).toBe(true);
  });
});

describe('sprite animator: screen-cover transform', () => {
  it('covers a given viewport rect exactly (unit-quad corners map to the rect corners within 1e-6)', () => {
    const out = new Float64Array(6);
    screenCoverTransformInto(out, 0, 1920, 1080);
    const m: Mat2x3 = [out[0]!, out[1]!, out[2]!, out[3]!, out[4]!, out[5]!];
    // The unit quad spans [-0.5, 0.5]^2; its corners must hit (0,0) and (1920,1080).
    const tl = transformPoint(m, -0.5, -0.5);
    const br = transformPoint(m, 0.5, 0.5);
    expect(tl[0]).toBeCloseTo(0, 6);
    expect(tl[1]).toBeCloseTo(0, 6);
    expect(br[0]).toBeCloseTo(1920, 6);
    expect(br[1]).toBeCloseTo(1080, 6);
  });
});
