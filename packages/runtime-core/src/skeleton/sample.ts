import type { Animation, SkeletonDocument } from '@marionette/format/types';
import { composeInto, MAT2X3_STRIDE } from '../math/affine';
import { SETUP_STRIDE, SLOT_COLOR_STRIDE } from './pose';
import type { Pose } from './pose';
import type { PreparedAnimation, PreparedBoneChannels, PreparedSlotChannels } from './prepared';
import {
  buildAttachmentTrack,
  buildColorTrack,
  buildScalarTrack,
  buildVec2Track,
  findSegmentIndex,
  sampleAttachmentName,
  segmentComponent,
  segmentFraction,
} from './curve';
import { computeWorldTransforms, resetToSetupPose } from './world-transform';

// Thrown when sampleSkeleton is asked for an animation id the document does not define. A typed error
// (not a bare string) so callers can distinguish it; it carries the offending id for diagnostics.
export class AnimationNotFoundError extends Error {
  readonly animationId: string;

  constructor(animationId: string) {
    super(`animation not found: ${animationId}`);
    this.name = 'AnimationNotFoundError';
    this.animationId = animationId;
  }
}

// Sample an animation into a caller-owned pose buffer at time t (seconds), running the LOCKED solve
// order (CLAUDE.md per-frame solve): (1) reset to setup pose, (2) apply animation timelines,
// (3) solve constraints, (4) world transforms. Steps 5 and 6 (skin/deform, render) are not in
// runtime-core. The function returns nothing and, after the first call for a given animation (which
// builds and caches its prepared form on the pose), allocates nothing per call: it writes only into
// the pre-allocated pose buffers. It is a pure SINGLE-PERIOD function on [0, duration] with clamp; it
// does NOT wrap (looping is the transport's job, mapping elapsed time into [0, duration) before the
// call). `t` outside [0, duration] is clamped per channel to the first/last keyframe value.
//
// The pose MUST be buildPose(document) for the same document: only `document.animations[animationId]`
// is read from the document here; the bone/slot setup comes from the pose.
export function sampleSkeleton(
  document: SkeletonDocument,
  animationId: string,
  t: number,
  outPose: Pose,
): void {
  const animation = document.animations[animationId];
  if (animation === undefined) throw new AnimationNotFoundError(animationId);

  const prepared = getPreparedAnimation(outPose, animation);

  // Step 1: reset to setup pose (bones write their local matrices; slots reset color + attachment).
  resetToSetupPose(outPose);
  resetSlotsToSetup(outPose);

  // Step 2: apply animation timelines onto the reset setup pose.
  applyBoneChannels(prepared, outPose, t);
  applySlotChannels(prepared, outPose, t);

  // Step 3: solve constraints. No-op in Phase 1; the named stage is kept so Phase 2 inserts IK then
  // transform constraints exactly here without reordering the locked solve.
  solveConstraints(outPose);

  // Step 4: world transforms (single forward pass, parents before children).
  computeWorldTransforms(outPose);
}

// Phase 1 constraint stage: intentionally empty. Phase 2 inserts the IK solve then the transform
// constraint solve here (CLAUDE.md solve order step 3), operating on outPose.local before the world
// pass. Kept as a named pipeline step so that insertion needs no reordering.
function solveConstraints(_pose: Pose): void {
  // Phase 2: solve IK constraints, then transform constraints, in order.
}

// Reset every slot's resolved color to its setup color and its active attachment to its setup name.
// Allocation-free: the typed-array copy reuses slotColor, the name loop writes string refs in place.
function resetSlotsToSetup(pose: Pose): void {
  const { slotColor, slotSetupColor, slotAttachment, slotSetupAttachment, slotCount } = pose;
  slotColor.set(slotSetupColor);
  for (let i = 0; i < slotCount; i += 1) {
    slotAttachment[i] = slotSetupAttachment[i] ?? null;
  }
}

