import { decodeWeightedVertices } from '@marionette/format';
import type {
  Bone,
  MeshAttachment,
  SkeletonDocument,
  Skin,
  TransformConstraint,
} from '@marionette/format/types';
import {
  buildPose,
  computeWorldTransforms,
  resetToSetupPose,
  solveSkin,
} from '@marionette/runtime-core';
import { describe, expect, it } from 'vitest';
import {
  BindMeshToBonesCommand,
  CreateBoneCommand,
  DeleteBoneCommand,
  exportDocument,
  loadDocument,
  ReparentBoneCommand,
  type BoneId,
  type Document,
  type SlotId,
} from '../src';
import { makeTestEnv } from './seeds';

// ADR-0002 addendum regression suite: weighted-mesh vertex streams store GLOBAL bone indices into the
// model's bone order, and creating/reparenting/deleting a bone can move an existing bone's index. Every
// such reorder must remap the streams in the SAME command step so the mesh keeps skinning to the SAME
// bones (by name), the do/undo round-trip stays bit-exact, and an export/load round-trip preserves it.

const WHITE = { r: 1, g: 1, b: 1, a: 1 } as const;

// A root plus root-children at distinct x, an unweighted quad mesh on a slot riding root, and an atlas
// carrying the one referenced region. Root children have distinct world x, so a mis-remap that repoints a
// weighted influence at the wrong bone moves the skinned vertex by a large, unambiguous amount.
function makeDoc(children: readonly string[]): SkeletonDocument {
  const bones: Bone[] = [rootBone()];
  children.forEach((name, i) => bones.push(childBone(name, 50 * (i + 1))));
  const mesh: MeshAttachment = {
    type: 'mesh',
    path: 'skin_panel',
    uvs: [0, 0, 1, 0, 1, 1, 0, 1],
    triangles: [0, 1, 2, 0, 2, 3],
    hullLength: 4,
    width: 64,
    height: 64,
    color: WHITE,
    vertices: [0, 0, 64, 0, 64, 64, 0, 64],
  };
  return {
    formatVersion: '0.1.0',
    name: 'remap',
    hash: '',
    bones,
    slots: [
      { name: 'mesh_slot', bone: 'root', color: WHITE, attachment: 'panel', blendMode: 'normal' },
    ],
    skins: [{ name: 'default', attachments: { mesh_slot: { panel: mesh } } }],
    animations: {},
    atlas: {
      pages: [
        {
          file: 'atlas.png',
          width: 128,
          height: 128,
          regions: [
            {
              name: 'skin_panel',
              x: 0,
              y: 0,
              w: 64,
              h: 64,
              rotated: false,
              offsetX: 0,
              offsetY: 0,
              originalW: 64,
              originalH: 64,
            },
          ],
        },
      ],
    },
  };
}

function rootBone(): Bone {
  return baseBone('root', null, 0);
}

function childBone(name: string, x: number): Bone {
  return baseBone(name, 'root', x);
}

function baseBone(name: string, parent: string | null, x: number): Bone {
  return {
    name,
    parent,
    length: 40,
    x,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    shearX: 0,
    shearY: 0,
    transformMode: 'normal',
  };
}

function boneGeom(name: string, x: number): ConstructorParameters<typeof CreateBoneCommand>[2] {
  return {
    name,
    length: 40,
    x,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    shearX: 0,
    shearY: 0,
    transformMode: 'normal',
  };
}

const PANEL = { name: 'panel', slotName: 'mesh_slot' } as const;

function meshSlotId(doc: Document): SlotId {
  const slot = doc.model.slots().find((s) => s.name === PANEL.slotName);
  if (!slot) throw new Error('mesh_slot missing');
  return slot.id;
}

function boneIdByName(doc: Document, name: string): BoneId {
  const bone = doc.model.findBoneByName(name);
  if (!bone) throw new Error(`bone ${name} missing`);
  return bone.id;
}

// The DISTINCT set of bone NAMES a weighted mesh's influences currently point at, resolved through the
// CURRENT model bone order. This is the invariant that must survive every reorder: the referents (bones),
// not their numeric indices, are what the binding means.
function boundBoneNames(doc: Document, slotId: SlotId): Set<string> {
  const att = doc.model.getAttachment(slotId, PANEL.name);
  if (att?.kind !== 'mesh' || att.bones === undefined) throw new Error('panel not weighted');
  const bones = doc.model.bones();
  const names = new Set<string>();
  for (const vertex of decodeWeightedVertices({ vertices: [...att.vertices] })) {
    for (const influence of vertex) {
      const bone = bones[influence.boneIndex];
      if (!bone) throw new Error(`influence index ${influence.boneIndex} out of range`);
      names.add(bone.name);
    }
  }
  return names;
}

