import { memoryUsage } from 'node:process';
import { describe, expect, it } from 'vitest';
import type { Animation, EventDef, SkeletonDocument } from '@marionette/format/types';
import {
  buildPose,
  clearEventQueue,
  collectFiredEvents,
  crossfadeTo,
  fireEventsInStep,
  makeAnimationState,
  makeEventQueue,
  prepareEventTimeline,
  sampleSkeleton,
  setAnimation,
  updateAnimationState,
} from '../src';
import type { EventQueue, FiredEvent, Pose } from '../src';
import { bone, doc, slot } from './anim-fixtures';

// PP-B4 (ADR-0008) runtime-core solve tests: draw-order derivation + application and deterministic event
// firing with exact loop-boundary semantics. Each test would FAIL under a plausible wrong implementation
// (identity draw order, clamped-not-setup below first key, double-firing the loop point, weight-gated
// events, per-fire allocation), so coverage is behavioral, not incidental.

// A three-slot rig on one root bone, with the given animations. Draw order is observable through
// pose.drawOrder (render position -> slot index); slots s0, s1, s2 sit at setup indices 0, 1, 2.
function threeSlotDoc(animations: Record<string, Animation>): SkeletonDocument {
  return doc({
    bones: [bone('root', null)],
    slots: [slot('s0', 'root'), slot('s1', 'root'), slot('s2', 'root')],
    animations,
  });
}

// A draft animation with only a draw-order timeline (bones/slots empty). drawOrder keys are stepped.
function drawOrderAnim(
  duration: number,
  drawOrder: Animation['drawOrder'],
): Animation {
  return {
    duration,
    bones: {},
    slots: {},
    ik: {},
    transform: {},
    deform: {},
    drawOrder,
    events: [],
  };
}

function renderOrder(pose: Pose): number[] {
  return Array.from(pose.drawOrder);
}

describe('PP-B4 draw-order application in the solve', () => {
  it('renders in setup order when no draw-order key is active (below the first key)', () => {
    const document = threeSlotDoc({
      a: drawOrderAnim(1, [{ time: 0.5, offsets: [{ slot: 's0', offset: 2 }] }]),
    });
    const pose = buildPose(document);

    sampleSkeleton(document, 'a', 0.0, pose);

    // t=0 is below the first key (0.5): setup order holds, NOT the first key's reorder (that is the
    // deliberate "before the first key means setup order" rule, distinct from the value-channel clamp).
    expect(renderOrder(pose)).toEqual([0, 1, 2]);
  });

  it('applies the active reorder key (a slot offset moves that slot, others keep relative order)', () => {
    const document = threeSlotDoc({
      a: drawOrderAnim(1, [{ time: 0.5, offsets: [{ slot: 's0', offset: 2 }] }]),
    });
    const pose = buildPose(document);

    sampleSkeleton(document, 'a', 0.6, pose);

    // s0 (setup index 0) moves +2 to render position 2; s1, s2 fill positions 0, 1 in setup order.
    expect(renderOrder(pose)).toEqual([1, 2, 0]);
  });

  it('holds the active key stepped between keys and restores setup order on an empty-offsets key', () => {
    const document = threeSlotDoc({
      a: drawOrderAnim(1, [
        { time: 0.2, offsets: [{ slot: 's2', offset: -2 }] },
        { time: 0.8, offsets: [] },
      ]),
    });
    const pose = buildPose(document);

    sampleSkeleton(document, 'a', 0.5, pose);
    // s2 moved -2 to position 0; s0, s1 fill 1, 2. Held stepped from the t=0.2 key.
    expect(renderOrder(pose)).toEqual([2, 0, 1]);

    sampleSkeleton(document, 'a', 0.9, pose);
    // The empty-offsets key at t=0.8 restores setup order (identity), proving a key can undo a reorder.
    expect(renderOrder(pose)).toEqual([0, 1, 2]);
  });

  it('is reset to setup order each frame (a stale reorder never leaks into a later non-reordering sample)', () => {
    const document = threeSlotDoc({
      reorder: drawOrderAnim(1, [{ time: 0, offsets: [{ slot: 's0', offset: 1 }] }]),
      plain: drawOrderAnim(1, []),
    });
    const pose = buildPose(document);

    sampleSkeleton(document, 'reorder', 0.5, pose);
    expect(renderOrder(pose)).toEqual([1, 0, 2]);

    // A second animation with no draw-order timeline must render setup order (step-1 reset), not the
    // stale reorder from the prior sample.
    sampleSkeleton(document, 'plain', 0.5, pose);
    expect(renderOrder(pose)).toEqual([0, 1, 2]);
  });
});

