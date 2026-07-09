import { composeInto, decompose, invert, MAT2X3_STRIDE } from '../math/affine';
import type { Mat2x3 } from '../math/affine';
import type { Pose } from '../skeleton/pose';
import { localMat, parentWorldMat, resolveWorldMat } from './resolve-world';
import { clamp, RAD_TO_DEG, wrapDegrees } from './scalar';

// IK constraints (ADR-0003 section 4, depth per ADR-0010 section 2): read WORLD positions, write LOCAL
// rotation (and, for the stretch/compress depth controls, LOCAL scaleX), blended by mix in [0, 1]. IK
// never writes translation, shear, or a world matrix. The result is expressed in the bone's parent world
// frame so step 4's forward pass reproduces the aim. Every depth control is guarded on its enabling
// condition, so the default (softness 0, stretch/compress/uniform false) is the exact ADR-0003 hard solve
// and the byte-locked pre-F2 fixtures are unchanged.

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

// Write a new local rotation (and optionally scale local X by a factor) while preserving the bone's other
// local channels. We decompose the current local matrix (affine.decompose pins shearY = 0, folding any Y
// shear into shearX, and is the exact inverse of compose), replace the rotation with the mix-blended
// value and multiply scaleX by the mix-blended stretch/compress factor, and recompose in place. mix = 0
// reproduces the current matrix exactly (zero delta, and the scale factor collapses to 1); mix = 1 lands
// on the solved rotation and the full scale factor. scaleXMul = 1 (no stretch/compress) leaves scaleX
// untouched at every mix, so a non-stretching solve is byte-identical to the pre-F2 rotation-only write.
function blendLocalRotation(
  pose: Pose,
  boneIndex: number,
  solvedRotDeg: number,
  mix: number,
  scaleXMul: number,
): void {
  const current = decompose(localMat(pose, boneIndex));
  const blendedRot = current.rotationDeg + mix * wrapDegrees(solvedRotDeg - current.rotationDeg);
  const blendedScaleX = current.scaleX * (1 + mix * (scaleXMul - 1));
  composeInto(
    pose.local,
    boneIndex * MAT2X3_STRIDE,
    current.x,
    current.y,
    blendedRot,
    blendedScaleX,
    current.scaleY,
    current.shearXDeg,
    0,
  );
}

// Soft-reach remap of the base-to-target distance for the two-bone angle solve (ADR-0010 section 2.3). It
// eases the chain into full extension so the joint does not pop straight as the target crosses the
// reachable boundary. Below the soft band (or with softness 0) it is the identity, so softness 0 is the
// exact hard solve. In the band it is C1-continuous with the identity at the entry and asymptotes to
// `reach` from below, so the tip approaches full extension smoothly and never overshoots it. The result
// is floored at EPSILON so a pathological softness > reach cannot drive the cosine denominators negative.
function softReachDistance(distance: number, reach: number, softness: number): number {
  if (softness <= 0) return distance;
  const bandStart = reach - softness;
  if (distance <= bandStart) return distance;
  const eased = reach - softness * Math.exp(-(distance - bandStart) / softness);
  return eased < EPSILON ? EPSILON : eased;
}

// One-bone IK: rotate the bone so its X axis (the direction its tip points) aims at the target world
// position, expressed as a local rotation relative to the bone's parent world frame and blended by mix.
// The bone's world ORIGIN does not depend on its own rotation, so reading it before the rewrite is
// correct. stretch (target beyond the bone's length) and compress (target closer than its length) scale
// local X by d / len so the single segment reaches the target; the default (both false) leaves scale at 1
// and the write is the pre-F2 rotation-only aim.
export function solveIkOneBone(
  pose: Pose,
  boneIndex: number,
  targetWorldX: number,
  targetWorldY: number,
  mix: number,
  stretch: boolean,
  compress: boolean,
): void {
  if (mix <= 0) {
    return;
  }
  const world = resolveWorldMat(pose, boneIndex);
  const dx = targetWorldX - world[4];
  const dy = targetWorldY - world[5];
  const distanceSq = dx * dx + dy * dy;
  if (distanceSq < EPSILON) {
    // Target sits on the bone origin: aim is undefined, leave the bone unchanged.
    return;
  }
  const worldAngle = Math.atan2(dy, dx);
  const solvedRotDeg = worldDirToLocalRotDeg(parentWorldMat(pose, boneIndex), worldAngle);

  // The bone's world length is its setup length scaled by its world X-axis magnitude.
  const len = pose.boneLength[boneIndex]! * Math.hypot(world[0], world[1]);
  let scaleXMul = 1;
  if (len >= EPSILON) {
    const distance = Math.sqrt(distanceSq);
    if ((stretch && distance > len) || (compress && distance < len)) {
      scaleXMul = distance / len;
    }
  }
  blendLocalRotation(pose, boneIndex, solvedRotDeg, mix, scaleXMul);
}

