# Cross-cutting: Conformance suite, testing pyramid, CI/CD

> Plan of record for workstream **V** (Verification). Owner: Runtime/Platform lead. Status: proposed, awaiting senior sign-off.
> Cross-references: handoff sections 6 (format), 7 (math boundary), 8.1 (commands), 8.4 to 8.8 (solve), 8.11 (conformance), 9 (phases), 11 (conventions).
> Companion plans: `docs/plan/format/*`, `docs/plan/runtime-core/*`, `docs/plan/runtime-web/*`, `docs/plan/phase-4-slot-composer.md` (WP-4.13 implements WP-V.5).

This document specifies the mechanism that keeps the runtimes (web, Unity, Godot) producing identical presentation
from the same format, and the testing/CI scaffolding that gates every PR. It is the enforcement layer for the
architectural laws. Where a work package implements a law, that law is named inline.

Independence model (amended in Phase 5 by `docs/adr/0001-shared-csharp-runtime-core.md`). There are TWO independent
solve implementations, not three: the TS `runtime-core` (the behavioral oracle) and ONE engine-agnostic C# core
(`Marionette.Runtime.Core`) reused by both Unity and Godot. Cross-language parity is therefore proven TS-vs-C# over
the whole fixture set; Unity-vs-Godot agreement is structural by construction (same C# code), and each engine still
runs the dump through its own actual load + render path so integration is exercised per engine. Wherever Section B
below says a native runtime "reimplements the solve" or "reimplements the sequencer", read it as "runs the canonical
solve and slot sequencer via the shared C# core (ADR-0001), exercised through that engine's load + render path".
Because Unity and Godot no longer cross-check each other, the A.2 reference-rig coverage checklist (every solve
branch: IK both bend directions, all transformModes, stepped and bezier curves, deform-after-skin) is the SOLE
compensating control: any solve path not exercised by a committed fixture has zero cross-implementation verification.

## 0. Laws and invariants this workstream enforces

This table is the authoritative enforcement map. All five non-negotiable laws and all six engineering invariants
appear; none is silently omitted. Where a law is process-enforced rather than CI-enforced, that is stated, not dropped.

| ID | Law / invariant (handoff) | Enforced here by |
|---|---|---|
| L1 | Math/presentation boundary: same `SpinResult` in, identical visuals out | WP-V.5 (TS determinism, skeletal + slot corpus); WP-V.13 / WP-V.14 (native runtimes reproduce the slot corpus, Phase 5) |
| L2 | All document mutations are commands; do/undo round-trip mandatory | WP-V.6 (registry-driven parametric round-trip over EVERY registered command), WP-V.10 (brand-token + import restriction) |
| L3 | The data format is the contract; semver, validate on import, fail loudly | WP-V.6 (format-validation tests), WP-V.12 (semver gate) |
| L4 | Legal boundary on Spine: first-principles, own format, no Spine source/binaries | WP-V.1 (rigs authored by us), WP-V.2 (fixtures generated from our core) |
| L5 | Phase independence, build in order: each phase ends in a usable artifact | WP-V.16 (per-phase required-check set grows only as landed jobs exist; `ci-pass` never depends on a not-yet-existing job) + the Phase-0 package-existence guard (`docs/plan/phase-0-foundations.md` section 8: CI fails if a future-phase package appears before its phase). Plan-order sequencing itself is process-enforced (reviewer gate), noted here for completeness. |
| INV-1 | `runtime-core` (and `format`) is platform-agnostic and dependency-light | WP-V.10 (boundary lint + CI grep guard + `package.json` dependency allowlist; bans PixiJS, Node built-ins, DOM/browser globals, Electron, and nondeterministic globals, not only PixiJS) |
| INV-2 | Fixtures generated FROM `runtime-core` (TS = behavioral source of truth), committed | WP-V.2 (generator + pinned toolchain + fixtures-lock) |
| INV-3 | Identical per-frame solve order across all runtimes, INCLUDING step sub-ordering | WP-V.1 (rigs that make IK-then-transform and skin-then-deform observable; transform-mode rigs), WP-V.2/.4/.13/.14 (one solve spec, one fixture set) |
| INV-4 | TS strict, no `any`/unjustified `as` in `format` + `runtime-core` | WP-V.9 (typecheck), WP-V.10 (lint) |
| INV-5 | 60fps; pool objects; no per-frame allocation in solve/render | WP-V.8 (frame-time + GC-count allocation gates) |
| INV-6 | No em-dashes and no en-dashes anywhere | WP-V.10 (lint rule scanning U+2014 and U+2013) |

## 1. Scope and non-scope

In scope: `packages/conformance` design, the reference rig catalog, the expected-output fixture format, the
epsilon/tolerance policy, the fixture-generation toolchain pin, fixture generation and its review gate, the
per-runtime harnesses (skeletal and slot), the parity comparison tool, drift semantics, the testing pyramid mapped to
this repo, the full GitHub Actions pipeline, and the phasing of Unity/Godot onto the suite.

Out of scope (owned elsewhere, referenced only): the solve algorithms themselves (runtime-core plans), the slot
sequencer algorithm (Phase 4, WP-4.7), the math engine internals (do not rebuild), atlas/asset pipeline details, and
panel UX.

---

## A. `packages/conformance` design

### A.1 Package layout

```
packages/conformance/
  package.json                 # name: @marionette/conformance, private; dep allowlist enforced (A.7)
  .node-version-check.ts       # asserts the pinned generation toolchain (A.7) before generate runs
  src/
    index.ts                   # barrel: rig loader, fixture loader, compare API
    rigs/
      registry.ts              # RigId union + ordered RIG_IDS + RIG_PHASE map + provenance hashes
      rig-2bone.json
      rig-weighted-mesh.json
      rig-ik-2bone.json
      rig-deform.json
      rig-events-draworder.json
      rig-transform-constraint.json
      rig-ik-into-transform.json     # IK output feeds a transform-constraint target (sub-order, A.2)
      rig-weighted-deform.json       # weighted mesh that ALSO carries a deform timeline (sub-order, A.2)
      rig-transform-modes.json       # parent with rotation + non-uniform scale; one child per non-normal mode (A.2)
      rig-blendmodes.json            # all four blend modes on four slots (decoupled coverage, A.2)
      rig-events-loop.json           # looped events that fire across a wrap (A.2, A.4)
    sample-spec/
      <rigId>.sample-spec.json # the times + stepping every runtime must use
    fixtures/
      <rigId>.fixture.json     # COMMITTED expected outputs (generated from runtime-core on the pinned toolchain)
      .fixtures.lock           # sha256 manifest of rigs+spec+fixtures + the generation toolchain id (drift tripwire)
    slot/                      # slot-presentation corpus (owned by WP-V.5; authored/generated in Phase 4)
      scenes/<sceneId>.slotscene.json
      spins/<spinId>.spin.json
      expected/<pairId>.timeline.json
      .slot.fixtures.lock
    schema/
      rig.schema.json          # rig == valid SkeletonDocument (re-uses format schema); canonical JSON Schema
      sample-spec.schema.json  # canonical JSON Schema (draft 2020-12)
      fixture.schema.json      # canonical JSON Schema; the cross-runtime validation artifact (A.3, A.8)
      timeline.schema.json     # canonical JSON Schema for the slot PresentationTimeline golden
    compare/
      tolerance.ts             # the single source of the epsilon policy (A.5)
      compare-skeletal.ts      # numeric + discrete parity engine for rig fixtures (B.5)
      compare-slot.ts          # EXACT deep-equal parity for the integer-exact slot timeline (B.5)
      report.ts                # structured diff -> JSON + human report
    generate.ts                # skeletal fixture generator CLI (INV-2); imports runtime-core + format ONLY
    generate-slot.ts           # slot golden generator CLI (INV-2); imports runtime-core + math-bridge value types ONLY
    harness-web.ts             # runtime-web parity harness reading the post-solve SkeletonState (B.2)
  bin/
    mc-conformance             # CLI: generate | generate-slot | verify | compare <dump.json>
  test/
    conformance.test.ts        # Vitest entry that runs web parity + the coverage meta-test in CI (B.2)
```

Dependency rule (INV-1, INV-2): `generate.ts` imports `@marionette/runtime-core` and `@marionette/format` only;
`generate-slot.ts` additionally imports the `@marionette/math-bridge` value types only. Neither imports
`@marionette/runtime-web`, PixiJS, Electron, Node-only or DOM-only modules, or anything platform-bound. This keeps the
source of truth pure. Enforced by the WP-V.10 boundary lint scoped to `generate*.ts` and by the A.7 dependency
allowlist.

### A.2 Reference rig catalog (WP-V.1)

Each rig is a hand-authored, minimal, deterministic `SkeletonDocument` (handoff section 6) that exercises a small,
named set of solve-order steps so a failure localizes to a subsystem. Rigs are authored by us from first principles
and contain no Spine-derived data (L4). Each rig file is a valid format document and passes the format validator on
load (L3).

Solve-order steps (handoff section 6, memorized identically by all runtimes): (1) reset to setup, (2) apply timelines,
(3) constraints IK then transform, (4) world transforms (single forward pass, parents precede children), (5) skin then
apply deform offsets, (6) draw order with blend mode and color.

The catalog is eleven rigs. The `Lands` column is the phase in which the rig's fixture is committed and its solve
features exist; this drives the landed-rig gating in B.2 and the phasing in Section E.

| RigId | Lands | Bones | Attachments | Constraints | Timelines exercised | Solve steps targeted | Curve coverage |
|---|---|---|---|---|---|---|---|
| `rig-2bone` | Phase 1 | root + child (length 100 each) | none | none | `rotate` on both bones, `translate` on root | 1, 2, 4 | linear + stepped |
| `rig-weighted-mesh` | Phase 2 | 2 bones in a chain | 1 weighted quad mesh (4 verts, 2 influences/vert, weights sum to 1) | none | `rotate` on both bones | 1, 2, 4, 5 (LBS only) | linear |
| `rig-ik-2bone` | Phase 2 | upper + lower + target bone | none | one `IkConstraint` (2-bone) | `translate` on target (singularity-guarded, A.5), `ik` mix ramp 0 to 1, both `bendPositive` values (two animations) | 1, 2, 3 (IK), 4 | linear + bezier |
| `rig-deform` | Phase 2 | 1 bone | 1 mesh attachment (unweighted, 6 verts) | none | `deform` per-vertex offsets keyed at 3 times | 1, 2, 4, 5 (deform on unweighted mesh) | bezier (per-vertex interp) |
| `rig-events-draworder` | Phase 2 | 1 bone | 3 region attachments on 3 slots | none | `attachment` (stepped), slot `color`, `drawOrder` reorders 3 slots, 4 `events` (int/float/string payloads) | 1, 2, 6 (draw order, color) | stepped + linear (color) |
| `rig-transform-constraint` | Phase 2 | source + target + 2 constrained bones | none | one `TransformConstraint` (mixRotate/mixX/mixY/mixScaleX nonzero, offsets nonzero) | `rotate`+`scale` on target, `transform` mix ramp | 1, 2, 3 (transform), 4 | linear + bezier |
| `rig-ik-into-transform` | Phase 2 | upper + lower + ikTarget + transformed bone | one `IkConstraint` whose solved tip bone is the SOURCE of one `TransformConstraint` | `translate` on ikTarget, both mix ramps | 1, 2, 3 (IK THEN transform, order-sensitive), 4 | linear |
| `rig-weighted-deform` | Phase 2 | 2 bones in a chain | 1 WEIGHTED quad mesh (4 verts, 2 influences/vert) that ALSO carries a `deform` timeline | `rotate` on both bones + `deform` offsets at 3 times | 1, 2, 4, 5 (skin THEN deform, order-sensitive) | linear + bezier |
| `rig-transform-modes` | Phase 2 | rotated, non-uniformly-scaled parent + 4 children | none | `rotate`+`scale` on parent | 1, 2, 4 (transformMode inheritance, observable) | linear |
| `rig-blendmodes` | Phase 2 | 1 bone | 4 region attachments on 4 slots | none | static (setup-pose capture) | 6 (one slot per `BlendMode`) | none |
| `rig-events-loop` | Phase 2 | 1 bone | none | none | 3 `events`, two near `t=0` and one near `t=duration`; `loop=true` | 1, 2 (events across a wrap, A.4) | n/a |

Coverage obligations the catalog must collectively satisfy. These are asserted by a meta-test in `conformance.test.ts`
that activates in Phase 2 (when the full catalog has landed). In Phase 1 the meta-test is skipped (B.2 / Section E):

- [ ] At least one rig per solve-order step 1 through 6.
- [ ] **transformMode is observable, not merely present.** Each non-`normal` mode (`onlyTranslation`,
      `noRotationOrReflection`, `noScale`, `noScaleOrReflection`) appears on a `rig-transform-modes` child whose PARENT
      has nontrivial rotation (>= 30 degrees) AND non-uniform scale (scaleX/scaleY ratio outside [0.8, 1.25]). The
      meta-test asserts, for each such child, that its captured world basis differs from the `normal`-mode basis under
      the same parent by MORE than the bug-magnitude epsilon (1e-2). A runtime that treats the mode as `normal` cannot
      pass. (Necessary-but-not-sufficient coverage is rejected here on purpose.)
- [ ] **Step-3 sub-order is observable.** `rig-ik-into-transform` routes an IK-solved bone into a transform
      constraint. A runtime-core reference unit test (C.1) computes the rig both ways (IK-then-transform vs
      transform-then-IK) and asserts the two outputs differ by > 1e-2, proving the rig is order-sensitive, so a
      runtime that solves transform-then-IK fails conformance.
- [ ] **Step-5 sub-order is observable.** `rig-weighted-deform` is a WEIGHTED mesh carrying a `deform` timeline. A
      runtime-core reference unit test computes deform-after-LBS (the canonical order) vs deform-before-LBS and asserts
      they differ by > 1e-2 for at least one sample, proving the rig pins the skin-then-deform composition order.
- [ ] Every `CurveType` (`linear`, `stepped`, `bezier`) appears in at least one timeline (bezier rides on the rigs
      that naturally need it: `rig-ik-2bone`, `rig-deform`, `rig-transform-constraint`, `rig-weighted-deform`).
- [ ] Every `BlendMode` (`normal`, `additive`, `multiply`, `screen`) appears on a slot of `rig-blendmodes` (a
      dedicated rig so blend coverage does not couple onto rigs that isolate a different subsystem, see A.6).
- [ ] Weighted encoding (variable-length, section 6) and unweighted encoding both appear.
- [ ] Both `bendPositive` values appear in `rig-ik-2bone` (one animation each).
- [ ] At least one animation samples past `duration` to pin clamp-vs-loop behavior; `rig-events-loop` pins cross-wrap
      event firing.

Rigs are intentionally tiny (under 12 bones, under 8 vertices per mesh) so fixtures stay small and diffs are
human-readable in review. They are NOT production rigs; they are unit tests in skeleton form.

### A.3 Expected-output fixture format (WP-V.2)

A fixture is the canonical, serialized result of running `runtime-core` over a rig at the sampled times. It is the
contract every runtime must reproduce. One fixture file per rig.

```jsonc
// <rigId>.fixture.json
{
  "rigId": "rig-ik-2bone",
  "rigHash": "sha256:...",            // hash of the rig file the fixture was generated from
  "specHash": "sha256:...",           // hash of the sample-spec used
  "coreVersion": "runtime-core@0.4.0",// provenance, not used in comparison
  "toolchain": "node-22.13.1-v8",     // pinned generation toolchain id (A.7), recorded for provenance + the lock
  "generatedBy": "generate.ts",
  "samples": [
    {
      "time": 0.123,
      "animation": "default",
      "loop": false,
      // Bone world transform serialized as the 2x3 affine [a, b, c, d, tx, ty]
      // in document bone order (parents precede children). Decomposition is NOT
      // stored; the matrix is canonical to avoid atan2 ambiguity in comparison.
      "bones": {
        "root":  [1, 0, 0, 1, 0, 0],
        "upper": [0.8660254037844387, 0.49999999999999994, -0.5, 0.8660254, 0, 0],
        "lower": [/* ... */]
      },
      // Final on-screen vertex positions AFTER skinning + deform, in world space,
      // flat [x0,y0,x1,y1,...] in mesh vertex index order, per slot.attachment.
      "vertices": {
        "slotA/meshA": [12.0, 0.0, 112.0, 0.0, 112.0, 30.0, 12.0, 30.0]
      },
      // Resolved draw order at this time: slot names, low to high (back to front).
      "drawOrder": ["slotA", "slotB", "slotC"],
      // Active attachment + resolved color per slot (step 6 inputs).
      "slots": {
        "slotA": { "attachment": "meshA", "color": [1, 1, 1, 1], "blendMode": "normal" }
      }
    }
    // ... one entry per sample time
  ],
  // Event log is a separate ordered stream (events fire across frame advance, not at instants).
  "events": [
    { "seq": 0, "time": 0.25, "name": "footstep", "intValue": 1 },
    { "seq": 1, "time": 0.50, "name": "spawnVfx", "stringValue": "coinShowerLarge", "floatValue": 1.5 }
  ]
}
```

Serialization rules (deterministic by construction):

- Floats are written with JavaScript shortest round-trippable representation (`Number.prototype.toString`), so the
  JSON re-parses to the exact same f64. Comparison is numeric with epsilon (A.5); JSON precision never bottlenecks parity.
- Object keys are emitted in a stable order (bone order = document order; vertices/slots = sorted by key). The
  generator sorts deterministically so `git diff` is meaningful.
- No timestamps, no machine paths, no RNG. The generator is a pure function of (rig, sample-spec, runtime-core).
- World transforms are stored as the raw affine, not decomposed rotation/scale/shear, because `atan2`/`acos` differ
  across language math libs and we do not want decomposition noise polluting parity (A.5). NOTE: storing the raw
  affine avoids RE-INTRODUCING decomposition noise on read; it does not remove the transcendental noise (`sin`/`cos`/
  `acos`) the solve already baked into the matrix. The tolerance (A.5) is the only thing absorbing that, which is why
  the tolerance is conditioning-aware for IK (A.5).

Validation: every fixture is validated against `fixture.schema.json`, the CANONICAL cross-runtime JSON Schema (A.8). A
fixture failing its schema fails CI.

### A.4 Sampling policy (WP-V.0)

Sample times are NOT chosen per runtime. They live in `sample-spec/<rigId>.sample-spec.json`, are committed, and every
runtime (TS, Unity, Godot) reads the same file. This guarantees INV-3 at the sampling layer.

```jsonc
// <rigId>.sample-spec.json
{
  "rigId": "rig-ik-2bone",
  "animation": "default",
  "duration": 1.0,
  "loop": false,
  // Instantaneous pose samples (bones/vertices/drawOrder). Mix of:
  //  - exact keyframe times (boundary + stepped behavior)
  //  - between-keyframe irrational-ish times (interpolation + bezier)
  //  - t = duration and t > duration (clamp vs loop)
  "poseTimes": [0.0, 0.123, 0.25, 0.5, 0.6667, 0.999, 1.0, 1.25],
  // Event sampling is a deterministic frame advance, NOT an instant. All runtimes
  // advance from 0 to duration with fixed dt and fire events in (prev, cur].
  "eventStep": { "dt": 0.016666666666666666, "from": 0.0, "to": 1.0 }
}
```

Pose sampling semantics every runtime implements identically:

1. Reset to setup pose (step 1).
2. Apply the animation at absolute `time` with the rig's `loop` flag (step 2). For pose samples, `prevTime` is set
   equal to `time` so no events fire during pose sampling (events are sampled separately).
3. Solve constraints IK then transform (step 3), then world transforms (step 4), then skin then deform (step 5).
4. Capture bone affines, world-space vertex positions, resolved draw order, and per-slot attachment/color.

Event sampling semantics (fully specified so authors and ports cannot diverge):

- Maintain a single running accumulator. The increment is a single add `t = t + dt` (NOT `from + n*dt`), because the
  single-add recurrence accumulates identically under IEEE-754 on every conforming runtime, whereas `n*dt` and the
  single add round differently.
- **Termination and the `to` boundary.** Step while `t < to` (strict). The next candidate is `cur = t + dt`. If
  `cur >= to`, the final step CLAMPS `cur = to` (an assignment of the committed `to` constant, identical across
  runtimes) and the loop ends after evaluating it. Consequence, stated so it is not a surprise: the event window is
  half-open on the left and closed on the right, `(prev, cur]`, so an event whose `time` equals `to` exactly DOES fire
  in the final window. This is a deliberate choice; do not re-optimize it per runtime.
- **Firing.** At each step, fire every event whose local time is in `(prevLocal, curLocal]`, in `time` then catalog
  order, assigning a monotonically increasing `seq`.
- **Cross-loop (wrap) firing (`rig-events-loop`, loop=true).** Local time is advanced by the same single add and
  wrapped by a single subtract of the committed `duration` constant: `localT = localT + dt; if (localT >= duration) {
  localT = localT - duration; wrapped = true }`. The single subtract is bit-deterministic across runtimes (same
  operands, same order); fmod/IEEERemainder are NOT used because their cross-language behavior is not guaranteed
  identical. On a wrapped step the window splits into `(prevLocal, duration]` then `(0, curLocal]`, evaluated in that
  order, so events near the end of the clip fire before events near the start of the next loop. This pins the classic
  cross-runtime divergence (events near `t=0` after a wrap) instead of leaving it unspecified.

### A.5 Epsilon / tolerance policy (WP-V.3)

We deliberately do NOT pursue bit-exact parity across runtimes for SKELETAL fixtures. (The SLOT timeline is a separate,
integer-exact case compared with no epsilon, see B.5.) Justification (this is the load-bearing decision of the whole
suite, so it is stated explicitly):

- IEEE-754 f64 arithmetic is not associative, and C# (.NET), GDScript/C++ (Godot), and V8 (JS) reorder floating
  operations differently, may contract `a*b+c` into a fused multiply-add on some targets and not others, and ship
  different `sin`/`cos`/`atan2`/`acos`/`sqrt` implementations whose last 1 to 3 ULPs disagree. A two-bone IK solve
  (law of cosines) routes through `acos` and `atan2`; LBS routes through long sums. Demanding bit-identity would force
  a shared software-float library in every runtime, which is enormous cost for zero product value.
- Therefore parity is asserted with a tolerance, but the tolerance must be tight. A loose epsilon hides the bugs we
  actually care about: degrees-vs-radians, row-major-vs-column-major matrices, wrong bend direction, missing weight
  normalization, wrong solve order, off-by-one keyframe interpolation. Those produce errors of 1e-2 or larger, orders
  of magnitude above floating noise. The epsilon is set well below real-bug magnitude and well above f64 reordering
  noise. The band is wide and unambiguous, which is exactly why a tight-but-nonzero epsilon works.

Combined absolute + relative tolerance per quantity class. A pair `(actual, expected)` matches iff
`abs(actual - expected) <= atol + rtol * max(abs(actual), abs(expected))`.

| Quantity class | atol | rtol | Rationale |
|---|---|---|---|
| World translation `tx, ty` (rig units, can be ~1e3) | 1e-4 | 1e-6 | sub-thousandth-pixel; relative term dominates at large coords |
| World basis `a, b, c, d` (order ~1) | 1e-6 | 1e-6 | rotation/scale/shear; near-1 magnitudes, tight abs term (IK conditioning bound below justifies 1e-6) |
| Skinned/deformed vertex `x, y` | 1e-4 | 1e-6 | same units as translation; LBS sums accumulate a little noise |
| Slot color `r,g,b,a` (0..1) | 1e-5 | 0 | bounded 0..1, no relative term needed |
| Event `floatValue` | 1e-5 | 1e-6 | authored values, low noise |

**IK conditioning justification for the 1e-6 basis tolerance (WP-V.3, addresses near-singularity).** `acos` is
ill-conditioned as its argument approaches +/-1 (chain fully folded or fully extended), where
`d(acos)/dx = -1 / sqrt(1 - x^2)` grows without bound. Two mitigations make the 1e-6 basis tolerance safe rather than
optimistic:

1. **The `rig-ik-2bone` sample-spec stays away from the singularities.** The target `translate` ramp is constrained so
   the target distance `d` satisfies `0.30 * (l1 + l2) <= d <= 0.92 * (l1 + l2)` and never approaches the fully folded
   distance `|l1 - l2|`. By the law of cosines `cos(theta) = (l1^2 + l2^2 - d^2) / (2 l1 l2)`, this keeps `|cos|`
   bounded away from 1 by at least `delta ~= 0.08`. The amplification is then `1/sqrt(1 - x^2) ~= 1/sqrt(2 * delta) ~=
   2.5`, so a last-ULP argument disagreement of ~1e-15 maps to an angle error of ~4e-15 and a basis (`cos`/`sin`)
   error of the same order, four orders of magnitude under the 1e-6 basis atol.
2. **A mandated, consistent argument clamp.** Every runtime clamps the `acos` argument to `[-1, 1]` before the call
   (`x = max(-1, min(1, x))`). This removes NaN at exact singularities and removes the case where one runtime's last
   ULP lands at 1.0000000000000002 and another's at 1.0, which would otherwise produce a `pi`-vs-NaN or basis sign
   divergence. The clamp is part of the solve contract, not a per-runtime detail.

The raw-affine storage decision (A.3) prevents decomposition from RE-INTRODUCING transcendental noise on read, but the
solve has already baked `acos`/`sin`/`cos` noise into the matrix; the conditioning bound above is what guarantees that
baked-in noise stays under the basis tolerance.

Discrete quantities are compared with EXACT equality, no epsilon, because they are not floating point:

- Draw order: exact ordered sequence equality of slot names.
- Active `attachment` name (and `null`): exact equality.
- `blendMode`: exact equality.
- Event `name`, `intValue`, `stringValue`, the `seq` ordering, and the ordered event log: exact equality.

The tolerance table lives in exactly one place, `compare/tolerance.ts`, and is consumed by the web harness and by the
comparison CLI that Unity/Godot dumps run through (B.5). There is no per-runtime tolerance. Loosening any value to make
a failing runtime pass is forbidden; the fix is to fix the runtime (B.6).

### A.6 Fixtures are generated from runtime-core and committed (WP-V.2, enforces INV-2 + L4)

- `generate.ts` is the only producer of skeletal fixtures. It imports `runtime-core` + `format`, loads each rig +
  sample-spec, runs the canonical solve, and writes `fixtures/<rigId>.fixture.json` plus `fixtures/.fixtures.lock`
  (sha256 manifest of all rigs, specs, and fixtures, PLUS the pinned generation-toolchain id, A.7).
- Fixtures are committed to git. They are the behavioral contract; runtime-core is the reference that produced them.
- The "fixtures up to date" gate is a standalone required job, `fixtures-lock` (D.3, D.7). It regenerates from
  runtime-core on the pinned toolchain (A.7) and runs `git diff --exit-code` on rigs/specs/fixtures. The regenerate +
  diff runs OUTSIDE the Turbo cache (a forced, non-cached step) so a cache hit can never skip the verification. A
  nonzero diff fails the job. Effect: any PR that changes solve behavior in runtime-core WITHOUT regenerating fixtures
  fails CI. Regeneration is thereby forced to be a deliberate, reviewed act (handoff section 11).
- The blend-mode coverage trade-off (A.2): forcing `additive`/`multiply`/`screen` onto rigs that isolate a different
  subsystem would couple unrelated solves and blunt failure localization, so coverage of those modes lives on a
  dedicated static `rig-blendmodes`. The same reasoning kept curve coverage on rigs that naturally need each curve
  type rather than bolting curves onto isolating rigs.
- Regeneration review gate (the "deliberate act"), all required when the fixtures diff is nonzero:
  - [ ] The PR carries the `behavior-change` label (a status check `fixtures-changed-needs-review` enforces label-or-fail when the lock manifest changed).
  - [ ] CODEOWNERS for `packages/conformance/src/fixtures/**` (the runtime owners) approve. Branch protection requires CODEOWNERS review on that path.
  - [ ] An ADR (`docs/adr/NNNN-*.md`) or CHANGELOG entry explains what behavior changed and why. Checked by a CI step that requires a matching changelog fragment when the lock manifest changed.
  - [ ] The commit that regenerates fixtures changes ONLY fixtures + the triggering core change + the ADR/changelog (one logical change per commit, handoff conventions).
  - [ ] The regeneration was produced on the pinned generation toolchain (A.7); the `toolchain` field in the lock matches CI's pinned id.

This is the same discipline applied to the certified math engine port (handoff section 8.11): the reference is
authoritative, divergence from it is loud, and changing the reference is ceremony.

### A.7 Fixture-generation toolchain pin (WP-V.17, INV-2)

The fixtures store V8-computed f64 results (`sin`/`cos`/`acos` and long sums) as shortest round-trippable JSON, and the
`fixtures-lock` gate is an EXACT `git diff` with no tolerance (on purpose, so behavior changes are loud). V8 has
historically changed its `sin`/`cos`/`acos` implementations between releases; a Node/V8 upgrade, or a developer
regenerating on a different Node than CI, can change the last ULP, change the JSON string, and fail the gate on a PR
with zero intended behavior change. Even `rig-2bone`'s basis is `cos`/`sin` of a rotation, so this affects every rig.
The fix is to pin the generation toolchain, not to loosen the gate:

- The exact Node version is pinned in `.node-version` (Phase 0 pins Node 22 LTS to an exact patch, for example
  `22.13.1`). The conformance package records the same id as `node-<version>-v8` in the lock and fixture `toolchain`
  field.
- `generate.ts` and `generate-slot.ts` call `.node-version-check.ts` FIRST: it compares `process.version` to the
  pinned version and refuses to run (typed error, nonzero exit) on a mismatch, telling the developer to
  `nvm use` / `volta` to the pinned version. Fail loud, before any fixture is written.
- CI's `fixtures-lock` job uses `actions/setup-node` with the EXACT pinned version (not a `20.x` range), so CI
  regeneration is bit-stable. The same pin is reused by the `conformance-web` job.
- Regeneration documentation (the drift runbook, B.6) states plainly: regeneration MUST happen on the pinned
  toolchain; a bump of the pinned Node version is itself a `behavior-change` PR that regenerates fixtures under the
  A.6 review gate, because the bump can legitimately shift the last ULP.

Without this pin, the WP-V.2 gate is spuriously flaky and teams learn to ignore or disable it, which defeats it.

### A.8 Schema authority: JSON Schema is canonical, Zod is derived (WP-V.0, suggestion S8)

Unity (.NET) and Godot (GDScript) cannot run Zod. So the CANONICAL cross-runtime validation artifacts are the JSON
Schema files in `schema/` (draft 2020-12): `rig.schema.json`, `sample-spec.schema.json`, `fixture.schema.json`, and
`timeline.schema.json`. The TypeScript-side Zod schemas are DERIVED from these (generated from the JSON Schema and kept
in sync by a CI check that fails if the generated Zod drifts from the committed JSON Schema). This makes the contract
one artifact, validated identically in three languages:

- TS harness: validates via the derived Zod schema (and, in a belt-and-suspenders CI step, via a JSON Schema validator
  against the canonical file).
- Unity job: validates dumps against `fixture.schema.json` using the `JsonSchema.Net` validator (the `json-everything`
  family) added as a project dependency of the conformance Unity project (D.9).
- Godot job: the dump is validated by the `mc-conformance` CLI against the canonical JSON Schema before compare (the
  CLI is the shared validator), so Godot needs no native JSON Schema dependency.

The dependency allowlist for the pure packages (INV-1, enforced in A.1 / D.5): `packages/runtime-core` may depend only
on `@marionette/format` (the small affine library is internal source, not an external dependency); `packages/format`
may depend only on `zod`. A CI step parses each `package.json` and fails if `dependencies` is not a subset of its
allowlist, which catches a PixiJS/Electron/Node-shim dependency that lint alone could miss.

---

## B. The conformance harness

### B.1 Topology

```
        rigs/ + sample-spec/ (skeletal)      slot/scenes + slot/spins (slot)
                          |                              |
        +-----------------+----------+        +----------+-----------------+
        |                 |          |        |          |                 |
   generate.ts       runtime-web   Unity  Godot     generate-slot.ts   runtime-web
   (runtime-core)    harness-web   dump   dump      (runtime-core)      slot harness
        |                 |          |        |          |                 |
   fixtures/  <---- asserts ==   dump.json dump.json  slot/expected/ <- asserts ==
   (committed)            |          |        |       (committed)          |
        |                 |   +------+--------+--------------+             |
        +-------- compare-skeletal.ts (tolerance, A.5) ------+             |
                                  |                                        |
                          compare-slot.ts (EXACT integer-deep-equal) <-----+
                                  |
                          structured drift report -> CI pass/fail + artifact
```

One rig set, one sample-spec set, one skeletal fixture set, one slot corpus, two comparison functions sharing one
report format and (for the skeletal path) one tolerance policy. The only per-runtime code is the thin "load
rig/scene/spin, sample at spec times, dump JSON in the canonical schema" adapter.

### B.2 runtime-web harness (WP-V.4, required from Phase 1, web-only)

- A Vitest entry `test/conformance.test.ts` loads every LANDED rig + fixture + sample-spec (see "landed-rig gating"
  below) and, from Phase 2, runs the A.2 coverage meta-test.
- **What surface the harness reads (headless feasibility, addresses the WebGL question).** Solving lives in
  runtime-core (INV-1). `runtime-web` is split into a playback/state layer (`runtime-web/src/playback`: clock, animation
  state, draw-order resolution, atlas/region binding, calls into runtime-core, holds the post-solve `SkeletonState`)
  and a render layer (`runtime-web/src/render`: PixiJS v8). The harness drives the PLAYBACK layer only: it builds the
  skeleton state machine, advances/samples at spec times, and reads back the post-solve `SkeletonState` snapshot (bone
  world affines, world-space vertices, resolved draw order, per-slot attachment/color, the event log). That snapshot is
  the exact data the renderer would consume, computed entirely on the CPU. The harness NEVER constructs a PixiJS
  `Application`, a WebGL context, or a canvas, so it runs in plain headless Node with no GPU. This is what the Phase-1
  required check actually tests beyond core: the web integration layer (sampling, state reset, draw-order resolution)
  did not perturb the solve output.
- For each sample, it compares the web `SkeletonState` snapshot to the committed fixture via `compare-skeletal.ts` +
  `tolerance.ts`.
- Because fixtures are generated from runtime-core and the web playback layer delegates solving to runtime-core, a
  green result confirms two things at once: (a) runtime-core still matches its committed fixtures (drift tripwire), and
  (b) the web integration layer did not perturb the solve output.
- Pixel rendering is explicitly NOT compared here. Conformance compares solve output (transforms, vertices, draw
  order, events, color), which is the cross-runtime contract. Pixel-level checks are visual regression (WP-V.8), a
  separate, web-only, advisory job that DOES need WebGL and therefore runs under Playwright (a real browser) or a
  headless-GL context, not in the plain-Node conformance job.

**Landed-rig gating (reconciles WP-V.4 "required from Phase 1" with the WP-V.1 full-catalog meta-test, addresses the
Phase-1-vs-coverage contradiction).** Phase 1 (bone puppet) implements only the bone solve; weighted-mesh, IK, deform,
transform-constraint, animated draw-order, and event-timeline solves do not exist until Phase 2 (and the Phase 1 plan
of record, `phase-1-bone-puppet.md`, locks only `rig-2bone` in Phase 1). So:

- `registry.ts` carries a `RIG_PHASE` map; the harness runs exactly the rigs whose `RIG_PHASE <= currentPhase`
  (the current phase comes from a committed `CONFORMANCE_PHASE` constant bumped per phase milestone, not from the
  environment, so it cannot be tampered to skip rigs on a feature branch).
- In Phase 1, the landed set is `{ rig-2bone }`. The `conformance-web` required check gates that one rig and the
  full-catalog coverage meta-test is SKIPPED (it asserts IK/weighted/deform/transform-constraint/all-modes, none of
  which exist yet, so it cannot pass and must not run).
- In Phase 2 the remaining ten rigs land, the coverage meta-test ACTIVATES, and the gate covers the full catalog. This
  is stated in Section E so the two work packages do not contradict each other.

Acceptance: `pnpm --filter @marionette/conformance test` passes locally and in CI for all LANDED rigs; deliberately
perturbing one fixture value by 1e-2 makes the harness fail with a localized diff.

### B.3 Unity harness (WP-V.13, Phase 5)

- A Unity Editor batchmode script (`runtimes/unity/Conformance/ConformanceDump.cs`) runs under GameCI. It CHECKS OUT
  the repo and READS the committed files directly from `packages/conformance/src/{rigs,sample-spec,slot/scenes,
  slot/spins}` (no copy, no path-mount, no second source of truth). It reimplements the canonical solve and the slot
  sequencer (the Unity runtime under test), samples at the spec times and event steps, and writes
  `unity-dump-<rigId>.json` (skeletal) and `unity-slot-<pairId>.timeline.json` (slot) in the canonical schemas (A.3,
  A.8).
- Invocation: `Unity -batchmode -nographics -projectPath runtimes/unity -executeMethod Conformance.Dump.Run -quit`.
- Skeletal dumps are validated against `fixture.schema.json` (via `JsonSchema.Net`, A.8), then `mc-conformance compare`
  loads the committed fixtures and asserts parity with the single tolerance policy (A.5).
- **Slot dumps (L1 cross-runtime for the slot layer).** The handoff (phase-4 plan, "Unity and Godot slot runtimes
  reimplement the sequencer against the same golden fixtures") makes the native runtimes reproduce the slot layer in
  Phase 5. So the Unity job ALSO runs `(SpinResult, SlotScene) -> PresentationTimeline` for each committed pair and
  `mc-conformance compare` asserts EXACT equality against `slot/expected/<pairId>.timeline.json`. The slot timeline is
  integer-exact (`atMs` integers, `seq` integers, no IEEE division in the golden per the Phase 4 plan), so this compare
  uses `compare-slot.ts` with NO epsilon. This is what catches a Unity win-sequencer drifting from web (L1 governs the
  slot layer most directly, and was previously unverified cross-runtime).
- Unity must NOT read fixtures or goldens to produce output; it computes independently, then compare asserts. Reading
  them would defeat the purpose.

### B.4 Godot harness (WP-V.14, Phase 5)

- A headless Godot script (`runtimes/godot/conformance/dump.gd`) run via
  `godot --headless --path runtimes/godot --script res://conformance/dump.gd -- --out godot-dump`. Same contract as
  Unity: check out the repo, read the committed rigs/specs/scenes/spins directly, reimplement the solve and the
  sequencer, dump canonical JSON (skeletal and slot).
- `mc-conformance compare godot-dump-*.json` asserts skeletal parity against the committed fixtures (tolerance, A.5)
  and EXACT slot-timeline parity against the committed slot goldens (no epsilon, B.5).

### B.5 The comparison engine (WP-V.0/.3)

`compare/` exposes two runtime-agnostic functions sharing one report format:

```ts
// pseudocode of the contract; full impl in packages/conformance
export function compareSkeletal(expected: Fixture, actual: Fixture): DriftReport {
  // 1. structural: same rigId, same sample times (by index), same set of bones/slots/verts
  // 2. per sample: numeric compare bones (basis vs translation classes), vertices, color
  //    using atol/rtol from tolerance.ts; discrete-equal drawOrder/attachment/blendMode
  // 3. event log: exact name/int/string/seq/order; epsilon on time + floatValue
  // returns { ok, failures: DriftFailure[] } where each failure carries:
  //   { rigId, time, quantity, index, expected, actual, absDelta, relDelta, atol, rtol }
}

export function compareSlot(expected: PresentationTimeline, actual: PresentationTimeline): DriftReport {
  // EXACT structural + value deep-equal. The timeline is pure integer/discrete data
  // (atMs integers, seq integers, enum directive kinds). NO epsilon, NO tolerance.
  // Any difference is a real sequencer bug.
}
```

The CLI `mc-conformance compare <dump>` dispatches to `compareSkeletal` or `compareSlot` by dump kind; it is what
Unity/Godot jobs call. `test/conformance.test.ts` calls the functions directly. Same code path, same tolerance (for
skeletal) / same exactness (for slot), both gate CI.

### B.6 What "a runtime drifted" looks like in CI (WP-V.15)

Six distinct failure shapes, each with a fixed remediation. (The table grew past the original two as the suite gained a
toolchain pin and a native slot path; the count here matches the rows below.) The drift triage runbook
(`docs/runbooks/conformance-drift.md`) codifies this:

| Symptom in CI | Meaning | Remediation |
|---|---|---|
| `fixtures-lock` red, regenerated on the pinned toolchain, PR has no runtime-core change | generation toolchain drift (wrong Node/V8) or generator nondeterminism | Regenerate on the pinned `.node-version` (A.7). If the diff persists with no core change, file a `generate.ts` determinism bug (A.3). Never hand-edit fixtures; never loosen the diff to a tolerance. |
| `conformance-web` red AND `fixtures-lock` red | runtime-core solve changed; fixtures not regenerated | If intended, regenerate via the A.6 review gate (deliberate act). If unintended, revert the core change. Never edit fixtures by hand. |
| `conformance-web` red AND `fixtures-lock` green | web integration (playback) layer perturbed the solve | Fix `runtime-web/playback`; do not touch fixtures. |
| `conformance-unity` or `conformance-godot` SKELETAL red while `conformance-web` green | that native runtime drifted from the skeletal contract | Fix that runtime. Do not touch fixtures, do not loosen tolerance. |
| `conformance-unity` or `conformance-godot` SLOT red while the TS slot-determinism check (WP-V.5) is green | that native runtime's sequencer drifted from the slot contract | Fix that runtime's sequencer. The slot timeline is integer-exact; any diff is a real bug, not float noise. |
| All runtimes red on the same rig/quantity right after a fixture regen | the regen itself is wrong or nondeterministic | Inspect `generate.ts` determinism and the toolchain pin (A.3, A.7); block the regen. |

The compare engine prints the first 20 failures inline as a table (rigId/pairId, time, quantity, index, expected,
actual, absDelta, relDelta, atol, rtol) and uploads the full `drift-report.json` as a CI artifact for triage. A
non-empty failure list is a nonzero exit and a red required check.

---

## C. Testing pyramid mapped to this repo

Many fast unit tests, fewer integration, fewest conformance + visual/perf. Mocks reserved for the math engine only
(handoff: presentation is tested with stubbed `SpinResult`s from `math-bridge`).

### C.1 Unit (Vitest, no I/O, milliseconds) (WP-V.6)

| Suite | Location | Asserts | Law/invariant |
|---|---|---|---|
| Affine math | `runtime-core/.../affine.test.ts` | multiply, invert, compose/decompose round-trip, identity, associativity within epsilon, point transform | INV-3 |
| Format validation | `format/.../validate.test.ts` | valid doc accepted; each malformed shape (cycle in bones, parent-after-child, bad weighted encoding length, unknown attachment type, bad enum) rejected with a typed error, never a bare throw | L3 |
| Command do/undo round-trip (registry-driven) | `editor/.../commands.roundtrip.test.ts` | ONE parametric test enumerates the command registry (C below) and, for EVERY registered command, runs `do` then `undo` and asserts deep-equal to prior state, then `redo` re-applies; coalescing merges a drag into one step. A missing or fake round-trip cannot pass because the generic test itself performs the round-trip on each command. | L2 (mandatory, every command) |
| Solve-order sub-ordering | `runtime-core/.../solve-order.test.ts` | for `rig-ik-into-transform`, IK-then-transform differs from transform-then-IK by > 1e-2; for `rig-weighted-deform`, deform-after-LBS differs from deform-before-LBS by > 1e-2; for `rig-transform-modes`, each non-`normal` mode differs from `normal` by > 1e-2 under the rotated, non-uniformly-scaled parent | INV-3 |
| Timeline sampling | `runtime-core/.../timeline.test.ts` | linear, stepped, and bezier interpolation at on-key, between-key, t=duration, t>duration; stepped holds previous; bezier control points honored | INV-3 |
| IK solve | `runtime-core/.../ik.test.ts` | one-bone and two-bone law-of-cosines reaches target when reachable, clamps when not, both `bendPositive` directions, mix=0 is identity, mix=1 full, acos argument clamped to [-1, 1] | INV-3 |
| LBS skinning | `runtime-core/.../skin.test.ts` | weighted vertex equals hand-computed weighted sum of bone world matrices; weights sum to 1 enforced; max-influences cap honored; deform offsets added AFTER skin | INV-3 |

**L2 enforcement is registry-driven, not file-presence (addresses the gameable-presence-check concern).** Every
`Command` self-registers in a `commandRegistry` at module load (its constructor + a fixture-document factory).
`commands.roundtrip.test.ts` enumerates the registry with `test.each` and executes the do/undo/redo round-trip for each
entry. Because the single most-emphasized law cannot be satisfied by an empty sibling test file, file presence is NOT
the gate; executing the round-trip on every registered command is. A command that does not appear in the registry
fails a separate completeness assertion that cross-checks the registry against the command-catalog manifest
(`command-history.md` section 11), so a missing registration is also caught.

### C.2 Integration (Vitest, real filesystem + real exporter, mock math only) (WP-V.7)

| Suite | Phase | Asserts |
|---|---|---|
| Editor save/load round-trip | 1 onward | serialize `DocumentModel` -> format JSON -> validate -> rebuild -> deep-equal original; `History` reset after load; a non-trivial doc round-trips losslessly |
| Exporter -> runtime-web playback | 1 onward | export a rig from the editor exporter, load it headlessly in the `runtime-web` playback layer (no WebGL, B.2), sample at fixed times, assert the post-solve `SkeletonState` is finite and matches a small committed expectation (the editor-to-runtime contract, distinct from cross-runtime conformance) |
| Atlas pack round-trip | 1 onward | pack regions -> emit `AtlasRef` -> region UVs resolve back to the source rectangles within 1px |
| Math-bridge stub determinism | 4 (math-bridge is Phase 4) | the canned `SpinResult` source is pure: same `spinId` yields byte-identical results across two calls |

### C.3 Conformance (cross-runtime) (Section A + B)

The cross-runtime suite above. Web skeletal from Phase 1 (landed rigs), full catalog from Phase 2; slot determinism
from Phase 4; Unity + Godot (skeletal + slot) from Phase 5 (Section D.9, E).

### C.4 Visual and performance (WP-V.8)

| Suite | Gate |
|---|---|
| Frame-time budget (runtime-core solve) | headless: solve a representative rig for 600 frames; assert mean per-frame solve time below the committed baseline plus the regression threshold (D.8); concrete CI ceiling: mean per-frame solve <= 4ms on CI hardware (generous vs the 16.6ms frame budget). The strict 16.6ms/60fps budget is validated on a real device in Phase 5 |
| Per-frame allocation gate (INV-5) | run N=10,000 hot-loop frames after a warmup; via `perf_hooks` `PerformanceObserver({ entryTypes: ['gc'] })` assert ZERO minor (scavenge) GC events during the measured window (tolerance band: at most 1, to absorb a stray runner event), proving the solve/render loop allocates nothing per frame (particles, sprites, mesh buffers pooled). A `v8.getHeapStatistics()` used-heap delta is recorded as a secondary signal only. (GC-event counting is used instead of a raw `heapUsed` delta, which is noisy and tends to get disabled.) |
| Particle pool gate | emit and recycle K particles; assert pool high-water mark bounded and zero minor-GC events after warmup |
| Visual regression (web-only, advisory) | render reference rigs to PNG under Playwright/headless-GL, compare to committed golden images with an SSIM/pixel-diff threshold; non-blocking by default, flips to blocking once stable (Phase 3+) |

---

## D. CI/CD pipeline (GitHub Actions)

### D.1 Workflow files

| File | Trigger | Purpose |
|---|---|---|
| `.github/workflows/ci.yml` | `pull_request`, `push` to `main` | typecheck, lint, unit + coverage, fixtures-lock, conformance-web, perf gates, format semver, package guard |
| `.github/workflows/conformance-native.yml` | `push` to `main`, `pull_request` from the SAME repo touching `runtimes/**` or `packages/conformance/**`, plus nightly `schedule` | Unity + Godot conformance (Phase 5); internal-only (D.9) |
| `.github/workflows/release.yml` | tag `v*` | Electron build/package matrix + artifact upload |

### D.2 Turbo-aware caching (WP-V.9)

- pnpm with `--frozen-lockfile`; `actions/setup-node` pinned to the EXACT `.node-version` (A.7), with `cache: pnpm`
  keyed on `pnpm-lock.yaml`.
- Turborepo cache via `actions/cache` keyed on `${{ hashFiles('pnpm-lock.yaml') }}-${{ github.sha }}` with restore
  keys for partial hits; or Turbo Remote Cache if a token is configured (`TURBO_TOKEN`, `TURBO_TEAM` as repo secrets).
- All package scripts run through `turbo run <task> --filter=...[origin/main]` so only packages affected by the diff
  rebuild/retest. The conformance and format packages declare `runtime-core` as an input so a core change always
  invalidates them (prevents stale-cache hiding drift).
- `turbo.json` pins task inputs/outputs precisely. EXCEPTION: the `fixtures-lock` regenerate + `git diff` step runs
  non-cached (a forced `pnpm` invocation outside Turbo) so a cache hit can never skip the byte-exact verification
  (A.6).

### D.3 Job graph (ci.yml)

```text
install (cache warm)
   |
   +--> typecheck --------+
   +--> lint -------------+
   +--> unit+coverage ----+--> conformance-web --> perf-gates --> ci-pass (required)
   +--> fixtures-lock ----+        (needs fixtures-lock)
   +--> format-semver ----+
   +--> package-guard ----+
```

`fixtures-lock` is a STANDALONE job (not a step inside `conformance-web`); `conformance-web` declares
`needs: [typecheck, unit+coverage, fixtures-lock]` and does not re-run the diff. `ci-pass` is a final aggregation job
that depends on all required jobs for the current phase (D.13) and is the single required status check in branch
protection (keeps the required-check list stable as jobs are added).

### D.4 typecheck (WP-V.9, INV-4)

- `turbo run typecheck` -> `tsc --noEmit` per package under TS strict.
- Hard fail on any error. `packages/format` and `packages/runtime-core` additionally run with a stricter config that
  bans `any` and unjustified `as` (D.5 lint enforces; tsc enforces strictness).

### D.5 lint, including boundary + commands-only + platform-agnostic core (WP-V.10)

ESLint flat config with these enforced rules. All are errors (build-failing), not warnings:

| Rule | Mechanism | Enforces |
|---|---|---|
| Layer direction UI -> application -> domain -> infrastructure | `eslint-plugin-boundaries` element types + allowed-edges; domain may not import framework/transport/persistence | global standards |
| No deep cross-feature imports | `eslint-plugin-boundaries` + `no-restricted-imports`: cross-feature imports only via the feature `index.ts` barrel | global standards |
| Platform-agnostic, dependency-light core/format | In `packages/runtime-core/**`, `packages/format/**`, and `packages/conformance/src/generate*.ts`: `no-restricted-imports` bans `pixi.js`, `@pixi/*`, `electron`, Node built-ins (`fs`, `path`, `os`, `crypto`, `child_process`, `worker_threads`, `http`, `https`, `net`, `stream`, `node:*`); `no-restricted-globals` bans `window`, `document`, `navigator`, `localStorage`, `sessionStorage`, `location`, `requestAnimationFrame`, `performance`, `fetch`, `XMLHttpRequest`; `no-restricted-syntax` bans `Date.now`, `new Date`, `Math.random` (determinism). PLUS the A.8 `package.json` dependency allowlist. | INV-1 (full, not PixiJS-only) |
| Commands-only mutation | DocumentModel mutators take a `CommandContext` brand token constructable only by `History`; PLUS `no-restricted-imports` forbidding the mutation surface outside `renderer/document/commands/**`; PLUS the registry-driven do/undo round-trip test that executes on every registered command (C.1) | L2 |
| No `any`, no unjustified `as` | `@typescript-eslint/no-explicit-any`, `no-unnecessary-type-assertion`, error in `format` + `runtime-core` | INV-4 |
| No em-dashes or en-dashes | custom `no-restricted-syntax`/regex rule scanning string + comment tokens for U+2014 AND U+2013 across docs, code, UI copy | INV-6 |
| Conventional Commits | `commitlint` on PR title + commits via a lint step | conventions |

Belt-and-suspenders for INV-1 (a CI grep guard, in case lint config drifts): the step fails if any banned import or
global appears in the pure packages.

```bash
! grep -rEn "from ['\"](pixi\\.js|@pixi/|electron|node:|fs|path|os|crypto|child_process|worker_threads)['\"]|\\b(window|document|navigator|localStorage|requestAnimationFrame|XMLHttpRequest)\\b|\\b(Date\\.now|Math\\.random)\\b" \
    packages/runtime-core/src packages/format/src
```

### D.6 unit + coverage gates (WP-V.6, WP-V.9)

- `turbo run test -- --coverage` (Vitest, V8 coverage).
- Coverage thresholds enforced in each package's Vitest config; CI fails below threshold. Gates (lines, branches,
  functions, statements):

| Path | Threshold |
|---|---|
| `packages/format/**` | 80% |
| `packages/runtime-core/**` | 80% |
| `apps/editor/**/domain/**` | 80% |
| `apps/editor/**/*service.ts` (and `*service/**`) | 80% |

Coverage is a smell-detector, not a vanity metric (global standards): one meaningful do/undo round-trip beats five
trivial getter tests. The thresholds are floors, not targets.

### D.7 conformance-web job (WP-V.4)

- Depends on typecheck + unit + `fixtures-lock` (fast-fail cheap checks first; `fixtures-lock` is its own job, D.3).
- Runs `pnpm --filter @marionette/conformance test` (B.2) on the pinned Node version (A.7).
- Gates the LANDED rig set for the current phase (B.2 landed-rig gating); the coverage meta-test runs from Phase 2.
- Required check from Phase 1 onward.

### D.8 perf-gates job (WP-V.8, INV-5)

- Runs the frame-time benchmark and the allocation gate (C.4).
- Baselines committed at `packages/conformance/perf/baseline.json`. The job compares current numbers to baseline:
  fail if mean frame solve regresses more than the relative threshold (default 15% on CI to absorb runner noise) OR
  exceeds the absolute ceiling (mean per-frame solve > 4ms, C.4). The allocation gate fails on any minor-GC event in
  the measured hot-loop window beyond the tolerance band.
- Updating `baseline.json` is a reviewed act (CODEOWNERS on `perf/**`) so a regression cannot be silently baked in.
- CI hardware is noisy; the strict 16.6ms/60fps budget and mobile profiling are validated on real devices in Phase 5
  (handoff risk register). The CI gate catches relative regressions early.

### D.9 conformance-native job (WP-V.13, WP-V.14; ACTIVATED by PP-E3)

- Lives in `conformance-native.yml`, ACTIVE since PP-E3 (both native runtimes are landed). The engine
  jobs remain guarded by directory probes so a genuinely absent runtime skips-as-success, and the
  workflow is path-filtered (`runtimes/**`, `packages/{conformance,format,runtime-core}/**`, the
  workflow file) plus a nightly schedule.
- **Unity job (as built, superseding the GameCI sketch below):** `actions/setup-dotnet` (8.x) then
  `dotnet test runtimes/unity --nologo`. No Unity editor, no GameCI, NO license secret, and therefore
  no fork-PR secret restriction: the solve is one engine-agnostic C# library (netstandard2.1, zero
  UnityEngine, ADR-0001) and a plain net8.0 xUnit project exercises the full cross-language contract
  (fixtures within the A.5 tolerance, integer vectors bit-exact). The Unity-editor batchmode smoke
  test (the MonoBehaviour view layer renders a frame) is a later, separate, non-blocking job and is
  the only place GameCI or a license would ever be needed.
