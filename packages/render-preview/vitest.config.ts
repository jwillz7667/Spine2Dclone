import { defineConfig } from 'vitest/config';

// The render-preview suites are pure Node: the CPU rasterizer needs no WebGL, DOM, or GPU context, so the
// node environment is sufficient. Tests load committed golden PNGs and the read-only conformance rig from
// the filesystem and compare bytes, exactly like the conformance fixtures (ADR-0006 determinism contract).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
