extends SceneTree
# Headless VIEW-layer entry (PP-E1/E2 view remainder). Runs the engine-agnostic GDScript view build (view/*)
# over the committed rigs that carry drawables, comparing draw-item world geometry, draw order, blend/tint,
# and sequence naming against the fixtures, plus the region-placement / atlas-UV unit checks and the buffer
# assembler's batching invariants. Run with:
#
#   /Applications/Godot.app/Contents/MacOS/Godot --headless --path runtimes/godot \
#       --script tests/run_view.gd
#
# The final line is the sentinel GODOT_VIEW_RESULT: PASS or FAIL (the run.sh wrapper checks it, so Godot's
# parse-error-exits-0 quirk is caught as a failure).

const ViewHarness = preload("res://tests/view_harness.gd")
# Preloading the Node2D renderer forces it to COMPILE headlessly: a GDScript parse or type error in the
# rendering adapter (which is otherwise only exercised in-editor) fails this script's load, the sentinel is
# absent, and run.sh reports failure, rather than the error hiding until a developer opens the scene.
const MarionetteSkeleton = preload("res://view/marionette_skeleton.gd")

const MAX_FAILURES_SHOWN := 25

# The committed rigs that carry drawable attachments AND a fixture lane the view asserts (mesh world
# vertices, per-slot blend/color, or resolved sequence frames). Bone-only and geometry-only rigs (no region
# or mesh attachment) gather no draw items and are covered by the solve harness alone.
const DRAWABLE_RIGS := [
	"rig-rigid-mesh",
	"rig-weighted-mesh",
	"rig-linked-mesh",
	"rig-deform",
	"rig-clipping",
	"rig-blendmodes",
	"rig-sequences",
]


func _init() -> void:
	var all_ok := true

	print("== PP-E1/E2 Godot view layer conformance ==")
	# Reference the preloaded renderer so the compile-guard const is not optimized away.
	print("renderer script compiled: %s" % (MarionetteSkeleton != null))
	print("")
	print("-- region placement + atlas UV unit checks --")
	var units = ViewHarness.run_geometry_units()
	if units.ok():
		print("PASS geometry units  %d comparison(s)" % units.comparisons)
	else:
		all_ok = false
		print("FAIL geometry units  %d failure(s):" % units.failures.size())
		for i in range(min(units.failures.size(), MAX_FAILURES_SHOWN)):
			print("       %s" % units.failures[i])

	print("")
	print("-- drawable rigs (draw items vs fixtures) --")
	for rig_id in DRAWABLE_RIGS:
		var result = ViewHarness.run(rig_id)
		if result.ok():
			print("PASS %-26s %5d comparison(s)" % [rig_id, result.comparisons])
		else:
			all_ok = false
			print("FAIL %-26s %d failure(s):" % [rig_id, result.failures.size()])
			for i in range(min(result.failures.size(), MAX_FAILURES_SHOWN)):
				print("       %s" % result.failures[i])

	print("")
	print("GODOT_VIEW_RESULT: %s" % ("PASS" if all_ok else "FAIL"))
	quit(0 if all_ok else 1)
