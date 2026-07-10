import {
  boundingBoxWorldVerticesForSlot,
  buildPose,
  collectFiredEvents,
  computeClippedSlotRange,
  hitTestPolygon,
  makeEventQueue,
  MAT2X3_STRIDE,
  prepareEventTimeline,
  resolveClipWorldPolygonForSlot,
  resolvePointWorldForSlot,
  sampleMeshVertices,
  sampleSkeleton,
  sampleSlotSequenceFrame,
  SLOT_COLOR_STRIDE,
} from '@marionette/runtime-core';
import type { FiredEvent } from '@marionette/runtime-core';
import type {
  Attachment,
  BoundingBoxAttachment,
  ClippingAttachment,
  PointAttachment,
  SkeletonDocument,
} from '@marionette/format/types';
import type {
  Affine,
  BoundingBoxState,
  ClipState,
  FiredEventRecord,
  Fixture,
  FixtureSample,
  MeshVertices,
  PointState,
  SequenceState,
  SlotState,
} from './schema/fixture';
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

// Look up an attachment by (skin, slot, attachment), failing loud (Law 3) when the sample-spec names one the
// rig does not define: a bad capture request is an authoring error in the spec, never silently dropped.
function lookupCaptureAttachment(
  document: SkeletonDocument,
  skinName: string,
  slotName: string,
  attachmentName: string,
): Attachment {
  const skin = document.skins.find((candidate) => candidate.name === skinName);
  const attachment = skin?.attachments[slotName]?.[attachmentName];
  if (attachment === undefined) {
    throw new Error(
      `sample-spec names attachment "${skinName}/${slotName}/${attachmentName}" to capture, but the rig has no such attachment`,
    );
  }
  return attachment;
}

function slotIndexOf(document: SkeletonDocument, slotName: string): number {
  const index = document.slots.findIndex((slot) => slot.name === slotName);
  if (index < 0)
    throw new Error(`sample-spec names slot "${slotName}", but the rig has no such slot`);
  return index;
}

// A resolved clip-capture target (PP-B2): the clip attachment plus its slot index and its `end` slot index,
// with a reused world-polygon scratch sized to the polygon (2 * V lanes).
interface ClipCaptureTarget {
  readonly skin: string;
  readonly slot: string;
  readonly attachment: string;
  readonly clip: ClippingAttachment;
  readonly clipSlotIndex: number;
  readonly endSlotIndex: number;
  readonly polygonScratch: Float64Array;
}

function resolveClipTargets(document: SkeletonDocument, spec: SampleSpec): ClipCaptureTarget[] {
  return (spec.clips ?? []).map((target) => {
    const attachment = lookupCaptureAttachment(
      document,
      target.skin,
      target.slot,
      target.attachment,
    );
    if (attachment.type !== 'clipping') {
      throw new Error(
        `sample-spec captures clip "${target.skin}/${target.slot}/${target.attachment}", but it is a ${attachment.type}, not a clipping attachment`,
      );
    }
    return {
      skin: target.skin,
      slot: target.slot,
      attachment: target.attachment,
      clip: attachment,
      clipSlotIndex: slotIndexOf(document, target.slot),
      endSlotIndex: slotIndexOf(document, attachment.end),
      polygonScratch: new Float64Array(attachment.vertices.length),
    };
  });
}

interface BoxCaptureTarget {
  readonly skin: string;
  readonly slot: string;
  readonly attachment: string;
  readonly box: BoundingBoxAttachment;
  readonly slotIndex: number;
  readonly vertexScratch: Float64Array;
}

function resolveBoxTargets(document: SkeletonDocument, spec: SampleSpec): BoxCaptureTarget[] {
  return (spec.boxes ?? []).map((target) => {
    const attachment = lookupCaptureAttachment(
      document,
      target.skin,
      target.slot,
      target.attachment,
    );
    if (attachment.type !== 'boundingbox') {
      throw new Error(
        `sample-spec captures box "${target.skin}/${target.slot}/${target.attachment}", but it is a ${attachment.type}, not a boundingbox attachment`,
      );
    }
    return {
      skin: target.skin,
      slot: target.slot,
      attachment: target.attachment,
      box: attachment,
      slotIndex: slotIndexOf(document, target.slot),
      vertexScratch: new Float64Array(attachment.vertices.length),
    };
  });
}

interface PointCaptureTarget {
  readonly skin: string;
  readonly slot: string;
  readonly attachment: string;
  readonly point: PointAttachment;
  readonly slotIndex: number;
}

