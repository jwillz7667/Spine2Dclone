import type { GridConfig } from '@marionette/format/slot-types';
import type {
  AnimationEntity,
  AttachmentFrameEntity,
  BoneChannel,
  KeyframeEntity,
  KeyframeValue,
} from '../model/doc-state';
import type { DocumentReadModel } from '../model/read-model';
import { DocumentInvariantError } from './errors';

// Assert a GridConfig's dims/gravity/anticipation cross-field consistency (format-contract section 15.4),
// the invariant mirror of the SetGridConfig command-time guard. A cluster grid is square and cluster-down;
// a reelStrip has rows in [2, 6]; a scatterPay has cols in [5, 7]; anticipation needs a non-empty trigger
// vocabulary, a thresholdCount >= 1, and maxAnticipatingCols in [1, cols]. Per-field scalar bounds (cols/
// rows in [1, 12], cellWidth/Height > 0, etc.) are the format schema's job, not re-checked here.
function assertGridConsistent(grid: GridConfig): void {
  if (grid.topology === 'cluster') {
    if (grid.cols !== grid.rows) {
      throw new DocumentInvariantError(
        `cluster grid must be square (cols ${grid.cols} !== rows ${grid.rows})`,
      );
    }
    if (grid.gravity !== 'cluster-down') {
      throw new DocumentInvariantError(`cluster grid must use cluster-down gravity`);
    }
  } else if (grid.topology === 'reelStrip') {
    if (grid.rows < 2 || grid.rows > 6) {
      throw new DocumentInvariantError(`reelStrip grid rows ${grid.rows} must be in [2, 6]`);
    }
  } else if (grid.cols < 5 || grid.cols > 7) {
    throw new DocumentInvariantError(`scatterPay grid cols ${grid.cols} must be in [5, 7]`);
  }
  const ant = grid.anticipation;
  if (ant.triggerSymbols.length === 0) {
    throw new DocumentInvariantError(`grid anticipation triggerSymbols must be non-empty`);
  }
  if (ant.thresholdCount < 1) {
    throw new DocumentInvariantError(
      `grid anticipation thresholdCount ${ant.thresholdCount} must be at least 1`,
    );
  }
  if (ant.maxAnticipatingCols < 1 || ant.maxAnticipatingCols > grid.cols) {
    throw new DocumentInvariantError(
      `grid anticipation maxAnticipatingCols ${ant.maxAnticipatingCols} must be in [1, ${grid.cols}]`,
    );
  }
}

