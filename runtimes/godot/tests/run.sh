#!/usr/bin/env bash
# Hardened headless entry for the PP-E2 Godot runs. Runs BOTH the solve conformance harness and the view
# layer harness and treats a missing success sentinel from either as a failure, guarding against Godot's
# quirk of exiting 0 on a script PARSE error (a broken harness would otherwise look green). The direct
# commands the README documents are equivalent on well formed harnesses; this wrapper is the CI safe form.
#
# Override the binary with GODOT=/path/to/godot; defaults to the macOS app bundle.
set -uo pipefail

GODOT="${GODOT:-/Applications/Godot.app/Contents/MacOS/Godot}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Run one harness script and require its success sentinel; returns nonzero on a nonzero exit or a missing
# or non-PASS sentinel. Args: <script path relative to project> <sentinel token>.
run_harness() {
	local script="$1"
	local sentinel="$2"
	local output
	output="$("$GODOT" --headless --path "$PROJECT_DIR" --script "$script" 2>&1)"
	local code=$?

	echo "$output"

	if [ "$code" -ne 0 ]; then
		return "$code"
	fi

	if ! printf '%s\n' "$output" | grep -q "$sentinel: PASS"; then
		echo "run.sh: sentinel '$sentinel' absent or not PASS ($script); treating as failure" >&2
		return 1
	fi

	return 0
}

run_harness "tests/run_conformance.gd" "GODOT_CONFORMANCE_RESULT" || exit 1
run_harness "tests/run_view.gd" "GODOT_VIEW_RESULT" || exit 1
