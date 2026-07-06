import { describe, expect, it } from 'vitest';
import {
  AddMeshVertexCommand,
  AutoGridFillMeshCommand,
  AutoPerimeterTraceMeshCommand,
  DeleteMeshVertexCommand,
  GenerateMeshFromRegionCommand,
  MeshTopologyLockedError,
  MoveMeshVertexCommand,
  SetMeshEdgesCommand,
  UnbindMeshCommand,
  loadDocument,
  type Document,
  type SlotId,
} from '../src';
import { makeTestEnv, seeds } from './seeds';

function countUndoSteps(doc: Document): number {
  let steps = 0;
  while (doc.history.canUndo) {
    doc.history.undo();
    steps += 1;
  }
  return steps;
}

// The 'meshed' seed's unweighted mesh: returns (slotId, attachmentName).
function unweightedMeshTarget(doc: Document): { slotId: SlotId; name: string } {
  for (const slot of doc.model.slots()) {
    const att = doc.model.attachments(slot.id).find((a) => a.kind === 'mesh');
    if (att && att.kind === 'mesh' && att.bones === undefined)
      return { slotId: slot.id, name: att.name };
  }
  throw new Error('no unweighted mesh in seed');
}

// A document carrying a single-bone WEIGHTED (rigid) mesh, for the topology-lock guard. Authored at
// 0.1.0 (migration adds the 0.2.0 constraint collections on load); the weighted `vertices` stream is
// [influenceCount=1, boneIndex=0, vx, vy, weight=1] per vertex and `bones` is the [0] manifest.
const weightedMeshDoc = {
  formatVersion: '0.1.0',
  name: 'weighted',
  hash: '',
  bones: [
    {
      name: 'root',
      parent: null,
      length: 100,
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      shearX: 0,
      shearY: 0,
      transformMode: 'normal',
    },
  ],
  slots: [
    {
      name: 'mesh_slot',
      bone: 'root',
      color: { r: 1, g: 1, b: 1, a: 1 },
      attachment: 'panel',
      blendMode: 'normal',
    },
  ],
  skins: [
    {
      name: 'default',
      attachments: {
        mesh_slot: {
          panel: {
            type: 'mesh',
            path: 'skin_panel',
            uvs: [0, 0, 1, 0, 1, 1, 0, 1],
            triangles: [0, 1, 2, 0, 2, 3],
            hullLength: 4,
            width: 64,
            height: 64,
            color: { r: 1, g: 1, b: 1, a: 1 },
            vertices: [1, 0, 0, 0, 1, 1, 0, 64, 0, 1, 1, 0, 64, 64, 1, 1, 0, 0, 64, 1],
            bones: [0],
          },
        },
      },
    },
  ],
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

function weightedMeshTarget(doc: Document): { slotId: SlotId; name: string } {
  const slot = doc.model.slots()[0]!;
  const att = doc.model.attachments(slot.id).find((a) => a.kind === 'mesh');
  if (!att || att.kind !== 'mesh' || att.bones === undefined) {
    throw new Error('weighted mesh seed is not weighted');
  }
  return { slotId: slot.id, name: att.name };
}

describe('GenerateMeshFromRegion', () => {
  it('swaps a region attachment to a mesh and undo restores the exact region', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.meshed, env);
    const slot = doc.model
      .slots()
      .find((s) => doc.model.attachments(s.id).some((a) => a.kind === 'region'))!;
    const region = doc.model.attachments(slot.id).find((a) => a.kind === 'region')!;
    const before = doc.model.snapshot();

    doc.history.execute(
      new GenerateMeshFromRegionCommand(slot.id, region.name, {
        uvs: [0, 0, 1, 0, 1, 1, 0, 1],
        triangles: [0, 1, 2, 0, 2, 3],
        hullLength: 4,
        width: 64,
        height: 64,
        color: { r: 1, g: 1, b: 1, a: 1 },
        vertices: [0, 0, 64, 0, 64, 64, 0, 64],
      }),
    );

    const swapped = doc.model.getAttachment(slot.id, region.name);
    expect(swapped?.kind).toBe('mesh');
    if (swapped?.kind === 'mesh') expect(swapped.path).toBe(region.path); // mesh keeps the region's atlas path

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before); // region restored exactly
    expect(doc.model.getAttachment(slot.id, region.name)?.kind).toBe('region');
  });
});

describe('MoveMeshVertex interaction group', () => {
  it('coalesces a drag of one vertex into a single undo step (kind, not composite)', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.meshed, env);
    const { slotId, name } = unweightedMeshTarget(doc);
    const before = doc.model.snapshot();

    doc.history.beginInteraction();
    for (let i = 1; i <= 10; i += 1) {
      doc.history.execute(new MoveMeshVertexCommand(slotId, name, 0, i, i * 2));
    }
    const event = doc.history.endInteraction('Move Mesh Vertex');
    expect(event?.kind).toBe('mesh.moveVertex'); // one merged command, not a composite of ten

    expect(countUndoSteps(doc)).toBe(1);
    expect(doc.model.snapshot()).toEqual(before); // one undo returns to the pre-drag geometry
  });

  it('does not coalesce moves of different vertices (composite, still one undo step)', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.meshed, env);
    const { slotId, name } = unweightedMeshTarget(doc);
    const before = doc.model.snapshot();

    doc.history.beginInteraction();
    doc.history.execute(new MoveMeshVertexCommand(slotId, name, 0, 1, 1));
    doc.history.execute(new MoveMeshVertexCommand(slotId, name, 1, 2, 2));
    doc.history.execute(new MoveMeshVertexCommand(slotId, name, 0, 3, 3));
    const event = doc.history.endInteraction('Move Mesh Vertices');
    expect(event?.kind).toBe('composite'); // two distinct vertices -> two mementos -> composite

    expect(countUndoSteps(doc)).toBe(1);
    expect(doc.model.snapshot()).toEqual(before);
  });
});

