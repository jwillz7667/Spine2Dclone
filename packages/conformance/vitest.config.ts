import { defineConfig } from 'vitest/config';

// The conformance unit suites (rig validation, the compare engine, the independent analytic oracle,
// and the runtime-core-side fixture round-trip) are pure and run in the Node environment. They read
// the committed rig, sample-spec, and fixture from disk, so the filesystem is the only I/O.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
