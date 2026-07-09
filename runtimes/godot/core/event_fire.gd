extends RefCounted
# Event firing in the solve (ADR-0008 section 2, PP-B4), ported verbatim from
# packages/runtime-core/src/skeleton/event-fire.ts (and matching runtimes/unity EventFire.cs, LAW 4).
# Events are DISCRETE markers an animation's event timeline fires as playback time advances PAST them: a
# TIME-RANGE operation, not an instantaneous pose channel, so firing lives here and not in the skeleton
# sampler. Firing is a pure, deterministic function of (timeline, from, dt, loop, duration): no clock, no
# random (Law 1). The same call sequence fires the same events, in the same order, on every runtime.
#
# The swept interval is HALF-OPEN on the low end: an event exactly at from is already passed, an event at
# the arrival time from + dt fires. Event times live in [0, duration]. t == duration is the LOOP POINT
# (t == 0 of the next iteration): a loop-boundary event authored there fires once per loop in the tail
# segment. An event authored at exactly t == 0 is the STARTING state, not a crossed transition, so it does
# not fire on its own during looping playback; place fired events at t > 0.

const Document = preload("res://core/document.gd")
const Prepared = preload("res://core/prepared.gd")


# One fired event with its RESOLVED payload (mirrors FiredEvent in event-fire.ts). int_value / float_value
# are stored as numbers with a presence flag; string_value is null when absent. time is the key's authored
# time, deterministic and identical across runtimes.
class FiredEvent:
	var name: String = ""
	var time: float = 0.0
	var int_value: float = 0.0
	var has_int: bool = false
	var float_value: float = 0.0
	var has_float: bool = false
	var string_value = null  # String or null
	var has_string: bool = false


# A pooled, drained-per-update event queue (mirrors EventQueue in event-fire.ts). events grows its
# capacity ONLY when a single drain fires more events than any prior drain; count is the live length.
class EventQueue:
	var events: Array = []  # Array[FiredEvent]
	var count: int = 0


static func make_event_queue() -> EventQueue:
	return EventQueue.new()


# Reset the queue to empty WITHOUT releasing capacity (the pooled reuse contract).
static func clear_event_queue(queue: EventQueue) -> void:
	queue.count = 0


# Append one resolved event to the pooled queue, growing capacity by at most one entry only when the
# current drain has already reused every pooled entry.
static func _enqueue(queue: EventQueue, timeline: Prepared.PreparedEventTimeline, i: int) -> void:
	var entry: FiredEvent
	if queue.count < queue.events.size():
		entry = queue.events[queue.count]
	else:
		entry = FiredEvent.new()
		queue.events.append(entry)
	entry.name = timeline.names[i]
	entry.time = timeline.times[i]
	entry.int_value = timeline.int_values[i]
	entry.has_int = timeline.has_int[i] == 1
	entry.float_value = timeline.float_values[i]
	entry.has_float = timeline.has_float[i] == 1
	entry.string_value = timeline.string_values[i]
	entry.has_string = timeline.has_string[i] == 1
	queue.count += 1


# Fire every key with time in the half-open range (lo, hi], in timeline (ascending index) order. Because
# event times are non-decreasing, coincident keys keep their authored order (ties broken by index).
static func _fire_range(timeline: Prepared.PreparedEventTimeline, lo: float, hi: float, out_queue: EventQueue) -> void:
	var key_count := timeline.key_count
	var times := timeline.times
	for i in range(key_count):
		var t := times[i]
		if t > lo and t <= hi:
			_enqueue(out_queue, timeline, i)


# Fire every event swept by advancing from_time (a wrapped sample time in [0, duration) for a looping
# entry, or a clamped time for a non-looping one) by dt, into out_queue. Loop-boundary semantics
# (loop and duration > 0): fire the tail events (from_time, duration], then for EACH fully-swept period
# fire all events once (0, duration], then the head events (0, remainder]. A zero or negative dt (or an
# empty timeline) fires nothing. Mirrors fireEventsInStep in event-fire.ts.
static func fire_events_in_step(timeline: Prepared.PreparedEventTimeline, from_time: float, dt: float, loop: bool, duration: float, out_queue: EventQueue) -> void:
	if dt <= 0.0 or timeline.key_count == 0:
		return
	var end := from_time + dt
	if not loop or duration <= 0.0 or end <= duration:
		_fire_range(timeline, from_time, end, out_queue)
		return
	_fire_range(timeline, from_time, duration, out_queue)
	var remaining := end - duration
	while remaining >= duration:
		_fire_range(timeline, 0.0, duration, out_queue)
		remaining -= duration
	if remaining > 0.0:
		_fire_range(timeline, 0.0, remaining, out_queue)


