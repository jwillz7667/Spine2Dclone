// Reference-rig registry (conformance-and-ci.md A.2, WP-V.1). The ordered RIG_IDS plus the RIG_PHASE
// map drive the landed-rig gating (B.2): the generator and the harness run exactly the rigs whose
// RIG_PHASE is at or below CONFORMANCE_PHASE, so a rig whose solve features do not exist yet is never
// generated or asserted. Phase 1 lands only `rig-2bone` (phase-1-bone-puppet.md WP-1.12); the
// remaining ten rigs land in Phase 2 (conformance A.2 catalog) and extend this list.
//
// Provenance (L4): every rig is authored by us from first principles. No rig contains Spine-derived
// data, no Spine runtime source is copied, and our format is our own (CLAUDE.md Law 4). `rig-2bone`
// is two bones and a hand-written animation; it is a unit test in skeleton form, not a production rig.

// Phase 1 lands `rig-2bone`. Phase 2 (WP-2.10) lands six fixture families (conformance A.2 catalog),
// each isolating one solve path plus the minimum to lock solve order: a rigid (unweighted) mesh on a
// moving bone (FIX-2.RM), a weighted mesh on two bones (FIX-2.W), a one-bone IK with a mix ramp
// (FIX-2.IK1), a two-bone IK with both bend directions and unreachable frames (FIX-2.IK2), a transform
// constraint plus an IK on a related bone to lock IK-then-transform order (FIX-2.TC), and a weighted mesh
// with a deform timeline to lock skin-then-deform order (FIX-2.DF).
// PP-B1 (pro-parity Stage 0) lands two more Phase-2 skeleton rigs that make solve branches the current
// fixture schema already observes visible to conformance: `rig-transform-modes` (all five bone transform
// modes under a rotated, non-uniformly-scaled, reflected animated parent, so every worldFromParentByMode
// branch is exercised, A.2) and `rig-blendmodes` (the four slot blend modes plus slot color animation,
// so solve-order step 6 is observable, A.2). Both are authored from first principles (Law 4).
// PP-B4 (pro-parity Stage F1, ADR-0008, format 0.3.0) lands two more skeleton rigs whose solve features
// (draw-order application and event firing) exist as of PP-B4: `rig-events-draworder` (draw-order keys
// that reorder slots mid-clip plus event keys with resolved payloads, captured as the integer draw-order
// lane and the fired-event log) and `rig-events-loop` (events positioned to exercise loop-crossing fire,
// including a key exactly at the loop point). Both are authored from first principles (Law 4).
export const RIG_IDS = [
  'rig-2bone',
  'rig-rigid-mesh',
  'rig-weighted-mesh',
  'rig-one-bone-ik',
  'rig-two-bone-ik',
  'rig-transform-constraint',
  'rig-deform',
  'rig-transform-modes',
  'rig-blendmodes',
  'rig-events-draworder',
  'rig-events-loop',
  // PP-B5 (pro-parity Stage F2, ADR-0009 + ADR-0010, format 0.4.0) skeleton rigs whose solve features
  // (IK constraint depth and explicit constraint order) exist as of PP-B5. `rig-ik-depth` exercises
  // softness, uniform and non-uniform stretch, and compress on one- and two-bone chains (plus a keyed
  // softness channel); `rig-constraint-order` schedules a transform constraint before an IK constraint on
  // a dependent bone, an interleaving that provably differs from the default IK-then-transform order.
  // Both observe only the existing bone-world-affine lane, so no fixture schema change is needed. Authored
  // from first principles (Law 4).
  'rig-ik-depth',
  'rig-constraint-order',
  // PP-B5 slice 2 (ADR-0010 section 3): the four transform-constraint variants (world/local space x
  // absolute/relative composition), one constrained bone per variant under a rotated parent so the local
  // and world results provably differ. Observes only the bone world-affine lane. Authored first-principles.
  'rig-transform-variants',
  // PP-B5 slice 4 (ADR-0011 section 1): a linked mesh reusing a parent mesh's geometry, with both
  // `timelines` values (a shared-deform link that tracks the parent, and an own-deform link that
  // diverges). Observed on the existing mesh-vertex lane. Authored first-principles.
  'rig-linked-mesh',
  // PP-B5 slice 5 (ADR-0011 section 2): sequence-attachment frame resolution across all seven playback
  // modes (hold/once/loop/pingpong plus the three reverses) and the setup-frame fallback, captured on a
  // new EXACT-integer sequence-frame lane. Authored first-principles.
  'rig-sequences',
  // PP-B5 slice 6 (ADR-0011 section 3): per-component split bone tracks (translateX/Y, scaleX/Y,
  // shearX/Y), split rgb/alpha slot color, and a keyable two-color dark tint (a new dark-color lane on the
  // slot capture). Authored first-principles.
  'rig-split-tracks',
  // PP-B5 slice 7 (ADR-0011 section 4): skin-scoped constraints. A transform constraint scoped to skin
  // "gold" solves only when that skin is active; an unscoped one always solves. Sampled under active skin
  // null (scoped off) vs "gold" (scoped on) via the sample-spec activeSkins knob. Authored first-principles.
  'rig-skin-scoped',
  // PP-B2 (pro-parity Stage 0, ADR-0012) non-drawing geometry-attachment rigs. `rig-clipping` animates a clip
  // bone (moving the world clip polygon) that ends at a slot carrying a deforming mesh, so the new clip lane
  // (world polygon on the VERTEX class + clipped-slot set EXACT) is captured alongside the existing mesh lane.
  // `rig-hit-point` carries bounding boxes and points on animated bones, capturing box world vertices +
  // per-probe hit booleans and point world x/y/rotation. Both observe only new opt-in capture lanes, so every
  // prior fixture regenerates byte-identical. Authored first-principles (Law 4).
  'rig-clipping',
  'rig-hit-point',
] as const;

