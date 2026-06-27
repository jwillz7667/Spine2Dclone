import type { IdFactory } from '../model/ids';

// The injected environment for building a Document (command-history Section 7.2). The clock and the id
// generator are never hidden globals: the single production environment is constructed once at the app
// composition root (renderer) or the MCP host (main), and tests inject a fake clock plus a
// deterministic IdFactory so load-path history is fully reproducible. maxDepth/coalesceWindowMs are
// override-only; the defaults live in HISTORY_DEFAULTS.
export interface DocumentEnvironment {
  readonly now: () => number;
  readonly createIds: () => IdFactory;
  readonly maxDepth?: number;
  readonly coalesceWindowMs?: number;
}
