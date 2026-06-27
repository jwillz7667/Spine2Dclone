import { describe, expect, it } from 'vitest';
import type { Mat2x3 } from '@marionette/runtime-core';
import { mapWorldToDisplay, type DisplayTransform } from '../src';

const DEG = Math.PI / 180;

// Recompose a DisplayTransform back into a 2x3 matrix using PixiJS's own transform formula (pivot 0).
// If mapWorldToDisplay is a faithful inverse of this, recompose(map(m)) reproduces m, which is the
// real contract: the channels assigned to a Pixi object must rebuild the source world matrix.
function recompose(t: DisplayTransform): Mat2x3 {
  const cx = Math.cos(t.rotation + t.skewY);
  const sx = Math.sin(t.rotation + t.skewY);
  const cy = -Math.sin(t.rotation - t.skewX);
  const sy = Math.cos(t.rotation - t.skewX);
  return [cx * t.scaleX, sx * t.scaleX, cy * t.scaleY, sy * t.scaleY, t.x, t.y];
}

function expectMatrixClose(actual: Mat2x3, expected: Mat2x3, epsilon = 1e-9): void {
  for (let i = 0; i < 6; i += 1) {
    expect(actual[i]).toBeCloseTo(expected[i]!, Math.round(-Math.log10(epsilon)));
  }
}

describe('mapWorldToDisplay', () => {
  it('maps the identity matrix to a neutral transform', () => {
    const t = mapWorldToDisplay([1, 0, 0, 1, 0, 0]);
    expect(t).toEqual({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 });
  });

  it('reads translation straight off the matrix', () => {
    const t = mapWorldToDisplay([1, 0, 0, 1, 5, 7]);
    expect(t.x).toBe(5);
    expect(t.y).toBe(7);
    expect(t.rotation).toBe(0);
    expect(t.scaleX).toBe(1);
    expect(t.scaleY).toBe(1);
  });

  it('recovers a pure rotation as a single rotation with zero skew', () => {
    const angle = 90 * DEG;
    const m: Mat2x3 = [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0];
    const t = mapWorldToDisplay(m);
    expect(t.rotation).toBeCloseTo(angle, 9);
    expect(t.scaleX).toBeCloseTo(1, 9);
    expect(t.scaleY).toBeCloseTo(1, 9);
    expect(t.skewX).toBe(0);
    expect(t.skewY).toBe(0);
  });

  it('recovers rotation with non-uniform scale (no shear)', () => {
    const angle = 30 * DEG;
    const sx = 2;
    const sy = 3;
    const m: Mat2x3 = [
      sx * Math.cos(angle),
      sx * Math.sin(angle),
      -sy * Math.sin(angle),
      sy * Math.cos(angle),
      4,
      5,
    ];
    const t = mapWorldToDisplay(m);
    expect(t.rotation).toBeCloseTo(angle, 9);
    expect(t.scaleX).toBeCloseTo(sx, 9);
    expect(t.scaleY).toBeCloseTo(sy, 9);
    expect(t.skewX).toBe(0);
    expect(t.skewY).toBe(0);
    expect(t.x).toBe(4);
    expect(t.y).toBe(5);
  });

  it('round-trips a battery of matrices through Pixi recomposition', () => {
    const matrices: Mat2x3[] = [
      [1, 0, 0, 1, 0, 0], // identity
      [1, 0, 0, 1, 12, -3], // translation
      [0, 1, -1, 0, 0, 0], // rotate 90
      [2, 0, 0, 3, 7, 8], // axis scale
      [1, 0, 0, -1, 0, 0], // reflection in Y (uses the skew branch)
      [1, 0.5, 0.3, 1, 4, 5], // general shear
      [-1.5, 0.2, 0.9, 2.1, -6, 11], // mixed reflection + shear + scale
    ];
    for (const m of matrices) {
      expectMatrixClose(recompose(mapWorldToDisplay(m)), m);
    }
  });

  it('keeps scale non-negative and carries reflection in the skew branch', () => {
    const t = mapWorldToDisplay([1, 0, 0, -1, 0, 0]);
    expect(t.scaleX).toBeGreaterThanOrEqual(0);
    expect(t.scaleY).toBeGreaterThanOrEqual(0);
    // A reflection cannot be a pure rotation, so the skew branch is taken (rotation pinned to 0).
    expect(t.rotation).toBe(0);
    expect(t.skewX !== 0 || t.skewY !== 0).toBe(true);
  });
});
