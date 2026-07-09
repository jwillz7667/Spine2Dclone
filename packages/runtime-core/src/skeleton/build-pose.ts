import type { IkConstraint, SkeletonDocument, TransformConstraint } from '@marionette/format/types';
import type { TransformMix, TransformOffset } from '../solve/transform-constraint';
import { allocatePose, SETUP_STRIDE, SLOT_COLOR_STRIDE } from './pose';
import type { Pose, ResolvedIkConstraint, ResolvedTransformConstraint } from './pose';
import { transformModeToCode } from './transform-mode';

// Build a Pose from a VALIDATED document (format-contract: validate on import, then the solve trusts
// the result). It allocates the buffers once, captures each bone's setup transform and each slot's
// setup color, active attachment name, and driving bone, resolves parent/slot bone names to indices,
// and resolves the IK/transform constraints to bone indices in document array order. It relies on, and
// does not re-check, the parent-precedes-child ordering invariant and the reference-resolution
// invariants the format validator guarantees; if a caller hands it an unvalidated document the solve
// is undefined (that boundary is the validator's job, not the solve's). A name that does not resolve is
// captured as -1 (mirroring the slot/parent handling) and skipped by the solve rather than crashing.
//
// The setup active attachment is the slot's `attachment` NAME (the renderer resolves it to geometry
// through the default skin); runtime-core captures the name only, so no rendering concern leaks into
// the platform-agnostic core. The default skin therefore needs no read here.
export function buildPose(document: SkeletonDocument): Pose {
  const bones = document.bones;
  const boneCount = bones.length;
  const boneNames = bones.map((bone) => bone.name);

  const slots = document.slots;
  const slotCount = slots.length;
  const slotNames = slots.map((slot) => slot.name);

  const indexByName = new Map<string, number>();
  for (let i = 0; i < boneCount; i += 1) {
    indexByName.set(boneNames[i]!, i);
  }

  // Skin-scoping map (ADR-0009 section 5): constraint name -> the skins that scope it. A constraint listed
  // in a skin's `constraints` is active only while one of those skins is active; a constraint in no list is
  // unscoped (always active). Built once here so the per-frame solve reads a captured `scopeSkins`.
  const scopeByConstraint = new Map<string, string[]>();
  for (const skin of document.skins) {
    for (const name of skin.constraints ?? []) {
      const existing = scopeByConstraint.get(name);
      if (existing !== undefined) existing.push(skin.name);
      else scopeByConstraint.set(name, [skin.name]);
    }
  }

  // A pre-0.2.0 draft may lack the constraint arrays (they were added in ADR-0004); tolerate that by
  // treating a missing array as empty, the same lenience buildPose already applies to unresolved names.
  const ikConstraints = (document.ikConstraints ?? []).map((c) =>
    resolveIk(c, indexByName, scopeByConstraint.get(c.name) ?? null),
  );
  const transformConstraints = (document.transformConstraints ?? []).map((c) =>
    resolveTransform(c, indexByName, scopeByConstraint.get(c.name) ?? null),
  );

  const pose = allocatePose(
    boneCount,
    boneNames,
    slotCount,
    slotNames,
    ikConstraints,
    transformConstraints,
  );

  for (let i = 0; i < boneCount; i += 1) {
    const bone = bones[i]!;
    pose.parentIndices[i] = bone.parent === null ? -1 : (indexByName.get(bone.parent) ?? -1);
    pose.transformModes[i] = transformModeToCode(bone.transformMode);
    pose.boneLength[i] = bone.length;
    const base = i * SETUP_STRIDE;
    pose.setup[base] = bone.x;
    pose.setup[base + 1] = bone.y;
    pose.setup[base + 2] = bone.rotation;
    pose.setup[base + 3] = bone.scaleX;
    pose.setup[base + 4] = bone.scaleY;
    pose.setup[base + 5] = bone.shearX;
    pose.setup[base + 6] = bone.shearY;
  }

  for (let i = 0; i < slotCount; i += 1) {
    const slot = slots[i]!;
    pose.slotBoneIndices[i] = indexByName.get(slot.bone) ?? -1;
    const base = i * SLOT_COLOR_STRIDE;
    pose.slotSetupColor[base] = slot.color.r;
    pose.slotSetupColor[base + 1] = slot.color.g;
    pose.slotSetupColor[base + 2] = slot.color.b;
    pose.slotSetupColor[base + 3] = slot.color.a;
    // Setup two-color dark tint (ADR-0009 section 4.3). Present only when the slot enables two-color
    // tinting; absent slots keep an inert (0, 0, 0, 1) so the reset is well-defined but renderers skip it
    // (slotHasDarkColor is 0). The dark tint's alpha channel is inert but carried for a total RGBA lane.
    const dark = slot.darkColor;
    pose.slotHasDarkColor[i] = dark === undefined ? 0 : 1;
    pose.slotSetupDarkColor[base] = dark?.r ?? 0;
    pose.slotSetupDarkColor[base + 1] = dark?.g ?? 0;
    pose.slotSetupDarkColor[base + 2] = dark?.b ?? 0;
    pose.slotSetupDarkColor[base + 3] = dark?.a ?? 1;
    pose.slotSetupAttachment[i] = slot.attachment;
  }

  return pose;
}

