import {
  buildPose,
  MAT2X3_STRIDE,
  sampleMeshVertices,
  sampleSkeleton,
  SLOT_COLOR_STRIDE,
} from '@marionette/runtime-core';
import type { SkeletonDocument } from '@marionette/format/types';
import type { Affine, Fixture, FixtureSample, MeshVertices, SlotState } from './schema/fixture';
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

// Resolve the pose slot index and the document blend mode for each slot name the spec asks to capture,
// once, before the sample loop (PP-B1, rig-blendmodes). A name that is not a slot fails loudly (Law 3):
// a bad capture request is an authoring error in the sample-spec, never a silently dropped slot. The
// order mirrors spec.slots so the emitted `slots` array (and its diff) is stable and author-controlled.
interface SlotCaptureTarget {
  readonly name: string;
  readonly poseIndex: number;
  readonly blendMode: SlotState['blendMode'];
}

function resolveSlotCaptureTargets(
  document: SkeletonDocument,
  slotNames: readonly string[],
): SlotCaptureTarget[] {
  const poseIndexByName = new Map<string, number>();
  document.slots.forEach((slot, index) => poseIndexByName.set(slot.name, index));
  const blendModeByName = new Map(document.slots.map((slot) => [slot.name, slot.blendMode]));
  return slotNames.map((name) => {
    const poseIndex = poseIndexByName.get(name);
    const blendMode = blendModeByName.get(name);
    if (poseIndex === undefined || blendMode === undefined) {
      throw new Error(`sample-spec names slot "${name}" to capture, but the rig has no such slot`);
    }
    return { name, poseIndex, blendMode };
  });
}

// Sample the document at every poseTime in the spec and capture the per-bone world affines. The pose
// buffer is allocated once and reused across times (runtime-core writes into it in place), matching the
// allocation-free solve contract. Bones are emitted in document order (pose.boneNames order, which the
// format validator guarantees is parent-before-child), so JSON key order is stable for diffs (A.3).
export function buildFixtureSamples(document: SkeletonDocument, spec: SampleSpec): FixtureSample[] {
  const pose = buildPose(document);
  const samples: FixtureSample[] = [];
  // Slot capture targets (blend mode + resolved color), resolved once. Empty when the spec omits slots,
  // so bone-only and mesh-only rigs never gain a `slots` member and their fixtures stay byte-identical.
  const slotTargets =
    spec.slots !== undefined && spec.slots.length > 0
      ? resolveSlotCaptureTargets(document, spec.slots)
      : [];
  // Mesh-vertex sampling reuses one scratch buffer across all times and meshes (allocation-free contract);
  // it is sized to the largest sampled mesh once. The spec.meshes order is normalized to a deterministic
  // (skin, slot, attachment) sort so the emitted JSON is stable for diffs regardless of authoring order.
  const meshTargets = [...(spec.meshes ?? [])].sort(
    (a, b) =>
      (a.skin < b.skin ? -1 : a.skin > b.skin ? 1 : 0) ||
      (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0) ||
      (a.attachment < b.attachment ? -1 : a.attachment > b.attachment ? 1 : 0),
  );
  const vertexScratch = meshTargets.length > 0 ? new Float32Array(maxMeshLanes(document)) : null;
  for (const time of spec.poseTimes) {
    sampleSkeleton(document, spec.animation, time, pose);
    const bones: Record<string, Affine> = {};
    for (let i = 0; i < pose.boneNames.length; i += 1) {
      bones[pose.boneNames[i]!] = readAffine(pose.world, i);
    }
    const sample: FixtureSample = { time, animation: spec.animation, loop: spec.loop, bones };
    if (meshTargets.length > 0 && vertexScratch !== null) {
      const meshes: MeshVertices[] = [];
      for (const target of meshTargets) {
        // sampleMeshVertices reuses the pose just solved at `time` (no re-solve), skinning then adding
        // deform into vertexScratch and returning the logical vertex count.
        const count = sampleMeshVertices(
          document,
          spec.animation,
          time,
          pose,
          target.skin,
          target.slot,
          target.attachment,
          vertexScratch,
        );
        const positions: number[] = [];
        for (let lane = 0; lane < count * 2; lane += 1) positions.push(vertexScratch[lane]!);
        meshes.push({
          skin: target.skin,
          slot: target.slot,
          attachment: target.attachment,
          positions,
        });
      }
      sample.meshes = meshes;
    }
    if (slotTargets.length > 0) {
      // Read the resolved color sampleSkeleton just wrote into pose.slotColor (setup color for a slot
      // with no color timeline, the blended value otherwise). Blend mode is a static document property.
      const slots: SlotState[] = slotTargets.map((target) => {
        const base = target.poseIndex * SLOT_COLOR_STRIDE;
        return {
          slot: target.name,
          blendMode: target.blendMode,
          color: [
            pose.slotColor[base]!,
            pose.slotColor[base + 1]!,
            pose.slotColor[base + 2]!,
            pose.slotColor[base + 3]!,
          ],
        };
      });
      sample.slots = slots;
    }
    samples.push(sample);
  }
  return samples;
}

// The largest 2 * vertexCount across every mesh attachment in the document, used to size the reused
// vertex scratch once. A mesh's vertex count is uvs.length / 2, so the lane count is uvs.length.
function maxMeshLanes(document: SkeletonDocument): number {
  let max = 0;
  for (const skin of document.skins) {
    for (const slotAttachments of Object.values(skin.attachments)) {
      for (const attachment of Object.values(slotAttachments)) {
        if (attachment.type === 'mesh' && attachment.uvs.length > max) max = attachment.uvs.length;
      }
    }
  }
  return max;
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
