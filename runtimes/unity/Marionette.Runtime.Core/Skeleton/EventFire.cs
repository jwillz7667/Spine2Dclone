using System;
using System.Collections.Generic;
using Marionette.Runtime.Core.Document;

namespace Marionette.Runtime.Core.Skeleton
{
    // Event firing in the solve (ADR-0008 section 2, PP-B4), ported verbatim from
    // packages/runtime-core/src/skeleton/event-fire.ts. Events are DISCRETE markers an animation's event
    // timeline fires as playback time advances PAST them (a TIME-RANGE operation, not a pose channel).
    // Firing is a pure, deterministic function of (timeline, from, dt, loop, duration): no clock, no random.
    // The swept interval is HALF-OPEN on the low end; event times live in [0, duration]; t == duration is
    // the loop point (fires once per loop in the tail), t == 0 is the starting state (does not fire on its
    // own during looping playback).

    // One fired event with its RESOLVED payload (mirrors FiredEvent in event-fire.ts).
    public sealed class FiredEvent
    {
        public string Name;
        public double Time;
        public double IntValue;
        public bool HasInt;
        public double FloatValue;
        public bool HasFloat;
        public string? StringValue;
        public bool HasString;

        public FiredEvent()
        {
            Name = string.Empty;
            StringValue = null;
        }
    }

    // A pooled, drained-per-update event queue (mirrors EventQueue in event-fire.ts). Events grows its
    // capacity only when a single drain fires more events than any prior drain; Count is the live length.
    public sealed class EventQueue
    {
        public List<FiredEvent> Events { get; } = new List<FiredEvent>();
        public int Count;
    }

    public static class EventFire
    {
        public static EventQueue MakeEventQueue() => new EventQueue();

        public static void ClearEventQueue(EventQueue queue)
        {
            queue.Count = 0;
        }

        // Append one resolved event to the pooled queue, growing capacity by at most one entry only when
        // the current drain has already reused every pooled entry.
        private static void Enqueue(EventQueue queue, PreparedEventTimeline timeline, int i)
        {
            FiredEvent entry;
            if (queue.Count < queue.Events.Count)
            {
                entry = queue.Events[queue.Count];
            }
            else
            {
                entry = new FiredEvent();
                queue.Events.Add(entry);
            }

            entry.Name = timeline.Names[i];
            entry.Time = timeline.Times[i];
            entry.IntValue = timeline.IntValues[i];
            entry.HasInt = timeline.HasInt[i];
            entry.FloatValue = timeline.FloatValues[i];
            entry.HasFloat = timeline.HasFloat[i];
            entry.StringValue = timeline.StringValues[i];
            entry.HasString = timeline.HasString[i];
            queue.Count += 1;
        }

        // Fire every key with time in the half-open range (lo, hi], in timeline (ascending index) order.
        private static void FireRange(PreparedEventTimeline timeline, double lo, double hi, EventQueue outQueue)
        {
            int keyCount = timeline.KeyCount;
            double[] times = timeline.Times;
            for (int i = 0; i < keyCount; i += 1)
            {
                double t = times[i];
                if (t > lo && t <= hi)
                {
                    Enqueue(outQueue, timeline, i);
                }
            }
        }

        // Fire every event swept by advancing fromTime (a wrapped sample time in [0, duration) for a looping
        // entry) by dt, into outQueue. Loop-boundary semantics: tail, then one full pass per completed
        // period, then head. Mirrors fireEventsInStep in event-fire.ts.
        public static void FireEventsInStep(
            PreparedEventTimeline timeline,
            double fromTime,
            double dt,
            bool loop,
            double duration,
            EventQueue outQueue)
        {
            if (dt <= 0 || timeline.KeyCount == 0)
            {
                return;
            }

            double end = fromTime + dt;
            if (!loop || duration <= 0 || end <= duration)
            {
                FireRange(timeline, fromTime, end, outQueue);
                return;
            }

            FireRange(timeline, fromTime, duration, outQueue);
            double remaining = end - duration;
            while (remaining >= duration)
            {
                FireRange(timeline, 0, duration, outQueue);
                remaining -= duration;
            }

            if (remaining > 0)
            {
                FireRange(timeline, 0, remaining, outQueue);
            }
        }

        // Wrap a raw progression time into the sampled domain (mirrors wrapSampleTime in event-fire.ts).
        private static double WrapSampleTime(double raw, bool loop, double duration)
        {
            if (loop && duration > 0)
            {
                return raw - (Math.Floor(raw / duration) * duration);
            }

            if (raw < 0)
            {
                return 0;
            }

            return raw > duration ? duration : raw;
        }

        // Collect the ordered fired-event log produced by advancing from raw time `from` to `to` in dt
        // frame steps (the conformance A.4 event-step sweep). Mirrors collectFiredEvents in event-fire.ts.
        public static void CollectFiredEvents(
            PreparedEventTimeline timeline,
            double from,
            double to,
            double dt,
            bool loop,
            double duration,
            EventQueue outQueue)
        {
            if (dt <= 0 || to <= from || timeline.KeyCount == 0)
            {
                return;
            }

            int steps = (int)Math.Ceiling((to - from) / dt);
            for (int k = 1; k <= steps; k += 1)
            {
                double rawStart = from + ((k - 1) * dt);
                double rawEnd = k == steps ? to : from + (k * dt);
                double step = rawEnd - rawStart;
                if (step <= 0)
                {
                    continue;
                }

                FireEventsInStep(timeline, WrapSampleTime(rawStart, loop, duration), step, loop, duration, outQueue);
            }
        }

        // Build a prepared event timeline (ADR-0008 section 2, PP-B4): resolve each event key's payload ONCE
        // by overriding the referenced EventDef's int/float/string defaults with the key's own values.
        // Returns null when the animation fires no events. Mirrors prepareEventTimeline in event-fire.ts.
        public static PreparedEventTimeline? PrepareEventTimeline(
            Animation animation,
            IReadOnlyList<EventDef> eventDefs)
        {
            IReadOnlyList<EventKeyframe> keys = animation.Events;
            int keyCount = keys.Count;
            if (keyCount == 0)
            {
                return null;
            }

            var defByName = new Dictionary<string, EventDef>();
            for (int i = 0; i < eventDefs.Count; i += 1)
            {
                defByName[eventDefs[i].Name] = eventDefs[i];
            }

            var times = new double[keyCount];
            var names = new string[keyCount];
            var intValues = new double[keyCount];
            var hasInt = new bool[keyCount];
            var floatValues = new double[keyCount];
            var hasFloat = new bool[keyCount];
            var stringValues = new string?[keyCount];
            var hasString = new bool[keyCount];

            for (int i = 0; i < keyCount; i += 1)
            {
                EventKeyframe key = keys[i];
                defByName.TryGetValue(key.Name, out EventDef? def);
                times[i] = key.Time;
                names[i] = key.Name;

                int? intValue = key.Int ?? def?.Int;
                if (intValue.HasValue)
                {
                    intValues[i] = intValue.Value;
                    hasInt[i] = true;
                }

                double? floatValue = key.Float ?? def?.Float;
                if (floatValue.HasValue)
                {
                    floatValues[i] = floatValue.Value;
                    hasFloat[i] = true;
                }

                string? stringValue = key.String ?? def?.String;
                if (stringValue != null)
                {
                    stringValues[i] = stringValue;
                    hasString[i] = true;
                }
                else
                {
                    stringValues[i] = null;
                }
            }

            return new PreparedEventTimeline(
                keyCount,
                times,
                names,
                intValues,
                hasInt,
                floatValues,
                hasFloat,
                stringValues,
                hasString);
        }
    }
}
