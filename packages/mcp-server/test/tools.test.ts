import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AtlasRef, SkeletonDocument } from '@marionette/format/types';
import { makeSpritePng } from '@marionette/atlas-pack/testing';
import { buildPose, sampleSkeleton, SLOT_COLOR_STRIDE } from '@marionette/runtime-core';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import {
  McpToolError,
  SessionRegistry,
  TOOLS,
  createNodeFileStore,
  type FileStore,
  type ToolDeps,
} from '../src';

const byName = new Map(TOOLS.map((tool) => [tool.name, tool]));

function call(deps: ToolDeps, name: string, input: unknown): Promise<unknown> {
  const tool = byName.get(name);
  if (!tool) throw new Error(`unknown tool ${name}`);
  return tool.handler(deps, input);
}

function inMemoryFiles(): {
  store: FileStore;
  map: Map<string, string>;
  binary: Map<string, Uint8Array>;
} {
  const map = new Map<string, string>();
  const binary = new Map<string, Uint8Array>();
  return {
    map,
    binary,
    store: {
      read: async (path) => {
        const content = map.get(path);
        if (content === undefined) throw new Error(`no file ${path}`);
        return content;
      },
      write: async (path, content) => {
        map.set(path, content);
      },
      readBinary: async (path) => {
        const content = binary.get(path);
        if (content === undefined) throw new Error(`no binary file ${path}`);
        return content;
      },
      writeBinary: async (path, data) => {
        binary.set(path, data);
      },
      listDir: async (dir) => {
        const prefix = dir.endsWith('/') ? dir : `${dir}/`;
        const names = new Set<string>();
        for (const key of [...map.keys(), ...binary.keys()]) {
          if (!key.startsWith(prefix)) continue;
          const rest = key.slice(prefix.length);
          if (rest.length > 0 && !rest.includes('/')) names.add(rest);
        }
        return [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
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
    expect(doc.formatVersion).toBe('0.3.0'); // stage F1 bump (ADR-0008): exports stamp the current version
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

  it('bone.shear sets the shear channel through History and coalesces in a session', async () => {
    const deps = makeDeps();
    const { documentId } = asRecord(await call(deps, 'document.new', { name: 'sh' }));
    const { boneId } = asRecord(
      await call(deps, 'bone.create', { documentId, name: 'root', length: 40 }),
    );

    await call(deps, 'bone.shear', { documentId, boneId, shearX: 15, shearY: -8 });
    const sheared = asRecord(await call(deps, 'bone.get', { documentId, boneId }));
    expect(asRecord(sheared.bone).shearX).toBe(15);
    expect(asRecord(sheared.bone).shearY).toBe(-8);

    // A begin/endInteraction folds several shear edits into ONE undo step, restoring the pre-drag shear.
    await call(deps, 'history.beginInteraction', { documentId });
    await call(deps, 'bone.shear', { documentId, boneId, shearX: 20, shearY: -10 });
    await call(deps, 'bone.shear', { documentId, boneId, shearX: 25, shearY: -12 });
    await call(deps, 'history.endInteraction', { documentId, label: 'Shear' });

    await call(deps, 'history.undo', { documentId });
    const undone = asRecord(await call(deps, 'bone.get', { documentId, boneId }));
    expect(asRecord(undone.bone).shearX).toBe(15);
    expect(asRecord(undone.bone).shearY).toBe(-8);
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

// Build a one-page VFX atlas resolving the named regions (every layer `region` reference must resolve or
// SetEffectsAtlas / export rejects it). Each region is a distinct 16x16 tile.
function atlasWith(regions: readonly string[]): unknown {
  return {
    pages: [
      {
        file: 'vfx.png',
        width: 256,
        height: 256,
        regions: regions.map((name, index) => ({
          name,
          x: index * 16,
          y: 0,
          w: 16,
          h: 16,
          rotated: false,
          offsetX: 0,
          offsetY: 0,
          originalW: 16,
          originalH: 16,
        })),
      },
    ],
  };
}

// Effects (VFX / particles, Phase 3) tools: an LLM authors a particle effect through the SAME command
// spine the GUI uses (LAW 2). Covers a full authoring flow, undo, and the typed failure modes (LAW 3).
describe('MCP effects tools', () => {
  it('lets an AI author a particle effect, layer, life curve, and bundle end to end', async () => {
    const deps = makeDeps();
    const { documentId } = asRecord(await call(deps, 'document.new', { name: 'bigwin' }));

    await call(deps, 'effect.setAtlas', { documentId, atlas: atlasWith(['coin']) });
    const { effectId } = asRecord(
      await call(deps, 'effect.create', { documentId, name: 'coinShower', blendMode: 'additive' }),
    );
    expect(typeof effectId).toBe('string');

    const { layerId } = asRecord(
      await call(deps, 'effect.layer.add', {
        documentId,
        effectId,
        kind: 'emitter',
        blendMode: 'additive',
        region: 'coin',
      }),
    );
    expect(typeof layerId).toBe('string');

    // Read the layer body back, patch one field, and set it through the coalescing setField command.
    const got = asRecord(await call(deps, 'effect.get', { documentId, effectId }));
    const effect = asRecord(got.effect);
    const layers = effect.layers as Array<{ id: string; body: Record<string, unknown> }>;
    const layer = layers.find((l) => l.id === layerId)!;
    await call(deps, 'effect.layer.setField', {
      documentId,
      effectId,
      layerId,
      field: 'drag',
      body: { ...layer.body, drag: 0.75 },
    });

    await call(deps, 'effect.lifeStop.add', {
      documentId,
      effectId,
      layerId,
      field: 'alphaOverLife',
      t: 0.5,
      value: 0.5,
    });

    const after = asRecord(await call(deps, 'effect.get', { documentId, effectId }));
    const afterEffect = asRecord(after.effect);
    const afterLayer = (
      afterEffect.layers as Array<{
        id: string;
        body: { drag?: number };
        curves: Array<{ field: string; stops: unknown[] }>;
      }>
    ).find((l) => l.id === layerId)!;
    expect(afterLayer.body.drag).toBe(0.75);
    expect(afterLayer.curves.find((c) => c.field === 'alphaOverLife')!.stops).toHaveLength(3);

    // A bundle composing the effect (a coin-shower playlist item).
    await call(deps, 'bundle.create', { documentId, name: 'megaWin' });
    await call(deps, 'bundle.item.add', {
      documentId,
      name: 'megaWin',
      item: { effect: effectId, startOffset: 0.5, anchorRole: 'left', seedSalt: 9 },
    });
    const bundle = asRecord(
      asRecord(await call(deps, 'bundle.get', { documentId, name: 'megaWin' })).bundle,
    );
    expect((bundle.items as unknown[]).length).toBe(1);

    const list = asRecord(await call(deps, 'effect.list', { documentId }));
    expect((list.effects as unknown[]).length).toBe(1);
  });

  it('undoes an effect creation through the shared history', async () => {
    const deps = makeDeps();
    const { documentId } = asRecord(await call(deps, 'document.new', { name: 'undo' }));

    await call(deps, 'effect.create', { documentId, name: 'sparkle' });
    expect(
      (asRecord(await call(deps, 'effect.list', { documentId })).effects as unknown[]).length,
    ).toBe(1);

    await call(deps, 'history.undo', { documentId });

    expect(
      (asRecord(await call(deps, 'effect.list', { documentId })).effects as unknown[]).length,
    ).toBe(0);
  });

  it('rejects an unknown effect, a mismatched layer body, a dangling atlas, and a missing bundle effect', async () => {
    const deps = makeDeps();
    const { documentId } = asRecord(await call(deps, 'document.new', { name: 'neg' }));

    await expectToolError(
      call(deps, 'effect.get', { documentId, effectId: 'nope' }),
      'EFFECT_NOT_FOUND',
    );

    await call(deps, 'effect.setAtlas', { documentId, atlas: atlasWith(['coin']) });
    const { effectId } = asRecord(
      await call(deps, 'effect.create', { documentId, name: 'coinShower' }),
    );
    const { layerId } = asRecord(
      await call(deps, 'effect.layer.add', {
        documentId,
        effectId,
        kind: 'emitter',
        region: 'coin',
      }),
    );

    // A sprite-animator body cannot replace an emitter layer body (boundary guard).
    await expectToolError(
      call(deps, 'effect.layer.setField', {
        documentId,
        effectId,
        layerId,
        field: 'region',
        body: {
          type: 'spriteAnimator',
          name: 'sprite',
          region: 'coin',
          anchorSpace: 'world',
          rotationDegPerSec: 0,
          loop: true,
          layerDuration: 1,
        },
      }),
      'INVALID_INPUT',
    );

    // Swapping to an atlas that drops the still-referenced 'coin' region fails loudly.
    await expectToolError(
      call(deps, 'effect.setAtlas', { documentId, atlas: atlasWith(['other']) }),
      'EFFECTS_ATLAS_DANGLING_REGION',
    );

    // A bundle item referencing a non-existent effect is rejected by the command guard.
    await call(deps, 'bundle.create', { documentId, name: 'megaWin' });
    await expectToolError(
      call(deps, 'bundle.item.add', {
        documentId,
        name: 'megaWin',
        item: { effect: 'ghost', startOffset: 0, anchorRole: 'center', seedSalt: 1 },
      }),
      'EFFECT_EDIT',
    );
  });
});

// Slot composer (Phase 4) tools: an LLM authors slot-game composition (grid, symbol mapping, win
// sequence, feature flow, tumble) through the SAME command spine the GUI uses (LAW 2).
describe('MCP slot composer tools', () => {
  it('lets an AI compose a slot scene grid, symbol, win sequence, feature flow, and tumble', async () => {
    const deps = makeDeps();
    const { documentId } = asRecord(await call(deps, 'document.new', { name: 'slot' }));

    await call(deps, 'slot.grid.preset', { documentId, preset: 'scatterPay6x5' });
    const grid = asRecord(asRecord(await call(deps, 'slot.grid.get', { documentId })).grid);
    expect(grid.topology).toBe('scatterPay');
    expect(grid.cols).toBe(6);
    expect(grid.rows).toBe(5);

    await call(deps, 'slot.symbol.map', {
      documentId,
      symbolId: 'sym_wild',
      animSet: { skeletonRef: 'hero', idle: 'idle', land: 'land', win: 'win' },
      skeletonAnimationNames: ['idle', 'land', 'win'],
    });
    const symbol = asRecord(
      await call(deps, 'slot.symbol.get', { documentId, symbolId: 'sym_wild' }),
    );
    expect(asRecord(symbol.animSet).skeletonRef).toBe('hero');
    const scene = asRecord(asRecord(await call(deps, 'slot.scene.get', { documentId })).scene);
    expect((scene.skeletons as Array<{ name: string }>).some((s) => s.name === 'hero')).toBe(true);

    await call(deps, 'slot.winseq.create', { documentId, name: 'bonus' });
    await call(deps, 'slot.winseq.setStep', {
      documentId,
      sequenceName: 'bonus',
      index: 0,
      step: { atMs: 0, target: { kind: 'allWinningCells' }, action: { kind: 'animateWin' } },
    });
    await call(deps, 'slot.winseq.setThresholds', {
      documentId,
      thresholds: { big: 10, mega: 25, epic: 100 },
    });
    const winSeq = asRecord(
      asRecord(await call(deps, 'slot.winseq.get', { documentId })).winSequencer,
    );
    expect(asRecord(asRecord(winSeq.sequences).bonus).steps).toHaveLength(1);
    expect(asRecord(winSeq.thresholds).epic).toBe(100);

    await call(deps, 'slot.flow.createState', { documentId, name: 'freeSpins' });
    await call(deps, 'slot.flow.addTransition', {
      documentId,
      transition: { from: 'base', on: { type: 'freeSpinsAwarded' }, to: 'freeSpins' },
    });
    const flow = asRecord(asRecord(await call(deps, 'slot.flow.get', { documentId })).featureFlows);
    expect('freeSpins' in asRecord(flow.states)).toBe(true);
    expect((flow.transitions as unknown[]).length).toBe(1);

    await call(deps, 'slot.tumble.set', {
      documentId,
      tumble: {
        explodeMs: 120,
        dropMs: 200,
        dropEasing: 'easeOutQuad',
        refillStaggerMs: 40,
        settleMs: 80,
        stepGapMs: 150,
        rollupCurve: 'easeInOutCubic',
      },
    });
    const tumble = asRecord(asRecord(await call(deps, 'slot.tumble.get', { documentId })).tumble);
    expect(tumble.dropMs).toBe(200);
  });

  it('undoes a win-sequence creation through the shared history', async () => {
    const deps = makeDeps();
    const { documentId } = asRecord(await call(deps, 'document.new', { name: 'slot-undo' }));

    await call(deps, 'slot.winseq.create', { documentId, name: 'bonus' });
    const before = asRecord(
      asRecord(await call(deps, 'slot.winseq.get', { documentId })).winSequencer,
    );
    expect('bonus' in asRecord(before.sequences)).toBe(true);

    await call(deps, 'history.undo', { documentId });

    const after = asRecord(
      asRecord(await call(deps, 'slot.winseq.get', { documentId })).winSequencer,
    );
    expect('bonus' in asRecord(after.sequences)).toBe(false);
  });

  it('rejects a duplicate sequence, the protected base state, a missing sequence, and a bad grid', async () => {
    const deps = makeDeps();
    const { documentId } = asRecord(await call(deps, 'document.new', { name: 'slot-neg' }));

    // 'base' is the default sequence; recreating it is a duplicate.
    await expectToolError(
      call(deps, 'slot.winseq.create', { documentId, name: 'base' }),
      'SLOT_EDIT',
    );

    // The mandatory base feature-flow state cannot be deleted.
    await expectToolError(
      call(deps, 'slot.flow.deleteState', { documentId, name: 'base' }),
      'SLOT_EDIT',
    );

    // Setting a step on a non-existent sequence is rejected by the command guard.
    await expectToolError(
      call(deps, 'slot.winseq.setStep', {
        documentId,
        sequenceName: 'ghost',
        index: 0,
        step: { atMs: 0, target: { kind: 'allWinningCells' }, action: { kind: 'animateWin' } },
      }),
      'SLOT_EDIT',
    );

    // A cluster grid must be square; a 7x5 cluster is rejected at the command boundary.
    await expectToolError(
      call(deps, 'slot.grid.set', {
        documentId,
        grid: {
          topology: 'cluster',
          cols: 7,
          rows: 5,
          cellWidth: 100,
          cellHeight: 100,
          cellGap: 4,
          reelStopStaggerMs: 0,
          gravity: 'cluster-down',
          anticipation: { triggerSymbols: ['scatter'], thresholdCount: 3, maxAnticipatingCols: 2 },
        },
      }),
      'SLOT_EDIT',
    );

    // A symbol mapping whose chosen animation is not in the injected skeleton animation names fails.
    await expectToolError(
      call(deps, 'slot.symbol.map', {
        documentId,
        symbolId: 'sym_bad',
        animSet: { skeletonRef: 'hero', idle: 'idle', land: 'land', win: 'win' },
        skeletonAnimationNames: ['idle', 'land'],
      }),
      'SLOT_EDIT',
    );
  });
});

// A rig with two slots and an animation, so the event and draw-order timeline tools have real targets.
async function buildEventRig(deps: ToolDeps): Promise<{
  documentId: string;
  slotA: string;
  slotB: string;
  animationId: string;
}> {
  const { documentId } = asRecord(await call(deps, 'document.new', { name: 'events' }));
  const { boneId } = asRecord(
    await call(deps, 'bone.create', { documentId, name: 'root', length: 50 }),
  );
  const { slotId: slotA } = asRecord(
    await call(deps, 'slot.create', { documentId, boneId, name: 'slotA' }),
  );
  const { slotId: slotB } = asRecord(
    await call(deps, 'slot.create', { documentId, boneId, name: 'slotB' }),
  );
  const { animationId } = asRecord(
    await call(deps, 'anim.create', { documentId, name: 'idle', duration: 2 }),
  );
  return {
    documentId: String(documentId),
    slotA: String(slotA),
    slotB: String(slotB),
    animationId: String(animationId),
  };
}

describe('MCP event tools (PP-D9)', () => {
  it('defines, lists, gets, updates, renames, and deletes event definitions through the AI surface', async () => {
    const deps = makeDeps();
    const { documentId } = await buildEventRig(deps);

    const defined = asRecord(
      await call(deps, 'event.define', {
        documentId,
        name: 'footstep',
        int: 3,
        audio: { path: 'audio/step.ogg', volume: 0.8, balance: 0 },
      }),
    );
    const eventId = String(defined.eventId);
    expect(eventId.length).toBeGreaterThan(0);

    const list = asRecord(await call(deps, 'event.list', { documentId }));
    expect((list.events as unknown[]).length).toBe(1);

    const got = asRecord(asRecord(await call(deps, 'event.get', { documentId, eventId })).event);
    expect(got.name).toBe('footstep');
    expect(got.int).toBe(3);
    expect(asRecord(got.audio).volume).toBeCloseTo(0.8);

    // setDefaults replaces payload defaults wholesale (absent field clears it); audio is left untouched.
    const setDefaults = asRecord(
      await call(deps, 'event.setDefaults', { documentId, eventId, float: 1.5 }),
    );
    expect(typeof setDefaults.revision).toBe('number');
    const afterDefaults = asRecord(
      asRecord(await call(deps, 'event.get', { documentId, eventId })).event,
    );
    expect(afterDefaults.int).toBeUndefined(); // cleared
    expect(afterDefaults.float).toBe(1.5);
    expect(asRecord(afterDefaults.audio).path).toBe('audio/step.ogg'); // audio untouched

    // setAudio with no audio clears the hint.
    await call(deps, 'event.setAudio', { documentId, eventId });
    const cleared = asRecord(
      asRecord(await call(deps, 'event.get', { documentId, eventId })).event,
    );
    expect(cleared.audio).toBeUndefined();

    await call(deps, 'event.rename', { documentId, eventId, name: 'jump' });
    const renamed = asRecord(
      asRecord(await call(deps, 'event.get', { documentId, eventId })).event,
    );
    expect(renamed.name).toBe('jump');

    await call(deps, 'event.delete', { documentId, eventId });
    expect((asRecord(await call(deps, 'event.list', { documentId })).events as unknown[]).length).toBe(
      0,
    );
  });

  it('sets, moves, and deletes event-timeline keys and surfaces them through anim.get', async () => {
    const deps = makeDeps();
    const { documentId, animationId } = await buildEventRig(deps);
    const { eventId } = asRecord(await call(deps, 'event.define', { documentId, name: 'boom' }));

    await call(deps, 'event.key.set', {
      documentId,
      animationId,
      eventId: String(eventId),
      time: 0.5,
      int: 7,
    });

    const readKeys = async (): Promise<Array<{ id: string; time: number; int?: number }>> => {
      const animation = asRecord(
        asRecord(await call(deps, 'anim.get', { documentId, animationId })).animation,
      );
      return animation.events as Array<{ id: string; time: number; int?: number }>;
    };

    let keys = await readKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0]!.time).toBeCloseTo(0.5);
    expect(keys[0]!.int).toBe(7);
    const keyframeId = keys[0]!.id;

    await call(deps, 'event.key.move', { documentId, animationId, keyframeId, time: 1.25 });
    keys = await readKeys();
    expect(keys[0]!.time).toBeCloseTo(1.25);

    await call(deps, 'event.key.delete', { documentId, animationId, keyframeId });
    expect(await readKeys()).toHaveLength(0);
  });

  it('surfaces typed errors for a duplicate name, a missing event, and a missing key', async () => {
    const deps = makeDeps();
    const { documentId, animationId } = await buildEventRig(deps);
    await call(deps, 'event.define', { documentId, name: 'dup' });

    await expectToolError(
      call(deps, 'event.define', { documentId, name: 'dup' }),
      'EVENT_EDIT',
    );
    await expectToolError(
      call(deps, 'event.get', { documentId, eventId: 'nope' }),
      'EVENT_NOT_FOUND',
    );
    await expectToolError(
      call(deps, 'event.setAudio', {
        documentId,
        eventId: 'nope',
        audio: { path: 'a', volume: 0.5, balance: 0 },
      }),
      'EVENT_NOT_FOUND',
    );
    // An out-of-range volume reaches the command's audioRange guard (EVENT_EDIT, not INVALID_INPUT).
    const { eventId } = asRecord(await call(deps, 'event.define', { documentId, name: 'ranged' }));
    await expectToolError(
      call(deps, 'event.setAudio', {
        documentId,
        eventId: String(eventId),
        audio: { path: 'a', volume: 2, balance: 0 },
      }),
      'EVENT_EDIT',
    );
    await expectToolError(
      call(deps, 'event.key.move', {
        documentId,
        animationId,
        keyframeId: 'ghost',
        time: 0.1,
      }),
      'KEYFRAME_NOT_FOUND',
    );
    await expectToolError(
      call(deps, 'event.key.delete', { documentId, animationId, keyframeId: 'ghost' }),
      'KEYFRAME_NOT_FOUND',
    );
  });
});

describe('MCP draw-order tools (PP-D9)', () => {
  it('sets, moves, and deletes draw-order keys and surfaces them through anim.get', async () => {
    const deps = makeDeps();
    const { documentId, animationId, slotA, slotB } = await buildEventRig(deps);

    // slotB (setup index 1) moves to index 0.
    const set = asRecord(
      await call(deps, 'draworder.key.set', {
        documentId,
        animationId,
        time: 0,
        offsets: [{ slot: slotB, offset: -1 }],
      }),
    );
    expect(typeof set.revision).toBe('number');
    // slotA (setup index 0) moves to index 1.
    await call(deps, 'draworder.key.set', {
      documentId,
      animationId,
      time: 1,
      offsets: [{ slot: slotA, offset: 1 }],
    });

    const readKeys = async (): Promise<
      Array<{ id: string; time: number; offsets: Array<{ slot: string; offset: number }> }>
    > => {
      const animation = asRecord(
        asRecord(await call(deps, 'anim.get', { documentId, animationId })).animation,
      );
      return animation.drawOrder as Array<{
        id: string;
        time: number;
        offsets: Array<{ slot: string; offset: number }>;
      }>;
    };

    let keys = await readKeys();
    expect(keys).toHaveLength(2);
    expect(keys[0]!.offsets).toEqual([{ slot: slotB, offset: -1 }]);
    const secondKeyId = keys[1]!.id;

    // Move the second key to a free time (draw-order times are strictly ascending).
    await call(deps, 'draworder.key.move', {
      documentId,
      animationId,
      keyframeId: secondKeyId,
      time: 1.5,
    });
    keys = await readKeys();
    expect(keys[1]!.time).toBeCloseTo(1.5);

    await call(deps, 'draworder.key.delete', {
      documentId,
      animationId,
      keyframeId: secondKeyId,
    });
    expect(await readKeys()).toHaveLength(1);
  });

  it('surfaces DRAW_ORDER for a bad offset and KEYFRAME_COLLISION / KEYFRAME_NOT_FOUND on move', async () => {
    const deps = makeDeps();
    const { documentId, animationId, slotA, slotB } = await buildEventRig(deps);

    // A slot that does not exist in the document is a typed DRAW_ORDER (slotMissing).
    await expectToolError(
      call(deps, 'draworder.key.set', {
        documentId,
        animationId,
        time: 0,
        offsets: [{ slot: 'ghost', offset: 0 }],
      }),
      'DRAW_ORDER',
    );
    // An offset that targets an out-of-range index is a typed DRAW_ORDER (targetOutOfRange).
    await expectToolError(
      call(deps, 'draworder.key.set', {
        documentId,
        animationId,
        time: 0,
        offsets: [{ slot: slotA, offset: 5 }],
      }),
      'DRAW_ORDER',
    );

    await call(deps, 'draworder.key.set', {
      documentId,
      animationId,
      time: 0,
      offsets: [{ slot: slotB, offset: -1 }],
    });
    const second = asRecord(
      await call(deps, 'draworder.key.set', {
        documentId,
        animationId,
        time: 1,
        offsets: [{ slot: slotA, offset: 1 }],
      }),
    );
    expect(typeof second.revision).toBe('number');
    const animation = asRecord(
      asRecord(await call(deps, 'anim.get', { documentId, animationId })).animation,
    );
    const keys = animation.drawOrder as Array<{ id: string; time: number }>;
    const secondKeyId = keys.find((key) => key.time === 1)!.id;

    // Moving onto the time an existing key occupies is a typed KEYFRAME_COLLISION.
    await expectToolError(
      call(deps, 'draworder.key.move', {
        documentId,
        animationId,
        keyframeId: secondKeyId,
        time: 0,
      }),
      'KEYFRAME_COLLISION',
    );
    await expectToolError(
      call(deps, 'draworder.key.delete', { documentId, animationId, keyframeId: 'ghost' }),
      'KEYFRAME_NOT_FOUND',
    );
  });
});

describe('MCP document metadata tool (PP-D9)', () => {
  it('sets and clears the skeleton metadata block through the AI surface', async () => {
    const deps = makeDeps();
    const { documentId } = await buildEventRig(deps);

    const set = asRecord(
      await call(deps, 'document.setMetadata', {
        documentId,
        fps: 30,
        imagesPath: 'images',
        audioPath: 'audio',
      }),
    );
    expect(typeof set.revision).toBe('number');

    const exported = asRecord(await call(deps, 'document.export', { documentId }));
    const doc = exported.document as SkeletonDocument & {
      metadata?: { fps?: number; imagesPath?: string; audioPath?: string };
    };
    expect(doc.metadata?.fps).toBe(30);
    expect(doc.metadata?.imagesPath).toBe('images');

    // All fields absent clears the block; one undo restores it in a single step.
    await call(deps, 'document.setMetadata', { documentId });
    const cleared = asRecord(await call(deps, 'document.export', { documentId }));
    expect((cleared.document as { metadata?: unknown }).metadata).toBeUndefined();
    await call(deps, 'history.undo', { documentId });
    const restored = asRecord(await call(deps, 'document.export', { documentId }));
    const restoredDoc = restored.document as SkeletonDocument & { metadata?: { fps?: number } };
    expect(restoredDoc.metadata?.fps).toBe(30);
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

  const PP_D9_EVENT_TOOLS = [
    'event.define',
    'event.rename',
    'event.delete',
    'event.setDefaults',
    'event.setAudio',
    'event.list',
    'event.get',
    'event.key.set',
    'event.key.move',
    'event.key.delete',
    'draworder.key.set',
    'draworder.key.move',
    'draworder.key.delete',
    'document.setMetadata',
  ] as const;

  it('exposes every Phase 2 constraint / skin / deform tool with a unique name', () => {
    for (const name of PHASE_2_CONSTRAINT_TOOLS) {
      expect(byName.has(name), `missing tool ${name}`).toBe(true);
    }
    // Tool names are unique across the whole catalog.
    expect(byName.size).toBe(TOOLS.length);
  });

  it('exposes every Stage F1 event / draw-order / metadata tool with a unique name', () => {
    for (const name of PP_D9_EVENT_TOOLS) {
      expect(byName.has(name), `missing tool ${name}`).toBe(true);
    }
  });
});

// A one-page atlas ref with a single named region that fills the page, the shape the editor atlas-pack
// pipeline produces. `file` is the project-relative page path the render tool loads from disk.
function oneRegionAtlas(file: string, region: string, size = 8): unknown {
  return {
    pages: [
      {
        file,
        width: size,
        height: size,
        regions: [
          {
            name: region,
            x: 0,
            y: 0,
            w: size,
            h: size,
            rotated: false,
            offsetX: 0,
            offsetY: 0,
            originalW: size,
            originalH: size,
          },
        ],
      },
    ],
  };
}

// Skeletal atlas control surface (atlas.set / atlas.get): the AtlasRef the editor packs is installed on
// the live document through the command history (LAW 2), unblocking a valid region attachment.
describe('MCP atlas tools', () => {
  it('sets an atlas, reads it back, and a region attachment referencing it validates', async () => {
    const deps = makeDeps();
    const { documentId } = asRecord(await call(deps, 'document.new', { name: 'atlas' }));

    await call(deps, 'atlas.set', { documentId, atlas: oneRegionAtlas('atlas0.png', 'tile') });

    const got = asRecord(await call(deps, 'atlas.get', { documentId }));
    const pages = asRecord(got.atlas).pages as Array<{
      file: string;
      regions: Array<{ name: string }>;
    }>;
    expect(pages).toHaveLength(1);
    expect(pages[0]!.regions.map((r) => r.name)).toEqual(['tile']);

    // A region attachment referencing an installed region now validates for export (LAW 3).
    const { boneId } = asRecord(
      await call(deps, 'bone.create', { documentId, name: 'root', length: 50 }),
    );
    const { slotId } = asRecord(
      await call(deps, 'slot.create', { documentId, boneId, name: 'body' }),
    );
    await call(deps, 'attach.region.add', {
      documentId,
      slotId,
      name: 'body_img',
      path: 'tile',
      width: 64,
      height: 64,
    });
    const validation = asRecord(await call(deps, 'document.validate', { documentId }));
    expect(validation.ok).toBe(true);
  });

  it('rejects a malformed atlas loudly at the Zod boundary', async () => {
    const deps = makeDeps();
    const { documentId } = asRecord(await call(deps, 'document.new', { name: 'bad' }));

    // A region missing the required numeric `w` field is a shape violation (INVALID_INPUT).
    await expectToolError(
      call(deps, 'atlas.set', {
        documentId,
        atlas: {
          pages: [
            {
              file: 'p.png',
              width: 8,
              height: 8,
              regions: [
                {
                  name: 'tile',
                  x: 0,
                  y: 0,
                  h: 8,
                  rotated: false,
                  offsetX: 0,
                  offsetY: 0,
                  originalW: 8,
                  originalH: 8,
                },
              ],
            },
          ],
        },
      }),
      'INVALID_INPUT',
    );
  });
});

// render_frame (ADR-0006): the headless render-to-PNG feedback tool. An LLM authoring over MCP renders the
// live document so it can SEE a frame, with or without atlas page pixels on disk.
describe('MCP render_frame tool', () => {
  // A one-page solid-RGBA PNG the way the editor's atlas packer would emit it, so the tool decodes a real
  // page rather than a fabricated buffer.
  function solidPagePng(
    width: number,
    height: number,
    r: number,
    g: number,
    b: number,
  ): Uint8Array {
    const png = new PNG({ width, height });
    for (let i = 0; i < width * height; i += 1) {
      const base = i * 4;
      png.data[base] = r;
      png.data[base + 1] = g;
      png.data[base + 2] = b;
      png.data[base + 3] = 255;
    }
    return PNG.sync.write(png);
  }

  // Author a bone + slot riding it. No region attachment: a region attachment requires a matching atlas
  // region (LAW 3, ATTACHMENT_REGION_MISSING), so the placeholder (atlas-less) path carries no drawable
  // geometry and is framed with an explicit fit rect.
  async function authorBareRig(deps: ToolDeps): Promise<string> {
    const { documentId } = asRecord(await call(deps, 'document.new', { name: 'render' }));
    const { boneId } = asRecord(
      await call(deps, 'bone.create', { documentId, name: 'root', length: 100 }),
    );
    await call(deps, 'slot.create', { documentId, boneId, name: 'body' });
    return documentId as string;
  }

  // Author a bone + slot + sized region attachment resolving against an installed one-region atlas whose
  // page file is `pageFile`. Returns the document id; the caller decides whether the page pixels are on
  // disk (real render) or absent (missing-page error).
  async function authorTexturedRig(deps: ToolDeps, pageFile: string): Promise<string> {
    const { documentId } = asRecord(await call(deps, 'document.new', { name: 'render' }));
    await call(deps, 'atlas.set', { documentId, atlas: oneRegionAtlas(pageFile, 'tile') });
    const { boneId } = asRecord(
      await call(deps, 'bone.create', { documentId, name: 'root', length: 100 }),
    );
    const { slotId } = asRecord(
      await call(deps, 'slot.create', { documentId, boneId, name: 'body' }),
    );
    await call(deps, 'attach.region.add', {
      documentId,
      slotId,
      name: 'body_img',
      path: 'tile',
      width: 64,
      height: 64,
    });
    await call(deps, 'slot.activeAttachment', { documentId, slotId, attachment: 'body_img' });
    return documentId as string;
  }

  it('renders a placeholder frame at the requested size when the document has no atlas pages', async () => {
    const deps = makeDeps();
    const documentId = await authorBareRig(deps);

    const result = asRecord(
      await call(deps, 'render_frame', {
        documentId,
        width: 128,
        height: 96,
        fit: { x: -50, y: -50, w: 100, h: 100 },
      }),
    );

    expect(result.placeholders).toBe(true);
    expect(result.width).toBe(128);
    expect(result.height).toBe(96);
    expect(result.bytes).toBeGreaterThan(0);

    const decoded = PNG.sync.read(Buffer.from(result.pngBase64 as string, 'base64'));
    expect(decoded.width).toBe(128);
    expect(decoded.height).toBe(96);
  });

  it('renders real atlas-page pixels deterministically across two calls', async () => {
    const files = inMemoryFiles();
    const deps: ToolDeps = { sessions: new SessionRegistry(), files: files.store };

    const documentId = await authorTexturedRig(deps, 'atlas0.png');
    files.binary.set('atlas0.png', solidPagePng(8, 8, 200, 40, 40));

    const first = asRecord(await call(deps, 'render_frame', { documentId, width: 64, height: 64 }));
    const second = asRecord(
      await call(deps, 'render_frame', { documentId, width: 64, height: 64 }),
    );

    expect(first.placeholders).toBe(false);
    expect(first.width).toBe(64);
    expect(first.height).toBe(64);
    const decoded = PNG.sync.read(Buffer.from(first.pngBase64 as string, 'base64'));
    expect(decoded.width).toBe(64);
    expect(decoded.height).toBe(64);
    // Byte-determinism (ADR-0006): same document + inputs => byte-identical PNG.
    expect(second.pngBase64).toBe(first.pngBase64);
  });

  it('rejects an unknown animation with ANIMATION_NOT_FOUND', async () => {
    const files = inMemoryFiles();
    const deps: ToolDeps = { sessions: new SessionRegistry(), files: files.store };
    const documentId = await authorTexturedRig(deps, 'atlas0.png');
    files.binary.set('atlas0.png', solidPagePng(8, 8, 10, 20, 30));

    await expectToolError(
      call(deps, 'render_frame', { documentId, animation: 'does_not_exist' }),
      'ANIMATION_NOT_FOUND',
    );
  });

  it('rejects an out-of-range width at the Zod boundary', async () => {
    const deps = makeDeps();
    const documentId = await authorBareRig(deps);

    await expectToolError(call(deps, 'render_frame', { documentId, width: 5000 }), 'INVALID_INPUT');
  });

  it('fails loudly when a referenced atlas page file is missing on disk', async () => {
    const files = inMemoryFiles();
    const deps: ToolDeps = { sessions: new SessionRegistry(), files: files.store };

    // The atlas references 'missing.png', but no page pixels are seeded on disk.
    const documentId = await authorTexturedRig(deps, 'missing.png');

    await expectToolError(
      call(deps, 'render_frame', { documentId, width: 64, height: 64 }),
      'RENDER_ATLAS_PAGE_MISSING',
    );
  });
});

// Attachment-swap keyframes (kf.attachment.set / kf.attachment.delete): an LLM keys the stepped slot
// attachment timeline (show attachment X at t, hide at t') through the same document-core command + History
// as the GUI (LAW 2). The tools pre-validate targets like ik.setKeyframe: a missing animation/slot is a
// typed *_NOT_FOUND, and a non-null swap name that does not resolve on the slot is ATTACHMENT_NOT_FOUND.
describe('MCP attachment keyframe tools', () => {
  // A rig with one slot carrying a resolvable region attachment ('body_img') and a one-second animation, so
  // a swap frame's non-null name resolves and the time is in range.
  async function buildSwapRig(deps: ToolDeps): Promise<{
    documentId: string;
    slotId: string;
    animationId: string;
  }> {
    const { documentId } = asRecord(await call(deps, 'document.new', { name: 'swap' }));
    await call(deps, 'atlas.set', { documentId, atlas: oneRegionAtlas('atlas0.png', 'tile') });
    const { boneId } = asRecord(
      await call(deps, 'bone.create', { documentId, name: 'root', length: 100 }),
    );
    const { slotId } = asRecord(
      await call(deps, 'slot.create', { documentId, boneId, name: 'body' }),
    );
    await call(deps, 'attach.region.add', {
      documentId,
      slotId,
      name: 'body_img',
      path: 'tile',
      width: 64,
      height: 64,
    });
    const { animationId } = asRecord(
      await call(deps, 'anim.create', { documentId, name: 'idle', duration: 1 }),
    );
    return {
      documentId: String(documentId),
      slotId: String(slotId),
      animationId: String(animationId),
    };
  }

  // Read the attachment-swap frames on a slot's timeline out of anim.get.
  async function swapFrames(
    deps: ToolDeps,
    documentId: string,
    animationId: string,
    slotId: string,
  ): Promise<Array<{ id: string; time: number; name: string | null }>> {
    const animGet = asRecord(await call(deps, 'anim.get', { documentId, animationId }));
    const slots = asRecord(animGet.animation).slots as Array<{
      slotId: string;
      attachment: Array<{ id: string; time: number; name: string | null }>;
    }>;
    return slots.find((track) => track.slotId === slotId)?.attachment ?? [];
  }

  it('sets, replaces, deletes, and undoes an attachment-swap frame', async () => {
    const deps = makeDeps();
    const { documentId, slotId, animationId } = await buildSwapRig(deps);

    // Set a frame showing 'body_img' at t=0.5.
    await call(deps, 'kf.attachment.set', {
      documentId,
      animationId,
      slotId,
      time: 0.5,
      name: 'body_img',
    });
    const afterSet = await swapFrames(deps, documentId, animationId, slotId);
    expect(afterSet).toHaveLength(1);
    expect(afterSet[0]!.time).toBe(0.5);
    expect(afterSet[0]!.name).toBe('body_img');
    const frameId = afterSet[0]!.id;

    // Replace at the SAME time with a null (hide) target: the frame keeps its id, its name flips to null.
    await call(deps, 'kf.attachment.set', {
      documentId,
      animationId,
      slotId,
      time: 0.5,
      name: null,
    });
    const afterReplace = await swapFrames(deps, documentId, animationId, slotId);
    expect(afterReplace).toHaveLength(1);
    expect(afterReplace[0]!.id).toBe(frameId);
    expect(afterReplace[0]!.name).toBeNull();

    // Delete the frame: the emptied timeline is pruned.
    await call(deps, 'kf.attachment.delete', { documentId, animationId, slotId, time: 0.5 });
    expect(await swapFrames(deps, documentId, animationId, slotId)).toHaveLength(0);

    // One undo restores the pre-delete state (the null-target frame).
    await call(deps, 'history.undo', { documentId });
    const afterUndo = await swapFrames(deps, documentId, animationId, slotId);
    expect(afterUndo).toHaveLength(1);
    expect(afterUndo[0]!.id).toBe(frameId);
    expect(afterUndo[0]!.name).toBeNull();
  });

  it('surfaces typed errors for an unknown animation, an unknown slot, and an unresolved name', async () => {
    const deps = makeDeps();
    const { documentId, slotId, animationId } = await buildSwapRig(deps);

    await expectToolError(
      call(deps, 'kf.attachment.set', {
        documentId,
        animationId: 'nope',
        slotId,
        time: 0.5,
        name: 'body_img',
      }),
      'ANIMATION_NOT_FOUND',
    );

    await expectToolError(
      call(deps, 'kf.attachment.set', {
        documentId,
        animationId,
        slotId: 'nope',
        time: 0.5,
        name: 'body_img',
      }),
      'SLOT_NOT_FOUND',
    );

    // A non-null name that resolves to no attachment on the slot is rejected before the command runs.
    await expectToolError(
      call(deps, 'kf.attachment.set', {
        documentId,
        animationId,
        slotId,
        time: 0.5,
        name: 'ghost',
      }),
      'ATTACHMENT_NOT_FOUND',
    );

    // Deleting a time that carries no frame is a typed KEYFRAME_NOT_FOUND.
    await expectToolError(
      call(deps, 'kf.attachment.delete', { documentId, animationId, slotId, time: 9 }),
      'KEYFRAME_NOT_FOUND',
    );
  });
});

// render_frame effects overlay: the `effect` param composes a solved effect/bundle from the live effects
// library ON TOP of the skeleton in one PNG (renderComposedFrame). The effect's OWN atlas pages are
// resolved from disk exactly like the skeleton's. World-space anchors only in this pass.
describe('MCP render_frame effects overlay', () => {
  function solidPagePng(
    width: number,
    height: number,
    r: number,
    g: number,
    b: number,
  ): Uint8Array {
    const png = new PNG({ width, height });
    for (let i = 0; i < width * height; i += 1) {
      const base = i * 4;
      png.data[base] = r;
      png.data[base + 1] = g;
      png.data[base + 2] = b;
      png.data[base + 3] = 255;
    }
    return PNG.sync.write(png);
  }

  // Author a textured skeleton (page 'sk.png' on disk) AND a one-layer additive spriteAnimator effect named
  // 'burst' over the effects atlas 'vfx.png' (also on disk). Returns the document id and the effect name.
  async function authorSkeletonWithEffect(
    deps: ToolDeps,
    files: ReturnType<typeof inMemoryFiles>,
  ): Promise<{ documentId: string; effectName: string }> {
    const { documentId } = asRecord(await call(deps, 'document.new', { name: 'compose' }));

    await call(deps, 'atlas.set', { documentId, atlas: oneRegionAtlas('sk.png', 'tile') });
    const { boneId } = asRecord(
      await call(deps, 'bone.create', { documentId, name: 'root', length: 100 }),
    );
    const { slotId } = asRecord(
      await call(deps, 'slot.create', { documentId, boneId, name: 'body' }),
    );
    await call(deps, 'attach.region.add', {
      documentId,
      slotId,
      name: 'body_img',
      path: 'tile',
      width: 64,
      height: 64,
    });
    await call(deps, 'slot.activeAttachment', { documentId, slotId, attachment: 'body_img' });
    files.binary.set('sk.png', solidPagePng(8, 8, 40, 80, 200));

    await call(deps, 'effect.setAtlas', { documentId, atlas: atlasWith(['glow']) });
    const { effectId } = asRecord(
      await call(deps, 'effect.create', { documentId, name: 'burst', blendMode: 'additive' }),
    );
    await call(deps, 'effect.layer.add', {
      documentId,
      effectId,
      kind: 'spriteAnimator',
      blendMode: 'additive',
      region: 'glow',
    });
    files.binary.set('vfx.png', solidPagePng(256, 256, 255, 255, 255));

    return { documentId: String(documentId), effectName: 'burst' };
  }

  it('overlays a solved effect and differs byte-wise from the skeleton-only frame', async () => {
    const files = inMemoryFiles();
    const deps: ToolDeps = { sessions: new SessionRegistry(), files: files.store };
    const { documentId, effectName } = await authorSkeletonWithEffect(deps, files);

    const baseline = asRecord(
      await call(deps, 'render_frame', { documentId, width: 64, height: 64 }),
    );
    const composed = asRecord(
      await call(deps, 'render_frame', {
        documentId,
        width: 64,
        height: 64,
        effect: { effect: effectName, seed: 7, time: 0.1, anchors: { default: { x: 0, y: 0 } } },
      }),
    );

    expect(baseline.placeholders).toBe(false);
    expect(composed.placeholders).toBe(false);
    expect(composed.width).toBe(64);
    expect(composed.height).toBe(64);
    expect(composed.bytes).toBeGreaterThan(0);

    const decoded = PNG.sync.read(Buffer.from(composed.pngBase64 as string, 'base64'));
    expect(decoded.width).toBe(64);
    expect(decoded.height).toBe(64);

    // The overlay changes the frame: the composed PNG cannot be byte-identical to the skeleton-only one.
    expect(composed.pngBase64).not.toBe(baseline.pngBase64);
  });

  it('rejects an unknown bundle name with RENDER_BUNDLE_NOT_FOUND', async () => {
    const files = inMemoryFiles();
    const deps: ToolDeps = { sessions: new SessionRegistry(), files: files.store };
    const { documentId } = await authorSkeletonWithEffect(deps, files);

    await expectToolError(
      call(deps, 'render_frame', {
        documentId,
        width: 64,
        height: 64,
        effect: { bundle: 'nope', seed: 1 },
      }),
      'RENDER_BUNDLE_NOT_FOUND',
    );
  });

  it('rejects a trigger naming both an effect and a bundle', async () => {
    const files = inMemoryFiles();
    const deps: ToolDeps = { sessions: new SessionRegistry(), files: files.store };
    const { documentId, effectName } = await authorSkeletonWithEffect(deps, files);

    await expectToolError(
      call(deps, 'render_frame', {
        documentId,
        width: 64,
        height: 64,
        effect: { effect: effectName, bundle: 'also', seed: 1 },
      }),
      'RENDER_INVALID_EFFECT_TRIGGER',
    );
  });

  it('fails loudly when the effects library cannot export (a layer region with no atlas)', async () => {
    const files = inMemoryFiles();
    const deps: ToolDeps = { sessions: new SessionRegistry(), files: files.store };

    // A valid skeleton (so its export passes) but an effect whose layer references a region the effects
    // atlas does not resolve (no effect.setAtlas): the effects export fails region resolution loudly.
    const { documentId } = asRecord(await call(deps, 'document.new', { name: 'noatlas' }));
    const { boneId } = asRecord(
      await call(deps, 'bone.create', { documentId, name: 'root', length: 100 }),
    );
    await call(deps, 'slot.create', { documentId, boneId, name: 'body' });
    const { effectId } = asRecord(await call(deps, 'effect.create', { documentId, name: 'burst' }));
    await call(deps, 'effect.layer.add', {
      documentId,
      effectId,
      kind: 'spriteAnimator',
      region: 'glow',
    });

    await expectToolError(
      call(deps, 'render_frame', {
        documentId,
        width: 64,
        height: 64,
        fit: { x: -50, y: -50, w: 100, h: 100 },
        effect: { effect: 'burst', seed: 1 },
      }),
      'RENDER_INVALID_EFFECTS_DOCUMENT',
    );
  });
});

// atlas.pack (ADR-0007): the headless pack tool runs the shared deterministic pipeline through the host
// FileStore. This is the full LLM-authoring loop headless: pack source PNGs -> attach a packed region ->
// render real textured pixels, plus the confinement and empty-source negatives.
describe('MCP atlas.pack tool', () => {
  // Seed N synthetic source PNGs (each an opaque content box on transparency, so trim yields a real
  // region) under sourceDir in the in-memory FileStore, exactly as the tool will list and read them.
  function seedSprites(
    files: ReturnType<typeof inMemoryFiles>,
    sourceDir: string,
    names: readonly string[],
  ): void {
    names.forEach((name, index) => {
      files.binary.set(
        `${sourceDir}/${name}.png`,
        makeSpritePng({
          width: 16,
          height: 16,
          contentX: 1,
          contentY: 1,
          contentW: 12 + index,
          contentH: 12,
          seed: index + 1,
        }),
      );
    });
  }

  it('packs source PNGs, installs the AtlasRef, and renders real pixels end to end', async () => {
    const files = inMemoryFiles();
    const deps: ToolDeps = { sessions: new SessionRegistry(), files: files.store };
    seedSprites(files, 'sprites', ['torso', 'arm', 'head']);

    const { documentId } = asRecord(await call(deps, 'document.new', { name: 'packed' }));
    const { boneId } = asRecord(
      await call(deps, 'bone.create', { documentId, name: 'root', length: 100 }),
    );
    const { slotId } = asRecord(
      await call(deps, 'slot.create', { documentId, boneId, name: 'body' }),
    );

    const packed = asRecord(
      await call(deps, 'atlas.pack', {
        documentId,
        sourceDir: 'sprites',
        outputDir: 'atlas',
      }),
    );

    // The command ran on the live History (a revision advance) and installed a one-page atlas whose
    // regions are the three source base names.
    expect(typeof packed.revision).toBe('number');
    const atlas = packed.atlas as AtlasRef;
    expect(atlas.pages).toHaveLength(1);
    const page = atlas.pages[0];
    expect(page).toBeDefined();
    if (page === undefined) throw new Error('expected a packed page');
    expect(page.file).toBe('atlas/atlas-0.png');
    expect(page.regions.map((region) => region.name).sort()).toEqual(['arm', 'head', 'torso']);

    // The page PNG was written under outputDir through the FileStore, at the project-relative path the
    // AtlasRef records (so render_frame reads it back).
    expect(files.binary.has('atlas/atlas-0.png')).toBe(true);

    // atlas.get reflects the installed atlas, and the document validates.
    const got = asRecord(await call(deps, 'atlas.get', { documentId }));
    expect((got.atlas as AtlasRef).pages).toHaveLength(1);

    // A region attachment referencing a packed region validates (the region resolves in the atlas).
    await call(deps, 'attach.region.add', {
      documentId,
      slotId,
      name: 'body_img',
      path: 'torso',
      width: 64,
      height: 64,
    });
    await call(deps, 'slot.activeAttachment', { documentId, slotId, attachment: 'body_img' });
    const validation = asRecord(await call(deps, 'document.validate', { documentId }));
    expect(validation.ok).toBe(true);

    // render_frame renders NON-placeholder output from the packed pages read back off the FileStore.
    const frame = asRecord(await call(deps, 'render_frame', { documentId, width: 64, height: 64 }));
    expect(frame.placeholders).toBe(false);
    const decoded = PNG.sync.read(Buffer.from(frame.pngBase64 as string, 'base64'));
    expect(decoded.width).toBe(64);
    expect(decoded.height).toBe(64);
  });

  it('honors maxPageSize and padding config', async () => {
    const files = inMemoryFiles();
    const deps: ToolDeps = { sessions: new SessionRegistry(), files: files.store };
    seedSprites(files, 'sprites', ['a', 'b']);
    const { documentId } = asRecord(await call(deps, 'document.new', { name: 'cfg' }));

    const packed = asRecord(
      await call(deps, 'atlas.pack', {
        documentId,
        sourceDir: 'sprites',
        outputDir: 'atlas',
        maxPageSize: 256,
        padding: 4,
      }),
    );
    const page = (packed.atlas as AtlasRef).pages[0];
    if (page === undefined) throw new Error('expected a packed page');
    expect(page.width).toBe(256);
    expect(page.height).toBe(256);
  });

  it('rejects an empty source directory with ATLAS_PACK_EMPTY_SOURCE', async () => {
    const deps = makeDeps();
    const { documentId } = asRecord(await call(deps, 'document.new', { name: 'empty' }));

    await expectToolError(
      call(deps, 'atlas.pack', { documentId, sourceDir: 'nothing', outputDir: 'atlas' }),
      'ATLAS_PACK_EMPTY_SOURCE',
    );
  });

  it('rejects a source directory that escapes the project root with PATH_FORBIDDEN', async () => {
    let root = '';
    try {
      root = await mkdtemp(join(tmpdir(), 'marionette-atlas-pack-'));
      const deps: ToolDeps = {
        sessions: new SessionRegistry(),
        files: createNodeFileStore(root),
      };
      const { documentId } = asRecord(await call(deps, 'document.new', { name: 'escape' }));

      await expectToolError(
        call(deps, 'atlas.pack', { documentId, sourceDir: '../outside', outputDir: 'atlas' }),
        'PATH_FORBIDDEN',
      );
    } finally {
      if (root) await rm(root, { recursive: true, force: true });
    }
  });
});
