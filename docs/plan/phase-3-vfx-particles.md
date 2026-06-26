# Phase 3: VFX / particles (Layer B)

- Plan ID: PHASE-3
- Status: Plan of record, awaiting senior reviewer sign-off
- Owner: VFX / runtime
- Predecessor gate: PHASE-1 milestone green (see Entry gate below). PHASE-2 is NOT a prerequisite (see section 2.2).
- Successor: PHASE-4 (Slot composer) consumes the effect trigger API and the effect library this phase ships.
- Source of authority: `MARIONETTE_HANDOFF.md` sections 6 (format), 7 (math boundary), 8.1 (commands), 8.3 (viewport),
  8.8 (particle/VFX), 8.9 (atlas), 8.10 (slot integration / by-name trigger), 8.11 (conformance), 9 (roadmap), 10 (risk).
- Cross-cutting contracts (normative, not restated here): `docs/plan/cross-cutting/command-history.md` (LAW 2),
  `docs/plan/cross-cutting/conformance-and-ci.md` (conformance suite, epsilon policy, CI gates). Where a WP says
  "per the command-history contract" or "per the conformance contract", the cited document governs.

---

## 1. Milestone (the one sentence that gates the phase)

> Author a big-win effect bundle (`coinShowerLarge` + `rayBurst` + `screenFlash` + `glowPulse`, the full `megaWin`
> set of section 8.10), reference those effects BY NAME,
> trigger the bundle at a world anchor, and play it IDENTICALLY in the editor viewport preview and in `runtime-web`
> from an exported effects artifact, holding the frame budget and the particle pool caps, with seeded playback
> reproducible at a fixed quality tier.

If the acceptance script in section 12 does not pass, Phase 3 is not done. There is no partial credit.

---

## 2. Entry gate and phase independence

### 2.1 Phase 1 must be green before any WP-3.x starts

This is a checklist, not a vibe. Verify before opening the first Phase 3 branch.

- [ ] `packages/format` exports the section 6 types, the JSON Schema validator passes on the Phase 1 corpus, and
      `BlendMode` (`normal | additive | multiply | screen`) is wired through the renderer per-slot (Phase 1 WP-1.2).
- [ ] `runtime-core` owns `sampleSkeleton` and the shared bezier sampling (`BEZIER_SEGMENTS = 10`, Phase 1 WP-1.4)
      with no PixiJS import. Phase 3 reuses this exact sampling for over-life curves.
- [ ] Atlas import + maxrects pack pipeline (Phase 1 WP-1.3) emits an `AtlasRef` + PNG pages deterministically.
      Phase 3 reuses it unchanged to pack a VFX atlas.
- [ ] `DocumentModel` + `History` exist with coalescing and the mandatory do/undo round-trip test harness
      (Phase 1 + command-history contract). Phase 3 effect edits use the SAME History.
- [ ] `packages/conformance` skeleton exists with the generator, the fixtures-lock CI gate, and the tolerance table
      in one place (`compare/tolerance.ts`, conformance contract A.5/A.6). Phase 3 extends it, it does not rebuild it.
- [ ] CI is green: lint (boundary, commands-only, no-Pixi, no em-dash), typecheck (strict, no `any`/unjustified `as`
      in `format` + `runtime-core`), unit, conformance-web, perf-gates.

If any box is unchecked, fix it first. Phase 3 builds directly on every one of these.

### 2.2 Phase 2 independence (decision of record)

Particles do NOT depend on meshes, skinning, weight painting, IK, transform constraints, or deform timelines.
The only Phase 1/2 surfaces Phase 3 touches are: the `AtlasRef` shape, the shared curve sampling, point/bone
anchoring (point attachments exist in the format from Phase 0), the per-slot blend pipeline, and the command/history
system, all of which land in Phase 1. Therefore:

- A staffed team MAY build Phase 3 in parallel with Phase 2. The shared touch-points above are frozen Phase 1
  artifacts, so parallel work has no merge hazard beyond ordinary integration.
- The SOLO build order stays as written in the handoff roadmap (Phase 2 then Phase 3). Solo cannot parallelize, and
  Phase 2 is the longer pole, so it stays first. This document does not change the solo order, it only records that
  Phase 3's only hard gate is Phase 1.

---

## 3. Non-negotiable laws this phase touches (and where)

| Law / Invariant | Where it bites in Phase 3 | Enforcing WP |
|---|---|---|
| LAW 1 Math/presentation boundary | An effect, its trigger parameters, its seed, and its anchor are pure inputs. Nothing in the particle system reads or writes outcome. Particle state never feeds back into a `SpinResult`. Seeded reproducibility is a presentation property, not an outcome property. Phase 4 derives effect triggers from `SpinResult`; Phase 3 keeps the boundary clean by making `EffectConfig` carry zero outcome logic. Enforced by an AUTOMATED import-graph gate (mirroring the no-Pixi gate) that forbids any `runtime-core/effects` module from importing `math-bridge` or any `SpinResult` type. | WP-3.0, WP-3.4, WP-3.8 |
| LAW 2 All mutations are commands | Every edit to the effect library (create/delete/rename an effect, add/remove/reorder a layer, set any emitter or sprite-animator or trail field, edit an over-life curve, edit a bundle) is a `Command` with a mandatory do/undo round-trip test. The designer UI never mutates the document directly. | WP-3.6, WP-3.7 |
| LAW 3 Format is the contract | Effects serialize as a SIBLING format (`EffectsDocument`, section 5), separately semver-versioned (`effectsFormatVersion`), with its own JSON Schema and validate-on-import. `SkeletonDocument` (section 6 of the handoff) is NOT modified in Phase 3. This is the central LAW 3 decision; see section 5. | WP-3.0 |
| LAW 4 Spine legal boundary | The emitter model and its evaluation semantics are OUR design, specified from first principles in section 8. `@pixi/particle-emitter` is a web-side rendering/batching helper, NOT our cross-runtime contract and NOT the source of truth (section 7.2). No Spine source, no Spine format claims. | WP-3.1, WP-3.2, WP-3.5 |
| LAW 5 Phase independence, build in order | Phase 3 ends with a playable big-win effect. No Phase 4 slot/reel/symbol/win-logic leaks in beyond the trigger interface and the (presentation-only) bundle convenience. Effects carry no grid, no symbol, no win math. | All |
| INV runtime-core is PixiJS-free | The emitter SOLVE (spawn schedule, seeded per-particle state, fixed-dt integrator, over-life evaluation, ribbon geometry) lives in `runtime-core` with no renderer import. `runtime-web` only renders the solved state. | WP-3.1, WP-3.2, WP-3.3, WP-3.4 |
| INV Conformance generated from runtime-core | Particle fixtures are generated from the `runtime-core` solve, committed, and locked. Changing solve behavior forces fixture regeneration as a reviewed act (conformance contract A.6). | WP-3.10 |
| INV Editor state vs document state | Active-effect-being-edited, selected layer, preview transport (playing/time/loop), preview anchor, preview seed, preview quality tier live in Zustand. They are NOT in the document and are NOT undoable. | WP-3.6 |
| INV 60fps, pool, no per-frame allocation | Particles, ribbon vertex buffers, and sprite instances are pooled (structure-of-arrays). No heap allocation in `EffectSystem.step` or the render loop after warmup. Hard `maxParticles` caps and a global live-particle budget. | WP-3.2, WP-3.5, WP-3.9 |
| INV No em-dashes | All copy, comments, docs, UI strings in this phase. | All |

---

## 4. Scope

### 4.1 In scope

- The sibling effects format (`EffectsDocument`): `EmitterLayer`, `SpriteAnimatorLayer`, `RibbonTrailLayer`,
  `EffectConfig`, `EffectBundle`, JSON Schema, validator, `effectsFormatVersion = "1.0.0"`.
- A portable, seeded, fully specified emitter SOLVE in `runtime-core` (spawn shape point/line/circle/rect, spawn
  rate/burst, lifetime, start/end velocity, acceleration/gravity, drag, scale-over-life, color/alpha-over-life,
  rotation + angular velocity, texture or animated frames, per-particle trails).
- Sprite-animator and ribbon-trail solve in `runtime-core` (god rays, glow + pulse, screen flash, ribbon trails).
- The `EffectSystem` + trigger API + anchor model that the Phase 4 win sequencer calls by name.
- `runtime-web` particle renderer (pooled PixiJS `ParticleContainer` + mesh ribbons) wired through the existing
  per-slot blend pipeline (normal/additive/multiply/screen). `@pixi/particle-emitter` adopted per section 7.2.
- The particle designer panel (dockview) with live preview in the viewport, over-life curve editing reusing the
  Phase 1 curve editor, and all edits routed through commands.
- The shipped preset library: coin shower / coin burst, sparkle / star burst, light rays / god rays (particle AND
  sprite approaches), glow + pulse, ribbon trails, screen flash, and the `megaWin` bundle.
- Determinism: a normative integer PRNG, a normative per-particle draw order, fixed-dt integration, the quality-tier
  vs determinism rule (section 7.3).
- Mobile particle-perf mitigations now: per-emitter caps, a global live-particle budget with a specified eviction
  policy, aggressive pooling, quality tiers for ambient effects, and pool/allocation CI gates.
- Particle conformance fixtures generated from `runtime-core`, committed, locked, plus the harness extension.

### 4.2 Explicitly out of scope (deferred, do not build)

| Deferred item | Reason | Lands in |
|---|---|---|
| The win sequencer / state machine that maps `SpinResult` tiers to bundles | Layer C | Phase 4 (handoff 8.10) |
| Grid/reel/symbol binding of effects to cells | Layer C | Phase 4 |
| Binding effects to skinned-mesh vertices or deform output | Requires Phase 2 | Phase 4+ if a game needs it |
| GPU compute particles, custom WebGL shaders as the contract path | Portability + LAW 4; shaders differ per platform | Web-only advisory enhancement only (section 7.5); never a conformance contract |
| Device-tier profiling and tuning of real mobile budgets | Needs real hardware | Phase 5 (handoff risk register) |
| Unity / Godot particle reimplementations | Native runtimes | Phase 5, validated against Phase 3 fixtures |
| Binary effects encoding | Optimization | Phase 5 |
| Curl/noise/vortex force fields, sub-emitters, collision | Not needed for the Pragmatic preset set; scope creep (handoff 2.2) | Later, only if a game needs it |

Anything in 4.2 appearing in a Phase 3 PR is grounds for rejection under LAW 5.

---

## 5. Format posture and the serialization decision (LAW 3)

### 5.1 Decision of record: effects are a SIBLING format, not part of `SkeletonDocument`

Recommendation: **add a new top-level document type `EffectsDocument` to `packages/format`, semver-versioned
independently from the skeleton format, validated on import. Do NOT embed particle/effect data inside
`SkeletonDocument`.**

Justification (this is the load-bearing LAW 3 call of the phase):

1. **The skeletal format is the expensive-to-change contract; do not couple it to a faster-moving subsystem.**
   Embedding emitter subtrees in `SkeletonDocument` means every emitter field addition is a breaking change to the
   skeletal format, forcing a major bump that every skeleton, every rig, and every runtime must absorb even though no
   bone behavior changed. The VFX feature set will iterate more than the bone solve. Keep their version lines apart.
2. **Ownership matches usage.** Effects are referenced BY NAME from the slot layer's win sequencer (handoff 8.8/8.10),
   not authored per skeleton. The natural owner is a shared, reusable library (`coinShowerLarge` is used by many
   symbols and many games), not a field hanging off one rig. A sibling library document models that directly.
3. **It is still a contract, not a blob.** The sibling format is a real `packages/format` member: its own TypeScript
   types, its own JSON Schema, its own runtime validator, its own `effectsFormatVersion`, validate-on-import, and
   fail-loud on malformation. It satisfies LAW 3 fully; it simply has its own semver line.
4. **Clean reimplementation boundary.** Unity/Godot reimplement the emitter solve (Phase 5) against the effects
   format and its conformance fixtures, independent of skeletal-format churn.

