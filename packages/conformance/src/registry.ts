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
export const RIG_IDS = [
  'rig-2bone',
  'rig-rigid-mesh',
  'rig-weighted-mesh',
  'rig-one-bone-ik',
  'rig-two-bone-ik',
  'rig-transform-constraint',
  'rig-deform',
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
