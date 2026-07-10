import { defineConfig } from 'vitest/config';

// The import-spine suites are pure logic: the converter is a pure function of a parsed JSON value, so
// the node environment is sufficient and no filesystem, DOM, or network access is required. Fixtures are
// hand-authored TypeScript objects (built from the published Spine format documentation), never real
// Spine exports, per the clean-room legal posture (see README).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
