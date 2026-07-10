import type {
  IkConstraint,
  PathAttachment,
  PathConstraint,
  PhysicsChannel,
  PhysicsConstraint,
  SkeletonDocument,
  Skin,
  TransformConstraint,
} from '@marionette/format/types';
import { PATH_CURVE_SUBDIVISIONS } from '../solve/path-constraint';
import type { PreparedPathGeometry } from '../solve/path-constraint';
import type { TransformMix, TransformOffset } from '../solve/transform-constraint';
import {
  PHYSICS_CHANNEL_ROTATION,
  PHYSICS_CHANNEL_SCALEX,
  PHYSICS_CHANNEL_SHEARX,
  PHYSICS_CHANNEL_X,
  PHYSICS_CHANNEL_Y,
} from '../solve/physics-constraint';
import { MAT2X3_STRIDE } from '../math/affine';
import { allocatePose, SETUP_STRIDE, SLOT_COLOR_STRIDE } from './pose';
import type {
  PhysicsSettings,
  Pose,
  ResolvedIkConstraint,
  ResolvedPathConstraint,
  ResolvedPhysicsConstraint,
  ResolvedTransformConstraint,
} from './pose';
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
  // Path constraints (ADR-0013, PP-B6). Their prepared spline geometry comes from the target slot's setup
  // default-skin path attachment (ADR-0013 section 7); a pre-0.5.0 draft may lack the array (tolerated as
  // empty, the same lenience as the IK/transform arrays).
  const slotBoneByName = new Map<string, number>();
  const slotSetupAttachmentByName = new Map<string, string | null>();
  for (const slot of slots) {
    slotBoneByName.set(slot.name, indexByName.get(slot.bone) ?? -1);
    slotSetupAttachmentByName.set(slot.name, slot.attachment);
  }
  const defaultSkin = document.skins.find((skin) => skin.name === 'default');
  const pathConstraints = (document.pathConstraints ?? []).map((c) =>
    resolvePath(
      c,
      indexByName,
      slotBoneByName,
      slotSetupAttachmentByName,
      defaultSkin,
      boneCount,
      scopeByConstraint.get(c.name) ?? null,
    ),
  );

  // Physics constraints (ADR-0014, PP-B7): resolve the bound bone to its index, translate the channel
  // strings to codes, and pre-allocate the per-channel simulation state. A pre-0.6.0 draft may lack the
  // array (tolerated as empty, the same lenience as the IK/transform/path arrays).
  const physicsConstraints = (document.physicsConstraints ?? []).map((c) =>
    resolvePhysics(c, indexByName, scopeByConstraint.get(c.name) ?? null),
  );
  // The skeleton-level physics settings (ADR-0014 section 5), or the identity defaults when absent.
  const physicsSettings: PhysicsSettings =
    document.physics === undefined
      ? { gravity: 0, wind: 0, mix: 1 }
      : {
          gravity: document.physics.gravity,
          wind: document.physics.wind,
          mix: document.physics.mix,
        };

  const pose = allocatePose(
    boneCount,
    boneNames,
    slotCount,
    slotNames,
    ikConstraints,
    transformConstraints,
    pathConstraints,
    physicsConstraints,
    physicsSettings,
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

// The logical control-point count of a path attachment: unweighted is vertices.length / 2; weighted walks
// the ADR-0002 self-delimiting stream (each logical vertex starts with its influence count, then that many
// [boneIndex, vx, vy, weight] quads) counting logical vertices. A validated document's stream is total, so
// the walk always lands exactly on stream.length.
function pathVertexCount(attachment: PathAttachment): number {
  const weighted = attachment.bones !== undefined && attachment.bones.length > 0;
  if (!weighted) return attachment.vertices.length / 2;
  const stream = attachment.vertices;
  let cursor = 0;
  let count = 0;
  while (cursor < stream.length) {
    const influenceCount = stream[cursor]!;
    cursor += 1 + influenceCount * 4;
    count += 1;
  }
  return count;
}

// Build the prepared spline geometry (ADR-0013 sections 1 to 3) from a path attachment and its slot bone.
// All per-frame scratch (world control points, the per-curve arc-length LUT, and, for a weighted path, the
// packed on-demand world buffer) is allocated ONCE here and reused every frame.
function preparePathGeometry(
  attachment: PathAttachment,
  slotBoneIndex: number,
  boneCount: number,
): PreparedPathGeometry {
  const weighted = attachment.bones !== undefined && attachment.bones.length > 0;
  const vertexCount = pathVertexCount(attachment);
  const curveCount = attachment.closed ? vertexCount / 3 : (vertexCount - 1) / 3;
  return {
    closed: attachment.closed,
    constantSpeed: attachment.constantSpeed,
    curveCount,
    vertexCount,
    lengths: Float64Array.from(attachment.lengths),
    weighted,
    localVertices: weighted ? [] : attachment.vertices,
    stream: weighted ? attachment.vertices : [],
    manifestBones: weighted ? (attachment.bones ?? null) : null,
    slotBoneIndex,
    worldPoints: new Float64Array(vertexCount * 2),
    curveLut: new Float64Array(curveCount * (PATH_CURVE_SUBDIVISIONS + 1)),
    boneWorldScratch: weighted ? new Float64Array(boneCount * MAT2X3_STRIDE) : null,
  };
}

// Resolve a path constraint (ADR-0013). The target names a SLOT; its setup default-skin path attachment
// supplies the geometry. A target slot that does not exist, has no setup attachment, or whose setup
// attachment (in the default skin) is not a path resolves `path` to null and the constraint solves nothing
// (the runtime concern ADR-0011 section 2.2 leaves here). A curve count that does not fit the control-point
// count (an unvalidated document) also resolves to null rather than producing a corrupt spline.
function resolvePath(
  constraint: PathConstraint,
  indexByName: ReadonlyMap<string, number>,
  slotBoneByName: ReadonlyMap<string, number>,
  slotSetupAttachmentByName: ReadonlyMap<string, string | null>,
  defaultSkin: Skin | undefined,
  boneCount: number,
  scopeSkins: readonly string[] | null,
): ResolvedPathConstraint {
  const targetSlot = constraint.target;
  const slotBoneIndex = slotBoneByName.get(targetSlot) ?? -1;
  const setupName = slotSetupAttachmentByName.get(targetSlot) ?? null;
  let path: PreparedPathGeometry | null = null;
  if (setupName !== null && defaultSkin !== undefined) {
    const attachment = defaultSkin.attachments[targetSlot]?.[setupName];
    if (attachment !== undefined && attachment.type === 'path') {
      const vertexCount = pathVertexCount(attachment);
      const fits = attachment.closed
        ? vertexCount >= 3 && vertexCount % 3 === 0
        : vertexCount >= 4 && (vertexCount - 1) % 3 === 0;
      if (fits && attachment.lengths.length > 0) {
        path = preparePathGeometry(attachment, slotBoneIndex, boneCount);
      }
    }
  }
  return {
    name: constraint.name,
    boneIndices: resolveBoneIndices(constraint.bones, indexByName),
    positionMode: constraint.positionMode,
    spacingMode: constraint.spacingMode,
    rotateMode: constraint.rotateMode,
    offsetRotation: constraint.offsetRotation,
    basePosition: constraint.position,
    baseSpacing: constraint.spacing,
    baseMixRotate: constraint.mixRotate,
    baseMixX: constraint.mixX,
    baseMixY: constraint.mixY,
    path,
    order: constraint.order ?? -1,
    scopeSkins,
    sampled: {
      position: constraint.position,
      spacing: constraint.spacing,
      mixRotate: constraint.mixRotate,
      mixX: constraint.mixX,
      mixY: constraint.mixY,
    },
  };
}

// Translate a physics channel string to its integer code (solve/physics-constraint.ts). The five channels
// are the bone's local pose properties the constraint simulates (ADR-0014 section 1).
function physicsChannelCode(channel: PhysicsChannel): number {
  switch (channel) {
    case 'x':
      return PHYSICS_CHANNEL_X;
    case 'y':
      return PHYSICS_CHANNEL_Y;
    case 'rotation':
      return PHYSICS_CHANNEL_ROTATION;
    case 'scaleX':
      return PHYSICS_CHANNEL_SCALEX;
    case 'shearX':
      return PHYSICS_CHANNEL_SHEARX;
  }
}

// Resolve a physics constraint (ADR-0014, PP-B7). The bound bone resolves to its index (-1 if unknown, then
// the solve is a no-op, the same lenience as the other constraints). The channel set becomes integer codes,
// and the per-channel simulation state (p, v, targetPrev), sized to the channel count, is pre-allocated here
// so the per-frame solve never allocates. `initialized` starts false so the first active solve initializes
// the bone to rest on its pose (ADR section 6). An unresolvable bone still gets a well-formed, inert record.
function resolvePhysics(
  constraint: PhysicsConstraint,
  indexByName: ReadonlyMap<string, number>,
  scopeSkins: readonly string[] | null,
): ResolvedPhysicsConstraint {
  const channelCount = constraint.channels.length;
  const channelCodes = new Int8Array(channelCount);
  let channelX = -1;
  let channelY = -1;
  for (let i = 0; i < channelCount; i += 1) {
    const code = physicsChannelCode(constraint.channels[i]!);
    channelCodes[i] = code;
    if (code === PHYSICS_CHANNEL_X) channelX = i;
    else if (code === PHYSICS_CHANNEL_Y) channelY = i;
  }
  return {
    name: constraint.name,
    boneIndex: indexByName.get(constraint.bone) ?? -1,
    channelCodes,
    simulatesX: channelX >= 0,
    simulatesY: channelY >= 0,
    channelX,
    channelY,
    baseStep: constraint.step,
    baseMass: constraint.mass,
    baseInertia: constraint.inertia,
    baseStrength: constraint.strength,
    baseDamping: constraint.damping,
    baseWind: constraint.wind,
    baseGravity: constraint.gravity,
    baseMix: constraint.mix,
    order: constraint.order ?? -1,
    scopeSkins,
    sampled: {
      inertia: constraint.inertia,
      strength: constraint.strength,
      damping: constraint.damping,
      wind: constraint.wind,
      gravity: constraint.gravity,
      mix: constraint.mix,
    },
    p: new Float64Array(channelCount),
    v: new Float64Array(channelCount),
    targetPrev: new Float64Array(channelCount),
    accFixed: 0,
    initialized: false,
  };
}
