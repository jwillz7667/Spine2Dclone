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
});