// Apply bone transform channels onto the reset setup pose, per the normative rule (TASK-1.4.3):
// rotate ADDS to setup rotation, translate ADDS to setup translation, scale MULTIPLIES setup scale
// componentwise, shear ADDS to setup shear. Only animated bones are recomposed; bones without channels
// keep their reset-from-setup local matrix. The segment index and fraction are computed once per
// channel (vec2 channels share them across both components).
function applyBoneChannels(prepared: PreparedAnimation, pose: Pose, t: number): void {
  const { boneChannels } = prepared;
  const { setup, local } = pose;
  for (let bc = 0; bc < boneChannels.length; bc += 1) {
    const channels: PreparedBoneChannels = boneChannels[bc]!;
    const boneIndex = channels.boneIndex;
    if (boneIndex < 0) continue;

    const s = boneIndex * SETUP_STRIDE;
    let x = setup[s]!;
    let y = setup[s + 1]!;
    let rotation = setup[s + 2]!;
    let scaleX = setup[s + 3]!;
    let scaleY = setup[s + 4]!;
    let shearX = setup[s + 5]!;
    let shearY = setup[s + 6]!;

    const rotate = channels.rotate;
    if (rotate !== null) {
      const i = findSegmentIndex(rotate.times, rotate.keyCount, t);
      const f = segmentFraction(rotate, i, t);
      rotation += segmentComponent(rotate, i, f, 0);
    }

    const translate = channels.translate;
    if (translate !== null) {
      const i = findSegmentIndex(translate.times, translate.keyCount, t);
      const f = segmentFraction(translate, i, t);
      x += segmentComponent(translate, i, f, 0);
      y += segmentComponent(translate, i, f, 1);
    }

    const scale = channels.scale;
    if (scale !== null) {
      const i = findSegmentIndex(scale.times, scale.keyCount, t);
      const f = segmentFraction(scale, i, t);
      scaleX *= segmentComponent(scale, i, f, 0);
      scaleY *= segmentComponent(scale, i, f, 1);
    }

    const shear = channels.shear;
    if (shear !== null) {
      const i = findSegmentIndex(shear.times, shear.keyCount, t);
      const f = segmentFraction(shear, i, t);
      shearX += segmentComponent(shear, i, f, 0);
      shearY += segmentComponent(shear, i, f, 1);
    }

    composeInto(local, boneIndex * MAT2X3_STRIDE, x, y, rotation, scaleX, scaleY, shearX, shearY);
  }
}

// Apply slot channels onto the reset setup pose: color REPLACES setup color (per-component RGBA lerp
// across the segment per its curve), attachment is stepped (hold the active name until the next key).
function applySlotChannels(prepared: PreparedAnimation, pose: Pose, t: number): void {
  const { slotChannels } = prepared;
  const { slotColor, slotAttachment } = pose;
  for (let sc = 0; sc < slotChannels.length; sc += 1) {
    const channels: PreparedSlotChannels = slotChannels[sc]!;
    const slotIndex = channels.slotIndex;
    if (slotIndex < 0) continue;

    const color = channels.color;
    if (color !== null) {
      const i = findSegmentIndex(color.times, color.keyCount, t);
      const f = segmentFraction(color, i, t);
      const base = slotIndex * SLOT_COLOR_STRIDE;
      slotColor[base] = segmentComponent(color, i, f, 0);
      slotColor[base + 1] = segmentComponent(color, i, f, 1);
      slotColor[base + 2] = segmentComponent(color, i, f, 2);
      slotColor[base + 3] = segmentComponent(color, i, f, 3);
    }

    const attachment = channels.attachment;
    if (attachment !== null) {
      slotAttachment[slotIndex] = sampleAttachmentName(attachment, t);
    }
  }
}

// Fetch (building and caching on first use) the prepared form of an animation for this pose. The cache
// is keyed by Animation identity so a re-sample of the same animation reuses the flattened tracks and
// bezier tables with zero allocation; a different Animation object (a different document) builds its
// own entry.
function getPreparedAnimation(pose: Pose, animation: Animation): PreparedAnimation {
  const cached = pose.preparedAnimations.get(animation);
  if (cached !== undefined) return cached;
  const prepared = prepareAnimation(pose, animation);
  pose.preparedAnimations.set(animation, prepared);
  return prepared;
}

// Flatten a format Animation into the solve-side representation, resolving bone/slot names to this
// pose's indices and precomputing bezier tables (curve.ts). Build-time only; the per-frame solve never
// calls this once the cache is warm. Channels present but empty are dropped (treated as no channel).
function prepareAnimation(pose: Pose, animation: Animation): PreparedAnimation {
  const boneIndexByName = nameIndex(pose.boneNames);
  const slotIndexByName = nameIndex(pose.slotNames);

  const boneChannels: PreparedBoneChannels[] = [];
  for (const boneName of Object.keys(animation.bones)) {
    const timelines = animation.bones[boneName]!;
    boneChannels.push({
      boneIndex: boneIndexByName.get(boneName) ?? -1,
      rotate:
        timelines.rotate && timelines.rotate.length > 0 ? buildScalarTrack(timelines.rotate) : null,
      translate:
        timelines.translate && timelines.translate.length > 0
          ? buildVec2Track(timelines.translate)
          : null,
      scale: timelines.scale && timelines.scale.length > 0 ? buildVec2Track(timelines.scale) : null,
      shear: timelines.shear && timelines.shear.length > 0 ? buildVec2Track(timelines.shear) : null,
    });
  }

  const slotChannels: PreparedSlotChannels[] = [];
  for (const slotName of Object.keys(animation.slots)) {
    const timelines = animation.slots[slotName]!;
    slotChannels.push({
      slotIndex: slotIndexByName.get(slotName) ?? -1,
      color:
        timelines.color && timelines.color.length > 0 ? buildColorTrack(timelines.color) : null,
      attachment:
        timelines.attachment && timelines.attachment.length > 0
          ? buildAttachmentTrack(timelines.attachment)
          : null,
    });
  }

  return { boneChannels, slotChannels };
}

function nameIndex(names: readonly string[]): Map<string, number> {
  const index = new Map<string, number>();
  for (let i = 0; i < names.length; i += 1) index.set(names[i]!, i);
  return index;
}
