extends SceneTree
# Headless conformance entry (PP-E2). Runs the shared GDScript solve over the nine committed skeleton rigs
# and the cross language integer vector corpus, prints per rig and per family results, and exits nonzero
# on any failure so CI gates on it. Run with:
#
#   /Applications/Godot.app/Contents/MacOS/Godot --headless --path runtimes/godot \
#       --script tests/run_conformance.gd
#
# The final line is the sentinel GODOT_CONFORMANCE_RESULT: PASS or FAIL (the run.sh wrapper checks it, so
# even Godot's parse-error-exits-0 quirk is caught as a failure).

const ConformanceHarness = preload("res://tests/conformance_harness.gd")
const CrossLanguageVectors = preload("res://tests/cross_language_vectors.gd")
const RigReaderBoundary = preload("res://tests/rig_reader_boundary.gd")

# The nine committed skeleton rigs (packages/conformance/src/registry.ts RIG_IDS), in catalog order.
const RIG_IDS := [
	"rig-2bone",
	"rig-rigid-mesh",
	"rig-weighted-mesh",
	"rig-one-bone-ik",
	"rig-two-bone-ik",
	"rig-transform-constraint",
	"rig-deform",
	"rig-transform-modes",
	"rig-blendmodes",
]

const MAX_FAILURES_SHOWN := 25


func _init() -> void:
	var all_ok := true

	print("== PP-E2 Godot runtime core conformance ==")
	print("conformance src: %s" % preload("res://tests/repo_paths.gd").conformance_src())
	print("")
	print("-- skeleton rigs (fixtures within A.5 tolerance) --")
	for rig_id in RIG_IDS:
		var result = ConformanceHarness.run(rig_id)
		if result.ok():
			print(
				"PASS %-26s %5d lanes  maxBasis=%s maxTrans=%s maxVertex=%s maxColor=%s"
				% [
					rig_id,
					result.lane_comparisons,
					String.num_scientific(result.max_basis_error),
					String.num_scientific(result.max_translation_error),
					String.num_scientific(result.max_vertex_error),
					String.num_scientific(result.max_color_error),
				]
			)
		else:
			all_ok = false
			print("FAIL %-26s %d failure(s):" % [rig_id, result.failures.size()])
			for i in range(min(result.failures.size(), MAX_FAILURES_SHOWN)):
				print("       %s" % result.failures[i])

	print("")
	print("-- cross language integer vectors (bit exact) --")
	var vectors = CrossLanguageVectors.run()
	for row in vectors.families:
		var family: String = row[0]
		var checked: int = row[1]
		var family_ok: bool = row[2]
		print("%s %-20s %d vector(s)" % ["PASS" if family_ok else "FAIL", family, checked])
	if not vectors.ok():
		all_ok = false
		print("  vector failures:")
		for i in range(min(vectors.failures.size(), MAX_FAILURES_SHOWN)):
			print("       %s" % vectors.failures[i])

	print("")
	print("-- rig reader boundary (validate on import, Law 3) --")
	var boundary = RigReaderBoundary.run()
	if boundary.ok():
		print("PASS rig reader boundary  %d case(s) (positive + negative)" % boundary.checked)
	else:
		all_ok = false
		print("FAIL rig reader boundary  %d failure(s):" % boundary.failures.size())
		for i in range(min(boundary.failures.size(), MAX_FAILURES_SHOWN)):
			print("       %s" % boundary.failures[i])

	print("")
	print("GODOT_CONFORMANCE_RESULT: %s" % ("PASS" if all_ok else "FAIL"))
	quit(0 if all_ok else 1)
