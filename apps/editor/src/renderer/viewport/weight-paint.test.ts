import { describe, expect, it } from 'vitest';
import {
  AddRegionAttachmentCommand,
  AutoWeightFromProximityCommand,
  BindMeshToBonesCommand,
  CreateBoneCommand,
  CreateSlotCommand,
  GenerateMeshFromRegionCommand,
  NormalizeMeshWeightsCommand,
  SetActiveAttachmentCommand,
  UnbindMeshCommand,
  createDocument,
  makeIdFactory,
  newDocState,
  type BindWeightMode,
  type BoneId,
  type Document,
  type DocumentEnvironment,
  type SlotId,
} from '../document';
import { brushDab, type BrushVertex } from '../modules/mesh/weight-brush';
import {
  beginWeightStroke,
  cancelWeightStroke,
  endWeightStroke,
  paintDabs,
} from '../modules/mesh/weight-paint-session';
import { regionToMeshInit } from '../modules/mesh/region-to-mesh';
import { solveWorldById } from './scene-solve';
import {
  activeBoneWeights,
  meshAdjacency,
  resolveWeightPaintTarget,
  weightedVertexWorldPositions,
} from './weight-paint';

// The WP-2.4 weight-paint pure logic against a REAL document built through the same commands the editor
// dispatches (no DOM, no Pixi): weighted-target resolution (only after a bind), world positions from the
// bind, the active bone's per-vertex weight, mesh adjacency, and the full stroke / cancel / binding-command
// flows with the merged-sequence undo the interaction group guarantees (Law 2).

const REGION = {
  x: 0,
  y: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  width: 64,
  height: 64,
  color: { r: 1, g: 1, b: 1, a: 1 },
} as const;

interface Rig {
  readonly doc: Document;
  readonly slotId: SlotId;
  readonly rootId: BoneId;
  readonly armId: BoneId;
}

