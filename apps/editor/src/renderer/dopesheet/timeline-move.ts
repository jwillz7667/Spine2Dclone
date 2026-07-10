import {
  KeyframeCollisionError,
  MoveAttachmentKeyframeCommand,
  MoveIkKeyframeCommand,
  MovePathKeyframeCommand,
  MoveSequenceKeyframeCommand,
  MoveTransformKeyframeCommand,
  type AnimationEntity,
  type AnimationId,
  type Command,
  type History,
  type KeyframeId,
} from '../document';
import { clamp, snapToFrame, type WorkingFps } from './timeline-math';

// The dopesheet's drag wiring for the non-value TimelineRow kinds that gained a move command in PP-D10/D11:
// the slot attachment-swap timeline, the frame-sequence timeline, the IK-mix timeline, the transform-
// constraint timeline, and the path-constraint timeline. These keys are
// NOT bone/slot value channels (no KeyframeValue, no curve), so they never flow through keyframe-edit.ts's
// value-channel path; and unlike the discrete event/draw-order specials (event-track-edit.ts) they live on a
// named slot or constraint. Every mutation here goes through a command on the live History (LAW 2); this
// module never mutates the document directly. A drag applies these INSIDE the same History interaction
// session the panel opens for the value and special keys, so a mixed drag is still ONE undo step. Because all
// dopesheet KeyframeIds are minted from one monotonic sequence and never reused, a given id belongs to
// exactly one timeline, so the panel builds a value drag, a special drag, and a timeline drag from the same
// selection without overlap.
//
// Deform keys are deliberately NOT handled here: MoveDeformKeyframe does not coalesce (a deform edit re-sets
// offsets rather than scrubbing a time), so it is not wired as a continuous drag.

interface TimelineDragKey {
  readonly id: KeyframeId;
  readonly originTime: number;
  readonly make: (newTime: number) => Command;
}

export interface TimelineDrag {
  readonly animationId: AnimationId;
  readonly keys: readonly TimelineDragKey[]; // ascending by originTime
}

// Capture which of the selected keys are attachment / IK / transform timeline keys and their ORIGIN times
// plus a move-command factory, so every drag delta is applied against the original positions (not the running
// ones). Returns null when the selection holds no such key, so the caller can avoid opening an empty session
// (or defer to the value / special paths).
export function beginTimelineDrag(
  animation: AnimationEntity,
  keyframeIds: readonly KeyframeId[],
): TimelineDrag | null {
  const animId = animation.id;
  const index = new Map<KeyframeId, TimelineDragKey>();

  for (const [slotId, set] of animation.slots) {
    for (const frame of set.attachment) {
      index.set(frame.id, {
        id: frame.id,
        originTime: frame.time,
        make: (newTime) => new MoveAttachmentKeyframeCommand(animId, slotId, frame.id, newTime),
      });
    }
    for (const kf of set.sequence) {
      index.set(kf.id, {
        id: kf.id,
        originTime: kf.time,
        make: (newTime) => new MoveSequenceKeyframeCommand(animId, slotId, kf.id, newTime),
      });
    }
  }
  for (const [constraintId, keys] of animation.ik) {
    for (const kf of keys) {
      index.set(kf.id, {
        id: kf.id,
        originTime: kf.time,
        make: (newTime) => new MoveIkKeyframeCommand(animId, constraintId, kf.id, newTime),
      });
    }
  }
  for (const [constraintId, keys] of animation.transform) {
    for (const kf of keys) {
      index.set(kf.id, {
        id: kf.id,
        originTime: kf.time,
        make: (newTime) => new MoveTransformKeyframeCommand(animId, constraintId, kf.id, newTime),
      });
    }
  }
  for (const [constraintId, keys] of animation.path) {
    for (const kf of keys) {
      index.set(kf.id, {
        id: kf.id,
        originTime: kf.time,
        make: (newTime) => new MovePathKeyframeCommand(animId, constraintId, kf.id, newTime),
      });
    }
  }

  const keys: TimelineDragKey[] = [];
  for (const id of keyframeIds) {
    const entry = index.get(id);
    if (entry !== undefined) keys.push(entry);
  }
  if (keys.length === 0) return null;
  keys.sort((a, b) => a.originTime - b.originTime);
  return { animationId: animation.id, keys };
}

// Move each timeline key to its (origin + delta) time INSIDE an already-open History interaction session (the
// caller wraps begin/endInteraction). All three move commands coalesce per keyframe within the session, so a
// continuous drag collapses to one undo step. Keys are visited rightmost-first when shifting right and
// leftmost-first when shifting left, so a moving key never transiently lands on another moving key. A move
// that would collide with a NON-moving key is skipped: each command throws KeyframeCollisionError before
// mutating (these channels key by time), so skipping leaves the model untouched for that key.
export function updateTimelineDrag(
  history: History,
  drag: TimelineDrag,
  deltaSeconds: number,
  snap: boolean,
  fps: WorkingFps,
  duration: number,
): void {
  const order = deltaSeconds >= 0 ? [...drag.keys].reverse() : drag.keys;
  for (const key of order) {
    const target = snapToFrame(key.originTime + deltaSeconds, fps, snap);
    const newTime = clamp(target, 0, duration);
    try {
      history.execute(key.make(newTime));
    } catch (error) {
      if (error instanceof KeyframeCollisionError) continue;
      throw error;
    }
  }
}