export type RigId = (typeof RIG_IDS)[number];

// Phase in which each rig's fixture is committed and its solve features exist (conformance A.2 Lands
// column). The harness/generator gate on `RIG_PHASE[id] <= CONFORMANCE_PHASE`.
export const RIG_PHASE: Readonly<Record<RigId, number>> = {
  'rig-2bone': 1,
  'rig-rigid-mesh': 2,
  'rig-weighted-mesh': 2,
  'rig-one-bone-ik': 2,
  'rig-two-bone-ik': 2,
  'rig-transform-constraint': 2,
  'rig-deform': 2,
  'rig-transform-modes': 2,
  'rig-blendmodes': 2,
  // PP-B4 skeleton rigs: the draw-order and event-firing solve features land now (Stage F1), and these
  // rigs are ordinary skeletons in the phase-2 catalog track, so they gate at the current phase like the
  // PP-B1 additions above (the RIG_PHASE gate models "the rig's solve features exist", satisfied here).
  'rig-events-draworder': 2,
  'rig-events-loop': 2,
  // PP-B5 skeleton rigs: the IK-depth and constraint-order solve features land now (Stage F2). Like the
  // PP-B1/PP-B4 additions above, they are ordinary skeletons in the phase-2 catalog track and gate at the
  // current phase (the RIG_PHASE gate models "the rig's solve features exist", satisfied here).
  'rig-ik-depth': 2,
  'rig-constraint-order': 2,
  'rig-transform-variants': 2,
  'rig-linked-mesh': 2,
  'rig-sequences': 2,
  'rig-split-tracks': 2,
  'rig-skin-scoped': 2,
  // PP-B2 geometry-attachment rigs: the clipping/bounding-box/point solve features land now (Stage 0). Like
  // the other PP additions they are ordinary skeletons in the phase-2 catalog track and gate at the current
  // phase (the RIG_PHASE gate models "the rig's solve features exist", satisfied here).
  'rig-clipping': 2,
  'rig-hit-point': 2,
};

// The committed current phase (B.2 landed-rig gating). Bumped per phase milestone in this file, NOT
// read from the environment, so a feature branch cannot tamper with it to skip rigs. Phase 2 here.
export const CONFORMANCE_PHASE = 2;

// The rig ids that are landed at the current phase, in catalog order. The single source the generator
// and any harness iterate, so they cannot disagree about which rigs are in scope.
export const LANDED_RIG_IDS: readonly RigId[] = RIG_IDS.filter(
  (id) => RIG_PHASE[id] <= CONFORMANCE_PHASE,
);

// Effect-conformance rig registry (phase-3-vfx-particles.md section 8.9, WP-3.10, TASK-3.10.1). A
// PARALLEL track to the skeleton RIG_IDS: it captures solved PARTICLE state over a fixed-dt sample
// window, never bone affines, and it is gated the same way (EFFECT_PHASE[id] <= CONFORMANCE_PHASE). It
// does NOT touch the six Phase 2 skeleton rigs. Each id names a committed effects rig (a full
// EffectsDocument) plus a sample-spec; the catalog covers the minimum WP-3.10 set: a burst emitter
// (integer count + spawnOrder + recycle), a circle-spawn rate emitter (area-uniform shape draws +
// animated coin frames), a god-rays sprite-animator (continuous rotation + pulse), and a ribbon-trail
// (anchor-path geometry). World/bone anchors only; `anchorSpace: 'screen'` layers are excluded
// (section 8.9, viewport size is a non-portable render input).
//
// Provenance (L4): every effect rig is authored by us from first principles. No rig contains
// Spine-derived data; the emitter model and its evaluation semantics are our own (CLAUDE.md Law 4).
export const EFFECT_IDS = [
  'effect-coin-burst',
  'effect-circle-spawn',
  'effect-god-rays-sprite',
  'effect-ribbon-trail',
] as const;