// Assert a list of timeline frames (ik/transform/deform) is strictly ascending in time and within
// [0, duration]; returns the maximum time so the caller can enforce the duration bound. Mirrors the bone/
// slot channel checks for the Phase 2 timelines.
function checkFrameTimes(
  animationName: string,
  label: string,
  frames: readonly { readonly time: number }[],
  duration: number,
): number {
  let previous: number | null = null;
  let maxTime = 0;
  for (const frame of frames) {
    if (frame.time < 0 || frame.time > duration) {
      throw new DocumentInvariantError(
        `animation "${animationName}" ${label} keyframe time ${frame.time} is outside [0, ${duration}]`,
      );
    }
    if (previous !== null && frame.time <= previous) {
      throw new DocumentInvariantError(
        `animation "${animationName}" ${label} keyframe times must strictly ascend, ${frame.time} does not follow ${previous}`,
      );
    }
    previous = frame.time;
    if (frame.time > maxTime) maxTime = frame.time;
  }
  return maxTime;
}

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

  // Constraint graph (WP-2.6 / WP-2.7): every IK and transform constraint references live bones and a live
  // target, and constraint names are unique across BOTH arrays (the format's CONSTRAINT_NAME_DUPLICATE).
  // The no-cycle property is an authoring-time guard (ADR-0003 section 5), not adjudicated here, matching
  // the format validator. Builds the id sets the timeline checks below resolve against.
  const ikConstraintIds = new Set<string>();
  const transformConstraintIds = new Set<string>();
  const constraintNames = new Set<string>();
  for (const c of model.ikConstraints()) {
    ikConstraintIds.add(c.id);
    if (constraintNames.has(c.name)) {
      throw new DocumentInvariantError(`constraint name "${c.name}" is not unique`);
    }
    constraintNames.add(c.name);
    for (const boneId of c.bones) {
      if (!boneIds.has(boneId)) {
        throw new DocumentInvariantError(
          `ik constraint "${c.name}" references bone ${boneId}, which does not exist`,
        );
      }
    }
    if (!boneIds.has(c.target)) {
      throw new DocumentInvariantError(
        `ik constraint "${c.name}" targets bone ${c.target}, which does not exist`,
      );
    }
  }
  for (const c of model.transformConstraints()) {
    transformConstraintIds.add(c.id);
    if (constraintNames.has(c.name)) {
      throw new DocumentInvariantError(`constraint name "${c.name}" is not unique`);
    }
    constraintNames.add(c.name);
    for (const boneId of c.bones) {
      if (!boneIds.has(boneId)) {
        throw new DocumentInvariantError(
          `transform constraint "${c.name}" references bone ${boneId}, which does not exist`,
        );
      }
    }
    if (!boneIds.has(c.target)) {
      throw new DocumentInvariantError(
        `transform constraint "${c.name}" targets bone ${c.target}, which does not exist`,
      );
    }
  }

  // Skin graph (WP-2.8): every NAMED skin's attachments are owned by a live slot, and 'default' is never a
  // named skin (it is implicit). The deform skin key set is the named skin ids plus the literal 'default'.
  const skinIds = new Set<string>(['default']);
  for (const skin of model.skins()) {
    if (skin.name === 'default') {
      throw new DocumentInvariantError(`'default' must not be a named skin (it is implicit)`);
    }
    skinIds.add(skin.id);
    for (const [slotId, inner] of skin.attachments) {
      if (!slotIds.has(slotId)) {
        throw new DocumentInvariantError(
          `skin "${skin.name}" has attachments on slot ${slotId}, which does not exist`,
        );
      }
      for (const att of inner.values()) {
        if (att.name.length === 0) {
          throw new DocumentInvariantError(`skin "${skin.name}" has an unnamed attachment`);
        }
      }
    }
  }

  // Slot-scene graph (phase-4 WP-4.5 / WP-4.6): the grid is always present (the always-present default), the
  // grid dims/gravity/anticipation are internally consistent (the command-time SlotEditError guards, mirrored
  // here so an injected violation is caught), and every mapped symbol's skeletonRef resolves to a
  // refs.skeletons entry (the format's cross-reference rule; the inverse of refs.skeletons add/prune
  // bookkeeping). This is the command-boundary mirror of the format's slot-scene semantic checks; it does NOT
  // re-run the full slot-scene validator (that needs an injected scene resolver document-core lacks).
  const scene = model.slotScene();
  assertGridConsistent(scene.grid);
  const skeletonRefNames = new Set(scene.refs.skeletons.map((entry) => entry.name));
  for (const [symbol, set] of Object.entries(scene.symbols)) {
    if (!skeletonRefNames.has(set.skeletonRef)) {
      throw new DocumentInvariantError(
        `slot symbol "${symbol}" references skeleton "${set.skeletonRef}", which is not in refs.skeletons`,
      );
    }
  }

  // Animation graph (WP-1.5, extended in Phase 2): every track targets a live bone/slot/constraint/skin,
  // every value channel is strictly time-ascending within [0, duration] and carries the channel's value
  // shape, duration is non-negative and at least the maximum keyframe time, and every KeyframeId is unique
  // across the whole document (ids are minted monotonically, so a duplicate is a bug). These mirror the
  // format validator's ANIM_* / CURVE checks at the command boundary.
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
    // Phase 2 timelines: ik keyed by a live IK constraint, transform by a live transform constraint, and
    // deform by a live skin key + live slot. Every frame keeps a unique KeyframeId and strict time order.
    for (const [constraintId, frames] of animation.ik) {
      if (!ikConstraintIds.has(constraintId)) {
        throw new DocumentInvariantError(
          `animation "${animation.name}" keys an ik timeline on constraint ${constraintId}, which does not exist`,
        );
      }
      for (const kf of frames) noteKeyframeId(kf.id, animation.name);
      maxTime = Math.max(maxTime, checkFrameTimes(animation.name, 'ik', frames, duration));
    }
    for (const [constraintId, frames] of animation.transform) {
      if (!transformConstraintIds.has(constraintId)) {
        throw new DocumentInvariantError(
          `animation "${animation.name}" keys a transform timeline on constraint ${constraintId}, which does not exist`,
        );
      }
      for (const kf of frames) noteKeyframeId(kf.id, animation.name);
      maxTime = Math.max(maxTime, checkFrameTimes(animation.name, 'transform', frames, duration));
    }
    for (const [skinKey, bySlot] of animation.deform) {
      if (!skinIds.has(skinKey)) {
        throw new DocumentInvariantError(
          `animation "${animation.name}" keys a deform timeline on skin ${skinKey}, which does not exist`,
        );
      }
      for (const [slotId, byName] of bySlot) {
        if (!slotIds.has(slotId)) {
          throw new DocumentInvariantError(
            `animation "${animation.name}" keys a deform timeline on slot ${slotId}, which does not exist`,
          );
        }
        for (const [attachmentName, frames] of byName) {
          for (const kf of frames) noteKeyframeId(kf.id, animation.name);
          maxTime = Math.max(
            maxTime,
            checkFrameTimes(animation.name, `deform ${attachmentName}`, frames, duration),
          );
        }
      }
    }
    if (duration < maxTime) {
      throw new DocumentInvariantError(
        `animation "${animation.name}" duration ${duration} is below its maximum keyframe time ${maxTime}`,
      );
    }
  }
}
