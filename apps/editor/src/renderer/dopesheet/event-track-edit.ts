import {
  KeyframeCollisionError,
  MoveDrawOrderKeyCommand,
  MoveEventKeyCommand,
  SetEventKeyCommand,
  type AnimationEntity,
  type AnimationId,
  type EventDefId,
  type History,
  type KeyframeId,
} from '../document';
import { clamp, snapToFrame, type WorkingFps } from './timeline-math';

// The dopesheet's edit wiring for the two DISCRETE special timelines (Stage F1, PP-D9): the event timeline
// and the draw-order timeline. These keys are NOT bone/slot value channels (no KeyframeValue, no curve), so
// they never flow through keyframe-edit.ts's value-channel path; they move/delete through their own
// document-core commands. Every mutation here goes through a command on the live History (LAW 2); this
// module never mutates the document directly. A drag applies these INSIDE the same History interaction
// session the panel opens for value keys, so a mixed drag is still ONE undo step. Because event and value
// KeyframeIds are minted from one monotonic sequence and never reused, a given id belongs to exactly one
// timeline, so the panel can build a value drag and a special drag from the same selection without overlap.

type SpecialTrackKind = 'event' | 'drawOrder';

interface SpecialDragKey {
  readonly id: KeyframeId;
  readonly track: SpecialTrackKind;
  readonly originTime: number;
}

export interface SpecialDrag {
  readonly animationId: AnimationId;
  readonly keys: readonly SpecialDragKey[]; // ascending by originTime
}

// Capture which of the selected keys are event or draw-order keys and their ORIGIN times, so every drag
// delta is applied against the original positions (not the running ones). Returns null when the selection
// holds no special key, so the caller can avoid opening an empty session (or defer to the value path).
export function beginSpecialDrag(
  animation: AnimationEntity,
  keyframeIds: readonly KeyframeId[],
): SpecialDrag | null {
  const eventTimes = new Map(animation.events.map((key) => [key.id, key.time]));
  const drawTimes = new Map(animation.drawOrder.map((key) => [key.id, key.time]));
  const keys: SpecialDragKey[] = [];
  for (const id of keyframeIds) {
    const eventTime = eventTimes.get(id);
    if (eventTime !== undefined) {
      keys.push({ id, track: 'event', originTime: eventTime });
      continue;
    }
    const drawTime = drawTimes.get(id);
    if (drawTime !== undefined) keys.push({ id, track: 'drawOrder', originTime: drawTime });
  }
  if (keys.length === 0) return null;
  keys.sort((a, b) => a.originTime - b.originTime);
  return { animationId: animation.id, keys };
}

// Move each special key to its (origin + delta) time INSIDE an already-open History interaction session (the
// caller wraps begin/endInteraction). Both move commands coalesce per keyframe within the session, so a
// continuous drag collapses to one undo step. Keys are visited rightmost-first when shifting right and
// leftmost-first when shifting left, so a moving key never transiently lands on another moving key. A
// draw-order move that would collide with a NON-moving key is skipped (MoveDrawOrderKey throws
// KeyframeCollisionError before mutating, so skipping leaves the model untouched); event times are
// non-decreasing (coincident firings are legal) so an event move never collides.
export function updateSpecialDrag(
  history: History,
  drag: SpecialDrag,
  deltaSeconds: number,
  snap: boolean,
  fps: WorkingFps,
  duration: number,
): void {
  const order = deltaSeconds >= 0 ? [...drag.keys].reverse() : drag.keys;
  for (const key of order) {
    const target = snapToFrame(key.originTime + deltaSeconds, fps, snap);
    const newTime = clamp(target, 0, duration);
    if (key.track === 'event') {
      history.execute(new MoveEventKeyCommand(drag.animationId, key.id, newTime));
      continue;
    }
    try {
      history.execute(new MoveDrawOrderKeyCommand(drag.animationId, key.id, newTime));
    } catch (error) {
      if (error instanceof KeyframeCollisionError) continue;
      throw error;
    }
  }
}

// Fire `eventId` at `time` as one undo step (SetEventKey inserts a new key, or updates an existing key that
// already fires the same event at exactly `time`). The overrides are left empty so the firing defers to the
// definition's payload defaults; the author edits per-firing overrides elsewhere. A single execute is
// atomic (one history entry), so no interaction session is needed.
export function addEventKeyAtPlayhead(
  history: History,
  animationId: AnimationId,
  eventId: EventDefId,
  time: number,
): void {
  history.execute(
    new SetEventKeyCommand(animationId, eventId, time, {
      int: undefined,
      float: undefined,
      string: undefined,
    }),
  );
}

// Deletion of event and draw-order keys is handled by the unified dopesheet delete path
// (keyframe-delete.ts deleteSelectedKeyframes), which removes EVERY selected row kind in one undo step.