Caveat, made precise in section 8.1 (so the independence claim is exactly scoped, not overstated): the two formats
are NOT fully disjoint. Three primitives (`BlendMode`, `AtlasRef`, `CurveType`) are a frozen shared sub-contract
(`packages/format/src/common`, versioned by `formatCommonVersion`) that BOTH documents import; neither document owns
them. "Independent version lines" means the two documents move independently for everything EXCEPT this small,
frozen, rarely-changed shared set, whose breaking changes are explicitly DUAL-bumped (both `formatVersion` and
`effectsFormatVersion`, same PR, section 8.1). That is a deliberate, bounded coupling on stable primitives, not the
wholesale coupling that embedding emitter subtrees in `SkeletonDocument` would create.

Rejected alternatives:

| Alternative | Why rejected |
|---|---|
| Embed effects in `SkeletonDocument` | Couples two version lines; forces skeletal major bumps for VFX changes; mismodels ownership (effects are shared, not per-rig). Violates the spirit of LAW 3. |
| Ad-hoc per-project JSON blob, no schema | Violates LAW 3 (must validate on import, fail loudly). No cross-runtime contract for Phase 5. |
| Use `@pixi/particle-emitter`'s config JSON as the on-disk format | Ties the portable contract to a third-party, web-specific schema that uses `Math.random`; not reimplementable cleanly in C#/GDScript; blurs LAW 4. Rejected (section 7.2). |

### 5.2 The project bundle on disk

The editor project is a skeleton plus an effects library (plus, in Phase 4, a slot scene). Save/export writes
separate, individually valid artifacts bound by a tiny manifest:

| Artifact | Format | Versioned by | Notes |
|---|---|---|---|
| `<name>.skel.json` | `SkeletonDocument` | `formatVersion` | Unchanged from Phase 1. |
| `<name>.fx.json` | `EffectsDocument` | `effectsFormatVersion` | New this phase. Carries its own VFX `AtlasRef`. |
| `<name>.project.json` | `ProjectManifest` | `projectFormatVersion` | Lists member artifacts + content hashes. Thin. |

`EffectsDocument` carries its own `atlas: AtlasRef` (the VFX atlas of coins, sparkles, rays, ribbons is usually a
distinct pack from character atlases). It reuses the Phase 1 atlas pipeline (WP-1.3) unchanged.

### 5.3 `formatVersion` posture

- `SkeletonDocument.formatVersion` does NOT change in Phase 3 (gate item, section 12.3).
- `effectsFormatVersion` is introduced at `"1.0.0"`. Any field change to the effects format after this phase is a
  semver bump with validator update and fixture regeneration in the SAME PR (conformance contract A.6).
- `formatCommonVersion` is introduced at `"1.0.0"` for the shared primitive sub-contract (`BlendMode`, `AtlasRef`,
  `CurveType`, in `packages/format/src/common`). A breaking change there DUAL-bumps `formatVersion` and
  `effectsFormatVersion` in the same PR, with both validators and both fixture sets regenerated (section 8.1).

---

## 6. Editor state additions (Zustand, ephemeral, NOT the document)

Declared here so reviewers can reject any attempt to put these in `DocumentModel`.

| State | Type | Notes |
|---|---|---|
| `activeEffect` | `EffectId \| null` | Internal ID of the effect being edited; the panel resolves it to a display name. Selection holds an ID, never a name or array index (command-history D2, section 8.1.1). |
| `selectedLayer` | `EffectLayerId \| null` | Internal ID of the selected layer within `activeEffect`. Holds an ID, never an array index. |
| `preview.isPlaying` | `boolean` | Preview transport. |
| `preview.time` | `number` (seconds) | Preview clock position. |
| `preview.loop` | `boolean` | Loop the preview. |
| `preview.seed` | `number` (uint32) | Seed used for the preview run (deterministic effects). |
| `preview.qualityTier` | `'low' \| 'medium' \| 'high'` (default `high`) | Preview tier; conformance uses `high`. |
| `preview.anchor` | `EffectAnchor` | Where the preview instantiates the effect. |
| `preview.showStats` | `boolean` | Toggles the live-particle-count / pool-high-water HUD. |

Round-trip rule: serializing then loading the project does not restore any of the above. They are editor state only.

---

## 7. Architecture decisions of record

### 7.1 Single solve path; rendering is separate (INV runtime-core PixiJS-free)

- **Solve (runtime-core, PixiJS-free, the conformance source of truth):** owns the spawn schedule, the seeded PRNG
  draws, per-particle initial state, the fixed-dt integrator, over-life evaluation, sprite-animator transforms, and
  ribbon geometry. It writes solved state into pooled structure-of-arrays buffers (section 8.2). This is the ONLY
  simulator, used for both deterministic and ambient effects so they look identical and one conformance solve covers
  both.
- **Render (runtime-web):** reads the solved SoA buffers and draws pooled PixiJS `ParticleContainer` sprites and mesh
  ribbons with per-slot blend. It performs zero simulation. In particular `@pixi/particle-emitter`, where used at
  all, is a render/batching helper fed already-solved SoA state; it never spawns and never integrates (section 7.2).

### 7.2 The role of `@pixi/particle-emitter` (reconciling the handoff with the invariants)

The handoff (4, 8.8) names `@pixi/particle-emitter` as the particle runtime. The invariants constrain HOW we adopt it:
`runtime-core` must be PixiJS-free, conformance is generated FROM `runtime-core`, and Unity/Godot reimplement the same
model. A third-party PixiJS simulator cannot be the cross-runtime source of truth without breaking all three. Decision
of record, with the divergence stated openly:

- We ADOPT `@pixi/particle-emitter` as a reference for the feature model and, on the render side ONLY, as an
  OPTIONAL pooled-batch container that CONSUMES already-solved SoA state. Where used it performs ZERO spawning and
  ZERO integration; it never advances a simulation. It is a draw/batch helper, not a simulator. There is no
  config-to-pixi-simulator adapter, because pixi never simulates.
- We do NOT make it the simulator and we do NOT make its config our on-disk contract. Our `EmitterConfig` (section 8)
  is the portable contract; our `runtime-core` solve is the behavioral source of truth for BOTH deterministic and
  ambient effects, so the editor preview and `runtime-web` solve every effect identically and one conformance solve
  covers both. Ambient effects differ from deterministic ones only by tier count-scaling (section 8.8), not by which
  simulator runs them.
- Rationale: portability (Unity/Godot), LAW 4 cleanliness (our own model, not a vendored one), LAW 1 + determinism
  (we control the RNG and the integrator), and conformance (the tested code is the shipped code). The handoff's
  intent ("a proven emitter model, author configs in-editor") is honored; the literal "delegate simulation to the
  library" reading loses to the invariants, which win.

### 7.3 Determinism model (LAW 1) and the quality-tier rule

- **What LAW 1 binds for particles:** the SEQUENCE of effect triggers, their parameters, their anchors, and their
  seeds are a pure function of the inputs (in Phase 4, of `SpinResult`). Which effects fire, when, and where is
  deterministic. Particle state never influences outcome.
- **Particle-level reproducibility (opt-in, parameterized by `(seed, qualityTier)`):** an effect flagged
  `deterministic: true` consumes a seeded integer PRNG (section 8.3) and a fixed simulation dt (section 8.4). At a
  FIXED quality tier and seed, its solved state is reproducible run to run and across runtimes (within the epsilon
  policy for float quantities, exact for integer quantities). This supports cross-runtime conformance, QA replay, and
  any future recorded/synchronized playback "where the slot layer needs it" (handoff 8.8).
- **Quality tiers and determinism do not conflict, by construction.** Quality-tier count scaling (section 8.8) applies
  ONLY to ambient effects (`deterministic: false`). Deterministic effects always run at their AUTHORED counts and
  caps, because those counts are part of the contract. Cross-tier visual identity is explicitly NOT promised (that is
  the entire point of tiers); within a tier, reproducibility holds. Conformance fixtures are generated at the
  reference tier `high` with a fixed seed.
- **Seed provenance:** the seed is supplied by the TRIGGER, not baked into the reusable `EffectConfig`. In Phase 4 the
  sequencer derives it deterministically from the result (for example `hash32(spinId, effectInstanceIndex)`); in
  Phase 3 the preview/bundle supplies it. This keeps configs reusable and the boundary clean.

### 7.4 Blend modes reuse the existing per-slot pipeline (no new enum)

Emitter, sprite-animator, and ribbon layers each carry `blendMode: BlendMode` reusing the format's existing
`'normal' | 'additive' | 'multiply' | 'screen'`. The renderer maps these through the SAME PixiJS blend setup the
Phase 1 slot renderer uses (WP-1.2). No second blend code path, no new enum. A conformance check asserts the four
modes map to the same PixiJS constants used by slots.

### 7.5 God rays: two approaches, sprite-default

The handoff requires both a particle and a sprite/shader approach for light rays.

- **Sprite approach (default, portable, conformance-covered):** a `SpriteAnimatorLayer` drawing an additive,
  pre-baked ray-fan texture with `rotationDegPerSec` and an alpha pulse. Trivially reimplementable in Unity/Godot.
- **Particle approach:** an `EmitterLayer` with low spawn count, long lifetime, additive blend, slow rotation, a
  thin-ray region. Also portable and conformance-covered.
- **Shader enhancement (web-only, advisory, NOT a contract):** `runtime-web` MAY substitute a radial-ray fragment
  shader for the sprite layer for higher quality. It is a render-side swap that MUST be visually equivalent enough to
  degrade to the sprite layer on any runtime that does not implement it, and it is excluded from the conformance
  contract (shaders differ per platform). Flagged off by default.

---

## 8. Normative specifications (precise enough to reimplement in C# and GDScript)

This section is the reimplementation contract for Phase 5. It is the part a native-runtime author reads.

### 8.1 The effects format (`packages/format`, sibling document)

```ts
// packages/format/src/effects/types.ts
export interface EffectsDocument {
  effectsFormatVersion: string;            // semver of THIS format, "1.0.0"
  name: string;
  hash: string;                            // content hash for runtime cache-busting
  atlas: AtlasRef;                         // VFX atlas; reuses the Phase 1 AtlasRef shape
  effects: Record<string, EffectConfig>;   // keyed by effect name (the name the sequencer references)
  bundles: Record<string, EffectBundle>;   // named, presentation-only effect groupings
}

export interface EffectConfig {
  name: string;
  duration: number | null;                 // seconds of emission; null = endless (must be stopped explicitly)
  deterministic: boolean;                  // true => seeded solve + authored counts; false => ambient (tier-scalable)
  simulationDt: number;                    // fixed sim step in seconds (default 1/60); see 8.4
  layers: EffectLayer[];                   // drawn in array order (z within the effect)
}

export type EffectLayer = EmitterLayer | SpriteAnimatorLayer | RibbonTrailLayer;

export interface EmitterLayer {
  type: 'emitter';
  name: string;
  blendMode: BlendMode;                    // reuse format BlendMode
  maxParticles: number;                    // HARD pool cap (mobile perf)
  spawn: SpawnConfig;
  shape: EmitterShape;                     // point | line | circle | rect (spawn position source)
  lifetime: RangeF;                        // seconds
  startSpeed: RangeF;                      // units/sec along the emission direction
  emissionAngle: RangeF;                   // degrees; the spawn arc (coin arc, fan)
  startRotation: RangeF;                   // degrees
  angularVelocity: RangeF;                 // degrees/sec
  startScale: RangeF;
  gravity: Vec2;                           // units/sec^2 (coin shower pulls down)
  acceleration: Vec2;                      // constant world-space acceleration
  drag: number;                            // linear damping per second, >= 0
  scaleOverLife: LifeCurve<number>;        // multiplies startScale, normalized 0..1 life
  colorOverLife: LifeCurve<RGB>;           // multiplies texture color
  alphaOverLife: LifeCurve<number>;        // 0..1
  texture: ParticleTexture;
  particleTrail: TrailSpec | null;         // optional per-particle streak
}

export type SpawnConfig =
  | { mode: 'rate'; particlesPerSecond: number }
  | { mode: 'burst'; count: number; atTime: number }
  | { mode: 'bursts'; bursts: { atTime: number; count: number }[] };  // atTime strictly increasing

export type EmitterShape =
  | { kind: 'point' }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'circle'; radius: number; edgeOnly: boolean }
  | { kind: 'rect'; width: number; height: number };

export type ParticleTexture =
  | { kind: 'static'; region: string }                                  // atlas region name
  | { kind: 'animated'; regions: string[]; fps: number; mode: 'loop' | 'overLife' | 'once' };

export interface SpriteAnimatorLayer {
  type: 'spriteAnimator';
  name: string;
  blendMode: BlendMode;
  region: string;                          // atlas region (ray-fan, glow blob, or 1x1 white for flash)
  anchorSpace: 'world' | 'screen';         // screen = full-viewport (flash)
  rotationDegPerSec: number;
  scaleOverLife: LifeCurve<number>;
  colorOverLife: LifeCurve<RGB>;
  alphaOverLife: LifeCurve<number>;
  loop: boolean;
  layerDuration: number;                   // seconds for one cycle of the over-life curves
}

export interface RibbonTrailLayer {
  type: 'ribbonTrail';
  name: string;
  blendMode: BlendMode;
  region: string;                          // ribbon strip texture
  anchorRef: string;                       // logical anchor name resolved at trigger time
  maxSegments: number;                     // pooled vertex budget (HARD cap)
  segmentSpacing: number;                  // world units between recorded points
  widthOverLength: LifeCurve<number>;      // head (0) to tail (1)
  colorOverLength: LifeCurve<RGB>;
  alphaOverLength: LifeCurve<number>;
}

export interface TrailSpec {
  region: string;
  maxSegments: number;
  segmentSpacing: number;
  widthOverLength: LifeCurve<number>;
  alphaOverLength: LifeCurve<number>;
}

export interface EffectBundle {
  name: string;                            // e.g. "megaWin" (referenced by the sequencer)
  items: { effect: string; startOffset: number; anchorRole: string; seedSalt: number }[];
}

export interface RangeF { min: number; max: number }   // if min === max, constant (consumes ZERO PRNG draws)
export interface Vec2 { x: number; y: number }
export interface RGB { r: number; g: number; b: number }  // 0..1; alpha handled by alphaOverLife
export interface LifeCurve<T> {
  // stops over normalized parameter t in [0,1]; first.t === 0, last.t === 1, strictly increasing
  stops: { t: number; value: T; curve: CurveType }[];   // CurveType reused from the skeletal format
}
```

