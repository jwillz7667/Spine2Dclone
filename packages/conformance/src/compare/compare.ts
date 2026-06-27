import type { Affine, Fixture } from '../schema/fixture';
import { withinTolerance, WORLD_BASIS, WORLD_TRANSLATION } from './tolerance';
import type { Tolerance } from './tolerance';

// The skeletal parity comparison engine (conformance-and-ci.md B.5, WP-V.0/V.3). It compares two
// fixtures (an expected committed fixture and an actual one produced by a runtime) and returns a
// structured DriftReport: a flat list of localized failures, each carrying enough context to triage
// without re-running anything. The same code path backs the runtime-web harness and (in Phase 5) the
// Unity/Godot dump compare; there is one tolerance policy (A.5) and one report shape.
//
// Phase 1 (rig-2bone) compares bone world affines only. Vertices, resolved draw order, per-slot
// attachment/color, and the event log (the rest of the A.3 fixture) arrive with the Phase 2 rigs and
// extend this engine; the structural checks below already reject any drift in the discrete identity of
// a sample (rigId, sample count, sample time, animation, bone set), which is the exact-equality path
// the discrete quantities use (no epsilon, A.5).

// Affine lane names [a, b, c, d, tx, ty] for human-readable failure messages.
const LANE_NAMES = ['a', 'b', 'c', 'd', 'tx', 'ty'] as const;

export type QuantityClass = 'worldBasis' | 'worldTranslation' | 'structural';

// One localized parity failure. Numeric fields are populated for a numeric (per-lane) drift; for a
// structural failure they are null and `message` carries the discrete mismatch.
export interface DriftFailure {
  readonly rigId: string;
  readonly time: number | null;
  readonly bone: string | null;
  readonly quantity: QuantityClass;
  readonly lane: number | null; // 0..5 index into [a, b, c, d, tx, ty]
  readonly expected: number | null;
  readonly actual: number | null;
  readonly absDelta: number | null;
  readonly atol: number | null;
  readonly rtol: number | null;
  readonly message: string;
}

export interface DriftReport {
  readonly ok: boolean;
  readonly failures: readonly DriftFailure[];
}

// Affine lanes [a, b, c, d, tx, ty]: lanes 0..3 are the basis class, lanes 4..5 the translation class.
function toleranceForLane(lane: number): Tolerance {
  return lane < 4 ? WORLD_BASIS : WORLD_TRANSLATION;
}

function quantityForLane(lane: number): QuantityClass {
  return lane < 4 ? 'worldBasis' : 'worldTranslation';
}

// Compare two world affines lane by lane within the A.5 tolerance, appending one failure per lane that
// drifts. Exported so a harness can compare a single bone without assembling a whole Fixture.
export function compareAffine(
  expected: Affine,
  actual: Affine,
  context: { readonly rigId: string; readonly time: number; readonly bone: string },
  failures: DriftFailure[],
): void {
  for (let lane = 0; lane < 6; lane += 1) {
    const e = expected[lane]!;
    const a = actual[lane]!;
    const tol = toleranceForLane(lane);
    if (withinTolerance(a, e, tol)) continue;
    failures.push({
      rigId: context.rigId,
      time: context.time,
      bone: context.bone,
      quantity: quantityForLane(lane),
      lane,
      expected: e,
      actual: a,
      absDelta: Math.abs(a - e),
      atol: tol.atol,
      rtol: tol.rtol,
      message: `bone "${context.bone}" world affine lane ${lane} (${LANE_NAMES[lane]}) at t=${context.time} drifts beyond tolerance`,
    });
  }
}

function structuralFailure(rigId: string, message: string, time: number | null): DriftFailure {
  return {
    rigId,
    time,
    bone: null,
    quantity: 'structural',
    lane: null,
    expected: null,
    actual: null,
    absDelta: null,
    atol: null,
    rtol: null,
    message,
  };
}

// Compare an expected fixture to an actual one. Structural identity (rigId, sample count, per-index
// sample time, animation, and bone-name set) is compared with EXACT equality (the discrete path, no
// epsilon); bone world affines are compared with the A.5 tolerance. A non-empty failure list means a
// real bug, not float noise; the band is far wider than f64 reordering noise (A.5).
export function compareFixtures(expected: Fixture, actual: Fixture): DriftReport {
  const failures: DriftFailure[] = [];
  const rigId = expected.rigId;

  if (expected.rigId !== actual.rigId) {
    failures.push(
      structuralFailure(
        rigId,
        `rigId mismatch: expected "${expected.rigId}", actual "${actual.rigId}"`,
        null,
      ),
    );
    return { ok: false, failures };
  }

  if (expected.samples.length !== actual.samples.length) {
    failures.push(
      structuralFailure(
        rigId,
        `sample count mismatch: expected ${expected.samples.length}, actual ${actual.samples.length}`,
        null,
      ),
    );
    return { ok: false, failures };
  }

  for (let i = 0; i < expected.samples.length; i += 1) {
    const e = expected.samples[i]!;
    const a = actual.samples[i]!;

    if (e.time !== a.time) {
      failures.push(
        structuralFailure(
          rigId,
          `sample ${i} time mismatch: expected ${e.time}, actual ${a.time}`,
          e.time,
        ),
      );
      continue;
    }
    if (e.animation !== a.animation) {
      failures.push(
        structuralFailure(
          rigId,
          `sample at t=${e.time} animation mismatch: expected "${e.animation}", actual "${a.animation}"`,
          e.time,
        ),
      );
      continue;
    }

    const expectedBones = Object.keys(e.bones).sort();
    const actualBones = Object.keys(a.bones).sort();
    if (
      expectedBones.length !== actualBones.length ||
      expectedBones.some((n, k) => n !== actualBones[k])
    ) {
      failures.push(
        structuralFailure(
          rigId,
          `sample at t=${e.time} bone set mismatch: expected [${expectedBones.join(', ')}], actual [${actualBones.join(', ')}]`,
          e.time,
        ),
      );
      continue;
    }

    for (const bone of expectedBones) {
      compareAffine(e.bones[bone]!, a.bones[bone]!, { rigId, time: e.time, bone }, failures);
    }
  }

  return { ok: failures.length === 0, failures };
}
