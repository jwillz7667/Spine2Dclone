# runtimes/unity: Marionette.Runtime.Core (shared C# solve)

The engine-agnostic C# port of `packages/runtime-core`, per ADR-0001. The Marionette solve and (later)
the slot sequencer are implemented ONCE as a pure C# library with no `UnityEngine` and no third party
packages, so Unity and Godot are thin rendering adapters over one shared core rather than two
independent reimplementations. This directory is the first slice of PP-E1: the fixture-driven solve core
and its conformance harness. The Unity view-layer MonoBehaviours and the GameCI batchmode job land in
later PP-E1 slices.

## Layout

```
Marionette.Runtime.Core/                 class library, netstandard2.1, zero UnityEngine references
  Json/                                  dependency-free JSON reader (JsonValue + JsonParser)
  MathCore/Affine.cs                     the 2x3 affine library (struct + packed double[] hot path)
  Document/                              the SkeletonDocument model + the minimal strict RigReader
  Skeleton/                              Pose, BuildPose, TransformMode, Curve, Prepared, WorldTransform,
                                         Sample (the locked solve order), MeshSample (skin + deform)
  Solve/                                 Scalar, AffineChannels, ResolveWorld, Ik, TransformConstraint,
                                         Skin, Deform, the TransformMix/Offset scratch types
  Determinism/                           Prng (spinSeed FNV-1a-32, hash32, Mulberry32) and Crc32
Marionette.Runtime.Core.Tests/           xUnit harness, net8.0
  ConformanceHarness.cs                  loads rig + sample-spec + fixture, solves, compares
  ConformanceTests.cs                    one case per committed skeleton rig (enumerated from the corpus)
  CrossLanguageVectorTests.cs            reproduces the integer determinism corpus bit for bit
  MathTests.cs                           focused unit checks (decompose/compose, invert, bezier table)
  Tolerance.cs, RepoPaths.cs             the ported A.5 tolerance table and repo-root resolution
```

The module boundaries mirror `runtime-core` one for one; only the names follow C# conventions
(`PascalCase`, `Curves`/`SkinSolve` where a plain transliteration would collide with a document type).

## Running the tests

Requires the .NET SDK 8 or newer.

```sh
cd runtimes/unity
dotnet test Marionette.Runtime.Core.sln
```

The harness reads the committed rigs, sample specs, fixtures, and the cross-language vector file DIRECTLY
from `packages/conformance/src` (found by walking up to the repo root). Nothing is copied, so a fixture
regenerated in the TypeScript oracle is seen here with no sync step.

## The parity contract

`runtime-core` (TypeScript) is the behavioral oracle. This C# core must reproduce every committed
fixture within the single shared A.5 tolerance (`packages/conformance/src/compare/tolerance.ts`), and it
must reproduce every value in `packages/conformance/src/cross-language/seed-prng-crc-vectors.json` bit
for bit (integer arithmetic is portable by construction, so those compare EXACT). The tolerance is never
loosened to make this runtime pass; a drift beyond it is a solve bug in this port, not a fixture problem.

Every committed skeleton rig is covered, and the test enumerates them from the fixtures corpus
(`RepoPaths.AllRigIds`, the materialized projection of `registry.ts` `LANDED_RIG_IDS`) rather than a
hardcoded list, so a newly landed rig is picked up automatically and its fixture must then pass. Every
fixture lane is asserted: bone world affines and skinned/deformed mesh vertices (within tolerance), the
per-slot `blendMode` (EXACT) and resolved `color` (COLOR tolerance) of `rig-blendmodes`, every
`WorldFromParentByMode` branch of `rig-transform-modes`, the resolved render-order permutation of
`rig-events-draworder` (ADR-0008 draw order, EXACT integers), and the ordered fired-event log of both
`rig-events-draworder` and `rig-events-loop` (name/int/string/time EXACT, the float payload within the
EVENT_FLOAT tolerance). The fixture reader is strict: a fixture carrying an unknown top-level or
per-sample member is rejected, so a future capture lane fails loudly here rather than being silently
skipped.

Because Unity and Godot share this one core (ADR-0001), the committed fixture coverage is the sole
cross-implementation guard: any solve path a fixture does not exercise has no independent check. Closing
a coverage gap is a fixture addition in `packages/conformance`, a deliberate reviewed act, never a code
change here.

### Determinism and allocation

Angles compose in radians from the degrees stored in the format; the PRNG and CRC run in `uint` with
`unchecked` arithmetic (the C# equivalent of `Math.imul` and the `>>>` logical shift). The per-frame
solve allocates nothing: the `Pose` owns pre-allocated arrays, and the on-demand world resolution and
constraint target reads use per-thread scratch buffers allocated once.
