#!/usr/bin/env bash
# Hardened headless entry for the PP-E2 Godot conformance run. Runs the SceneTree harness and treats a
# missing success sentinel as a failure, guarding against Godot's quirk of exiting 0 on a script PARSE
# error (a broken harness would otherwise look green). The direct command the README documents is
# equivalent on a well formed harness; this wrapper is the CI safe form.
#
# Override the binary with GODOT=/path/to/godot; defaults to the macOS app bundle.
set -uo pipefail

GODOT="${GODOT:-/Applications/Godot.app/Contents/MacOS/Godot}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

output="$("$GODOT" --headless --path "$PROJECT_DIR" --script tests/run_conformance.gd 2>&1)"
code=$?

echo "$output"

if [ "$code" -ne 0 ]; then
	exit "$code"
fi

if ! printf '%s\n' "$output" | grep -q "GODOT_CONFORMANCE_RESULT: PASS"; then
	echo "run.sh: success sentinel absent (harness did not complete); treating as failure" >&2
	exit 1
fi
