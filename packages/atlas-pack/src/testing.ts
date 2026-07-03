// Test/dev support surface (NOT the production barrel): the in-memory AtlasFileStore and the synthetic
// sprite/PNG generators with KNOWN alpha bounding boxes. Kept on a dedicated '@marionette/atlas-pack/testing'
// subpath so production code cannot accidentally depend on test fixtures, while the editor's rembg suite
// (which stayed in apps/editor) and downstream consumers (the MCP server tests) can build synthetic inputs.

export { createMemoryFileStore } from './memory-file-store';
export type { MemoryFileStore } from './memory-file-store';

export { makeRgba, makeSpritePng, cropRgba, bytesEqual, defined } from './synthetic';
export type { SyntheticSpriteSpec } from './synthetic';