`BlendMode`, `AtlasRef`, and `CurveType` are NOT redefined here, and they are NOT owned by the skeletal format
either. They are promoted to a frozen shared sub-contract `packages/format/src/common` (the common primitives both
documents depend on), versioned by its own `formatCommonVersion`. Both `SkeletonDocument` and `EffectsDocument`
import from `common`; neither owns these types. Versioning rule of record (this closes the independence claim in
section 5): a breaking change to any `common` primitive bumps `formatCommonVersion` AND, in the SAME PR, both
`formatVersion` and `effectsFormatVersion`, with both validators and both fixture sets regenerated (conformance
contract A.6). A non-breaking addition to one document that does NOT touch `common` bumps only that document's
version. This is the precise sense in which the two document version lines are independent: they move independently
for everything EXCEPT the small, frozen, rarely-changed shared primitive set, whose changes are explicitly
dual-bumped. `LifeCurve` evaluation uses the SAME `BEZIER_SEGMENTS = 10` sampling as animation (Phase 1 WP-1.4), so
the designer preview, `runtime-core`, and `runtime-web` share one math path.

### 8.1.1 Internal identity model for effect entities (extends command-history D2)

The effects format above is name-keyed (effects by `name`) and array-ordered (layers, `LifeCurve.stops`, bundle
items) ON DISK; that is the contract and it does not change. INTERNALLY, exactly as the skeletal model does for
bones and slots (command-history decision D2), the `DocumentModel` addresses every effect entity by a stable,
opaque, branded ID, never by name and never by array index. Four phase-scoped ID brands are declared in Phase 3 (the
`EmitterId` placeholder reserved in command-history section 2 / WP-C.13 is realized as these four):

```ts
export type EffectId = Id<'effect'>;           // an EffectConfig in the library
export type EffectLayerId = Id<'effectLayer'>; // a layer within an effect
export type LifeStopId = Id<'lifeStop'>;       // a stop within a LifeCurve
export type BundleItemId = Id<'bundleItem'>;   // an item within an EffectBundle
```

Rules of record (identical discipline to bones/slots, command-history D2):

- IDs are minted from the on-disk names/array order at IMPORT (via the injected `IdFactory`), are internal-only, and
  are NEVER serialized into `EffectsDocument`. Export resolves IDs back to names and re-emits arrays in their
  preserved order. The round-trip property `exportEffects(importEffects(x))` deep-equals canonical `x` holds despite
  IDs being regenerated on import (pinned in WP-3.0).
- Names are mutable attributes, not identities. `RenameEffect` is a single-field change with ZERO cascade because
  bundle items reference an `EffectId`, not the effect's name. Name uniqueness is an EXPORT-only contract, validated
  at export (a duplicate is a typed error there), exactly as for bones.
- EVERY command in section 10 addresses its target(s) by ID. `ReorderLayers` takes an ordered `EffectLayerId[]`;
  `MoveLifeStop`/`RemoveLifeStop` target a `LifeStopId`; `RemoveLayer`/`SetLayerField` target an `EffectLayerId`;
  `SetBundleItem`/`RemoveBundleItem` target a `BundleItemId`. No command addresses an entity by name or by array
  index, so reorders and removes are safe under undo/redo interleaving (command-history D2).
- Editor-state selection (section 6) holds these IDs, never names or indices.

### 8.2 Solved-state buffers (pooling, INV no per-frame allocation)

Per active emitter instance, state is structure-of-arrays in pre-allocated typed arrays of length `maxParticles`:

```ts
// runtime-core, allocated once at instance creation, never reallocated
interface ParticlePool {
  alive: Uint8Array;            // 1 = live
  ageSteps: Int32Array;        // integer sim-steps since spawn; the recycle decision is integer-exact (8.4)
  lifeSteps: Int32Array;       // total lifetime in integer sim-steps = max(1, ceil(lifeSeconds / dt)) (8.4)
  px: Float64Array; py: Float64Array;
  vx: Float64Array; vy: Float64Array;
  rot: Float64Array;           // degrees
  angVel: Float64Array;        // degrees/sec
  baseScale: Float64Array;
  frame: Int32Array;           // current animated-frame index
  spawnOrder: Int32Array;      // monotonic spawn counter (exact, conformance key)
  // derived render outputs, written each step:
  outScale: Float64Array; outAlpha: Float64Array;
  outR: Float64Array; outG: Float64Array; outB: Float64Array;
}
```

Free-list management is index based (a `Uint32Array` free stack), so spawn/recycle does zero allocation. The render
layer reads these arrays directly. Ribbon trails use a pooled ring buffer of recorded points of length `maxSegments`.

### 8.3 Seeded PRNG and per-particle draw order (NORMATIVE, integer-exact across runtimes)

Determinism for spawn relies on integer arithmetic, which IS bit-reproducible across TS, C#, and GDScript (unlike the
float solve, which uses the epsilon policy). The generator is Mulberry32, specified with explicit unsigned-32-bit
semantics. Every operation is masked to 32 bits unsigned.

```ts
// runtime-core/src/effects/prng.ts
// State is a single uint32. All ops are uint32 (mask & 0xFFFFFFFF). imul is 32-bit signed-truncating multiply.
export function nextU32(state: { s: number }): number {
  state.s = (state.s + 0x6D2B79F5) >>> 0;
  let t = state.s;
  t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
  t = (t ^ (t + (Math.imul(t ^ (t >>> 7), t | 61) >>> 0))) >>> 0;
  return (t ^ (t >>> 14)) >>> 0;
}
// [0,1): exact, since dividing a uint32 by 2^32 is exact in f64
export function nextUnit(state: { s: number }): number { return nextU32(state) / 4294967296; }
// per-RangeF draw: constant ranges consume ZERO draws (so authored constants never shift the stream)
export function drawRange(state: { s: number }, r: RangeF): number {
  if (r.min === r.max) return r.min;
  return r.min + nextUnit(state) * (r.max - r.min);
}
// stream seeding: derive an independent stream per (instanceSeed, layerIndex)
export function hash32(a: number, b: number): number {
  let h = (a ^ 0x9E3779B9) >>> 0;
  h = Math.imul(h ^ b, 0x85EBCA6B) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
```

Reimplementation notes for native runtimes: in C# use `uint` with `unchecked`; `Math.imul(x,y)` equals
`unchecked((int)((uint)x * (uint)y))` reinterpreted as uint. In GDScript mask every intermediate with
`& 0xFFFFFFFF`. The `>>>` operator is a logical (unsigned) shift; reproduce with unsigned types or explicit masking.

Per-emitter stream seed: `instanceSeed = hash32(triggerSeed, layerIndex)`. For bundles, the effective trigger seed is
`hash32(bundleSeed, itemSeedSalt)`.

**Per-particle draw order (NORMATIVE).** When a particle is spawned, PRNG draws happen in EXACTLY this order, and a
`RangeF` with `min === max` consumes ZERO draws:

1. Spawn position from `shape`:
   - `point`: 0 draws (origin).
   - `line`: 1 draw (parameter along the segment).
   - `circle` edgeOnly: 1 draw (angle); not edgeOnly: 2 draws (angle, then radius via `sqrt(unit)` for area-uniform).
   - `rect`: 2 draws (u then v).
2. `lifetime` (1 draw if non-constant); the drawn float is converted to integer `lifeSteps` at spawn (section 8.4).
3. `emissionAngle` (1 draw if non-constant).
4. `startSpeed` (1 draw if non-constant).
5. `startRotation` (1 draw if non-constant).
6. `angularVelocity` (1 draw if non-constant).
7. `startScale` (1 draw if non-constant).
8. If `texture.kind === 'animated'` and `mode === 'loop'`: 1 draw for the starting frame offset; otherwise 0.

Velocity decomposition: `vx = startSpeed * cos(emissionAngle); vy = startSpeed * sin(emissionAngle)`, angle in
degrees converted to radians as `deg * PI / 180`. This is the one place direction is set; document it so all runtimes
agree on the convention (0 degrees = +x, counter-clockwise positive).

Note on what the PRNG fixes vs what is integer-scheduled. The draws above fix per-particle INITIAL state and a float
`lifetime`. The TIMING decisions (when to spawn, when to recycle) are NOT float comparisons; they are integer-step
events specified in 8.4. That separation is what makes counts, spawn order, and the alive set portable-EXACT across
runtimes (8.9), while positions and colors stay on the float epsilon path.

### 8.4 Fixed-dt integrator, integer step clock, spawn schedule (NORMATIVE)

The `EffectSystem` advances each instance with a fixed `simulationDt`. The simulation clock is an INTEGER step
counter `stepIndex` (incremented once per `stepOnce`), NOT a float seconds value. Every quantity the conformance
contract compares EXACT (live count, `spawnOrder`, `frame`, `alive`) is a pure function of integer arithmetic plus a
small number of float-to-fixed-point quantizations performed ONCE at instance creation under a specified rounding
rule. No EXACT quantity depends on an accumulated float comparison.

