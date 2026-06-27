import type {
  AnimationEntity,
  AttachmentFrameEntity,
  BoneChannel,
  KeyframeEntity,
  KeyframeValue,
} from '../model/doc-state';
import type { DocumentReadModel } from '../model/read-model';
import { DocumentInvariantError } from './errors';

// Channel -> the value-shape predicate it must carry, so a track never holds a value of the wrong shape
// (a rotate keyframe with a color value is corrupt internal state). The `in` checks match the disjoint
// keyframe value shapes (doc-state.ts) with no `as`.
function valueMatchesChannel(channel: BoneChannel | 'color', value: KeyframeValue): boolean {
  switch (channel) {
    case 'rotate':
      return 'angle' in value;
    case 'color':
      return 'color' in value;
    default:
      // translate / scale / shear share the vec2 shape.
      return 'x' in value && 'y' in value;
  }
}

// Assert a value channel is strictly ascending in time, in [0, duration], and carries the channel's
// value shape. Accumulates the maximum time so the caller can enforce the duration bound. Throws on the
// first violation (a typed DocumentInvariantError), matching the format validator's ANIM_TIME_ORDER /
// ANIM_TIME_RANGE at the command boundary.
function checkValueChannel(
  animation: AnimationEntity,
  label: string,
  channel: BoneChannel | 'color',
  frames: readonly KeyframeEntity[],
  duration: number,
): number {
  let previous: number | null = null;
  let maxTime = 0;
  for (const frame of frames) {
    if (frame.time < 0 || frame.time > duration) {
      throw new DocumentInvariantError(
        `animation "${animation.name}" ${label} keyframe time ${frame.time} is outside [0, ${duration}]`,
      );
    }
    if (previous !== null && frame.time <= previous) {
      throw new DocumentInvariantError(
        `animation "${animation.name}" ${label} keyframe times must strictly ascend, ${frame.time} does not follow ${previous}`,
      );
    }
    if (!valueMatchesChannel(channel, frame.value)) {
      throw new DocumentInvariantError(
        `animation "${animation.name}" ${label} keyframe carries a value of the wrong shape for channel "${channel}"`,
      );
    }
    previous = frame.time;
    if (frame.time > maxTime) maxTime = frame.time;
  }
  return maxTime;
}

function checkAttachmentFrames(
  animation: AnimationEntity,
  label: string,
  frames: readonly AttachmentFrameEntity[],
  duration: number,
): number {
  let previous: number | null = null;
  let maxTime = 0;
  for (const frame of frames) {
    if (frame.time < 0 || frame.time > duration) {
      throw new DocumentInvariantError(
        `animation "${animation.name}" ${label} frame time ${frame.time} is outside [0, ${duration}]`,
      );
    }
    if (previous !== null && frame.time <= previous) {
      throw new DocumentInvariantError(
        `animation "${animation.name}" ${label} frame times must strictly ascend, ${frame.time} does not follow ${previous}`,
      );
    }
    previous = frame.time;
    if (frame.time > maxTime) maxTime = frame.time;
  }
  return maxTime;
}

