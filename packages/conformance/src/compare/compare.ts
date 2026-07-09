import type {
  Affine,
  BoundingBoxState,
  ClipState,
  FiredEventRecord,
  Fixture,
  MeshVertices,
  PointState,
  SlotState,
} from '../schema/fixture';
import {
  ANGLE,
  COLOR,
  EVENT_FLOAT,
  VERTEX,
  withinTolerance,
  WORLD_BASIS,
  WORLD_TRANSLATION,
} from './tolerance';
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

export type QuantityClass =
  | 'worldBasis'
  | 'worldTranslation'
  | 'vertex'
  | 'slotColor'
  | 'slotDarkColor'
  | 'eventFloat'
  | 'clipPolygon'
  | 'pointPosition'
  | 'pointRotation'
  | 'boxVertex'
  | 'structural';

// Slot-color lane names [r, g, b, a] for human-readable failure messages.
const COLOR_LANE_NAMES = ['r', 'g', 'b', 'a'] as const;

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

// The (skin, slot, attachment) triple a mesh-vertices entry is keyed by, for stable matching + messages.
function meshKey(m: MeshVertices): string {
  return `${m.skin}/${m.slot}/${m.attachment}`;
}

// Compare the skinned + deformed mesh vertices of one sample (FIX-2.RM / FIX-2.W / FIX-2.DF). The mesh SET
// (by triple) and each mesh's position-array length are discrete (exact equality, structural); the
// positions themselves are compared lane by lane within the VERTEX tolerance. Absent on both sides (a
// bone-only rig) is a match.
function compareMeshes(
  expected: readonly MeshVertices[] | undefined,
  actual: readonly MeshVertices[] | undefined,
  rigId: string,
  time: number,
  failures: DriftFailure[],
): void {
  const e = expected ?? [];
  const a = actual ?? [];
  const expectedKeys = e.map(meshKey).sort();
  const actualKeys = a.map(meshKey).sort();
  if (
    expectedKeys.length !== actualKeys.length ||
    expectedKeys.some((k, i) => k !== actualKeys[i])
  ) {
    failures.push(
      structuralFailure(
        rigId,
        `sample at t=${time} mesh set mismatch: expected [${expectedKeys.join(', ')}], actual [${actualKeys.join(', ')}]`,
        time,
      ),
    );
    return;
  }
  const actualByKey = new Map(a.map((m) => [meshKey(m), m]));
  for (const em of e) {
    const am = actualByKey.get(meshKey(em))!;
    if (em.positions.length !== am.positions.length) {
      failures.push(
        structuralFailure(
          rigId,
          `mesh "${meshKey(em)}" at t=${time} vertex-count mismatch: expected ${em.positions.length}, actual ${am.positions.length}`,
          time,
        ),
      );
      continue;
    }
    for (let lane = 0; lane < em.positions.length; lane += 1) {
      const expectedValue = em.positions[lane]!;
      const actualValue = am.positions[lane]!;
      if (withinTolerance(actualValue, expectedValue, VERTEX)) continue;
      failures.push({
        rigId,
        time,
        bone: meshKey(em),
        quantity: 'vertex',
        lane,
        expected: expectedValue,
        actual: actualValue,
        absDelta: Math.abs(actualValue - expectedValue),
        atol: VERTEX.atol,
        rtol: VERTEX.rtol,
        message: `mesh "${meshKey(em)}" vertex lane ${lane} (${lane % 2 === 0 ? 'x' : 'y'} of vertex ${Math.floor(lane / 2)}) at t=${time} drifts beyond tolerance`,
      });
    }
  }
}

