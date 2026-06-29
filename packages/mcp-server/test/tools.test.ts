import type { SkeletonDocument } from '@marionette/format/types';
import { buildPose, sampleSkeleton, SLOT_COLOR_STRIDE } from '@marionette/runtime-core';
import { describe, expect, it } from 'vitest';
import { McpToolError, SessionRegistry, TOOLS, type FileStore, type ToolDeps } from '../src';

const byName = new Map(TOOLS.map((tool) => [tool.name, tool]));

function call(deps: ToolDeps, name: string, input: unknown): Promise<unknown> {
  const tool = byName.get(name);
  if (!tool) throw new Error(`unknown tool ${name}`);
  return tool.handler(deps, input);
}

function inMemoryFiles(): { store: FileStore; map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    store: {
      read: async (path) => {
        const content = map.get(path);
        if (content === undefined) throw new Error(`no file ${path}`);
        return content;
      },
      write: async (path, content) => {
        map.set(path, content);
      },
    },
  };
}

function makeDeps(): ToolDeps {
  return { sessions: new SessionRegistry(), files: inMemoryFiles().store };
}

async function expectToolError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
  await expect(promise).rejects.toBeInstanceOf(McpToolError);
}

// A record helper: the tool results are plain JSON objects.
function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

describe('MCP tools', () => {
  it('lets an AI build a two-bone rig end to end', async () => {
    const deps = makeDeps();
    const { documentId } = asRecord(await call(deps, 'document.new', { name: 'warrior' }));

    const { boneId: rootId } = asRecord(
      await call(deps, 'bone.create', { documentId, name: 'root', length: 100 }),
    );
    const { boneId: limbId } = asRecord(
      await call(deps, 'bone.create', {
        documentId,
        parentId: rootId,
        name: 'limb',
        x: 100,
        rotation: 30,
        length: 80,
      }),
    );
    expect(typeof rootId).toBe('string');
    expect(typeof limbId).toBe('string');

    const list = asRecord(await call(deps, 'bone.list', { documentId }));
    expect((list.bones as unknown[]).length).toBe(2);

    const transforms = asRecord(await call(deps, 'document.getWorldTransforms', { documentId }));
    const worldList = transforms.transforms as Array<{ name: string; world: number[] }>;
    expect(worldList.map((t) => t.name)).toEqual(['root', 'limb']);
    expect(worldList[0]!.world).toHaveLength(6);

    const exported = asRecord(await call(deps, 'document.export', { documentId }));
    const doc = asRecord(exported.document);
    expect(doc.formatVersion).toBe('0.2.0');
    expect((doc.bones as unknown[]).length).toBe(2);

    const validation = asRecord(await call(deps, 'document.validate', { documentId }));
    expect(validation.ok).toBe(true);
  });

  it('mutations go through History: undo/redo and interaction collapse work', async () => {
    const deps = makeDeps();
    const { documentId } = asRecord(await call(deps, 'document.new', { name: 'h' }));
    await call(deps, 'bone.create', { documentId, name: 'root', length: 50 });

    const state = asRecord(await call(deps, 'history.getState', { documentId }));
    expect(state.canUndo).toBe(true);

    await call(deps, 'history.undo', { documentId });
    expect(
      (asRecord(await call(deps, 'bone.list', { documentId })).bones as unknown[]).length,
    ).toBe(0);
    await call(deps, 'history.redo', { documentId });
    expect(
      (asRecord(await call(deps, 'bone.list', { documentId })).bones as unknown[]).length,
    ).toBe(1);

    // A begin/endInteraction wraps several moves into ONE undo step.
    const { boneId } = asRecord(
      await call(deps, 'bone.create', { documentId, name: 'b', length: 10 }),
    );
    await call(deps, 'history.beginInteraction', { documentId });
    await call(deps, 'bone.move', { documentId, boneId, x: 1, y: 1 });
    await call(deps, 'bone.move', { documentId, boneId, x: 2, y: 2 });
    await call(deps, 'bone.move', { documentId, boneId, x: 3, y: 3 });
    await call(deps, 'history.endInteraction', { documentId, label: 'Move' });

    await call(deps, 'history.undo', { documentId }); // one undo reverts the whole drag
    const moved = asRecord(await call(deps, 'bone.get', { documentId, boneId }));
    expect(asRecord(moved.bone).x).toBe(0);
  });

  it('round-trips a document through save and open via the file store', async () => {
    const files = inMemoryFiles();
    const deps: ToolDeps = { sessions: new SessionRegistry(), files: files.store };

    const { documentId } = asRecord(await call(deps, 'document.new', { name: 'rt' }));
    await call(deps, 'bone.create', { documentId, name: 'root', length: 100 });
    await call(deps, 'document.save', { documentId, path: '/rig.json' });
    expect(files.map.has('/rig.json')).toBe(true);

    const opened = asRecord(await call(deps, 'document.open', { path: '/rig.json' }));
    const reExported = asRecord(
      await call(deps, 'document.export', { documentId: opened.documentId }),
    );
    const original = asRecord(await call(deps, 'document.export', { documentId }));
    expect(reExported.document).toEqual(original.document);
  });

  it('surfaces typed errors for bad ids, empty documents, and malformed input', async () => {
    const deps = makeDeps();
    const { documentId } = asRecord(await call(deps, 'document.new', { name: 'e' }));

    await expectToolError(
      call(deps, 'bone.move', { documentId, boneId: 'nope', x: 1, y: 1 }),
      'BONE_NOT_FOUND',
    );
    await expectToolError(call(deps, 'bone.list', { documentId: 'ghost' }), 'DOCUMENT_NOT_FOUND');
    // An empty document cannot export (the format requires at least one bone).
    await expectToolError(call(deps, 'document.export', { documentId }), 'INVALID_DOCUMENT');
    await expectToolError(call(deps, 'bone.create', { documentId }), 'INVALID_INPUT');
    await expectToolError(
      call(deps, 'bone.create', { documentId, parentId: 'missing', name: 'x' }),
      'BONE_NOT_FOUND',
    );
  });

  it('reparents a bone (world-stable) and rejects a cycle through the AI surface', async () => {
    const deps = makeDeps();
    const { documentId } = asRecord(await call(deps, 'document.new', { name: 'rp' }));
    const { boneId: rootId } = asRecord(
      await call(deps, 'bone.create', { documentId, name: 'root', length: 100 }),
    );
    const { boneId: midId } = asRecord(
      await call(deps, 'bone.create', { documentId, parentId: rootId, name: 'mid', x: 50 }),
    );
    const { boneId: tipId } = asRecord(
      await call(deps, 'bone.create', { documentId, parentId: midId, name: 'tip', x: 40 }),
    );

    // tip under root (skip mid): valid.
    await call(deps, 'bone.reparent', { documentId, boneId: tipId, newParentId: rootId });
    const tip = asRecord(
      asRecord(await call(deps, 'bone.get', { documentId, boneId: tipId })).bone,
    );
    expect(tip.parent).toBe(rootId);

    // root under tip would be a cycle.
    await expectToolError(
      call(deps, 'bone.reparent', { documentId, boneId: rootId, newParentId: tipId }),
      'REPARENT_CYCLE',
    );

    // transform mode flows through too.
    await call(deps, 'bone.transformMode', { documentId, boneId: rootId, mode: 'noScale' });
    const root = asRecord(
      asRecord(await call(deps, 'bone.get', { documentId, boneId: rootId })).bone,
    );
    expect(root.transformMode).toBe('noScale');
  });

  it('rejects opening malformed JSON and invalid documents', async () => {
    const files = inMemoryFiles();
    files.map.set('/bad.json', '{ not json');
    files.map.set('/invalid.json', JSON.stringify({ formatVersion: '0.1.0', name: 'x' }));
    const deps: ToolDeps = { sessions: new SessionRegistry(), files: files.store };

    await expectToolError(call(deps, 'document.open', { path: '/bad.json' }), 'INVALID_JSON');
    await expectToolError(
      call(deps, 'document.open', { path: '/invalid.json' }),
      'INVALID_DOCUMENT',
    );
    await expectToolError(
      call(deps, 'document.open', { path: '/missing.json' }),
      'FILE_READ_ERROR',
    );
  });

  it('authors slots and attachments, reorders draw order, and cascades a bone delete', async () => {
    const deps = makeDeps();
    const { documentId } = asRecord(await call(deps, 'document.new', { name: 'rig' }));
    const { boneId: rootId } = asRecord(
      await call(deps, 'bone.create', { documentId, name: 'root', length: 100 }),
    );
    const { boneId: armId } = asRecord(
      await call(deps, 'bone.create', { documentId, parentId: rootId, name: 'arm', x: 50 }),
    );

    const { slotId: bodyId } = asRecord(
      await call(deps, 'slot.create', { documentId, boneId: rootId, name: 'body' }),
    );
    const { slotId: handId } = asRecord(
      await call(deps, 'slot.create', { documentId, boneId: armId, name: 'hand' }),
    );
    expect(typeof bodyId).toBe('string');

    // Region attachment + activate it in setup pose.
    await call(deps, 'attach.region.add', {
      documentId,
      slotId: bodyId,
      name: 'torso',
      path: 'tex_torso',
      width: 64,
      height: 64,
    });
    await call(deps, 'slot.activeAttachment', { documentId, slotId: bodyId, attachment: 'torso' });
    const bodyGet = asRecord(await call(deps, 'slot.get', { documentId, slotId: bodyId }));
    expect(asRecord(bodyGet.slot).attachment).toBe('torso');
    expect((bodyGet.attachments as unknown[]).length).toBe(1);

    // Reorder body to the end of the draw order.
    await call(deps, 'slot.reorder', { documentId, slotId: bodyId, toIndex: 1 });
    const listed = asRecord(await call(deps, 'slot.list', { documentId }));
    expect((listed.slots as Array<{ name: string }>).map((s) => s.name)).toEqual(['hand', 'body']);

    // Color edit through a command.
    await call(deps, 'slot.color', {
      documentId,
      slotId: handId,
      color: { r: 0.5, g: 0.25, b: 0.1, a: 1 },
    });

    // Deleting the root bone cascades its slot (body) and that slot's attachment in one undo step.
    await call(deps, 'bone.delete', { documentId, boneId: rootId });
    const afterDelete = asRecord(await call(deps, 'slot.list', { documentId }));
    expect((afterDelete.slots as unknown[]).length).toBe(0); // arm subtree took hand too
    await call(deps, 'history.undo', { documentId });
    const afterUndo = asRecord(await call(deps, 'slot.list', { documentId }));
    expect((afterUndo.slots as unknown[]).length).toBe(2); // both slots restored

    const bodyAgain = asRecord(await call(deps, 'slot.get', { documentId, slotId: bodyId }));
    expect((bodyAgain.attachments as unknown[]).length).toBe(1); // attachment restored too
  });

  it('surfaces typed errors for unknown slots and attachments', async () => {
    const deps = makeDeps();
    const { documentId } = asRecord(await call(deps, 'document.new', { name: 's' }));
    const { boneId } = asRecord(
      await call(deps, 'bone.create', { documentId, name: 'root', length: 1 }),
    );
    const { slotId } = asRecord(
      await call(deps, 'slot.create', { documentId, boneId, name: 'body' }),
    );

    await expectToolError(
      call(deps, 'slot.color', {
        documentId,
        slotId: 'nope',
        color: { r: 1, g: 1, b: 1, a: 1 },
      }),
      'SLOT_NOT_FOUND',
    );
    await expectToolError(
      call(deps, 'attach.remove', { documentId, slotId, name: 'missing' }),
      'ATTACHMENT_NOT_FOUND',
    );
    // An out-of-range color channel is rejected at the boundary.
    await expectToolError(
      call(deps, 'slot.color', { documentId, slotId, color: { r: 2, g: 0, b: 0, a: 1 } }),
      'INVALID_INPUT',
    );
  });
});

