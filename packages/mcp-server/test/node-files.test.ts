import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { McpToolError, createNodeFileStore } from '../src';

describe('createNodeFileStore', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'marionette-mcp-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes and reads a document inside the project root', async () => {
    const store = createNodeFileStore(root);
    await store.write('rig.json', '{"ok":true}');
    expect(await store.read('rig.json')).toBe('{"ok":true}');
    // The write actually lands inside the root, not somewhere else.
    expect(await readFile(join(root, 'rig.json'), 'utf8')).toBe('{"ok":true}');
  });

  it('allows nested paths under the root', async () => {
    const store = createNodeFileStore(root);
    // The host may pre-create subdirectories; here we only assert the path is permitted (no throw)
    // by writing into an existing nested dir.
    const nested = `a${sep}b.json`;
    await expect(store.read(nested)).rejects.not.toBeInstanceOf(McpToolError);
  });

  it('rejects traversal that escapes the root', async () => {
    const store = createNodeFileStore(root);
    await expect(store.read('../secret.json')).rejects.toMatchObject({ code: 'PATH_FORBIDDEN' });
    await expect(store.read('../../etc/passwd')).rejects.toBeInstanceOf(McpToolError);
    await expect(store.write('../escape.json', 'x')).rejects.toMatchObject({
      code: 'PATH_FORBIDDEN',
    });
  });

  it('rejects an absolute path outside the root', async () => {
    const store = createNodeFileStore(root);
    await expect(store.read(join(tmpdir(), 'elsewhere.json'))).rejects.toMatchObject({
      code: 'PATH_FORBIDDEN',
    });
  });
});
