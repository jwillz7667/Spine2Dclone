import { History, type HistoryDeps } from '../command/history';
import type { DocState } from '../model/doc-state';
import type { IdFactory } from '../model/ids';
import { createReadModel, DocumentModelInternal } from '../model/internal';
import type { DocumentReadModel } from '../model/read-model';
import type { DocumentEnvironment } from './environment';

// The document aggregate (command-history Section 1): the read model the UI holds and the History
// handle it issues commands through. The privileged write surface (Mutator) is reachable only from
// inside History, never from here.
export interface Document {
  readonly model: DocumentReadModel;
  readonly history: History;
  // The document's id factory, exposed so tools and the MCP server mint entity ids consistent with
  // the model (the same monotonic counter the model and commands use). A separate factory would
  // restart the counter and collide ids.
  readonly ids: IdFactory;
}

// Build a Document from a resolved DocState and an explicit id factory. Internal: load and create wrap
// it so the SAME id factory mints both the loaded entities and any future command-created ones (a
// second factory would restart the counter and collide ids). exactOptionalPropertyTypes forbids
// passing an explicit `undefined` for an optional field, so overrides are spread only when present.
function buildDocument(state: DocState, ids: IdFactory, env: DocumentEnvironment): Document {
  const internal = new DocumentModelInternal(state, ids);
  const deps: HistoryDeps = {
    model: internal,
    now: env.now,
    ...(env.maxDepth !== undefined ? { maxDepth: env.maxDepth } : {}),
    ...(env.coalesceWindowMs !== undefined ? { coalesceWindowMs: env.coalesceWindowMs } : {}),
  };
  // History keeps the write-capable internal model (it alone can mint a Mutator from it); the Document
  // exposes only a read-only facade, so no holder of doc.model can reach a write method.
  return { model: createReadModel(internal), history: new History(deps), ids };
}

// Create a Document from an already-resolved DocState (a new document, or a test). Mints a fresh id
// factory from the environment.
export function createDocument(state: DocState, env: DocumentEnvironment): Document {
  return buildDocument(state, env.createIds(), env);
}

// Internal entry used by loadDocument once it has resolved the format into a DocState with the same
// id factory it minted the entities from.
export function buildLoadedDocument(
  state: DocState,
  ids: IdFactory,
  env: DocumentEnvironment,
): Document {
  return buildDocument(state, ids, env);
}
