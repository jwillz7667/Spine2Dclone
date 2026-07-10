import type { Animation, BoneTimelines, SkeletonDocument } from '@marionette/format/types';
import { composeInto, MAT2X3_STRIDE } from '../math/affine';
import {
  resolveWorld,
  solveIkOneBone,
  solveIkTwoBone,
  solvePathConstraint,
  solveTransformConstraint,
} from '../solve';
import type { TransformMix } from '../solve/transform-constraint';
import { SETUP_STRIDE, SLOT_COLOR_STRIDE } from './pose';
import type {
  Pose,
  ResolvedIkConstraint,
  ResolvedPathConstraint,
  ResolvedTransformConstraint,
} from './pose';
import type {
  PreparedAnimation,
  PreparedBoneChannels,
  PreparedDeformChannel,
  PreparedIkChannel,
  PreparedPathChannel,
  PreparedSlotChannels,
  PreparedTrack,
  PreparedTransformChannel,
} from './prepared';
import {
  buildAlphaTrack,
  buildAttachmentTrack,
  buildBendTrack,
  buildColorTrack,
  buildComponentTrack,
  buildRgbTrack,
  buildDeformTrack,
  buildDrawOrderTimeline,
  buildIkDepthBoolTrack,
  buildIkMixTrack,
  buildIkSoftnessTrack,
  buildPathTrack,
  buildScalarTrack,
  buildTransformMixTrack,
  buildVec2Track,
  findDrawOrderKeyIndex,
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
  // The active skin for skin-scoped constraints (ADR-0009 section 5, ADR-0011 section 4). null (the
  // default) leaves only the always-active 'default' skin active, so a scoped constraint stays inactive
  // and every non-scoped rig is unaffected. A constraint no skin scopes is always solved.
  activeSkin: string | null = null,
): void {
  const animation = document.animations[animationId];
  if (animation === undefined) throw new AnimationNotFoundError(animationId);

  const prepared = getPreparedAnimation(outPose, animation);

  // Step 1: reset to setup pose (bones write their local matrices; slots reset color + attachment;
  // constraints reset their sampled mix/bendPositive to the constraint definition's base values), then
  // arm the blend scratch (blendLocal <- setup, touched cleared, discrete winner weights reset).
  resetToSetupPose(outPose);
  resetSlotsToSetup(outPose);
  resetConstraintsToBase(outPose);
  beginBlend(outPose);

  // Step 2: apply the single animation at full weight (alpha 1, non-additive, discrete channels win).
  // This is the SAME internal path AnimationState drives per track; at (1, false, true) the blend math
  // short-circuits to write each sampled channel verbatim, so composing from blendLocal below is
  // bit-identical to the historical direct composition (the byte-locked fixtures gate that neutrality).
  applyAnimationAt(outPose, prepared, t, 1, false, true);
  composeTouchedBones(outPose);

  // Step 3: solve constraints: ALL IK constraints first, then ALL transform constraints, each in
  // document array order (ADR-0003 section 3). Constraints write LOCAL only. A skin-scoped constraint is
  // skipped unless its skin is active.
  solveConstraints(outPose, activeSkin);

  // Step 4: world transforms (single forward pass, parents before children). Because step 3 wrote only
  // local transforms, this pass is unconditional and reproduces every constraint's intended world.
  computeWorldTransforms(outPose);
}

// Arm the per-frame blend scratch (ADR-0005). blendLocal starts at the setup transform (the base every
// track lerps its keyed channels away from), no bone is touched yet, and every discrete winner weight is
// reset to -1 so the first keying track wins. Allocation-free: a typed-array copy and two fills into the
// pre-allocated pose scratch. Must run AFTER resetToSetupPose (both read pose.setup; order is irrelevant
// but the reset also writes local for the untouched bones the compose pass leaves alone).
export function beginBlend(pose: Pose): void {
  pose.blendLocal.set(pose.setup);
  pose.boneTouched.fill(0);
  pose.slotAttachmentWinWeight.fill(-1);
  pose.ikBendWinWeight.fill(-1);
  pose.ikStretchWinWeight.fill(-1);
  pose.ikCompressWinWeight.fill(-1);
  pose.drawOrderWinWeight[0] = -1;
}

// Compose each bone the track loop touched from its blended local components (blendLocal) into the
// local matrix (pose.local). Untouched bones keep the reset-to-setup local resetToSetupPose wrote, so a
// single-animation frame recomposes exactly the animated bones, identical to the historical path.
// Allocation-free: composeInto writes into the pre-allocated local buffer.
export function composeTouchedBones(pose: Pose): void {
  const { blendLocal, boneTouched, local, boneCount } = pose;
  for (let i = 0; i < boneCount; i += 1) {
    if (boneTouched[i] === 0) continue;
    const s = i * SETUP_STRIDE;
    composeInto(
      local,
      i * MAT2X3_STRIDE,
      blendLocal[s]!,
      blendLocal[s + 1]!,
      blendLocal[s + 2]!,
      blendLocal[s + 3]!,
      blendLocal[s + 4]!,
      blendLocal[s + 5]!,
      blendLocal[s + 6]!,
    );
  }
}