// Dev/test invariant guard (command-history Section 3.5). Verifies the bone graph, the slot graph, and
// the slot draw order: every parent/bone reference resolves, parents precede children in boneOrder (the
// format invariant the world-pass relies on), slotOrder is a permutation of the slot ids, every
// attachment is owned by an existing slot, and a non-null setup attachment resolves in that slot's
// attachment map. It does NOT check name uniqueness, because that is an export-only contract (D9): a
// transient name collision is a legal internal state. The round-trip harness runs this after every do
// and every undo. A violation is a typed DocumentInvariantError, never a thrown string. Never called
// in a render loop.
export function assertInvariants(model: DocumentReadModel): void {
  const bones = model.bones(); // in boneOrder
  const indexById = new Map<string, number>();
  for (let i = 0; i < bones.length; i += 1) {
    const bone = bones[i];
    if (bone) indexById.set(bone.id, i);
  }
  for (let i = 0; i < bones.length; i += 1) {
    const bone = bones[i];
    if (!bone || bone.parent === null) continue;
    const parentIndex = indexById.get(bone.parent);
    if (parentIndex === undefined) {
      throw new DocumentInvariantError(
        `bone "${bone.name}" references parent ${bone.parent}, which does not exist`,
      );
    }
    if (parentIndex >= i) {
      throw new DocumentInvariantError(
        `bone "${bone.name}" must appear after its parent (parents precede children)`,
      );
    }
  }

  // Slot graph (WP-1.2): every slot rides an existing bone (a BoneId reference, stable across rename),
  // and slotOrder is a permutation of the slot ids (the draw order lists each slot exactly once).
  const slots = model.slots(); // in slotOrder
  const boneIds = new Set(bones.map((bone) => bone.id));
  const slotIds = new Set<string>();
  for (const slot of slots) {
    if (slotIds.has(slot.id)) {
      throw new DocumentInvariantError(`slot ${slot.id} appears more than once in slotOrder`);
    }
    slotIds.add(slot.id);
    if (!boneIds.has(slot.bone)) {
      throw new DocumentInvariantError(
        `slot "${slot.name}" rides bone ${slot.bone}, which does not exist`,
      );
    }

    // Every attachment is owned by this slot (model.attachments only returns a slot's own), and a
    // non-null setup attachment must name one of them.
    const attachmentNames = new Set(model.attachments(slot.id).map((att) => att.name));
    if (slot.attachment !== null && !attachmentNames.has(slot.attachment)) {
      throw new DocumentInvariantError(
        `slot "${slot.name}" sets attachment "${slot.attachment}", which it does not define`,
      );
    }
  }

  // No orphan attachments: every attachment's owning SlotId must be a live slot (the snapshot is the
  // only read surface that enumerates attachments across all slots).
  for (const att of model.snapshot().attachments) {
    if (!slotIds.has(att.slotId)) {
      throw new DocumentInvariantError(
        `attachment "${att.name}" is owned by slot ${att.slotId}, which does not exist`,
      );
    }
  }

  // Animation graph (WP-1.5): every track targets a live bone/slot, every value channel is strictly
  // time-ascending within [0, duration] and carries the channel's value shape, duration is non-negative
  // and at least the maximum keyframe time, and every KeyframeId is unique across the whole document
  // (ids are minted monotonically, so a duplicate is a bug). These mirror the format validator's
  // ANIM_* / CURVE checks at the command boundary, the author-time equivalent of the export-time gate.
  const seenKeyframeIds = new Set<string>();
  const noteKeyframeId = (id: string, animationName: string): void => {
    if (seenKeyframeIds.has(id)) {
      throw new DocumentInvariantError(
        `keyframe id ${id} (animation "${animationName}") is not unique`,
      );
    }
    seenKeyframeIds.add(id);
  };
  for (const animation of model.animations()) {
    const { duration } = animation;
    if (!Number.isFinite(duration) || duration < 0) {
      throw new DocumentInvariantError(
        `animation "${animation.name}" has an invalid duration ${duration}`,
      );
    }
    let maxTime = 0;
    for (const [boneId, set] of animation.bones) {
      if (!boneIds.has(boneId)) {
        throw new DocumentInvariantError(
          `animation "${animation.name}" keys a timeline on bone ${boneId}, which does not exist`,
        );
      }
      for (const channel of ['rotate', 'translate', 'scale', 'shear'] as const) {
        for (const kf of set[channel]) noteKeyframeId(kf.id, animation.name);
        maxTime = Math.max(
          maxTime,
          checkValueChannel(animation, channel, channel, set[channel], duration),
        );
      }
    }
    for (const [slotId, set] of animation.slots) {
      if (!slotIds.has(slotId)) {
        throw new DocumentInvariantError(
          `animation "${animation.name}" keys a timeline on slot ${slotId}, which does not exist`,
        );
      }
      for (const kf of set.color) noteKeyframeId(kf.id, animation.name);
      for (const frame of set.attachment) noteKeyframeId(frame.id, animation.name);
      maxTime = Math.max(
        maxTime,
        checkValueChannel(animation, 'color', 'color', set.color, duration),
      );
      maxTime = Math.max(
        maxTime,
        checkAttachmentFrames(animation, 'attachment', set.attachment, duration),
      );
    }
    if (duration < maxTime) {
      throw new DocumentInvariantError(
        `animation "${animation.name}" duration ${duration} is below its maximum keyframe time ${maxTime}`,
      );
    }
  }
}
