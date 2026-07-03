import { describe, expect, it } from 'vitest';
import { buildAnimStateFixture } from '../src/build-anim-state-fixture';
import { loadAnimStateFixture, loadAnimStateRig, loadAnimStateScenario } from '../src/io';
import { LANDED_ANIM_STATE_IDS } from '../src/registry';
import { withinTolerance, WORLD_BASIS, WORLD_TRANSLATION } from '../src/compare/tolerance';
import type { AnimStateAffine, AnimStateFixture } from '../src/schema/anim-state-fixture';

// The AnimationState (anim-state) conformance gate (ADR-0005 conformance family). It is the mixing analogue
// of phase2-rigs.test.ts: for every landed scenario it asserts the committed fixture validates (Law 3), that
// replaying it through runtime-core's AnimationState reproduces it (bones within the A.5 tolerance, slot
// attachments EXACTLY), and then pins the four ADR-0005 semantics the family exists to lock: mid-crossfade
// poses, the additive layer over a base loop, the discrete winner flip across the 50% crossing, and the
// queue start across a loop boundary. The byte-exact lock is the separate toolchain-pinned CI gate (A.6);
// this tolerance-based check is deliberately Node-agnostic so it is not flaky off the pin.

function rotationDeg(affine: AnimStateAffine): number {
  return (Math.atan2(affine[1], affine[0]) * 180) / Math.PI;
}

function regenerate(scenarioId: string): AnimStateFixture {
  const committed = loadAnimStateFixture(scenarioId);
  const scenario = loadAnimStateScenario(scenarioId);
  const document = loadAnimStateRig(scenario.rigId);
  return buildAnimStateFixture(document, scenario, {
    scenarioId: committed.scenarioId,
    rigId: committed.rigId,
    scenarioHash: committed.scenarioHash,
    rigHash: committed.rigHash,
    coreVersion: committed.coreVersion,
    toolchain: committed.toolchain,
    generatedBy: committed.generatedBy,
  });
}

function expectAffineWithinTolerance(actual: AnimStateAffine, expected: AnimStateAffine): void {
  for (let lane = 0; lane < 4; lane += 1) {
    expect(withinTolerance(actual[lane]!, expected[lane]!, WORLD_BASIS)).toBe(true);
  }
  for (let lane = 4; lane < 6; lane += 1) {
    expect(withinTolerance(actual[lane]!, expected[lane]!, WORLD_TRANSLATION)).toBe(true);
  }
}

describe('anim-state conformance scenarios (ADR-0005)', () => {
  for (const scenarioId of LANDED_ANIM_STATE_IDS) {
    describe(scenarioId, () => {
      it('the committed fixture validates against the fixture schema (Law 3)', () => {
        expect(() => loadAnimStateFixture(scenarioId)).not.toThrow();
      });

      it('replaying from runtime-core reproduces the committed fixture (bones within A.5, slots exact)', () => {
        const committed = loadAnimStateFixture(scenarioId);
        const regenerated = regenerate(scenarioId);

        expect(regenerated.samples.length).toBe(committed.samples.length);
        for (let i = 0; i < committed.samples.length; i += 1) {
          const e = committed.samples[i]!;
          const a = regenerated.samples[i]!;
          expect(a.index).toBe(e.index);
          expect(Object.keys(a.bones).sort()).toEqual(Object.keys(e.bones).sort());
          expect(Object.keys(a.slots).sort()).toEqual(Object.keys(e.slots).sort());
          for (const bone of Object.keys(e.bones)) {
            expectAffineWithinTolerance(a.bones[bone]!, e.bones[bone]!);
          }
          // Discrete channels: exact equality, no tolerance (A.5).
          expect(a.slots).toEqual(e.slots);
        }
      });

      it('every affine lane is finite (no NaN leaves the blended solve)', () => {
        for (const sample of loadAnimStateFixture(scenarioId).samples) {
          for (const affine of Object.values(sample.bones)) {
            for (const lane of affine) expect(Number.isFinite(lane)).toBe(true);
          }
        }
      });
    });
  }

  it('(a) crossfade-fractions: the mid-crossfade root rotation moves monotonically from spinA toward spinB', () => {
    const fixture = loadAnimStateFixture('anim-state-crossfade-fractions');
    // Samples 1..5 are the mix at w_in = 0, 0.25, 0.5, 0.75, 1.0 (sample 0 is spinA mid, pre-crossfade).
    const rotations = fixture.samples.slice(1).map((s) => rotationDeg(s.bones['root']!));
    for (let i = 1; i < rotations.length; i += 1) {
      expect(rotations[i]!).toBeLessThan(rotations[i - 1]!); // spinA rotates +, spinB rotates -
    }
  });

  it('(b) additive-layer: the arm carries the base rotation PLUS the additive wave delta', () => {
    const fixture = loadAnimStateFixture('anim-state-additive-layer');
    const first = fixture.samples[0]!;
    const rootRot = rotationDeg(first.bones['root']!);
    const armRot = rotationDeg(first.bones['arm']!);
    // spinA keys only root; without the additive wave the arm would inherit exactly the root rotation
    // (arm-local 0). The additive overlay adds an arm-local rotation on top, so arm != root.
    expect(Math.abs(armRot - rootRot)).toBeGreaterThan(5);
  });

  it('(c) discrete-flip: the attachment winner flips iconA -> iconB across the 50% crossing', () => {
    const slots = loadAnimStateFixture('anim-state-discrete-flip').samples.map(
      (s) => s.slots['badge'],
    );
    // w_in = 0, 0.25 (outgoing wins), 0.5 (tie -> incoming), 0.75 (incoming wins).
    expect(slots).toEqual(['iconA', 'iconA', 'iconB', 'iconB']);
  });

  it('(d) queue-loop-boundary: the queued spinB starts at the loop boundary (iconA -> iconB)', () => {
    const slots = loadAnimStateFixture('anim-state-queue-loop-boundary').samples.map(
      (s) => s.slots['badge'],
    );
    // Two spinA captures before the boundary, then spinB (iconB) once the loop boundary is crossed.
    expect(slots).toEqual(['iconA', 'iconA', 'iconB', 'iconB']);
  });
});
