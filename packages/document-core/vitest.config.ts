import { defineConfig } from 'vitest/config';

// The document-core suites (model, mutator, history, commands, round-trip harness) are pure and run
// in the Node environment with no DOM or WebGL context. The allocation probes for batch-mode drags
// need a real GC, so the worker is launched with --expose-gc.
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
