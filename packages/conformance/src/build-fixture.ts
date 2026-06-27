import { buildPose, MAT2X3_STRIDE, sampleSkeleton } from '@marionette/runtime-core';
import type { SkeletonDocument } from '@marionette/format/types';
import type { Affine, Fixture, FixtureSample } from './schema/fixture';
import type { SampleSpec } from './schema/sample-spec';

// The pure fixture builder (conformance-and-ci.md A.6, WP-V.2). This is the behavioral source of truth
// (INV-2): it imports @marionette/runtime-core and @marionette/format types ONLY, no filesystem, no
// clock, no random. It runs the canonical solve (runtime-core sampleSkeleton, the locked solve order
// steps 1 to 4) over a validated rig at the committed sample-spec times and records, per A.3, ONLY the
// canonical raw world affine [a, b, c, d, tx, ty] per bone in document order. It does NOT store
// decomposed rotation or a separately computed tip; tip/world data is the affine alone, because
// atan2/acos differ across language math libs. generate.ts wraps this with file I/O and provenance.

// Provenance recorded on the fixture (A.3). None of it participates in comparison; it exists for
// review (which rig/spec/toolchain produced this fixture) and for the .fixtures.lock drift gate.
export interface FixtureProvenance {
  readonly rigId: string;
  readonly rigHash: string;
  readonly specHash: string;
  readonly coreVersion: string;
  readonly toolchain: string;
  readonly generatedBy: string;
}

// Read one bone's world affine out of the packed Float64Array (stride MAT2X3_STRIDE = 6). The offsets
// are in-bounds by construction (the pose is sized to boneCount * MAT2X3_STRIDE), so the reads are
// non-null; the assertions mirror runtime-core's hot-path style.
function readAffine(world: Float64Array, boneIndex: number): Affine {
  const o = boneIndex * MAT2X3_STRIDE;
  return [world[o]!, world[o + 1]!, world[o + 2]!, world[o + 3]!, world[o + 4]!, world[o + 5]!];
}

// Sample the document at every poseTime in the spec and capture the per-bone world affines. The pose
// buffer is allocated once and reused across times (runtime-core writes into it in place), matching the
// allocation-free solve contract. Bones are emitted in document order (pose.boneNames order, which the
// format validator guarantees is parent-before-child), so JSON key order is stable for diffs (A.3).
export function buildFixtureSamples(document: SkeletonDocument, spec: SampleSpec): FixtureSample[] {
  const pose = buildPose(document);
  const samples: FixtureSample[] = [];
  for (const time of spec.poseTimes) {
    sampleSkeleton(document, spec.animation, time, pose);
    const bones: Record<string, Affine> = {};
    for (let i = 0; i < pose.boneNames.length; i += 1) {
      bones[pose.boneNames[i]!] = readAffine(pose.world, i);
    }
    samples.push({ time, animation: spec.animation, loop: spec.loop, bones });
  }
  return samples;
}

export function buildFixture(
  document: SkeletonDocument,
  spec: SampleSpec,
  provenance: FixtureProvenance,
): Fixture {
  return {
    rigId: provenance.rigId,
    rigHash: provenance.rigHash,
    specHash: provenance.specHash,
    coreVersion: provenance.coreVersion,
    toolchain: provenance.toolchain,
    generatedBy: provenance.generatedBy,
    samples: buildFixtureSamples(document, spec),
  };
}
