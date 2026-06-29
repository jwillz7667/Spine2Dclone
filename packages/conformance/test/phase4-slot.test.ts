import { describe, expect, it } from 'vitest';
import { rollupValueAt, sequence } from '@marionette/runtime-core';
import type { CurveType, PresentationDirective } from '@marionette/runtime-core';
import { buildSlotFixture, buildSlotTracks } from '../src/build-slot-fixture';
import type { RollupTrack } from '../src/schema/slot-fixture';
import { loadSlotFixture, loadSlotSampleSpec, loadSlotScene, loadSlotSpin } from '../src/io';
import { LANDED_SLOT_PAIR_IDS, SLOT_PAIRS } from '../src/registry';

// The runtime-core side of the Phase 4 slot golden-playback gate (WP-4.13, implements conformance WP-V.5).
// It LOCKS THE SLOT DETERMINISM CONTRACT (LAW 1): for every LANDED (SpinResult, SlotScene) pair it asserts
// the committed timeline golden validates (Law 3); that regenerating from runtime-core EXACTLY deep-equals
// the committed timeline AND the committed per-sample rollup values (no epsilon: integer-ms + integer-unit +
// closed-enum data); that running `sequence` 1000 times is byte-identical (LAW 1, determinism); the
// comparator-totality property holds (no two distinct directives share a `seq`, and the timeline is strictly
// increasing by (atMs, seq)); and that every PresentationDirective.kind appears in at least one committed
// golden (the coverage assertion). The slot data is integer-only, so this is a pure-logic + FS-read test
// that is fully Node-agnostic; the .slot.fixtures.lock byte-exact gate is the separate generation tripwire
// (A.6). The skeleton and effects corpora are untouched (separate tests, separate corpora).

// Independent re-evaluation of the pinned rollup value (so the test does not merely echo the fixture's
// numbers): the test recomputes rollupValueAt for every committed rollup sample from runtime-core. The
// curve string round-trips through the fixture as a closed CurveType, so it is passed straight through.
function expectedRollupValue(track: RollupTrack, atMs: number): number {
  const curve: CurveType = track.curve;
  return rollupValueAt(track.fromUnits, track.toUnits, track.startMs, track.endMs, atMs, curve);
}