- **Godot job (as built):** the pinned official Godot 4.6.3-stable Linux build, SHA256-verified
  (cross-checked against the official SHA512-SUMS), cached by version, running the harness headless
  via `runtimes/godot/tests/run.sh`, whose missing-PASS-sentinel convention fails the job even though
  Godot exits 0 on script parse errors.
- **Required checks (WP-V.16 / TASK-5.5.6):** branch protection marks BOTH `ci-pass` and
  `conformance-native-pass` required. They stay separate workflows: the native jobs are heavier and
  only solve/format/conformance/runtimes changes can move them. Because of the path filter, a PR
  outside those paths does not report `conformance-native-pass`; the repo config resolves that with
  the documented skipped-but-required companion pattern or a ruleset treating a not-triggered
  workflow as satisfied.

### D.10 Electron build/package job (WP-V.11)

- `release.yml`, matrix `os: [macos-latest, windows-latest, ubuntu-latest]`.
- `electron-builder` packages the editor; artifacts uploaded per-OS. Code-signing secrets scoped to the release
  workflow only (never exposed to PR workflows from forks). On tag `v*` only; a nightly unsigned build optionally runs
  to catch packaging breakage early.
- The packaged app smoke-test: launch headless/`--smoke` mode, load a reference rig, assert the window initializes and
  the runtime renders one frame without throwing.

