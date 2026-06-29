import { rollupValueAt, sequence } from '@marionette/runtime-core';
import type { PresentationDirective, PresentationTimeline } from '@marionette/runtime-core';
import type { SpinResult } from '@marionette/math-bridge';
import type { SlotScene } from '@marionette/format/slot-types';
import type {
  SlotFixture,
  SlotTimeline,
  RollupTrack,
  RollupSampleValue,
} from './schema/slot-fixture';

// The pure slot golden-playback fixture builder (phase-4-slot-composer.md WP-4.13, implements conformance
// WP-V.5). This is the DETERMINISM BOUNDARY's behavioral source of truth (LAW 1): it imports
// @marionette/runtime-core (the slot sequencer + the pinned rollup math), the @marionette/math-bridge
// SpinResult VALUE TYPE, and the @marionette/format SlotScene TYPE only. NO filesystem, NO clock, NO RNG of
// its own (the sequencer is the source of truth). For a committed (SpinResult, SlotScene) pair it runs
// `sequence` ONCE and produces a committed fixture = the full PresentationTimeline (directives already in the
// sequencer's sorted (atMs, seq) order) PLUS, for every `counterRollup` directive, its `rollupValueAt`
// evaluated at the committed sample times (so the displayed integer counter is locked, not just the
// directive window). generate-slot.ts wraps this with file I/O and provenance.

// Provenance recorded on the fixture (A.3). None of it participates in comparison; it exists for review
// (which spin/scene/spec/toolchain produced this fixture) and for the .slot.fixtures.lock drift gate.
export interface SlotFixtureProvenance {
  readonly pairId: string;
  readonly sceneId: string;
  readonly spinHash: string;
  readonly sceneHash: string;
  readonly specHash: string;
  readonly coreVersion: string;
  readonly toolchain: string;
  readonly generatedBy: string;
}

// Map a runtime PresentationTimeline to the committed timeline shape. This is a structural copy that drops no
// field: it exists so the committed JSON is a plain object tree (the runtime type uses readonly arrays /
// branded SymbolId strings, which serialize identically) and so the builder's output is exactly what the
// fixture schema validates. The directives are emitted in the sequencer's order verbatim (already sorted by
// (atMs, seq)); we do NOT re-sort here.
function toCommittedTimeline(timeline: PresentationTimeline): SlotTimeline {
  return {
    spinId: timeline.spinId,
    durationMs: timeline.durationMs,
    // Spread each directive into a fresh plain object so the committed JSON has no readonly/branded ghosts;
    // the field set per kind is preserved by the spread (the schema's .strict() re-checks the exact shape).
    directives: timeline.directives.map((directive) => ({ ...directive })),
  };
}

// For one counterRollup directive, pin rollupValueAt at every sample time. The directive's narrowed type
// gives fromUnits/toUnits/startMs/endMs/curve; rollupValueAt is the pinned integer/fixed-point evaluation
// (runtime-core/slot rollup.ts), so the dumped value is the same integer on every runtime at that instant.
function buildRollupTrack(
  directive: Extract<PresentationDirective, { kind: 'counterRollup' }>,
  sampleMs: readonly number[],
): RollupTrack {
  const samples: RollupSampleValue[] = sampleMs.map((atMs) => ({
    atMs,
    value: rollupValueAt(
      directive.fromUnits,
      directive.toUnits,
      directive.startMs,
      directive.endMs,
      atMs,
      directive.curve,
    ),
  }));
  return {
    seq: directive.seq,
    fromUnits: directive.fromUnits,
    toUnits: directive.toUnits,
    startMs: directive.startMs,
    endMs: directive.endMs,
    curve: directive.curve,
    samples,
  };
}

// Run the sequencer over the pair and pin the rollup samples. Pure: one `sequence` call, then a per-directive
// rollup evaluation. Exported so the golden test can regenerate in memory and deep-equal the committed
// fixture's timeline + rollup tracks.
export function buildSlotTracks(
  result: SpinResult,
  scene: SlotScene,
  sampleMs: readonly number[],
): { timeline: SlotTimeline; rollups: RollupTrack[] } {
  const timeline = sequence(result, scene);
  const rollups: RollupTrack[] = [];
  for (const directive of timeline.directives) {
    if (directive.kind === 'counterRollup') {
      rollups.push(buildRollupTrack(directive, sampleMs));
    }
  }
  return { timeline: toCommittedTimeline(timeline), rollups };
}

export function buildSlotFixture(
  result: SpinResult,
  scene: SlotScene,
  sampleMs: readonly number[],
  provenance: SlotFixtureProvenance,
): SlotFixture {
  const { timeline, rollups } = buildSlotTracks(result, scene, sampleMs);
  return {
    pairId: provenance.pairId,
    spinId: result.spinId,
    sceneId: provenance.sceneId,
    spinHash: provenance.spinHash,
    sceneHash: provenance.sceneHash,
    specHash: provenance.specHash,
    coreVersion: provenance.coreVersion,
    toolchain: provenance.toolchain,
    generatedBy: provenance.generatedBy,
    sampleMs: [...sampleMs],
    timeline,
    rollups,
  };
}