# Wrap a raw progression time into the sampled domain: [0, duration) for a looping entry (single modulo),
# or clamped to [0, duration] for a non-looping one. Deterministic (floor / min-max). Mirrors
# wrapSampleTime in event-fire.ts.
static func _wrap_sample_time(raw: float, loop: bool, duration: float) -> float:
	if loop and duration > 0.0:
		return raw - (floor(raw / duration) * duration)
	if raw < 0.0:
		return 0.0
	return duration if raw > duration else raw


# Collect the ordered fired-event log produced by advancing from raw time `from` to `to` in deterministic
# dt frame steps (the conformance A.4 event-step sweep). Step boundaries are recomputed as from + k*dt
# (not accumulated) so the arithmetic is bit-identical across runtimes; the final step is clamped to land
# exactly on `to`. dt must be positive. Mirrors collectFiredEvents in event-fire.ts.
static func collect_fired_events(timeline: Prepared.PreparedEventTimeline, from: float, to: float, dt: float, loop: bool, duration: float, out_queue: EventQueue) -> void:
	if dt <= 0.0 or to <= from or timeline.key_count == 0:
		return
	var steps := int(ceil((to - from) / dt))
	for k in range(1, steps + 1):
		var raw_start := from + (float(k - 1) * dt)
		var raw_end := to if k == steps else from + (float(k) * dt)
		var step := raw_end - raw_start
		if step <= 0.0:
			continue
		fire_events_in_step(timeline, _wrap_sample_time(raw_start, loop, duration), step, loop, duration, out_queue)


# Build a prepared event timeline (ADR-0008 section 2, PP-B4): resolve each event key's payload ONCE by
# overriding the referenced EventDef's int/float/string defaults with the key's own values. Returns null
# when the animation fires no events (the common case), so the caller skips event work entirely. Mirrors
# prepareEventTimeline in event-fire.ts.
static func prepare_event_timeline(animation: Document.AnimationDef, event_defs: Array):
	var keys := animation.events
	var key_count := keys.size()
	if key_count == 0:
		return null

	var def_by_name := {}
	for def in event_defs:
		def_by_name[def.name] = def

	var timeline := Prepared.PreparedEventTimeline.new()
	timeline.key_count = key_count
	timeline.times = PackedFloat64Array()
	timeline.times.resize(key_count)
	timeline.names = []
	timeline.int_values = PackedFloat64Array()
	timeline.int_values.resize(key_count)
	timeline.has_int = PackedByteArray()
	timeline.has_int.resize(key_count)
	timeline.float_values = PackedFloat64Array()
	timeline.float_values.resize(key_count)
	timeline.has_float = PackedByteArray()
	timeline.has_float.resize(key_count)
	timeline.string_values = []
	timeline.has_string = PackedByteArray()
	timeline.has_string.resize(key_count)

	for i in range(key_count):
		var key = keys[i]
		var def = def_by_name.get(key.name, null)
		timeline.times[i] = key.time
		timeline.names.append(key.name)

		var int_value = key.int_value if key.int_value != null else (def.int_value if def != null else null)
		if int_value != null:
			timeline.int_values[i] = int_value
			timeline.has_int[i] = 1

		var float_value = key.float_value if key.float_value != null else (def.float_value if def != null else null)
		if float_value != null:
			timeline.float_values[i] = float_value
			timeline.has_float[i] = 1

		var string_value = key.string_value if key.string_value != null else (def.string_value if def != null else null)
		if string_value != null:
			timeline.string_values.append(string_value)
			timeline.has_string[i] = 1
		else:
			timeline.string_values.append(null)

	return timeline