Why this is portable (the load-bearing reason the integer clock exists). The basic IEEE-754 operations (`+`, `-`,
`*`, `/`) are correctly rounded and therefore bit-identical across V8 (TS), .NET (C#), and Godot (GDScript/C++).
Only operation REORDERING, fused-multiply-add contraction, and transcendentals (`sin`/`cos`/`sqrt`) diverge across
runtimes (conformance contract A.5, Phase 1 R1.2). The integer spawn/recycle schedule below touches none of those:
it never accumulates float error across steps and never compares a float against a threshold. So an EXACT quantity
cannot flip one step early or late on a native runtime, and the EXACT bucket (8.9) is genuinely cross-runtime, not
just identical inside TS.

Quantization at instance creation (computed once, no fused-multiply-add, evaluated left to right, a single
round-half-away-from-zero per value):

- `SPAWN_FIXED_ONE = 65536` (2^16). `spawnPerStepFixed = round(particlesPerSecond * simulationDt * SPAWN_FIXED_ONE)`
  as a non-negative integer (the two multiplies left to right, then one round).
- `emitUntilStep = duration === null ? POSITIVE_INFINITY : ceil(duration / simulationDt)` (integer or +Inf).
- Per burst entry, `burstStep = ceil(atTime / simulationDt)` (integer). Bursts fire on an integer step index, never
  on a float compare.

Per-particle lifetime quantization at SPAWN (one divide, correctly rounded, then ceil):

- `lifeSteps = max(1, ceil(lifeSeconds / simulationDt))`, where `lifeSeconds` is the float `lifetime` draw (8.3).
  Both the `lifetime` draw (`drawRange`, 8.3) and this divide use NO fused-multiply-add, so `lifeSeconds` and the
  integer `lifeSteps` are bit-identical across runtimes (the same FMA-free discipline A.5 relies on). Recycle is the
  integer event `ageSteps >= lifeSteps`, never the float compare `age >= life`. The over-life parameter is
  `u = ageSteps / lifeSteps` (one integer-to-float divide, in `[0,1)` until the recycle step).

Frame loop and sub-steps:

```
advance(instance, frameDt):
  instance.acc += frameDt
  while instance.acc >= dt:               # dt = config.simulationDt
    stepOnce(instance)
    instance.acc -= dt
  # render uses the latest stepped state (no inter-step interpolation in v1)

stepOnce(instance):
  instance.stepIndex += 1
  spawnForStep(instance)                  # integer schedule below, BEFORE integrating
  for each live particle p:
    p.ageSteps += 1
    if p.ageSteps >= p.lifeSteps: recycle(p); continue
    # semi-implicit (symplectic) Euler, fixed operation order, float (epsilon class):
    p.vx += (gravity.x + acceleration.x) * dt
    p.vy += (gravity.y + acceleration.y) * dt
    p.vx -= p.vx * drag * dt
    p.vy -= p.vy * drag * dt
    p.px += p.vx * dt
    p.py += p.vy * dt
    p.rot += p.angVel * dt
    u = p.ageSteps / p.lifeSteps          # integer / integer -> float in [0,1)
    p.outScale = p.baseScale * eval(scaleOverLife, u)
    (p.outR,p.outG,p.outB) = eval(colorOverLife, u)
    p.outAlpha = eval(alphaOverLife, u)
    p.frame = animatedFrameIndex(texture, p)
```

Spawn schedule (integer, deterministic, portable):

- `rate`: maintain an INTEGER fixed-point accumulator `spawnAccFixed`. Each step while emission is active
  (`stepIndex <= emitUntilStep`): `spawnAccFixed += spawnPerStepFixed; n = spawnAccFixed >> 16;
  spawnAccFixed -= n << 16;` then attempt to spawn `n` particles. No float accumulation, so no last-ULP threshold
  flips; a constant authored rate yields the same integer `n` sequence on every runtime.
- `burst { count, atTime }`: when `stepIndex === burstStep`, spawn `count` particles in one batch (integer equality).
- `bursts`: same rule per entry, each with its own `burstStep`, in ascending `atTime`.
- **Cap semantics (NORMATIVE):** if a spawn is requested while `liveCount === maxParticles`, the spawn is SKIPPED and
  consumes ZERO PRNG draws, but the spawn schedule (the integer accumulator, the burst firing) still advances (the
  slot is simply not filled). Fully specified, deterministic, reimplementable. Caps are part of the config, hence
  part of the contract; behavior must not depend on unspecified recycling.

Animated-frame index (NORMATIVE, integer so `frame` is EXACT-portable). For an `animated` texture with `N` regions,
using a 64-bit integer (or an f64 that holds integers exactly to 2^53) for the products:

- `loop`: precompute once `framesPerStepFixed = round(fps * simulationDt * 65536)`; then
  `frame = (startOffset + ((ageSteps * framesPerStepFixed) >> 16)) mod N`, where `startOffset` is the 1 PRNG draw
  from 8.3 step 8.
- `overLife`: `frame = min(N - 1, (ageSteps * N) / lifeSteps)` (integer division).
- `once`: `frame = min(N - 1, (ageSteps * N) / lifeSteps)` with no wrap.

All operations are integer, so `frame` matches exactly across runtimes.

Batch spawn ordering: within a single `stepOnce`, particles spawn in index order of the burst loop; each particle's
PRNG draws (section 8.3) are consumed in spawn order. `spawnOrder` increments per spawned particle and is an exact
conformance key.

Global frame ordering (NORMATIVE, satisfies the per-frame solve-order invariant). `EffectSystem.step(frameDt)` runs
ONCE per rendered frame and is sequenced AFTER the skeleton solve has completed its world-transform pass (global
solve order step 4) and its skin + deform pass (step 5), and BEFORE draw (step 6). Concretely it occupies slot 5.5:
reset pose, apply animation, solve constraints, world transforms, skin + deform, PARTICLE STEP, render. This ordering
is mandatory on every runtime so a `'bone'`-anchored effect reads the CURRENT frame's final world transform, never a
stale one. A native runtime that steps particles before the skeleton world pass is non-conformant.

Anchor sampling cadence across sub-steps (NORMATIVE). The skeleton is solved ONCE per rendered frame, not per
particle sub-step. Therefore an effect's resolved anchor world transform is sampled ONCE per frame and held CONSTANT
across all 0..N fixed-dt sub-steps of that frame; sub-steps are a particle-only subdivision and never re-solve the
skeleton. Consequence (load-bearing and intended): for a moving emitter, every particle spawned across the sub-steps
of one frame spawns at that frame's single anchor position; and a ribbon records at most one point per frame (the
`segmentSpacing` test in 8.6 is evaluated against the per-frame anchor, not per sub-step), so ribbon geometry is a
function of the per-frame anchor path. This rule is part of the solved state and must match across runtimes.

### 8.5 Over-life curve evaluation (reuse, one math path)

`eval(curve, u)` for `u in [0,1]`: find the bracketing stop segment `[t_i, t_{i+1}]`, normalize
`n = (u - t_i)/(t_{i+1} - t_i)`, apply the segment's `CurveType` easing via the shared `BEZIER_SEGMENTS = 10`
sampling (Phase 1 WP-1.4), and interpolate the value. For `RGB`, each channel interpolates independently. `u <= 0`
clamps to the first stop, `u >= 1` clamps to the last. This is the identical function used by the skeletal animation
sampler; there is no second easing implementation (risk R3.6).

### 8.6 Sprite-animator and ribbon semantics (NORMATIVE)

- **SpriteAnimatorLayer:** a single quad. Local time `lt` advances with the same fixed `simulationDt`. If `loop`,
  `u = (lt mod layerDuration)/layerDuration`, else `u = clamp(lt/layerDuration, 0, 1)`. Rotation is
  `rot = rotationDegPerSec * lt` (continuous, not wrapped, for smooth god-ray spin). Scale/color/alpha come from the
  over-life curves at `u`. `anchorSpace: 'screen'` places the quad in viewport space scaled to cover the viewport
  (the screen flash); `'world'` places it at the resolved anchor transform. No PRNG draws (sprite animators are fully
  deterministic without a seed). Because the screen-space transform is a function of viewport size (a non-portable
  render input), `anchorSpace: 'screen'` layers are EXCLUDED from the cross-runtime conformance rig set (8.9) and are
  covered only by the render-side DoD assertion (12.2 step 6).
- **RibbonTrailLayer / TrailSpec:** maintain a ring buffer of recorded anchor positions. Each frame (the anchor is
  sampled once per frame, section 8.4), if the per-frame anchor has moved at least `segmentSpacing` from the last
  recorded point, push a new point (drop the oldest beyond `maxSegments`). Geometry is a triangle strip: at each
  point, two vertices offset perpendicular to the local
  direction by `0.5 * width`, where `width = eval(widthOverLength, k/maxSegments)` for the k-th point from the head.
  Color/alpha-over-length sample the same `k/maxSegments` parameter. The ribbon is a pure function of the anchor path,
  so it is deterministic whenever the anchor is.

### 8.7 `EffectSystem`, trigger API, anchor model (the surface Phase 4 calls)

```ts
// runtime-core/src/effects/system.ts  (PixiJS-free; produces state, renders nothing)
export interface EffectTrigger {
  effect: string;            // EffectsDocument.effects key (by name)
  anchor: EffectAnchor;
  seed: number;              // uint32; used iff the effect config is deterministic
  startTime: number;         // scene-clock seconds when emission begins
}
export type EffectAnchor =
  | { space: 'world'; x: number; y: number; rotation: number }
  | { space: 'bone'; skeletonInstanceId: string; pointOrBone: string }  // resolves to a world transform per frame
  | { space: 'gridCell'; row: number; col: number }                     // resolved by Phase 4; identity in Phase 3
  | { space: 'screen' };

export interface EffectSystem {
  trigger(t: EffectTrigger): EffectInstanceId;
  triggerBundle(bundle: string, baseSeed: number, anchors: Record<string, EffectAnchor>, startTime: number): EffectInstanceId[];
  stop(id: EffectInstanceId): void;        // ends emission; lets live particles finish unless hardStopped
  step(frameDt: number): void;             // advances all instances (fixed dt internally per instance)
  readState(): ReadonlyEffectFrame;        // the SoA buffers the renderer consumes
}
```

- The trigger parameters are pure inputs (LAW 1). Nothing here reads outcome. Phase 4 constructs `EffectTrigger`s and
  bundle anchor maps from a `SpinResult`; Phase 3 constructs them from the preview/DoD harness.
- The `'bone'` anchor resolves against a running skeleton instance's world transform, which lets a coin trail follow
  a bone tip. Per section 8.4, `EffectSystem.step` runs AFTER the skeleton world + deform passes and before draw, so
  this read is the CURRENT frame's final transform, and the transform is sampled once per frame and held across all
  sub-steps. Skeleton instances come from Phase 1; no Phase 2 mesh is required.
- `EffectBundle` is presentation-only: an ordered list of effects with relative `startOffset` and an `anchorRole`
  resolved by the caller. It encodes NO win logic, NO grid, NO outcome (LAW 5 boundary, gate item 12.3).

### 8.8 Caps, global budget, quality tiers (mobile perf, addressed now)

| Control | Where | Rule |
|---|---|---|
| Per-emitter `maxParticles` | config | Hard pool cap; section 8.4 cap semantics. Pre-allocated, never grown. |
| Global live-particle budget | `EffectSystem` | `MAX_LIVE_PARTICLES` (default 2000, configurable per scene). When a spawn would exceed the global budget, evict by policy below. |
| Eviction policy (NORMATIVE) | `EffectSystem` | Evict the OLDEST live particle of the LOWEST-priority active effect (`deterministic: false` ambient before `true`). Ties broken by lowest instance id then lowest `spawnOrder`. Fully specified so it is deterministic given identical inputs. Deterministic effects are evicted only if no ambient particle exists, which is logged as a budget-overflow warning so authors can lower counts. |
| Quality tiers | `EffectSystem` | `low/medium/high` scale spawn rate and `maxParticles` by `{low:0.4, medium:0.7, high:1.0}` for AMBIENT effects ONLY. Deterministic effects ignore the multiplier (section 7.3). |
| Ribbon segment cap | config | `maxSegments` pooled ring buffer; never grown. |
| Allocation discipline | runtime-core + runtime-web | Zero heap allocation in `step` and render after warmup; enforced by the per-frame allocation gate (conformance C.4 / WP-V.8). |

### 8.9 Conformance fixture spec for particles (generated from runtime-core)

A particle conformance fixture is `(effectConfig, seed, qualityTier='high', sample-spec)` producing, at each sampled
frame, a per-particle dump. Comparison splits exact vs epsilon (extends conformance contract A.5). The split is only
sound because the integer quantities are genuinely PORTABLE: per section 8.4 the spawn schedule, the burst firing,
recycle, and the animated-frame index are integer-step events (a fixed-point integer spawn accumulator, an integer
`burstStep`, the integer test `ageSteps >= lifeSteps`, and integer frame arithmetic), with the only float-to-integer
steps being single, explicitly-rounded quantizations done once at instance creation. No EXACT quantity is a float
threshold crossing, so a last-ULP difference in `px`, `vy`, or a curve output cannot flip an EXACT quantity one step
early or late on a native runtime. This is the deliberate design that lets us claim EXACT (not a step-tolerance) for
counts, order, frame, and the alive set across TS, C#, and GDScript. Floating quantities use the existing single
tolerance table (A.5); there is no per-runtime tolerance and no off-by-one-step reconciliation, because the EXACT
quantities are integer-exact by construction.

