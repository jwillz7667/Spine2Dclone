import type { Animation, EventDef } from '@marionette/format/types';
import type { PreparedEventTimeline } from './prepared';

// Event firing in the solve (ADR-0008 section 2, PP-B4). Events are DISCRETE markers an animation's
// event timeline fires as playback time advances PAST them; they are not an instantaneous pose channel
// (so they live outside sampleSkeleton, which samples one instant) but a TIME-RANGE operation. Firing is
// a pure, deterministic function of (prepared timeline, from time, advance dt, loop, duration): no clock,
// no random (Law 1). The same call sequence fires the same events, in the same order, on every runtime.
//
// Fire-on-cross model and the loop point. The swept interval is HALF-OPEN on the low end: an event
// exactly at `fromTime` is treated as already passed, an event at the arrival time `fromTime + dt` fires.
// Event times live in [0, duration]. The instant t == duration is the LOOP POINT (it is t == 0 of the
// next iteration); author a loop-boundary event at t == duration so it fires once per loop in the tail
// segment. An event authored at exactly t == 0 is the animation's STARTING state, not a crossed
// transition, so it does not fire on its own during looping playback (every sweep starts at fromTime >= 0
// and is half-open); place fired events at t > 0. This keeps firing stateless (no first-frame special
// case) and coherent: t == 0 is "initial", t == duration is "boundary".

// One fired event with its RESOLVED payload (ADR-0008: the EventDef default overridden by the key). The
// value + presence pairs mirror the optional int/float/string of the format: `hasInt` etc. say whether
// the payload is present at all, `intValue` etc. carry it when present. `time` is the key's authored time
// (the time within the animation at which it fired), deterministic and identical across runtimes.
export interface FiredEvent {
  name: string;
  time: number;
  intValue: number;
  hasInt: boolean;
  floatValue: number;
  hasFloat: boolean;
  stringValue: string | null;
  hasString: boolean;
}

// A pooled, drained-per-update event queue (ADR-0008, the allocation-free steady state). `events` grows
// its capacity ONLY when a single drain fires more events than any prior drain; `count` is the live
// length. clearEventQueue resets count to 0 and keeps the capacity, so a steady per-update fire count
// allocates nothing after warmup (the allocation probe test pins this). Entries are reused in place.
export interface EventQueue {
  events: FiredEvent[];
  count: number;
}

export function makeEventQueue(): EventQueue {
  return { events: [], count: 0 };
}

// Reset the queue to empty WITHOUT releasing capacity (the pooled reuse contract).
export function clearEventQueue(queue: EventQueue): void {
  queue.count = 0;
}

// Append one resolved event to the pooled queue, growing capacity by at most one entry only when the
// current drain has already reused every pooled entry. Primitive lanes and the string ref are copied in
// place, so a fire in steady state allocates nothing.
function enqueue(queue: EventQueue, timeline: PreparedEventTimeline, i: number): void {
  let entry = queue.events[queue.count];
  if (entry === undefined) {
    entry = {
      name: '',
      time: 0,
      intValue: 0,
      hasInt: false,
      floatValue: 0,
      hasFloat: false,
      stringValue: null,
      hasString: false,
    };
    queue.events.push(entry);
  }
  entry.name = timeline.names[i]!;
  entry.time = timeline.times[i]!;
  entry.intValue = timeline.intValues[i]!;
  entry.hasInt = timeline.hasInt[i] === 1;
  entry.floatValue = timeline.floatValues[i]!;
  entry.hasFloat = timeline.hasFloat[i] === 1;
  entry.stringValue = timeline.stringValues[i]!;
  entry.hasString = timeline.hasString[i] === 1;
  queue.count += 1;
}

// Fire every key with time in the half-open range (lo, hi], in timeline (ascending index) order. Because
// event times are non-decreasing, coincident keys keep their authored order (ties broken by index), which
// is the ADR-0008 "coincident events keep timeline order" rule. A scan (timelines are short) with no
// allocation.
function fireRange(
  timeline: PreparedEventTimeline,
  lo: number,
  hi: number,
  out: EventQueue,
): void {
  const { keyCount, times } = timeline;
  for (let i = 0; i < keyCount; i += 1) {
    const t = times[i]!;
    if (t > lo && t <= hi) enqueue(out, timeline, i);
  }
}