// Two-bone IK via the law of cosines (ADR-0003 section 4, depth per ADR-0010 section 2). The chain base
// is the parent bone's world origin, the joint is the parent's tip, and the tip is the child's tip.
// Segment lengths are each bone.length scaled by that bone's world scaleX (the bone's length lives along
// its local X axis). bendPositive selects which of the two mirror solutions (the elbow/knee side).
//
// Depth controls: stretch lengthens the chain straight to a target beyond full reach; compress shrinks it
// to a target closer than its fold boundary; uniform selects whether stretch scales both bones or only
// the parent; softness eases the approach to full extension. With all at their defaults this is the exact
// ADR-0003 hard solve.
//
// Precondition (validated rig): childIndex's parent is parentIndex and the child is positioned at the
// parent's tip, so the two segment lengths model the chain. The cycle rule (a constrained bone is not an
// ancestor of its target) guarantees the frames below are resolvable.
export function solveIkTwoBone(
  pose: Pose,
  parentIndex: number,
  childIndex: number,
  targetWorldX: number,
  targetWorldY: number,
  bendPositive: boolean,
  mix: number,
  softness: number,
  stretch: boolean,
  compress: boolean,
  uniform: boolean,
): void {
  if (mix <= 0) {
    return;
  }

  // Scale and origin are read before any rewrite; neither depends on the rotations we are about to set,
  // so reading them up front is correct.
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
  const reach = len1 + len2;

  // Stretch: the target is beyond full reach and the chain may lengthen. It straightens (both bones aim
  // at the target) and scales the PARENT bone's local X so the straightened tip lands on the target; the
  // child rides the parent's scale through transform inheritance (ADR-0010 section 2.1). uniform: scale
  // the parent by d/reach and leave the child (childMul 1), so the child inherits the same factor and
  // BOTH world segments scale by d/reach. Non-uniform: grow the parent to length (d - len2) and
  // counter-scale the child by the inverse so ONLY the parent lengthens while the child keeps its world
  // length. Both land the tip on the target for a similarity chain frame. distance > reach guarantees
  // distance - len2 > len1 > 0, so the non-uniform factor is finite and positive.
  if (stretch && distance > reach) {
    let parentScaleMul: number;
    let childScaleMul: number;
    if (uniform) {
      parentScaleMul = distance / reach;
      childScaleMul = 1;
    } else {
      parentScaleMul = (distance - len2) / len1;
      childScaleMul = len1 / (distance - len2);
    }
    blendLocalRotation(
      pose,
      parentIndex,
      worldDirToLocalRotDeg(parentWorldMat(pose, parentIndex), baseAngle),
      mix,
      parentScaleMul,
    );
    blendLocalRotation(
      pose,
      childIndex,
      worldDirToLocalRotDeg(resolveWorldMat(pose, parentIndex), baseAngle),
      mix,
      childScaleMul,
    );
    return;
  }

  // Compress: the target is closer than the chain can reach by folding (inside the dead zone of radius
  // |len1 - len2|). The law of cosines below already folds the chain (its cosAngle2 clamps to 1 when
  // distance < dead), so the pose is the fully-folded one; compress additionally scales the PARENT by
  // d/dead so the folded tip, which rides the parent's scale by inheritance, shrinks to reach the near
  // target (ADR-0010 section 2.2). Softness (a near-full-extension ease) does not apply to this
  // near-base case. dead == 0 (equal segments, nothing to compress toward) leaves the ADR-0003 hard fold.
  const dead = Math.abs(len1 - len2);
  let parentScaleMul = 1;
  let solveDistance = softReachDistance(distance, reach, softness);
  if (compress && dead >= EPSILON && distance < dead) {
    parentScaleMul = distance / dead;
    solveDistance = distance;
  }

  // Triangle (base, joint, tip): angle1 is the interior angle at the base (between bone1 and the
  // base->target line); angle2 is the interior angle at the joint (between the two bones). Clamping to
  // [-1, 1] folds the unreachable case (cos -> 1, angle1 -> 0, the chain straightens along baseAngle) and
  // the too-close case (cos -> -1, fully folded) without a NaN. solveDistance carries the soft-reach ease
  // near full extension; the aim direction (baseAngle) always points at the true target.
  const cosAngle1 = clamp(
    (solveDistance * solveDistance + len1 * len1 - len2 * len2) / (2 * len1 * solveDistance),
    -1,
    1,
  );
  const angle1 = Math.acos(cosAngle1);
  const cosAngle2 = clamp(
    (len1 * len1 + len2 * len2 - solveDistance * solveDistance) / (2 * len1 * len2),
    -1,
    1,
  );
  const angle2 = Math.acos(cosAngle2);

  const bend = bendPositive ? 1 : -1;
  // bone1 world direction: base->target rotated off by angle1 on the chosen side.
  const phi1 = baseAngle + bend * angle1;
  // bone2 world direction: from the joint, the line joint->base (phi1 + PI) turned by the interior angle
  // toward the target. phi1 + bend*(angle2 - PI) places the tip on the target when mix = 1.
  const phi2 = phi1 + bend * (angle2 - Math.PI);

  // bone1 is solved/written first; bone2 then resolves the parent's UPDATED world as its frame, so the
  // two writes compose to put the tip on the target at full mix. parentScaleMul (1 when not compressing)
  // shrinks the parent so the folded tip, riding it, reaches a too-close target; the child inherits.
  blendLocalRotation(
    pose,
    parentIndex,
    worldDirToLocalRotDeg(parentWorldMat(pose, parentIndex), phi1),
    mix,
    parentScaleMul,
  );
  blendLocalRotation(
    pose,
    childIndex,
    worldDirToLocalRotDeg(resolveWorldMat(pose, parentIndex), phi2),
    mix,
    1,
  );
}
