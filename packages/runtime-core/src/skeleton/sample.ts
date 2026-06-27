import type { Animation, SkeletonDocument } from '@marionette/format/types';
import { composeInto, MAT2X3_STRIDE } from '../math/affine';
import { resolveWorld, solveIkOneBone, solveIkTwoBone, solveTransformConstraint } from '../solve';
import { SETUP_STRIDE, SLOT_COLOR_STRIDE } from './pose';
import type { Pose, ResolvedTransformConstraint } from './pose';
import type {
  PreparedAnimation,
  PreparedBoneChannels,
  PreparedDeformChannel,
  PreparedIkChannel,
  PreparedSlotChannels,
  PreparedTrack,
  PreparedTransformChannel,
} from './prepared';
import {
  buildAttachmentTrack,
  buildBendTrack,
  buildColorTrack,
  buildDeformTrack,
  buildIkMixTrack,
  buildScalarTrack,
  buildTransformMixTrack,
  buildVec2Track,
  findSegmentIndex,
  sampleAttachmentName,
  sampleStepBool,
  segmentComponent,
  segmentFraction,
} from './curve';
import { computeWorldTransforms, resetToSetupPose } from './world-transform';

// Solver-owned scratch for an on-demand target world matrix (step 3 reads the target's world origin).
// Module-level and reused so the constraint solve adds no per-frame allocation; the solve is single-
// threaded and never re-entrant, matching resolve-world.ts's scratch convention.
const targetWorldScratch = new Float64Array(MAT2X3_STRIDE);

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

  // Step 1: reset to setup pose (bones write their local matrices; slots reset color + attachment;
  // constraints reset their sampled mix/bendPositive to the constraint definition's base values).
  resetToSetupPose(outPose);
  resetSlotsToSetup(outPose);
  resetConstraintsToBase(outPose);

  // Step 2: apply animation timelines onto the reset setup pose, including the ik/transform constraint
  // mix channels (the values step 3 reads).
  applyBoneChannels(prepared, outPose, t);
  applySlotChannels(prepared, outPose, t);
  applyConstraintChannels(prepared, outPose, t);

  // Step 3: solve constraints: ALL IK constraints first, then ALL transform constraints, each in
  // document array order (ADR-0003 section 3). Constraints write LOCAL only.
  solveConstraints(outPose);

  // Step 4: world transforms (single forward pass, parents before children). Because step 3 wrote only
  // local transforms, this pass is unconditional and reproduces every constraint's intended world.
  computeWorldTransforms(outPose);
}

// Solve step 3 (ADR-0003 section 3): IK constraints first (document array order), then transform
// constraints (document array order). IK reads the target world position (origin of resolveWorld) and
// writes LOCAL rotation; transform reads/blends in world and writes LOCAL. A constraint with an
// unresolved bone/target index (-1) is skipped rather than crashing (build-pose captures -1 for a name
// the rig does not contain). Allocation-free: target world goes into the module scratch, and the
// per-constraint sampled mix/bendPositive were written into pose-owned scratch in step 2.
function solveConstraints(pose: Pose): void {
  const { ikConstraints, transformConstraints } = pose;

  for (let i = 0; i < ikConstraints.length; i += 1) {
    const constraint = ikConstraints[i]!;
    const targetIndex = constraint.targetIndex;
    if (targetIndex < 0) continue;
    const boneIndices = constraint.boneIndices;
    const sampled = constraint.sampled;
    if (sampled.mix <= 0) continue;

    resolveWorld(pose, targetIndex, targetWorldScratch, 0);
    const targetX = targetWorldScratch[4]!;
    const targetY = targetWorldScratch[5]!;

    if (boneIndices.length === 1) {
      const boneIndex = boneIndices[0]!;
      if (boneIndex < 0) continue;
      solveIkOneBone(pose, boneIndex, targetX, targetY, sampled.mix);
    } else {
      const parentIndex = boneIndices[0]!;
      const childIndex = boneIndices[1]!;
      if (parentIndex < 0 || childIndex < 0) continue;
      solveIkTwoBone(
        pose,
        parentIndex,
        childIndex,
        targetX,
        targetY,
        sampled.bendPositive,
        sampled.mix,
      );
    }
  }

  for (let i = 0; i < transformConstraints.length; i += 1) {
    const constraint = transformConstraints[i]!;
    const targetIndex = constraint.targetIndex;
    if (targetIndex < 0) continue;
    const boneIndices = constraint.boneIndices;
    for (let b = 0; b < boneIndices.length; b += 1) {
      const boneIndex = boneIndices[b]!;
      if (boneIndex < 0) continue;
      solveTransformConstraint(
        pose,
        boneIndex,
        targetIndex,
        constraint.sampledMix,
        constraint.offset,
      );
    }
  }
}

// Reset every constraint's per-frame sampled scratch to the constraint definition's base values, the
// constraint analogue of resetSlotsToSetup. Step 2 then overlays the keyed channels; a constraint or
// channel an animation does not key keeps its base. Allocation-free: it mutates the pose-owned scratch
// objects in place (no array or object is created), so a constraint-free rig does nothing here.
function resetConstraintsToBase(pose: Pose): void {
  const { ikConstraints, transformConstraints } = pose;
  for (let i = 0; i < ikConstraints.length; i += 1) {
    const constraint = ikConstraints[i]!;
    constraint.sampled.mix = constraint.baseMix;
    constraint.sampled.bendPositive = constraint.baseBendPositive;
  }
  for (let i = 0; i < transformConstraints.length; i += 1) {
    const constraint = transformConstraints[i]!;
    copyTransformMix(constraint.baseMix, constraint.sampledMix);
  }
}

