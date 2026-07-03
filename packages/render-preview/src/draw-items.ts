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
  sampleMeshVertices,
  sampleSkeleton,
  skinMeshInto,
  SLOT_COLOR_STRIDE,
  type Mat2x3,
  type Pose,
} from '@marionette/runtime-core';
import type { AtlasIndex, TextureSampler } from './atlas';
import type { Color } from './color';
import { UnknownAnimationError } from './errors';
import { regionWorldCorners, REGION_QUAD_TRIANGLES, REGION_QUAD_UVS } from './geometry';

// The one skin render-preview draws, matching runtime-web (skeleton-view.ts DEFAULT_SKIN_NAME). Skin
// switching is a later authoring surface; the solve and the records resolve attachments through this name.
const DEFAULT_SKIN_NAME = 'default';

// One drawable primitive in world space: a set of world vertices, their texture uvs, the triangle index
// list, the resolved tint/alpha, the slot blend mode, and the texture sampler. Region and mesh
// attachments both reduce to this shape, so the raster pass is uniform.
export interface DrawItem {
  readonly worldPositions: readonly number[];
  readonly uvs: readonly number[];
  readonly triangles: readonly number[];
  // rgb is the slot color x attachment color tint (a is unused: `alpha` below is authoritative).
  readonly tint: Color;
  readonly alpha: number;
  readonly blend: BlendMode;
  readonly sampler: TextureSampler;
}

// Reset every slot's resolved color to its setup color and its active attachment to its setup name, so
// the setup-pose render reads the same pose fields the animated render does. This mirrors runtime-web's
// resetSlotsToSetup (skeleton-view.ts), which itself mirrors runtime-core's internal slot reset: it is a
// setup-snapshot copy, NOT solve math, and lives here because runtime-core does not export the internal.
function resetSlotsToSetup(pose: Pose): void {
  pose.slotColor.set(pose.slotSetupColor);
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

// Solve the pose once and gather the draw items in slot (draw) order. When `animation` is undefined the
// setup pose is solved (steps 1 and 4 plus the slot setup reset); otherwise the skeleton is sampled at the
// clamped time (t in [0, duration]; this does NOT loop, matching the ADR "sampleSkeleton at the clamped
// time"). The geometry each item carries is exactly the runtime-core solve output (regionWorldCorners for
// regions, skinMeshInto/sampleMeshVertices for meshes), so the preview cannot drift from the runtimes.
export function gatherDrawItems(
  document: SkeletonDocument,
  atlas: AtlasIndex,
  animation: string | undefined,
  time: number | undefined,
): DrawItem[] {
  const pose = buildPose(document);

  let animationId: string | null;
  let sampleTime = 0;
  if (animation !== undefined) {
    const anim = document.animations[animation];
    if (anim === undefined) throw new UnknownAnimationError(animation);
    sampleTime = Math.min(Math.max(time ?? 0, 0), anim.duration);
    sampleSkeleton(document, animation, sampleTime, pose);
    animationId = animation;
  } else {
    resetToSetupPose(pose);
    resetSlotsToSetup(pose);
    computeWorldTransforms(pose);
    animationId = null;
  }

  const defaultSkin = findDefaultSkin(document);
  if (defaultSkin === undefined) return [];

  const items: DrawItem[] = [];
  const slotColor = pose.slotColor;
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
    if (attachment.type !== 'region' && attachment.type !== 'mesh') continue;

    const colorBase = slotIndex * SLOT_COLOR_STRIDE;
    const sr = slotColor[colorBase]!;
    const sg = slotColor[colorBase + 1]!;
    const sb = slotColor[colorBase + 2]!;
    const saChannel = slotColor[colorBase + 3]!;
    const color = attachment.color;
    const tint: Color = { r: sr * color.r, g: sg * color.g, b: sb * color.b, a: 1 };
    const alpha = saChannel * color.a;
    const sampler = atlas.resolve(attachment.path);

    if (attachment.type === 'region') {
      items.push(regionItem(pose, boneIndex, attachment, tint, alpha, slot.blendMode, sampler));
    } else {
      items.push(
        meshItem(
          document,
          pose,
          boneIndex,
          slot.name,
          activeName,
          attachment,
          animationId,
          sampleTime,
          tint,
          alpha,
          slot.blendMode,
          sampler,
        ),
      );
    }
  }
  return items;
}

function regionItem(
  pose: Pose,
  boneIndex: number,
  region: RegionAttachment,
  tint: Color,
  alpha: number,
  blend: BlendMode,
  sampler: TextureSampler,
): DrawItem {
  const corners = regionWorldCorners(readBoneWorld(pose, boneIndex), region);
  const worldPositions: number[] = [];
  for (const corner of corners) {
    worldPositions.push(corner.x, corner.y);
  }
  return {
    worldPositions,
    uvs: REGION_QUAD_UVS,
    triangles: REGION_QUAD_TRIANGLES,
    tint,
    alpha,
    blend,
    sampler,
  };
}

function meshItem(
  document: SkeletonDocument,
  pose: Pose,
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
    worldPositions: Array.from(out),
    uvs: mesh.uvs,
    triangles: mesh.triangles,
    tint,
    alpha,
    blend,
    sampler,
  };
}