export type EffectId = (typeof EFFECT_IDS)[number];

// Phase in which each effect rig's fixture is committed and its solve features exist. The
// harness/generator gate on `EFFECT_PHASE[id] <= CONFORMANCE_PHASE`. All four land in Phase 3.
export const EFFECT_PHASE: Readonly<Record<EffectId, number>> = {
  'effect-coin-burst': 3,
  'effect-circle-spawn': 3,
  'effect-god-rays-sprite': 3,
  'effect-ribbon-trail': 3,
};

// The committed current conformance phase for the effects track. Bumped per phase milestone in this
// file, NOT read from the environment, so a feature branch cannot tamper with it to skip rigs. Phase 3
// lands the effects track; the skeleton CONFORMANCE_PHASE above stays at 2 (the skeleton milestone),
// and the effect ids gate independently on this constant.
export const EFFECT_CONFORMANCE_PHASE = 3;

// The effect ids landed at the current effects-conformance phase, in catalog order. The single source
// the generator and the harness iterate, so they cannot disagree about which effect rigs are in scope.
export const LANDED_EFFECT_IDS: readonly EffectId[] = EFFECT_IDS.filter(
  (id) => EFFECT_PHASE[id] <= EFFECT_CONFORMANCE_PHASE,
);

// AnimationState registry (ADR-0005 conformance family). A PARALLEL track to the skeleton RIG_IDS, the
// effects EFFECT_IDS, and the slot SLOT_PAIRS: it locks the multi-animation MIXING contract (tracks,
// crossfade, additive layering, discrete greater-weight-wins, queue timing) as scenario-driven pose
// captures, never a single-animation sample. Each id names a committed scenario (an ordered AnimationState
// call script under anim-state-scenarios/) replayed against the shared anim-state-rig; the generator runs
// AnimationState over it and the golden test regenerates from runtime-core and asserts bones within the
// A.5 tolerance and slot attachments EXACTLY. It shares nothing with (and does not regenerate) the other
// three corpora: its own rig, scenarios, fixtures, and .anim-state-fixtures.lock.
//
// Provenance (L4): the rig and every scenario are authored by us from first principles; no Spine-derived
// data. The ADR-0005 conformance set is (a) mid-crossfade poses at fixed fractions, (b) an additive layer
// over a base loop, (c) a discrete winner flip across the 50% crossing, (d) a queue start across a loop
// boundary; each maps to one scenario below.
export const ANIM_STATE_IDS = [
  'anim-state-crossfade-fractions',
  'anim-state-additive-layer',
  'anim-state-discrete-flip',
  'anim-state-queue-loop-boundary',
  // Skin-scoped constraints under multi-track playback: applyAnimationState forwards the active skin to the
  // step-3 constraint solve, so a skin-scoped constraint (ADR-0009 section 5, ADR-0011 section 4) toggles
  // with the active skin exactly as under single-animation sampleSkeleton. This scenario carries its OWN rig
  // (a gold-scoped transform constraint plus an always-active one) and drives the active skin via `setSkin`.
  'anim-state-skin-scoped',
] as const;

export type AnimStateId = (typeof ANIM_STATE_IDS)[number];

// The rig MOST anim-state scenarios replay against (one shared rig, catalog-style). Scenarios reference their
// rig by `scenario.rigId`, so a scenario with a distinct solve need (e.g. skin-scoped constraints) may carry
// its own rig; the generator and harness both key off scenario.rigId.
export const ANIM_STATE_RIG_ID = 'anim-state-rig';

// Phase in which each scenario's fixture is committed and the AnimationState features it exercises exist.
// The first four land with ADR-0005 (Phase 5 hardening window); anim-state-skin-scoped lands with the
// activeSkin surface. All gate on ANIM_STATE_CONFORMANCE_PHASE.
export const ANIM_STATE_PHASE: Readonly<Record<AnimStateId, number>> = {
  'anim-state-crossfade-fractions': 5,
  'anim-state-additive-layer': 5,
  'anim-state-discrete-flip': 5,
  'anim-state-queue-loop-boundary': 5,
  'anim-state-skin-scoped': 5,
};

// The committed current conformance phase for the anim-state track. Bumped per phase milestone in this
// file, NOT read from the environment, so a feature branch cannot tamper with it to skip scenarios.
export const ANIM_STATE_CONFORMANCE_PHASE = 5;

// The scenario ids landed at the current anim-state-conformance phase, in catalog order. The single source
// the generator and the test iterate, so they cannot disagree about which scenarios are in scope.
export const LANDED_ANIM_STATE_IDS: readonly AnimStateId[] = ANIM_STATE_IDS.filter(
  (id) => ANIM_STATE_PHASE[id] <= ANIM_STATE_CONFORMANCE_PHASE,
);

