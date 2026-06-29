import { History, type HistoryDeps } from '../command/history';
import { createEffectsReadModel, EffectsModelInternal } from '../effects-model/effects-internal';
import type { EffectsReadModel } from '../effects-model/effects-read-model';
import type { EffectsState } from '../effects-model/effects-state';
import { newEffectsState } from '../effects-model/effects-state';
import { EFFECTS_FORMAT_VERSION } from '../effects-model/effects-version';
import type { DocState } from '../model/doc-state';
import type { IdFactory } from '../model/ids';
import { createReadModel, DocumentModelInternal } from '../model/internal';
import type { DocumentReadModel } from '../model/read-model';
import type { DocumentEnvironment } from './environment';

// The document aggregate (command-history Section 1): the read models the UI holds and the History
// handle it issues commands through. The privileged write surfaces (Mutator, EffectsMutator) are
// reachable only from inside History, never from here. `effects` is the effects library's read model;
// it shares the SAME History (one project undo stack, WP-3.7 TASK-3.7.6).
export interface Document {
  readonly model: DocumentReadModel;
  readonly effects: EffectsReadModel;
  readonly history: History;
  // The document's id factory, exposed so tools and the MCP server mint entity ids consistent with
  // the model (the same monotonic counter the model and commands use). A separate factory would
  // restart the counter and collide ids. The skeletal AND effects entities mint from this one factory.
  readonly ids: IdFactory;
}

// Build a Document from a resolved DocState, an effects state, and an explicit id factory. Internal: load
// and create wrap it so the SAME id factory mints the skeletal entities, the effects entities, and any
// future command-created ones (a second factory would restart the counter and collide ids).
// exactOptionalPropertyTypes forbids passing an explicit `undefined` for an optional field, so overrides
// are spread only when present.
function buildDocument(
  state: DocState,
  effectsState: EffectsState,
  ids: IdFactory,
  env: DocumentEnvironment,
): Document {
  const internal = new DocumentModelInternal(state, ids);
  const effectsInternal = new EffectsModelInternal(effectsState);
  const deps: HistoryDeps = {
    model: internal,
    effectsModel: effectsInternal,
    now: env.now,
    ...(env.maxDepth !== undefined ? { maxDepth: env.maxDepth } : {}),
    ...(env.coalesceWindowMs !== undefined ? { coalesceWindowMs: env.coalesceWindowMs } : {}),
  };
  // History keeps the write-capable internal models (it alone can mint the mutators from them); the
  // Document exposes only read-only facades, so no holder of doc.model / doc.effects can reach a write
  // method.
  return {
    model: createReadModel(internal),
    effects: createEffectsReadModel(effectsInternal),
    history: new History(deps),
    ids,
  };
}

// A fresh, empty effects state at the current effects-format version (no effects/bundles, empty atlas).
// Used when a Document is built without an explicit effects library; SetEffectsAtlas / CreateEffect /
// CreateBundle populate it through commands.
function emptyEffectsState(name: string): EffectsState {
  return newEffectsState(EFFECTS_FORMAT_VERSION, name);
}

// Create a Document from an already-resolved DocState (a new document, or a test). Mints a fresh id
// factory from the environment and an empty effects library; an effects state may be supplied to seed the
// library (the effects round-trip tests build one from a format fixture).
export function createDocument(
  state: DocState,
  env: DocumentEnvironment,
  effectsState?: EffectsState,
): Document {
  return buildDocument(state, effectsState ?? emptyEffectsState(state.name), env.createIds(), env);
}

// Internal entry used by loadDocument once it has resolved the format into a DocState with the same
// id factory it minted the entities from. An effects state (resolved with the SAME id factory) may be
// supplied; otherwise the effects library starts empty.
export function buildLoadedDocument(
  state: DocState,
  ids: IdFactory,
  env: DocumentEnvironment,
  effectsState?: EffectsState,
): Document {
  return buildDocument(state, effectsState ?? emptyEffectsState(state.name), ids, env);
}
