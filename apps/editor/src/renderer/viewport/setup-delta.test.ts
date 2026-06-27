import { describe, expect, it } from 'vitest';
import type { KeyframeValue } from '../document';
import { setupDelta, type SetupTransform } from './setup-delta';

// A deliberately NON-identity setup pose: a torso-like bone with setup rotation 90, an offset origin, a
// non-unit, non-uniform scale, and a non-zero shear. Every channel's inverse must be measured against
// these values, which is exactly the bug class storing the absolute local value would hide.
const setup: SetupTransform = {
  rotation: 90,
  x: 10,
  y: -5,
  scaleX: 2,
  scaleY: 0.5,
  shearX: 12,
  shearY: -8,
};

function angleOf(value: KeyframeValue): number {
  if (!('angle' in value)) throw new Error('expected a rotate value');
  return value.angle;
}

function vec2Of(value: KeyframeValue): { x: number; y: number } {
  if (!('x' in value)) throw new Error('expected a vec2 value');
  return { x: value.x, y: value.y };
}

describe('setupDelta (the exact inverse of the sampler apply, R1.4)', () => {
  it('rotate stores the angle delta from setup (sampler ADDS rotation)', () => {
    const value = setupDelta({ channel: 'rotate', rotation: 130 }, setup);

    expect(angleOf(value)).toBeCloseTo(40, 12); // 130 - 90
  });

  it('translate stores the position delta from setup (sampler ADDS translation)', () => {
    const value = setupDelta({ channel: 'translate', x: 40, y: 20 }, setup);

    expect(vec2Of(value)).toEqual({ x: 30, y: 25 }); // (40-10, 20-(-5))
  });

  it('scale stores the componentwise quotient (sampler MULTIPLIES setup scale)', () => {
    const value = setupDelta({ channel: 'scale', scaleX: 3, scaleY: 2 }, setup);

    const { x, y } = vec2Of(value);
    expect(x).toBeCloseTo(1.5, 12); // 3 / 2
    expect(y).toBeCloseTo(4, 12); // 2 / 0.5
  });

  it('shear stores the shear delta from setup (sampler ADDS shear)', () => {
    const value = setupDelta({ channel: 'shear', shearX: 20, shearY: -3 }, setup);

    expect(vec2Of(value)).toEqual({ x: 8, y: 5 }); // (20-12, -3-(-8))
  });

  it('keying the setup value itself produces the identity delta per channel', () => {
    expect(angleOf(setupDelta({ channel: 'rotate', rotation: setup.rotation }, setup))).toBe(0);
    expect(vec2Of(setupDelta({ channel: 'translate', x: setup.x, y: setup.y }, setup))).toEqual({
      x: 0,
      y: 0,
    });
    // Scale's identity is 1 (the multiplicative identity), not 0.
    expect(
      vec2Of(setupDelta({ channel: 'scale', scaleX: setup.scaleX, scaleY: setup.scaleY }, setup)),
    ).toEqual({ x: 1, y: 1 });
    expect(
      vec2Of(setupDelta({ channel: 'shear', shearX: setup.shearX, shearY: setup.shearY }, setup)),
    ).toEqual({ x: 0, y: 0 });
  });
});