describe('topology-lock policy (TASK-2.1.8)', () => {
  it('forbids ADD/DELETE/auto-fill on a weighted mesh and mutates nothing', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(weightedMeshDoc, env);
    const { slotId, name } = weightedMeshTarget(doc);
    const before = doc.model.snapshot();

    const locked = [
      new AddMeshVertexCommand(
        slotId,
        name,
        [0, 0, 1, 0, 1, 1, 0, 1, 0.5, 0.5],
        [0, 1, 4],
        [0, 0, 64, 0, 64, 64, 0, 64, 32, 32],
      ),
      new DeleteMeshVertexCommand(
        slotId,
        name,
        [0, 0, 1, 0, 1, 1],
        [0, 1, 2],
        [0, 0, 64, 0, 64, 64],
      ),
      new AutoGridFillMeshCommand(slotId, name, {
        uvs: [0, 0, 1, 0, 1, 1],
        triangles: [0, 1, 2],
        hullLength: 3,
        vertices: [0, 0, 64, 0, 64, 64],
      }),
      new AutoPerimeterTraceMeshCommand(slotId, name, {
        uvs: [0, 0, 1, 0, 1, 1],
        triangles: [0, 1, 2],
        hullLength: 3,
        vertices: [0, 0, 64, 0, 64, 64],
      }),
    ];

    for (const cmd of locked) {
      expect(() => doc.history.execute(cmd)).toThrow(MeshTopologyLockedError);
    }
    expect(doc.model.snapshot()).toEqual(before); // every locked attempt mutated nothing
    expect(doc.history.canUndo).toBe(false); // and pushed no undo entry
  });

  it('exempts SetMeshEdges but REJECTS MOVE on a weighted mesh', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(weightedMeshDoc, env);
    const { slotId, name } = weightedMeshTarget(doc);

    // Edge edits do not touch vertices at all, so the lock never fires. MOVE is rejected on a weighted
    // mesh: its `vertices` array is the [boneCount, (boneIndex, vx, vy, weight)*] influence stream, so
    // the flat [2i, 2i+1] write would silently corrupt bone indices and weights. Loud, not lossy.
    expect(() =>
      doc.history.execute(new SetMeshEdgesCommand(slotId, name, [0, 1, 1, 2])),
    ).not.toThrow();
    const before = doc.model.snapshot();
    const canUndoBefore = doc.history.canUndo;
    expect(() => doc.history.execute(new MoveMeshVertexCommand(slotId, name, 0, 1, 1))).toThrow(
      MeshTopologyLockedError,
    );
    expect(doc.model.snapshot()).toEqual(before); // the rejected move mutated nothing
    expect(doc.history.canUndo).toBe(canUndoBefore); // and pushed no undo entry
  });

  it('is now LIVE end to end: UnbindMesh unlocks topology edits (TASK-2.1.8 round-trip)', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.weighted, env);
    const { slotId, name } = weightedMeshTarget(doc);

    const add = (): void =>
      doc.history.execute(
        new AddMeshVertexCommand(
          slotId,
          name,
          [0, 0, 1, 0, 1, 1, 0, 1, 0.5, 0.5],
          [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4],
          [0, 0, 64, 0, 64, 64, 0, 64, 32, 32],
        ),
      );

    // ADD is rejected while the mesh is weighted (the lock is LIVE)...
    expect(add).toThrow(MeshTopologyLockedError);

    // ...UnbindMesh clears the weights, returning it to the unweighted flat encoding...
    doc.history.execute(new UnbindMeshCommand(slotId, name));
    const unbound = doc.model.getAttachment(slotId, name);
    expect(unbound?.kind).toBe('mesh');
    if (unbound?.kind === 'mesh') expect(unbound.bones).toBeUndefined();

    // ...and the same ADD now succeeds.
    expect(add).not.toThrow();
  });

  it('is inert on an unweighted, non-deformed mesh: ADD and DELETE succeed', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.meshed, env);
    const { slotId, name } = unweightedMeshTarget(doc);

    expect(() =>
      doc.history.execute(
        new AddMeshVertexCommand(
          slotId,
          name,
          [0, 0, 1, 0, 1, 1, 0, 1, 0.5, 0.5, 0.25, 0.25],
          [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 5],
          [0, 0, 64, 0, 64, 64, 0, 64, 32, 32, 16, 16],
        ),
      ),
    ).not.toThrow();
    expect(() =>
      doc.history.execute(
        new DeleteMeshVertexCommand(
          slotId,
          name,
          [0, 0, 1, 0, 1, 1, 0, 1],
          [0, 1, 2, 0, 2, 3],
          [0, 0, 64, 0, 64, 64, 0, 64],
        ),
      ),
    ).not.toThrow();
  });
});
