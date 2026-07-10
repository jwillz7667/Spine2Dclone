import {
  KeyframeCollisionError,
  MoveKeyframeCommand,
  SetKeyframeCommand,
  type AnimationEntity,
  type AnimationId,
  type DocumentReadModel,
  type History,
  type KeyframeEntity,
  type KeyframeId,
  type KeyframeTarget,
  type KeyframeValue,
} from '../document';
import { clamp, snapToFrame, type WorkingFps } from './timeline-math';
import { readComponent, writeComponent, type ComponentField } from './value-graph-channels';

// The value-graph key-drag wiring (PP-D3): a single keyframe dragged in BOTH axes at once. The time axis
// reuses MoveKeyframe (the exact command and collision semantics the dopesheet uses); the value axis reuses
// SetKeyframe at the key's own time, which UPDATES the value in place (keeping the id and curve). Both run
// inside ONE History interaction session (the caller wraps begin/endInteraction), so a drag that moves a key
// in time and value collapses to a single undo step. Every mutation is a document-core command (LAW 2); this
// module never mutates the document directly. The panel owns the pointer plumbing and calls these.

// Resolve a keyframe on a value channel by id, reading the channel array straight off the animation entity
// (the value graph only ever targets value channels: bone transform channels or slot color channels).
function resolveKeyframe(
  animation: AnimationEntity,
  target: KeyframeTarget,
  id: KeyframeId,
): KeyframeEntity | undefined {
  const channel =
    target.kind === 'bone'
      ? animation.bones.get(target.boneId)?.[target.channel]
      : animation.slots.get(target.slotId)?.[target.channel];
  return channel?.find((kf) => kf.id === id);
}

// The captured origin of a value-graph key drag: the channel, the component the value axis edits, and the
// keyframe's ORIGIN time plus its FULL value at drag start. Every drag delta is applied against these origins
// (not the running state), so the gesture is idempotent per frame and one undo returns to the origin. The
// full origin value is kept so writeComponent preserves the untouched components of a vec2/rgba.
export interface ValueDrag {
  readonly animationId: AnimationId;
  readonly target: KeyframeTarget;
  readonly field: ComponentField;
  readonly keyframeId: KeyframeId;
  readonly originTime: number;
  readonly originValue: KeyframeValue;
  readonly originScalar: number;
}

// Capture the origin of a value-graph key drag, or null when the key does not resolve (so the caller avoids
// opening an empty session).
export function beginValueDrag(
  model: DocumentReadModel,
  animationId: AnimationId,
  target: KeyframeTarget,
  field: ComponentField,
  keyframeId: KeyframeId,
): ValueDrag | null {
  const animation = model.getAnimation(animationId);
  if (animation === undefined) return null;
  const keyframe = resolveKeyframe(animation, target, keyframeId);
  if (keyframe === undefined) return null;
  return {
    animationId,
    target,
    field,
    keyframeId,
    originTime: keyframe.time,
    originValue: keyframe.value,
    originScalar: readComponent(keyframe.value, field),
  };
}

// Apply a (time, value) delta to the dragged key INSIDE an already-open History interaction session. The time
// delta issues a MoveKeyframe to (origin + delta) time, snapped and clamped to [0, duration], skipping a move
// that would collide with a non-moving key (MoveKeyframe throws before mutating, so the model is untouched for
// that step). The value delta issues a SetKeyframe at the key's LIVE time (re-resolved from the model so it is
// correct whether the move applied or was skipped) with the origin value's target component set to
// origin + delta, preserving the other components. A pure-time drag (deltaScalar 0) issues no SetKeyframe, so
// it is byte-identical to a dopesheet move. Both commands coalesce on this key within the session.
export function updateValueDrag(
  history: History,
  model: DocumentReadModel,
  drag: ValueDrag,
  deltaTime: number,
  deltaScalar: number,
  snap: boolean,
  fps: WorkingFps,
  duration: number,
): void {
  const animation = model.getAnimation(drag.animationId);
  if (animation === undefined) return;

  const current = resolveKeyframe(animation, drag.target, drag.keyframeId);
  if (current === undefined) return;

  const newTime = clamp(snapToFrame(drag.originTime + deltaTime, fps, snap), 0, duration);
  if (newTime !== current.time) {
    try {
      history.execute(
        new MoveKeyframeCommand(drag.animationId, drag.target, drag.keyframeId, newTime),
      );
    } catch (error) {
      if (!(error instanceof KeyframeCollisionError)) throw error;
      // A colliding move leaves the key at its last position; the value write below re-resolves that time.
    }
  }

  if (deltaScalar === 0) return;

  // Re-fetch from the model (the immutable model returns a NEW animation entity after the move), so the live
  // time reflects the move that just applied (or the pre-move time when it was skipped). SetKeyframe at that
  // exact time updates this key in place rather than inserting a stray key at a stale time.
  const moved = model.getAnimation(drag.animationId);
  const liveTime =
    (moved === undefined
      ? undefined
      : resolveKeyframe(moved, drag.target, drag.keyframeId)?.time) ?? current.time;
  const nextValue = writeComponent(drag.originValue, drag.field, drag.originScalar + deltaScalar);
  history.execute(new SetKeyframeCommand(drag.animationId, drag.target, liveTime, nextValue));
}
