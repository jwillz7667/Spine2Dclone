import {
  createDocument,
  loadDocument,
  makeIdFactory,
  newDocState,
  type Document,
  type DocumentEnvironment,
} from '@marionette/document-core';
import { McpToolError } from './errors';

// One headless document the MCP client is editing.
export interface Session {
  readonly id: string;
  readonly document: Document;
}

// A monotonic clock that advances past the coalescing window on every call, so consecutive MCP tool
// calls never time-window-merge into one undo step. A programmatic client has no drag gesture; the
// explicit history.beginInteraction/endInteraction tools are the gesture analog (mcp-control-surface
// Section 1, command-history Section 5.2). 1000ms > the 250ms default window.
function makeMcpClock(): () => number {
  let t = 0;
  return () => {
    t += 1000;
    return t;
  };
}

function makeEnvironment(): DocumentEnvironment {
  return { now: makeMcpClock(), createIds: makeIdFactory };
}

// A bounded registry of open documents. The capacity bound prevents a client that opens documents
// without closing them from exhausting memory.
export class SessionRegistry {
  private readonly sessions = new Map<string, Session>();
  private counter = 0;

  constructor(private readonly capacity = 16) {}

  create(name: string): Session {
    return this.register(createDocument(newDocState(name), makeEnvironment()));
  }

  // Build a session from format JSON. Throws (via document-core) if the document is malformed; the
  // calling tool converts that into a typed McpToolError.
  open(json: unknown): Session {
    return this.register(loadDocument(json, makeEnvironment()));
  }

  get(id: string): Session {
    const session = this.sessions.get(id);
    if (session === undefined) {
      throw new McpToolError('DOCUMENT_NOT_FOUND', `no open document with id "${id}"`);
    }
    return session;
  }

  close(id: string): void {
    if (!this.sessions.delete(id)) {
      throw new McpToolError('DOCUMENT_NOT_FOUND', `no open document with id "${id}"`);
    }
  }

  get size(): number {
    return this.sessions.size;
  }

  private register(document: Document): Session {
    if (this.sessions.size >= this.capacity) {
      throw new McpToolError('SESSION_LIMIT', `too many open documents (max ${this.capacity})`);
    }
    this.counter += 1;
    const id = `doc_${this.counter}`;
    const session: Session = { id, document };
    this.sessions.set(id, session);
    return session;
  }
}
