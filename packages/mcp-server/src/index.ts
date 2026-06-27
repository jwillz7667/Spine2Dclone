// Public barrel for @marionette/mcp-server: the headless MCP control surface (WP-M.1,
// mcp-control-surface.md). It exposes the document-core command catalog as MCP tools so an AI can
// fully author and build scenes through the SAME commands the GUI uses (user + AI control, LAW 2).
// Mutating tools never bypass History; tool inputs are validated at the boundary (LAW 3). It imports
// no renderer, PixiJS, or DOM.
export { buildMcpServer } from './server';
export type { ServerInfo } from './server';
export { SessionRegistry } from './session';
export type { Session } from './session';
export { McpToolError } from './errors';
export type { FileStore } from './files';
export { TOOLS } from './tools';
export type { ToolDeps, ToolDefinition } from './tools';
export { createNodeFileStore } from './node-files';
export { runStdioServer } from './headless';
export type { HeadlessOptions } from './headless';
