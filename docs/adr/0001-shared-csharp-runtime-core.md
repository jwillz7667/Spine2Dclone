# ADR 0001: Shared engine-agnostic C# solve core for Unity and Godot, and the amended conformance independence model

- Status: Accepted (Phase 5)
- Date: 2026-06-26
- Deciders: Runtime / Platform lead, senior staff reviewer
- Supersedes: the "three independent runtimes" wording in `docs/plan/cross-cutting/conformance-and-ci.md` (amended in the same change)
- Referenced by: `docs/plan/phase-5-production-hardening.md` (DECISION-5.3, DECISION-5.4, sections 1, 7, 10, 12, 15)

## Context

The Phase 5 milestone requires a Unity runtime and a Godot runtime that each reproduce the `runtime-core` solve within the single conformance tolerance (A.5) for every committed fixture. The cross-cutting conformance plan (`conformance-and-ci.md`) was originally written around "three independent runtimes (web, Unity, Godot) producing identical presentation", which implied THREE independent reimplementations of the solve: one in TypeScript (`runtime-core`), one in Unity C#, and one in Godot (C# or GDScript).

Building two separate C# solves (one for Unity, one for Godot) doubles the most expensive and drift-prone work in the project (porting and re-validating the full solve and slot sequencer), and creates a standing engine-to-engine drift risk that delivers zero product value: the two engines are supposed to be byte-equivalent in their solve, not subtly different.

The engineering invariants already mandate that solving lives in `runtime-core` (platform-agnostic, no renderer) and that rendering is the renderer's job. That same split is what lets the logic move to C#. It applies cleanly inside the C# world too: one engine-agnostic solve library, with a thin per-engine render adapter.

## Decision

1. Implement the solve and the slot sequencer ONCE as an engine-agnostic C# library, `Marionette.Runtime.Core`, with no `UnityEngine` and no Godot types. It mirrors `runtime-core` function-for-function and solve-step-for-solve-step (the canonical six-step order, INV-3).

2. Unity (WP-5.3) and Godot (WP-5.4) are thin rendering adapters over that one shared core. Unity renders via dynamic `Mesh`; Godot renders via `ArrayMesh` / `MeshInstance2D`. The binary loader, the seed and PRNG path, and the slot sequencer are all in the shared core.

3. Amend the conformance independence model from "three independent solves" to: TWO independent solve implementations (TS `runtime-core` as the behavioral oracle, plus ONE shared C# core), exercised through THREE runtime load + render paths (web, Unity, Godot). Cross-language parity is proven TS-vs-C# over the whole committed fixture set. Unity-vs-Godot agreement is structural by construction (same C# code), and is still exercised end to end because each engine's conformance dump runs through that engine's actual load + render path (Godot through `godot --headless`, not a bare C# console).

4. Edit `conformance-and-ci.md` to match (the independence statement at the top of the document, governing all of Section B). This ADR is the authoritative record of the amendment.

## Consequences

### Positive

- One fewer full reimplementation to write, validate, and maintain.
- Zero Unity-vs-Godot solve drift by construction. A class of bug (the two engines disagreeing) cannot occur.
- The TS-vs-C# parity proof is unchanged in strength for every fixture-exercised path: the shared C# core is still validated against the TS-generated fixtures (INV-2), so the independent oracle still catches a C# solve bug on any path a fixture covers.

### Negative and the compensating control (load-bearing)

- A bug in `Marionette.Runtime.Core` that the committed fixture set does NOT exercise passes IDENTICALLY in Unity and Godot. There is no longer an independent second engine to disagree and surface it. The ONLY remaining cross-implementation guard is TS-vs-C# parity, and that itself only covers paths a committed fixture exercises.
- Therefore the A.2 reference-rig coverage checklist becomes the SOLE compensating control for the lost independent cross-check. Every solve branch must be exercised by at least one committed fixture: IK both bend directions, every non-`normal` `transformMode` (observable under a rotated, non-uniformly-scaled parent), `stepped` and `bezier` curve types, deform applied after skinning, draw-order reorders, and per-slot blend mode and color. The A.2 coverage meta-test must be GREEN, and that meta-test is the gate that makes the shared-core decision safe.
- Explicit statement of residual risk: any solve path not exercised by a committed fixture has ZERO cross-implementation verification under this model. Closing a coverage gap is a fixture addition (a deliberate, reviewed act under INV-2), not a code change.

### Fallback

If a future reviewer requires three fully-independent solves, split `Marionette.Runtime.Core` into two C# implementations (or a C# plus a GDScript implementation), accepting double maintenance and the reintroduced engine-to-engine drift risk. The conformance harness does not change shape under that fallback; only the number of independent solve implementations does.

## Compliance and enforcement

- The shared-core decision is safe only while the A.2 coverage meta-test is green. WP-5.5 (TASK-5.5.8) asserts this as a precondition of the shared-core claim, and the Phase 5 entry gate (G5.3) requires the A.2 coverage checklist green for web before Phase 5 begins.
- The Godot conformance dump MUST run through the Godot engine load + render path (DECISION-5.4), so the shared solve is still integration-tested per engine.
- This ADR does not change the format contract (Law 3) and adds no document mutation (Law 2). It is a runtime-architecture decision only.
