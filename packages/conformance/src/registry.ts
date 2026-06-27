// Reference-rig registry (conformance-and-ci.md A.2, WP-V.1). The ordered RIG_IDS plus the RIG_PHASE
// map drive the landed-rig gating (B.2): the generator and the harness run exactly the rigs whose
// RIG_PHASE is at or below CONFORMANCE_PHASE, so a rig whose solve features do not exist yet is never
// generated or asserted. Phase 1 lands only `rig-2bone` (phase-1-bone-puppet.md WP-1.12); the
// remaining ten rigs land in Phase 2 (conformance A.2 catalog) and extend this list.
//
// Provenance (L4): every rig is authored by us from first principles. No rig contains Spine-derived
// data, no Spine runtime source is copied, and our format is our own (CLAUDE.md Law 4). `rig-2bone`
// is two bones and a hand-written animation; it is a unit test in skeleton form, not a production rig.

export const RIG_IDS = ['rig-2bone'] as const;

export type RigId = (typeof RIG_IDS)[number];

// Phase in which each rig's fixture is committed and its solve features exist (conformance A.2 Lands
// column). The harness/generator gate on `RIG_PHASE[id] <= CONFORMANCE_PHASE`.
export const RIG_PHASE: Readonly<Record<RigId, number>> = {
  'rig-2bone': 1,
};

// The committed current phase (B.2 landed-rig gating). Bumped per phase milestone in this file, NOT
// read from the environment, so a feature branch cannot tamper with it to skip rigs. Phase 1 here.
export const CONFORMANCE_PHASE = 1;

// The rig ids that are landed at the current phase, in catalog order. The single source the generator
// and any harness iterate, so they cannot disagree about which rigs are in scope.
export const LANDED_RIG_IDS: readonly RigId[] = RIG_IDS.filter(
  (id) => RIG_PHASE[id] <= CONFORMANCE_PHASE,
);
