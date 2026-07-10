import type { Animation, SkeletonDocument } from '@marionette/format/types';
import type { Pose } from './pose';
import type { PreparedEventTimeline } from './prepared';
import { computeWorldTransforms, resetToSetupPose } from './world-transform';
import {
  clearEventQueue,
  fireEventsInStep,
  makeEventQueue,
  prepareEventTimeline,
} from './event-fire';
import type { EventQueue } from './event-fire';
import {
  AnimationNotFoundError,
  applyAnimationAt,
  beginBlend,
  composeTouchedBones,
  getPreparedAnimation,
  resetConstraintsToBase,
  resetSlotsToSetup,
  solveConstraints,
} from './sample';

// AnimationState (ADR-0005): the game-facing layer that plays MULTIPLE animations at once on top of the
// pure single-animation sampler. It is plain state plus pure functions (the repo's stateless-by-default
// style): setAnimation / crossfadeTo / queueAnimation / clearTrack mutate the tracks, updateAnimationState
// advances them by an explicit dt (NO wall clock, NO random: Law 1 determinism), and applyAnimationState
// runs the locked six-step solve with a BLENDED step 2 (blend the applied locals, never world matrices).
// It owns no pose: the caller passes the reused solve buffer to applyAnimationState, so the prepared-
// animation cache and every scratch buffer stay pose-owned and allocation-free in steady state.

// The public, mostly-readonly view of a track entry (ADR-0005). The engine-managed fields (trackTime,
// mixTime, mixDuration, mixFrom, loop, animationId) are readonly: updateAnimationState advances them and
// callers only observe them. `alpha` (blend weight, default 1) and `additive` (rule 3 layering vs rule 2
// replace) are the two author-configurable fields, so they are writable: a game sets `entry.additive =
// true` for a layered overlay or `entry.alpha = 0.5` to half-weight a track. It is a live view onto the
// entry the engine advances, so reads always reflect the current frame.
export interface TrackEntry {
  readonly animationId: string;
  readonly loop: boolean;
  readonly trackTime: number;
  alpha: number;
  additive: boolean;
  readonly mixDuration: number;
  readonly mixTime: number;
  readonly mixFrom: TrackEntry | null;
}

// The mutable entry the engine advances. `trackTime` is the wrapped (looping) or clamped (non-looping)
// sample time exposed publicly; `elapsed` is the raw accumulated time used ONLY for queue-trigger timing
// (so a looping entry still fires its queue at the next loop boundary plus delay, ADR-0005 rule 6).
// `next`/`queueDelay` carry a single queued entry; a crossfade stores the outgoing entry in `mixFrom`.
// Exported from the module (not the package barrel) so the exported AnimationState can name it without a
// declaration-emit error; consumers see only TrackEntry.
export interface InternalEntry {
  animationId: string;
  animation: Animation;
  duration: number;
  loop: boolean;
  trackTime: number;
  elapsed: number;
  alpha: number;
  additive: boolean;
  mixDuration: number;
  mixTime: number;
  mixFrom: InternalEntry | null;
  next: InternalEntry | null;
  queueDelay: number;
}

// A skeleton animation-state machine bound to a document. `tracks` is a growable, sparse array indexed by
// track index (ascending index = ascending layer, track 0 is the base); a null slot is an empty track.
export interface AnimationState {
  readonly document: SkeletonDocument;
  readonly tracks: (InternalEntry | null)[];
  // The pooled event queue drained per update (ADR-0008, PP-B4): updateAnimationState clears it, then
  // fills it with every event fired by every advancing entry this update, in (track index, outgoing-
  // before-incoming, timeline) order. Read `eventQueue.events[0 .. eventQueue.count)` after each update.
  readonly eventQueue: EventQueue;
  // Prepared event timelines cached by Animation identity (payloads resolved against document.events).
  // A WeakMap, so an edited animation is auto-evicted; a null value memoizes "this animation has no
  // events" so the common case skips re-preparation. Engine-internal (not a public control surface).
  readonly preparedEvents: WeakMap<Animation, PreparedEventTimeline | null>;
}

// Thrown for a negative / non-integer track index or a negative dt/delay/mixDuration, at the API boundary
// (fail loudly rather than corrupt the track array or advance backwards). A typed error, not a bare throw.
export class AnimationStateArgumentError extends Error {
  override readonly name = 'AnimationStateArgumentError';
  constructor(message: string) {
    super(message);
  }
}