// Two identity bones (root at the origin, arm as its child), one slot riding root, one 64x64 region 'body'
// converted to a 4-vertex quad mesh (still UNWEIGHTED). Identity bones keep the mesh's world vertices equal
// to its stored flat locals, which makes the world-position math hand-checkable.
function baseRig(): Rig {
  const env: DocumentEnvironment = { now: () => 0, createIds: makeIdFactory };
  const doc = createDocument(newDocState('weight-paint-test'), env);
  const rootId = doc.ids.mint('bone');
  doc.history.execute(
    new CreateBoneCommand(rootId, null, {
      name: 'root',
      length: 32,
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
  const armId = doc.ids.mint('bone');
  doc.history.execute(
    new CreateBoneCommand(armId, rootId, {
      name: 'arm',
      length: 32,
      x: 32,
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
      bone: rootId,
      color: { r: 1, g: 1, b: 1, a: 1 },
      darkColor: null,
      attachment: null,
      blendMode: 'normal',
    }),
  );
  doc.history.execute(
    new AddRegionAttachmentCommand(slotId, { name: 'body', path: 'body', ...REGION }),
  );
  doc.history.execute(new SetActiveAttachmentCommand(slotId, 'body'));
  doc.history.execute(new GenerateMeshFromRegionCommand(slotId, 'body', regionToMeshInit(REGION)));
  return { doc, slotId, rootId, armId };
}

// A rig whose 'body' mesh is already bound: to root alone (single influence) or to both bones (bothBones).
function weightedRig(mode: BindWeightMode, bothBones = false): Rig {
  const rig = baseRig();
  const bones = bothBones ? [rig.rootId, rig.armId] : [rig.rootId];
  rig.doc.history.execute(new BindMeshToBonesCommand(rig.slotId, 'body', bones, mode));
  return rig;
}

// The 'body' mesh's stored flat vertex stream (unweighted [x, y, ...] or the weighted stream), read live.
function meshVertices(doc: Document, slotId: SlotId): readonly number[] {
  const mesh = doc.model.getAttachment(slotId, 'body');
  if (mesh === undefined || mesh.kind !== 'mesh') throw new Error('mesh attachment not found');
  return mesh.vertices;
}

describe('resolveWeightPaintTarget', () => {
  it('resolves only once the mesh is weighted (a fresh mesh is unweighted)', () => {
    const rig = baseRig();
    expect(resolveWeightPaintTarget(rig.doc.model, rig.slotId)).toBeNull();

    rig.doc.history.execute(
      new BindMeshToBonesCommand(rig.slotId, 'body', [rig.rootId], 'rigidNearest'),
    );
    const target = resolveWeightPaintTarget(rig.doc.model, rig.slotId);
    expect(target).not.toBeNull();
    expect(target!.attachmentName).toBe('body');
    expect(target!.vertexCount).toBe(4);
    expect(target!.perVertex).toHaveLength(4);
  });

  it('returns null with no slot selected', () => {
    const rig = weightedRig('rigidNearest');
    expect(resolveWeightPaintTarget(rig.doc.model, null)).toBeNull();
  });
});

describe('weightedVertexWorldPositions', () => {
  it('reproduces the bind-pose positions (identity bones: world equals the flat vertices)', () => {
    const rig = baseRig();
    const flat = [...meshVertices(rig.doc, rig.slotId)];

    rig.doc.history.execute(
      new BindMeshToBonesCommand(rig.slotId, 'body', [rig.rootId], 'rigidNearest'),
    );
    const target = resolveWeightPaintTarget(rig.doc.model, rig.slotId)!;
    const positions = weightedVertexWorldPositions(target, solveWorldById(rig.doc.model));

    expect(positions).toHaveLength(flat.length);
    for (let i = 0; i < flat.length; i += 1) {
      expect(positions[i]).toBeCloseTo(flat[i]!, 10);
    }
  });

  it('holds under an equal split across two bones (every influence maps to one world point)', () => {
    const rig = baseRig();
    const flat = [...meshVertices(rig.doc, rig.slotId)];

    rig.doc.history.execute(
      new BindMeshToBonesCommand(rig.slotId, 'body', [rig.rootId, rig.armId], 'equalSplit'),
    );
    const target = resolveWeightPaintTarget(rig.doc.model, rig.slotId)!;
    const positions = weightedVertexWorldPositions(target, solveWorldById(rig.doc.model));

    for (let i = 0; i < flat.length; i += 1) {
      expect(positions[i]).toBeCloseTo(flat[i]!, 10);
    }
  });
});

describe('activeBoneWeights', () => {
  it('is 1 on the single bound bone for a rigid-nearest bind', () => {
    const rig = weightedRig('rigidNearest');
    const target = resolveWeightPaintTarget(rig.doc.model, rig.slotId)!;
    const rootWeights = activeBoneWeights(target, rig.rootId);
    for (let i = 0; i < target.vertexCount; i += 1) {
      expect(rootWeights.get(i)).toBeCloseTo(1, 10);
    }
  });

  it('splits evenly for an equal-split bind and is 0 for a bone that is not an influence', () => {
    const rig = weightedRig('equalSplit', true);
    const target = resolveWeightPaintTarget(rig.doc.model, rig.slotId)!;

    const rootWeights = activeBoneWeights(target, rig.rootId);
    const armWeights = activeBoneWeights(target, rig.armId);
    for (let i = 0; i < target.vertexCount; i += 1) {
      expect(rootWeights.get(i)).toBeCloseTo(0.5, 10);
      expect(armWeights.get(i)).toBeCloseTo(0.5, 10);
    }

    const strangerId = rig.doc.ids.mint('bone');
    const stranger = activeBoneWeights(target, strangerId);
    for (let i = 0; i < target.vertexCount; i += 1) {
      expect(stranger.get(i)).toBe(0);
    }
  });
});

describe('meshAdjacency', () => {
  it('lists the unique neighbors of a 2-triangle quad', () => {
    // Quad triangulated as [0,1,2] + [0,2,3] (the region-to-mesh default fan).
    const adjacency = meshAdjacency([0, 1, 2, 0, 2, 3], 4);
    expect([...adjacency.get(0)!].sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect([...adjacency.get(1)!].sort((a, b) => a - b)).toEqual([0, 2]);
    expect([...adjacency.get(2)!].sort((a, b) => a - b)).toEqual([0, 1, 3]);
    expect([...adjacency.get(3)!].sort((a, b) => a - b)).toEqual([0, 2]);
  });
});

// Build one brush dab batch covering every vertex of the small quad, adding weight to the active bone.
function fullCoverageDabs(rig: Rig, activeBoneId: BoneId): ReturnType<typeof brushDab> {
  const target = resolveWeightPaintTarget(rig.doc.model, rig.slotId)!;
  const positions = weightedVertexWorldPositions(target, solveWorldById(rig.doc.model));
  const vertices: BrushVertex[] = [];
  for (let i = 0; i < target.vertexCount; i += 1) {
    vertices.push({ index: i, position: { x: positions[i * 2]!, y: positions[i * 2 + 1]! } });
  }
  return brushDab({
    vertices,
    center: { x: positions[0]!, y: positions[1]! },
    radius: 1000, // covers every vertex of the small quad
    strength: 0.3,
    mode: 'add',
    currentWeights: activeBoneWeights(target, activeBoneId),
  });
}

describe('the weight-paint stroke (Law 2, merged-sequence undo)', () => {
  it('changes weights across a multi-batch stroke and restores in ONE undo step', () => {
    const rig = weightedRig('equalSplit', true);
    const before = rig.doc.model.snapshot();

    let events = 0;
    const unsubscribe = rig.doc.history.subscribe(() => {
      events += 1;
    });

    const stroke = beginWeightStroke(rig.doc.history, rig.slotId, 'body', rig.rootId, 'add');
    for (let batch = 0; batch < 3; batch += 1) {
      paintDabs(stroke, fullCoverageDabs(rig, rig.rootId));
    }
    endWeightStroke(stroke);

    const painted = resolveWeightPaintTarget(rig.doc.model, rig.slotId)!;
    expect(activeBoneWeights(painted, rig.rootId).get(0)!).toBeGreaterThan(0.5);
    expect(events).toBe(1); // the whole stroke committed as exactly one undo step

    rig.doc.history.undo();
    expect(rig.doc.model.snapshot()).toEqual(before);
    unsubscribe();
  });

  it('cancels a stroke without pushing an undo entry', () => {
    const rig = weightedRig('equalSplit', true);
    const before = rig.doc.model.snapshot();

    let events = 0;
    const unsubscribe = rig.doc.history.subscribe(() => {
      events += 1;
    });

    const stroke = beginWeightStroke(rig.doc.history, rig.slotId, 'body', rig.rootId, 'add');
    paintDabs(stroke, fullCoverageDabs(rig, rig.rootId));
    cancelWeightStroke(stroke);

    expect(events).toBe(0); // a cancelled gesture fires no committed event
    expect(rig.doc.model.snapshot()).toEqual(before); // live model back to pre-stroke
    unsubscribe();
  });
});

describe('binding commands round-trip via undo', () => {
  it('bind restores the unweighted mesh on undo', () => {
    const rig = baseRig();
    const before = rig.doc.model.snapshot();
    rig.doc.history.execute(
      new BindMeshToBonesCommand(rig.slotId, 'body', [rig.rootId], 'rigidNearest'),
    );
    rig.doc.history.undo();
    expect(rig.doc.model.snapshot()).toEqual(before);
  });

  it('auto-weight restores the prior weights on undo', () => {
    const rig = weightedRig('equalSplit', true);
    const before = rig.doc.model.snapshot();
    rig.doc.history.execute(new AutoWeightFromProximityCommand(rig.slotId, 'body'));
    rig.doc.history.undo();
    expect(rig.doc.model.snapshot()).toEqual(before);
  });

  it('normalize restores the prior weights on undo', () => {
    const rig = weightedRig('equalSplit', true);
    const before = rig.doc.model.snapshot();
    rig.doc.history.execute(new NormalizeMeshWeightsCommand(rig.slotId, 'body'));
    rig.doc.history.undo();
    expect(rig.doc.model.snapshot()).toEqual(before);
  });

  it('unbind restores the weighted mesh on undo', () => {
    const rig = weightedRig('rigidNearest');
    const before = rig.doc.model.snapshot();
    rig.doc.history.execute(new UnbindMeshCommand(rig.slotId, 'body'));
    expect(resolveWeightPaintTarget(rig.doc.model, rig.slotId)).toBeNull();
    rig.doc.history.undo();
    expect(rig.doc.model.snapshot()).toEqual(before);
  });
});
