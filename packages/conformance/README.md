# @marionette/conformance

The cross-runtime behavioral-truth check for Marionette. It holds the committed reference rigs, the
per-rig sample-spec, and the expected-output fixtures generated from `runtime-core` (the TypeScript
behavioral source of truth). Every runtime (web now, Unity and Godot in Phase 5) must reproduce these
fixtures within one shared tolerance. The authoritative design is
`docs/plan/cross-cutting/conformance-and-ci.md` (sections A and B). This package implements the Phase 1
slice: the package skeleton (WP-V.0), the `rig-2bone` rig and fixture (WP-V.1 / WP-V.2 / WP-1.12), the
tolerance policy (WP-V.3), and the toolchain pin (WP-V.17).

## Layout

```
src/
  registry.ts                 # RigId union, ordered RIG_IDS, RIG_PHASE map, CONFORMANCE_PHASE (B.2 gating)
  rigs/
    rig-2bone.json            # a valid SkeletonDocument, authored from first principles (Law 4, A.2)
  sample-spec/
    rig-2bone.sample-spec.json # the committed sample times every runtime reads (A.4)
  schema/
    rig.ts                    # a rig is a valid SkeletonDocument (validated via @marionette/format)
    sample-spec.ts            # Zod sample-spec schema + typed validator (A.4)
    fixture.ts                # Zod fixture schema + typed validator (A.3)
  compare/
    tolerance.ts              # the SINGLE source of the epsilon policy (A.5)
    compare.ts                # compareFixtures / compareAffine -> structured DriftReport (B.5)
  build-fixture.ts            # PURE: (document, spec, provenance) -> Fixture; runtime-core + format only (A.6, INV-2)
  io.ts                       # the only filesystem module: path resolution, validating loaders, sha256
  generate.ts                 # the generator CLI: solve + write fixture + .fixtures.lock (A.6)
  fixtures/
    rig-2bone.fixture.json    # COMMITTED expected output (generated; not hand-edited)
    .fixtures.lock            # sha256 manifest of rig + spec + fixture + toolchain id (drift tripwire)
  index.ts                    # the public barrel (consume only this across package boundaries)
test/
  rig.test.ts                 # the rig validates; AMEND-V-1 curve + channel coverage is present
  compare.test.ts             # the compare engine: 1e-7 passes, 1e-2 fails, discrete is exact
  oracle.test.ts              # the INDEPENDENT analytic oracle (TASK-1.12.5)
  roundtrip.test.ts           # regenerating in memory reproduces the committed fixture within tolerance
```

## The `rig-2bone` contract

Two bones (`root`, then child `child` at `x=100` in root-local, both length 100) and one animation
`default` (`duration = 1.0`, `loop = false`):

- `root.rotate`: linear `0 -> 90` over `[0, 0.5]`, held `90` to `1.0`.
- `root.translate`: a bezier-eased bump out and a linear return over `[0, 0.5]`, then zero to `1.0`.
- `child.rotate`: held `0` over `[0, 0.5]`, then linear `0 -> 90` over `[0.5, 1.0]`.
- `child.scale`: linear ramp then a STEPPED hold of `(2, 0.5)` over `[0.25, 0.5)`, then `(1, 1)` to `1.0`.

This exercises rotate (add), translate (add), scale (multiply), and the curve types linear, stepped,
and bezier (AMEND-V-1, the first appearance of bezier in the catalog). The fixture stores ONLY the raw
world affine `[a, b, c, d, tx, ty]` per bone in document order (A.3); decomposition is never stored.

The keyframes are designed so three sample times are analytic anchors with closed-form world transforms
(`test/oracle.test.ts`): at `t=0` the child world is identity-rotation translated to `(100, 0)` and its
tip is `(200, 0)`; at `t=0.5` the root has rotated exactly `+90` and the child world basis is a pure
`+90` rotation with tip `(0, 200)`; at `t=1.0` both have rotated `+90` so the child world is `+180` with
tip `(-100, 100)`. The oracle validates the first generation against these hand-computed values, so the
fixture is checked against an independent source, not merely frozen.

## Regenerating the fixtures (the A.6 ceremony)

Fixtures are generated FROM `runtime-core` and committed. Regeneration is a deliberate, reviewed act.

```sh
# 1. Use the PINNED Node (A.7). The fixtures store V8-computed cos/sin/long-sum results as exact JSON,
#    and the drift gate is a byte-exact git diff, so the generation toolchain must be pinned.
nvm use "$(cat .node-version)"   # 22.13.1
# 2. Generate. The generator refuses to run on a mismatched Node (typed error, nonzero exit) before
#    writing anything.
pnpm --filter @marionette/conformance generate
```

`generate.ts` is a pure function of (rig, sample-spec, runtime-core): no clock, no random. Re-running it
on the pinned toolchain produces a byte-identical tree.

### The drift gate (CI, wired separately)

A standalone, non-cached CI job regenerates and diffs:

```sh
pnpm --filter @marionette/conformance generate
git diff --exit-code packages/conformance/src/rigs \
                     packages/conformance/src/sample-spec \
                     packages/conformance/src/fixtures
```

A non-empty diff fails the job. Effect: any change to `runtime-core` solve behavior WITHOUT regenerating
fixtures fails CI. When the change is intended, regenerate under the review gate (the `behavior-change`
label, CODEOWNERS on `fixtures/**`, and an ADR or CHANGELOG entry, conformance A.6). Never hand-edit a
fixture; never loosen the tolerance to make a runtime pass.

## Tests

```sh
pnpm --filter @marionette/conformance test       # vitest: rig, compare, oracle, round-trip
pnpm --filter @marionette/conformance typecheck
```

The round-trip and oracle tests compare within the A.5 tolerance, so they pass on any modern Node. Only
the byte-exact drift gate is toolchain-sensitive and must run on the pin.

## Deferred: the runtime-web playback harness (B.2 / WP-V.4)

The Phase 1 plan's TASK-1.12.4 drives the committed fixture through the `runtime-web` PLAYBACK path (the
post-solve `SkeletonState`, no WebGL) so the conformance check also catches web-integration drift. That
harness lands with `runtime-web` animated playback (WP-1.10), which does not exist yet. Until then the
behavioral lock is two-sided and complete on the `runtime-core` side:

1. `test/roundtrip.test.ts` re-runs the generator in memory and asserts it reproduces the committed
   fixture within tolerance (the `runtime-core` half of WP-V.4: runtime-core still matches its fixture).
2. `test/oracle.test.ts` validates the committed fixture against an independent closed-form oracle.

When WP-1.10 lands, add `test/conformance.test.ts` (B.2): build the web `SkeletonState`, sample at the
spec times, and compare each snapshot to the committed fixture via `compareFixtures` + `tolerance.ts`.
This README is the reminder so the harness is not forgotten.
