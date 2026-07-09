import { invert, multiply } from '../math/affine';
import type { Pose } from '../skeleton/pose';
import { composeWorld, decomposeWorld } from './affine-channels';
import type { WorldChannels } from './affine-channels';
import { localMat, parentWorldMat, resolveWorldMat, writeLocalMat } from './resolve-world';
import { lerp } from './scalar';

// Transform constraint (ADR-0003 section 5, variants per ADR-0009 section 1.2 / ADR-0010 section 3).
// Default (local false, relative false): read WORLD, blend in WORLD, write LOCAL. Per-channel mix blends
// the constrained bone's would-be world channels toward the target's world channels; per-channel offsets
// add on top. The two variant flags switch the SPACE (world vs the bone's local components) and the
// COMPOSITION (absolute blend toward the target vs a relative offset added to the bone's current value).
// The four combinations are the standard transform-constraint variants. Default false/false is the exact
// ADR-0003 world absolute solve, so every pre-variant fixture is byte-identical. Degrees for rotation and
// shearY (the channel model), matching WorldChannels and the format's stored offsets.
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

// Blend one channel model toward a target under the mix and offset (ADR-0010 section 3). Absolute:
// resultCh = lerp(boneCh, targetCh, mix) + offset (the ADR-0003 blend). Relative: resultCh = boneCh +
// mix * (targetCh + offset), so the target (plus offset) is applied as an offset RELATIVE to the bone's
// current value, scaled by the channel mix, rather than an absolute interpolation toward the target.
// Writes into `out` in place so the caller reuses one scratch object (no per-call channel allocation).
function blendChannels(
  bone: WorldChannels,
  target: WorldChannels,
  mix: TransformMix,
  offset: TransformOffset,
  relative: boolean,
  out: WorldChannels,
): void {
  if (relative) {
    out.rotation = bone.rotation + mix.rotate * (target.rotation + offset.rotation);
    out.x = bone.x + mix.x * (target.x + offset.x);
    out.y = bone.y + mix.y * (target.y + offset.y);
    out.scaleX = bone.scaleX + mix.scaleX * (target.scaleX + offset.scaleX);
    out.scaleY = bone.scaleY + mix.scaleY * (target.scaleY + offset.scaleY);
    out.shearY = bone.shearY + mix.shearY * (target.shearY + offset.shearY);
    return;
  }
  out.rotation = lerp(bone.rotation, target.rotation, mix.rotate) + offset.rotation;
  out.x = lerp(bone.x, target.x, mix.x) + offset.x;
  out.y = lerp(bone.y, target.y, mix.y) + offset.y;
  out.scaleX = lerp(bone.scaleX, target.scaleX, mix.scaleX) + offset.scaleX;
  out.scaleY = lerp(bone.scaleY, target.scaleY, mix.scaleY) + offset.scaleY;
  out.shearY = lerp(bone.shearY, target.shearY, mix.shearY) + offset.shearY;
}

// Reused scratch for the blended channel model, so the variant solve adds no per-frame channel
// allocation beyond the tuple/decomposition the world/local reads already produce (matching the existing
// solve profile). Single-threaded, non-reentrant solve, so a module-level scratch is safe.
const blendScratch: WorldChannels = {
  rotation: 0,
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  shearY: 0,
};

export function solveTransformConstraint(
  pose: Pose,
  boneIndex: number,
  targetIndex: number,
  mix: TransformMix,
  offset: TransformOffset,
  local: boolean,
  relative: boolean,
): void {
  if (local) {
    // Local variant: read and write the bone's LOCAL components directly, so the constraint composes in
    // the bone's own frame with no world round-trip. The target's local matrix supplies the target
    // channels (both bones' locals are read raw, per the local-space model).
    const targetChannels = decomposeWorld(localMat(pose, targetIndex));
    const boneChannels = decomposeWorld(localMat(pose, boneIndex));
    blendChannels(boneChannels, targetChannels, mix, offset, relative, blendScratch);
    writeLocalMat(pose, boneIndex, composeWorld(blendScratch));
    return;
  }

  // World variant (ADR-0003 section 5): read the would-be world channels, blend in world, then convert
  // the blended world matrix to LOCAL (local = inverse(parentWorld) * blendedWorld) so step 4 reproduces
  // blendedWorld. Plain (not shortest-path) lerp on rotation/shearY, exactly as ADR-0003 specifies; the
  // format validator keeps shear out of the degenerate band, and authored rigs do not wrap rotation past
  // +/-180 between a bone and its target.
  const targetChannels = decomposeWorld(resolveWorldMat(pose, targetIndex));
  const boneChannels = decomposeWorld(resolveWorldMat(pose, boneIndex));
  blendChannels(boneChannels, targetChannels, mix, offset, relative, blendScratch);
  const blended = composeWorld(blendScratch);

  const parent = pose.parentIndices[boneIndex]!;
  const localMatrix =
    parent < 0 ? blended : multiply(invert(parentWorldMat(pose, boneIndex)), blended);
  writeLocalMat(pose, boneIndex, localMatrix);
}