| Quantity | Comparison | Why |
|---|---|---|
| Live count per frame | EXACT | integer step schedule (8.4): fixed-point spawn accumulator + integer `burstStep` + integer recycle. No float threshold on this path. |
| `spawnOrder` set and order | EXACT | integer spawn counter, incremented in the specified batch order (8.4). |
| `frame` (animated index) | EXACT | integer frame arithmetic over `ageSteps`/`lifeSteps` (8.4); no float floor on a boundary. |
| `alive` flag per slot | EXACT | integer recycle event `ageSteps >= lifeSteps` (8.4), not a float `age >= life` compare. |
| `px, py` | epsilon (translation tolerance, A.5) | float Euler accumulation. |
| `rot` | epsilon (basis-class tolerance) | float. |
| `outScale` | epsilon | float (curve output). |
| `outR, outG, outB, outAlpha` | epsilon (color tolerance) | float, bounded 0..1. |

Excluded from the cross-runtime rig set: `anchorSpace: 'screen'` layers (the screen flash). Their solved transform is
a function of viewport size, a non-portable render input, so they cannot be compared across runtimes; they are
covered only by the render-side DoD assertion (12.2 step 6). World-space and bone-anchored layers are fully covered.

Sample-spec follows the committed `sample-spec/<id>.sample-spec.json` pattern: a fixed `simulationDt`, a `from`/`to`
range, and the frame indices to dump. The particle dump is a NEW fixture SHAPE versus skeleton pose fixtures, so
`fixture.schema.json` (conformance WP-V.0) gains a particle-dump variant (per-frame `liveCount` plus per-particle SoA
rows: `alive`, `spawnOrder`, `frame`, `px`, `py`, `rot`, `outScale`, `outR/G/B`, `outAlpha`), validated like every
other fixture; WP-3.10 owns that schema extension. Generated by `runtime-core`, committed, locked by the
fixtures-lock gate (A.6). The reference tier is `high` and the seed is fixed in the spec.

### 8.10 Preset catalog (shipped, committed as `EffectConfig`s)

Each preset is a committed, validated `EffectConfig` in the library, verifiable in the DoD. Key parameters fixed here
so review can check them.

| Preset key | Layers | deterministic | Defining parameters (acceptance-checkable) |
|---|---|---|---|
| `coinBurst` | 1 emitter | true | `spawn.burst count=40`, `gravity.y>0`, `emissionAngle` arc upward (for example 60..120 deg), animated coin spin frames, `angularVelocity` non-zero, `blendMode='normal'`. |
| `coinShowerLarge` | 1 emitter (optional per-particle gold trail) | true | `spawn.rate` high (for example 120/s) over `duration`, `gravity.y>0`, wide `emissionAngle`, `maxParticles` capped (for example 600), animated coin spin, `blendMode='normal'`, `particleTrail` set. |
| `sparkle` | 1 emitter | true | `spawn.rate` low, additive, short `lifetime` (for example 0.2..0.5s), `scaleOverLife` ending at 0, star region. |
| `starBurst` | 1 emitter | true | `spawn.burst`, `blendMode='additive'`, short lifetime, `scaleOverLife` down, radial `emissionAngle` 0..360. |
| `godRaysSprite` | 1 spriteAnimator | true (no draws) | `blendMode='additive'`, `rotationDegPerSec` small (for example 6), `alphaOverLife` pulse, `loop=true`, ray-fan region. DEFAULT god-ray. |
| `godRaysParticle` | 1 emitter | true | additive, low count, long lifetime, slow rotation, thin-ray region. The particle alternative. |
| `glowPulse` | 1 spriteAnimator | true | additive, `scaleOverLife` + `alphaOverLife` pulse, `loop=true`, glow-blob region. |
| `ribbonTrailGold` | 1 ribbonTrail | true | bound to an anchor, `maxSegments` capped, gold ribbon region, `widthOverLength` taper, additive. |
| `screenFlash` | 1 spriteAnimator | true | `anchorSpace='screen'`, 1x1 white region, fast `alphaOverLife` in/out, `layerDuration` short (for example 0.25s). |
| `rayBurst` (composite) | godRaysSprite tuned to a one-shot expanding fan | true | additive, fast initial `rotationDegPerSec` decaying via curves, `loop=false`. Used by the milestone bundle. |
| `megaWin` (bundle) | `coinShowerLarge` + `rayBurst` + `screenFlash` + `glowPulse` | n/a | ordered `startOffset`s; the milestone bundle (section 12). |

---

## 9. Work packages

Each WP is independently verifiable. Format: Goal, Laws touched, Depends on, Tasks, Deliverables, Acceptance criteria
(all testable).

### WP-3.0 Effects sibling format, schema, validator, versioning

- Goal: Land the `EffectsDocument` contract (section 5, 8.1) with JSON Schema and validate-on-import.
- Laws touched: LAW 3 (sibling format, own semver), LAW 4 (our model), LAW 5 (no Phase 4 concepts in the format).
- Depends on: Phase 1 `packages/format` (reuses `BlendMode`, `AtlasRef`, `CurveType`).
- Tasks:
  - TASK-3.0.1 Add the section 8.1 types to `packages/format/src/effects` behind a single barrel `index.ts`. Move
    `BlendMode`, `AtlasRef`, `CurveType` into the frozen shared sub-module `packages/format/src/common`; both
    documents import from `common`. Add `formatCommonVersion = "1.0.0"` and the dual-bump rule (section 8.1).
  - TASK-3.0.2 Author the JSON Schema for `EffectsDocument`, `EffectConfig`, all three layer types, `EffectBundle`.
  - TASK-3.0.3 Runtime validator with typed, discriminated errors carrying a JSON path (for example
    `/effects/coinShowerLarge/layers/0/lifetime/min`). No bare strings, no `catch (e: any)`.
  - TASK-3.0.4 Cross-reference checks: every layer `region`/`regions[]` resolves to an `atlas` region name; every
    `LifeCurve.stops` has `first.t === 0`, `last.t === 1`, strictly increasing `t`; `RangeF.min <= max`;
    `spawn.bursts[].atTime` strictly increasing; `maxParticles >= 1`; `simulationDt > 0`; every `EffectBundle.items`
    `effect` resolves to a defined effect; `anchorRole` is a non-empty string.
  - TASK-3.0.5 Set `effectsFormatVersion = "1.0.0"` and `formatCommonVersion = "1.0.0"`. Add a negative-test corpus
    of malformed `EffectsDocument`s AND malformed `ProjectManifest`s, including a content-hash mismatch and a dangling
    member reference (an artifact listed by the manifest but absent or whose content hash has changed).
  - TASK-3.0.6 `ProjectManifest` type + validator binding skeleton + effects artifacts by content hash (section 5.2);
    detect hash mismatch and dangling members as typed errors.
  - TASK-3.0.7 Identity seam (command-history D2, section 8.1.1): `importEffects` mints `EffectId`/`EffectLayerId`/
    `LifeStopId`/`BundleItemId` from on-disk names/array order via the injected `IdFactory`; `exportEffects` resolves
    IDs back to names and re-emits arrays in preserved order. IDs are never serialized.
- Deliverables: types, the `common` sub-module, schema, validator, negative-test corpus, manifest type, import/export
  identity seam.
- Acceptance criteria:
  - [ ] A hand-written minimal valid `EffectsDocument` (one emitter, one static region) validates with zero errors.
  - [ ] Each malformation in the corpus is rejected with the expected typed error code and JSON path.
  - [ ] A `ProjectManifest` with a content-hash mismatch or a dangling member is rejected with a typed error + path.
  - [ ] `exportEffects(importEffects(x))` deep-equals canonical `x` for the corpus (identity round-trip, D2).
  - [ ] No internal ID (`EffectId` etc.) appears in any serialized `EffectsDocument` (schema/grep assertion).
  - [ ] No `any` and no unjustified `as` in the new `format` code (lint gate).
  - [ ] `SkeletonDocument.formatVersion` is unchanged in the diff (LAW 3 gate); a `common` change dual-bumps both
        document versions (section 8.1 rule, asserted by a version-coupling test).
  - [ ] The effects barrel is the only import surface; deep imports into `effects/*` from outside are lint-rejected.

### WP-3.1 Seeded PRNG and per-particle draw-order spec (runtime-core)

- Goal: The normative integer PRNG and the `drawRange`/draw-order primitives (section 8.3), PixiJS-free.
- Laws touched: LAW 1 (reproducibility primitive), LAW 4 (our own design), INV runtime-core PixiJS-free.
- Depends on: WP-3.0 (`RangeF`).
- Tasks:
  - TASK-3.1.1 Implement `nextU32`, `nextUnit`, `drawRange`, `hash32` with explicit uint32 semantics (section 8.3).
  - TASK-3.1.2 Golden vector test: a fixed seed produces a committed sequence of the first 64 `nextU32` outputs
    (exact). This is the cross-runtime anchor Unity/Godot must match.
  - TASK-3.1.3 `drawRange` consumes zero draws when `min === max`; one draw otherwise (assert via a draw-count probe).
  - TASK-3.1.4 Document the C#/GDScript reimplementation notes inline (masking, `imul` equivalence, logical shifts).
- Deliverables: `prng.ts`, golden-vector fixture, draw-count probe, tests.
- Acceptance criteria:
  - [ ] The first 64 `nextU32(seed=12345)` outputs match the committed golden vector EXACTLY.
  - [ ] `nextUnit` is in `[0,1)` for 1e6 draws and never equals 1.0.
  - [ ] `drawRange` with `min===max` consumes zero draws; with `min<max` consumes exactly one (probe assertion).
  - [ ] No PixiJS import in `runtime-core` (boundary lint).

### WP-3.2 Emitter solve: spawn, integrator, over-life, pooling (runtime-core)

- Goal: The Tier-S emitter simulator (sections 8.2, 8.4, 8.5) writing pooled SoA state, zero per-frame allocation.
- Laws touched: LAW 1 (determinism), LAW 4 (our integrator), INV PixiJS-free, INV pooling/no-alloc.
- Depends on: WP-3.0, WP-3.1, Phase 1 curve sampling.
- Tasks:
  - TASK-3.2.1 `ParticlePool` allocation (section 8.2) sized to `maxParticles`; index free-list; never reallocated.
  - TASK-3.2.2 Spawn schedule for `rate`/`burst`/`bursts` on the integer step clock: fixed-point spawn accumulator,
    integer `burstStep`, integer `emitUntilStep` (section 8.4); cap semantics (skip + zero draws + schedule advances).
    No float accumulation on the count path.
  - TASK-3.2.3 Per-particle initial state from the draw order in section 8.3, including shape-position sampling for
    point/line/circle/rect and area-uniform circle radius via `sqrt(unit)`, and conversion of the drawn `lifetime` to
    integer `lifeSteps = max(1, ceil(lifeSeconds / dt))` (section 8.4).
  - TASK-3.2.4 Semi-implicit Euler with the exact operation order (section 8.4): gravity+accel, drag, integrate
    position, integrate rotation, then derived outputs.
  - TASK-3.2.5 `scaleOverLife`/`colorOverLife`/`alphaOverLife` via the shared `BEZIER_SEGMENTS` sampler (section 8.5).
  - TASK-3.2.6 Animated-frame index resolution for `loop`/`overLife`/`once` (section 8.4), integer output.
  - TASK-3.2.7 Per-particle trail recording (`TrailSpec`) into a pooled ring buffer.