// Fire every event swept by advancing `fromTime` (a wrapped sample time in [0, duration) for a looping
// entry, or a clamped time for a non-looping one) by `dt`, into `out`. This is the per-frame primitive
// AnimationState calls each update. Loop-boundary semantics (loop && duration > 0): fire the tail events
// (fromTime, duration], then for EACH fully-swept period fire all events once (0, duration], then the
// head events (0, remainder]. A dt spanning many periods fires each event once per crossing. A zero or
// negative dt (or an empty timeline) fires nothing (the zero-length-range degenerate case).
export function fireEventsInStep(
  timeline: PreparedEventTimeline,
  fromTime: number,
  dt: number,
  loop: boolean,
  duration: number,
  out: EventQueue,
): void {
  if (dt <= 0 || timeline.keyCount === 0) return;
  const end = fromTime + dt;
  if (!loop || duration <= 0 || end <= duration) {
    // Non-looping, or a looping step that stays within the current period (end at or before the loop
    // point): a single half-open sweep. `end === duration` fires the loop-point key once in this tail.
    fireRange(timeline, fromTime, end, out);
    return;
  }
  // The step crosses the loop point: the tail of this period, then one full pass per completed period,
  // then the head of the final period.
  fireRange(timeline, fromTime, duration, out);
  let remaining = end - duration;
  while (remaining >= duration) {
    fireRange(timeline, 0, duration, out);
    remaining -= duration;
  }
  if (remaining > 0) fireRange(timeline, 0, remaining, out);
}

// Wrap a raw progression time into the sampled domain: [0, duration) for a looping entry (single modulo),
// or clamped to [0, duration] for a non-looping one (matching the transport's clamp). Deterministic
// (Math.floor / min-max), so every runtime reproduces it.
function wrapSampleTime(raw: number, loop: boolean, duration: number): number {
  if (loop && duration > 0) return raw - Math.floor(raw / duration) * duration;
  if (raw < 0) return 0;
  return raw > duration ? duration : raw;
}

// Collect the ordered fired-event log produced by advancing the animation from raw time `from` to `to` in
// deterministic `dt` frame steps (the conformance A.4 event-step sweep). Each step fires (wrap(rawStart),
// +step] through fireEventsInStep, so the per-step firing equals the per-frame AnimationState firing. Step
// boundaries are recomputed as `from + k*dt` (not accumulated) so the arithmetic is bit-identical across
// runtimes; the final step is clamped to land exactly on `to`. `dt` must be positive.
export function collectFiredEvents(
  timeline: PreparedEventTimeline,
  from: number,
  to: number,
  dt: number,
  loop: boolean,
  duration: number,
  out: EventQueue,
): void {
  if (dt <= 0 || to <= from || timeline.keyCount === 0) return;
  const steps = Math.ceil((to - from) / dt);
  for (let k = 1; k <= steps; k += 1) {
    const rawStart = from + (k - 1) * dt;
    const rawEnd = k === steps ? to : from + k * dt;
    const step = rawEnd - rawStart;
    if (step <= 0) continue;
    fireEventsInStep(timeline, wrapSampleTime(rawStart, loop, duration), step, loop, duration, out);
  }
}

// Build a prepared event timeline (ADR-0008 section 2, PP-B4): resolve each event key's payload ONCE by
// overriding the referenced EventDef's int/float/string defaults with the key's own values. Returns null
// when the animation fires no events (the common case), so the caller skips event work entirely. An event
// key naming an undefined event (only reachable from an unvalidated draft; the validator rejects it as
// ANIM_EVENT_UNKNOWN) resolves against no defaults. Build-time only.
export function prepareEventTimeline(
  animation: Animation,
  eventDefs: readonly EventDef[],
): PreparedEventTimeline | null {
  // A hand-built draft (a test fixture, an unmigrated doc) may omit the required `events` array; tolerate
  // that with an empty default, the same lenience the ik/transform/deform/drawOrder reads apply.
  const keys = animation.events ?? [];
  const keyCount = keys.length;
  if (keyCount === 0) return null;

  const defByName = new Map<string, EventDef>();
  for (const def of eventDefs) defByName.set(def.name, def);

  const times = new Float64Array(keyCount);
  const names: string[] = [];
  const intValues = new Float64Array(keyCount);
  const hasInt = new Uint8Array(keyCount);
  const floatValues = new Float64Array(keyCount);
  const hasFloat = new Uint8Array(keyCount);
  const stringValues: (string | null)[] = [];
  const hasString = new Uint8Array(keyCount);

  for (let i = 0; i < keyCount; i += 1) {
    const key = keys[i]!;
    const def = defByName.get(key.name);
    times[i] = key.time;
    names.push(key.name);

    const intValue = key.int ?? def?.int;
    if (intValue !== undefined) {
      intValues[i] = intValue;
      hasInt[i] = 1;
    }
    const floatValue = key.float ?? def?.float;
    if (floatValue !== undefined) {
      floatValues[i] = floatValue;
      hasFloat[i] = 1;
    }
    const stringValue = key.string ?? def?.string;
    if (stringValue !== undefined) {
      stringValues.push(stringValue);
      hasString[i] = 1;
    } else {
      stringValues.push(null);
    }
  }

  return {
    keyCount,
    times,
    names,
    intValues,
    hasInt,
    floatValues,
    hasFloat,
    stringValues,
    hasString,
  };
}