// Compare the per-slot presentation state of one sample (PP-B1, rig-blendmodes). The slot SET (by name)
// and each slot's `blendMode` are DISCRETE (exact equality, A.5): a blend-mode mismatch is a real
// step-6 bug, never float noise. The `color` channels are compared within the COLOR tolerance (bounded
// 0..1, no relative term). Absent on both sides (a bone-only or mesh-only rig) is a match.
function compareSlots(
  expected: readonly SlotState[] | undefined,
  actual: readonly SlotState[] | undefined,
  rigId: string,
  time: number,
  failures: DriftFailure[],
): void {
  const e = expected ?? [];
  const a = actual ?? [];
  const expectedNames = e.map((s) => s.slot).sort();
  const actualNames = a.map((s) => s.slot).sort();
  if (
    expectedNames.length !== actualNames.length ||
    expectedNames.some((n, i) => n !== actualNames[i])
  ) {
    failures.push(
      structuralFailure(
        rigId,
        `sample at t=${time} slot set mismatch: expected [${expectedNames.join(', ')}], actual [${actualNames.join(', ')}]`,
        time,
      ),
    );
    return;
  }
  const actualByName = new Map(a.map((s) => [s.slot, s]));
  for (const es of e) {
    const as = actualByName.get(es.slot)!;
    if (es.blendMode !== as.blendMode) {
      failures.push(
        structuralFailure(
          rigId,
          `slot "${es.slot}" at t=${time} blendMode mismatch: expected "${es.blendMode}", actual "${as.blendMode}"`,
          time,
        ),
      );
    }
    for (let lane = 0; lane < 4; lane += 1) {
      const expectedValue = es.color[lane]!;
      const actualValue = as.color[lane]!;
      if (withinTolerance(actualValue, expectedValue, COLOR)) continue;
      failures.push({
        rigId,
        time,
        bone: es.slot,
        quantity: 'slotColor',
        lane,
        expected: expectedValue,
        actual: actualValue,
        absDelta: Math.abs(actualValue - expectedValue),
        atol: COLOR.atol,
        rtol: COLOR.rtol,
        message: `slot "${es.slot}" color lane ${lane} (${COLOR_LANE_NAMES[lane]}) at t=${time} drifts beyond tolerance`,
      });
    }
    // The two-color dark tint (ADR-0011 section 3), present only for two-color slots. Presence must agree
    // (a structural mismatch) and each lane rides the COLOR tolerance like the primary color.
    const expectedDark = es.dark;
    const actualDark = as.dark;
    if ((expectedDark === undefined) !== (actualDark === undefined)) {
      failures.push(
        structuralFailure(
          rigId,
          `slot "${es.slot}" at t=${time} dark-tint presence mismatch: expected ${expectedDark !== undefined}, actual ${actualDark !== undefined}`,
          time,
        ),
      );
    } else if (expectedDark !== undefined && actualDark !== undefined) {
      for (let lane = 0; lane < 4; lane += 1) {
        const expectedValue = expectedDark[lane]!;
        const actualValue = actualDark[lane]!;
        if (withinTolerance(actualValue, expectedValue, COLOR)) continue;
        failures.push({
          rigId,
          time,
          bone: es.slot,
          quantity: 'slotDarkColor',
          lane,
          expected: expectedValue,
          actual: actualValue,
          absDelta: Math.abs(actualValue - expectedValue),
          atol: COLOR.atol,
          rtol: COLOR.rtol,
          message: `slot "${es.slot}" dark lane ${lane} (${COLOR_LANE_NAMES[lane]}) at t=${time} drifts beyond tolerance`,
        });
      }
    }
  }
}

// Compare the resolved render order of one sample (PP-B4, rig-events-draworder). Draw order is a discrete
// integer permutation, so it is compared with EXACT equality (no epsilon, A.5): a reorder mismatch is a
// real step-2 bug, never float noise. Absent on both sides (a rig that captures no draw order) is a match.
function compareDrawOrder(
  expected: readonly number[] | undefined,
  actual: readonly number[] | undefined,
  rigId: string,
  time: number,
  failures: DriftFailure[],
): void {
  const e = expected ?? [];
  const a = actual ?? [];
  if (e.length !== a.length || e.some((v, i) => v !== a[i])) {
    failures.push(
      structuralFailure(
        rigId,
        `sample at t=${time} draw order mismatch: expected [${e.join(', ')}], actual [${a.join(', ')}]`,
        time,
      ),
    );
  }
}

