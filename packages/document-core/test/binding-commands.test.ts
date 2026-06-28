import { decodeWeightedVertices } from '@marionette/format';
import type { MeshAttachment, SkeletonDocument } from '@marionette/format/types';
import {
  buildPose,
  computeWorldTransforms,
  MAT2X3_STRIDE,
  resetToSetupPose,
  solveSkin,
  solveSkinUnweighted,
  type Mat2x3,
  type Pose,
} from '@marionette/runtime-core';
import { describe, expect, it } from 'vitest';
import {
  AddBoneToMeshBindingCommand,
  BindMeshToBonesCommand,
  CreateBoneCommand,
  exportDocument,
  loadDocument,
  MeshBindingError,
  RemoveBoneFromMeshBindingCommand,
  UnbindMeshCommand,
  type BoneId,
  type Document,
  type SlotId,
} from '../src';
import { makeTestEnv, seeds } from './seeds';

function unweightedMeshTarget(doc: Document): { slotId: SlotId; name: string; slotName: string } {
  for (const slot of doc.model.slots()) {
    const att = doc.model
      .attachments(slot.id)
      .find((a) => a.kind === 'mesh' && a.bones === undefined);
    if (att && att.kind === 'mesh') return { slotId: slot.id, name: att.name, slotName: slot.name };
  }
  throw new Error('no unweighted mesh in seed');
}

function findMesh(doc: SkeletonDocument, slotName: string, attName: string): MeshAttachment {
  const skin = doc.skins.find((s) => s.name === 'default');
  const att = skin?.attachments[slotName]?.[attName];
  if (att === undefined || att.type !== 'mesh') throw new Error('mesh not found in exported doc');
  return att;
}

function boneWorld(pose: Pose, name: string): Mat2x3 {
  const index = pose.boneNames.indexOf(name);
  const base = index * MAT2X3_STRIDE;
  return [
    pose.world[base]!,
    pose.world[base + 1]!,
    pose.world[base + 2]!,
    pose.world[base + 3]!,
    pose.world[base + 4]!,
    pose.world[base + 5]!,
  ];
}

function solvedPose(doc: SkeletonDocument): Pose {
  const pose = buildPose(doc);
  resetToSetupPose(pose);
  computeWorldTransforms(pose);
  return pose;
}