export function makeAnimationState(document: SkeletonDocument): AnimationState {
  return {
    document,
    tracks: [],
    eventQueue: makeEventQueue(),
    preparedEvents: new WeakMap<Animation, PreparedEventTimeline | null>(),
  };
}

function resolveAnimation(state: AnimationState, animationId: string): Animation {
  const animation = state.document.animations[animationId];
  if (animation === undefined) throw new AnimationNotFoundError(animationId);
  return animation;
}

function makeEntry(state: AnimationState, animationId: string, loop: boolean): InternalEntry {
  const animation = resolveAnimation(state, animationId);
  return {
    animationId,
    animation,
    duration: animation.duration,
    loop,
    trackTime: 0,
    elapsed: 0,
    alpha: 1,
    additive: false,
    mixDuration: 0,
    mixTime: 0,
    mixFrom: null,
    next: null,
    queueDelay: 0,
  };
}

function assertTrackIndex(trackIndex: number): void {
  if (!Number.isInteger(trackIndex) || trackIndex < 0) {
    throw new AnimationStateArgumentError(
      `track index must be a non-negative integer, got ${trackIndex}`,
    );
  }
}

function ensureTrackSlot(state: AnimationState, trackIndex: number): void {
  while (state.tracks.length <= trackIndex) state.tracks.push(null);
}

// Replace the track with a fresh entry playing `animationId`, no mix (any current entry, mix, or queue is
// dropped). Returns the new entry so the caller can set its alpha/additive.
export function setAnimation(
  state: AnimationState,
  trackIndex: number,
  animationId: string,
  loop: boolean,
): TrackEntry {
  assertTrackIndex(trackIndex);
  ensureTrackSlot(state, trackIndex);
  const entry = makeEntry(state, animationId, loop);
  state.tracks[trackIndex] = entry;
  return entry;
}

// Crossfade from the track's current entry into a new one over `mixDuration` seconds (ADR-0005 rule 4).
// The current entry becomes the outgoing `mixFrom`; a crossfade FROM a crossfade drops the older `mixFrom`
// immediately (single-level mixing, rule 4). With no current entry or a non-positive mixDuration there is
// nothing to fade from, so this is a plain replace (setAnimation).
export function crossfadeTo(
  state: AnimationState,
  trackIndex: number,
  animationId: string,
  loop: boolean,
  mixDuration: number,
): TrackEntry {
  assertTrackIndex(trackIndex);
  if (mixDuration < 0) {
    throw new AnimationStateArgumentError(`mixDuration must be >= 0, got ${mixDuration}`);
  }
  ensureTrackSlot(state, trackIndex);
  const current = state.tracks[trackIndex] ?? null;
  const entry = makeEntry(state, animationId, loop);
  if (current === null || mixDuration === 0) {
    state.tracks[trackIndex] = entry;
    return entry;
  }
  current.mixFrom = null; // single-level: drop the older outgoing entry immediately (rule 4)
  current.next = null; // the outgoing entry no longer queues anything
  entry.mixDuration = mixDuration;
  entry.mixTime = 0;
  entry.mixFrom = current;
  state.tracks[trackIndex] = entry;
  return entry;
}

// Queue `animationId` to start after the track's current entry completes plus `delay` seconds (ADR-0005
// rule 6); on a looping current entry the queue starts at the next loop boundary plus delay. The queue
// transition is a plain replace (no crossfade). With no current entry the queued animation starts now.
// Returns the pre-built queued entry so the caller can configure its alpha/additive before it starts.
export function queueAnimation(
  state: AnimationState,
  trackIndex: number,
  animationId: string,
  loop: boolean,
  delay: number,
): TrackEntry {
  assertTrackIndex(trackIndex);
  if (delay < 0) {
    throw new AnimationStateArgumentError(`queue delay must be >= 0, got ${delay}`);
  }
  ensureTrackSlot(state, trackIndex);
  const current = state.tracks[trackIndex] ?? null;
  const queued = makeEntry(state, animationId, loop);
  queued.queueDelay = delay;
  if (current === null) {
    state.tracks[trackIndex] = queued;
    return queued;
  }
  current.next = queued; // replaces any prior queued entry
  return queued;
}

export function clearTrack(state: AnimationState, trackIndex: number): void {
  assertTrackIndex(trackIndex);
  if (trackIndex < state.tracks.length) state.tracks[trackIndex] = null;
}