// Compare the resolved sequence frames of one sample (PP-B5 slice 5, rig-sequences). The frame index is a
// discrete integer, so it is compared EXACT (no epsilon): a wrong frame is a real step-2 resolution bug,
// never float noise. Entries are matched index by index in spec order (slot name + frame both exact).
function compareSequences(
  expected: ReadonlyArray<{ readonly slot: string; readonly frame: number }> | undefined,
  actual: ReadonlyArray<{ readonly slot: string; readonly frame: number }> | undefined,
  rigId: string,
  time: number,
  failures: DriftFailure[],
): void {
  const e = expected ?? [];
  const a = actual ?? [];
  if (e.length !== a.length || e.some((v, i) => v.slot !== a[i]?.slot || v.frame !== a[i]?.frame)) {
    const fmt = (list: ReadonlyArray<{ slot: string; frame: number }>): string =>
      list.map((s) => `${s.slot}:${s.frame}`).join(', ');
    failures.push(
      structuralFailure(
        rigId,
        `sample at t=${time} sequence frame mismatch: expected [${fmt(e)}], actual [${fmt(a)}]`,
        time,
      ),
    );
  }
}

// Compare the fired-event LOG of two fixtures (PP-B4, rig-events-draworder / rig-events-loop). The log is
// ordered, so entries are matched INDEX BY INDEX: the count, and per entry the name, fire time, and the
// discrete int/string payloads (presence and value) are compared EXACT; the float payload's presence is
// exact and its value rides the EVENT_FLOAT tolerance (an authored value, low noise). A missing log on
// both sides (a rig without events) is a match.
function compareEvents(
  expected: readonly FiredEventRecord[] | undefined,
  actual: readonly FiredEventRecord[] | undefined,
  rigId: string,
  failures: DriftFailure[],
): void {
  const e = expected ?? [];
  const a = actual ?? [];
  if (e.length !== a.length) {
    failures.push(
      structuralFailure(
        rigId,
        `fired-event count mismatch: expected ${e.length}, actual ${a.length}`,
        null,
      ),
    );
    return;
  }
  for (let i = 0; i < e.length; i += 1) {
    const ee = e[i]!;
    const aa = a[i]!;
    const where = `event ${i} ("${ee.name}" at t=${ee.time})`;
    if (ee.name !== aa.name) {
      failures.push(
        structuralFailure(rigId, `${where} name mismatch: expected "${ee.name}", actual "${aa.name}"`, ee.time),
      );
    }
    if (ee.time !== aa.time) {
      failures.push(
        structuralFailure(rigId, `${where} time mismatch: expected ${ee.time}, actual ${aa.time}`, ee.time),
      );
    }
    if (ee.int !== aa.int) {
      failures.push(
        structuralFailure(rigId, `${where} int mismatch: expected ${ee.int}, actual ${aa.int}`, ee.time),
      );
    }
    if (ee.string !== aa.string) {
      failures.push(
        structuralFailure(
          rigId,
          `${where} string mismatch: expected ${JSON.stringify(ee.string)}, actual ${JSON.stringify(aa.string)}`,
          ee.time,
        ),
      );
    }
    if ((ee.float === undefined) !== (aa.float === undefined)) {
      failures.push(
        structuralFailure(
          rigId,
          `${where} float presence mismatch: expected ${ee.float}, actual ${aa.float}`,
          ee.time,
        ),
      );
    } else if (
      ee.float !== undefined &&
      aa.float !== undefined &&
      !withinTolerance(aa.float, ee.float, EVENT_FLOAT)
    ) {
      failures.push({
        rigId,
        time: ee.time,
        bone: ee.name,
        quantity: 'eventFloat',
        lane: null,
        expected: ee.float,
        actual: aa.float,
        absDelta: Math.abs(aa.float - ee.float),
        atol: EVENT_FLOAT.atol,
        rtol: EVENT_FLOAT.rtol,
        message: `${where} float payload drifts beyond tolerance`,
      });
    }
  }
}