- Deliverables: `emitter-solve.ts`, unit tests, an allocation probe.
- Acceptance criteria:
  - [ ] Same `(config, seed, dt)` produces deep-equal solved state across 1000 repeated runs (determinism).
  - [ ] Live count and `spawnOrder` are integer-exact for a `burst count=40` over a fixed step count.
  - [ ] Recycle is an exact integer-step event: a particle with `lifeSteps=k` is alive for exactly `k` steps then
    recycled on step `k` (assert the exact step of death; no float-threshold off-by-one).
  - [ ] A `rate` emitter's spawned-count sequence is identical when the same run is replayed (integer accumulator),
    and depends only on `spawnPerStepFixed`, not on float accumulation order.
  - [ ] At `liveCount === maxParticles`, a requested spawn is skipped, consumes zero draws, and the schedule advances
    (probe assertion).
  - [ ] Zero heap allocation in `stepOnce` after warmup (allocation probe).
  - [ ] Area-uniform circle spawn: 1e5 sampled positions have radial histogram flat within 2 percent per bin.
  - [ ] A constant `RangeF` (min===max) leaves the PRNG stream position identical to omitting the draw (stream-shift
    regression guard).

### WP-3.3 Sprite-animator and ribbon-trail solve (runtime-core)

- Goal: The Tier-S solve for god rays, glow + pulse, screen flash, and ribbon trails (section 8.6), PixiJS-free.
- Laws touched: LAW 4, INV PixiJS-free, INV pooling/no-alloc.
- Depends on: WP-3.0, WP-3.2 (shared curve eval).
- Tasks:
  - TASK-3.3.1 SpriteAnimator local-time advance, loop/clamp `u`, continuous `rotationDegPerSec`, over-life outputs.
  - TASK-3.3.2 `anchorSpace: 'screen'` produces a viewport-cover transform from a supplied viewport size.
  - TASK-3.3.3 Ribbon ring buffer: record on `segmentSpacing` threshold, drop oldest beyond `maxSegments`.
  - TASK-3.3.4 Ribbon strip geometry: perpendicular offsets by `0.5 * width`, width/color/alpha-over-length sampling.
- Deliverables: `sprite-animator-solve.ts`, `ribbon-solve.ts`, tests.
- Acceptance criteria:
  - [ ] God-ray rotation is continuous and monotonic over time (no wrap discontinuity) for `layerDuration` loops.
  - [ ] Screen-flash transform covers a given viewport rect exactly (corners within 1e-6 after transform).
  - [ ] Ribbon never exceeds `maxSegments` points (hard-cap assertion) and records a new point only after the anchor
    moves >= `segmentSpacing`.
  - [ ] Ribbon geometry is a pure function of a recorded anchor path (deterministic given the path).

### WP-3.4 EffectSystem, trigger API, anchor model, bundles (runtime-core)

- Goal: The instance lifecycle + by-name trigger surface + global budget + bundles (section 8.7, 8.8), PixiJS-free.
- Laws touched: LAW 1 (pure trigger inputs; no outcome feedback), LAW 5 (bundle is presentation-only), INV PixiJS-free.
- Depends on: WP-3.2, WP-3.3.
- Tasks:
  - TASK-3.4.1 `EffectSystem.trigger`/`stop`/`step`/`readState`; instance pool; per-instance fixed-dt accumulator.
  - TASK-3.4.2 By-name effect lookup against the loaded `EffectsDocument`; unknown effect name is a typed error.
  - TASK-3.4.3 Anchor resolution: `world`, `screen`, `bone` (against a skeleton instance world transform), `gridCell`
    resolves to identity in Phase 3 with a documented hook for Phase 4. Normative timing (section 8.4): `step` runs
    after the skeleton world + deform passes and before draw (global slot 5.5), and the anchor is sampled once per
    frame and held constant across all fixed-dt sub-steps.
  - TASK-3.4.4 Global live-particle budget + eviction policy (section 8.8), with a budget-overflow warning channel.
  - TASK-3.4.5 `triggerBundle` expands a bundle into instances with per-item `startOffset`, `anchorRole` lookup, and
    `seedSalt` via `hash32(baseSeed, seedSalt)`.
  - TASK-3.4.6 LAW 1 boundary, AUTOMATED: an import-graph CI gate (mirroring the no-Pixi gate) forbids any
    `runtime-core/effects` module from importing `math-bridge` or any `SpinResult` type. The public surface accepts
    only data inputs; there is no path from particle state back into any outcome type. The gate, not a review note,
    is the enforcement.
- Deliverables: `system.ts`, `bundle.ts`, tests.
- Acceptance criteria:
  - [ ] Triggering `megaWin` expands to exactly its declared items at their `startOffset`s (instance-count + timing
    assertion).
  - [ ] Same `(bundle, baseSeed, anchors)` yields deep-equal solved state across repeated runs (determinism).
  - [ ] Exceeding `MAX_LIVE_PARTICLES` evicts per the specified policy and emits a budget-overflow warning (assert
    eviction order on a constructed overflow).
  - [ ] An unknown effect name returns a typed error, not a throw-with-string or silent no-op.
  - [ ] The import-graph gate rejects any `runtime-core/effects` import of `math-bridge` / a `SpinResult` type (LAW 1).
  - [ ] `'bone'` anchor reads the CURRENT frame transform (step ordered after the skeleton world pass) and is sampled
    once per frame (a multi-sub-step frame uses a single anchor sample), tracking the bone tip within 1e-6.

### WP-3.5 runtime-web particle renderer + blend pipeline reuse

- Goal: Render solved state via pooled PixiJS `ParticleContainer` sprites + mesh ribbons through the existing per-slot
  blend pipeline; use `@pixi/particle-emitter` only as an OPTIONAL render/batch helper fed solved SoA state (section
  7.2), never as a simulator.
- Laws touched: LAW 4 (library is a render helper, not the contract), INV pooling/no-alloc, reuse of Phase 1 blend.
- Depends on: WP-3.4, Phase 1 WP-1.2 (blend pipeline), Phase 1 WP-1.3 (VFX atlas pack).
- Tasks:
  - TASK-3.5.1 Pooled sprite rendering: one `ParticleContainer` per (blendMode) batch; map `BlendMode` to the SAME
    PixiJS blend constants the slot renderer uses (no second mapping).
  - TASK-3.5.2 SoA-to-sprite update: read `out*` buffers each frame, update pooled sprite transforms/tints; no
    per-frame allocation.
  - TASK-3.5.3 Ribbon rendering via a pooled `MeshRope`/strip from the ribbon geometry buffer.
  - TASK-3.5.4 Screen-space rendering for `anchorSpace: 'screen'` (viewport-cover quad).
  - TASK-3.5.5 Ambient path: `deterministic: false` effects are SOLVED by the SAME `runtime-core` path as
    deterministic ones (the only difference is ambient tier count-scaling, section 8.8). `@pixi/particle-emitter`, if
    used, is only a pooled-batch render container fed already-solved SoA state and performs ZERO spawn/integration
    (section 7.2). There is no config-to-pixi-simulator adapter, because pixi never simulates; the renderer consumes
    the SoA buffers identically for both effect kinds.
  - TASK-3.5.6 The editor viewport and `runtime-web` share the identical render path (viewport adds overlays only).
- Deliverables: `runtime-web` particle renderer, ribbon renderer, optional pixi-emitter batch helper, tests.
- Acceptance criteria:
  - [ ] The four blend modes map to the SAME PixiJS constants as the Phase 1 slot renderer (assert by importing both).
  - [ ] An additive layer renders measurably brighter than the same layer in normal mode at overlapping particles
    (offscreen pixel sample: additive sum > normal at the overlap region).
  - [ ] Zero per-frame heap allocation in the renderer after warmup (allocation probe).
  - [ ] Editor viewport and `runtime-web` call the identical render module (import-graph assertion).
  - [ ] A 600-particle emitter renders at < 16ms p95 solve+render on the acceptance rig (CI-hardware relative gate).

### WP-3.6 Particle designer panel + live preview

- Goal: The authoring UI: emitter/sprite/ribbon controls, over-life curve editing (reusing Phase 1 curve editor),
  live preview in the viewport, all edits as commands.
- Laws touched: LAW 2 (edits are commands), INV editor state vs document state, reuse of Phase 1 curve editor.
- Depends on: WP-3.5, WP-3.7, Phase 1 WP-1.7 (curve editor).
- Tasks:
  - TASK-3.6.1 New dockview panel under `apps/editor/.../modules/particles` with its own barrel.
  - TASK-3.6.2 Controls for every `EmitterLayer`/`SpriteAnimatorLayer`/`RibbonTrailLayer` field; numeric inputs and
    range (min/max) inputs; shape and spawn-mode selectors; texture/animated-frames picker bound to the VFX atlas.
  - TASK-3.6.3 Over-life curve editor reuses the Phase 1 bezier curve editor and the SAME `BEZIER_SEGMENTS` preview
    sampling, so what the author sees equals what `runtime-core` solves (no second math path).
  - TASK-3.6.4 Live preview: instantiate the active effect via `EffectSystem` at `preview.anchor` with `preview.seed`
    and `preview.qualityTier`; transport play/pause/loop drives `preview.time`; a stats HUD shows live count and pool
    high-water when `preview.showStats`.
  - TASK-3.6.5 All field edits route through WP-3.7 commands; drag edits coalesce within the 250ms window.
  - TASK-3.6.6 Editor-state-only fields (section 6) live in Zustand; a review/test asserts none are in the document.
- Deliverables: particles panel, preview wiring, Zustand store slice.
- Acceptance criteria:
  - [ ] Editing any emitter field updates the live preview within one frame and creates exactly one (coalesced) undo
    entry per drag.
  - [ ] The curve-editor preview and `runtime-core` over-life evaluation agree at 100 sample points within 1e-6
    (shared sampler, asserted in a test importing both).
  - [ ] Scrubbing/playing the preview never writes to history (history length unchanged across a scrub).
  - [ ] Changing `preview.qualityTier` does NOT change a deterministic effect's particle count (section 7.3 assertion).
  - [ ] No preview/editor-state field appears in the serialized document (round-trip assertion).

### WP-3.7 Effect-editing commands + History integration

- Goal: All effect-library mutations as commands with mandatory do/undo round-trip tests. Every command addresses its
  target(s) by internal ID (`EffectId`/`EffectLayerId`/`LifeStopId`/`BundleItemId`, section 8.1.1), never by name or
  array index.
- Laws touched: LAW 2.
- Depends on: WP-3.0, Phase 1 History.
- Tasks:
  - TASK-3.7.1 Commands: `CreateEffect`, `DeleteEffect`, `RenameEffect`, `SetEffectMeta` (duration/deterministic/dt),
    `SetEffectsAtlas` (sets `EffectsDocument.atlas` after the VFX pack; mirrors Phase 1 `SetAtlasRef`).
  - TASK-3.7.2 Layer commands: `AddLayer`, `RemoveLayer`, `ReorderLayers`, `SetLayerField` (parametric, coalescing),
    `SetLayerBlendMode`. Reorders pass an ordered `EffectLayerId[]`; removes target an `EffectLayerId`.
  - TASK-3.7.3 Curve commands: `AddLifeStop`, `RemoveLifeStop`, `MoveLifeStop`, `SetLifeStopValue`,
    `SetLifeStopCurve` (target a `LifeStopId`; reuse the Phase 1 curve-edit command shape where possible).
  - TASK-3.7.4 Bundle commands: `CreateBundle`, `DeleteBundle`, `AddBundleItem`, `RemoveBundleItem`,
    `ReorderBundleItems`, `SetBundleItem` (item fields effect/startOffset/anchorRole/seedSalt; items target a
    `BundleItemId`, and `effect` is stored as an `EffectId`).
  - TASK-3.7.5 Typed-error guards: unique effect/bundle names (export-only contract, advisory in the editor); a
    `LifeCurve` cannot drop below 2 stops or violate `first.t===0`/`last.t===1`; reject removing the last stop pair.
  - TASK-3.7.6 Effect commands share the SAME `History` as skeleton commands (one project undo stack).
  - TASK-3.7.7 After `SetEffectsAtlas`, re-run the WP-3.0 cross-reference check so layer `region`/`regions[]` that no
    longer resolve in the new atlas surface as typed errors (the same validation import performs); a changed atlas
    cannot silently leave dangling region references.
