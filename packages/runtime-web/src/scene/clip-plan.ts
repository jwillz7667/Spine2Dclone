import type { ClippingAttachment, SkeletonDocument } from '@marionette/format/types';
import {
  computeClippedSlotRange,
  resolveClipWorldPolygonForSlot,
  type Pose,
} from '@marionette/runtime-core';

// Clip PLAN for runtime-web (ADR-0012 section 3, PP-C8 part 2). This is the PURE half of the clipping
// decision: for a solved pose it computes, per active clipping attachment, the WORLD polygon to clip to and
// the set of slots (in draw order) whose display objects the clip masks. It reads only the solved pose (world
// pass + draw order) and the runtime-core clip primitives (resolveClipWorldPolygonForSlot,
// computeClippedSlotRange); it names NO PixiJS, so which-slots-are-masked and the polygon vertex feed are
// unit-testable without a WebGL context.
//
// RENDERER DECISION (mask, not geometry clip): runtime-web applies clipping as a PixiJS Graphics polygon MASK
// (skeleton-view.ts feeds this plan's world polygon to a pooled Graphics and assigns it as the `.mask` of the
// clipped slots' display objects), NOT by clipping each mesh's vertex buffer through clipTriangleList the way
// the CPU preview (render-preview) does. This follows the repo's pure-math-plus-thin-adapter convention (the
// two-color Filter precedent): a mask, like a Filter, applies uniformly to ANY display object (the pooled
// region Sprite AND the Mesh attachments) with no per-frame geometry rebuild, composes with the existing
// two-color filter, and lets Pixi's own fill triangulate a concave polygon (so this plan never needs the
// convex decomposition the CPU rasterizer does). The pure decision lives here; only the Graphics build and
// the `.mask` assignment (the GL-touching lines) live in the adapter. The attachments layer is world space
// (map-transform.ts assigns the world translation directly, no flip; mesh vertices ARE world space), so the
// world polygon feeds the mask verbatim.
//
// Steady-state allocation: the plan reuses pooled entries and their polygon / clipped-slot buffers across
// frames (grown only when a larger clip than any before appears), so a per-frame re-plan of the same clips
// allocates nothing.

// A read-only view of one active clip: the world polygon (first vertexCount*2 lanes valid) and the slot
// indices it masks (first clippedCount entries valid). The backing arrays are pooled and may be longer.
export interface SlotClipView {
  readonly clipSlotIndex: number;
  readonly polygon: Float64Array;
  readonly vertexCount: number;
  readonly clippedSlots: readonly number[];
  readonly clippedCount: number;
}

interface ClipEntry {
  clipSlotIndex: number;
  polygon: Float64Array;
  vertexCount: number;
  clippedSlots: number[];
  clippedCount: number;
}

// The reusable plan state a scene owns (built once per document). `entries` is a growable pool; the first
// `activeCount` are the clips active THIS frame. `bySlot[slotIndex]` is the clip masking that slot, or null.
export interface ClipPlanState {
  readonly entries: ClipEntry[];
  activeCount: number;
  readonly bySlot: (ClipEntry | null)[];
  readonly rangeScratch: Int32Array;
}

export function makeClipPlanState(slotCount: number): ClipPlanState {
  return {
    entries: [],
    activeCount: 0,
    bySlot: new Array<ClipEntry | null>(slotCount).fill(null),
    rangeScratch: new Int32Array(slotCount),
  };
}

function acquireEntry(state: ClipPlanState, laneCount: number, slotCount: number): ClipEntry {
  let entry = state.entries[state.activeCount];
  if (entry === undefined) {
    entry = {
      clipSlotIndex: -1,
      polygon: new Float64Array(laneCount),
      vertexCount: 0,
      clippedSlots: new Array<number>(slotCount).fill(0),
      clippedCount: 0,
    };
    state.entries.push(entry);
  } else if (entry.polygon.length < laneCount) {
    entry.polygon = new Float64Array(laneCount);
  }
  return entry;
}

// The active clips of the current plan, as read-only views (the pooled entries truncated to activeCount).
export function activeClips(state: ClipPlanState): readonly SlotClipView[] {
  return state.entries.slice(0, state.activeCount);
}

// Whether a slot's display objects are masked this frame (and by which clip), for the adapter and describe().
export function clipForSlot(state: ClipPlanState, slotIndex: number): SlotClipView | null {
  const entry = state.bySlot[slotIndex];
  return entry ?? null;
}

// (Re)compute the clip plan for a solved pose into `state`. `resolveClip` returns the clipping attachment a
// slot presents this frame under the active skin (the caller owns skin resolution), or null. Walks DRAW ORDER
// so an overlapped slot is masked by the LATER clip (nested clips are not modeled in v1). Mutates `state` in
// place; allocation-free once the pools have grown to the scene's largest clip.
export function planClips(
  document: SkeletonDocument,
  pose: Pose,
  state: ClipPlanState,
  resolveClip: (slotIndex: number, activeName: string) => ClippingAttachment | null,
): void {
  const bySlot = state.bySlot;
  for (let i = 0; i < bySlot.length; i += 1) bySlot[i] = null;
  state.activeCount = 0;

  for (let position = 0; position < pose.drawOrder.length; position += 1) {
    const slotIndex = pose.drawOrder[position]!;
    const activeName = pose.slotAttachment[slotIndex];
    if (activeName === null || activeName === undefined) continue;

    const clip = resolveClip(slotIndex, activeName);
    if (clip === null) continue;

    const endSlotIndex = document.slots.findIndex((slot) => slot.name === clip.end);
    if (endSlotIndex < 0) continue;

    const entry = acquireEntry(state, clip.vertices.length, pose.slotCount);
    const vertexCount = resolveClipWorldPolygonForSlot(pose, slotIndex, clip, entry.polygon);
    if (vertexCount < 3) continue; // degenerate polygon: no clip region (ADR-0012 section 3.3)

    const count = computeClippedSlotRange(pose, slotIndex, endSlotIndex, state.rangeScratch);
    if (count === 0) continue; // end at or before the clip slot: empty clipped set

    entry.clipSlotIndex = slotIndex;
    entry.vertexCount = vertexCount;
    if (entry.clippedSlots.length < count) entry.clippedSlots = new Array<number>(count).fill(0);
    entry.clippedCount = count;
    for (let k = 0; k < count; k += 1) {
      const clipped = state.rangeScratch[k]!;
      entry.clippedSlots[k] = clipped;
      bySlot[clipped] = entry;
    }
    state.activeCount += 1;
  }
}