// Step 2 for constraints: overlay the keyed ik/transform mix channels onto the base values reset above.
// IK mix interpolates by its curve; bendPositive is stepped (ADR-0003 section 7). For a transform
// constraint, each present mix channel overrides the base; an absent channel keeps the (already-reset)
// base value. A channel resolved to a constraint the pose lacks (constraintIndex -1) is ignored.
function applyConstraintChannels(prepared: PreparedAnimation, pose: Pose, t: number): void {
  const { ikChannels, transformChannels } = prepared;
  const { ikConstraints, transformConstraints } = pose;

  for (let c = 0; c < ikChannels.length; c += 1) {
    const channel: PreparedIkChannel = ikChannels[c]!;
    const index = channel.constraintIndex;
    if (index < 0) continue;
    const sampled = ikConstraints[index]!.sampled;
    if (channel.mix !== null) {
      sampled.mix = sampleScalar(channel.mix, t, sampled.mix);
    }
    if (channel.bendPositive !== null) {
      sampled.bendPositive = sampleStepBool(channel.bendPositive, t);
    }
  }

  for (let c = 0; c < transformChannels.length; c += 1) {
    const channel: PreparedTransformChannel = transformChannels[c]!;
    const index = channel.constraintIndex;
    if (index < 0) continue;
    const mix = transformConstraints[index]!.sampledMix;
    mix.rotate = sampleScalar(channel.mixRotate, t, mix.rotate);
    mix.x = sampleScalar(channel.mixX, t, mix.x);
    mix.y = sampleScalar(channel.mixY, t, mix.y);
    mix.scaleX = sampleScalar(channel.mixScaleX, t, mix.scaleX);
    mix.scaleY = sampleScalar(channel.mixScaleY, t, mix.scaleY);
    mix.shearY = sampleScalar(channel.mixShearY, t, mix.shearY);
  }
}

// Sample a single-component track at t, or return the fallback when there is no track for the channel
// (the absent-channel / base-value path). Reuses the shared segment lookup so the curve handling
// (linear/stepped/bezier and the single-period clamp) matches every other channel.
function sampleScalar(track: PreparedTrack | null, t: number, fallback: number): number {
  if (track === null) return fallback;
  const i = findSegmentIndex(track.times, track.keyCount, t);
  const f = segmentFraction(track, i, t);
  return segmentComponent(track, i, f, 0);
}

function copyTransformMix(
  src: ResolvedTransformConstraint['baseMix'],
  dst: ResolvedTransformConstraint['sampledMix'],
): void {
  dst.rotate = src.rotate;
  dst.x = src.x;
  dst.y = src.y;
  dst.scaleX = src.scaleX;
  dst.scaleY = src.scaleY;
  dst.shearY = src.shearY;
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
// own entry. Exported package-internally so mesh-vertex sampling reuses the same cache for deform
// timelines (it is not part of the runtime-core public barrel).
export function getPreparedAnimation(pose: Pose, animation: Animation): PreparedAnimation {
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

  // ik/transform/deform records are REQUIRED on a validated Animation (ADR-0004), but a hand-built
  // draft (a test fixture, an unmigrated doc) may omit them; tolerate that with an empty default rather
  // than throwing while reading the document.
  const ikIndexByName = nameIndexOf(pose.ikConstraints);
  const ikChannels: PreparedIkChannel[] = [];
  const ik = animation.ik ?? {};
  for (const constraintName of Object.keys(ik)) {
    const frames = ik[constraintName]!;
    if (frames.length === 0) continue;
    ikChannels.push({
      constraintIndex: ikIndexByName.get(constraintName) ?? -1,
      mix: buildIkMixTrack(frames),
      bendPositive: buildBendTrack(frames),
    });
  }

  const transformIndexByName = nameIndexOf(pose.transformConstraints);
  const transformChannels: PreparedTransformChannel[] = [];
  const transform = animation.transform ?? {};
  for (const constraintName of Object.keys(transform)) {
    const frames = transform[constraintName]!;
    if (frames.length === 0) continue;
    transformChannels.push({
      constraintIndex: transformIndexByName.get(constraintName) ?? -1,
      mixRotate: buildTransformMixTrack(frames, 'mixRotate'),
      mixX: buildTransformMixTrack(frames, 'mixX'),
      mixY: buildTransformMixTrack(frames, 'mixY'),
      mixScaleX: buildTransformMixTrack(frames, 'mixScaleX'),
      mixScaleY: buildTransformMixTrack(frames, 'mixScaleY'),
      mixShearY: buildTransformMixTrack(frames, 'mixShearY'),
    });
  }

  const deformChannels: PreparedDeformChannel[] = [];
  const deform = animation.deform ?? {};
  for (const skinName of Object.keys(deform)) {
    const bySlot = deform[skinName]!;
    for (const slotName of Object.keys(bySlot)) {
      const byAttachment = bySlot[slotName]!;
      for (const attachmentName of Object.keys(byAttachment)) {
        const frames = byAttachment[attachmentName]!;
        if (frames.length === 0) continue;
        deformChannels.push({
          skin: skinName,
          slot: slotName,
          attachment: attachmentName,
          track: buildDeformTrack(frames),
        });
      }
    }
  }

  return { boneChannels, slotChannels, ikChannels, transformChannels, deformChannels };
}

function nameIndex(names: readonly string[]): Map<string, number> {
  const index = new Map<string, number>();
  for (let i = 0; i < names.length; i += 1) index.set(names[i]!, i);
  return index;
}

// The name -> array-index map for the pose's resolved constraints, so a timeline keyed by constraint
// name resolves to the constraint's slot in pose.ikConstraints / pose.transformConstraints.
function nameIndexOf(items: readonly { readonly name: string }[]): Map<string, number> {
  const index = new Map<string, number>();
  for (let i = 0; i < items.length; i += 1) index.set(items[i]!.name, i);
  return index;
}