// A valid single-bone WEIGHTED (rigid) mesh document (format 0.1.0; migration adds the 0.2.0 constraint
// collections on open). Used to prove the topology-lock guard fires through the AI surface.
const WEIGHTED_MESH_DOC = {
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

describe('MCP mesh tools (WP-2.1)', () => {
  it('generates a mesh from a region and undo restores the region', async () => {
    const deps = makeDeps();
    const { documentId } = asRecord(await call(deps, 'document.new', { name: 'm' }));
    const { boneId } = asRecord(
      await call(deps, 'bone.create', { documentId, name: 'root', length: 1 }),
    );
    const { slotId } = asRecord(
      await call(deps, 'slot.create', { documentId, boneId, name: 'panel' }),
    );
    await call(deps, 'attach.region.add', {
      documentId,
      slotId,
      name: 'panel',
      path: 'tex',
      width: 64,
      height: 64,
    });

    await call(deps, 'mesh.generateFromRegion', {
      documentId,
      slotId,
      name: 'panel',
      uvs: [0, 0, 1, 0, 1, 1, 0, 1],
      triangles: [0, 1, 2, 0, 2, 3],
      hullLength: 4,
      width: 64,
      height: 64,
      vertices: [0, 0, 64, 0, 64, 64, 0, 64],
    });
    const afterGen = asRecord(await call(deps, 'slot.get', { documentId, slotId }));
    expect((afterGen.attachments as Array<{ name: string; kind: string }>)[0]!.kind).toBe('mesh');

    await call(deps, 'history.undo', { documentId });
    const afterUndo = asRecord(await call(deps, 'slot.get', { documentId, slotId }));
    expect((afterUndo.attachments as Array<{ name: string; kind: string }>)[0]!.kind).toBe(
      'region',
    );
  });

  it('moves a mesh vertex through the AI surface', async () => {
    const deps = makeDeps();
    const { documentId } = asRecord(await call(deps, 'document.new', { name: 'mv' }));
    const { boneId } = asRecord(
      await call(deps, 'bone.create', { documentId, name: 'root', length: 1 }),
    );
    const { slotId } = asRecord(
      await call(deps, 'slot.create', { documentId, boneId, name: 'panel' }),
    );
    await call(deps, 'attach.region.add', {
      documentId,
      slotId,
      name: 'panel',
      path: 'tex',
      width: 64,
      height: 64,
    });
    await call(deps, 'mesh.generateFromRegion', {
      documentId,
      slotId,
      name: 'panel',
      uvs: [0, 0, 1, 0, 1, 1, 0, 1],
      triangles: [0, 1, 2, 0, 2, 3],
      hullLength: 4,
      width: 64,
      height: 64,
      vertices: [0, 0, 64, 0, 64, 64, 0, 64],
    });

    await call(deps, 'mesh.moveVertex', {
      documentId,
      slotId,
      name: 'panel',
      vertexIndex: 0,
      x: 5,
      y: 7,
    });

    const snap = asRecord(await call(deps, 'document.getSnapshot', { documentId }));
    const attachments = asRecord(snap.snapshot).attachments as Array<{
      kind: string;
      name: string;
      vertices?: number[];
    }>;
    const meshAtt = attachments.find((a) => a.kind === 'mesh' && a.name === 'panel')!;
    expect(meshAtt.vertices!.slice(0, 2)).toEqual([5, 7]); // vertex 0 moved
  });

  it('rejects a topology edit on a weighted mesh as MESH_TOPOLOGY_LOCKED', async () => {
    const files = inMemoryFiles();
    files.map.set('/weighted.json', JSON.stringify(WEIGHTED_MESH_DOC));
    const deps: ToolDeps = { sessions: new SessionRegistry(), files: files.store };

    const { documentId } = asRecord(await call(deps, 'document.open', { path: '/weighted.json' }));
    const slots = asRecord(await call(deps, 'slot.list', { documentId })).slots as Array<{
      id: string;
      name: string;
    }>;
    const slotId = slots.find((s) => s.name === 'mesh_slot')!.id;

    await expectToolError(
      call(deps, 'mesh.addVertex', {
        documentId,
        slotId,
        name: 'panel',
        uvs: [0, 0, 1, 0, 1, 1, 0, 1, 0.5, 0.5],
        triangles: [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4],
        vertices: [0, 0, 64, 0, 64, 64, 0, 64, 32, 32],
      }),
      'MESH_TOPOLOGY_LOCKED',
    );
    // The rejected edit mutated nothing: the mesh is still weighted and undo has nothing to revert.
    const state = asRecord(await call(deps, 'history.getState', { documentId }));
    expect(state.canUndo).toBe(false);
  });
});

// A document with a bone, a slot, and an animation built entirely through the MCP tools, so the WP-1.5
// animation surface is exercised end to end (build, query, edit, export, sample).
async function buildAnimatedDoc(deps: ToolDeps): Promise<{
  documentId: string;
  rootId: string;
  bodyId: string;
  animationId: string;
}> {
  const { documentId } = asRecord(await call(deps, 'document.new', { name: 'anim' }));
  const { boneId: rootId } = asRecord(
    await call(deps, 'bone.create', { documentId, name: 'root', length: 100 }),
  );
  const { slotId: bodyId } = asRecord(
    await call(deps, 'slot.create', { documentId, boneId: rootId, name: 'body' }),
  );
  const { animationId } = asRecord(
    await call(deps, 'anim.create', { documentId, name: 'idle', duration: 1 }),
  );
  await call(deps, 'kf.set', {
    documentId,
    animationId,
    channel: 'rotate',
    boneId: rootId,
    time: 0,
    value: { angle: 0 },
  });
  await call(deps, 'kf.set', {
    documentId,
    animationId,
    channel: 'rotate',
    boneId: rootId,
    time: 1,
    value: { angle: 90 },
  });
  await call(deps, 'kf.set', {
    documentId,
    animationId,
    channel: 'color',
    slotId: bodyId,
    time: 0,
    value: { color: { r: 1, g: 1, b: 1, a: 1 } },
  });
  await call(deps, 'kf.set', {
    documentId,
    animationId,
    channel: 'color',
    slotId: bodyId,
    time: 1,
    value: { color: { r: 1, g: 0, b: 0, a: 1 } },
  });
  return {
    documentId: String(documentId),
    rootId: String(rootId),
    bodyId: String(bodyId),
    animationId: String(animationId),
  };
}

describe('MCP animation + keyframe tools', () => {
  it('builds an animation, edits a curve, exports, and the WP-1.4 sampler reads it to a sane pose', async () => {
    const deps = makeDeps();
    const { documentId, rootId, animationId } = await buildAnimatedDoc(deps);

    const animGet = asRecord(await call(deps, 'anim.get', { documentId, animationId }));
    const animation = asRecord(animGet.animation);
    const bones = animation.bones as Array<{ boneId: string; rotate: Array<{ id: string }> }>;
    expect(bones[0]!.rotate).toHaveLength(2);
    const firstKeyId = bones[0]!.rotate[0]!.id;

    // Edit the curve of an existing keyframe.
    await call(deps, 'kf.curve', {
      documentId,
      animationId,
      channel: 'rotate',
      boneId: rootId,
      keyframeId: firstKeyId,
      curve: { type: 'bezier', cx1: 0.25, cy1: 0.1, cx2: 0.75, cy2: 0.9 },
    });

    // Export and SAMPLE: proves the editable model projects to exactly what runtime-core consumes.
    const exported = asRecord(await call(deps, 'document.export', { documentId }));
    const doc = exported.document as SkeletonDocument;
    const pose = buildPose(doc);
    expect(() => sampleSkeleton(doc, 'idle', 1, pose)).not.toThrow();
    for (const value of pose.world) expect(Number.isFinite(value)).toBe(true);
    const bodyIndex = pose.slotNames.indexOf('body');
    const base = bodyIndex * SLOT_COLOR_STRIDE;
    expect(pose.slotColor[base]).toBeCloseTo(1); // r at t=1 is red
    expect(pose.slotColor[base + 1]).toBeCloseTo(0); // g
  });

  it('lists, duplicates, and pastes keyframes through the AI surface', async () => {
    const deps = makeDeps();
    const { documentId, rootId, animationId } = await buildAnimatedDoc(deps);

    const dup = asRecord(
      await call(deps, 'anim.duplicate', { documentId, animationId, name: 'idle2' }),
    );
    expect(typeof dup.animationId).toBe('string');
    const list = asRecord(await call(deps, 'anim.list', { documentId }));
    expect((list.animations as unknown[]).length).toBe(2);

    // Paste a keyframe at a free time on the rotate channel.
    await call(deps, 'kf.paste', {
      documentId,
      animationId,
      items: [{ channel: 'rotate', boneId: rootId, time: 0.5, value: { angle: 45 } }],
    });
    const animGet = asRecord(await call(deps, 'anim.get', { documentId, animationId }));
    const bones = asRecord(animGet.animation).bones as Array<{ rotate: unknown[] }>;
    expect(bones[0]!.rotate).toHaveLength(3); // 2 original + 1 pasted
  });

  it('cascades the animation tracks when a bone is deleted and undo restores them', async () => {
    const deps = makeDeps();
    const { documentId, rootId, animationId } = await buildAnimatedDoc(deps);

    await call(deps, 'bone.delete', { documentId, boneId: rootId });
    const afterDelete = asRecord(
      asRecord(await call(deps, 'anim.get', { documentId, animationId })).animation,
    );
    expect((afterDelete.bones as unknown[]).length).toBe(0); // root's track pruned
    expect((afterDelete.slots as unknown[]).length).toBe(0); // the riding slot's track pruned too

    await call(deps, 'history.undo', { documentId }); // one undo restores bone, slot, and both tracks
    const afterUndo = asRecord(
      asRecord(await call(deps, 'anim.get', { documentId, animationId })).animation,
    );
    expect((afterUndo.bones as unknown[]).length).toBe(1);
    expect((afterUndo.slots as unknown[]).length).toBe(1);
  });

  it('surfaces typed errors for a duration shrink, a collision, a value mismatch, and bad targets', async () => {
    const deps = makeDeps();
    const { documentId, rootId, animationId } = await buildAnimatedDoc(deps);

    // Shrinking below the last keyframe time (t=1) is rejected.
    await expectToolError(
      call(deps, 'anim.duration', { documentId, animationId, duration: 0.4 }),
      'ANIMATION_DURATION',
    );

    // A value whose shape does not match the channel is rejected at the boundary.
    await expectToolError(
      call(deps, 'kf.set', {
        documentId,
        animationId,
        channel: 'rotate',
        boneId: rootId,
        time: 0.5,
        value: { x: 1, y: 2 },
      }),
      'INVALID_INPUT',
    );

    // A bone channel without a boneId is rejected.
    await expectToolError(
      call(deps, 'kf.set', {
        documentId,
        animationId,
        channel: 'rotate',
        time: 0.5,
        value: { angle: 1 },
      }),
      'INVALID_INPUT',
    );

    // Moving a keyframe onto an occupied time is rejected.
    const animGet = asRecord(await call(deps, 'anim.get', { documentId, animationId }));
    const bones = asRecord(animGet.animation).bones as Array<{ rotate: Array<{ id: string }> }>;
    const firstKeyId = bones[0]!.rotate[0]!.id; // at t=0
    await expectToolError(
      call(deps, 'kf.move', {
        documentId,
        animationId,
        channel: 'rotate',
        boneId: rootId,
        keyframeId: firstKeyId,
        time: 1, // occupied by the t=1 key
      }),
      'KEYFRAME_COLLISION',
    );

    // An unknown animation id is a typed error.
    await expectToolError(
      call(deps, 'anim.get', { documentId, animationId: 'nope' }),
      'ANIMATION_NOT_FOUND',
    );
  });
});

// A two-bone rig with an UNWEIGHTED mesh, built through the MCP tools, so the WP-2.3/2.4 binding + weight
// surface is exercised end to end (bind, auto-weight, paint, normalize, unbind).
async function buildUnweightedMeshDoc(deps: ToolDeps): Promise<{
  documentId: string;
  slotId: string;
  rootId: string;
  childId: string;
}> {
  const { documentId } = asRecord(await call(deps, 'document.new', { name: 'weights' }));
  const { boneId: rootId } = asRecord(
    await call(deps, 'bone.create', { documentId, name: 'root', length: 50 }),
  );
  const { boneId: childId } = asRecord(
    await call(deps, 'bone.create', {
      documentId,
      parentId: rootId,
      name: 'arm',
      x: 50,
      length: 50,
    }),
  );
  const { slotId } = asRecord(
    await call(deps, 'slot.create', { documentId, boneId: rootId, name: 'panel' }),
  );
  await call(deps, 'attach.region.add', {
    documentId,
    slotId,
    name: 'panel',
    path: 'tex',
    width: 64,
    height: 64,
  });
  await call(deps, 'mesh.generateFromRegion', {
    documentId,
    slotId,
    name: 'panel',
    uvs: [0, 0, 1, 0, 1, 1, 0, 1],
    triangles: [0, 1, 2, 0, 2, 3],
    hullLength: 4,
    width: 64,
    height: 64,
    vertices: [0, 0, 64, 0, 64, 64, 0, 64],
  });
  return {
    documentId: String(documentId),
    slotId: String(slotId),
    rootId: String(rootId),
    childId: String(childId),
  };
}

describe('MCP mesh weight tools (WP-2.3 / WP-2.4)', () => {
  async function panelMesh(
    deps: ToolDeps,
    documentId: string,
  ): Promise<{ kind: string; name: string; bones?: number[] }> {
    const snap = asRecord(await call(deps, 'document.getSnapshot', { documentId }));
    const attachments = asRecord(snap.snapshot).attachments as Array<{
      kind: string;
      name: string;
      bones?: number[];
    }>;
    return attachments.find((a) => a.kind === 'mesh' && a.name === 'panel')!;
  }

  it('binds, auto-weights, paints, normalizes, and unbinds a mesh', async () => {
    const deps = makeDeps();
    const { documentId, slotId, rootId, childId } = await buildUnweightedMeshDoc(deps);

    await call(deps, 'mesh.bindToBones', {
      documentId,
      slotId,
      name: 'panel',
      boneIds: [rootId, childId],
      weightMode: 'equalSplit',
    });
    expect((await panelMesh(deps, documentId)).bones).toBeDefined(); // weighted now

    await call(deps, 'mesh.autoWeight', { documentId, slotId, name: 'panel' });
    await call(deps, 'mesh.paintWeight', {
      documentId,
      slotId,
      name: 'panel',
      activeBoneId: rootId,
      dabs: [{ vertexIndex: 0, deltaWeight: 0.3 }],
      mode: 'add',
    });
    await call(deps, 'mesh.normalizeWeights', { documentId, slotId, name: 'panel' });

    await call(deps, 'mesh.unbind', { documentId, slotId, name: 'panel' });
    expect((await panelMesh(deps, documentId)).bones).toBeUndefined(); // unweighted again
  });

  it('adds then removes a bone from the binding', async () => {
    const deps = makeDeps();
    const { documentId, slotId, rootId, childId } = await buildUnweightedMeshDoc(deps);
    await call(deps, 'mesh.bindToBones', {
      documentId,
      slotId,
      name: 'panel',
      boneIds: [rootId],
      weightMode: 'rigidNearest',
    });
    await call(deps, 'mesh.addBoneBinding', { documentId, slotId, name: 'panel', boneId: childId });
    expect((await panelMesh(deps, documentId)).bones).toHaveLength(2);
    await call(deps, 'mesh.removeBoneBinding', {
      documentId,
      slotId,
      name: 'panel',
      boneId: childId,
    });
    expect((await panelMesh(deps, documentId)).bones).toHaveLength(1);
  });

  it('coalesces a paint stroke (beginInteraction/endInteraction) into one undo step', async () => {
    const deps = makeDeps();
    const { documentId, slotId, rootId, childId } = await buildUnweightedMeshDoc(deps);
    await call(deps, 'mesh.bindToBones', {
      documentId,
      slotId,
      name: 'panel',
      boneIds: [rootId, childId],
      weightMode: 'equalSplit',
    });
    const bound = asRecord(await call(deps, 'document.getSnapshot', { documentId })).snapshot;

    await call(deps, 'history.beginInteraction', { documentId });
    for (let i = 0; i < 6; i += 1) {
      await call(deps, 'mesh.paintWeight', {
        documentId,
        slotId,
        name: 'panel',
        activeBoneId: rootId,
        dabs: [{ vertexIndex: 0, deltaWeight: 0.05 }],
        mode: 'add',
      });
    }
    const ended = asRecord(
      await call(deps, 'history.endInteraction', { documentId, label: 'Paint' }),
    );
    expect(asRecord(ended.event).kind).toBe('mesh.paintWeight'); // one merged command

    await call(deps, 'history.undo', { documentId });
    const afterUndo = asRecord(await call(deps, 'document.getSnapshot', { documentId })).snapshot;
    expect(afterUndo).toEqual(bound); // one undo reverts the whole stroke
  });

  it('rejects unbinding an unweighted mesh and re-binding a weighted mesh as MESH_BINDING', async () => {
    const deps = makeDeps();
    const { documentId, slotId, rootId, childId } = await buildUnweightedMeshDoc(deps);

    await expectToolError(
      call(deps, 'mesh.unbind', { documentId, slotId, name: 'panel' }),
      'MESH_BINDING',
    );

    await call(deps, 'mesh.bindToBones', {
      documentId,
      slotId,
      name: 'panel',
      boneIds: [rootId, childId],
      weightMode: 'rigidNearest',
    });
    await expectToolError(
      call(deps, 'mesh.bindToBones', {
        documentId,
        slotId,
        name: 'panel',
        boneIds: [rootId],
        weightMode: 'rigidNearest',
      }),
      'MESH_BINDING',
    );
  });
});

// A three-bone rig (root -> upper -> lower) plus an animation, built through the MCP tools, so the WP-2.6
// to WP-2.9 constraint / skin / deform surface is exercised end to end. `lower` is a direct child of
// `upper`, so [upper, lower] is a valid two-bone IK chain reaching `root` (no cycle: root is not a
// descendant of the chain).
async function buildConstraintRig(deps: ToolDeps): Promise<{
  documentId: string;
  rootId: string;
  upperId: string;
  lowerId: string;
  animationId: string;
}> {
  const { documentId } = asRecord(await call(deps, 'document.new', { name: 'rig' }));
  const { boneId: rootId } = asRecord(
    await call(deps, 'bone.create', { documentId, name: 'root', length: 50 }),
  );
  const { boneId: upperId } = asRecord(
    await call(deps, 'bone.create', {
      documentId,
      parentId: rootId,
      name: 'upper',
      x: 50,
      length: 50,
    }),
  );
  const { boneId: lowerId } = asRecord(
    await call(deps, 'bone.create', {
      documentId,
      parentId: upperId,
      name: 'lower',
      x: 50,
      length: 50,
    }),
  );
  const { animationId } = asRecord(
    await call(deps, 'anim.create', { documentId, name: 'move', duration: 1 }),
  );
  return {
    documentId: String(documentId),
    rootId: String(rootId),
    upperId: String(upperId),
    lowerId: String(lowerId),
    animationId: String(animationId),
  };
}

describe('MCP IK constraint tools (WP-2.6)', () => {
  it('creates, edits, keys, and deletes an IK constraint through the AI surface', async () => {
    const deps = makeDeps();
    const { documentId, rootId, upperId, lowerId, animationId } = await buildConstraintRig(deps);

    const { ikConstraintId } = asRecord(
      await call(deps, 'ik.createConstraint', {
        documentId,
        name: 'leg_ik',
        boneIds: [upperId, lowerId],
        targetId: rootId,
        mix: 1,
        bendPositive: true,
      }),
    );
    expect(typeof ikConstraintId).toBe('string');

    const listed = asRecord(await call(deps, 'ik.list', { documentId }));
    expect((listed.ikConstraints as unknown[]).length).toBe(1);

    await call(deps, 'ik.setMix', { documentId, ikConstraintId, mix: 0.5 });
    await call(deps, 'ik.setBendPositive', { documentId, ikConstraintId, bendPositive: false });
    const got = asRecord(
      asRecord(await call(deps, 'ik.get', { documentId, ikConstraintId })).ikConstraint,
    );
    expect(got.mix).toBe(0.5);
    expect(got.bendPositive).toBe(false);

    // Key the IK channel at two times, then delete one keyframe.
    await call(deps, 'ik.setKeyframe', {
      documentId,
      animationId,
      ikConstraintId,
      time: 0,
      mix: 1,
      bendPositive: true,
    });
    await call(deps, 'ik.setKeyframe', {
      documentId,
      animationId,
      ikConstraintId,
      time: 1,
      mix: 0,
      bendPositive: true,
    });
    // The anim.get projection does not surface ik tracks; assert via the snapshot instead.
    const ikTracks = (
      asRecord(await call(deps, 'document.getSnapshot', { documentId })).snapshot as {
        animations: Array<{ ik: Array<{ keyframes: unknown[] }> }>;
      }
    ).animations[0]!.ik;
    expect(ikTracks[0]!.keyframes.length).toBe(2);
    const firstKfId = (ikTracks[0]!.keyframes[0] as { id: string }).id;
    await call(deps, 'ik.deleteKeyframe', {
      documentId,
      animationId,
      ikConstraintId,
      keyframeId: firstKfId,
    });
    const afterDel = (
      asRecord(await call(deps, 'document.getSnapshot', { documentId })).snapshot as {
        animations: Array<{ ik: Array<{ keyframes: unknown[] }> }>;
      }
    ).animations[0]!.ik;
    expect(afterDel[0]!.keyframes.length).toBe(1);

    // Delete the constraint: it (and its surviving track) go in one undo step.
    await call(deps, 'ik.deleteConstraint', { documentId, ikConstraintId });
    expect(
      (asRecord(await call(deps, 'ik.list', { documentId })).ikConstraints as unknown[]).length,
    ).toBe(0);
    await call(deps, 'history.undo', { documentId });
    expect(
      (asRecord(await call(deps, 'ik.list', { documentId })).ikConstraints as unknown[]).length,
    ).toBe(1);
  });

  it('surfaces typed errors for a bad chain, a duplicate name, and a missing constraint', async () => {
    const deps = makeDeps();
    const { documentId, rootId, upperId, lowerId } = await buildConstraintRig(deps);

    // A three-bone chain violates the 1-or-2 arity (rejected at the boundary by the schema).
    await expectToolError(
      call(deps, 'ik.createConstraint', {
        documentId,
        name: 'too_long',
        boneIds: [rootId, upperId, lowerId],
        targetId: rootId,
      }),
      'INVALID_INPUT',
    );

    await call(deps, 'ik.createConstraint', {
      documentId,
      name: 'leg_ik',
      boneIds: [upperId, lowerId],
      targetId: rootId,
    });
    // A duplicate name is a typed CONSTRAINT error.
    await expectToolError(
      call(deps, 'ik.createConstraint', {
        documentId,
        name: 'leg_ik',
        boneIds: [lowerId],
        targetId: rootId,
      }),
      'CONSTRAINT',
    );
    // An unknown constraint id is a typed not-found.
    await expectToolError(
      call(deps, 'ik.setMix', { documentId, ikConstraintId: 'nope', mix: 0.5 }),
      'IK_CONSTRAINT_NOT_FOUND',
    );
  });
});

describe('MCP transform constraint tools (WP-2.7)', () => {
  it('creates, patches, keys, and deletes a transform constraint', async () => {
    const deps = makeDeps();
    const { documentId, rootId, upperId, animationId } = await buildConstraintRig(deps);

    const { transformConstraintId } = asRecord(
      await call(deps, 'transform.createConstraint', {
        documentId,
        name: 'follow',
        boneIds: [upperId],
        targetId: rootId,
      }),
    );
    expect(typeof transformConstraintId).toBe('string');
    // The defaults applied mixRotate 1 and the rest 0.
    const created = asRecord(
      asRecord(await call(deps, 'transform.get', { documentId, transformConstraintId }))
        .transformConstraint,
    );
    expect(created.mixRotate).toBe(1);
    expect(created.mixX).toBe(0);

    await call(deps, 'transform.setParams', {
      documentId,
      transformConstraintId,
      patch: { mixRotate: 0.5, offsetRotation: 10 },
    });
    const patched = asRecord(
      asRecord(await call(deps, 'transform.get', { documentId, transformConstraintId }))
        .transformConstraint,
    );
    expect(patched.mixRotate).toBe(0.5);
    expect(patched.offsetRotation).toBe(10);
    expect(patched.mixX).toBe(0); // untouched channel kept

    // An empty patch is rejected at the boundary.
    await expectToolError(
      call(deps, 'transform.setParams', { documentId, transformConstraintId, patch: {} }),
      'INVALID_INPUT',
    );

    await call(deps, 'transform.setKeyframe', {
      documentId,
      animationId,
      transformConstraintId,
      time: 0,
      mix: { mixRotate: 1 },
    });
    await call(deps, 'transform.setKeyframe', {
      documentId,
      animationId,
      transformConstraintId,
      time: 1,
      mix: { mixRotate: 0 },
    });
    const trTracks = (
      asRecord(await call(deps, 'document.getSnapshot', { documentId })).snapshot as {
        animations: Array<{ transform: Array<{ keyframes: Array<{ id: string }> }> }>;
      }
    ).animations[0]!.transform;
    expect(trTracks[0]!.keyframes.length).toBe(2);
    await call(deps, 'transform.deleteKeyframe', {
      documentId,
      animationId,
      transformConstraintId,
      keyframeId: trTracks[0]!.keyframes[0]!.id,
    });

    await call(deps, 'transform.deleteConstraint', { documentId, transformConstraintId });
    expect(
      (
        asRecord(await call(deps, 'transform.list', { documentId }))
          .transformConstraints as unknown[]
      ).length,
    ).toBe(0);
  });
});

describe('MCP skin tools (WP-2.8)', () => {
  it('creates, renames, populates, and deletes a named skin', async () => {
    const deps = makeDeps();
    const { documentId, rootId } = await buildConstraintRig(deps);
    const { slotId } = asRecord(
      await call(deps, 'slot.create', { documentId, boneId: rootId, name: 'body' }),
    );

    const { skinId } = asRecord(await call(deps, 'skin.create', { documentId, name: 'red' }));
    expect(typeof skinId).toBe('string');

    // 'default' is reserved.
    await expectToolError(call(deps, 'skin.create', { documentId, name: 'default' }), 'SKIN');
    // A duplicate named skin is rejected.
    await expectToolError(call(deps, 'skin.create', { documentId, name: 'red' }), 'SKIN');

    await call(deps, 'skin.rename', { documentId, skinId, name: 'crimson' });
    expect(asRecord(asRecord(await call(deps, 'skin.get', { documentId, skinId })).skin).name).toBe(
      'crimson',
    );

    await call(deps, 'skin.setAttachment', {
      documentId,
      skinId,
      slotId,
      attachment: { name: 'torso', path: 'tex_torso', width: 64, height: 64 },
    });
    const withAtt = asRecord(asRecord(await call(deps, 'skin.get', { documentId, skinId })).skin);
    expect((withAtt.attachments as unknown[]).length).toBe(1);

    await call(deps, 'skin.removeAttachment', { documentId, skinId, slotId, name: 'torso' });
    expect(
      (
        asRecord(asRecord(await call(deps, 'skin.get', { documentId, skinId })).skin)
          .attachments as unknown[]
      ).length,
    ).toBe(0);

    await call(deps, 'skin.delete', { documentId, skinId });
    expect(
      (asRecord(await call(deps, 'skin.list', { documentId })).skins as unknown[]).length,
    ).toBe(0);
    // An edit against the now-deleted skin is a typed not-found.
    await expectToolError(
      call(deps, 'skin.rename', { documentId, skinId, name: 'gone' }),
      'SKIN_NOT_FOUND',
    );
  });
});

describe('MCP deform tools (WP-2.9)', () => {
  it('keys, moves, deletes, and clears deform on a default-skin mesh', async () => {
    const deps = makeDeps();
    const { documentId, slotId } = await buildUnweightedMeshDoc(deps);
    const { animationId } = asRecord(
      await call(deps, 'anim.create', { documentId, name: 'wobble', duration: 1 }),
    );
    // The 'panel' mesh has uvs of length 8 (4 vertices), so offsets must be length 8.
    const offsets = [0, 0, 1, 0, 1, 1, 0, 1];

    await call(deps, 'deform.setKeyframe', {
      documentId,
      animationId,
      skin: 'default',
      slotId,
      name: 'panel',
      time: 0,
      offsets,
    });
    await call(deps, 'deform.setKeyframe', {
      documentId,
      animationId,
      skin: 'default',
      slotId,
      name: 'panel',
      time: 1,
      offsets,
    });

    const deformTracks = (
      asRecord(await call(deps, 'document.getSnapshot', { documentId })).snapshot as {
        animations: Array<{ deform: Array<{ keyframes: Array<{ id: string }> }> }>;
      }
    ).animations[0]!.deform;
    expect(deformTracks[0]!.keyframes.length).toBe(2);
    const firstId = deformTracks[0]!.keyframes[0]!.id;

    // Move the first keyframe to the midpoint (a free time), then delete it.
    await call(deps, 'deform.moveKeyframe', {
      documentId,
      animationId,
      skin: 'default',
      slotId,
      name: 'panel',
      keyframeId: firstId,
      time: 0.5,
    });
    await call(deps, 'deform.deleteKeyframe', {
      documentId,
      animationId,
      skin: 'default',
      slotId,
      name: 'panel',
      keyframeId: firstId,
    });
    const afterDel = (
      asRecord(await call(deps, 'document.getSnapshot', { documentId })).snapshot as {
        animations: Array<{ deform: Array<{ keyframes: unknown[] }> }>;
      }
    ).animations[0]!.deform;
    expect(afterDel[0]!.keyframes.length).toBe(1);

    // Clear the attachment deform: removes the remaining track in one undo step.
    await call(deps, 'deform.clearAttachment', { documentId, slotId, name: 'panel' });
    const cleared = (
      asRecord(await call(deps, 'document.getSnapshot', { documentId })).snapshot as {
        animations: Array<{ deform: unknown[] }>;
      }
    ).animations[0]!.deform;
    expect(cleared.length).toBe(0);
  });

  it('rejects an offsets-length mismatch and an unknown named skin as typed errors', async () => {
    const deps = makeDeps();
    const { documentId, slotId } = await buildUnweightedMeshDoc(deps);
    const { animationId } = asRecord(
      await call(deps, 'anim.create', { documentId, name: 'wobble', duration: 1 }),
    );

    // Offsets length 6 does not match the mesh uvs length 8.
    await expectToolError(
      call(deps, 'deform.setKeyframe', {
        documentId,
        animationId,
        skin: 'default',
        slotId,
        name: 'panel',
        time: 0,
        offsets: [0, 0, 1, 0, 1, 1],
      }),
      'DEFORM',
    );

    // An unknown named skin id is rejected before the command runs.
    await expectToolError(
      call(deps, 'deform.setKeyframe', {
        documentId,
        animationId,
        skin: 'skin_nope',
        slotId,
        name: 'panel',
        time: 0,
        offsets: [0, 0, 1, 0, 1, 1, 0, 1],
      }),
      'SKIN_NOT_FOUND',
    );
  });
});

// A guard test enumerating the full tool catalog, so adding or removing a tool is a deliberate, reviewed
// change (and the WP-2.6 to WP-2.9 tools are pinned present). The list mirrors TOOLS exactly.
describe('MCP tool catalog', () => {
  const PHASE_2_CONSTRAINT_TOOLS = [
    'ik.createConstraint',
    'ik.setMix',
    'ik.setBendPositive',
    'ik.deleteConstraint',
    'ik.setKeyframe',
    'ik.deleteKeyframe',
    'ik.list',
    'ik.get',
    'transform.createConstraint',
    'transform.setParams',
    'transform.deleteConstraint',
    'transform.setKeyframe',
    'transform.deleteKeyframe',
    'transform.list',
    'transform.get',
    'skin.create',
    'skin.rename',
    'skin.delete',
    'skin.setAttachment',
    'skin.removeAttachment',
    'skin.list',
    'skin.get',
    'deform.setKeyframe',
    'deform.deleteKeyframe',
    'deform.moveKeyframe',
    'deform.clearAttachment',
  ] as const;

  it('exposes every Phase 2 constraint / skin / deform tool with a unique name', () => {
    for (const name of PHASE_2_CONSTRAINT_TOOLS) {
      expect(byName.has(name), `missing tool ${name}`).toBe(true);
    }
    // Tool names are unique across the whole catalog.
    expect(byName.size).toBe(TOOLS.length);
  });
});
