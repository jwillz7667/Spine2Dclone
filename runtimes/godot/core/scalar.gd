extends RefCounted
# Scalar helpers shared by the constraint solvers (mirrors packages/runtime-core/src/solve/scalar.ts and
# runtimes/unity Scalar.cs). Deterministic (no clock, no random): platform agnostic solve math.

const DEG_TO_RAD := PI / 180.0
const RAD_TO_DEG := 180.0 / PI


static func clampd(value: float, lo: float, hi: float) -> float:
	if value < lo:
		return lo
	if value > hi:
		return hi
	return value


static func lerp_f(from_value: float, to_value: float, t: float) -> float:
	return from_value + ((to_value - from_value) * t)


# Wrap a degree delta into (-180, 180] so an angular blend always takes the short way around.
static func wrap_degrees(deg: float) -> float:
	var wrapped := fmod(deg, 360.0)
	if wrapped > 180.0:
		wrapped -= 360.0
	elif wrapped <= -180.0:
		wrapped += 360.0
	return wrapped
