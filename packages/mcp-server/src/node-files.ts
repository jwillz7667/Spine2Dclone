import { readFile, readdir, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { McpToolError } from './errors';
import type { FileStore } from './files';

// A node:fs FileStore confined to a single project root. The HOST decides the root; every path the AI
// supplies is resolved against it and a path that escapes the root (via .. or an absolute path) is
// rejected with a typed PATH_FORBIDDEN error before any disk access. This is the file-policy boundary
// for the headless server: an MCP client can read and write only inside the project it was launched for.
export function createNodeFileStore(projectRoot: string): FileStore {
  const root = resolve(projectRoot);

  const confine = (path: string): string => {
    const resolved = resolve(root, path);
    const rel = relative(root, resolved);
    // rel escapes the root when it starts with '..' (a parent) or is itself absolute (a different
    // Windows drive). The root itself yields '' which is allowed. sep is platform-correct ('/' or '\').
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new McpToolError('PATH_FORBIDDEN', `path "${path}" escapes the project root`, { root });
    }
    return resolved;
  };

  // async so a synchronous confine() throw surfaces as a rejected promise (a FileStore contract: all
  // failures are rejections, never synchronous throws), matching how tool handlers await these.
  return {
    read: async (path) => readFile(confine(path), 'utf8'),
    write: async (path, content) => writeFile(confine(path), content, 'utf8'),
    // No encoding => a Buffer (a Uint8Array), the raw page bytes the PNG decoder consumes.
    readBinary: async (path) => readFile(confine(path)),
    writeBinary: async (path, data) => writeFile(confine(path), data),
    listDir: async (path) => {
      const entries = await readdir(confine(path), { withFileTypes: true });
      return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    },
  };
}