describe('Phase 4 slot golden-playback conformance', () => {
  for (const pairId of LANDED_SLOT_PAIR_IDS) {
    describe(pairId, () => {
      const pair = SLOT_PAIRS[pairId]!;

      it('the committed fixture validates against the slot-fixture schema (Law 3)', () => {
        expect(() => loadSlotFixture(pairId)).not.toThrow();
      });

      it('regenerating from runtime-core deep-equals the committed timeline and rollup samples', () => {
        const committed = loadSlotFixture(pairId);
        const result = loadSlotSpin(pair.spinId, pair.gridSize);
        const scene = loadSlotScene(pair.sceneId);
        const spec = loadSlotSampleSpec(pairId);

        const regenerated = buildSlotFixture(result, scene, spec.sampleMs, {
          pairId,
          sceneId: pair.sceneId,
          spinHash: committed.spinHash,
          sceneHash: committed.sceneHash,
          specHash: committed.specHash,
          coreVersion: committed.coreVersion,
          toolchain: committed.toolchain,
          generatedBy: committed.generatedBy,
        });

        // EXACT deep-equal of the whole committed fixture (integer-only data, no tolerance). This covers the
        // full directive list AND the pinned per-sample rollup values in one structural assertion.
        expect(regenerated).toEqual(committed);
      });

      it('the committed sampleMs matches the sample-spec, and rollup tracks pin a value at each', () => {
        const committed = loadSlotFixture(pairId);
        const spec = loadSlotSampleSpec(pairId);
        expect(committed.sampleMs).toEqual(spec.sampleMs);
        for (const track of committed.rollups) {
          expect(track.samples.map((s) => s.atMs)).toEqual(spec.sampleMs);
        }
      });

      it('every committed rollup sample re-evaluates to the pinned integer (rollup math is locked)', () => {
        const committed = loadSlotFixture(pairId);
        for (const track of committed.rollups) {
          for (const sample of track.samples) {
            expect(sample.value).toBe(expectedRollupValue(track, sample.atMs));
            // The value is an integer base unit (no float counter ever stored).
            expect(Number.isInteger(sample.value)).toBe(true);
          }
        }
      });

      it('running sequence 1000 times is byte-identical (LAW 1 determinism)', () => {
        const result = loadSlotSpin(pair.spinId, pair.gridSize);
        const scene = loadSlotScene(pair.sceneId);
        const first = JSON.stringify(sequence(result, scene));
        for (let i = 0; i < 1000; i += 1) {
          expect(JSON.stringify(sequence(result, scene))).toBe(first);
        }
      });

      it('the comparator is total over the corpus: unique seqs, strictly increasing (atMs, seq)', () => {
        const committed = loadSlotFixture(pairId);
        const directives = committed.timeline.directives;
        // No two distinct directives in a timeline share a `seq` (so the two-key comparator never ties).
        const seqs = new Set<number>();
        for (const d of directives) {
          expect(seqs.has(d.seq)).toBe(false);
          seqs.add(d.seq);
        }
        // The timeline is strictly increasing by (atMs, seq): each directive sorts strictly after its
        // predecessor under the sequencer's exact comparator.
        for (let i = 1; i < directives.length; i += 1) {
          const prev = directives[i - 1]!;
          const cur = directives[i]!;
          const strictlyAfter =
            cur.atMs > prev.atMs || (cur.atMs === prev.atMs && cur.seq > prev.seq);
          expect(strictlyAfter).toBe(true);
        }
      });

      it('durationMs equals the max atMs across directives (or 0 for an empty timeline)', () => {
        const committed = loadSlotFixture(pairId);
        const directives = committed.timeline.directives;
        const maxAtMs = directives.reduce((acc, d) => (d.atMs > acc ? d.atMs : acc), 0);
        expect(committed.timeline.durationMs).toBe(maxAtMs);
      });

      it('the in-memory builder output equals the committed timeline (no I/O divergence)', () => {
        const committed = loadSlotFixture(pairId);
        const result = loadSlotSpin(pair.spinId, pair.gridSize);
        const scene = loadSlotScene(pair.sceneId);
        const spec = loadSlotSampleSpec(pairId);
        const { timeline, rollups } = buildSlotTracks(result, scene, spec.sampleMs);
        expect(timeline).toEqual(committed.timeline);
        expect(rollups).toEqual(committed.rollups);
      });
    });
  }

  // The corpus-wide coverage assertion (WP-4.13 acceptance): every PresentationDirective.kind the sequencer
  // emits appears in at least one committed golden, and the symbolAnimate sets (idle/win/anticipation) are
  // each exercised. The `land` symbolAnimate slot is a TYPE member the sequencer never emits (landing emits
  // symbolLand + symbolAnimate('idle'), never 'land'), so it is intentionally NOT required here.
  it('every emitted directive kind is covered by at least one committed golden', () => {
    const kindsSeen = new Set<PresentationDirective['kind']>();
    const animSetsSeen = new Set<string>();
    for (const pairId of LANDED_SLOT_PAIR_IDS) {
      const committed = loadSlotFixture(pairId);
      for (const d of committed.timeline.directives) {
        kindsSeen.add(d.kind);
        if (d.kind === 'symbolAnimate') animSetsSeen.add(d.set);
      }
    }

    const requiredKinds: readonly PresentationDirective['kind'][] = [
      'reelStop',
      'symbolLand',
      'symbolAnimate',
      'vfxBurst',
      'counterRollup',
      'escalation',
      'flowEnter',
      'flowExit',
      'multiplierOrb',
      'cascadeExplode',
      'cascadeDrop',
      'cascadeRefill',
    ];
    for (const kind of requiredKinds) {
      expect(kindsSeen.has(kind), `directive kind "${kind}" is not covered by any golden`).toBe(
        true,
      );
    }

    for (const set of ['idle', 'win', 'anticipation']) {
      expect(animSetsSeen.has(set), `symbolAnimate set "${set}" is not covered by any golden`).toBe(
        true,
      );
    }
  });
});
