import type { Attachment, SkeletonDocument, Skin } from '@marionette/format/types';
import type { Pose } from './pose';

// Runtime skin selection (PP-B3). The solve carries only the resolved active attachment NAME per slot
// (pose.slotAttachment), keeping geometry out of the platform-agnostic Pose. A renderer still needs the
// actual attachment (its UVs, mesh vertices, region size) to draw, and needs to switch skins live (a
// character re-costumed mid-game) WITHOUT rebuilding the Pose. SkinState is that lookup layer: a tiny
// mutable record holding the active skin name plus a precomputed (skin -> slot -> attachment) index, so
// resolving a slot's presented attachment is a few Map lookups with zero per-frame allocation.
//
// This is a pure lookup over the document skins and the pose's resolved attachment names. It changes NO
// numeric solve output and touches no fixture: the conformance corpus stays byte-identical. It is our
// own first-principles contract (Law 4): the active skin is consulted first, and an attachment the
// active skin does not define falls back to the 'default' skin, so a costume skin can override only some
// slots and inherit the rest. No PixiJS, no DOM, no Zod, no Node built-ins, no Math.random / Date.now.

// The name of the always-present base skin (the format validator rejects a document without it,
// SKIN_DEFAULT_MISSING). SkinState defaults its active skin to this and falls back to it.
export const DEFAULT_SKIN_NAME = 'default';

// Thrown when a caller activates a skin the document does not define. A typed error (not a bare string)
// carrying the offending name, mirroring AnimationNotFoundError; fail loud rather than silently drawing
// nothing for every slot.
export class UnknownSkinError extends Error {
  readonly skinName: string;

  constructor(skinName: string) {
    super(`unknown skin: ${skinName}`);
    this.name = 'UnknownSkinError';
    this.skinName = skinName;
  }
}

// slot name -> attachment name -> attachment geometry, for one skin.
type SkinAttachmentIndex = ReadonlyMap<string, ReadonlyMap<string, Attachment>>;

// Mutable runtime state: the active skin name (a renderer assigns it via setActiveSkin) plus the
// immutable precomputed index. `activeSkin` is the only mutable field; everything else is built once.
export interface SkinState {
  activeSkin: string;
  readonly skinNames: readonly string[];
  readonly bySkin: ReadonlyMap<string, SkinAttachmentIndex>;
  readonly defaultSkin: SkinAttachmentIndex;
}

// Flatten one skin's nested attachment Record into nested Maps (built once; Map.get is allocation-free
// at resolve time, unlike a concatenated string key which would allocate per lookup).
function indexSkin(skin: Skin): SkinAttachmentIndex {
  const bySlot = new Map<string, Map<string, Attachment>>();
  for (const [slotName, attachments] of Object.entries(skin.attachments)) {
    const byName = new Map<string, Attachment>();
    for (const [attachmentName, attachment] of Object.entries(attachments)) {
      byName.set(attachmentName, attachment);
    }
    bySlot.set(slotName, byName);
  }
  return bySlot;
}

// Build the skin lookup for a validated document. The active skin defaults to 'default'. One-time
// allocation; the per-frame resolve path below allocates nothing.
export function buildSkinState(document: SkeletonDocument): SkinState {
  const bySkin = new Map<string, SkinAttachmentIndex>();
  for (const skin of document.skins) bySkin.set(skin.name, indexSkin(skin));
  // The default skin is guaranteed present by the format validator; an empty index is a defensive
  // fallback only (it never occurs for a validated document) so resolution stays total.
  const defaultSkin =
    bySkin.get(DEFAULT_SKIN_NAME) ?? new Map<string, ReadonlyMap<string, Attachment>>();
  return {
    activeSkin: DEFAULT_SKIN_NAME,
    skinNames: [...bySkin.keys()],
    bySkin,
    defaultSkin,
  };
}

// The active skin name a renderer reads to label its state; equal to `state.activeSkin`.
export function getActiveSkin(state: SkinState): string {
  return state.activeSkin;
}

// Switch the active skin. Fails loud on an unknown name (UnknownSkinError). Allocation-free: a string
// assignment. Deterministic: no clock, no random, so the same call sequence always yields the same state.
export function setActiveSkin(state: SkinState, skinName: string): void {
  if (!state.bySkin.has(skinName)) throw new UnknownSkinError(skinName);
  state.activeSkin = skinName;
}

// Resolve one (slot, attachment name) to its geometry under the active skin, falling back to the default
// skin when the active skin does not define it. Returns null when neither skin defines it (nothing to
// draw). Allocation-free: only Map.get and optional chaining, no key construction.
export function resolveAttachment(
  state: SkinState,
  slotName: string,
  attachmentName: string,
): Attachment | null {
  const fromActive = state.bySkin.get(state.activeSkin)?.get(slotName)?.get(attachmentName);
  if (fromActive !== undefined) return fromActive;
  if (state.activeSkin === DEFAULT_SKIN_NAME) return null;
  return state.defaultSkin.get(slotName)?.get(attachmentName) ?? null;
}

// Resolve the geometry a slot presents this frame: read the slot's resolved active attachment NAME from
// the solved pose (pose.slotAttachment, written by sampleSkeleton at solve-order step 2) and resolve it
// under the active skin. Returns null when the slot has no active attachment or the skins do not define
// it. This is the renderer's entry point: solve once, then read each slot's geometry per active skin
// without touching the Pose. Allocation-free.
export function resolveSlotAttachment(
  state: SkinState,
  pose: Pose,
  slotIndex: number,
): Attachment | null {
  const attachmentName = pose.slotAttachment[slotIndex];
  if (attachmentName === null || attachmentName === undefined) return null;
  const slotName = pose.slotNames[slotIndex];
  if (slotName === undefined) return null;
  return resolveAttachment(state, slotName, attachmentName);
}