function meshManifest(doc: Document, slotId: SlotId): readonly number[] {
  const att = doc.model.getAttachment(slotId, PANEL.name);
  if (att?.kind !== 'mesh' || att.bones === undefined) throw new Error('panel not weighted');
  return [...att.bones];
}

// The FINAL world-space skinned vertices of the panel mesh at setup pose, computed the way runtime-core
// does it (export -> buildPose -> reset -> solve world -> solveSkin), so a mis-remap surfaces as moved
// geometry, not just a changed index.
function skinnedWorld(doc: Document): Float32Array {
  const exported = exportDocument(doc.model);
  const mesh = findMesh(exported);
  const pose = buildPose(exported);
  resetToSetupPose(pose);
  computeWorldTransforms(pose);
  const out = new Float32Array(mesh.uvs.length);
  solveSkin(mesh, pose.world, out);
  return out;
}

function findMesh(doc: SkeletonDocument): MeshAttachment {
  const att = doc.skins.find((s) => s.name === 'default')?.attachments[PANEL.slotName]?.[
    PANEL.name
  ];
  if (att === undefined || att.type !== 'mesh') throw new Error('exported panel missing');
  return att;
}

function expectClose(actual: Float32Array, expected: Float32Array): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i += 1) expect(actual[i]).toBeCloseTo(expected[i]!, 4);
}

function bindPanel(doc: Document, boneNames: readonly string[]): void {
  const slotId = meshSlotId(doc);
  const boneIds = boneNames.map((name) => boneIdByName(doc, name));
  doc.history.execute(new BindMeshToBonesCommand(slotId, PANEL.name, boneIds, 'equalSplit'));
}

