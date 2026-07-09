# runtimes/godot: Marionette runtime core (GDScript)

The Godot port of `packages/runtime-core` (PP-E2, Lane E of the Pro Parity Execution Program). It is the
fixture-driven solve core plus a headless conformance harness, written in pure GDScript.

Unlike the Unity runtime (`runtimes/unity`, a shared C# library per ADR-0001), this port does NOT reuse a
shared C# core: the installed Godot is the NON-.NET build, so C# is unavailable and the ADR-0001
shared-core option does not apply here. The solve is therefore reimplemented in GDScript from the same two
references: the TypeScript oracle (`packages/runtime-core`, the behavioral source of truth) and the C#
port (`runtimes/unity`, a second reference). Every value is validated to the SAME committed fixtures and
the SAME cross-language vectors as the other runtimes.

## Layout

```
project.godot                    Godot 4 project (Node-free core, no rendering, no scene tree in core/)
core/                            the platform-agnostic solve, one module per runtime-core module:
  affine.gd                      the 2x3 affine library (packed PackedFloat64Array hot path)
  scalar.gd, affine_channels.gd  clamp/lerp/wrap-degrees, and the world channel decompose/compose
  transform_mode.gd              the five bone transformMode inheritance branches
  document.gd                    the SkeletonDocument model (Node-free value classes)
  rig_reader.gd                  the minimal strict rig JSON reader (typed RigReadError)
  pose.gd, build_pose.gd         pre-allocated solve storage and its build from a document
  curve.gd, prepared.gd          timeline curve evaluation (10-segment bezier table) and prebuilt tracks
  world_transform.gd             solve steps 1 and 4 (reset, world pass)
  resolve_world.gd               on-demand ancestor-chain world resolution for the constraint solve
  sample.gd                      the LOCKED solve order (reset, timelines, constraints, world)
  ik.gd, transform_constraint.gd  one/two-bone IK, then transform constraints (document order)
  skin.gd, deform.gd, mesh_sample.gd  skinning (weighted + rigid) and post-skin additive deform
  prng.gd, crc32.gd              the integer determinism surface (Mulberry32/hash32/FNV-1a, CRC-32)
tests/
  repo_paths.gd                  walks up to packages/conformance/src (single source of truth)
  tolerance.gd                   the ported A.5 atol/rtol table
  conformance_harness.gd         loads rig + sample-spec + fixture, solves, compares
  cross_language_vectors.gd      reproduces the integer determinism corpus bit for bit
  rig_reader_boundary.gd         validate-on-import positive + negative checks (Law 3)
  run_conformance.gd             the SceneTree entry (per-rig results, exits nonzero on failure)
  run.sh                         hardened wrapper (checks the success sentinel)
```

The module boundaries mirror `runtime-core` one for one; only the names follow GDScript conventions
(`snake_case`, and `TimelineCurve`/`SkinDef`/`AnimationDef`/`Curves` where a plain transliteration would
collide with a native Godot class such as `Curve`, `Skin`, or `Animation`).

## Running the harness

Requires Godot 4 (verified on 4.6.3 stable, the non-.NET build). Run headless from the repository root:

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path runtimes/godot \
    --script tests/run_conformance.gd
```

It prints per-rig pass/fail with the max observed error per tolerance class, the per-family vector
results, and the rig-reader boundary result, then exits 0 on success and 1 on any drift. The last line is
the sentinel `GODOT_CONFORMANCE_RESULT: PASS` or `FAIL`.

For CI, prefer the wrapper, which additionally treats a MISSING sentinel as a failure (Godot exits 0 on a
script parse error, so a broken harness would otherwise look green):

```sh
GODOT=/path/to/godot runtimes/godot/tests/run.sh
```

The harness reads the committed rigs, sample specs, fixtures, and the cross-language vector file DIRECTLY
from `packages/conformance/src` (found by walking up to the repo root). Nothing is copied, so a fixture
regenerated in the TypeScript oracle is seen here with no sync step.

## The parity contract

`runtime-core` (TypeScript) is the behavioral oracle. This GDScript core must reproduce every committed
fixture within the single shared A.5 tolerance (`packages/conformance/src/compare/tolerance.ts`), and it
must reproduce every value in `packages/conformance/src/cross-language/seed-prng-crc-vectors.json` bit for
bit (integer arithmetic is portable by construction, so those compare EXACT). The tolerance is never
loosened to make this runtime pass; a drift beyond it is a solve bug in this port, not a fixture problem.
In practice the observed drift sits at the f64 round-off floor (order 1e-16 on the basis, 1e-14 on
translation), orders of magnitude below the A.5 band.

Every committed skeleton rig is covered, and the harness enumerates them from the fixtures corpus
(`RepoPaths.all_rig_ids`, the materialized projection of `registry.ts` `LANDED_RIG_IDS`) rather than a
hardcoded list, so a newly landed rig is picked up automatically and its fixture must then pass. Every
fixture lane is asserted: bone world affines and skinned/deformed mesh vertices (within tolerance), the
per-slot `blendMode` (EXACT) and resolved `color` (COLOR tolerance) of `rig-blendmodes`, every
`world_from_parent_by_mode` branch of `rig-transform-modes`, the resolved render-order permutation of
`rig-events-draworder` (ADR-0008 draw order, EXACT integers), and the ordered fired-event log of both
`rig-events-draworder` and `rig-events-loop` (name/int/string/time EXACT, the float payload within the
EVENT_FLOAT tolerance; the half-open loop sweep exercised by `rig-events-loop`). The fixture reader is
strict: a fixture carrying an unknown top-level or per-sample member is rejected, so a future capture lane
fails loudly here rather than being silently skipped.

Format compatibility: the rig reader accepts BOTH formatVersion 0.2.0 (current) and 0.3.0 (the
additive-empty-collections revision: document `events`, animation `drawOrder`/`events`, optional
`metadata`). It requires every field the solve consumes, permits those additive members, and fails loudly
with a typed `RigReadError` on a missing required field, a wrong type, or an unsupported format major.

Because Godot's dictionaries preserve insertion order and its JSON parser inserts members in document
order, the ordered maps (skin attachments, animation channels, deform triples) iterate exactly as the TS
solve's `Object.keys()` order, so member-order-sensitive results match.

## Determinism: uint32 emulation (the vectors)

The integer determinism surface (`prng.gd`, `crc32.gd`) is where a naive port silently diverges, so it is
emulated explicitly. GDScript integers are 64-bit SIGNED, so:

- Every intermediate is masked to 32 bits with `& 0xFFFFFFFF`. A masked value is always non-negative, so
  GDScript's `>>` is the logical (unsigned) right shift the algorithms need, and `|` / `^` stay in the
  32-bit domain.
- `Math.imul` (the 32-bit truncating multiply) is `Prng.imul32`. It CANNOT be written as `(a * b) &
  0xFFFFFFFF`: `0xFFFFFFFF * 0xFFFFFFFF` is about 2^64 and overflows the signed 64-bit range. The operands
  are split into 16-bit halves so no partial product exceeds about 2^49 (which fits in int64):
  `a*b mod 2^32 = (a_lo*b_lo + ((a_hi*b_lo + a_lo*b_hi) << 16)) mod 2^32` (the `a_hi*b_hi*2^32` term
  vanishes mod 2^32).
- `spinSeed` runs FNV-1a-32 over the UTF-8 bytes of the spinId (`String.to_utf8_buffer`), not UTF-16 code
  units, so non-ASCII spinIds derive the same seed as in TS and C#.

The harness reproduces all six families bit for bit: `spinSeed`, `hash32`, the `instanceSeed` chain,
the Mulberry32 first-16 stream, the CRC-32/ISO-HDLC check value, and the twin-body CRC over each committed
`.bin` rig (the container CRC excluding its 4-byte trailer).

## Toolchain

- Godot 4.6.3 stable, official, non-.NET build. `--headless` and `--script` are used; the run exits
  nonzero on failure via `quit(code)`.
- Standalone script mode promotes some benign GDScript warnings to load errors, so `project.godot` sets
  `debug/gdscript/warnings/treat_warnings_as_errors=false`; the core is otherwise written warning-clean.
- All solve math runs in f64 (GDScript `float` is a double), the width the TS oracle solves in. Skinned
  and deformed vertex outputs are stored through a `PackedFloat32Array` so they round to single precision
  exactly as the TS `Float32Array` the fixtures were generated from.
