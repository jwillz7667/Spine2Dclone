import {
  KeyframeCollisionError,
  MoveKeyframeCommand,
  PasteKeyframesCommand,
  type AnimationId,
  type DocumentReadModel,
  type History,
  type KeyframeId,
  type KeyframeTarget,
  type PastedKeyframe,
} from '../document';
import type { CopiedKeyframe } from './clipboard';
import { pasteTargetOf } from './clipboard';
import { indexKeyframes, type ResolvedKeyframe } from './keyframe-index';
import { clamp, snapToFrame, type WorkingFps } from './timeline-math';

// The dopesheet's keyframe-edit wiring (WP-1.6, TASK-1.6.4 / 1.6.5). Every mutation here goes through a
// document-core Command on the live History (LAW 2); this module never mutates the document directly. A
// drag opens ONE History interaction session so the whole gesture is a single undo step; copy/paste is a
// single composite command. The panel owns the pointer plumbing and calls these.

interface DragKey {
  readonly id: KeyframeId;
  readonly target: KeyframeTarget;
  readonly originTime: number;
}

export interface KeyframeDrag {
  readonly animationId: AnimationId;
  readonly keys: readonly DragKey[]; // ascending by originTime
}

// Capture the targets and ORIGIN times of the keys a drag will move, so every drag delta is applied
// against the original positions (not the running ones). Returns null when nothing resolvable is
// selected, so the caller can avoid opening an empty session.
export function beginKeyframeDrag(
  model: DocumentReadModel,
  animationId: AnimationId,
  keyframeIds: readonly KeyframeId[],
): KeyframeDrag | null {
  const animation = model.getAnimation(animationId);
  if (animation === undefined) return null;
  const index = indexKeyframes(animation);
  const keys: DragKey[] = [];
  for (const id of keyframeIds) {
    const resolved = index.get(id);
    if (resolved !== undefined) {
      keys.push({ id: resolved.id, target: resolved.target, originTime: resolved.time });
    }
  }
  if (keys.length === 0) return null;
  keys.sort((a, b) => a.originTime - b.originTime);
  return { animationId, keys };
}

// Issue one MoveKeyframe per dragged key to its (origin + delta) time, INSIDE an already-open History
// interaction session (the caller wraps begin/endInteraction). MoveKeyframe coalesces per keyframe in
// the session, so the whole drag collapses to one undo step. Keys are visited in the order that avoids a
// moving key transiently landing on another moving key (rightmost first when shifting right, leftmost
// first when shifting left). A move that would collide with a NON-moving key is skipped: MoveKeyframe
// throws KeyframeCollisionError before mutating, so skipping leaves the model untouched for that key.
export function updateKeyframeDrag(
  history: History,
  drag: KeyframeDrag,
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
      history.execute(new MoveKeyframeCommand(drag.animationId, key.target, key.id, newTime));
    } catch (error) {
      if (error instanceof KeyframeCollisionError) continue;
      throw error;
    }
  }
}

// One-shot move (keyboard nudge, tests): open a session, apply the delta once, close it. The whole move
// is one undo step regardless of how many keys move.
export function moveSelectedKeyframes(
  history: History,
  model: DocumentReadModel,
  animationId: AnimationId,
  keyframeIds: readonly KeyframeId[],
  deltaSeconds: number,
  snap: boolean,
  fps: WorkingFps,
  duration: number,
): void {
  const drag = beginKeyframeDrag(model, animationId, keyframeIds);
  if (drag === null) return;
  history.beginInteraction();
  try {
    updateKeyframeDrag(history, drag, deltaSeconds, snap, fps, duration);
  } finally {
    history.endInteraction('Move Keyframes');
  }
}

function toCopied(resolved: ResolvedKeyframe, anchor: number): CopiedKeyframe {
  const relTime = resolved.time - anchor;
  if (resolved.target.kind === 'bone') {
    return {
      targetRef: { kind: 'bone', boneId: resolved.target.boneId },
      channel: resolved.target.channel,
      relTime,
      value: resolved.value,
      curve: resolved.curve,
    };
  }
  return {
    targetRef: { kind: 'slot', slotId: resolved.target.slotId },
    channel: 'color',
    relTime,
    value: resolved.value,
    curve: resolved.curve,
  };
}

// Resolve the current key selection to clipboard value records (section 6). relTime is measured from the
// earliest selected key, so pasting places that earliest key at the playhead and preserves the spacing.
export function copySelectionToClipboard(
  model: DocumentReadModel,
  animationId: AnimationId,
  keyframeIds: readonly KeyframeId[],
): CopiedKeyframe[] {
  const animation = model.getAnimation(animationId);
  if (animation === undefined) return [];
  const index = indexKeyframes(animation);
  const resolved: ResolvedKeyframe[] = [];
  for (const id of keyframeIds) {
    const found = index.get(id);
    if (found !== undefined) resolved.push(found);
  }
  if (resolved.length === 0) return [];
  let anchor = resolved[0]!.time;
  for (const r of resolved) anchor = Math.min(anchor, r.time);
  return resolved.map((r) => toCopied(r, anchor));
}

// Paste the clipboard at the playhead via a single PasteKeyframes composite (one undo step). Each record
// lands at playhead + relTime; a record whose target time falls outside [0, duration] is dropped so the
// paste never authors an out-of-range keyframe (the validator's ANIM_TIME_RANGE). An empty result issues
// no command, so paste-with-nothing-in-range creates no empty undo entry.
export function pasteClipboardAtPlayhead(
  history: History,
  animationId: AnimationId,
  clipboard: readonly CopiedKeyframe[],
  playhead: number,
  duration: number,
): void {
  const items: PastedKeyframe[] = [];
  for (const copied of clipboard) {
    const time = playhead + copied.relTime;
    if (time < 0 || time > duration) continue;
    items.push({ target: pasteTargetOf(copied), time, value: copied.value, curve: copied.curve });
  }
  if (items.length === 0) return;
  history.execute(new PasteKeyframesCommand(animationId, items));
}
