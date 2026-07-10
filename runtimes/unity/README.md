# runtimes/unity: Marionette C# runtime (shared solve + view layer)

The engine-agnostic C# port of `packages/runtime-core`, per ADR-0001, plus the Unity view layer that
drops into a scene. The Marionette solve is implemented ONCE as a pure C# library with no `UnityEngine`
and no third party packages, so Unity and Godot are thin rendering adapters over one shared core rather
than two independent reimplementations. The view build (draw-item gather, batching, vertex assembly) is a
SECOND engine-agnostic library so it too is headless-testable; only a thin MonoBehaviour references
`UnityEngine`. This directory is PP-E1: the fixture-driven solve core, the view layer, and the
conformance harness. The GameCI batchmode job lands in a later PP-E1 slice.

## Three assemblies (two headless, one Unity)

- `Marionette.Runtime.Core` (netstandard2.1): the solve. Zero `UnityEngine`, compiles standalone.
- `Marionette.Runtime.View` (netstandard2.1): the ENGINE-AGNOSTIC view build. It turns a solved `Pose`
  plus the render-only document (region/mesh geometry, atlas) into ordered, batched draw buffers. Zero
  `UnityEngine`; references only the solve core. This is where the buffer building, draw-order batching,
  blend-mode grouping, and vertex assembly live, so all of it is covered by the xUnit conformance suite.
- `Marionette.Runtime.Unity.View` (Unity asmdef, NOT in the dotnet solution): the thin drop-in
  MonoBehaviour (`SkeletonRenderer`), the pooled Unity mesh uploader (`SkeletonMeshBuilder`), the slot
  shader (`MarionetteSlot.shader`), and a code-only example (`ExampleBootstrap`). This is the ONLY code
  that references `UnityEngine`. Unity compiles it; the headless dotnet build never touches it.

### The UnityEngine-free guard

`Marionette.Runtime.Core` and `Marionette.Runtime.View` must never reference `UnityEngine`. The guard is
mechanical: both build under `dotnet build` with no Unity present (CI runs `dotnet test`, which builds the
whole solution), so a stray `using UnityEngine;` in either fails the headless build immediately. The Unity
MonoBehaviour lives in a separate folder outside the solution and is wrapped in
`#if UNITY_2021_3_OR_NEWER`, so it cannot leak an engine type back into the shared assemblies.

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

## Drop-in usage (Unity)

The view layer is a UPM-style source package. To use it in a Unity 2021.3 LTS (or newer) project:

1. Build the two engine-agnostic assemblies as DLLs and copy them into your Unity project's
   `Assets/Plugins/Marionette/` (turn OFF "Auto Reference" on both, which the asmdef expects):

   ```sh
   cd runtimes/unity
   dotnet build Marionette.Runtime.View/Marionette.Runtime.View.csproj -c Release
   # copy Marionette.Runtime.Core.dll and Marionette.Runtime.View.dll from the bin/Release/netstandard2.1
   # output into Assets/Plugins/Marionette/
   ```

2. Copy the `Marionette.Runtime.Unity.View/` folder (the asmdef, the two scripts, the shader, the example)
   into your project's `Assets/`. Its asmdef references the two DLLs by name.

3. Create four materials from `Marionette/Slot` and set their `_SrcBlend` / `_DstBlend` per the table in
   `MarionetteSlot.shader` (normal, additive, multiply, screen). Use the premultiplied-alpha factors below.

4. Add a `SkeletonRenderer` component to a GameObject and assign, in the inspector: the document JSON (a
   `.mrnt` export saved as a `.json` `TextAsset`), the atlas page `Texture2D`(s) named to match the page
   file names in the document atlas, the animation name, and the four materials. Press Play.

### Premultiplied alpha and blend equations (WP-5.2)

Atlas pages are emitted premultiplied by default (the FIXED PMA policy, `premultipliedAlpha` in
`atlas-targets.json`; see `docs/plan/phase-5-texture-transport.md`). Import the page `Texture2D`(s) with
`Alpha Is Transparency` off and let the material sample the already-premultiplied texels; the four slot
materials set `_SrcBlend` / `_DstBlend` to the premultiplied-alpha factors below, identical to the web and
Godot runtimes so additive/screen blends match:

| Blend mode | `_SrcBlend` | `_DstBlend` |
|---|---|---|
| `normal` | `One` | `OneMinusSrcAlpha` |
| `additive` | `One` | `One` |
| `multiply` | `DstColor` | `OneMinusSrcAlpha` |
| `screen` | `One` | `OneMinusSrcColor` |

These are the premultiplied-alpha factors. If a page is consumed straight (`premultipliedAlpha` false),
`normal` and `additive` change their `_SrcBlend` to `SrcAlpha`; `multiply` and `screen` are unchanged. This
is a mechanical material setting; the on-device confirmation that the ASTC variant binds is the WP-5.6 layer.

### Example scene

There is no committed `.unity` asset (a hand-authored scene YAML is fragile and cannot be verified in CI).
Instead, `ExampleBootstrap` wires an equivalent scene in code: attach it to an empty GameObject, assign the
same inputs, and press Play. It frames an orthographic camera on the rig and starts the animation. The
hand-built equivalent is: one orthographic `Camera` at `(0, 0, -10)` looking down `-Z`, and one GameObject
with `SkeletonRenderer`; the component creates one child `MeshRenderer` per draw batch under itself.

The `apps/editor` save flow (or the MCP `document.save` tool) produces the document JSON; the atlas page
PNGs come from the same export. Region attachment `path` values and the document atlas `page.file` names
are the keys the renderer resolves against.

## Running the tests

Requires the .NET SDK 8 or newer. `dotnet test` builds all three solution projects (the two engine-agnostic
assemblies and the test assembly) and runs the solve AND view conformance suites; the Unity MonoBehaviour is
verified in-editor (it is outside the solution).

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
