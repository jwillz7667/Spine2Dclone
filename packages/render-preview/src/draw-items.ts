import type {
  BlendMode,
  MeshAttachment,
  RegionAttachment,
  SkeletonDocument,
  Skin,
} from '@marionette/format/types';
import {
  buildPose,
  computeWorldTransforms,
  MAT2X3_STRIDE,
  resetToSetupPose,
  resolveRenderMesh,
  sampleMeshVertices,
  sampleSkeleton,
  sampleSlotSequenceFrame,
  skinMeshInto,
  SLOT_COLOR_STRIDE,
  type Mat2x3,
  type Pose,
} from '@marionette/runtime-core';
import type { AtlasIndex, TextureSampler } from './atlas';
import type { Color } from './color';
import { UnknownAnimationError } from './errors';
import { sequenceRegionName } from './sequence-region';
import {
  regionWorldCorners,
  REGION_QUAD_TRIANGLES,
  REGION_QUAD_UVS,
  type RegionTrim,
} from './geometry';

// The one skin render-preview draws, matching runtime-web (skeleton-view.ts DEFAULT_SKIN_NAME). Skin
// switching is a later authoring surface; the solve and the records resolve attachments through this name.
const DEFAULT_SKIN_NAME = 'default';

// One drawable primitive in world space: a set of world vertices, their texture uvs, the triangle index
// list, the resolved tint/alpha, the slot blend mode, and the texture sampler. Region and mesh
// attachments both reduce to this shape, so the raster pass is uniform.
export interface DrawItem {
  // The slot this item was gathered from (document slot index). Used to match the item against the active
  // clip regions (clipping.ts): a clip attachment names, in draw order, the range of slots whose geometry it
  // clips (ADR-0012 section 3.1). Not part of the drawn geometry; a positional key only.
  readonly slotIndex: number;
  readonly worldPositions: readonly number[];
  readonly uvs: readonly number[];
  readonly triangles: readonly number[];
  // rgb is the slot color x attachment color tint (a is unused: `alpha` below is authoritative). This is
  // the LIGHT color of the two-color model (two-color.ts).
  readonly tint: Color;
  readonly alpha: number;
  readonly blend: BlendMode;
  readonly sampler: TextureSampler;
  // The two-color DARK tint (pose.slotDarkColor rgb; alpha inert, unused), or null when the slot declared
  // no setup darkColor (pose.slotHasDarkColor == 0). Null takes the byte-identical single-color raster
  // path; non-null fills the texel's shadow term through the shared two-color combine (raster.ts).
  readonly dark: Color | null;
}

// Reset every slot's resolved color to its setup color and its active attachment to its setup name, so
// the setup-pose render reads the same pose fields the animated render does. This mirrors runtime-web's
// resetSlotsToSetup (skeleton-view.ts), which itself mirrors runtime-core's internal slot reset: it is a
// setup-snapshot copy, NOT solve math, and lives here because runtime-core does not export the internal.
function resetSlotsToSetup(pose: Pose): void {
  pose.slotColor.set(pose.slotSetupColor);
  // Reset the two-color dark lane too (mirrors sampleSkeleton's step-1 slotDarkColor reset), so the
  // setup-pose two-color render reads the setup dark tint, not the zeroed allocation default.
  pose.slotDarkColor.set(pose.slotSetupDarkColor);
  for (let i = 0; i < pose.slotCount; i += 1) {
    pose.slotAttachment[i] = pose.slotSetupAttachment[i] ?? null;
  }
}

function findDefaultSkin(document: SkeletonDocument): Skin | undefined {
  return document.skins.find((skin) => skin.name === DEFAULT_SKIN_NAME);
}

function readBoneWorld(pose: Pose, boneIndex: number): Mat2x3 {
  const base = boneIndex * MAT2X3_STRIDE;
  const w = pose.world;
  return [w[base]!, w[base + 1]!, w[base + 2]!, w[base + 3]!, w[base + 4]!, w[base + 5]!];
}

// The mesh-deform source for gathering: the (animationId, time) whose deform channel is sampled on top of
// the skin. `animationId: null` is the setup pose (pure skin, deform is zero at setup). For an
// AnimationState frame this is the base track-0 entry (its animationId + trackTime), matching runtime-web's
// SkeletonView.syncState (deform under AnimationState is scoped to track 0; ADR-0005 defines no cross-track
// deform blend), so the preview and the shipped renderer sample the same deform.
export interface MeshDeformSource {
  readonly animationId: string | null;
  readonly sampleTime: number;
}

