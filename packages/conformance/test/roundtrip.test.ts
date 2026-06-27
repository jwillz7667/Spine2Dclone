import { describe, expect, it } from 'vitest';
import { buildFixture } from '../src/build-fixture';
import { compareFixtures } from '../src/compare/compare';
import { loadFixture, loadRig, loadSampleSpec } from '../src/io';

// The runtime-core side of WP-V.4 (B.2) until the runtime-web playback harness lands (see README). It
// re-runs the generator in memory and asserts it reproduces the committed fixture within the A.5
// tolerance, which is the drift tripwire on the runtime-core side: if the solve changes, this fails.
// The byte-exact lock is the separate CI `generate && git diff` gate (A.6), which is toolchain-pinned;
// this tolerance-based check is deliberately Node-agnostic so it is not flaky off the pin.

describe('rig-2bone fixture round-trip', () => {
  it('the committed fixture validates against the fixture schema (Law 3)', () => {
    expect(() => loadFixture('rig-2bone')).not.toThrow();
  });

  it('regenerating from runtime-core reproduces the committed fixture within A.5 tolerance', () => {
    const committed = loadFixture('rig-2bone');
    const document = loadRig('rig-2bone');
    const spec = loadSampleSpec('rig-2bone');

    const regenerated = buildFixture(document, spec, {
      rigId: committed.rigId,
      rigHash: committed.rigHash,
      specHash: committed.specHash,
      coreVersion: committed.coreVersion,
      toolchain: committed.toolchain,
      generatedBy: committed.generatedBy,
    });

    const report = compareFixtures(committed, regenerated);

    expect(report.failures).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('covers every committed sample time, and the past-duration sample clamps to the duration pose', () => {
    const committed = loadFixture('rig-2bone');
    const spec = loadSampleSpec('rig-2bone');

    expect(committed.samples.map((s) => s.time)).toEqual(spec.poseTimes);

    const atDuration = committed.samples.find((s) => s.time === spec.duration);
    const pastDuration = committed.samples.find((s) => s.time > spec.duration);
    expect(atDuration).toBeDefined();
    expect(pastDuration).toBeDefined();
    // The sampler clamps past duration to the last keyframe, so the past-duration pose is the duration pose.
    expect(pastDuration!.bones).toEqual(atDuration!.bones);
  });
});
