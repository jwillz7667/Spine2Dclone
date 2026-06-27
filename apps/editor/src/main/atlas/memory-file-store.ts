import type { AtlasFileStore } from './file-store';

// In-memory AtlasFileStore for unit tests (and dry runs): the pack/trim logic stays testable without
// touching real disk, the same dependency-injection posture as packages/mcp-server. Keys are full path
// strings; both POSIX and Windows separators are accepted so node:path.join output works on either host.
// This is test/dev support and is intentionally not part of the production barrel (index.ts).

const SEP = /[\\/]+/;

function splitPath(path: string): { dir: string; name: string } {
  const parts = path.split(SEP).filter((part) => part.length > 0);
  const name = parts.length > 0 ? parts[parts.length - 1] : '';
  return { dir: parts.slice(0, -1).join('/'), name: name ?? '' };
}

function normalizeDir(path: string): string {
  return path
    .split(SEP)
    .filter((part) => part.length > 0)
    .join('/');
}

export interface MemoryFileStore extends AtlasFileStore {
  // Test affordances over the injected interface.
  has(path: string): boolean;
  snapshot(): ReadonlyMap<string, Uint8Array>;
}

export function createMemoryFileStore(
  seed: Iterable<readonly [string, Uint8Array]> = [],
): MemoryFileStore {
  const files = new Map<string, Uint8Array>();
  for (const [path, data] of seed) {
    files.set(normalizeDir(path), data);
  }

  return {
    readBytes: async (path) => {
      const data = files.get(normalizeDir(path));
      if (data === undefined) {
        throw new Error(`memory-file-store: no file at "${path}"`);
      }
      return data;
    },
    writeBytes: async (path, data) => {
      files.set(normalizeDir(path), data);
    },
    listDir: async (path) => {
      const target = normalizeDir(path);
      const names: string[] = [];
      for (const key of files.keys()) {
        const { dir, name } = splitPath(key);
        if (dir === target && name.length > 0) names.push(name);
      }
      return names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    },
    has: (path) => files.has(normalizeDir(path)),
    snapshot: () => new Map(files),
  };
}
