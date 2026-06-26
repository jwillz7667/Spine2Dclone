import { defineConfig } from 'vitest/config';

// The Phase-0 editor unit suites (window security posture, CSP, IPC contract) are pure and run in
// the Node environment with no Electron, DOM, or WebGL context.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
