// A typed tool error. The server wiring converts it into an MCP error result; tool handlers throw it
// (never a bare string) so a caller can branch on `code`.
export class McpToolError extends Error {
  override readonly name = 'McpToolError';
  constructor(
    readonly code: string,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}
