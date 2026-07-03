import { readFile, readdir, writeFile } from 'node:fs/promises';

// Injected filesystem so the trim/pack logic is unit-testable without touching real disk, mirroring how
// packages/mcp-server injects its FileStore. The default node:fs implementation is used by the IPC layer;
// tests use an in-memory store (memory-file-store.ts). Unlike the mcp-server store this one operates on
// bytes (atlas PNGs are binary) and lists a directory. It does NOT confine paths to a root: the atlas
// service runs in the Electron main process and is handed trusted absolute paths from the project config
// or a main-process dialog, never raw renderer input (the path-injection defense lives at the IPC edge,
// the same posture as main/file-io.ts).
export interface AtlasFileStore {
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, data: Uint8Array): Promise<void>;
  // Returns the file base names directly under `path` (no directories, no recursion).
  listDir(path: string): Promise<readonly string[]>;
}

export function createNodeFileStore(): AtlasFileStore {
  return {
    readBytes: async (path) => new Uint8Array(await readFile(path)),
    writeBytes: async (path, data) => writeFile(path, data),
    listDir: async (path) => {
      const entries = await readdir(path, { withFileTypes: true });
      return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    },
  };
}