// Normalize an angle delta (degrees) into the half-open interval (-180, 180], the shortest signed arc.
// -180 maps to +180 (the interval is open on the left, closed on the right). Used by rotation blending
// so a replace-toward or additive rotation takes the short way around, never the long way (ADR-0005
// rules 2 and 3). Pure arithmetic (a single modulo plus one conditional add), no trig, so every runtime
// reproduces it bit-for-bit.
function normalizeDeltaDeg(delta: number): number {
  let r = delta % 360;
  if (r > 180) r -= 360;
  else if (r <= -180) r += 360;
  return r;
}

// Replace-toward blend for a linear (componentwise) channel: lerp current toward the animation's sampled
// value by weight w (ADR-0005 rule 2). w >= 1 returns `sampled` VERBATIM (the single-animation and
// fully-faded-in cases), which is what makes the refactor bit-neutral; w <= 0 leaves current untouched.
function blendReplaceLinear(current: number, sampled: number, w: number): number {
  if (w >= 1) return sampled;
  if (w <= 0) return current;
  return current + (sampled - current) * w;
}

// Replace-toward blend for rotation (degrees): lerp along the SHORTEST arc (ADR-0005 rule 2). w >= 1
// returns `sampled` verbatim (bit-neutral full weight); otherwise walk the normalized short delta by w.
function blendReplaceRotation(current: number, sampled: number, w: number): number {
  if (w >= 1) return sampled;
  if (w <= 0) return current;
  return current + normalizeDeltaDeg(sampled - current) * w;
}

// Additive blend for a linear channel: add the animation's delta-from-setup, scaled by w, onto the
// running (lower-layer) value (ADR-0005 rule 3). Never taken by the single-animation path.
function blendAddLinear(current: number, setupValue: number, sampled: number, w: number): number {
  return current + (sampled - setupValue) * w;
}

// Additive blend for rotation: add the normalized short delta-from-setup, scaled by w (ADR-0005 rule 3).
function blendAddRotation(current: number, setupValue: number, sampled: number, w: number): number {
  return current + normalizeDeltaDeg(sampled - setupValue) * w;
}

// Whether a constraint participates in the solve under the active skin (ADR-0009 section 5, ADR-0011
// section 4). Unscoped (scopeSkins null) constraints are always active; a scoped one is active when the
// 'default' skin scopes it (the default skin is always active) or when the frame's active skin is one of
// its scoping skins. Allocation-free: a short scan of the scoping name list (empty for the common case).
function isConstraintScopeActive(
  scopeSkins: readonly string[] | null,
  activeSkin: string | null,
): boolean {
  if (scopeSkins === null) return true;
  for (let i = 0; i < scopeSkins.length; i += 1) {
    const skin = scopeSkins[i]!;
    if (skin === 'default' || skin === activeSkin) return true;
  }
  return false;
}

// Solve one IK constraint against the pose (ADR-0003 section 4, depth per ADR-0010 section 2). Reads the
// target world origin into the module scratch and dispatches one/two-bone. A constraint with an
// unresolved bone/target index (-1) or non-positive mix is a no-op; a skin-scoped constraint whose skin is
// inactive is skipped. The per-constraint sampled scratch (mix, bend, softness, stretch, compress) was
// written by step 2; `uniform` is the static definition flag.
function solveOneIkConstraint(
  pose: Pose,
  constraint: ResolvedIkConstraint,
  activeSkin: string | null,
): void {
  if (!isConstraintScopeActive(constraint.scopeSkins, activeSkin)) return;
  const targetIndex = constraint.targetIndex;
  if (targetIndex < 0) return;
  const sampled = constraint.sampled;
  if (sampled.mix <= 0) return;
  const boneIndices = constraint.boneIndices;

  resolveWorld(pose, targetIndex, targetWorldScratch, 0);
  const targetX = targetWorldScratch[4]!;
  const targetY = targetWorldScratch[5]!;

  if (boneIndices.length === 1) {
    const boneIndex = boneIndices[0]!;
    if (boneIndex < 0) return;
    solveIkOneBone(
      pose,
      boneIndex,
      targetX,
      targetY,
      sampled.mix,
      sampled.stretch,
      sampled.compress,
    );
  } else {
    const parentIndex = boneIndices[0]!;
    const childIndex = boneIndices[1]!;
    if (parentIndex < 0 || childIndex < 0) return;
    solveIkTwoBone(
      pose,
      parentIndex,
      childIndex,
      targetX,
      targetY,
      sampled.bendPositive,
      sampled.mix,
      sampled.softness,
      sampled.stretch,
      sampled.compress,
      constraint.uniform,
    );
  }
}

