import { defineConfig } from 'vitest/config';

// The format package unit suites (schema accept/reject, validator purity, semantic graph checks,
// hashing, the golden corpus, and the barrel surface) are pure and run in the Node environment.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
