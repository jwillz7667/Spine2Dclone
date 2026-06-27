import { composeInto, decompose, invert, MAT2X3_STRIDE } from '../math/affine';
import type { Mat2x3 } from '../math/affine';
import type { Pose } from '../skeleton/pose';
import { localMat, parentWorldMat, resolveWorldMat } from './resolve-world';
import { clamp, RAD_TO_DEG, wrapDegrees } from './scalar';

// IK constraints (ADR-0003 section 4): read WORLD positions, write LOCAL rotation, blended by mix in
// [0, 1]. IK never writes translation, scale, shear, or a world matrix; it only rotates. The result
// is expressed in the bone's parent world frame so step 4's forward pass reproduces the aim.

// Below this we treat a length or a target offset as degenerate and skip, so no division by zero and
// no NaN can leave the solver.
const EPSILON = 1e-12;

// Convert a desired WORLD direction angle (radians) into the LOCAL rotation (degrees) that makes the
// bone's local X axis point that way under the given parent world frame. We map the unit world
// direction back through the inverse of the parent's LINEAR part: localDir = inv(parentLinear) *
// worldDir. Because the parent's linear map sends localDir back to (a scalar multiple of) worldDir,
// setting the bone's rotation to atan2(localDir) makes its world X axis point along worldDir exactly,
// even when the parent carries shear or non-uniform scale (a plain "worldAngle - parentAngle" would
// only be correct for a similarity parent).
function worldDirToLocalRotDeg(parentWorld: Mat2x3, worldAngleRad: number): number {
  const wx = Math.cos(worldAngleRad);
  const wy = Math.sin(worldAngleRad);
  const inv = invert(parentWorld);
  const localX = inv[0] * wx + inv[2] * wy;
  const localY = inv[1] * wx + inv[3] * wy;
  return Math.atan2(localY, localX) * RAD_TO_DEG;
}

// Write a new local rotation while preserving the bone's other local channels. We decompose the
// current local matrix (affine.decompose pins shearY = 0, folding any Y shear into shearX, and is the
// exact inverse of compose), replace only the rotation with the mix-blended value, and recompose in
// place. mix = 0 reproduces the current matrix exactly (zero delta); mix = 1 lands on the solved
// rotation.
function blendLocalRotation(
  pose: Pose,
  boneIndex: number,
  solvedRotDeg: number,
  mix: number,
): void {
  const current = decompose(localMat(pose, boneIndex));
  const blendedRot = current.rotationDeg + mix * wrapDegrees(solvedRotDeg - current.rotationDeg);
  composeInto(
    pose.local,
    boneIndex * MAT2X3_STRIDE,
    current.x,
    current.y,
    blendedRot,
    current.scaleX,
    current.scaleY,
    current.shearXDeg,
    0,
  );
}

// One-bone IK: rotate the bone so its X axis (the direction its tip points) aims at the target world
// position, expressed as a local rotation relative to the bone's parent world frame and blended by
// mix. The bone's world ORIGIN does not depend on its own rotation, so reading it before the rewrite
// is correct.
export function solveIkOneBone(
  pose: Pose,
  boneIndex: number,
  targetWorldX: number,
  targetWorldY: number,
  mix: number,
): void {
  if (mix <= 0) {
    return;
  }
  const world = resolveWorldMat(pose, boneIndex);
  const dx = targetWorldX - world[4];
  const dy = targetWorldY - world[5];
  if (dx * dx + dy * dy < EPSILON) {
    // Target sits on the bone origin: aim is undefined, leave the bone unchanged.
    return;
  }
  const worldAngle = Math.atan2(dy, dx);
  const solvedRotDeg = worldDirToLocalRotDeg(parentWorldMat(pose, boneIndex), worldAngle);
  blendLocalRotation(pose, boneIndex, solvedRotDeg, mix);
}

// Two-bone IK via the law of cosines (ADR-0003 section 4). The chain base is the parent bone's world
// origin, the joint is the parent's tip, and the tip is the child's tip. Segment lengths are each
// bone.length scaled by that bone's world scaleX (the bone's length lives along its local X axis).
// bendPositive selects which of the two mirror solutions (the elbow/knee side). Unreachable targets
// straighten the chain toward the target; too-close targets fold; clamping acos's argument to [-1, 1]
// and guarding zero-length segments guarantees no NaN leaves the solver.
//
// Precondition (validated rig): childIndex's parent is parentIndex and the child is positioned at the
// parent's tip, so the two segment lengths model the chain. The cycle rule (a constrained bone is not
// an ancestor of its target) guarantees the frames below are resolvable.
export function solveIkTwoBone(
  pose: Pose,
  parentIndex: number,
  childIndex: number,
  targetWorldX: number,
  targetWorldY: number,
  bendPositive: boolean,
  mix: number,
): void {
  if (mix <= 0) {
    return;
  }

  // Scale and origin are read before any rewrite; neither depends on the rotations we are about to
  // set, so reading them up front is correct.
  const parentWorld = resolveWorldMat(pose, parentIndex);
  const childWorld = resolveWorldMat(pose, childIndex);
  const len1 = pose.boneLength[parentIndex]! * Math.hypot(parentWorld[0], parentWorld[1]);
  const len2 = pose.boneLength[childIndex]! * Math.hypot(childWorld[0], childWorld[1]);
  if (len1 < EPSILON || len2 < EPSILON) {
    return;
  }

  const baseX = parentWorld[4];
  const baseY = parentWorld[5];
  const toTargetX = targetWorldX - baseX;
  const toTargetY = targetWorldY - baseY;
  // Distance base->target. atan2(0, 0) is 0 (no NaN); clamp distance away from zero so the cosine
  // denominators stay finite for a target sitting on the base.
  const distance = Math.max(Math.hypot(toTargetX, toTargetY), EPSILON);
  const baseAngle = Math.atan2(toTargetY, toTargetX);

  // Triangle (base, joint, tip): angle1 is the interior angle at the base (between bone1 and the
  // base->target line); angle2 is the interior angle at the joint (between the two bones). Clamping to
  // [-1, 1] folds the unreachable case (cos -> 1, angle1 -> 0, the chain straightens along baseAngle)
  // and the too-close case (cos -> -1, fully folded) without a NaN.
  const cosAngle1 = clamp(
    (distance * distance + len1 * len1 - len2 * len2) / (2 * len1 * distance),
    -1,
    1,
  );
  const angle1 = Math.acos(cosAngle1);
  const cosAngle2 = clamp(
    (len1 * len1 + len2 * len2 - distance * distance) / (2 * len1 * len2),
    -1,
    1,
  );
  const angle2 = Math.acos(cosAngle2);

  const bend = bendPositive ? 1 : -1;
  // bone1 world direction: base->target rotated off by angle1 on the chosen side.
  const phi1 = baseAngle + bend * angle1;
  // bone2 world direction: from the joint, the line joint->base (phi1 + PI) turned by the interior
  // angle toward the target. phi1 + bend*(angle2 - PI) places the tip on the target when mix = 1.
  const phi2 = phi1 + bend * (angle2 - Math.PI);

  // bone1 is solved/written first; bone2 then resolves the parent's UPDATED world as its frame, so the
  // two writes compose to put the tip on the target at full mix.
  blendLocalRotation(
    pose,
    parentIndex,
    worldDirToLocalRotDeg(parentWorldMat(pose, parentIndex), phi1),
    mix,
  );
  blendLocalRotation(
    pose,
    childIndex,
    worldDirToLocalRotDeg(resolveWorldMat(pose, parentIndex), phi2),
    mix,
  );
}
