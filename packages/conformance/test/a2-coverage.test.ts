import { describe, expect, it } from 'vitest';
import { LANDED_RIG_IDS } from '../src/registry';
import { loadRig } from '../src/io';
import type { RigId } from '../src/registry';

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
    if (isRecord(animation) && isRecord(animation['deform']) && Object.keys(animation['deform']).length > 0) {
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

  // --- Branches NOT YET observable: each is blocked on a named, deferred piece of work and is recorded
  // here as a pending todo so it cannot be silently forgotten. When its blocker lands, the todo becomes a
  // real assertion above. These are the remaining G5.3 items before the native runtimes (WP-5.3/5.4) can
  // be trusted (every unexercised branch has zero cross-implementation verification under the shared core).

  // Blocked on: implementing bone transformMode inheritance in the runtime-core world-transform solve
  // (the format schema already carries bone.transformMode; the solve currently ignores it, so every bone
  // resolves as 'normal'). Then author rig-transform-modes and assert each non-normal mode differs from
  // 'normal' by > 1e-2 under a rotated, non-uniformly-scaled parent.
  it.todo('every non-normal transformMode (onlyTranslation/noRotationOrReflection/noScale/noScaleOrReflection) is observably exercised');

  // Blocked on: a format MINOR bump (0.2.0 -> 0.3.0) adding the drawOrder animation timeline + the
  // fixture-schema drawOrder capture + the compare-engine drawOrder check, then a rig-events-draworder.
  it.todo('a draw-order reorder timeline is observably exercised');

  // Blocked on: a format MINOR bump (0.2.0 -> 0.3.0) adding the event timeline + EventDef root + the
  // fixture-schema events capture + the cross-loop event sampling (A.4), then rig-events-draworder and
  // rig-events-loop.
  it.todo('event firing, including across a loop boundary, is observably exercised');

  // Blocked on: extending the fixture schema to capture per-slot blendMode + color (a presentation
  // surface the current solve fixture does not record), the compare-engine discrete blendMode check, then
  // a rig-blendmodes exercising all four blend modes.
  it.todo('all four slot blend modes (normal/additive/multiply/screen) are observably exercised');
});