// Solve one transform constraint against the pose (ADR-0003 section 5). Applies to each constrained bone
// in stored order; an unresolved bone/target index is skipped, as is a scoped constraint whose skin is
// inactive.
function solveOneTransformConstraint(
  pose: Pose,
  constraint: ResolvedTransformConstraint,
  activeSkin: string | null,
): void {
  if (!isConstraintScopeActive(constraint.scopeSkins, activeSkin)) return;
  const targetIndex = constraint.targetIndex;
  if (targetIndex < 0) return;
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
      constraint.local,
      constraint.relative,
    );
  }
}

// Solve one path constraint against the pose (ADR-0013, PP-B6). A skin-scoped constraint whose skin is
// inactive is skipped; otherwise the constraint distributes and orients its bones along the target path. The
// per-constraint sampled scratch (position, spacing, mix*) was written by step 2 (else reset to the base).
function solveOnePathConstraint(
  pose: Pose,
  constraint: ResolvedPathConstraint,
  activeSkin: string | null,
): void {
  if (!isConstraintScopeActive(constraint.scopeSkins, activeSkin)) return;
  solvePathConstraint(pose, constraint);
}

// Solve step 3 (ADR-0003 section 3, ordering per ADR-0009 section 1.3 / ADR-0010 section 1 / ADR-0011
// section 2.3). Default (pose.solveOrder null): all IK constraints, then all transform constraints, then all
// PATH constraints, each in document order. When the rig assigns an explicit `order`, `pose.solveOrder` is
// the precomputed dense schedule spanning all three arrays and step 3 walks it, dispatching each code to the
// SAME per-constraint helper the default path uses (so a constraint is bit-identical either way; only the
// schedule moves). Allocation-free: target world goes into the module scratch; the schedule is precomputed.
export function solveConstraints(pose: Pose, activeSkin: string | null = null): void {
  const { ikConstraints, transformConstraints, pathConstraints, solveOrder } = pose;

  if (solveOrder === null) {
    for (let i = 0; i < ikConstraints.length; i += 1) {
      solveOneIkConstraint(pose, ikConstraints[i]!, activeSkin);
    }
    for (let i = 0; i < transformConstraints.length; i += 1) {
      solveOneTransformConstraint(pose, transformConstraints[i]!, activeSkin);
    }
    for (let i = 0; i < pathConstraints.length; i += 1) {
      solveOnePathConstraint(pose, pathConstraints[i]!, activeSkin);
    }
    return;
  }

  const ikCount = ikConstraints.length;
  const transformCount = transformConstraints.length;
  const pathBase = ikCount + transformCount;
  for (let p = 0; p < solveOrder.length; p += 1) {
    const code = solveOrder[p]!;
    if (code < ikCount) {
      solveOneIkConstraint(pose, ikConstraints[code]!, activeSkin);
    } else if (code < pathBase) {
      solveOneTransformConstraint(pose, transformConstraints[code - ikCount]!, activeSkin);
    } else {
      solveOnePathConstraint(pose, pathConstraints[code - pathBase]!, activeSkin);
    }
  }
}

// Reset every constraint's per-frame sampled scratch to the constraint definition's base values, the
// constraint analogue of resetSlotsToSetup. Step 2 then overlays the keyed channels; a constraint or
// channel an animation does not key keeps its base. Allocation-free: it mutates the pose-owned scratch
// objects in place (no array or object is created), so a constraint-free rig does nothing here.
export function resetConstraintsToBase(pose: Pose): void {
  const { ikConstraints, transformConstraints } = pose;
  for (let i = 0; i < ikConstraints.length; i += 1) {
    const constraint = ikConstraints[i]!;
    constraint.sampled.mix = constraint.baseMix;
    constraint.sampled.bendPositive = constraint.baseBendPositive;
    constraint.sampled.softness = constraint.baseSoftness;
    constraint.sampled.stretch = constraint.baseStretch;
    constraint.sampled.compress = constraint.baseCompress;
  }
  for (let i = 0; i < transformConstraints.length; i += 1) {
    const constraint = transformConstraints[i]!;
    copyTransformMix(constraint.baseMix, constraint.sampledMix);
  }
  // Path constraints (ADR-0013): reset the sampled position/spacing/mix* to the definition base; step 2's
  // path timeline then overlays any keyed channel, and an unkeyed channel keeps its base.
  for (let i = 0; i < pose.pathConstraints.length; i += 1) {
    const constraint = pose.pathConstraints[i]!;
    constraint.sampled.position = constraint.basePosition;
    constraint.sampled.spacing = constraint.baseSpacing;
    constraint.sampled.mixRotate = constraint.baseMixRotate;
    constraint.sampled.mixX = constraint.baseMixX;
    constraint.sampled.mixY = constraint.baseMixY;
  }
}

