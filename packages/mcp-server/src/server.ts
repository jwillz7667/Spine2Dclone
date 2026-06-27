import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpToolError } from './errors';
import { TOOLS, type ToolDeps } from './tools';

export interface ServerInfo {
  readonly name: string;
  readonly version: string;
}

const DEFAULT_INFO: ServerInfo = { name: 'marionette', version: '0.1.0' };

// Build an MCP server exposing the Marionette tool catalog. Every tool input is validated against its
// Zod schema (the SDK validates from the raw shape, and the handler re-validates for direct callers),
// and every mutating tool drives the SAME document-core commands the GUI uses (LAW 2). A tool failure
// is returned as a typed, structured isError result, never an uncaught throw across the transport.
export function buildMcpServer(deps: ToolDeps, info: ServerInfo = DEFAULT_INFO): McpServer {
  const server = new McpServer(info);
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema.shape,
      },
      async (args: unknown) => {
        try {
          const result = await tool.handler(deps, args);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        } catch (error) {
          const body =
            error instanceof McpToolError
              ? { code: error.code, message: error.message, detail: error.detail }
              : {
                  code: 'INTERNAL',
                  message: error instanceof Error ? error.message : 'unknown error',
                };
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(body) }],
            isError: true,
          };
        }
      },
    );
  }
  return server;
}