// --- Event firing -------------------------------------------------------------------------------------

const EVENT_DEFS: readonly EventDef[] = [
  { name: 'step', int: 7, float: 1.5, string: 'default' },
  { name: 'bare' },
];

// An animation whose event timeline fires the given keys. Non-decreasing times (coincident allowed).
function eventAnim(duration: number, events: Animation['events']): Animation {
  return {
    duration,
    bones: {},
    slots: {},
    ik: {},
    transform: {},
    deform: {},
    drawOrder: [],
    events,
  };
}

function firedNames(queue: EventQueue): string[] {
  return queue.events.slice(0, queue.count).map((e) => e.name);
}

function firedTimes(queue: EventQueue): number[] {
  return queue.events.slice(0, queue.count).map((e) => e.time);
}

describe('PP-B4 event firing: single-step and range semantics', () => {
  it('fires every event in the half-open interval (from, from+dt] for a non-looping animation', () => {
    const timeline = prepareEventTimeline(
      eventAnim(2, [
        { time: 0.5, name: 'bare' },
        { time: 1.0, name: 'bare' },
        { time: 1.5, name: 'bare' },
      ]),
      EVENT_DEFS,
    )!;
    const queue = makeEventQueue();

    fireEventsInStep(timeline, 0.5, 0.5, false, 2, queue);

    // (0.5, 1.0]: excludes the event AT 0.5 (already passed), includes the event AT 1.0 (arrival).
    expect(firedTimes(queue)).toEqual([1.0]);
  });

  it('fires nothing for a zero-length range (dt = 0), the degenerate case', () => {
    const timeline = prepareEventTimeline(
      eventAnim(2, [{ time: 0.5, name: 'bare' }]),
      EVENT_DEFS,
    )!;
    const queue = makeEventQueue();

    fireEventsInStep(timeline, 0.0, 0, true, 2, queue);

    expect(queue.count).toBe(0);
  });

  it('fires tail then head events across a loop boundary, in that order', () => {
    const timeline = prepareEventTimeline(
      eventAnim(1, [
        { time: 0.3, name: 'bare', int: 1 },
        { time: 0.9, name: 'bare', int: 2 },
      ]),
      EVENT_DEFS,
    )!;
    const queue = makeEventQueue();

    // From 0.8, advance 0.6 -> sweeps 0.8..1.4, crossing the loop point: tail fires t=0.9, then the next
    // period's head (0, 0.4] fires t=0.3. A step that stopped short of 1.3 would not reach the head event.
    fireEventsInStep(timeline, 0.8, 0.6, true, 1, queue);

    expect(firedTimes(queue)).toEqual([0.9, 0.3]);
    expect(queue.events.slice(0, 2).map((e) => e.intValue)).toEqual([2, 1]);
  });

  it('fires a duration-equal (loop-point) key once per loop and never fires a t=0 key while looping', () => {
    const timeline = prepareEventTimeline(
      eventAnim(1, [
        { time: 0, name: 'bare', int: 100 }, // starting-state key: must NOT fire on a sweep from >= 0
        { time: 1, name: 'bare', int: 200 }, // loop-point key: fires once per crossing
      ]),
      EVENT_DEFS,
    )!;
    const queue = makeEventQueue();

    // Sweep 0.5 -> 2.5 (two full loop crossings at t=1 and t=2): the loop-point key fires twice, the
    // t=0 key never fires.
    fireEventsInStep(timeline, 0.5, 2.0, true, 1, queue);

    expect(queue.events.slice(0, queue.count).map((e) => e.intValue)).toEqual([200, 200]);
  });

  it('a full-wrap step (dt >= duration) fires every event at least once', () => {
    const timeline = prepareEventTimeline(
      eventAnim(1, [
        { time: 0.25, name: 'bare' },
        { time: 0.75, name: 'bare' },
      ]),
      EVENT_DEFS,
    )!;
    const queue = makeEventQueue();

    fireEventsInStep(timeline, 0.0, 1.5, true, 1, queue);

    // 0.0 -> 1.5 crosses both events once in the first period (0.25, 0.75) and 0.25 again in the head.
    expect(firedTimes(queue)).toEqual([0.25, 0.75, 0.25]);
  });

  it('keeps timeline order for coincident-time events', () => {
    const timeline = prepareEventTimeline(
      eventAnim(1, [
        { time: 0.5, name: 'step', string: 'first' },
        { time: 0.5, name: 'bare', string: 'second' },
      ]),
      EVENT_DEFS,
    )!;
    const queue = makeEventQueue();

    fireEventsInStep(timeline, 0.0, 1.0, false, 1, queue);

    expect(firedNames(queue)).toEqual(['step', 'bare']);
    expect(queue.events.slice(0, 2).map((e) => e.stringValue)).toEqual(['first', 'second']);
  });

  it('resolves payloads: EventDef defaults, overridden per key', () => {
    const timeline = prepareEventTimeline(
      eventAnim(1, [
        { time: 0.5, name: 'step' }, // inherits def int 7, float 1.5, string "default"
        { time: 0.9, name: 'step', int: 42, string: 'override' }, // overrides int + string, keeps float
      ]),
      EVENT_DEFS,
    )!;
    const queue = makeEventQueue();

    fireEventsInStep(timeline, 0.0, 1.0, false, 1, queue);

    const [inherited, overridden] = [queue.events[0]!, queue.events[1]!];
    expect([inherited.intValue, inherited.floatValue, inherited.stringValue]).toEqual([7, 1.5, 'default']);
    expect([overridden.intValue, overridden.floatValue, overridden.stringValue]).toEqual([
      42, 1.5, 'override',
    ]);
  });

  it('a bare event (no defaults, no overrides) carries no payload presence flags', () => {
    const timeline = prepareEventTimeline(eventAnim(1, [{ time: 0.5, name: 'bare' }]), EVENT_DEFS)!;
    const queue = makeEventQueue();

    fireEventsInStep(timeline, 0.0, 1.0, false, 1, queue);

    const fired = queue.events[0]!;
    expect([fired.hasInt, fired.hasFloat, fired.hasString]).toEqual([false, false, false]);
  });

  it('prepareEventTimeline returns null for an animation with no events', () => {
    expect(prepareEventTimeline(eventAnim(1, []), EVENT_DEFS)).toBeNull();
  });

  it('collectFiredEvents over a multi-loop range equals the per-frame sweep (deterministic frame advance)', () => {
    const timeline = prepareEventTimeline(
      eventAnim(1, [
        { time: 0.4, name: 'bare' },
        { time: 0.9, name: 'bare' },
      ]),
      EVENT_DEFS,
    )!;

    const collected = makeEventQueue();
    collectFiredEvents(timeline, 0, 2.5, 0.1, true, 1, collected);

    // Reference: advancing 0 -> 2.5 crosses each event at every period boundary it sits in. Over [0, 2.5)
    // (t wraps at 1, 2), t=0.4 fires at 0.4, 1.4, 2.4 and t=0.9 at 0.9, 1.9 -> 5 fires, in swept order.
    expect(firedTimes(collected)).toEqual([0.4, 0.9, 0.4, 0.9, 0.4]);
  });
});

