import { defineConfig } from 'vitest/config';

// The mcp-server suites drive the tool handlers directly against a real document-core Document and an
// in-memory file store. No MCP transport and no DOM/WebGL are involved, so the Node environment is
// sufficient.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