describe('BindMeshToBones', () => {
  it('converts an unweighted mesh to the weighted encoding and undo restores it exactly', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.meshed, env);
    const { slotId, name } = unweightedMeshTarget(doc);
    const before = doc.model.snapshot();

    const boneIds = doc.model.bones().map((b) => b.id);
    doc.history.execute(new BindMeshToBonesCommand(slotId, name, boneIds, 'equalSplit'));

    const bound = doc.model.getAttachment(slotId, name);
    expect(bound?.kind).toBe('mesh');
    if (bound?.kind === 'mesh') expect(bound.bones).toBeDefined();

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before); // unweighted mesh restored exactly
    const restored = doc.model.getAttachment(slotId, name);
    if (restored?.kind === 'mesh') expect(restored.bones).toBeUndefined();
  });

  it('preserves the setup pose: solveSkin reproduces the unweighted world positions (TASK-2.3.2)', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.meshed, env);
    const { slotId, name, slotName } = unweightedMeshTarget(doc);

    // Original unweighted world positions: slotBoneWorld * each flat (x, y).
    const exportedBefore = exportDocument(doc.model);
    const meshBefore = findMesh(exportedBefore, slotName, name);
    const poseBefore = solvedPose(exportedBefore);
    const slotBone = exportedBefore.slots.find((s) => s.name === slotName)!.bone;
    const slotWorld = boneWorld(poseBefore, slotBone);
    const unweightedOut = new Float32Array(meshBefore.vertices.length);
    solveSkinUnweighted(meshBefore, slotWorld, unweightedOut);

    doc.history.execute(
      new BindMeshToBonesCommand(
        slotId,
        name,
        doc.model.bones().map((b) => b.id),
        'equalSplit',
      ),
    );

    // Weighted skin at setup pose must reproduce those positions within the conformance tolerance.
    const exportedAfter = exportDocument(doc.model);
    const meshAfter = findMesh(exportedAfter, slotName, name);
    expect(meshAfter.bones).toBeDefined();
    const poseAfter = solvedPose(exportedAfter);
    const weightedOut = new Float32Array(unweightedOut.length);
    solveSkin(meshAfter, poseAfter.world, weightedOut);

    for (let i = 0; i < unweightedOut.length; i += 1) {
      expect(weightedOut[i]).toBeCloseTo(unweightedOut[i]!, 4);
    }
  });

  it('rigidNearest gives every vertex a single influence of weight 1', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.meshed, env);
    const { slotId, name } = unweightedMeshTarget(doc);

    doc.history.execute(
      new BindMeshToBonesCommand(
        slotId,
        name,
        doc.model.bones().map((b) => b.id),
        'rigidNearest',
      ),
    );

    const mesh = doc.model.getAttachment(slotId, name);
    expect(mesh?.kind).toBe('mesh');
    if (mesh?.kind === 'mesh') {
      const bindings = decodeWeightedVertices({ vertices: [...mesh.vertices] });
      for (const influences of bindings) {
        expect(influences).toHaveLength(1);
        expect(influences[0]!.weight).toBe(1);
      }
    }
  });

  it('caps influences at four when binding to more than four bones (TASK-2.3.4)', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.meshed, env);
    const { slotId, name } = unweightedMeshTarget(doc);
    const root = doc.model.bones()[0]!;

    const boneIds: BoneId[] = doc.model.bones().map((b) => b.id);
    for (let k = 0; k < 4; k += 1) {
      const id = doc.ids.mint('bone');
      doc.history.execute(
        new CreateBoneCommand(id, root.id, {
          name: `extra${k}`,
          length: 10,
          x: 10 * (k + 1),
          y: 5 * (k + 1),
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          shearX: 0,
          shearY: 0,
          transformMode: 'normal',
        }),
      );
      boneIds.push(id);
    }
    expect(boneIds.length).toBeGreaterThan(4);

    doc.history.execute(new BindMeshToBonesCommand(slotId, name, boneIds, 'equalSplit'));

    const mesh = doc.model.getAttachment(slotId, name);
    if (mesh?.kind === 'mesh') {
      const bindings = decodeWeightedVertices({ vertices: [...mesh.vertices] });
      for (const influences of bindings) {
        expect(influences.length).toBeLessThanOrEqual(4);
        expect(influences.reduce((s, i) => s + i.weight, 0)).toBeCloseTo(1, 6);
      }
    }
  });

  it('rejects an empty bone set and an already-weighted mesh', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.meshed, env);
    const { slotId, name } = unweightedMeshTarget(doc);

    expect(() =>
      doc.history.execute(new BindMeshToBonesCommand(slotId, name, [], 'rigidNearest')),
    ).toThrow(MeshBindingError);

    doc.history.execute(
      new BindMeshToBonesCommand(
        slotId,
        name,
        doc.model.bones().map((b) => b.id),
        'equalSplit',
      ),
    );
    expect(() =>
      doc.history.execute(
        new BindMeshToBonesCommand(
          slotId,
          name,
          doc.model.bones().map((b) => b.id),
          'equalSplit',
        ),
      ),
    ).toThrow(MeshBindingError); // alreadyWeighted
  });

  it('rejects binding to a bone not in the document', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.meshed, env);
    const { slotId, name } = unweightedMeshTarget(doc);
    const ghost = doc.ids.mint('bone'); // a valid BoneId brand that no bone owns

    const before = doc.model.snapshot();
    expect(() =>
      doc.history.execute(new BindMeshToBonesCommand(slotId, name, [ghost], 'rigidNearest')),
    ).toThrow(MeshBindingError);
    expect(doc.model.snapshot()).toEqual(before); // nothing mutated
    expect(doc.history.canUndo).toBe(false);
  });
});