// Read the current entry of a track (or null). Used to scope render-only concerns (e.g. runtime-web mesh
// deform sampling) to a single track without exposing the mutable internals.
export function getTrackEntry(state: AnimationState, trackIndex: number): TrackEntry | null {
  if (trackIndex < 0 || trackIndex >= state.tracks.length) return null;
  return state.tracks[trackIndex] ?? null;
}

// Advance every track by dt seconds (ADR-0005): grow each entry's time, ease its crossfade, drop a
// completed `mixFrom`, and start a queued entry once the current entry has completed plus its delay. No
// clock, no random: the state advances ONLY here, by the caller's explicit dt, so the same (document,
// call sequence, dt steps) is identical everywhere (Law 1). dt must be >= 0.
export function updateAnimationState(state: AnimationState, dt: number): void {
  if (dt < 0) {
    throw new AnimationStateArgumentError(`dt must be >= 0, got ${dt}`);
  }
  // Drain-per-update (ADR-0008): the queue holds only THIS update's fired events. Cleared without
  // releasing capacity, so a steady per-update fire count allocates nothing (the allocation probe pins it).
  clearEventQueue(state.eventQueue);
  const tracks = state.tracks;
  for (let i = 0; i < tracks.length; i += 1) {
    const entry = tracks[i];
    if (entry === null || entry === undefined) continue;

    // Fire events BEFORE advancing, from each advancing entry's PRE-advance sample time over dt. Both an
    // outgoing (crossfading-out) entry and the incoming entry fire (a playing animation fires its events
    // regardless of blend weight: an event is a discrete logical/audio marker, not a weighted value, so
    // "half faded" cannot fire "half an event"). Order: outgoing before incoming, matching apply order.
    fireEntryEvents(state, entry, dt);

    advanceEntry(entry, dt);

    const queued = entry.next;
    if (queued !== null && entry.elapsed >= entry.duration + queued.queueDelay) {
      const leftover = entry.elapsed - (entry.duration + queued.queueDelay);
      queued.elapsed = leftover;
      queued.trackTime = sampleTimeFor(queued, leftover);
      tracks[i] = queued;
    }
  }
}

// Fire the events of one track's advancing entries (ADR-0008): the outgoing (mixFrom) entry first, then
// the incoming entry, each swept over dt from its PRE-advance wrapped trackTime with exact loop-boundary
// semantics (fireEventsInStep). A crossfading-out track still fires because it is still playing; weight
// does not gate a discrete marker.
function fireEntryEvents(state: AnimationState, entry: InternalEntry, dt: number): void {
  const mixFrom = entry.mixFrom;
  if (mixFrom !== null) fireOneEntryEvents(state, mixFrom, dt);
  fireOneEntryEvents(state, entry, dt);
}

function fireOneEntryEvents(state: AnimationState, entry: InternalEntry, dt: number): void {
  const timeline = getPreparedEvents(state, entry.animation);
  if (timeline === null) return;
  fireEventsInStep(timeline, entry.trackTime, dt, entry.loop, entry.duration, state.eventQueue);
}

// Fetch (building and caching on first use) the prepared event timeline for an animation, payloads
// resolved against the document's EventDefs. A null cache value memoizes "no events" so the common case
// is a single WeakMap hit with no re-preparation.
function getPreparedEvents(
  state: AnimationState,
  animation: Animation,
): PreparedEventTimeline | null {
  const cached = state.preparedEvents.get(animation);
  if (cached !== undefined) return cached;
  const prepared = prepareEventTimeline(animation, state.document.events ?? []);
  state.preparedEvents.set(animation, prepared);
  return prepared;
}

// Advance one entry's raw + wrapped time and, if it is crossfading, its outgoing side and mix time.
function advanceEntry(entry: InternalEntry, dt: number): void {
  entry.elapsed += dt;
  entry.trackTime = advanceWrapped(entry.trackTime, dt, entry.loop, entry.duration);

  const mixFrom = entry.mixFrom;
  if (mixFrom !== null) {
    mixFrom.elapsed += dt;
    mixFrom.trackTime = advanceWrapped(mixFrom.trackTime, dt, mixFrom.loop, mixFrom.duration);
    entry.mixTime += dt;
    if (entry.mixDuration <= 0 || entry.mixTime >= entry.mixDuration) {
      entry.mixFrom = null; // mix complete: drop the outgoing entry (rule 4)
    }
  }
}