describe('weighted-mesh bone-index remap across bone-order changes', () => {
  it('remaps when a newly created bone lands EARLIER in the order', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(makeDoc(['b0', 'b1', 'b2', 'b3']), env);
    const slotId = meshSlotId(doc);
    bindPanel(doc, ['b2', 'b3']); // GLOBAL indices [3, 4]

    const namesBefore = boundBoneNames(doc, slotId);
    const manifestBefore = meshManifest(doc, slotId);
    const worldBefore = skinnedWorld(doc);
    const snapBefore = doc.model.snapshot();

    // A new child of root inserts at index 1, shifting b0..b3 (and the bound b2/b3) up by one.
    const newId = doc.ids.mint('bone');
    doc.history.execute(
      new CreateBoneCommand(newId, boneIdByName(doc, 'root'), boneGeom('inserted', 25)),
    );

    expect(meshManifest(doc, slotId)).not.toEqual(manifestBefore); // indices actually shifted
    expect(boundBoneNames(doc, slotId)).toEqual(namesBefore); // still the same bones
    expectClose(skinnedWorld(doc), worldBefore); // and the same skinned geometry

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(snapBefore); // memento restores the exact prior encoding
  });

  it('remaps when a reparent re-derives the bone order', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(makeDoc(['b0', 'b1', 'b2', 'b3']), env);
    const slotId = meshSlotId(doc);
    bindPanel(doc, ['b0', 'b3']); // GLOBAL indices [1, 4]

    const namesBefore = boundBoneNames(doc, slotId);
    const manifestBefore = meshManifest(doc, slotId);
    const worldBefore = skinnedWorld(doc);
    const snapBefore = doc.model.snapshot();

    // Reparent b0 under b3: the topological pass moves b0 to the end, so both bound indices change while
    // b0's WORLD transform is held fixed (so the skinned geometry must be unchanged).
    doc.history.execute(new ReparentBoneCommand(boneIdByName(doc, 'b0'), boneIdByName(doc, 'b3')));

    expect(meshManifest(doc, slotId)).not.toEqual(manifestBefore);
    expect(boundBoneNames(doc, slotId)).toEqual(namesBefore);
    expectClose(skinnedWorld(doc), worldBefore);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(snapBefore);
  });

  it('remaps when an unrelated bone is deleted and shifts the indices down', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(makeDoc(['b0', 'b1', 'b2', 'b3']), env);
    const slotId = meshSlotId(doc);
    bindPanel(doc, ['b2', 'b3']); // GLOBAL indices [3, 4]

    const namesBefore = boundBoneNames(doc, slotId);
    const manifestBefore = meshManifest(doc, slotId);
    const worldBefore = skinnedWorld(doc);
    const snapBefore = doc.model.snapshot();

    // Delete b0 (index 1): a leaf under root that no slot rides and the mesh does not reference. b1/b2/b3
    // shift down by one; the bound b2/b3 keep their referents and their world transforms.
    doc.history.execute(new DeleteBoneCommand(boneIdByName(doc, 'b0')));

    expect(meshManifest(doc, slotId)).not.toEqual(manifestBefore);
    expect(boundBoneNames(doc, slotId)).toEqual(namesBefore);
    expectClose(skinnedWorld(doc), worldBefore);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(snapBefore);
  });

  // PP-D10 slice 7 regression: a NAMED skin carrying Stage F2 (ADR-0009 section 5) scoping lists AND a
  // weighted mesh must keep its bones/constraints scoping when a bone reorder fires the mesh remap (the
  // remap rebuilds the changed skin, and the rebuild previously dropped the scoping fields).
  it('preserves a scoped skin bones/constraints lists across the weighted-mesh remap', () => {
    const weighted: MeshAttachment = {
      type: 'mesh',
      path: 'skin_panel',
      uvs: [0, 0, 1, 0, 1, 1, 0, 1],
      triangles: [0, 1, 2, 0, 2, 3],
      hullLength: 4,
      width: 64,
      height: 64,
      color: WHITE,
      // Each vertex is influenced by GLOBAL bone indices 0 (root) and 1 (b0), encoded as
      // [count, (boneIndex, vx, vy, weight)*count]. A bone that inserts earlier shifts b0's index.
      vertices: [
        2, 0, 0, 0, 0.5, 1, 0, 0, 0.5, 2, 0, 64, 0, 0.5, 1, 64, 0, 0.5, 2, 0, 64, 64, 0.5, 1, 64,
        64, 0.5, 2, 0, 0, 64, 0.5, 1, 0, 64, 0.5,
      ],
      bones: [0, 1],
    };
    const costume: Skin = {
      name: 'costume',
      bones: ['b1', 'b2'],
      constraints: ['follow'],
      attachments: { mesh_slot: { panel: weighted } },
    };
    const follow: TransformConstraint = {
      name: 'follow',
      bones: ['b3'],
      target: 'b0',
      mixRotate: 1,
      mixX: 0,
      mixY: 0,
      mixScaleX: 0,
      mixScaleY: 0,
      mixShearY: 0,
      offsetRotation: 0,
      offsetX: 0,
      offsetY: 0,
      offsetScaleX: 0,
      offsetScaleY: 0,
      offsetShearY: 0,
      local: false,
      relative: false,
    };
    const base = makeDoc(['b0', 'b1', 'b2', 'b3']);
    const scopedDoc: SkeletonDocument = {
      ...base,
      formatVersion: '0.4.0',
      ikConstraints: [],
      transformConstraints: [follow],
      events: [],
      // The slot carries no setup attachment (the mesh lives only in the named skin), and the default skin
      // stays empty; the named 'costume' skin holds the weighted mesh plus its scoping lists.
      slots: [{ name: 'mesh_slot', bone: 'root', color: WHITE, attachment: null, blendMode: 'normal' }],
      skins: [{ name: 'default', attachments: {} }, costume],
    };

    const { env } = makeTestEnv();
    const doc = loadDocument(scopedDoc, env);
    const costumeBefore = doc.model.skins().find((s) => s.name === 'costume');
    expect(costumeBefore?.bones).toEqual(['b1', 'b2']);
    expect(costumeBefore?.constraints).toEqual(['follow']);

    // Insert a child of root at index 1: b0 (a weighted influence) shifts up, firing the skin remap.
    const newId = doc.ids.mint('bone');
    doc.history.execute(
      new CreateBoneCommand(newId, boneIdByName(doc, 'root'), boneGeom('inserted', 25)),
    );

    const costumeAfter = doc.model.skins().find((s) => s.name === 'costume');
    expect(costumeAfter?.bones).toEqual(['b1', 'b2']); // scoping lists survived the rebuild
    expect(costumeAfter?.constraints).toEqual(['follow']);
    // And the export still carries them.
    const exported = exportDocument(doc.model);
    const exportedCostume = exported.skins.find((s) => s.name === 'costume');
    expect(exportedCostume?.bones).toEqual(['b1', 'b2']);
    expect(exportedCostume?.constraints).toEqual(['follow']);
  });

  it('preserves skinning across an export/load round-trip when creation order differs from export order', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(makeDoc(['a', 'b']), env);
    bindPanel(doc, ['a', 'b']);

    // Reparent a under b so the export order (root, b, a) differs from the creation order (root, a, b).
    doc.history.execute(new ReparentBoneCommand(boneIdByName(doc, 'a'), boneIdByName(doc, 'b')));

    const exported = exportDocument(doc.model);
    expect(exported.bones.map((bone) => bone.name)).toEqual(['root', 'b', 'a']);

    const authoredWorld = skinnedWorld(doc);

    // A fresh load of the exported document must skin identically (indices resolve against the exported
    // bone order, which the remap kept canonical).
    const { env: env2 } = makeTestEnv();
    const reloaded = loadDocument(exported, env2);
    expect(boundBoneNames(reloaded, meshSlotId(reloaded))).toEqual(new Set(['a', 'b']));
    expectClose(skinnedWorld(reloaded), authoredWorld);
  });
});
