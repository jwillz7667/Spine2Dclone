import { describe, expect, it } from 'vitest';
import { LANDED_RIG_IDS } from '../src/registry';
import { loadFixture, loadRig } from '../src/io';
import type { RigId } from '../src/registry';
import type { Affine } from '../src/schema/fixture';

// The bug-magnitude epsilon (conformance-and-ci.md A.2): degrees-vs-radians, wrong solve order, and a
// transform-mode treated as `normal` all produce basis errors >= 1e-2, orders of magnitude above f64
// reordering noise. A difference ABOVE this proves a branch is observably distinct (necessary-but-not-
// sufficient coverage is rejected on purpose: a mode that silently behaves like `normal` cannot pass).
const BUG_EPSILON = 1e-2;

// Max absolute difference over the four basis lanes [a, b, c, d] of two world affines. The basis (not
// the translation) is where transform-mode inheritance is observable, so coverage is asserted on it.
function basisMaxDiff(x: Affine, y: Affine): number {
  let max = 0;
  for (let lane = 0; lane < 4; lane += 1) max = Math.max(max, Math.abs(x[lane]! - y[lane]!));
  return max;
}

// A.2 reference-rig COVERAGE meta-test (phase-5 TASK-5.5.8, conformance-and-ci.md A.2; the compensating
// control recorded in ADR-0001). Under the shared C# core, a solve branch that no committed fixture
// exercises has ZERO cross-implementation verification: it would pass identically in TS, Unity, and Godot
// because there is no second independent engine to disagree. So every solve branch MUST be exercised by a
// committed rig, and this meta-test is the gate that proves it. It asserts the branches that the CURRENT
// fixture schema OBSERVES (bone world affines + skinned/deformed mesh vertices) are each exercised by at
// least one landed rig, and it ENUMERATES, as explicit `it.todo` entries, the branches that are not yet
// observable, each blocked on a named, deferred piece of work. The file is the living A.2 checklist: a
// branch cannot quietly lose its coverage (the assertion goes red), and a deferred branch cannot be
// silently forgotten (it shows as a pending todo until its blocker lands and it becomes a real assertion).