function resolveBoneIndices(
  names: readonly string[],
  indexByName: ReadonlyMap<string, number>,
): Int32Array {
  const indices = new Int32Array(names.length);
  for (let i = 0; i < names.length; i += 1) {
    indices[i] = indexByName.get(names[i]!) ?? -1;
  }
  return indices;
}

function resolveIk(
  constraint: IkConstraint,
  indexByName: ReadonlyMap<string, number>,
  scopeSkins: readonly string[] | null,
): ResolvedIkConstraint {
  const bendPositive = constraint.bend > 0;
  return {
    name: constraint.name,
    boneIndices: resolveBoneIndices(constraint.bones, indexByName),
    targetIndex: indexByName.get(constraint.target) ?? -1,
    baseMix: constraint.mix,
    // The format carries the signed bend direction (ADR-0009): +1 positive, -1 negative. The solve's
    // internal boolean keys on the same sign (bend > 0), so this read is numerically identical to the
    // pre-0.4.0 `bendPositive` boolean (migrated true -> +1, false -> -1).
    baseBendPositive: bendPositive,
    // Depth controls (ADR-0009 section 1.1, ADR-0010 section 2). Defaults from the F2 migration (softness
    // 0, stretch/compress/uniform false) reproduce the ADR-0003 hard solve.
    baseSoftness: constraint.softness,
    baseStretch: constraint.stretch,
    baseCompress: constraint.compress,
    uniform: constraint.uniform,
    order: constraint.order ?? -1,
    scopeSkins,
    sampled: {
      mix: constraint.mix,
      bendPositive,
      softness: constraint.softness,
      stretch: constraint.stretch,
      compress: constraint.compress,
    },
  };
}

function resolveTransform(
  constraint: TransformConstraint,
  indexByName: ReadonlyMap<string, number>,
  scopeSkins: readonly string[] | null,
): ResolvedTransformConstraint {
  const baseMix: TransformMix = {
    rotate: constraint.mixRotate,
    x: constraint.mixX,
    y: constraint.mixY,
    scaleX: constraint.mixScaleX,
    scaleY: constraint.mixScaleY,
    shearY: constraint.mixShearY,
  };
  const offset: TransformOffset = {
    rotation: constraint.offsetRotation,
    x: constraint.offsetX,
    y: constraint.offsetY,
    scaleX: constraint.offsetScaleX,
    scaleY: constraint.offsetScaleY,
    shearY: constraint.offsetShearY,
  };
  return {
    name: constraint.name,
    boneIndices: resolveBoneIndices(constraint.bones, indexByName),
    targetIndex: indexByName.get(constraint.target) ?? -1,
    baseMix,
    offset,
    // Variant flags (ADR-0009 section 1.2). Default false/false is the ADR-0003 world absolute blend.
    local: constraint.local,
    relative: constraint.relative,
    order: constraint.order ?? -1,
    scopeSkins,
    sampledMix: { ...baseMix },
  };
}
