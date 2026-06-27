import { describe, expect, it } from 'vitest';
import { compose, composeWorld, decomposeWorld } from '../src';
import type { Mat2x3, WorldChannels } from '../src';

// ADR-0003 section 6: the canonical world-channel decompose/recompose. These pin the convention the
// transform constraint blends in and that Unity/Godot mirror (FIX-2.TC). The two functions MUST be
// exact inverses, and the channel semantics MUST agree with affine.compose (pure rotation -> shearY
// 0, unit scales; Y-shear of gamma -> shearY = gamma).

const channelsCloseTo = (actual: WorldChannels, expected: WorldChannels, digits = 9): void => {
  expect(actual.rotation).toBeCloseTo(expected.rotation, digits);
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
  expect(actual.scaleX).toBeCloseTo(expected.scaleX, digits);
  expect(actual.scaleY).toBeCloseTo(expected.scaleY, digits);
  expect(actual.shearY).toBeCloseTo(expected.shearY, digits);
};

const matCloseTo = (actual: Mat2x3, expected: Mat2x3, digits = 9): void => {
  for (let i = 0; i < 6; i += 1) {
    expect(actual[i]).toBeCloseTo(expected[i], digits);
  }
};

describe('world-channel decompose/compose', () => {
  it('round-trips a pure rotation to shearY 0 and unit scales', () => {
    const channels: WorldChannels = { rotation: 37, x: 0, y: 0, scaleX: 1, scaleY: 1, shearY: 0 };

    const result = decomposeWorld(composeWorld(channels));

    channelsCloseTo(result, channels);
  });

  it('round-trips a non-uniform scale (channels -> matrix -> channels)', () => {
    const channels: WorldChannels = {
      rotation: 20,
      x: 11,
      y: -7,
      scaleX: 2.5,
      scaleY: 0.4,
      shearY: 0,
    };

    const result = decomposeWorld(composeWorld(channels));

    channelsCloseTo(result, channels);
  });

  it('represents a Y-shear of gamma degrees as shearY = gamma', () => {
    const gamma = 22;
    const channels: WorldChannels = {
      rotation: 0,
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      shearY: gamma,
    };

    const result = decomposeWorld(composeWorld(channels));

    expect(result.shearY).toBeCloseTo(gamma, 9);
    expect(result.rotation).toBeCloseTo(0, 9);
    expect(result.scaleX).toBeCloseTo(1, 9);
    expect(result.scaleY).toBeCloseTo(1, 9);
  });

  it('round-trips a reflection (negative scaleY) exactly through a real matrix', () => {
    // Reflection via affine.compose with a negative Y scale; decompose then recompose must reproduce
    // the exact matrix, with scaleY carrying the sign.
    const m = compose(3, 4, 18, 1.2, -0.9, 0, 0);

    const channels = decomposeWorld(m);
    expect(channels.scaleY).toBeLessThan(0);

    matCloseTo(composeWorld(channels), m);
  });

  it('is an exact inverse on an arbitrary sheared/scaled matrix (matrix -> channels -> matrix)', () => {
    // A matrix carrying rotation, non-uniform scale, and shear (built via affine.compose's shearX
    // parameterization, a different convention) must still round-trip through the world-channel pair.
    const m = compose(-2, 5, 41, 1.7, 0.8, 15, 0);

    matCloseTo(composeWorld(decomposeWorld(m)), m);
  });

  it('matches affine.compose rotation sign for a pure rotation', () => {
    const m = compose(0, 0, 30, 1, 1, 0, 0);

    expect(decomposeWorld(m).rotation).toBeCloseTo(30, 9);
  });
});
