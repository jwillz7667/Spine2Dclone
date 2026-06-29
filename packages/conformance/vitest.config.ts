import { defineConfig } from 'vitest/config';

// The conformance unit suites (rig validation, the compare engine, the independent analytic oracle,
// and the runtime-core-side fixture round-trip) are pure and run in the Node environment. They read
// the committed rig, sample-spec, and fixture from disk, so the filesystem is the only I/O. The Phase 3
// perf gates (phase3-perf-gates.test.ts) add allocation probes that need a real GC, so the worker is
// launched with --expose-gc (the probe asserts the per-frame heap delta stays within the committed
// perf/baseline.json budget).
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
