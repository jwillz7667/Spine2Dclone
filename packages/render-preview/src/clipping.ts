import type { ClippingAttachment, SkeletonDocument, Skin } from '@marionette/format/types';
import {
  computeClippedSlotRange,
  prepareClipping,
  resolveClipWorldPolygonForSlot,
  type PreparedClip,
  type Pose,
} from '@marionette/runtime-core';

// Clip-region evaluation for the CPU preview (ADR-0012 section 3, PP-C8). A `clipping` attachment names, in
// draw order, a range of slots whose geometry it clips to its (bone-transformed) world polygon. This module
// is the thin orchestration over the runtime-core clip primitives (prepareClipping, resolveClipWorldPolygon,
// computeClippedSlotRange): it reads the SOLVED pose (world pass + draw order) and produces, per clipped
// slot, the clip the rasterizer must apply. The actual triangle clip (Sutherland-Hodgman with barycentrics)
// is runtime-core's clipTriangleList, called from raster-clip.ts. No rasterization here, so it stays a pure,
// testable lookup.

// The one skin the preview draws, matching draw-items.ts / runtime-web (DEFAULT_SKIN_NAME). Skin switching is
// a later authoring surface; clip attachments resolve through this same skin the drawn attachments use.
const DEFAULT_SKIN_NAME = 'default';

// A resolved clip region for one frame: the prepared (convexity + ear-clip topology) clip, its world-space
// polygon this frame, and the set of slot indices it clips (ADR-0012 section 3.1). `polygonVertexCount` is
// the logical vertex count (polygon has 2 * count lanes).
export interface ClipRegion {
  readonly clipSlotIndex: number;
  readonly prepared: PreparedClip;
  readonly worldPolygon: Float64Array;
  readonly polygonVertexCount: number;
  readonly clippedSlots: readonly number[];
}

// prepareClipping decides convexity and (for a concave polygon) ear-clip topology from the LOCAL polygon,
// which is affine invariant, so the prepared form is constant for the attachment's lifetime. Cache it by
// attachment identity so an animated clip (whose bone moves the world polygon every frame) prepares ONCE, not
// per frame. A WeakMap auto-evicts an edited attachment (a new object).
const preparedCache = new WeakMap<ClippingAttachment, PreparedClip>();

function getPrepared(clip: ClippingAttachment): PreparedClip {
  const cached = preparedCache.get(clip);
  if (cached !== undefined) return cached;
  const prepared = prepareClipping(clip);
  preparedCache.set(clip, prepared);
  return prepared;
}

function findDefaultSkin(document: SkeletonDocument): Skin | undefined {
  return document.skins.find((skin) => skin.name === DEFAULT_SKIN_NAME);
}

function slotIndexByName(document: SkeletonDocument, name: string): number {
  return document.slots.findIndex((slot) => slot.name === name);
}

// Resolve every active clip region for a solved pose, plus a slot-indexed lookup of which clip (if any)
// clips each slot. When two clip ranges overlap a slot, the LATER clip in draw order wins (nested clips are
// not modeled in v1; the conformance rig uses a single clip). Reads the pose's world pass and draw order;
// allocation here is per frame (like the rest of the preview gather), but the per-triangle clip it feeds
// reuses PP-B2's pooled buffers (raster-clip.ts). Returns an empty result when the document has no clips.
export interface ClipPlan {
  readonly regions: readonly ClipRegion[];
  // slotIndex -> the ClipRegion that clips it, or undefined. Sized to document.slots.length.
  readonly bySlot: ReadonlyArray<ClipRegion | undefined>;
}

export function gatherClipRegionsFromPose(document: SkeletonDocument, pose: Pose): ClipPlan {
  const bySlot: (ClipRegion | undefined)[] = new Array<ClipRegion | undefined>(
    document.slots.length,
  ).fill(undefined);
  const defaultSkin = findDefaultSkin(document);
  if (defaultSkin === undefined) return { regions: [], bySlot };

  const regions: ClipRegion[] = [];
  const rangeScratch = new Int32Array(pose.slotCount);
  // Walk in DRAW ORDER so an earlier-drawn clip's range is established before a later clip can overwrite an
  // overlapped slot (last clip in draw order wins). computeClippedSlotRange itself also reads draw order.
  for (let position = 0; position < pose.drawOrder.length; position += 1) {
    const slotIndex = pose.drawOrder[position]!;
    const slot = document.slots[slotIndex];
    if (slot === undefined) continue;

    const activeName = pose.slotAttachment[slotIndex];
    if (activeName === null || activeName === undefined) continue;
    const attachment = defaultSkin.attachments[slot.name]?.[activeName];
    if (attachment === undefined || attachment.type !== 'clipping') continue;

    const endSlotIndex = slotIndexByName(document, attachment.end);
    if (endSlotIndex < 0) continue;

    const prepared = getPrepared(attachment);
    const worldPolygon = new Float64Array(attachment.vertices.length);
    const vertexCount = resolveClipWorldPolygonForSlot(pose, slotIndex, attachment, worldPolygon);
    if (vertexCount < 3) continue; // degenerate polygon: no clip region (ADR-0012 section 3.3)

    const count = computeClippedSlotRange(pose, slotIndex, endSlotIndex, rangeScratch);
    if (count === 0) continue; // end at or before the clip slot: empty clipped set

    const clippedSlots: number[] = [];
    for (let k = 0; k < count; k += 1) clippedSlots.push(rangeScratch[k]!);

    const region: ClipRegion = {
      clipSlotIndex: slotIndex,
      prepared,
      worldPolygon,
      polygonVertexCount: vertexCount,
      clippedSlots,
    };
    regions.push(region);
    for (const clipped of clippedSlots) bySlot[clipped] = region;
  }

  return { regions, bySlot };
}
