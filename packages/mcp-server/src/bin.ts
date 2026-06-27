import { runStdioServer } from './headless';

// CLI entry: `marionette-mcp [projectRoot]`. The host launches this as a stdio child process; the
// first arg (or the current working directory) is the project root that confines all file access.
// stdout is reserved for the MCP transport, so diagnostics go to stderr only.
const projectRoot = process.argv[2] ?? process.cwd();

runStdioServer({ projectRoot }).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`marionette-mcp failed to start: ${message}\n`);
  process.exitCode = 1;
});
