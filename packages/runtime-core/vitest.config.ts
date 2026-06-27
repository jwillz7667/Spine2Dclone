import { defineConfig } from 'vitest/config';

// The runtime-core unit suites (affine math, world-transform pass, determinism, golden) are pure and
// run in the Node environment. The determinism allocation probe needs a real GC, so the worker is
// launched with --expose-gc (the probe asserts the per-call heap delta stays near zero).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    pool: 'forks',
    poolOptions: {
      forks: {
        execArgv: ['--expose-gc'],
      },
    },
  },
});
