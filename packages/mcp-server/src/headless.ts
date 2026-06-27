import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildMcpServer, type ServerInfo } from './server';
import { createNodeFileStore } from './node-files';
import { SessionRegistry } from './session';

export interface HeadlessOptions {
  // Filesystem root that confines every document.save / document.open the AI performs.
  readonly projectRoot: string;
  readonly info?: ServerInfo;
}

// Run the Marionette MCP server over stdio: the headless entry an AI host launches as a child process
// (the transport is stdin/stdout, so the process must not write anything else to stdout). This is thin
// wiring over the tested tool core; it is not unit-tested because it binds real stdio. File access is
// confined to projectRoot by createNodeFileStore.
export async function runStdioServer(options: HeadlessOptions): Promise<void> {
  const deps = {
    sessions: new SessionRegistry(),
    files: createNodeFileStore(options.projectRoot),
  };
  const server = options.info ? buildMcpServer(deps, options.info) : buildMcpServer(deps);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