function resolvePointTargets(document: SkeletonDocument, spec: SampleSpec): PointCaptureTarget[] {
  return (spec.points ?? []).map((target) => {
    const attachment = lookupCaptureAttachment(
      document,
      target.skin,
      target.slot,
      target.attachment,
    );
    if (attachment.type !== 'point') {
      throw new Error(
        `sample-spec captures point "${target.skin}/${target.slot}/${target.attachment}", but it is a ${attachment.type}, not a point attachment`,
      );
    }
    return {
      skin: target.skin,
      slot: target.slot,
      attachment: target.attachment,
      point: attachment,
      slotIndex: slotIndexOf(document, target.slot),
    };
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
  // PP-B2 geometry-attachment capture targets (ADR-0012), resolved once. Each is empty unless the spec opts
  // in, so no non-PP-B2 fixture gains a clips/boxes/points member and every prior fixture stays byte-identical.
  const clipTargets = resolveClipTargets(document, spec);
  const boxTargets = resolveBoxTargets(document, spec);
  const pointTargets = resolvePointTargets(document, spec);
  const hitProbes = spec.hitProbes ?? [];
  const clippedSlotScratch = new Int32Array(document.slots.length);
  // Per-sample active skin for skin-scoped constraints (rig-skin-scoped). Must align with poseTimes when
  // present; a bad spec fails loudly (Law 3) rather than silently sampling the wrong skin.
  if (spec.activeSkins !== undefined && spec.activeSkins.length !== spec.poseTimes.length) {
    throw new Error(
      `sample-spec activeSkins length ${spec.activeSkins.length} must match poseTimes length ${spec.poseTimes.length}`,
    );
  }
  for (let sampleIndex = 0; sampleIndex < spec.poseTimes.length; sampleIndex += 1) {
    const time = spec.poseTimes[sampleIndex]!;
    const activeSkin = spec.activeSkins?.[sampleIndex] ?? null;
    // The physics frame delta (ADR-0014, PP-B7): the wall-clock time advanced since the previous sample,
    // 0 on the first sample. Physics carries velocity across frames, so a physics rig authors poseTimes as
    // a monotonic sequence of frame times and the solve steps its clock by this delta. Non-physics rigs
    // ignore it (empty physicsConstraints), so every prior fixture regenerates byte-identically.
    const frameDt = sampleIndex === 0 ? 0 : time - spec.poseTimes[sampleIndex - 1]!;
    sampleSkeleton(document, spec.animation, time, pose, activeSkin, frameDt);
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
        const state: SlotState = {
          slot: target.name,
          blendMode: target.blendMode,
          color: [
            pose.slotColor[base]!,
            pose.slotColor[base + 1]!,
            pose.slotColor[base + 2]!,
            pose.slotColor[base + 3]!,
          ],
        };
        // The resolved two-color dark tint, captured only for a slot that enabled two-color tinting
        // (ADR-0011 section 3). A slot without a setup darkColor omits the lane, so pre-slice-6 slot
        // captures stay byte-identical.
        if (pose.slotHasDarkColor[target.poseIndex] === 1) {
          state.dark = [
            pose.slotDarkColor[base]!,
            pose.slotDarkColor[base + 1]!,
            pose.slotDarkColor[base + 2]!,
            pose.slotDarkColor[base + 3]!,
          ];
        }
        return state;
      });
      sample.slots = slots;
    }
    if (spec.captureDrawOrder === true) {
      // The resolved render order sampleSkeleton just wrote into pose.drawOrder (setup order for a frame
      // with no active draw-order key, the reordered permutation otherwise). Copied out as plain integers
      // (renderPosition -> slotIndex) for an EXACT integer compare.
      sample.drawOrder = Array.from(pose.drawOrder);
    }
    if (spec.captureSequences !== undefined && spec.captureSequences.length > 0) {
      // The resolved sequence frame index per named slot (ADR-0011 section 2), in spec order. A slot with
      // no active sequence attachment resolves to -1; it is still recorded so the lane is author-explicit
      // and the diff stable. Reuses the pose just solved at `time` (no re-solve).
      const sequences: SequenceState[] = spec.captureSequences.map((slot) => ({
        slot,
        frame: sampleSlotSequenceFrame(document, spec.animation, time, pose, slot),
      }));
      sample.sequences = sequences;
    }
    if (clipTargets.length > 0) {
      // The resolved clip STATE per named clip attachment (ADR-0012 section 3): the world polygon (VERTEX
      // class) and the clipped slot set (draw-order membership, EXACT), reusing the pose just solved at `time`.
      sample.clips = clipTargets.map((target): ClipState => {
        const vertexCount = resolveClipWorldPolygonForSlot(
          pose,
          target.clipSlotIndex,
          target.clip,
          target.polygonScratch,
        );
        const clippedCount = computeClippedSlotRange(
          pose,
          target.clipSlotIndex,
          target.endSlotIndex,
          clippedSlotScratch,
        );
        const clippedSlots: string[] = [];
        for (let i = 0; i < clippedCount; i += 1)
          clippedSlots.push(pose.slotNames[clippedSlotScratch[i]!]!);
        const worldPolygon: number[] = [];
        for (let lane = 0; lane < vertexCount * 2; lane += 1)
          worldPolygon.push(target.polygonScratch[lane]!);
        return { slot: target.slot, attachment: target.attachment, worldPolygon, clippedSlots };
      });
    }
    if (boxTargets.length > 0) {
      // The resolved bounding-box world vertices (VERTEX) + per-probe even-odd hit results (EXACT).
      sample.boxes = boxTargets.map((target): BoundingBoxState => {
        const vertexCount = boundingBoxWorldVerticesForSlot(
          pose,
          target.slotIndex,
          target.box,
          target.vertexScratch,
        );
        const worldVertices: number[] = [];
        for (let lane = 0; lane < vertexCount * 2; lane += 1)
          worldVertices.push(target.vertexScratch[lane]!);
        const hits = hitProbes.map(([px, py]) =>
          hitTestPolygon(target.vertexScratch, vertexCount, px, py),
        );
        return { slot: target.slot, attachment: target.attachment, worldVertices, hits };
      });
    }
    if (pointTargets.length > 0) {
      // The resolved point world position (VERTEX) + rotation degrees (ANGLE).
      sample.points = pointTargets.map((target): PointState => {
        const world = resolvePointWorldForSlot(pose, target.slotIndex, target.point);
        if (world === null) {
          throw new Error(
            `point "${target.skin}/${target.slot}/${target.attachment}" has no resolvable slot bone`,
          );
        }
        return {
          slot: target.slot,
          attachment: target.attachment,
          x: world.x,
          y: world.y,
          rotation: world.rotationDeg,
        };
      });
    }
    samples.push(sample);
  }
  return samples;
}