// Solve the pose into the caller's buffer for a single-animation (or setup-pose) frame and return the mesh
// deform source. When `animation` is undefined the setup pose is solved (steps 1 and 4 plus the slot setup
// reset); otherwise the skeleton is sampled at the clamped time (t in [0, duration]; this does NOT loop,
// matching the ADR "sampleSkeleton at the clamped time"). The pose is caller-owned so the sequence pipeline
// reuses one pose across a whole clip (sampleSkeleton and the setup reset both fully re-solve it).
export function solvePoseForFrame(
  document: SkeletonDocument,
  pose: Pose,
  animation: string | undefined,
  time: number | undefined,
): MeshDeformSource {
  if (animation !== undefined) {
    const anim = document.animations[animation];
    if (anim === undefined) throw new UnknownAnimationError(animation);
    const sampleTime = Math.min(Math.max(time ?? 0, 0), anim.duration);
    sampleSkeleton(document, animation, sampleTime, pose);
    return { animationId: animation, sampleTime };
  }
  resetToSetupPose(pose);
  resetSlotsToSetup(pose);
  computeWorldTransforms(pose);
  return { animationId: null, sampleTime: 0 };
}

// Solve the pose once and gather the draw items in slot (draw) order. Convenience wrapper (builds a fresh
// pose per call) used by renderFrame; the sequence pipeline calls solvePoseForFrame + gatherDrawItemsFromPose
// against a reused pose instead. The geometry each item carries is exactly the runtime-core solve output
// (regionWorldCorners for regions, skinMeshInto/sampleMeshVertices for meshes), so the preview cannot drift.
export function gatherDrawItems(
  document: SkeletonDocument,
  atlas: AtlasIndex,
  animation: string | undefined,
  time: number | undefined,
): DrawItem[] {
  const pose = buildPose(document);
  const deform = solvePoseForFrame(document, pose, animation, time);
  return gatherDrawItemsFromPose(document, atlas, pose, deform);
}

