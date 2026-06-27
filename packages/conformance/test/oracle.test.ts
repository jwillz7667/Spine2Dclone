import { describe, expect, it } from 'vitest';
import { loadFixture } from '../src/io';
import { withinTolerance, WORLD_BASIS, WORLD_TRANSLATION } from '../src/compare/tolerance';
import type { Affine } from '../src/schema/fixture';

// The INDEPENDENT analytic oracle (phase-1-bone-puppet.md WP-1.12, TASK-1.12.5). It validates the
// FIRST generation of the committed rig-2bone fixture against hand-computed closed-form world
// transforms at three anchor times, so the fixture is checked against an independent source rather
// than merely frozen. A mismatch means the generation is WRONG, not merely different.
//
// Everything below is computed WITHOUT the solver: the expected world bases are literal rotation
// matrices and the tips are evaluated with a local 2x3 apply, deliberately NOT runtime-core's
// transformPoint. The rig (conformance src/rigs/rig-2bone.json) is authored so these anchors are
// exact: root at origin, child offset 100 along root's +x in root-local at setup, all setup rotations
// 0, so at setup the child world is identity-rotation translated to (100, 0) and its tip is (200, 0).
// root.rotate is linear 0 -> 90 over [0, 0.5] then held; child.rotate is held 0 over [0, 0.5] then
// 0 -> 90 over [0.5, 1.0]; root.translate is 0 and child.scale is 1 at t in {0, 0.5, 1.0}, so the
// anchors carry no translate or scale contamination.

// Pure 2x3 affine apply for m = [a, b, c, d, tx, ty] (columns [a c tx; b d ty]). Independent of
// runtime-core so the oracle does not lean on the solver it is validating.
function applyToPoint(m: Affine, x: number, y: number): readonly [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

// Rotation bases [a, b, c, d] = [cos, sin, -sin, cos] for the exact angles.
const R0 = [1, 0, 0, 1] as const; //   0 degrees
const R90 = [0, 1, -1, 0] as const; //  +90 degrees
const R180 = [-1, 0, 0, -1] as const; // +180 degrees

interface Anchor {
  readonly time: number;
  readonly rootBasis: readonly [number, number, number, number];
  readonly rootTip: readonly [number, number];
  readonly childBasis: readonly [number, number, number, number];
  readonly childTip: readonly [number, number];
}

const ANCHORS: readonly Anchor[] = [
  // Setup: root unrotated tip (100, 0); child world identity-rotation at (100, 0), tip (200, 0).
  { time: 0, rootBasis: R0, rootTip: [100, 0], childBasis: R0, childTip: [200, 0] },
  // Root reaches +90 (child adds 0): root tip (0, 100); child world pure +90, tip root_tip + R(90)*(100,0) = (0, 200).
  { time: 0.5, rootBasis: R90, rootTip: [0, 100], childBasis: R90, childTip: [0, 200] },
  // Root +90 and child +90 (local): child world +180; tip (0, 100) + R(180)*(100,0) = (-100, 100).
  { time: 1.0, rootBasis: R90, rootTip: [0, 100], childBasis: R180, childTip: [-100, 100] },
];

const fixture = loadFixture('rig-2bone');

function boneAffine(time: number, bone: string): Affine {
  const sample = fixture.samples.find((s) => s.time === time);
  if (sample === undefined) throw new Error(`no fixture sample at t=${time}`);
  const affine = sample.bones[bone];
  if (affine === undefined) throw new Error(`no bone "${bone}" in fixture sample at t=${time}`);
  return affine;
}

function expectBasis(
  actual: Affine,
  expected: readonly [number, number, number, number],
  label: string,
): void {
  for (let lane = 0; lane < 4; lane += 1) {
    expect(
      withinTolerance(actual[lane]!, expected[lane]!, WORLD_BASIS),
      `${label} basis lane ${lane}: got ${actual[lane]}, expected ${expected[lane]}`,
    ).toBe(true);
  }
}

function expectPoint(
  actual: readonly [number, number],
  expected: readonly [number, number],
  label: string,
): void {
  for (let axis = 0; axis < 2; axis += 1) {
    expect(
      withinTolerance(actual[axis]!, expected[axis]!, WORLD_TRANSLATION),
      `${label} axis ${axis}: got ${actual[axis]}, expected ${expected[axis]}`,
    ).toBe(true);
  }
}

describe('rig-2bone analytic oracle (TASK-1.12.5, independent of the solver)', () => {
  for (const anchor of ANCHORS) {
    it(`matches the closed-form world transforms at t=${anchor.time}`, () => {
      const root = boneAffine(anchor.time, 'root');
      const child = boneAffine(anchor.time, 'child');

      expectBasis(root, anchor.rootBasis, `root@${anchor.time}`);
      expectBasis(child, anchor.childBasis, `child@${anchor.time}`);
      expectPoint(applyToPoint(root, 100, 0), anchor.rootTip, `root tip@${anchor.time}`);
      expectPoint(applyToPoint(child, 100, 0), anchor.childTip, `child tip@${anchor.time}`);
    });
  }
});