- Deliverables: commands + the mandatory round-trip tests + the command registry (section 10).
- Acceptance criteria:
  - [ ] do/undo round-trip deep-equals the prior document for EVERY command (mandatory, LAW 2).
  - [ ] A 40-step `SetLayerField` drag collapses to one undo entry.
  - [ ] Renaming an effect leaves all bundle-item references intact (they hold an `EffectId`, not the name), and a
    duplicate name is surfaced only by the export/advisory check, not by a mid-edit throw (section 8.1.1).
  - [ ] Every command targets entities by `EffectId`/`EffectLayerId`/`LifeStopId`/`BundleItemId`, never by name or
    array index (type-level + review assertion); `ReorderLayers` survives an interleaved rename in the redo stack.
  - [ ] `SetEffectsAtlas` to an atlas missing a referenced region is rejected with a typed dangling-region error.
  - [ ] Undo/redo interleaves cleanly with skeleton commands on the shared stack (mixed-sequence test).
  - [ ] No `DocumentModel` mutation occurs outside a command (commands-only lint + presence test per command).

### WP-3.8 Preset library (the shipped effects)

- Goal: Author and commit the section 8.10 presets as valid `EffectConfig`s plus the `megaWin` bundle.
- Laws touched: LAW 1 (presets carry no outcome logic), LAW 5 (no slot/win concepts).
- Depends on: WP-3.0 through WP-3.5, the VFX atlas (Phase 1 pack).
- Tasks:
  - TASK-3.8.1 Author each preset in section 8.10 with the specified defining parameters; commit under
    `packages/conformance` fixtures or a shared `assets/effects` library (single location, referenced by the DoD).
  - TASK-3.8.2 Pack the VFX atlas (coin spin frames, star, ray-fan, glow blob, ribbon, 1x1 white) via the Phase 1
    pipeline; commit the atlas + `AtlasRef`.
  - TASK-3.8.3 Provide `godRaysSprite` AND `godRaysParticle` (both approaches, section 7.5).
  - TASK-3.8.4 Define the `megaWin` bundle = `coinShowerLarge` + `rayBurst` + `screenFlash` + `glowPulse` with
    `startOffset`s and `anchorRole`s.
- Deliverables: committed preset `EffectsDocument`, VFX atlas, the `megaWin` bundle.
- Acceptance criteria:
  - [ ] Every preset validates against the WP-3.0 schema with zero errors.
  - [ ] `coinShowerLarge` particles fall (mean `vy` increases over life under positive gravity) and spin
    (`angularVelocity != 0`), with `liveCount <= maxParticles` at all times.
  - [ ] `starBurst` is additive, short-lived, and `outScale` reaches 0 by end of life (assert at `u=1`).
  - [ ] `godRaysSprite` rotates (rotation strictly increasing) and pulses (alpha non-constant over the loop).
  - [ ] `screenFlash` covers the viewport and its alpha returns to 0 by `layerDuration` (no residual flash).
  - [ ] No preset references any symbol, grid, reel, or win field (LAW 5 grep check).

### WP-3.9 Mobile particle-perf mitigations + gates

- Goal: Implement caps, the global budget, pooling discipline, ambient quality tiers, and the CI pool/alloc gates.
- Laws touched: INV 60fps/pooling/no per-frame alloc, LAW 1 (tier scaling never touches deterministic effects).
- Depends on: WP-3.2, WP-3.4, WP-3.5; conformance C.4 / WP-V.8.
- Tasks:
  - TASK-3.9.1 Enforce per-emitter `maxParticles` and the global `MAX_LIVE_PARTICLES` with the section 8.8 eviction
    policy.
  - TASK-3.9.2 Quality-tier multipliers applied to AMBIENT effects only; deterministic effects pinned to authored
    counts (section 7.3).
  - TASK-3.9.3 Particle pool gate (conformance C.4): emit and recycle K particles, assert bounded pool high-water and
    zero per-particle allocation after warmup.
  - TASK-3.9.4 Per-frame allocation gate for `step` + render (INV); commit a perf baseline (`perf/baseline.json`).
  - TASK-3.9.5 Document the explicit deferral: real device-tier budget tuning is Phase 5 (handoff risk register); the
    caps and budget here are conservative defaults, not final tuned values.
- Deliverables: cap/budget enforcement, tier scaling, pool/alloc gates, perf baseline.
- Acceptance criteria:
  - [ ] No emitter ever exceeds its `maxParticles` and the scene never exceeds `MAX_LIVE_PARTICLES` (stress test with
    over-spawning emitters).
  - [ ] Pool high-water is bounded and there is zero per-particle allocation after warmup (pool gate green).
  - [ ] `step` + render allocate below the committed per-frame byte threshold (alloc gate green).
  - [ ] Setting tier `low` reduces ambient particle counts to the `0.4` multiplier and leaves deterministic counts
    unchanged (assertion on a mixed scene).

### WP-3.10 Particle conformance fixtures + harness extension

- Goal: Generate, commit, and lock particle fixtures from `runtime-core`; extend the harness comparison (section 8.9).
- Laws touched: INV conformance generated from runtime-core, LAW 1 (locks deterministic behavior).
- Depends on: WP-3.2, WP-3.3, WP-3.4; conformance contract A (WP-V.0/.1/.2/.3).
- Tasks:
  - TASK-3.10.1 Add particle reference rigs to the conformance catalog (WP-V.1): at minimum a `coin-burst` emitter, a
    `circle-spawn` emitter, a `god-rays-sprite` layer, and a `ribbon-trail` layer.
  - TASK-3.10.2 Extend the fixture generator (WP-V.2) to dump per-frame per-particle state at the reference tier
    `high` and a fixed seed, per the section 8.9 schema.
  - TASK-3.10.3 Extend the comparison engine to split exact (integer) vs epsilon (float) quantities per section 8.9;
    add the particle rows to the single tolerance table (`compare/tolerance.ts`), do not create a second table.
  - TASK-3.10.4 Wire into the fixtures-lock CI gate (A.6): regenerating differs => fail unless a reviewed regeneration.
  - TASK-3.10.5 Document the C#/GDScript reimplementation entry points so the Phase 5 native runtimes meet these exact
    fixtures.
  - TASK-3.10.6 Extend `fixture.schema.json` (conformance WP-V.0) with the particle-dump variant (per-frame
    `liveCount` plus per-particle SoA rows: `alive`, `spawnOrder`, `frame`, `px`, `py`, `rot`, `outScale`, `outR/G/B`,
    `outAlpha`); validate every committed particle fixture against it (a fixture failing its schema fails CI). World
    and bone anchors only; `anchorSpace: 'screen'` layers are excluded from the rig set (section 8.9).
- Deliverables: particle rigs, sample-specs, the `fixture.schema.json` particle-dump variant, committed fixtures,
  lock manifest, harness/comparison extension.
- Acceptance criteria:
  - [ ] `runtime-core` reproduces every committed particle fixture: integer quantities EXACT, float quantities within
    the tolerance table.
  - [ ] Every committed particle fixture validates against the extended `fixture.schema.json` (schema gate).
  - [ ] The golden PRNG vector (WP-3.1) is referenced by at least one fixture so the integer stream is locked.
  - [ ] Editing emitter solve behavior without regenerating fixtures fails CI (drift guard).
  - [ ] The tolerance table has exactly one location; particle rows added there, no per-runtime tolerance.

### WP-3.11 Phase 3 Definition-of-Done acceptance harness

- Goal: Automate the milestone proof (section 12): author the `megaWin` bundle, trigger by name, assert editor /
  `runtime-web` AGREEMENT (a wiring check, since both embed the identical `runtime-core` solve and render module per
  TASK-3.5.6), plus perf, determinism, caps, and blend assertions. The CROSS-runtime determinism guarantee is carried
  by the committed WP-3.10 fixtures and proven against native Unity/Godot in Phase 5, not by this in-TS step.
- Laws touched: LAW 1 (determinism, locked by fixtures), LAW 5 (milestone artifact).
- Depends on: all prior WPs.
- Tasks:
  - TASK-3.11.1 Build the acceptance scene: a world anchor (and a `bone` anchor on a Phase 1 skeleton instance for the
    ribbon), the committed VFX atlas, and the `megaWin` bundle.
  - TASK-3.11.2 Export the effects artifact; assert it passes the WP-3.0 JSON Schema before playback (fail loudly).
  - TASK-3.11.3 Transform/state parity: step both the editor's `runtime-core` path and `runtime-web`'s at fixed
    `simulationDt`; assert integer quantities exact and float quantities within tolerance at the sampled frames.
  - TASK-3.11.4 Determinism: run the bundle twice with the same `(seed, tier=high)`; assert identical solved state.
  - TASK-3.11.5 Caps + perf: assert `maxParticles`/`MAX_LIVE_PARTICLES` never exceeded, p95 solve+render < 16ms over
    a 600-frame run, zero per-frame allocation after warmup.
  - TASK-3.11.6 Blend + flash: offscreen-render a frame; assert the additive ray layer is brighter than a normal
    control and the screen flash covers the viewport at its peak, returning to 0 by `layerDuration`.
  - TASK-3.11.7 Wire as a CI job gated on Phase 3.
- Deliverables: acceptance harness, CI job, committed acceptance scene.
- Acceptance criteria: see section 12 (the full DoD script). The CI job is green.

---

## 10. Command registry summary (LAW 2 enforcement)

Reviewer rule (restated): a PR that mutates `DocumentModel` outside a `Command` is rejected. Every command below
ships with a mandatory do/undo round-trip test (deep-equal prior state). Coalesces = merges within the 250ms window.
Every command addresses its target(s) by internal ID (`EffectId`/`EffectLayerId`/`LifeStopId`/`BundleItemId`,
section 8.1.1), never by name or array index: `ReorderLayers`/`ReorderBundleItems` take ordered ID arrays,
`MoveLifeStop`/`RemoveLifeStop` target a `LifeStopId`, and `SetBundleItem` stores `effect` as an `EffectId`.

| Command | WP | Coalesces | Notes / typed-error guards |
|---|---|---|---|
| `CreateEffect` | WP-3.7 | N | Unique name. |
| `DeleteEffect` | WP-3.7 | N | Targets an `EffectId`; cascades removal of bundle items referencing it (composite, single undo). |
| `RenameEffect` | WP-3.7 | N | Targets an `EffectId`; sets the mutable name. ZERO cascade: bundle items reference the `EffectId`, not the name. Uniqueness is export-only. |
| `SetEffectMeta` | WP-3.7 | N | duration / deterministic / simulationDt; `simulationDt > 0`. |
| `AddLayer` | WP-3.7 | N | emitter / spriteAnimator / ribbonTrail. |
| `RemoveLayer` | WP-3.7 | N | |
| `ReorderLayers` | WP-3.7 | N | Z within the effect. |
| `SetLayerField` | WP-3.7 | Y | Parametric numeric/range/enum field set. |
| `SetLayerBlendMode` | WP-3.7 | N | Reuses format `BlendMode`. |
| `AddLifeStop` | WP-3.7 | N | Keeps `t` strictly increasing. |
| `RemoveLifeStop` | WP-3.7 | N | Rejects dropping below 2 stops or removing the t=0/t=1 anchors. |
| `MoveLifeStop` | WP-3.7 | Y | Keeps order; clamps interior `t` in (0,1). |
| `SetLifeStopValue` | WP-3.7 | Y | |
| `SetLifeStopCurve` | WP-3.7 | Y | linear/stepped/bezier (reuses Phase 1 `CurveType`). |
| `CreateBundle` | WP-3.7 | N | Unique name. |
| `DeleteBundle` | WP-3.7 | N | |
| `AddBundleItem` | WP-3.7 | N | `effect` must resolve. |
| `RemoveBundleItem` | WP-3.7 | N | |
| `ReorderBundleItems` | WP-3.7 | N | |
| `SetBundleItem` | WP-3.7 | Y | effect / startOffset / anchorRole / seedSalt. |
| `SetEffectsAtlas` | WP-3.7 | N | Sets `EffectsDocument.atlas` after the VFX pack (mirrors Phase 1 `SetAtlasRef`). Re-runs the cross-reference check; dangling `region`/`regions[]` are typed errors (TASK-3.7.7). |