// Sample a single-component track at t. Reuses the shared segment lookup so the curve handling
// (linear/stepped/bezier and the single-period clamp) matches every other channel.
function sampleScalarTrack(track: PreparedTrack, t: number): number {
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
export function resetSlotsToSetup(pose: Pose): void {
  const { slotColor, slotSetupColor, slotAttachment, slotSetupAttachment, slotCount } = pose;
  slotColor.set(slotSetupColor);
  // Reset the two-color dark tint to its setup (ADR-0009 section 4.3). Allocation-free typed-array copy.
  pose.slotDarkColor.set(pose.slotSetupDarkColor);
  // Step 1 also resets the render order to the setup (identity) draw order, so a frame with no active
  // draw-order key renders in setup slot order. Allocation-free: a typed-array copy (ADR-0008, PP-B4).
  pose.drawOrder.set(pose.slotSetupDrawOrder);
  for (let i = 0; i < slotCount; i += 1) {
    slotAttachment[i] = slotSetupAttachment[i] ?? null;
  }
}

// Apply ONE prepared animation at time t and blend weight `alpha` onto the running blend scratch, the
// single internal step-2 path both sampleSkeleton (one call at alpha 1) and AnimationState (one call per
// track/mix entry) drive (ADR-0005 implementation shape). It blends the LOCAL COMPONENTS (blendLocal),
// slot color, and constraint mix like continuous channels, and resolves attachment / bendPositive as
// discrete greater-weight-wins channels; it never composes matrices or solves constraints (the caller
// composes touched bones after the last entry, then solves). Semantics:
//   - non-additive (rule 2): each keyed channel lerps blendLocal toward the animation's sampled value by
//     alpha; rotation lerps along the shortest arc, everything else componentwise. At alpha 1 the sampled
//     value is written verbatim, so the single-animation path is bit-identical to the historical compose.
//   - additive (rule 3): each keyed continuous channel adds (sampled - setup) * alpha; rotation adds the
//     normalized short delta. `discreteWins` is false for additive tracks (they ignore discrete channels).
//   - discrete (rule 5): attachment and IK bendPositive are written only when discreteWins is set and this
//     entry's alpha is >= the running winner weight, so the greatest-weight entry wins and a tie (equal
//     weight) goes to the later-applied entry (the incoming side of a crossfade, applied after outgoing).
// Only KEYED channels are touched; unkeyed lanes stay as lower layers left them (rule 2). Allocation-free:
// every write targets pre-allocated pose scratch.
export function applyAnimationAt(
  pose: Pose,
  prepared: PreparedAnimation,
  t: number,
  alpha: number,
  additive: boolean,
  discreteWins: boolean,
): void {
  applyBoneEntry(pose, prepared, t, alpha, additive);
  applySlotEntry(pose, prepared, t, alpha, additive, discreteWins);
  applyConstraintEntry(pose, prepared, t, alpha, additive, discreteWins);
  applyDrawOrderEntry(pose, prepared, t, alpha, discreteWins);
}

// Apply this animation's active draw-order key as a discrete, whole-skeleton greater-weight-wins channel
// (ADR-0008, PP-B4; the draw-order analogue of the attachment swap, ADR-0005 rule 5). An additive track
// (discreteWins false) never touches draw order (rule 3). The active key is the latest at or before t
// (stepped); below the first key none is active and the reset setup order holds. A key whose owning
// track's weight wins (or ties, later-applied incoming wins) overwrites the whole render order with the
// precomputed permutation. Allocation-free: one typed-array copy plus a scalar winner-weight write.
function applyDrawOrderEntry(
  pose: Pose,
  prepared: PreparedAnimation,
  t: number,
  alpha: number,
  discreteWins: boolean,
): void {
  const timeline = prepared.drawOrder;
  if (timeline === null || !discreteWins) return;
  if (alpha < pose.drawOrderWinWeight[0]!) return;
  const i = findDrawOrderKeyIndex(timeline, t);
  if (i < 0) return;
  pose.drawOrder.set(timeline.orders[i]!);
  pose.drawOrderWinWeight[0] = alpha;
}

// Blend one animation's keyed bone channels into blendLocal (ADR-0005 rules 2/3). rotate blends the
// rotation lane, translate the x/y lanes, scale the scaleX/scaleY lanes, shear the shearX/shearY lanes;
// each keyed bone is marked touched so composeTouchedBones recomposes exactly the animated bones. The
// segment index and fraction are computed once per channel (vec2 channels share them across components).
function applyBoneEntry(
  pose: Pose,
  prepared: PreparedAnimation,
  t: number,
  alpha: number,
  additive: boolean,
): void {
  const { boneChannels } = prepared;
  const { setup, blendLocal, boneTouched } = pose;
  for (let bc = 0; bc < boneChannels.length; bc += 1) {
    const channels: PreparedBoneChannels = boneChannels[bc]!;
    const boneIndex = channels.boneIndex;
    if (boneIndex < 0) continue;

    const s = boneIndex * SETUP_STRIDE;
    let touched = false;

    const rotate = channels.rotate;
    if (rotate !== null) {
      const i = findSegmentIndex(rotate.times, rotate.keyCount, t);
      const f = segmentFraction(rotate, i, t);
      const sampled = setup[s + 2]! + segmentComponent(rotate, i, f, 0);
      blendLocal[s + 2] = additive
        ? blendAddRotation(blendLocal[s + 2]!, setup[s + 2]!, sampled, alpha)
        : blendReplaceRotation(blendLocal[s + 2]!, sampled, alpha);
      touched = true;
    }

    const translate = channels.translate;
    if (translate !== null) {
      const i = findSegmentIndex(translate.times, translate.keyCount, t);
      const f = segmentFraction(translate, i, t);
      const sx = setup[s]! + segmentComponent(translate, i, f, 0);
      const sy = setup[s + 1]! + segmentComponent(translate, i, f, 1);
      blendLocal[s] = additive
        ? blendAddLinear(blendLocal[s]!, setup[s]!, sx, alpha)
        : blendReplaceLinear(blendLocal[s]!, sx, alpha);
      blendLocal[s + 1] = additive
        ? blendAddLinear(blendLocal[s + 1]!, setup[s + 1]!, sy, alpha)
        : blendReplaceLinear(blendLocal[s + 1]!, sy, alpha);
      touched = true;
    }

    const scale = channels.scale;
    if (scale !== null) {
      const i = findSegmentIndex(scale.times, scale.keyCount, t);
      const f = segmentFraction(scale, i, t);
      const sx = setup[s + 3]! * segmentComponent(scale, i, f, 0);
      const sy = setup[s + 4]! * segmentComponent(scale, i, f, 1);
      blendLocal[s + 3] = additive
        ? blendAddLinear(blendLocal[s + 3]!, setup[s + 3]!, sx, alpha)
        : blendReplaceLinear(blendLocal[s + 3]!, sx, alpha);
      blendLocal[s + 4] = additive
        ? blendAddLinear(blendLocal[s + 4]!, setup[s + 4]!, sy, alpha)
        : blendReplaceLinear(blendLocal[s + 4]!, sy, alpha);
      touched = true;
    }

    const shear = channels.shear;
    if (shear !== null) {
      const i = findSegmentIndex(shear.times, shear.keyCount, t);
      const f = segmentFraction(shear, i, t);
      const sx = setup[s + 5]! + segmentComponent(shear, i, f, 0);
      const sy = setup[s + 6]! + segmentComponent(shear, i, f, 1);
      blendLocal[s + 5] = additive
        ? blendAddLinear(blendLocal[s + 5]!, setup[s + 5]!, sx, alpha)
        : blendReplaceLinear(blendLocal[s + 5]!, sx, alpha);
      blendLocal[s + 6] = additive
        ? blendAddLinear(blendLocal[s + 6]!, setup[s + 6]!, sy, alpha)
        : blendReplaceLinear(blendLocal[s + 6]!, sy, alpha);
      touched = true;
    }

    // Per-component split tracks (ADR-0009 section 4.1). Each writes ONE local component with the same
    // math as the corresponding joint component (translate/shear are setup + value, scale is setup *
    // value). The format's coexistence ban guarantees a channel's joint and split forms never both key,
    // so applying every present track cannot double-write a component.
    if (applyBoneScalar(channels.translateX, blendLocal, setup, s, false, t, alpha, additive))
      touched = true;
    if (applyBoneScalar(channels.translateY, blendLocal, setup, s + 1, false, t, alpha, additive))
      touched = true;
    if (applyBoneScalar(channels.scaleX, blendLocal, setup, s + 3, true, t, alpha, additive))
      touched = true;
    if (applyBoneScalar(channels.scaleY, blendLocal, setup, s + 4, true, t, alpha, additive))
      touched = true;
    if (applyBoneScalar(channels.shearX, blendLocal, setup, s + 5, false, t, alpha, additive))
      touched = true;
    if (applyBoneScalar(channels.shearY, blendLocal, setup, s + 6, false, t, alpha, additive))
      touched = true;

    if (touched) boneTouched[boneIndex] = 1;
  }
}

// Apply one split scalar bone track to a single local-component lane, matching the joint channel's math:
// `multiplicative` (scale) composes as setup * value, else (translate, shear) as setup + value; the result
// blends onto blendLocal by alpha (additive adds the delta from setup). Returns whether the track applied
// (null tracks are absent). Kept allocation-free and shaped like the joint blend so a split-keyed bone
// produces the identical world affine a joint-keyed one would for equivalent values.
function applyBoneScalar(
  track: PreparedTrack | null,
  blendLocal: Float64Array,
  setup: Float64Array,
  lane: number,
  multiplicative: boolean,
  t: number,
  alpha: number,
  additive: boolean,
): boolean {
  if (track === null) return false;
  const i = findSegmentIndex(track.times, track.keyCount, t);
  const f = segmentFraction(track, i, t);
  const raw = segmentComponent(track, i, f, 0);
  const sampled = multiplicative ? setup[lane]! * raw : setup[lane]! + raw;
  blendLocal[lane] = additive
    ? blendAddLinear(blendLocal[lane]!, setup[lane]!, sampled, alpha)
    : blendReplaceLinear(blendLocal[lane]!, sampled, alpha);
  return true;
}

// Blend one animation's slot channels: color REPLACES/adds like a continuous channel (rule 2/3, per-
// component RGBA); attachment is the discrete greater-weight-wins swap (rule 5), written only when this
// entry participates in discrete resolution and its weight wins/ties the running winner for the slot.
function applySlotEntry(
  pose: Pose,
  prepared: PreparedAnimation,
  t: number,
  alpha: number,
  additive: boolean,
  discreteWins: boolean,
): void {
  const { slotChannels } = prepared;
  const {
    slotColor,
    slotSetupColor,
    slotDarkColor,
    slotSetupDarkColor,
    slotAttachment,
    slotAttachmentWinWeight,
  } = pose;
  for (let sc = 0; sc < slotChannels.length; sc += 1) {
    const channels: PreparedSlotChannels = slotChannels[sc]!;
    const slotIndex = channels.slotIndex;
    if (slotIndex < 0) continue;
    const base = slotIndex * SLOT_COLOR_STRIDE;

    const color = channels.color;
    if (color !== null) {
      const i = findSegmentIndex(color.times, color.keyCount, t);
      const f = segmentFraction(color, i, t);
      for (let k = 0; k < SLOT_COLOR_STRIDE; k += 1) {
        const sampled = segmentComponent(color, i, f, k);
        slotColor[base + k] = additive
          ? blendAddLinear(slotColor[base + k]!, slotSetupColor[base + k]!, sampled, alpha)
          : blendReplaceLinear(slotColor[base + k]!, sampled, alpha);
      }
    }

    // Split color (ADR-0009 section 4.2): `rgb` writes lanes 0..2, `alpha` lane 3. The coexistence ban
    // means these never run alongside the joint `color` on the same slot.
    const rgb = channels.rgb;
    if (rgb !== null) {
      const i = findSegmentIndex(rgb.times, rgb.keyCount, t);
      const f = segmentFraction(rgb, i, t);
      for (let k = 0; k < 3; k += 1) {
        const sampled = segmentComponent(rgb, i, f, k);
        slotColor[base + k] = additive
          ? blendAddLinear(slotColor[base + k]!, slotSetupColor[base + k]!, sampled, alpha)
          : blendReplaceLinear(slotColor[base + k]!, sampled, alpha);
      }
    }
    const alphaTrack = channels.alpha;
    if (alphaTrack !== null) {
      const i = findSegmentIndex(alphaTrack.times, alphaTrack.keyCount, t);
      const f = segmentFraction(alphaTrack, i, t);
      const sampled = segmentComponent(alphaTrack, i, f, 0);
      slotColor[base + 3] = additive
        ? blendAddLinear(slotColor[base + 3]!, slotSetupColor[base + 3]!, sampled, alpha)
        : blendReplaceLinear(slotColor[base + 3]!, sampled, alpha);
    }

    // Keyable two-color dark tint (ADR-0009 section 4.3): blends into the pose's dark-color lane like the
    // RGBA color, over the setup dark tint. Renderers read slotDarkColor for the two-color draw.
    const dark = channels.dark;
    if (dark !== null) {
      const i = findSegmentIndex(dark.times, dark.keyCount, t);
      const f = segmentFraction(dark, i, t);
      for (let k = 0; k < SLOT_COLOR_STRIDE; k += 1) {
        const sampled = segmentComponent(dark, i, f, k);
        slotDarkColor[base + k] = additive
          ? blendAddLinear(slotDarkColor[base + k]!, slotSetupDarkColor[base + k]!, sampled, alpha)
          : blendReplaceLinear(slotDarkColor[base + k]!, sampled, alpha);
      }
    }

    const attachment = channels.attachment;
    if (attachment !== null && discreteWins && alpha >= slotAttachmentWinWeight[slotIndex]!) {
      slotAttachment[slotIndex] = sampleAttachmentName(attachment, t);
      slotAttachmentWinWeight[slotIndex] = alpha;
    }
  }
}

// Blend one animation's constraint mix channels (ADR-0005 rule 7: continuous, blended like locals) and
// resolve the discrete IK bendPositive (rule 5). Each present transform mix sub-channel blends toward its
// sampled value; an absent sub-channel keeps whatever lower layers left (the reset base for track 0). A
// channel resolved to a constraint the pose lacks (constraintIndex -1) is ignored.
function applyConstraintEntry(
  pose: Pose,
  prepared: PreparedAnimation,
  t: number,
  alpha: number,
  additive: boolean,
  discreteWins: boolean,
): void {
  const { ikChannels, transformChannels, pathChannels } = prepared;
  const {
    ikConstraints,
    transformConstraints,
    pathConstraints,
    ikBendWinWeight,
    ikStretchWinWeight,
    ikCompressWinWeight,
  } = pose;

  for (let c = 0; c < ikChannels.length; c += 1) {
    const channel: PreparedIkChannel = ikChannels[c]!;
    const index = channel.constraintIndex;
    if (index < 0) continue;
    const constraint = ikConstraints[index]!;
    const sampled = constraint.sampled;
    if (channel.mix !== null) {
      const value = sampleScalarTrack(channel.mix, t);
      sampled.mix = additive
        ? blendAddLinear(sampled.mix, constraint.baseMix, value, alpha)
        : blendReplaceLinear(sampled.mix, value, alpha);
    }
    // softness blends like mix (a continuous world-unit distance); a negative additive result is floored
    // at 0 to keep the non-negative contract the solve's soft-reach remap relies on.
    if (channel.softness !== null) {
      const value = sampleScalarTrack(channel.softness, t);
      const blended = additive
        ? blendAddLinear(sampled.softness, constraint.baseSoftness, value, alpha)
        : blendReplaceLinear(sampled.softness, value, alpha);
      sampled.softness = blended < 0 ? 0 : blended;
    }
    if (channel.bendPositive !== null && discreteWins && alpha >= ikBendWinWeight[index]!) {
      sampled.bendPositive = sampleStepBool(channel.bendPositive, t);
      ikBendWinWeight[index] = alpha;
    }
    // stretch/compress are discrete flags: the track with the greatest alpha this frame wins (ADR-0005
    // rule 5), exactly like the bend direction, each with its own per-constraint win weight.
    if (channel.stretch !== null && discreteWins && alpha >= ikStretchWinWeight[index]!) {
      sampled.stretch = sampleStepBool(channel.stretch, t);
      ikStretchWinWeight[index] = alpha;
    }
    if (channel.compress !== null && discreteWins && alpha >= ikCompressWinWeight[index]!) {
      sampled.compress = sampleStepBool(channel.compress, t);
      ikCompressWinWeight[index] = alpha;
    }
  }

  for (let c = 0; c < transformChannels.length; c += 1) {
    const channel: PreparedTransformChannel = transformChannels[c]!;
    const index = channel.constraintIndex;
    if (index < 0) continue;
    const constraint = transformConstraints[index]!;
    const mix = constraint.sampledMix;
    const base = constraint.baseMix;
    blendTransformMix(mix, base, 'rotate', channel.mixRotate, t, alpha, additive);
    blendTransformMix(mix, base, 'x', channel.mixX, t, alpha, additive);
    blendTransformMix(mix, base, 'y', channel.mixY, t, alpha, additive);
    blendTransformMix(mix, base, 'scaleX', channel.mixScaleX, t, alpha, additive);
    blendTransformMix(mix, base, 'scaleY', channel.mixScaleY, t, alpha, additive);
    blendTransformMix(mix, base, 'shearY', channel.mixShearY, t, alpha, additive);
  }

  // Path constraints (ADR-0011 section 3, ADR-0013): each channel is a continuous interpolated scalar
  // blended toward its keyed value by alpha (additive adds the delta from the constraint base), exactly
  // like the transform mix channels. position/spacing are unbounded; the mix channels are [0, 1] by the
  // format (PATH_MIX_RANGE), so no extra clamp is applied here (the base and keyed values are in range).
  for (let c = 0; c < pathChannels.length; c += 1) {
    const channel: PreparedPathChannel = pathChannels[c]!;
    const index = channel.constraintIndex;
    if (index < 0) continue;
    const constraint = pathConstraints[index]!;
    const sampled = constraint.sampled;
    blendPathScalar(
      sampled,
      'position',
      constraint.basePosition,
      channel.position,
      t,
      alpha,
      additive,
    );
    blendPathScalar(
      sampled,
      'spacing',
      constraint.baseSpacing,
      channel.spacing,
      t,
      alpha,
      additive,
    );
    blendPathScalar(
      sampled,
      'mixRotate',
      constraint.baseMixRotate,
      channel.mixRotate,
      t,
      alpha,
      additive,
    );
    blendPathScalar(sampled, 'mixX', constraint.baseMixX, channel.mixX, t, alpha, additive);
    blendPathScalar(sampled, 'mixY', constraint.baseMixY, channel.mixY, t, alpha, additive);
  }
}

// Blend one path-constraint sampled scalar channel in place. A null track means the channel is absent from
// this animation (leave the running value); otherwise blend toward the sampled value by alpha (additive
// adds the delta from the constraint's base value), the same rule as the transform mix channels.
function blendPathScalar(
  sampled: ResolvedPathConstraint['sampled'],
  key: 'position' | 'spacing' | 'mixRotate' | 'mixX' | 'mixY',
  base: number,
  track: PreparedTrack | null,
  t: number,
  alpha: number,
  additive: boolean,
): void {
  if (track === null) return;
  const value = sampleScalarTrack(track, t);
  sampled[key] = additive
    ? blendAddLinear(sampled[key], base, value, alpha)
    : blendReplaceLinear(sampled[key], value, alpha);
}

// Blend one transform-constraint mix sub-channel in place. A null track means the sub-channel is absent
// from this animation (leave the running value); otherwise blend toward the sampled factor by alpha
// (additive adds the delta from the constraint's base factor).
function blendTransformMix(
  mix: TransformMix,
  base: TransformMix,
  key: keyof TransformMix,
  track: PreparedTrack | null,
  t: number,
  alpha: number,
  additive: boolean,
): void {
  if (track === null) return;
  const value = sampleScalarTrack(track, t);
  mix[key] = additive
    ? blendAddLinear(mix[key], base[key], value, alpha)
    : blendReplaceLinear(mix[key], value, alpha);
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

  // Prepare one optional split component track (translateX/Y, scaleX/Y, shearX/Y): null when absent/empty.
  const componentTrack = (
    keys: NonNullable<BoneTimelines['translateX']> | undefined,
  ): PreparedTrack | null => (keys && keys.length > 0 ? buildComponentTrack(keys) : null);

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
      translateX: componentTrack(timelines.translateX),
      translateY: componentTrack(timelines.translateY),
      scaleX: componentTrack(timelines.scaleX),
      scaleY: componentTrack(timelines.scaleY),
      shearX: componentTrack(timelines.shearX),
      shearY: componentTrack(timelines.shearY),
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
      rgb: timelines.rgb && timelines.rgb.length > 0 ? buildRgbTrack(timelines.rgb) : null,
      alpha:
        timelines.alpha && timelines.alpha.length > 0 ? buildAlphaTrack(timelines.alpha) : null,
      dark: timelines.dark && timelines.dark.length > 0 ? buildColorTrack(timelines.dark) : null,
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
      softness: buildIkSoftnessTrack(frames),
      stretch: buildIkDepthBoolTrack(frames, 'stretch'),
      compress: buildIkDepthBoolTrack(frames, 'compress'),
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

  // Path-constraint timelines (ADR-0011 section 3, ADR-0013). Required on a validated Animation but
  // tolerated as empty on a hand-built draft, exactly like ik/transform above. Each channel is prepared
  // from only the frames that key it; an all-absent channel is null and holds the constraint base.
  const pathIndexByName = nameIndexOf(pose.pathConstraints);
  const pathChannels: PreparedPathChannel[] = [];
  const path = animation.path ?? {};
  for (const constraintName of Object.keys(path)) {
    const frames = path[constraintName]!;
    if (frames.length === 0) continue;
    pathChannels.push({
      constraintIndex: pathIndexByName.get(constraintName) ?? -1,
      position: buildPathTrack(frames, 'position'),
      spacing: buildPathTrack(frames, 'spacing'),
      mixRotate: buildPathTrack(frames, 'mixRotate'),
      mixX: buildPathTrack(frames, 'mixX'),
      mixY: buildPathTrack(frames, 'mixY'),
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

  // The draw-order timeline is resolved to full per-key render-order permutations at build time (ADR-0008
  // assigns the derivation to runtime-core). A hand-built draft may omit the required array; tolerate that
  // with an empty default (the same lenience the ik/transform/deform reads use above). Event timelines are
  // NOT prepared here: firing is a time-RANGE operation prepared separately (events.ts) with the document's
  // EventDef defaults, which prepareAnimation (keyed by Animation identity only) does not carry.
  const drawOrderKeys = animation.drawOrder ?? [];
  const drawOrder =
    drawOrderKeys.length > 0
      ? buildDrawOrderTimeline(drawOrderKeys, slotIndexByName, pose.slotCount)
      : null;

  return {
    boneChannels,
    slotChannels,
    ikChannels,
    transformChannels,
    pathChannels,
    deformChannels,
    drawOrder,
  };
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
