import { build } from 'esbuild';

// The monorepo uses bundler-style module resolution and the workspace packages export TypeScript
// source (their `exports` point at ./src/index.ts), so `node dist/bin.js` cannot run on its own. The
// headless CLI is therefore bundled into one self-contained file: esbuild inlines our workspace deps,
// the MCP SDK, and zod, leaving only node: builtins external. The result is a portable cross-platform
// executable (macOS + Windows) that an AI host can launch directly.
await build({
  entryPoints: ['src/bin.ts'],
  outfile: 'dist/cli.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'info',
});
