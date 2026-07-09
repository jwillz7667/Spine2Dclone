extends RefCounted
# The A.5 tolerance policy, ported verbatim from packages/conformance/src/compare/tolerance.ts (and
# matching runtimes/unity Tolerance.cs). There is no per runtime tolerance and no other epsilon;
# loosening any value to make this runtime pass is forbidden (the fix is to fix the runtime). A pair
# matches iff |actual - expected| <= atol + rtol * max(|actual|, |expected|). Integer and discrete lanes
# (blendMode, vertex count, sample count) compare EXACT, never through this band.

class Tolerance:
	var atol: float
	var rtol: float

	func _init(a: float, r: float) -> void:
		atol = a
		rtol = r

	func within(actual: float, expected: float) -> bool:
		var diff := absf(actual - expected)
		return diff <= atol + (rtol * max(absf(actual), absf(expected)))


# World basis a, b, c, d (rotation/scale/shear, near 1 magnitudes): tight absolute term.
static var WORLD_BASIS: Tolerance = Tolerance.new(1e-6, 1e-6)

# World translation tx, ty (rig units, can be large): the relative term dominates at large coords.
static var WORLD_TRANSLATION: Tolerance = Tolerance.new(1e-4, 1e-6)

# Skinned and deformed vertex world positions: absolute term near zero, relative term at scale.
static var VERTEX: Tolerance = Tolerance.new(1e-4, 1e-5)

# Slot color r, g, b, a (bounded 0..1): no relative term needed.
static var COLOR: Tolerance = Tolerance.new(1e-5, 0.0)

# Event float payloads (authored values, low noise): mirrors EVENT_FLOAT in tolerance.ts.
static var EVENT_FLOAT: Tolerance = Tolerance.new(1e-5, 1e-6)

# World rotation in DEGREES for a point attachment (ADR-0012 section 2): point.rotation plus the bone's
# world x-axis angle (an atan2). A small absolute band with a light relative term, mirrors ANGLE in
# tolerance.ts. Point world x/y ride the VERTEX class like every other world position.
static var ANGLE: Tolerance = Tolerance.new(1e-4, 1e-6)


# Affine lanes [a, b, c, d, tx, ty]: 0..3 are the basis class, 4..5 the translation class.
static func for_lane(lane: int) -> Tolerance:
	return WORLD_BASIS if lane < 4 else WORLD_TRANSLATION