// Sweep the sample-spec's eventStep into the ordered fired-event LOG (ADR-0008, PP-B4), resolving each
// event's payload (EventDef default overridden by the key) through runtime-core. Returns undefined when
// the spec sets no eventStep, so a rig without events gains no `events` member and stays byte-identical.
// The animation named by the spec is validated to exist (Law 3): a bad spec fails loudly, never silently.
function buildFiredEvents(
  document: SkeletonDocument,
  spec: SampleSpec,
): FiredEventRecord[] | undefined {
  const step = spec.eventStep;
  if (step === undefined) return undefined;
  const animation = document.animations[spec.animation];
  if (animation === undefined) {
    throw new Error(`sample-spec animation "${spec.animation}" is not defined by the rig`);
  }
  const timeline = prepareEventTimeline(animation, document.events ?? []);
  const records: FiredEventRecord[] = [];
  if (timeline === null) return records;
  const queue = makeEventQueue();
  collectFiredEvents(timeline, step.from, step.to, step.dt, spec.loop, spec.duration, queue);
  for (let i = 0; i < queue.count; i += 1) records.push(firedEventToRecord(queue.events[i]!));
  return records;
}

// Project one pooled FiredEvent into its committed record: name + fire time always, each payload member
// only when the resolved event carries it (so a bare event serializes without empty payload keys).
function firedEventToRecord(event: FiredEvent): FiredEventRecord {
  const record: FiredEventRecord = { name: event.name, time: event.time };
  if (event.hasInt) record.int = event.intValue;
  if (event.hasFloat) record.float = event.floatValue;
  if (event.hasString && event.stringValue !== null) record.string = event.stringValue;
  return record;
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
  const fixture: Fixture = {
    rigId: provenance.rigId,
    rigHash: provenance.rigHash,
    specHash: provenance.specHash,
    coreVersion: provenance.coreVersion,
    toolchain: provenance.toolchain,
    generatedBy: provenance.generatedBy,
    samples: buildFixtureSamples(document, spec),
  };
  const events = buildFiredEvents(document, spec);
  if (events !== undefined) fixture.events = events;
  return fixture;
}