// One landed rig's solve-feature flags, derived from the VALIDATED rig document (loadRig runs the
// section-6 validator), so the coverage claim is read off the real contract shape, not a guess.
interface RigFeatures {
  readonly hasIk: boolean;
  readonly hasTransformConstraint: boolean;
  readonly hasWeightedMesh: boolean;
  readonly hasUnweightedMesh: boolean;
  readonly hasDeform: boolean;
  readonly curves: ReadonlySet<string>;
  readonly bendPositiveValues: ReadonlySet<boolean>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Recursively collect every `curve` tag (linear / stepped / bezier-as-object) and every `bendPositive`
// value anywhere in the animation timelines, so curve and bend coverage is read from the actual keyframes.
function walkTimelines(value: unknown, curves: Set<string>, bends: Set<boolean>): void {
  if (Array.isArray(value)) {
    for (const element of value) walkTimelines(element, curves, bends);
    return;
  }
  if (!isRecord(value)) return;
  const curve = value['curve'];
  if (typeof curve === 'string') curves.add(curve);
  else if (isRecord(curve)) curves.add('bezier');
  const bend = value['bendPositive'];
  if (typeof bend === 'boolean') bends.add(bend);
  for (const child of Object.values(value)) walkTimelines(child, curves, bends);
}

function rigFeatures(rigId: RigId): RigFeatures {
  const doc = loadRig(rigId);
  let hasWeightedMesh = false;
  let hasUnweightedMesh = false;
  for (const skin of doc.skins) {
    for (const slotAttachments of Object.values(skin.attachments)) {
      for (const attachment of Object.values(slotAttachments)) {
        if (isRecord(attachment) && attachment['type'] === 'mesh') {
          // A weighted mesh stores more vertex numbers than 2-per-UV (the LBS bone-index/weight encoding);
          // an unweighted mesh stores exactly 2 positions per UV.
          const vertices = attachment['vertices'];
          const uvs = attachment['uvs'];
          if (Array.isArray(vertices) && Array.isArray(uvs) && vertices.length > uvs.length) {
            hasWeightedMesh = true;
          } else {
            hasUnweightedMesh = true;
          }
        }
      }
    }
  }
  let hasDeform = false;
  for (const animation of Object.values(doc.animations)) {
    if (
      isRecord(animation) &&
      isRecord(animation['deform']) &&
      Object.keys(animation['deform']).length > 0
    ) {
      hasDeform = true;
    }
  }
  const curves = new Set<string>();
  const bends = new Set<boolean>();
  walkTimelines(doc.animations, curves, bends);
  return {
    hasIk: doc.ikConstraints.length > 0,
    hasTransformConstraint: doc.transformConstraints.length > 0,
    hasWeightedMesh,
    hasUnweightedMesh,
    hasDeform,
    curves,
    bendPositiveValues: bends,
  };
}

const FEATURES: ReadonlyMap<RigId, RigFeatures> = new Map(
  LANDED_RIG_IDS.map((id) => [id, rigFeatures(id)]),
);

function someRig(predicate: (f: RigFeatures) => boolean): boolean {
  for (const features of FEATURES.values()) if (predicate(features)) return true;
  return false;
}

describe('A.2 reference-rig coverage (phase-5 TASK-5.5.8, the shared-core compensating control)', () => {
  // --- Branches OBSERVABLE in the current fixture schema (bone affines + mesh vertices): each MUST be
  // exercised by a landed rig, or it has zero cross-implementation verification under the shared C# core.

  it('timeline sampling exercises all three curve types (linear, stepped, bezier)', () => {
    const curves = new Set<string>();
    for (const f of FEATURES.values()) for (const c of f.curves) curves.add(c);
    expect(curves.has('linear')).toBe(true);
    expect(curves.has('stepped')).toBe(true);
    expect(curves.has('bezier')).toBe(true);
  });

  it('two-bone IK exercises BOTH bend directions (bendPositive true and false)', () => {
    const bends = new Set<boolean>();
    for (const f of FEATURES.values()) for (const b of f.bendPositiveValues) bends.add(b);
    expect(bends.has(true)).toBe(true);
    expect(bends.has(false)).toBe(true);
  });

  it('a one-bone or two-bone IK constraint is exercised', () => {
    expect(someRig((f) => f.hasIk)).toBe(true);
  });

  it('IK-then-transform order is exercised by a rig carrying BOTH an IK and a transform constraint', () => {
    expect(someRig((f) => f.hasIk && f.hasTransformConstraint)).toBe(true);
  });

  it('LBS skinning is exercised for both weighted and unweighted (rigid) meshes', () => {
    expect(someRig((f) => f.hasWeightedMesh)).toBe(true);
    expect(someRig((f) => f.hasUnweightedMesh)).toBe(true);
  });

  it('deform-after-skin is exercised by a deform timeline on a mesh', () => {
    expect(someRig((f) => f.hasDeform)).toBe(true);
  });

  // Closed by PP-B1: rig-transform-modes exercises all five modes under a rotated, non-uniformly-scaled,
  // reflected animated parent. The fixture records the per-bone world basis, so a runtime that treats a
  // non-normal mode as `normal` produces a basis matching the normal child and FAILS this assertion. The
  // t=1.0 sample is the maximally-transformed frame (parent rotation 45 degrees, scaleX 1.5, scaleY
  // -0.7, so det < 0: rotated AND non-uniform AND reflected, satisfying the A.2 parent conditions).
  it('every non-normal transformMode (onlyTranslation/noRotationOrReflection/noScale/noScaleOrReflection) is observably exercised', () => {
    const fixture = loadFixture('rig-transform-modes');
    const sample = fixture.samples.find((s) => s.time === 1.0);
    expect(sample, 'rig-transform-modes must sample the fully-transformed t=1.0 frame').toBeDefined();
    const bones = sample!.bones;

    // The A.2 parent conditions, read off the captured parent basis so the test documents what it tests:
    // nontrivial rotation (>= 30 degrees), non-uniform scale (column-magnitude ratio outside [0.8, 1.25]),
    // and reflection (det < 0) so the noScaleOrReflection reflection-removal branch is reachable.
    const parent = bones['parent']!;
    const parentScaleX = Math.hypot(parent[0]!, parent[1]!);
    const parentScaleY = Math.hypot(parent[2]!, parent[3]!);
    const parentRotationDeg = Math.abs((Math.atan2(parent[1]!, parent[0]!) * 180) / Math.PI);
    const parentDet = parent[0]! * parent[3]! - parent[1]! * parent[2]!;
    expect(parentRotationDeg).toBeGreaterThanOrEqual(30);
    const scaleRatio = parentScaleX / parentScaleY;
    expect(scaleRatio < 0.8 || scaleRatio > 1.25).toBe(true);
    expect(parentDet).toBeLessThan(0);

    const normal = bones['child_normal']!;
    for (const child of [
      'child_only_translation',
      'child_no_rotation_or_reflection',
      'child_no_scale',
      'child_no_scale_or_reflection',
    ] as const) {
      expect(basisMaxDiff(bones[child]!, normal), `${child} vs child_normal`).toBeGreaterThan(
        BUG_EPSILON,
      );
    }

    // The reflection-removal branch itself: under the reflected parent, noScaleOrReflection must differ
    // from noScale (which keeps the reflection), so the `det < 0` sub-branch of worldFromParentByMode is
    // observed, not merely present. The complementary non-reflected path (noScale == noScaleOrReflection)
    // is exercised at the t=0.25 sample, where the parent scaleY is still positive.
    expect(
      basisMaxDiff(bones['child_no_scale']!, bones['child_no_scale_or_reflection']!),
      'noScale vs noScaleOrReflection under a reflected parent',
    ).toBeGreaterThan(BUG_EPSILON);
  });

  // Closed by PP-B1: rig-blendmodes carries the four blend modes on four slots and animates each slot's
  // color, and the fixture schema captures per-slot blendMode (discrete) + resolved color. This makes
  // solve-order step 6 (per-slot blend mode and color) observable to conformance.
  it('all four slot blend modes (normal/additive/multiply/screen) are observably exercised', () => {
    const fixture = loadFixture('rig-blendmodes');
    const observed = new Set<string>();
    for (const sample of fixture.samples) {
      for (const slot of sample.slots ?? []) observed.add(slot.blendMode);
    }
    expect(observed).toEqual(new Set(['normal', 'additive', 'multiply', 'screen']));

    // Slot color animation is observable: at least one captured slot's color changes between the first
    // and the t=1.0 sample (a static setup-pose capture would leave every color unchanged).
    const first = fixture.samples.find((s) => s.time === 0)!;
    const last = fixture.samples.find((s) => s.time === 1.0)!;
    const colorByName = (slots: NonNullable<typeof first.slots>) =>
      new Map(slots.map((s) => [s.slot, s.color] as const));
    const firstColors = colorByName(first.slots!);
    const lastColors = colorByName(last.slots!);
    const someColorMoved = [...firstColors].some(([name, color]) =>
      color.some((c, lane) => Math.abs(c - lastColors.get(name)![lane]!) > BUG_EPSILON),
    );
    expect(someColorMoved, 'at least one slot color must animate over the clip').toBe(true);
  });

  // --- Branches NOT YET observable: each is blocked on a named, deferred piece of work (owned by other
  // lanes) and is recorded here as a pending todo so it cannot be silently forgotten. When its blocker
  // lands, the todo becomes a real assertion. These are the remaining items before the native runtimes
  // (WP-5.3/5.4) can be trusted (every unexercised branch has zero cross-implementation verification).

  // Blocked on: a format MINOR bump (0.2.0 -> 0.3.0, Lane A PP-A1) adding the drawOrder animation
  // timeline + the fixture-schema drawOrder capture + the compare-engine drawOrder check, then the
  // draw-order application in the solve (Lane B PP-B4) and a rig-events-draworder.
  it.todo('a draw-order reorder timeline is observably exercised');

  // Blocked on: a format MINOR bump (0.2.0 -> 0.3.0, Lane A PP-A1) adding the event timeline + EventDef
  // root + the fixture-schema events capture + the cross-loop event sampling (A.4), then the event
  // firing in the solve (Lane B PP-B4) and rig-events-draworder / rig-events-loop.
  it.todo('event firing, including across a loop boundary, is observably exercised');
});