// --- AnimationState event queue -----------------------------------------------------------------------

function stateDoc(animations: Record<string, Animation>, events: readonly EventDef[]): SkeletonDocument {
  return {
    formatVersion: '0.3.0',
    name: 'anim-state-events',
    hash: '',
    bones: [bone('root', null)],
    slots: [],
    skins: [{ name: 'default', attachments: {} }],
    ikConstraints: [],
    transformConstraints: [],
    events: [...events],
    animations,
    atlas: { pages: [] },
  };
}

describe('PP-B4 AnimationState event queue (drained per update)', () => {
  it('fills the queue with the events fired by an advancing track and drains it each update', () => {
    const document = stateDoc(
      { walk: eventAnim(1, [{ time: 0.5, name: 'step' }]) },
      EVENT_DEFS,
    );
    const state = makeAnimationState(document);
    setAnimation(state, 0, 'walk', true);

    updateAnimationState(state, 0.6); // sweeps 0 -> 0.6, crossing t=0.5
    expect(firedNames(state.eventQueue)).toEqual(['step']);

    updateAnimationState(state, 0.2); // sweeps 0.6 -> 0.8, crossing nothing
    expect(state.eventQueue.count).toBe(0); // drained: the prior fire does not linger
  });

  it('a crossfading-out track still fires its events (weight does not gate a discrete marker)', () => {
    const document = stateDoc(
      {
        outgoing: eventAnim(1, [{ time: 0.5, name: 'step', string: 'out' }]),
        incoming: eventAnim(1, [{ time: 0.5, name: 'bare', string: 'in' }]),
      },
      EVENT_DEFS,
    );
    const state = makeAnimationState(document);
    setAnimation(state, 0, 'outgoing', true);
    crossfadeTo(state, 0, 'incoming', true, 1.0); // both entries advance during the mix

    updateAnimationState(state, 0.6); // both sweep 0 -> 0.6, each crossing its t=0.5 event

    // Outgoing (mixFrom) fires before incoming, matching apply order.
    expect(firedNames(state.eventQueue)).toEqual(['step', 'bare']);
  });

  it('allocation probe: the pooled queue stops growing after warmup (no per-update heap growth)', () => {
    const document = stateDoc(
      {
        loop: eventAnim(1, [
          { time: 0.25, name: 'bare' },
          { time: 0.75, name: 'bare' },
        ]),
      },
      EVENT_DEFS,
    );
    const state = makeAnimationState(document);
    setAnimation(state, 0, 'loop', true);

    // Warm the pool: after a few updates the queue capacity has grown to the steady per-update fire count.
    for (let i = 0; i < 200; i += 1) updateAnimationState(state, 0.1);
    const capacityAfterWarmup = state.eventQueue.events.length;

    if (globalThis.gc) globalThis.gc();
    const before = memoryUsage().heapUsed;
    for (let i = 0; i < 20000; i += 1) updateAnimationState(state, 0.1);
    const after = memoryUsage().heapUsed;

    // The pooled queue array does not grow after warmup (entries are reused in place).
    expect(state.eventQueue.events.length).toBe(capacityAfterWarmup);
    // And the steady state adds no measurable heap (a loose bound; the exact figure is GC-timing noise).
    expect(after - before).toBeLessThan(2_000_000);
  });
});

// Type-only guard: FiredEvent's public shape is what a renderer/consumer reads.
const _firedEventShape: FiredEvent = {
  name: 'x',
  time: 0,
  intValue: 0,
  hasInt: false,
  floatValue: 0,
  hasFloat: false,
  stringValue: null,
  hasString: false,
};
void _firedEventShape;

// Silence unused imports guard: clearEventQueue is part of the drain surface exercised implicitly by
// updateAnimationState; assert it resets count for a directly-built queue too.
describe('PP-B4 clearEventQueue', () => {
  it('resets count without releasing capacity', () => {
    const timeline = prepareEventTimeline(eventAnim(1, [{ time: 0.5, name: 'bare' }]), EVENT_DEFS)!;
    const queue = makeEventQueue();
    fireEventsInStep(timeline, 0, 1, false, 1, queue);
    const capacity = queue.events.length;
    expect(queue.count).toBe(1);

    clearEventQueue(queue);

    expect(queue.count).toBe(0);
    expect(queue.events.length).toBe(capacity);
  });
});