// Gather the draw items in slot (draw) order from an ALREADY-solved pose (world pass current). Shared by
// the single-frame path and the sequence pipeline (which solves the pose itself, single-animation via
// solvePoseForFrame or AnimationState via applyAnimationState). `deform` names the (animationId, time) the
// mesh deform is sampled from; regions ignore it.
export function gatherDrawItemsFromPose(
  document: SkeletonDocument,
  atlas: AtlasIndex,
  pose: Pose,
  deform: MeshDeformSource,
): DrawItem[] {
  const animationId = deform.animationId;
  const sampleTime = deform.sampleTime;

  const defaultSkin = findDefaultSkin(document);
  if (defaultSkin === undefined) return [];

  const items: DrawItem[] = [];
  const slotColor = pose.slotColor;
  const slotDarkColor = pose.slotDarkColor;
  const slotHasDarkColor = pose.slotHasDarkColor;
  for (let slotIndex = 0; slotIndex < document.slots.length; slotIndex += 1) {
    const slot = document.slots[slotIndex]!;
    const boneIndex = pose.slotBoneIndices[slotIndex]!;
    if (boneIndex < 0) continue;

    const activeName = pose.slotAttachment[slotIndex];
    if (activeName === null || activeName === undefined) continue;

    const bySlot = defaultSkin.attachments[slot.name];
    if (bySlot === undefined) continue;
    const attachment = bySlot[activeName];
    if (attachment === undefined) continue;
    // region, mesh, and linkedmesh are the drawable kinds here. A linked mesh carries its OWN color/path
    // (used below for tint/sampler) and reuses a parent mesh's geometry (resolved in the mesh branch).
    if (
      attachment.type !== 'region' &&
      attachment.type !== 'mesh' &&
      attachment.type !== 'linkedmesh'
    ) {
      continue;
    }

    const colorBase = slotIndex * SLOT_COLOR_STRIDE;
    const sr = slotColor[colorBase]!;
    const sg = slotColor[colorBase + 1]!;
    const sb = slotColor[colorBase + 2]!;
    const saChannel = slotColor[colorBase + 3]!;
    const color = attachment.color;
    const tint: Color = { r: sr * color.r, g: sg * color.g, b: sb * color.b, a: 1 };
    const alpha = saChannel * color.a;
    // The two-color dark tint, or null when this slot declared no setup darkColor. Only rgb is read (the
    // dark alpha is inert, ADR-0009 4.3); there is no attachment-side dark factor.
    const dark: Color | null =
      slotHasDarkColor[slotIndex] === 1
        ? {
            r: slotDarkColor[colorBase]!,
            g: slotDarkColor[colorBase + 1]!,
            b: slotDarkColor[colorBase + 2]!,
            a: 1,
          }
        : null;
    // A region / mesh attachment MAY carry a `sequence` block: the atlas region shown is the frame the
    // sequence resolves to (setup frame at setup pose, else the mode-resolved frame from the slot's sequence
    // timeline), not the base `path`. runtime-core resolves the integer frame; sequenceRegionName turns it
    // into the region name. A linkedmesh carries no sequence (ADR-0009 section 3), and an attachment without
    // a sequence keeps its base path unchanged.
    const sequence = attachment.type === 'linkedmesh' ? undefined : attachment.sequence;
    let regionPath = attachment.path;
    if (sequence !== undefined) {
      const frameIndex =
        animationId === null
          ? sequence.setupIndex
          : sampleSlotSequenceFrame(document, animationId, sampleTime, pose, slot.name);
      if (frameIndex >= 0) regionPath = sequenceRegionName(attachment.path, sequence, frameIndex);
    }
    const sampler = atlas.resolve(regionPath);

    if (attachment.type === 'region') {
      const trim = atlas.regionTrim(regionPath) ?? undefined;
      items.push(
        regionItem(
          pose,
          slotIndex,
          boneIndex,
          attachment,
          tint,
          alpha,
          slot.blendMode,
          sampler,
          trim,
          dark,
        ),
      );
    } else {
      // mesh or linkedmesh: resolve the SOURCE geometry (a linked mesh reuses a parent mesh's uvs/triangles
      // and vertex stream); the world positions still come from runtime-core (sampleMeshVertices resolves
      // the same chain when animated, skinMeshInto over the source at setup), so the geometry never drifts.
      const resolved = resolveRenderMesh(document, DEFAULT_SKIN_NAME, slot.name, attachment);
      if (resolved === null) continue;
      items.push(
        meshItem(
          document,
          pose,
          slotIndex,
          boneIndex,
          slot.name,
          activeName,
          resolved.source,
          animationId,
          sampleTime,
          tint,
          alpha,
          slot.blendMode,
          sampler,
          dark,
        ),
      );
    }
  }
  return items;
}

function regionItem(
  pose: Pose,
  slotIndex: number,
  boneIndex: number,
  region: RegionAttachment,
  tint: Color,
  alpha: number,
  blend: BlendMode,
  sampler: TextureSampler,
  trim: RegionTrim | undefined,
  dark: Color | null,
): DrawItem {
  const corners = regionWorldCorners(readBoneWorld(pose, boneIndex), region, trim);
  const worldPositions: number[] = [];
  for (const corner of corners) {
    worldPositions.push(corner.x, corner.y);
  }
  return {
    slotIndex,
    worldPositions,
    uvs: REGION_QUAD_UVS,
    triangles: REGION_QUAD_TRIANGLES,
    tint,
    alpha,
    blend,
    sampler,
    dark,
  };
}

function meshItem(
  document: SkeletonDocument,
  pose: Pose,
  slotIndex: number,
  boneIndex: number,
  slotName: string,
  attachmentName: string,
  mesh: MeshAttachment,
  animationId: string | null,
  sampleTime: number,
  tint: Color,
  alpha: number,
  blend: BlendMode,
  sampler: TextureSampler,
  dark: Color | null,
): DrawItem {
  const vertexCount = mesh.uvs.length / 2;
  const out = new Float32Array(vertexCount * 2);
  if (animationId === null) {
    // Setup pose: the pure skin of the current bone worlds (deform is zero at setup by definition).
    skinMeshInto(mesh, pose, boneIndex, out);
  } else {
    // Animated: skin + sampled deform, through the exact runtime-core call the conformance harness asserts.
    sampleMeshVertices(
      document,
      animationId,
      sampleTime,
      pose,
      DEFAULT_SKIN_NAME,
      slotName,
      attachmentName,
      out,
    );
  }
  return {
    slotIndex,
    worldPositions: Array.from(out),
    uvs: mesh.uvs,
    triangles: mesh.triangles,
    tint,
    alpha,
    blend,
    sampler,
    dark,
  };
}