// Slot golden-playback registry (phase-4-slot-composer.md WP-4.13, implements conformance WP-V.5). A THIRD
// PARALLEL track to the skeleton RIG_IDS and the effects EFFECT_IDS: it locks the SLOT DETERMINISM CONTRACT
// (LAW 1), the pure `sequence(result, scene) -> PresentationTimeline`. Each id names a committed
// (SpinResult, SlotScene) PAIR: a committed `spins/<spinId>.spin.json` engine outcome and a committed
// `scenes/<sceneId>.slotscene.json` authored scene. The generator runs `sequence` over the pair and pins
// the full timeline plus per-sample `rollupValueAt` values; the golden test regenerates from runtime-core
// and asserts an EXACT deep-equal (integer-ms + integer-unit data, no epsilon). It does NOT touch the six
// Phase 2 skeleton rigs or the four Phase 3 effect rigs (separate corpora, separate locks).
//
// Provenance (L4): every scene is authored by us from first principles. The spins are the committed mock
// engine outcomes (MOCK_SCENARIOS) or, for the one multiplier-feature coverage spin, hand-authored to carry
// a `multiplierApplied` feature; no spin or scene contains Spine-derived data (CLAUDE.md Law 4). A SpinResult
// is engine output (validated on load via validateSpinResult), NEVER authored game logic.
export interface SlotPair {
  readonly spinId: string;
  readonly sceneId: string;
  // The grid size validateSpinResult checks the committed spin against (the scene's grid dims).
  readonly gridSize: { readonly rows: number; readonly cols: number };
}

// The committed pairs, in catalog order. The five MOCK_SCENARIOS each pair with a topology-matched scene; a
// sixth hand-authored multiplier-feature spin pairs with the feature scene to cover the multiplierOrb kind
// (no mock scenario carries a `multiplierApplied` feature). Each scene exercises a distinct directive set
// (the coverage assertion in phase4-slot.test.ts maps every PresentationDirective.kind to a landed pair).
export const SLOT_PAIRS: Readonly<Record<string, SlotPair>> = {
  'pair-base-win': {
    spinId: 'spin-base-win',
    sceneId: 'scene-reelstrip-win',
    gridSize: { rows: 3, cols: 5 },
  },
  'pair-mega-escalation': {
    spinId: 'spin-mega-escalation',
    sceneId: 'scene-scatterpay-mega',
    gridSize: { rows: 5, cols: 6 },
  },
  'pair-freespin-trigger': {
    spinId: 'spin-freespin-trigger',
    sceneId: 'scene-scatterpay-feature',
    gridSize: { rows: 5, cols: 6 },
  },
  'pair-retrigger': {
    spinId: 'spin-retrigger',
    sceneId: 'scene-scatterpay-feature',
    gridSize: { rows: 5, cols: 6 },
  },
  'pair-multiplier-feature': {
    spinId: 'spin-multiplier-feature',
    sceneId: 'scene-scatterpay-feature',
    gridSize: { rows: 5, cols: 6 },
  },
  'pair-tumble-cascade': {
    spinId: 'spin-tumble-cascade',
    sceneId: 'scene-scatterpay-tumble',
    gridSize: { rows: 5, cols: 6 },
  },
};

export const SLOT_PAIR_IDS = [
  'pair-base-win',
  'pair-mega-escalation',
  'pair-freespin-trigger',
  'pair-retrigger',
  'pair-multiplier-feature',
  'pair-tumble-cascade',
] as const;

export type SlotPairId = (typeof SLOT_PAIR_IDS)[number];

// Phase in which each slot pair's golden is committed and the sequencer stages it exercises exist. The
// generator/harness gate on `SLOT_PAIR_PHASE[id] <= SLOT_CONFORMANCE_PHASE`. All six land in Phase 4.
export const SLOT_PAIR_PHASE: Readonly<Record<SlotPairId, number>> = {
  'pair-base-win': 4,
  'pair-mega-escalation': 4,
  'pair-freespin-trigger': 4,
  'pair-retrigger': 4,
  'pair-multiplier-feature': 4,
  'pair-tumble-cascade': 4,
};

// The committed current conformance phase for the slot track. Bumped per phase milestone in this file, NOT
// read from the environment, so a feature branch cannot tamper with it to skip pairs. Phase 4 lands the slot
// track; the skeleton (2) and effects (3) phases are independent constants.
export const SLOT_CONFORMANCE_PHASE = 4;

// The slot pair ids landed at the current slot-conformance phase, in catalog order. The single source the
// generator and the test iterate, so they cannot disagree about which pairs are in scope.
export const LANDED_SLOT_PAIR_IDS: readonly SlotPairId[] = SLOT_PAIR_IDS.filter(
  (id) => SLOT_PAIR_PHASE[id] <= SLOT_CONFORMANCE_PHASE,
);
