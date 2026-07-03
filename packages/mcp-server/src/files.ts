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
  // Write raw bytes (packed atlas page PNGs for the atlas.pack tool, ADR-0007). Same confinement as
  // `write`: the host resolves against the project root and rejects traversal, so the pipeline cannot
  // write pages outside the project.
  writeBinary(path: string, data: Uint8Array): Promise<void>;
  // List the file base names directly under `path` (no directories, no recursion). The atlas.pack tool
  // enumerates source PNGs through this seam. Same confinement as the reads/writes above.
  listDir(path: string): Promise<readonly string[]>;
}
