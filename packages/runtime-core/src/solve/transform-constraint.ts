import { invert, multiply } from '../math/affine';
import type { Pose } from '../skeleton/pose';
import { composeWorld, decomposeWorld } from './affine-channels';
import { parentWorldMat, resolveWorldMat, writeLocalMat } from './resolve-world';
import { lerp } from './scalar';

// Transform constraint (ADR-0003 section 5): read WORLD, blend in WORLD, write LOCAL. Per-channel mix
// blends the constrained bone's would-be world channels toward the target's world channels; per-
// channel offsets add on top. Channels blend independently (blend order is irrelevant). Degrees for
// rotation and shearY (the channel model), matching WorldChannels and the format's stored offsets.
export interface TransformMix {
  rotate: number;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  shearY: number;
}

export interface TransformOffset {
  // Degrees.
  rotation: number;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  // Degrees.
  shearY: number;
}

export function solveTransformConstraint(
  pose: Pose,
  boneIndex: number,
  targetIndex: number,
  mix: TransformMix,
  offset: TransformOffset,
): void {
  const targetChannels = decomposeWorld(resolveWorldMat(pose, targetIndex));
  const boneChannels = decomposeWorld(resolveWorldMat(pose, boneIndex));

  // Per ADR-0003: worldCh = lerp(boneWorldCh, targetWorldCh, mixCh) + offsetCh. Plain (not shortest-
  // path) lerp on rotation/shearY, exactly as the contract specifies; the format validator keeps shear
  // out of the degenerate band, and authored rigs do not wrap rotation past +/-180 between a bone and
  // its target.
  const blended = composeWorld({
    rotation: lerp(boneChannels.rotation, targetChannels.rotation, mix.rotate) + offset.rotation,
    x: lerp(boneChannels.x, targetChannels.x, mix.x) + offset.x,
    y: lerp(boneChannels.y, targetChannels.y, mix.y) + offset.y,
    scaleX: lerp(boneChannels.scaleX, targetChannels.scaleX, mix.scaleX) + offset.scaleX,
    scaleY: lerp(boneChannels.scaleY, targetChannels.scaleY, mix.scaleY) + offset.scaleY,
    shearY: lerp(boneChannels.shearY, targetChannels.shearY, mix.shearY) + offset.shearY,
  });

  // Convert the blended WORLD matrix to LOCAL: local = inverse(parentWorld) * blendedWorld. Step 4
  // recomputes world = parentWorld * local from this, reproducing blendedWorld (modulo float).
  const parent = pose.parentIndices[boneIndex]!;
  const local = parent < 0 ? blended : multiply(invert(parentWorldMat(pose, boneIndex)), blended);
  writeLocalMat(pose, boneIndex, local);
}