### D.11 Format semver gate (WP-V.12, L3)

- A CI step diffs `packages/format/src/**` type definitions and the canonical JSON Schemas against `main`. If the
  public format surface changed (types, enums, schema), it requires a `formatVersion` bump in the same PR and a
  `format-break` label + ADR. Fails otherwise. This makes "the data format is the contract" enforceable rather than
  aspirational.

### D.12 Concurrency control (WP-V.16)

```yaml
concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

PR runs cancel superseded runs; `main` runs never cancel (so cache + release integrity hold).

### D.13 Branch protection / required checks, per phase (WP-V.16, L5)

The required check is always the single `ci-pass` aggregation job. What `ci-pass` DEPENDS ON grows per phase so it
never depends on a job that does not yet exist (L5, build in order). The growing set:

| Phase | `ci-pass` depends on |
|---|---|
| 0 | typecheck, lint, unit+coverage, format-semver, package-guard |
| 1 | + fixtures-lock, conformance-web (landed rig set = `{ rig-2bone }`) |
| 2 | + perf-gates (frame-time + allocation); conformance-web now covers the full catalog + meta-test |
| 3 | (particle pool gate folded into perf-gates; visual-regression remains advisory) |
| 4 | conformance-web now also runs the WP-V.5 slot-determinism check |
| 5 | + conformance-unity, conformance-godot (skeletal + slot) |

- `package-guard` (the Phase-0 mechanism, `phase-0-foundations.md` section 8) fails CI if a package from a future
  phase appears before its phase, which is the CI half of L5.
- CODEOWNERS gates: `packages/format/**` (format owners), `packages/conformance/src/fixtures/**`,
  `packages/conformance/src/slot/expected/**`, and `perf/**` (runtime owners). No self-merge on those paths.
- Never merge red CI (global standards). Squash with Conventional Commit title (commitlint-checked).

---

## E. Phasing summary (when each piece lands)

| Phase | Conformance / CI deliverable | Required to pass before next phase |
|---|---|---|
| 0 | ci.yml: install, typecheck, lint (incl. full platform-agnostic core guard + commands-only + boundaries), unit+coverage on format + runtime-core; registry-driven do/undo round-trip over `CreateBone`/`MoveBone`; format semver gate; package-guard (L5) | Phase 0 milestone green in CI |
| 1 | `packages/conformance` (WP-V.0..V.4, WP-V.17): rig catalog skeleton, sample-spec, canonical JSON Schemas + derived Zod, generator with pinned toolchain, committed `rig-2bone` fixture, standalone fixtures-lock gate, runtime-web playback harness, two compare engines, tolerance policy. Web conformance gates `{ rig-2bone }` and is a required check. Coverage meta-test present but SKIPPED until Phase 2 | conformance-web + fixtures-lock green |
| 2 | Land the remaining ten rigs (weighted-mesh, IK, deform, transform-constraint, ik-into-transform, weighted-deform, transform-modes, blendmodes, events-draworder, events-loop) as those solves land; activate the A.2 coverage meta-test and the solve-order sub-ordering reference tests; perf + allocation gates (WP-V.8) | full catalog green, meta-test green, perf gates green |
| 3 | Particle pool gate; visual-regression job (advisory) | pool gate green |
| 4 | WP-V.5 slot determinism as a required check (L1): committed slot corpus (scenes/spins/goldens) generated from runtime-core by WP-4.13; same `SpinResult` -> identical `PresentationTimeline`, twice, plus golden deep-equal | slot-determinism check green |
| 5 | WP-V.13 Unity + WP-V.14 Godot harnesses (skeletal + slot); conformance-native required checks added; Electron release matrix; real-device perf validation | all three runtimes conformance-green on skeletal AND slot |

---

## F. Work packages and acceptance criteria

Every WP is independently verifiable. Checkbox = a test, a gate, or a reviewable artifact.

### WP-V.0 Conformance package skeleton, canonical schemas, compare APIs (Phase 1)
- [ ] `packages/conformance` exists with the A.1 layout and a single `index.ts` barrel (no deep imports).
- [ ] Canonical JSON Schemas (`fixture`, `sample-spec`, `rig`, `timeline`) validate the A.3/A.4 shapes; invalid files rejected with typed errors. The derived Zod schemas are generated from them and a CI check fails on drift (A.8).
- [ ] `compareSkeletal` returns a structured `DriftReport`; a unit test feeds a hand-built mismatch and asserts the failure carries rigId/time/quantity/index/deltas/tolerance.
- [ ] `compareSlot` returns a `DriftReport` for an exact deep-equal mismatch on a hand-built timeline pair.
- Touches: INV-3.

### WP-V.1 Reference rig catalog (Phase 1 for `rig-2bone`, full catalog Phase 2)
- [ ] All eleven rigs authored as valid `SkeletonDocument`s; each passes the format validator (L3); `RIG_PHASE` set per A.2.
- [ ] The A.2 coverage meta-test passes in Phase 2 (every solve step, observable transformMode, observable step-3 and step-5 sub-orders, every curve, every blend mode, both bendPositive, weighted + unweighted, past-duration + cross-wrap).
- [ ] Solve-order sub-ordering reference tests (C.1) prove `rig-ik-into-transform`, `rig-weighted-deform`, and `rig-transform-modes` are order/mode-sensitive by > 1e-2.
- [ ] No rig contains Spine-derived data; provenance noted in `rigs/registry.ts` (L4).

### WP-V.2 Fixture generator + committed fixtures + fixtures-lock gate (Phase 1)
- [ ] `generate.ts` imports only runtime-core + format (lint-enforced); produces deterministic, stably-sorted JSON.
- [ ] Fixtures + `.fixtures.lock` (incl. toolchain id) committed; regenerating twice on the pinned toolchain yields zero diff (determinism).
- [ ] Standalone `fixtures-lock` CI job (non-cached) fails on a deliberately-introduced core solve change with no regen.
- [ ] Regeneration review gate wired: `behavior-change` label + CODEOWNERS on `fixtures/**` + ADR required when the lock manifest changes.
- Touches: INV-2, L4, L3.

### WP-V.3 Epsilon / tolerance policy (Phase 1)
- [ ] `tolerance.ts` encodes the A.5 table as the single source; consumed by the web harness and the compare CLI.
- [ ] Tests: a 1e-7 perturbation passes; a 1e-2 perturbation fails; discrete quantities fail on any difference.
- [ ] The IK conditioning bound (A.5) is encoded as a test: with the `rig-ik-2bone` spec margin and the mandated acos clamp, the worst-case basis error stays under 1e-6.
- [ ] A documented rationale comment links the tight-but-nonzero choice to f64 non-associativity / transcendental ULP spread.

### WP-V.4 runtime-web conformance harness (Phase 1)
- [ ] `conformance.test.ts` runs the web PLAYBACK path (post-solve `SkeletonState`, no WebGL, B.2) and asserts parity to committed fixtures for the landed rig set.
- [ ] Landed-rig gating: Phase 1 gates `{ rig-2bone }`; the coverage meta-test is skipped until Phase 2.
- [ ] Perturbing one fixture value fails with a localized, readable diff table.
- [ ] Job is a required check from Phase 1.
- Touches: INV-1 (harness reads CPU state, constructs no WebGL context), INV-3.

### WP-V.5 Slot-presentation determinism conformance (Phase 4, L1)
- [ ] A harness feeds a fixed canned `SpinResult` (from the `math-bridge` stub) to the slot sequencer twice and asserts the emitted `PresentationTimeline` is identical both runs, and deep-equal to the committed golden.
- [ ] A test asserts the sequencer NEVER reads RNG/time/Date; pure function of `SpinResult` + `SlotScene`.
- [ ] Required check once the slot layer exists.
- [ ] IMPLEMENTED BY phase-4 WP-4.13 (golden-playback; verified to exist in `docs/plan/phase-4-slot-composer.md`). WP-V.5 is the single owner of the slot-determinism check; Phase 4 does not stand up a parallel suite. The committed slot corpus extends the A.1 layout:
  - `packages/conformance/src/slot/scenes/<sceneId>.slotscene.json` (authored `SlotSceneDocument` inputs, one per topology plus the acceptance scene)
  - `packages/conformance/src/slot/spins/<spinId>.spin.json` (canned and recorded-real `SpinResult` inputs)
  - `packages/conformance/src/slot/expected/<pairId>.timeline.json` (committed `PresentationTimeline` goldens, generated from `runtime-core`)
  - `packages/conformance/src/slot/.slot.fixtures.lock` (sha256 manifest; the same drift tripwire as A.1 `.fixtures.lock`)
- [ ] `generate-slot.ts` imports `runtime-core` + math-bridge value types ONLY (INV-2), mirroring `generate.ts`; regeneration is a reviewed, committed act gated by `git diff --exit-code` on the slot corpus.
- [ ] The slot golden is compared with `compareSlot` (exact, no epsilon); the same corpus is reused by the native runtimes in Phase 5 (WP-V.13/V.14) for L1 cross-runtime coverage.
- [ ] The win-counter rollup VALUE is pinned, not only the timeline shape. `runtime-core/slot` exposes a deterministic, integer/fixed-point `rollupValueAt(fromUnits, toUnits, startMs, endMs, atMs, curve)` (phase-4 section 5.4.2), and each `counterRollup` golden commits the displayed integer-unit value at the WP-V.0 sample times. A Phase 5 runtime that reproduces the directive list byte-for-byte but evaluates the curve differently still fails this check (closes the cross-runtime rollup-divergence gap). Compared with `compareSlot` (exact, no epsilon).
- [ ] Mutual exclusivity (no double-count): a non-cascade golden emits exactly one `counterRollup` (`0 -> totalWin`); a cascade golden emits a contiguous per-step `counterRollup` chain whose terminal `toUnits` equals `totalWin` (phase-4 section 5.4.3). No golden emits both.
- [ ] Manual-gate note (L5): the LIVE real-engine acceptance (phase-4 TASK-4.14.3) cannot run in CI and is reproduced by the reviewer with the certified engine present. This hermetic WP-V.5 check plus phase-4 `phase4:acceptance` is the CI-gating subset; the live subset is a manual, reviewer-signed component of the Phase 4 to Phase 5 gate.
- Touches: L1.

### WP-V.6 Unit pyramid (Phase 0 onward)
- [ ] Affine, format-validation, timeline, IK, LBS, and solve-order suites exist and meet C.1 assertions.
- [ ] A registry-driven parametric test executes do/undo deep-equal + redo for EVERY registered `Command`; a completeness assertion cross-checks the registry against the command catalog so a missing registration fails (L2).
- [ ] Coverage floors (D.6) enforced.

### WP-V.7 Integration suite (save/load/atlas Phase 1 onward; math-bridge stub Phase 4)
- [ ] Editor save/load round-trip is lossless and deep-equal; History resets on load. (Phase 1)
- [ ] Exporter -> runtime-web playback (no WebGL) produces finite, expected post-solve state. (Phase 1)
- [ ] Atlas pack round-trip resolves UVs within 1px. (Phase 1)
- [ ] Math-bridge stub proven pure/deterministic. (Phase 4; `math-bridge` is a Phase 4 package.)

### WP-V.8 Visual + performance gates (Phase 2/3)
- [ ] Frame-time benchmark with committed baseline; relative regression (15%) + absolute ceiling (mean per-frame solve <= 4ms on CI) gates wired.
- [ ] Allocation gate proves zero minor-GC events in the measured hot loop (INV-5) via `perf_hooks` GC observation.
- [ ] Particle pool high-water-mark gate (Phase 3).
- [ ] Visual-regression job present (advisory until stable; runs under Playwright/headless-GL).
- [ ] `baseline.json` / `perf/**` CODEOWNERS-gated.

### WP-V.9 GitHub Actions CI core (Phase 0)
- [ ] `ci.yml` with install/typecheck/lint/unit+coverage and turbo-aware affected-only execution; Node pinned to `.node-version` (A.7).
- [ ] pnpm + turbo caches keyed correctly; cold and warm runs both green; a warm run (Turbo cache hit on unaffected packages) completes in <= 50% of the cold-run total wall time.
- [ ] `ci-pass` aggregation job is the single required status check; its dependency set follows the per-phase table (D.13).

### WP-V.10 Boundary, commands-only, platform-agnostic-core lint enforcement (Phase 0)
- [ ] `eslint-plugin-boundaries` enforces layer direction + barrel-only cross-feature imports.
- [ ] INV-1 boundary: lint + CI grep guard + `package.json` dependency allowlist all fail on a planted PixiJS import, a planted Node built-in (`import 'fs'`), a planted DOM global (`window`), a planted Electron import, or a planted `Math.random` in runtime-core/format.
- [ ] Commands-only enforced via brand token + import restriction + the registry-driven round-trip test; a planted direct mutation outside a command fails to compile and fails lint; a command lacking a passing round-trip fails the parametric test (L2).
- [ ] No-`any`/no-bad-`as` errors in format + runtime-core (INV-4); no-em-dash/no-en-dash rule fails on a planted U+2014 or U+2013 (INV-6).

### WP-V.11 Electron build/package job (Phase 5; release.yml is CREATED in Phase 5, not Phase 0)
- [ ] `release.yml` matrix (mac/win/linux) packages the editor with electron-builder; artifacts uploaded.
- [ ] Signing secrets scoped to release workflow only, never to fork PRs.
- [ ] `--smoke` launch loads a reference rig and renders one frame without throwing.

### WP-V.12 Format semver gate (Phase 0, L3)
- [ ] CI fails a format-surface change (types or canonical JSON Schema) lacking a `formatVersion` bump + `format-break` label + ADR.
- [ ] Format owners CODEOWNERS-gate `packages/format/**`.

### WP-V.13 Unity conformance harness + job (Phase 5)
- [ ] `ConformanceDump.Run` reads shared rigs/specs/scenes/spins DIRECTLY from `packages/conformance/src` (checkout, no copy), reimplements the solve and the sequencer, dumps canonical JSON validated by `fixture.schema.json` via `JsonSchema.Net`.
- [ ] `mc-conformance compare` asserts skeletal parity (tolerance, A.5) AND exact slot-timeline parity (B.5) to the committed corpus.
- [ ] Job added to required checks; internal-only (skips on fork PRs, D.9); a planted bend-direction bug (skeletal) or a planted win-sequencer drift (slot) makes it red.
- Touches: INV-3, L1.

### WP-V.14 Godot conformance harness + job (Phase 5)
- [ ] `dump.gd` headless run reads the committed corpus directly, dumps canonical JSON; `mc-conformance compare` asserts skeletal parity AND exact slot-timeline parity.
- [ ] Job added to required checks; a planted degrees/radians bug (skeletal) or a slot-timing drift (slot) makes it red.
- Touches: INV-3, L1.

### WP-V.15 Drift report artifact + triage runbook (Phase 1 onward)
- [ ] Compare engines print the first 20 failures as a table and upload `drift-report.json`.
- [ ] `docs/runbooks/conformance-drift.md` documents the B.6 six-failure-shape matrix, the toolchain-pin regeneration rule (A.7), and the "never edit fixtures, never loosen tolerance" rules.

### WP-V.16 Concurrency control + per-phase required-checks policy (Phase 0, evolves to Phase 5, L5)
- [ ] Concurrency groups cancel superseded PR runs; `main` runs never cancel.
- [ ] Branch protection requires `ci-pass`; its dependency set grows per the D.13 per-phase table so it never depends on a not-yet-existing job (L5).
- [ ] `package-guard` fails CI if a future-phase package appears before its phase (the CI half of L5).
- [ ] CODEOWNERS on format/fixtures/slot-goldens/perf paths; no self-merge there.
- [ ] At Phase 5, conformance-unity + conformance-godot added to required checks.

### WP-V.17 Fixture-generation toolchain pin + dependency allowlist (Phase 1, INV-1, INV-2)
- [ ] `.node-version` pins the exact Node/V8 patch used to generate fixtures; the lock + fixture `toolchain` field record the id.
- [ ] `generate.ts` / `generate-slot.ts` refuse to run on a mismatched `process.version` (typed error, nonzero exit) before writing anything.
- [ ] CI `fixtures-lock` and `conformance-web` use the EXACT pinned version via `actions/setup-node`.
- [ ] A `package.json` dependency-allowlist check fails if `runtime-core`/`format` declare a dependency outside their allowlist (A.8).

---

## G. Sign-off checklist (reviewer gate for this plan)

- [ ] Fixtures are generated from runtime-core on a PINNED toolchain and committed, and a non-cached CI gate forces regeneration to be a reviewed act (A.6, A.7, WP-V.2, WP-V.17). INV-2 satisfied; the exact-diff gate is no longer bit-fragile.
- [ ] The tolerance policy is tight-but-nonzero, single-sourced, justified, conditioning-aware for IK near singularities, and forbidden to loosen to pass a runtime (A.5, WP-V.3).
- [ ] The catalog makes step-3 (IK-then-transform) and step-5 (skin-then-deform) sub-orders OBSERVABLE, and makes each non-`normal` `transformMode` observable under a rotated, non-uniformly-scaled parent (A.2, WP-V.1, C.1). INV-3 enforced beyond top-level step order.
- [ ] The runtime-web harness reads the CPU post-solve `SkeletonState` (no WebGL), so the Phase-1 required check is feasible headlessly and tests the web integration layer beyond core (B.2).
- [ ] Phase-1 conformance gates only landed rigs (`{ rig-2bone }`); the full-catalog coverage meta-test activates in Phase 2; WP-V.4 and WP-V.1 are reconciled (B.2, E).
- [ ] L2 is enforced by a registry-driven parametric round-trip over every registered command, not by file presence (C.1, WP-V.6, WP-V.10).
- [ ] INV-1 bans PixiJS, Node built-ins, DOM/browser globals, Electron, and nondeterministic globals in `runtime-core` + `format`, asserted at import, global, and `package.json` dependency level (A.8, D.5, WP-V.10).
- [ ] L1 is verified cross-runtime for the SLOT layer: native Unity/Godot reproduce the committed slot corpus and are compared exactly (B.3, B.4, WP-V.13, WP-V.14).
- [ ] The B.6 drift matrix has six rows and the prose says six; Section 0 maps all five laws (including L5) and all six invariants.
- [ ] One rig set, one sample-spec, one skeletal fixture set, one slot corpus, two compare engines, one tolerance, three runtimes (Section B); native jobs read the committed files directly (no second source of truth).
- [ ] Testing pyramid maps concretely onto the repo with mandatory do/undo round-trips and a non-flaky GC-count allocation gate (Section C, L2, INV-5).
- [ ] CI enforces platform-agnostic core, commands-only, no-`any`, no-em-dash/en-dash, boundaries, coverage floors, format semver, and a per-phase required-check set (Section D, L5).
- [ ] Conformance runs web-only before Phase 5 and is sufficient; Unity + Godot plug into the identical fixtures and slot goldens at Phase 5 with no rework (Section D.9, E).
