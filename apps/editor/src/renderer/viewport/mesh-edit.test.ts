import { describe, expect, it } from 'vitest';
import {
  AddMeshVertexCommand,
  AddRegionAttachmentCommand,
  CreateBoneCommand,
  CreateSlotCommand,
  GenerateMeshFromRegionCommand,
  MoveMeshVertexCommand,
  SetActiveAttachmentCommand,
  BindMeshToBonesCommand,
  createDocument,
  makeIdFactory,
  newDocState,
  type Document,
  type DocumentEnvironment,
  type SlotId,
} from '../document';
import { addInteriorVertex } from '../modules/mesh/topology-edit';
import { regionToMeshInit } from '../modules/mesh/region-to-mesh';
import {
  hitTestMeshVertex,
  meshLocalFromWorld,
  meshWorldVertices,
  resolveMeshEditTarget,
} from './mesh-edit';
import type { Camera } from './camera';

// The WP-2.1 mesh tool's pure logic against a REAL document built through the same commands the
// editor dispatches (no DOM, no Pixi): target resolution (active/first unweighted mesh of the selected
// slot), zoom-independent vertex picking, world/local mapping, and the exact command flows the tool and
// the Delete keybinding drive, including the merged-sequence undo the interaction group guarantees.

const CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

interface Rig {
  readonly doc: Document;
  readonly slotId: SlotId;
}

// One bone at the origin, one slot, one 64x64 region named 'body' converted to a 4-vertex quad mesh.
function meshRig(): Rig {
  const env: DocumentEnvironment = { now: () => 0, createIds: makeIdFactory };
  const doc = createDocument(newDocState('mesh-edit-test'), env);
  const boneId = doc.ids.mint('bone');
  doc.history.execute(
    new CreateBoneCommand(boneId, null, {
      name: 'root',
      length: 10,
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      shearX: 0,
      shearY: 0,
      transformMode: 'normal',
    }),
  );
  const slotId = doc.ids.mint('slot');
  doc.history.execute(
    new CreateSlotCommand(slotId, {
      name: 'body',
      bone: boneId,
      color: { r: 1, g: 1, b: 1, a: 1 },
      darkColor: null,
      attachment: null,
      blendMode: 'normal',
    }),
  );
  doc.history.execute(
    new AddRegionAttachmentCommand(slotId, {
      name: 'body',
      path: 'body',
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      width: 64,
      height: 64,
      color: { r: 1, g: 1, b: 1, a: 1 },
    }),
  );
  doc.history.execute(new SetActiveAttachmentCommand(slotId, 'body'));
  doc.history.execute(
    new GenerateMeshFromRegionCommand(
      slotId,
      'body',
      regionToMeshInit({
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        width: 64,
        height: 64,
        color: { r: 1, g: 1, b: 1, a: 1 },
      }),
    ),
  );
  return { doc, slotId };
}

describe('resolveMeshEditTarget', () => {
  it('resolves the active mesh attachment of the selected slot', () => {
    const { doc, slotId } = meshRig();
    const target = resolveMeshEditTarget(doc.model, slotId);
    expect(target).not.toBeNull();
    expect(target!.attachmentName).toBe('body');
    expect(target!.mesh.hullLength).toBe(4);
    expect(target!.mesh.vertices).toHaveLength(8);
  });

  it('returns null with no slot selected and null for a slot with no mesh', () => {
    const { doc } = meshRig();
    expect(resolveMeshEditTarget(doc.model, null)).toBeNull();

    const env: DocumentEnvironment = { now: () => 0, createIds: makeIdFactory };
    const bare = createDocument(newDocState('bare'), env);
    const boneId = bare.ids.mint('bone');
    bare.history.execute(
      new CreateBoneCommand(boneId, null, {
        name: 'root',
        length: 10,
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        shearX: 0,
        shearY: 0,
        transformMode: 'normal',
      }),
    );
    const slotId = bare.ids.mint('slot');
    bare.history.execute(
      new CreateSlotCommand(slotId, {
        name: 'empty',
        bone: boneId,
        color: { r: 1, g: 1, b: 1, a: 1 },
        darkColor: null,
        attachment: null,
        blendMode: 'normal',
      }),
    );
    expect(resolveMeshEditTarget(bare.model, slotId)).toBeNull();
  });

  it('excludes a WEIGHTED mesh (the flat vertex layout no longer holds; unbind first)', () => {
    const { doc, slotId } = meshRig();
    const bone = doc.model.bones()[0]!;
    doc.history.execute(new BindMeshToBonesCommand(slotId, 'body', [bone.id], 'rigidNearest'));
    expect(resolveMeshEditTarget(doc.model, slotId)).toBeNull();
  });
});

