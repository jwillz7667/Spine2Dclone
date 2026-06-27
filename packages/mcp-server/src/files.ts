// Injected filesystem so the package is testable without Node fs and so the HOST controls path policy
// (resolution against a project root, traversal rejection). The headless entry provides a node:fs
// implementation that confines reads/writes to a configured project root.
export interface FileStore {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
}