All effect commands use the SAME `History` as the skeleton commands (one project undo stack). There is no separate,
non-command mutation path for effects.

---

## 11. Sequencing and critical path

### 11.1 Dependency graph

```
WP-3.0 (effects format) ─┬─► WP-3.1 (prng) ─► WP-3.2 (emitter solve) ─┬─► WP-3.4 (system+triggers) ─► WP-3.5 (web render) ─┐
                         │                                            │                                                     │
                         └────────────────────► WP-3.3 (sprite+ribbon)┘                                                     │
WP-3.0 ─► WP-3.7 (commands) ─► WP-3.6 (designer + preview) ───────────────────────────────────────────────────────────────┤
WP-3.2 + WP-3.3 + WP-3.4 ─► WP-3.10 (conformance fixtures)                                                                  │
WP-3.2 + WP-3.4 + WP-3.5 ─► WP-3.9 (perf caps + gates)                                                                      │
WP-3.0..3.5 ─► WP-3.8 (presets + megaWin bundle) ──────────────────────────────────────────────────────────────────► WP-3.11 (DoD)
```

### 11.2 Recommended build order (one logical change per branch, milestone-gated)

1. WP-3.0 effects format (contract first, like Phase 1's format-first discipline).
2. WP-3.1 PRNG (lock the integer stream with the golden vector immediately).
3. WP-3.2 emitter solve.
4. WP-3.3 sprite-animator + ribbon solve.
5. WP-3.4 EffectSystem + triggers + bundles.
6. WP-3.10 conformance fixtures (lock solve behavior right after WP-3.2 through WP-3.4, before UI builds on it).
7. WP-3.5 runtime-web renderer + blend reuse.
8. WP-3.7 effect commands.
9. WP-3.6 designer panel + live preview.
10. WP-3.9 perf caps + gates.
11. WP-3.8 preset library + megaWin bundle.
12. WP-3.11 DoD acceptance harness.

Lock WP-3.1/3.2/3.3/3.4 with WP-3.10 before building the designer so the UI is authored against a frozen solve.

### 11.3 Critical path

WP-3.0 -> WP-3.2 -> WP-3.4 -> WP-3.5 -> WP-3.8 -> WP-3.11. The designer panel (WP-3.6) is the UI schedule risk; keep
it to the minimum field set in section 8.1 and reuse the Phase 1 curve editor rather than building a second one.

---

## 12. Definition of Done: acceptance script (the gate)

All steps must pass on CI and locally. This is the literal proof of the milestone.

### 12.1 Authoring proof (manual, recorded once)

1. Open a project with a Phase 1 skeleton. Pack the VFX atlas (Phase 1 pipeline). Confirm `AtlasRef` + PNG pages.
2. In the particles panel, author `coinShowerLarge` (gravity-driven coins, spawn arc, spin), `rayBurst` (additive
   rotating ray fan), `screenFlash` (screen-space alpha pulse), and `glowPulse`. Edit at least one over-life curve via
   the curve editor.
3. Create the `megaWin` bundle referencing those effects BY NAME with `startOffset`s.
4. Preview the bundle at a world anchor and at a `bone` anchor (the ribbon follows the bone tip). Confirm it reads as
   a big-win moment: coins shower and spin, rays burst additively, the screen flashes, the glow pulses.
5. Save and reload the project; confirm the effects document is deep-equal (no loss) and undo/redo across the whole
   session (skeleton + effect edits on one stack) is clean.

### 12.2 Determinism, parity, perf proof (automated, gating, WP-3.11)

```
pnpm conformance:particles      # WP-3.10: runtime-core matches committed particle fixtures (int exact, float epsilon)
pnpm phase3:acceptance          # WP-3.11: editor preview vs runtime-web parity on the megaWin bundle
```

`pnpm phase3:acceptance` performs:

1. Export the effects artifact + VFX atlas; assert the export passes the WP-3.0 JSON Schema (a corrupted export fails
   loudly, negative test).
2. State agreement: step the `megaWin` bundle at fixed `simulationDt` in the editor's `runtime-core` path and in
   `runtime-web`'s; assert integer quantities (live count, `spawnOrder`, `frame`, `alive`) EXACT and float quantities
   (`px,py,rot,outScale,outR,outG,outB,outAlpha`) within the tolerance table at the sampled frames. Scope note:
   editor and `runtime-web` share the IDENTICAL `runtime-core` solve and render module (TASK-3.5.6), so this step is
   a wiring/integration check that the two embeddings agree, NOT a cross-implementation parity proof. The real
   cross-runtime determinism guarantee is carried by the committed fixtures (WP-3.10) and proven against the native
   Unity/Godot runtimes in Phase 5.
3. Determinism: run twice with the same `(seed, tier=high)`; assert byte-identical solved state.
4. Caps: assert no emitter exceeds `maxParticles` and the scene never exceeds `MAX_LIVE_PARTICLES`.
5. Performance: assert solve+render p95 < 16ms over a 600-frame run, and zero per-frame allocation after warmup.
6. Blend + flash: offscreen-render the peak frame; assert the additive ray layer is brighter than a normal control at
   the overlap region, and the screen flash covers the viewport at peak and returns to alpha 0 by `layerDuration`.

### 12.3 Gate checklist

- [ ] WP-3.0 to WP-3.11 acceptance criteria all green.
- [ ] Every effect command (section 10) has a passing do/undo round-trip test; effect + skeleton edits share one
      undo stack and interleave cleanly.
- [ ] The PRNG golden vector and all particle conformance fixtures pass (integer exact, float within tolerance) and
      are committed + locked.
- [ ] `phase3:acceptance` parity passes (integer exact, float epsilon), determinism is byte-identical at tier `high`,
      caps hold, p95 < 16ms, zero per-frame allocation.
- [ ] `SkeletonDocument.formatVersion` unchanged; `effectsFormatVersion = "1.0.0"`; the effects validator rejects the
      full negative-test corpus.
- [ ] No PixiJS import in `runtime-core` (emitter/sprite/ribbon/system solve are renderer-free); no `any`/unjustified
      `as` in `format` or `runtime-core`.
- [ ] Quality-tier scaling changes ambient counts only; deterministic effects run at authored counts (section 7.3
      assertion green).
- [ ] No preset or bundle references any symbol/grid/reel/win field (LAW 5 grep green); the LAW 1 import-graph gate
      is green (no `runtime-core/effects` import of `math-bridge` or any `SpinResult` type).
- [ ] CI green: lint, typecheck, unit, conformance (skeleton + particle), perf-gates, acceptance. No em-dashes.

When 12.3 is fully checked, Phase 3 is done and Phase 4 may begin (LAW 5).

---

## 13. Risks and mitigations (Phase 3 specific)

| ID | Risk | Severity | Mitigation (decision of record) |
|---|---|---|---|
| R3.1 | Particle perf tanks on mobile (the handoff's named medium risk) | High | Caps + global budget + aggressive pooling + ambient quality tiers shipped NOW (WP-3.9), even though device tuning is Phase 5. Pool/alloc CI gates from this phase. Conservative default caps documented as not-yet-final. |
| R3.2 | `@pixi/particle-emitter` becomes the de-facto contract and breaks portability/determinism | High | Section 7.2 decision: it is a render-side batch helper fed already-solved SoA state, with ZERO spawn/integration, for BOTH deterministic and ambient effects (one `runtime-core` solve covers both). The portable contract is OUR `EmitterConfig`; the source of truth is the `runtime-core` solve. Boundary lint keeps PixiJS out of `runtime-core`. |
| R3.3 | Particle non-determinism breaks LAW 1 where the slot layer needs replay | High | Normative integer PRNG (WP-3.1, golden vector), fixed-dt integrator (WP-3.2), specified draw order and cap semantics (section 8.3/8.4), seed from the trigger. Reproducibility is exact for integer quantities and within epsilon for float, at a fixed quality tier. |
| R3.4 | Quality-tier scaling silently breaks conformance / replay | High | Tier scaling applies to ambient (`deterministic:false`) effects ONLY; deterministic effects pinned to authored counts (section 7.3). Conformance generated at the reference tier `high`. Asserted in WP-3.6 and WP-3.9. |
| R3.5 | Float drift makes cross-runtime particle parity flaky | Medium | Counts, spawn order, frame, and the alive set are made integer-portable by the integer step schedule (section 8.4): a fixed-point spawn accumulator, an integer `burstStep`, integer frame arithmetic, and the integer recycle test `ageSteps >= lifeSteps`. They are NOT float-threshold crossings, so they are compared EXACT; positions/colors use the single tolerance table (no per-runtime epsilon, no off-by-one-step reconciliation). Integer keys catch the real bugs; epsilon absorbs f64 reordering on the float path only. |
| R3.6 | Curve eval diverges between designer preview and runtime | Medium | One sampler: over-life curves reuse the Phase 1 `BEZIER_SEGMENTS=10` sampling in `runtime-core`, the curve editor, and `runtime-web` (WP-3.5/3.6). Asserted at 100 sample points within 1e-6. |
| R3.7 | Per-frame allocation in the hot loop kills 60fps | Medium | Structure-of-arrays pools, index free-lists, ribbon ring buffers, pooled `ParticleContainer` sprites; allocation probes in WP-3.2/3.5 and the alloc gate in WP-3.9. |
| R3.8 | Effects format churn forces skeletal-format major bumps | Medium | Sibling format with its own `effectsFormatVersion` (section 5). The skeletal contract is untouched; effects iterate on their own semver line. |
| R3.9 | Designer panel scope balloons | Medium | Build the minimum field set in section 8.1; reuse the Phase 1 curve editor; defer noise/vortex/sub-emitters/collision (section 4.2). A WP-3.6 PR adding deferred features is rejected. |
| R3.10 | Phase 4 concepts leak into the effects layer | Medium | Effects carry no grid/symbol/reel/win logic; the bundle is presentation-only; the trigger takes pure data (LAW 1/LAW 5). LAW 5 grep gate plus the automated LAW 1 import-graph gate (no `runtime-core/effects` import of `math-bridge`/`SpinResult`) in WP-3.4 and gate 12.3. |
| R3.11 | God-ray shader path makes runtimes diverge | Low | The shader path is web-only, advisory, off by default, and excluded from conformance; the sprite path is the default contract and degrades cleanly (section 7.5). |

---

## 14. Sign-off

This plan is approved when a senior reviewer confirms:

- [ ] Every WP-3.x has testable acceptance criteria and a clear owner.
- [ ] The serialization decision (sibling `EffectsDocument`, section 5) is accepted under LAW 3, with the skeletal
      format unchanged.
- [ ] The emitter evaluation semantics (section 8: PRNG, draw order, integrator, over-life, sprite/ribbon, system) are
      specified precisely enough to reimplement in C# and GDScript for Phase 5.
- [ ] Determinism and the quality-tier rule (section 7.3) honor LAW 1, the EXACT conformance quantities are
      integer-portable by the section 8.4 step schedule (not float-threshold crossings), and the role of
      `@pixi/particle-emitter` (section 7.2: render/batch helper, zero spawn/integration) honors LAW 4 and INV
      runtime-core-PixiJS-free.
- [ ] The particle step's place in the global per-frame solve order (after world + deform, before draw) and the
      once-per-frame anchor sampling cadence (section 8.4) are specified and enforceable on every runtime.
- [ ] Effect entities have internal branded IDs minted at import and resolved at export (command-history D2, section
      8.1.1); every section-10 command addresses targets by ID, and the identity round-trip holds.
- [ ] The shared primitive sub-contract (`packages/format/src/common`, section 8.1) and its dual-bump rule are
      accepted, so the section 5 independence claim is exactly scoped.
- [ ] The new-command set (section 10) is complete, each carries a mandatory round-trip test (LAW 2), and effects
      share the project undo stack.
- [ ] The particle conformance fixtures (section 8.9, WP-3.10) are specified precisely enough to generate and lock,
      and extend (not fork) the single tolerance table.
- [ ] The DoD acceptance script (section 12) is runnable and gates CI.
- [ ] No law or invariant in section 3 is violated, and all deferrals (section 4.2) are explicit.

Reviewer: ______________________  Date: ____________
