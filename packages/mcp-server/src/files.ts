// Injected filesystem so the package is testable without Node fs and so the HOST controls path policy
// (resolution against a project root, traversal rejection). The headless entry provides a node:fs
// implementation that confines reads/writes to a configured project root.
export interface FileStore {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  // Read a file as raw bytes (atlas page PNGs for the render_frame tool). Path policy is identical to
  // `read`: the host resolves against the project root and rejects traversal, so binary reads cannot
  // escape the sandbox either.
  readBinary(path: string): Promise<Uint8Array>;
}
