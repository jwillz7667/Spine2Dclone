import { describe, expect, it } from 'vitest';
import { compareFixtures } from '../src/compare/compare';
import type { Fixture } from '../src/schema/fixture';

// The compare engine and tolerance policy (WP-V.0 / WP-V.3, A.5 / B.5): a sub-bug-magnitude
// perturbation (1e-7) passes, a real-bug-magnitude perturbation (1e-2) fails with a localized report,
// and discrete identity (rigId, sample time) is exact (no epsilon).

function makeFixture(): Fixture {
  return {
    rigId: 'rig-2bone',
    rigHash: 'sha256:rig',
    specHash: 'sha256:spec',
    coreVersion: 'runtime-core@0.0.0',
    toolchain: 'node-22.13.1-v8',
    generatedBy: 'compare.test.ts',
    samples: [
      {
        time: 0,
        animation: 'default',
        loop: false,
        bones: { root: [1, 0, 0, 1, 0, 0], child: [1, 0, 0, 1, 100, 0] },
      },
      {
        time: 0.5,
        animation: 'default',
        loop: false,
        bones: { root: [0, 1, -1, 0, 0, 0], child: [0, 1, -1, 0, 0, 100] },
      },
    ],
  };
}

describe('compareFixtures (A.5 tolerance, B.5 report)', () => {
  it('passes when the fixtures are identical', () => {
    const report = compareFixtures(makeFixture(), makeFixture());

    expect(report.ok).toBe(true);
    expect(report.failures).toEqual([]);
  });

  it('passes a 1e-7 basis perturbation (under the 1e-6 basis atol)', () => {
    const expected = makeFixture();
    const actual = structuredClone(expected);
    actual.samples[1]!.bones['root']![0] = 1e-7; // was 0

    expect(compareFixtures(expected, actual).ok).toBe(true);
  });

  it('fails a 1e-2 basis perturbation with a localized failure', () => {
    const expected = makeFixture();
    const actual = structuredClone(expected);
    actual.samples[1]!.bones['root']![0] = 1e-2; // was 0

    const report = compareFixtures(expected, actual);

    expect(report.ok).toBe(false);
    expect(report.failures).toHaveLength(1);
    const failure = report.failures[0]!;
    expect(failure.quantity).toBe('worldBasis');
    expect(failure.bone).toBe('root');
    expect(failure.time).toBe(0.5);
    expect(failure.lane).toBe(0);
    expect(failure.expected).toBe(0);
    expect(failure.actual).toBe(1e-2);
    expect(failure.absDelta).toBeCloseTo(1e-2, 12);
    expect(failure.atol).toBe(1e-6);
    expect(failure.rtol).toBe(1e-6);
  });

  it('passes a 1e-5 translation perturbation but fails 1e-3 (atol 1e-4, rtol 1e-6 at coord 100)', () => {
    const expected = makeFixture();

    const small = structuredClone(expected);
    small.samples[0]!.bones['child']![4] = 100 + 1e-5; // tx, within 2e-4 band
    expect(compareFixtures(expected, small).ok).toBe(true);

    const large = structuredClone(expected);
    large.samples[0]!.bones['child']![4] = 100 + 1e-3; // tx, outside 2e-4 band
    const report = compareFixtures(expected, large);
    expect(report.ok).toBe(false);
    expect(report.failures[0]!.quantity).toBe('worldTranslation');
    expect(report.failures[0]!.lane).toBe(4);
  });

  it('fails exactly (no epsilon) on a discrete sample-time difference', () => {
    const expected = makeFixture();
    const actual = structuredClone(expected);
    actual.samples[0]!.time = 1e-9; // any nonzero difference is a real bug

    const report = compareFixtures(expected, actual);

    expect(report.ok).toBe(false);
    expect(report.failures[0]!.quantity).toBe('structural');
  });

  it('fails on a rigId mismatch (discrete identity)', () => {
    const expected = makeFixture();
    const actual = structuredClone(expected);
    actual.rigId = 'rig-other';

    const report = compareFixtures(expected, actual);

    expect(report.ok).toBe(false);
    expect(report.failures[0]!.quantity).toBe('structural');
  });
});

// PP-B1 per-slot capture (rig-blendmodes): blendMode is discrete (exact), color is on the COLOR
// tolerance (atol 1e-5, no relative term), and the slot set is structural (exact).
function makeSlotFixture(): Fixture {
  return {
    rigId: 'rig-blendmodes',
    rigHash: 'sha256:rig',
    specHash: 'sha256:spec',
    coreVersion: 'runtime-core@0.0.0',
    toolchain: 'node-22.13.1-v8',
    generatedBy: 'compare.test.ts',
    samples: [
      {
        time: 0,
        animation: 'default',
        loop: false,
        bones: { root: [1, 0, 0, 1, 0, 0] },
        slots: [
          { slot: 'a', blendMode: 'normal', color: [1, 1, 1, 1] },
          { slot: 'b', blendMode: 'additive', color: [0.5, 0.4, 0.3, 1] },
        ],
      },
    ],
  };
}

describe('compareFixtures slot state (PP-B1)', () => {
  it('passes when the slots are identical', () => {
    expect(compareFixtures(makeSlotFixture(), makeSlotFixture()).ok).toBe(true);
  });

  it('passes a sub-tolerance color perturbation (under the 1e-5 COLOR atol)', () => {
    const expected = makeSlotFixture();
    const actual = structuredClone(expected);
    actual.samples[0]!.slots![0]!.color[1] = 1 - 1e-6;

    expect(compareFixtures(expected, actual).ok).toBe(true);
  });

  it('fails a real-magnitude color drift with a localized slotColor failure', () => {
    const expected = makeSlotFixture();
    const actual = structuredClone(expected);
    actual.samples[0]!.slots![1]!.color[2] = 0.3 + 1e-2; // was 0.3

    const report = compareFixtures(expected, actual);

    expect(report.ok).toBe(false);
    expect(report.failures).toHaveLength(1);
    const failure = report.failures[0]!;
    expect(failure.quantity).toBe('slotColor');
    expect(failure.bone).toBe('b');
    expect(failure.lane).toBe(2);
    expect(failure.atol).toBe(1e-5);
    expect(failure.rtol).toBe(0);
  });

  it('fails EXACTLY (no epsilon) on a blendMode mismatch', () => {
    const expected = makeSlotFixture();
    const actual = structuredClone(expected);
    actual.samples[0]!.slots![0]!.blendMode = 'screen'; // was 'normal'

    const report = compareFixtures(expected, actual);

    expect(report.ok).toBe(false);
    expect(report.failures[0]!.quantity).toBe('structural');
    expect(report.failures[0]!.message).toContain('blendMode mismatch');
  });

  it('fails on a slot-set mismatch (structural)', () => {
    const expected = makeSlotFixture();
    const actual = structuredClone(expected);
    actual.samples[0]!.slots!.pop();

    const report = compareFixtures(expected, actual);

    expect(report.ok).toBe(false);
    expect(report.failures[0]!.quantity).toBe('structural');
    expect(report.failures[0]!.message).toContain('slot set mismatch');
  });
});
