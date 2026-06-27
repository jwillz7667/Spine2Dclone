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
    expect(doc.formatVersion).toBe('0.1.0');
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
