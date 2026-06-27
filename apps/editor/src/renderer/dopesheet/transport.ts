import type { AnimationEntity, KeyframeEntity, KeyframeValue } from '../document';

// Pure transport math for the dopesheet (WP-1.6, TASK-1.6.6) plus the loop-endpoint advisory predicate.
// None of this touches the document or History: playback advances the ephemeral playhead only (the
// document/editor wall). The clock delta is supplied by the caller, so the solve never reads wall-clock
// (LAW 1).

// The normative transport loop map (TASK-1.4.7): fold elapsed time into [0, duration). The double-mod
// handles a negative elapsed; a non-positive duration has no period and folds to 0.
export function loopTime(elapsed: number, duration: number): number {
  if (duration <= 0) return 0;
  return ((elapsed % duration) + duration) % duration;
}

export interface AdvanceResult {
  readonly playhead: number;
  readonly reachedEnd: boolean;
}

// Advance the playhead by a frame delta. Looping folds through loopTime and never ends; non-looping
// clamps to [0, duration] and reports reachedEnd at the tail so the transport can auto-stop.
export function advance(
  playhead: number,
  deltaSeconds: number,
  duration: number,
  loop: boolean,
): AdvanceResult {
  if (duration <= 0) return { playhead: 0, reachedEnd: true };
  const raw = playhead + deltaSeconds;
  if (loop) return { playhead: loopTime(raw, duration), reachedEnd: false };
  if (raw >= duration) return { playhead: duration, reachedEnd: true };
  if (raw < 0) return { playhead: 0, reachedEnd: false };
  return { playhead: raw, reachedEnd: false };
}

// Structural equality of two keyframe values across the three channel shapes (rotate angle, vec2,
// color). Mismatched shapes are unequal. Used by the loop-endpoint advisory.
export function keyframeValueEquals(a: KeyframeValue, b: KeyframeValue): boolean {
  if ('angle' in a) return 'angle' in b && a.angle === b.angle;
  if ('color' in a) {
    if (!('color' in b)) return false;
    return (
      a.color.r === b.color.r &&
      a.color.g === b.color.g &&
      a.color.b === b.color.b &&
      a.color.a === b.color.a
    );
  }
  if ('angle' in b || 'color' in b) return false;
  return a.x === b.x && a.y === b.y;
}

function endpointsDiffer(keys: readonly KeyframeEntity[]): boolean {
  if (keys.length < 2) return false;
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (first === undefined || last === undefined) return false;
  return !keyframeValueEquals(first.value, last.value);
}

// The "loop endpoints differ" advisory predicate (TASK-1.4.7, WP-1.6 acceptance): true when any authored
// channel's first and last keyframe values disagree, so pose(0) != pose(duration) and a seamless loop
// would pop. A channel with fewer than two keys is trivially matched (pose is constant on it).
export function loopEndpointsDiffer(animation: AnimationEntity): boolean {
  for (const set of animation.bones.values()) {
    if (
      endpointsDiffer(set.rotate) ||
      endpointsDiffer(set.translate) ||
      endpointsDiffer(set.scale) ||
      endpointsDiffer(set.shear)
    ) {
      return true;
    }
  }
  for (const set of animation.slots.values()) {
    if (endpointsDiffer(set.color)) return true;
  }
  return false;
}
