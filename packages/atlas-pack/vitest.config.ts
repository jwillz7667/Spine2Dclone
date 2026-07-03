import { defineConfig } from 'vitest/config';

// The atlas-pack suites (concurrency, import, trim, pack determinism, PNG codec, and the full pipeline)
// are pure Node: the codec is pngjs (pure JS) and the packer is deterministic, so no DOM, WebGL, or GPU
// context is involved. Tests use the in-memory AtlasFileStore and synthetic sprites (src/testing.ts).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