// Advance a wrapped/clamped sample time by dt. A looping entry wraps into [0, duration) by single
// subtraction (the bit-deterministic wrap the conformance sampling policy mandates); a non-looping entry
// clamps at duration and stays there (ADR-0005 rule 6, matching sampleSkeleton's per-channel clamp).
function advanceWrapped(trackTime: number, dt: number, loop: boolean, duration: number): number {
  let tt = trackTime + dt;
  if (loop && duration > 0) {
    while (tt >= duration) tt -= duration;
  } else if (tt > duration) {
    tt = duration;
  }
  return tt;
}

// The wrapped/clamped sample time for a raw elapsed value (used when a queued entry starts mid-step and
// inherits the leftover time past its trigger).
function sampleTimeFor(entry: InternalEntry, raw: number): number {
  if (entry.loop && entry.duration > 0) {
    let tt = raw;
    while (tt >= entry.duration) tt -= entry.duration;
    return tt;
  }
  return raw < entry.duration ? raw : entry.duration;
}

// Solve the skeleton with every track blended into step 2 (ADR-0005). Tracks apply in ascending index
// order onto the setup pose; a crossfading track applies its outgoing entry first, then its incoming
// entry (rule 4). The blended locals feed the step-3 constraint solve and the step-4 world pass, so the
// locked six-step order is preserved (mixing lives INSIDE step 2). Allocation-free in steady state: every
// buffer is the reused pose scratch and the prepared animations are cached on the pose.
//
// `activeSkin` scopes skin-scoped constraints (ADR-0009 section 5, ADR-0011 section 4) EXACTLY as
// sampleSkeleton does on the single-animation path: a constraint a skin scopes is solved only when that
// skin is active (the always-active 'default' skin and every unscoped constraint are unaffected). null
// (the default) leaves only 'default' active, matching the historical behavior, so existing callers and
// fixtures are byte-identical. This closes the parity gap where a multi-track render could not turn a
// costume skin's scoped constraints on the way a single-animation render could.
export function applyAnimationState(
  state: AnimationState,
  pose: Pose,
  activeSkin: string | null = null,
  // The frame delta time in seconds (ADR-0014 section 2.2), advancing the PHYSICS clock ONLY. Pass the
  // same dt the tracks were advanced by in updateAnimationState so physics steps in lockstep with the
  // animation. Default 0: a rig with no physics constraints is byte-identical to the pre-physics path.
  frameDt = 0,
): void {
  resetToSetupPose(pose);
  resetSlotsToSetup(pose);
  resetConstraintsToBase(pose);
  beginBlend(pose);

  const tracks = state.tracks;
  for (let i = 0; i < tracks.length; i += 1) {
    const entry = tracks[i];
    if (entry === null || entry === undefined) continue;
    applyEntryWithMix(pose, entry);
  }

  composeTouchedBones(pose);
  solveConstraints(pose, activeSkin, frameDt);
  computeWorldTransforms(pose);
}

// Apply one track entry, expanding a crossfade into outgoing-then-incoming (ADR-0005 rule 4). The
// incoming weight eases LINEARLY: w_in = clamp(mixTime / mixDuration, 0, 1). Outgoing applies at
// alpha * (1 - w_in), incoming at alpha * w_in, outgoing first so the incoming lerps ON TOP of it.
function applyEntryWithMix(pose: Pose, entry: InternalEntry): void {
  const mixFrom = entry.mixFrom;
  if (mixFrom === null) {
    applyEntrySingle(pose, entry, entry.alpha);
    return;
  }
  const wIn = entry.mixDuration > 0 ? clamp01(entry.mixTime / entry.mixDuration) : 1;
  applyEntrySingle(pose, mixFrom, entry.alpha * (1 - wIn));
  applyEntrySingle(pose, entry, entry.alpha * wIn);
}

// Apply one entry (no mix expansion) at an absolute blend weight through the shared step-2 sampler. An
// additive entry ignores discrete channels (rule 3), so discreteWins mirrors !additive.
function applyEntrySingle(pose: Pose, entry: InternalEntry, weight: number): void {
  const prepared = getPreparedAnimation(pose, entry.animation);
  applyAnimationAt(pose, prepared, entry.trackTime, weight, entry.additive, !entry.additive);
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