// Compare the resolved clip state of one sample (PP-B2, ADR-0012 section 3, rig-clipping). The clip SET (by
// slot/attachment) and each clip's world-polygon length are structural (exact); the polygon positions ride
// the VERTEX tolerance; the clipped-slot list is DISCRETE, compared EXACT in order (a draw-order membership
// decision, never float noise). Absent on both sides is a match.
function compareClips(
  expected: readonly ClipState[] | undefined,
  actual: readonly ClipState[] | undefined,
  rigId: string,
  time: number,
  failures: DriftFailure[],
): void {
  const e = expected ?? [];
  const a = actual ?? [];
  const key = (c: ClipState): string => `${c.slot}/${c.attachment}`;
  if (e.length !== a.length || e.some((c, i) => key(c) !== key(a[i]!))) {
    failures.push(
      structuralFailure(
        rigId,
        `sample at t=${time} clip set mismatch: expected [${e.map(key).join(', ')}], actual [${a.map(key).join(', ')}]`,
        time,
      ),
    );
    return;
  }
  for (let idx = 0; idx < e.length; idx += 1) {
    const ec = e[idx]!;
    const ac = a[idx]!;
    if (ec.clippedSlots.length !== ac.clippedSlots.length || ec.clippedSlots.some((s, i) => s !== ac.clippedSlots[i])) {
      failures.push(
        structuralFailure(
          rigId,
          `clip "${key(ec)}" at t=${time} clipped-slot set mismatch: expected [${ec.clippedSlots.join(', ')}], actual [${ac.clippedSlots.join(', ')}]`,
          time,
        ),
      );
    }
    if (ec.worldPolygon.length !== ac.worldPolygon.length) {
      failures.push(
        structuralFailure(
          rigId,
          `clip "${key(ec)}" at t=${time} world-polygon length mismatch: expected ${ec.worldPolygon.length}, actual ${ac.worldPolygon.length}`,
          time,
        ),
      );
      continue;
    }
    for (let lane = 0; lane < ec.worldPolygon.length; lane += 1) {
      pushNumeric(
        failures,
        withinTolerance(ac.worldPolygon[lane]!, ec.worldPolygon[lane]!, VERTEX),
        rigId,
        time,
        key(ec),
        'clipPolygon',
        lane,
        ec.worldPolygon[lane]!,
        ac.worldPolygon[lane]!,
        VERTEX,
        `clip "${key(ec)}" world-polygon lane ${lane} (${lane % 2 === 0 ? 'x' : 'y'} of vertex ${Math.floor(lane / 2)}) at t=${time} drifts beyond tolerance`,
      );
    }
  }
}

// Compare the resolved bounding-box hit-test state of one sample (PP-B2, ADR-0012 section 4, rig-hit-point).
// The box SET and world-vertex length are structural; world vertices ride the VERTEX tolerance; the per-probe
// hit booleans are DISCRETE, compared EXACT. Absent on both sides is a match.
function compareBoxes(
  expected: readonly BoundingBoxState[] | undefined,
  actual: readonly BoundingBoxState[] | undefined,
  rigId: string,
  time: number,
  failures: DriftFailure[],
): void {
  const e = expected ?? [];
  const a = actual ?? [];
  const key = (b: BoundingBoxState): string => `${b.slot}/${b.attachment}`;
  if (e.length !== a.length || e.some((b, i) => key(b) !== key(a[i]!))) {
    failures.push(
      structuralFailure(
        rigId,
        `sample at t=${time} bounding-box set mismatch: expected [${e.map(key).join(', ')}], actual [${a.map(key).join(', ')}]`,
        time,
      ),
    );
    return;
  }
  for (let idx = 0; idx < e.length; idx += 1) {
    const eb = e[idx]!;
    const ab = a[idx]!;
    if (eb.hits.length !== ab.hits.length || eb.hits.some((h, i) => h !== ab.hits[i])) {
      failures.push(
        structuralFailure(
          rigId,
          `box "${key(eb)}" at t=${time} hit results mismatch: expected [${eb.hits.join(', ')}], actual [${ab.hits.join(', ')}]`,
          time,
        ),
      );
    }
    if (eb.worldVertices.length !== ab.worldVertices.length) {
      failures.push(
        structuralFailure(
          rigId,
          `box "${key(eb)}" at t=${time} world-vertex length mismatch: expected ${eb.worldVertices.length}, actual ${ab.worldVertices.length}`,
          time,
        ),
      );
      continue;
    }
    for (let lane = 0; lane < eb.worldVertices.length; lane += 1) {
      pushNumeric(
        failures,
        withinTolerance(ab.worldVertices[lane]!, eb.worldVertices[lane]!, VERTEX),
        rigId,
        time,
        key(eb),
        'boxVertex',
        lane,
        eb.worldVertices[lane]!,
        ab.worldVertices[lane]!,
        VERTEX,
        `box "${key(eb)}" world-vertex lane ${lane} at t=${time} drifts beyond tolerance`,
      );
    }
  }
}