describe('UnbindMesh', () => {
  it('returns a bound mesh to the flat encoding rendering identically at setup pose', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.meshed, env);
    const { slotId, name, slotName } = unweightedMeshTarget(doc);

    // World positions of the original unweighted mesh.
    const before = exportDocument(doc.model);
    const meshBefore = findMesh(before, slotName, name);
    const poseBefore = solvedPose(before);
    const slotBone = before.slots.find((s) => s.name === slotName)!.bone;
    const original = new Float32Array(meshBefore.vertices.length);
    solveSkinUnweighted(meshBefore, boneWorld(poseBefore, slotBone), original);

    doc.history.execute(
      new BindMeshToBonesCommand(
        slotId,
        name,
        doc.model.bones().map((b) => b.id),
        'equalSplit',
      ),
    );
    doc.history.execute(new UnbindMeshCommand(slotId, name));

    const unbound = doc.model.getAttachment(slotId, name);
    expect(unbound?.kind).toBe('mesh');
    if (unbound?.kind === 'mesh') expect(unbound.bones).toBeUndefined();

    const after = exportDocument(doc.model);
    const meshAfter = findMesh(after, slotName, name);
    const poseAfter = solvedPose(after);
    const reproduced = new Float32Array(meshAfter.vertices.length);
    solveSkinUnweighted(meshAfter, boneWorld(poseAfter, slotBone), reproduced);

    expect(reproduced.length).toBe(original.length);
    for (let i = 0; i < original.length; i += 1) {
      expect(reproduced[i]).toBeCloseTo(original[i]!, 4);
    }
  });

  it('rejects unbinding an unweighted mesh', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.meshed, env);
    const { slotId, name } = unweightedMeshTarget(doc);
    expect(() => doc.history.execute(new UnbindMeshCommand(slotId, name))).toThrow(
      MeshBindingError,
    );
  });
});

describe('Add/Remove bone binding', () => {
  it('adding then removing a bone returns to a weighted mesh and re-normalizes', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.weighted, env);
    const slot = doc.model.slots()[0]!;
    const mesh = doc.model.attachments(slot.id).find((a) => a.kind === 'mesh');
    if (!mesh || mesh.kind !== 'mesh' || mesh.bones === undefined)
      throw new Error('seed not weighted');
    const bones = doc.model.bones();
    const unbound = bones.find((_b, index) => !mesh.bones!.includes(index))!; // 'tip'

    doc.history.execute(new AddBoneToMeshBindingCommand(slot.id, mesh.name, unbound.id));
    const added = doc.model.getAttachment(slot.id, mesh.name);
    if (added?.kind === 'mesh') expect(added.bones).toContain(bones.indexOf(unbound));

    doc.history.execute(new RemoveBoneFromMeshBindingCommand(slot.id, mesh.name, unbound.id));
    const removed = doc.model.getAttachment(slot.id, mesh.name);
    if (removed?.kind === 'mesh') {
      expect(removed.bones).not.toContain(bones.indexOf(unbound));
      const bindings = decodeWeightedVertices({ vertices: [...removed.vertices] });
      for (const influences of bindings) {
        expect(influences.reduce((s, i) => s + i.weight, 0)).toBeCloseTo(1, 4);
      }
    }
  });

  it('rejects removing the only bound bone (use UnbindMesh) with reason lastBone', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.meshed, env);
    const { slotId, name } = unweightedMeshTarget(doc);
    const onlyBone = doc.model.bones()[0]!;

    doc.history.execute(new BindMeshToBonesCommand(slotId, name, [onlyBone.id], 'rigidNearest'));
    expect(() =>
      doc.history.execute(new RemoveBoneFromMeshBindingCommand(slotId, name, onlyBone.id)),
    ).toThrow(expect.objectContaining({ name: 'MeshBindingError', reason: 'lastBone' }));
  });
});