describe('vertex picking and space mapping', () => {
  it('maps mesh locals through the slot bone world (identity bone: world equals local)', () => {
    const { doc, slotId } = meshRig();
    const target = resolveMeshEditTarget(doc.model, slotId)!;
    expect(meshWorldVertices(target)).toEqual([...target.mesh.vertices]);
  });

  it('picks the vertex within the pixel tolerance and misses outside it', () => {
    const { doc, slotId } = meshRig();
    const target = resolveMeshEditTarget(doc.model, slotId)!;
    const [vx, vy] = [target.mesh.vertices[0]!, target.mesh.vertices[1]!];

    expect(hitTestMeshVertex(target, vx + 5, vy - 5, CAMERA)).toBe(0);
    expect(hitTestMeshVertex(target, vx + 30, vy + 30, CAMERA)).toBeNull();
  });

  it('keeps the pick tolerance in screen pixels at any zoom', () => {
    const { doc, slotId } = meshRig();
    const target = resolveMeshEditTarget(doc.model, slotId)!;
    const zoomed: Camera = { x: 0, y: 0, zoom: 10 };
    const [vx, vy] = [target.mesh.vertices[0]!, target.mesh.vertices[1]!];
    // 5 screen px at zoom 10 is 0.5 world units: still a hit.
    expect(hitTestMeshVertex(target, vx * 10 + 5, vy * 10, zoomed)).toBe(0);
    // 0.5 world units at zoom 10 is 5 px (hit); 2 world units is 20 px (miss).
    expect(hitTestMeshVertex(target, (vx + 2) * 10, vy * 10, zoomed)).toBeNull();
  });

  it('meshLocalFromWorld inverts the bone world', () => {
    const { doc, slotId } = meshRig();
    const target = resolveMeshEditTarget(doc.model, slotId)!;
    const [lx, ly] = meshLocalFromWorld(target, 12, -7);
    expect(lx).toBeCloseTo(12, 12);
    expect(ly).toBeCloseTo(-7, 12);
  });
});

describe('the mesh tool command flows (Law 2, merged-sequence undo)', () => {
  it('a vertex drag session commits as ONE undo step restoring the pre-drag geometry', () => {
    const { doc, slotId } = meshRig();
    const before = doc.model.snapshot();

    doc.history.beginInteraction();
    doc.history.execute(new MoveMeshVertexCommand(slotId, 'body', 0, -40, -40));
    doc.history.execute(new MoveMeshVertexCommand(slotId, 'body', 0, -48, -44));
    doc.history.execute(new MoveMeshVertexCommand(slotId, 'body', 0, -50, -50));
    doc.history.endInteraction('Move Mesh Vertex');

    const moved = resolveMeshEditTarget(doc.model, slotId)!;
    expect([moved.mesh.vertices[0], moved.mesh.vertices[1]]).toEqual([-50, -50]);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('shift-add executes one AddMeshVertexCommand; a single undo removes the vertex', () => {
    const { doc, slotId } = meshRig();
    const target = resolveMeshEditTarget(doc.model, slotId)!;

    const result = addInteriorVertex(target.mesh, { x: 0, y: 0 });
    doc.history.execute(
      new AddMeshVertexCommand(slotId, 'body', result.uvs, result.triangles, result.vertices),
    );
    expect(resolveMeshEditTarget(doc.model, slotId)!.mesh.vertices).toHaveLength(10);

    doc.history.undo();
    expect(resolveMeshEditTarget(doc.model, slotId)!.mesh.vertices).toHaveLength(8);
  });
});
