import { describe, expect, it } from 'vitest';
import {
  compose,
  getTranslation,
  identity,
  multiply,
  transformPoint,
  type Mat2x3,
} from '@marionette/runtime-core';
import { reprojectLocal, rotationAboutPivot, scaleAboutPivot } from './group-transform';

const HALF_PI = Math.PI / 2;

describe('rotationAboutPivot', () => {
  it('holds the pivot fixed and orbits an offset point 90 degrees', () => {
    const m = rotationAboutPivot(10, 20, HALF_PI);
    expect(transformPoint(m, 10, 20)).toEqual([10, 20]); // pivot fixed
    const [x, y] = transformPoint(m, 30, 20); // +20 along x from pivot -> +20 along y (Y-down)
    expect(x).toBeCloseTo(10, 9);
    expect(y).toBeCloseTo(40, 9);
  });
});

describe('scaleAboutPivot', () => {
  it('scales an offset point about the pivot along world axes (uniform)', () => {
    const m = scaleAboutPivot(10, 20, 0, 2, 2);
    expect(transformPoint(m, 10, 20)).toEqual([10, 20]);
    expect(transformPoint(m, 30, 20)).toEqual([50, 20]); // offset 20 -> 40
  });

  it('scales one axis only when fy is 1 (per-axis)', () => {
    const m = scaleAboutPivot(0, 0, 0, 3, 1);
    expect(transformPoint(m, 10, 5)).toEqual([30, 5]); // x tripled, y unchanged
  });
});

describe('reprojectLocal', () => {
  it('is world-exact: setting local to the result reproduces pivotWorld * oldWorld', () => {
    const parentWorld: Mat2x3 = compose(5, 7, 25, 1.5, 0.8, 0, 0);
    const localOld: Mat2x3 = compose(12, -3, 40, 1.2, 0.9, 6, 0);
    const oldWorld = multiply(parentWorld, localOld);
    const pivotWorld = rotationAboutPivot(2, 9, 0.7);

    const d = reprojectLocal(pivotWorld, oldWorld, parentWorld);
    const rebuiltLocal = compose(
      d.x,
      d.y,
      d.rotationDeg,
      d.scaleX,
      d.scaleY,
      d.shearXDeg,
      d.shearYDeg,
    );
    const rebuiltWorld = multiply(parentWorld, rebuiltLocal);
    const expected = multiply(pivotWorld, oldWorld);
    for (let i = 0; i < 6; i += 1) expect(rebuiltWorld[i]).toBeCloseTo(expected[i]!, 9);
  });

  it('orbits a root bone (identity parent) about the pivot, moving its world origin', () => {
    const parentWorld = identity();
    const oldWorld: Mat2x3 = compose(30, 20, 0, 1, 1, 0, 0); // origin at (30,20)
    const pivotWorld = rotationAboutPivot(10, 20, HALF_PI);

    const d = reprojectLocal(pivotWorld, oldWorld, parentWorld);
    // The world origin orbits the pivot: (30,20) is +20 x from (10,20) -> +20 y -> (10,40).
    expect(d.x).toBeCloseTo(10, 9);
    expect(d.y).toBeCloseTo(40, 9);
    expect(d.rotationDeg).toBeCloseTo(90, 9);
  });

  it('does not move a bone whose origin is the pivot (pure spin in place)', () => {
    const parentWorld = identity();
    const oldWorld: Mat2x3 = compose(10, 20, 0, 1, 1, 0, 0);
    const pivotWorld = rotationAboutPivot(10, 20, HALF_PI);

    const [ox, oy] = getTranslation(oldWorld);
    const d = reprojectLocal(pivotWorld, oldWorld, parentWorld);
    expect(d.x).toBeCloseTo(ox, 9);
    expect(d.y).toBeCloseTo(oy, 9);
  });
});