// Compare the resolved point world state of one sample (PP-B2, ADR-0012 section 2, rig-hit-point). The point
// SET is structural; x/y ride the VERTEX tolerance; rotation rides the ANGLE tolerance. Absent on both is a match.
function comparePoints(
  expected: readonly PointState[] | undefined,
  actual: readonly PointState[] | undefined,
  rigId: string,
  time: number,
  failures: DriftFailure[],
): void {
  const e = expected ?? [];
  const a = actual ?? [];
  const key = (p: PointState): string => `${p.slot}/${p.attachment}`;
  if (e.length !== a.length || e.some((p, i) => key(p) !== key(a[i]!))) {
    failures.push(
      structuralFailure(
        rigId,
        `sample at t=${time} point set mismatch: expected [${e.map(key).join(', ')}], actual [${a.map(key).join(', ')}]`,
        time,
      ),
    );
    return;
  }
  for (let idx = 0; idx < e.length; idx += 1) {
    const ep = e[idx]!;
    const ap = a[idx]!;
    pushNumeric(failures, withinTolerance(ap.x, ep.x, VERTEX), rigId, time, key(ep), 'pointPosition', 0, ep.x, ap.x, VERTEX, `point "${key(ep)}" world x at t=${time} drifts beyond tolerance`);
    pushNumeric(failures, withinTolerance(ap.y, ep.y, VERTEX), rigId, time, key(ep), 'pointPosition', 1, ep.y, ap.y, VERTEX, `point "${key(ep)}" world y at t=${time} drifts beyond tolerance`);
    pushNumeric(failures, withinTolerance(ap.rotation, ep.rotation, ANGLE), rigId, time, key(ep), 'pointRotation', null, ep.rotation, ap.rotation, ANGLE, `point "${key(ep)}" world rotation at t=${time} drifts beyond tolerance`);
  }
}

// Append a numeric lane failure when the tolerance check failed. Centralizes the DriftFailure shape for the
// PP-B2 lanes so each comparator stays terse.
function pushNumeric(
  failures: DriftFailure[],
  within: boolean,
  rigId: string,
  time: number,
  bone: string,
  quantity: QuantityClass,
  lane: number | null,
  expected: number,
  actual: number,
  tol: Tolerance,
  message: string,
): void {
  if (within) return;
  failures.push({
    rigId,
    time,
    bone,
    quantity,
    lane,
    expected,
    actual,
    absDelta: Math.abs(actual - expected),
    atol: tol.atol,
    rtol: tol.rtol,
    message,
  });
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

    compareMeshes(e.meshes, a.meshes, rigId, e.time, failures);
    compareSlots(e.slots, a.slots, rigId, e.time, failures);
    compareDrawOrder(e.drawOrder, a.drawOrder, rigId, e.time, failures);
    compareSequences(e.sequences, a.sequences, rigId, e.time, failures);
    compareClips(e.clips, a.clips, rigId, e.time, failures);
    compareBoxes(e.boxes, a.boxes, rigId, e.time, failures);
    comparePoints(e.points, a.points, rigId, e.time, failures);
  }

  // The fired-event log is fixture-level (one range sweep), not per-sample, so it is compared once.
  compareEvents(expected.events, actual.events, rigId, failures);

  return { ok: failures.length === 0, failures };
}
