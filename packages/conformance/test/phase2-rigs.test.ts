import { describe, expect, it } from 'vitest';
import { buildFixture } from '../src/build-fixture';
import { compareFixtures } from '../src/compare/compare';
import { loadFixture, loadRig, loadSampleSpec } from '../src/io';
import { LANDED_RIG_IDS } from '../src/registry';

// The runtime-core side of the Phase 2 conformance gate (WP-2.10, conformance-and-ci.md B.2). It is the
// six-family analogue of roundtrip.test.ts: for every LANDED rig it asserts the committed fixture
// validates (Law 3), that regenerating it in memory from runtime-core reproduces it within the A.5
// tolerance (the drift tripwire), and that the committed sample times equal the sample-spec poseTimes
// (the single source of sampling, A.4). It then adds the Phase 2 mesh/deform/IK behavioral checks the
// new rig families exist to lock. The byte-exact lock is the separate toolchain-pinned CI gate (A.6);
// this tolerance-based check is deliberately Node-agnostic so it is not flaky off the pin.

// The rig families that carry a sampled mesh in their fixture (FIX-2.RM / FIX-2.W / FIX-2.DF). Their
// samples must each carry a non-empty `meshes` array; the constraint-only rigs must not.
const MESH_RIG_IDS = ['rig-rigid-mesh', 'rig-weighted-mesh', 'rig-deform'] as const;

describe('Phase 2 conformance rig families', () => {
  for (const rigId of LANDED_RIG_IDS) {
    describe(rigId, () => {
      it('the committed fixture validates against the fixture schema (Law 3)', () => {
        expect(() => loadFixture(rigId)).not.toThrow();
      });

      it('regenerating from runtime-core reproduces the committed fixture within A.5 tolerance', () => {
        const committed = loadFixture(rigId);
        const document = loadRig(rigId);
        const spec = loadSampleSpec(rigId);

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

      it('covers exactly the sample-spec poseTimes, in order', () => {
        const committed = loadFixture(rigId);
        const spec = loadSampleSpec(rigId);
        expect(committed.samples.map((s) => s.time)).toEqual(spec.poseTimes);
      });

      it('every affine and mesh position is finite (no NaN leaves the solve)', () => {
        const committed = loadFixture(rigId);
        for (const sample of committed.samples) {
          for (const affine of Object.values(sample.bones)) {
            for (const lane of affine) expect(Number.isFinite(lane)).toBe(true);
          }
          for (const mesh of sample.meshes ?? []) {
            for (const value of mesh.positions) expect(Number.isFinite(value)).toBe(true);
          }
        }
      });
    });
  }

  // The mesh-bearing rigs lock the skin (FIX-2.RM rigid, FIX-2.W weighted) and deform (FIX-2.DF) solve:
  // every sample carries the sampled mesh's world vertices.
  for (const rigId of MESH_RIG_IDS) {
    it(`${rigId} carries a non-empty mesh-vertices array on every sample`, () => {
      const committed = loadFixture(rigId);
      for (const sample of committed.samples) {
        expect(sample.meshes).toBeDefined();
        expect(sample.meshes!.length).toBeGreaterThan(0);
        for (const mesh of sample.meshes!) {
          expect(mesh.positions.length).toBeGreaterThan(0);
          // A quad has 4 logical vertices => 8 position lanes (x, y per vertex).
          expect(mesh.positions.length).toBe(8);
        }
      }
    });
  }

  // The constraint-only rigs are bone-only fixtures (no meshes member), so a pre-Phase-2 reader stays
  // valid and the mesh-set comparison is a no-op match.
  for (const rigId of ['rig-one-bone-ik', 'rig-two-bone-ik', 'rig-transform-constraint'] as const) {
    it(`${rigId} carries no mesh-vertices array (it is a bone-only fixture)`, () => {
      const committed = loadFixture(rigId);
      for (const sample of committed.samples) {
        expect(sample.meshes).toBeUndefined();
      }
    });
  }

  // FIX-2.DF: the deform timeline actually moves vertices. The mesh world positions at t=0 (zero
  // offsets) must differ from those at t=0.5 (the bezier key with +5 x offsets), proving deform is
  // applied on top of the skin (skin-then-deform solve order).
  it('rig-deform: mesh positions at t=0 differ from t=0.5 (deform moves vertices)', () => {
    const committed = loadFixture('rig-deform');
    const at0 = committed.samples.find((s) => s.time === 0);
    const at05 = committed.samples.find((s) => s.time === 0.5);
    expect(at0).toBeDefined();
    expect(at05).toBeDefined();
    const m0 = at0!.meshes![0]!.positions;
    const m05 = at05!.meshes![0]!.positions;
    expect(m05).not.toEqual(m0);
  });

  // FIX-2.IK2: at the reachable, full-mix frame (t=0.5, mix ramped to 1, target at (120, -60), within
  // the chain reach of 200) the chain tip lands on the target. The tip is lower.world * (lower.length,
  // 0); lower.length is 100. This locks the two-bone IK solve onto the target at full mix.
  it('rig-two-bone-ik: the chain tip reaches the target at the reachable full-mix frame', () => {
    const committed = loadFixture('rig-two-bone-ik');
    const reachable = committed.samples.find((s) => s.time === 0.5);
    expect(reachable).toBeDefined();
    const lower = reachable!.bones['lower']!;
    const target = reachable!.bones['target']!;
    const tipX = lower[0] * 100 + lower[4];
    const tipY = lower[1] * 100 + lower[5];
    const targetX = target[4];
    const targetY = target[5];
    const distance = Math.hypot(tipX - targetX, tipY - targetY);
    expect(distance).toBeLessThan(1e-3);
  });
});
