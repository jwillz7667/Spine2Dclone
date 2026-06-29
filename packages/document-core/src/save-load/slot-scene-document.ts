import {
  computeSlotSceneHash,
  slotSceneDocumentSchema,
  symbolId,
  verifySlotSceneContentHash,
  SLOT_SCENE_FORMAT_VERSION,
} from '@marionette/format/slot';
import type { SlotSceneDocument, SymbolAnimSet, SymbolId } from '@marionette/format/slot-types';
import { cloneSlotSceneState } from '../model/slot-scene';
import type { SlotSceneState } from '../model/slot-scene';

// The SlotSceneDocument save/load seam (phase-4 section 5.2/6, format-contract section 15). The slot
// scene serializes as its OWN sibling format (`SlotSceneDocument`, `slotSceneFormatVersion`), separate
// from the skeleton document, so a project bundle is `<name>.skel.json` + `<name>.fx.json` +
// `<name>.slotscene.json`. The in-model `SlotSceneState` (DocState.slotScene) holds the `SlotScene`
// members plus `SceneRefs` by value; export wraps them in the envelope and stamps the content hash LAST
// (hash ownership), load validates the envelope shape + the hash and projects back to a `SlotSceneState`.
//
// LAW 3 (validate on import, fail loudly): load runs the format Zod schema and the content-hash check and
// throws a typed `SlotSceneDocumentError`. The referenced-artifact integrity check (skeleton / VFX preset
// refs) needs filesystem access and is the HOST's concern via the format `validateSlotScene(resolver)`
// (exactly as the effects manifest integrity is host-level); this seam owns the envelope + hash, so the
// round-trip is a pure, resolver-free document operation.

export type SlotSceneDocumentErrorCode = 'schema' | 'hashMismatch';

export class SlotSceneDocumentError extends Error {
  constructor(
    readonly code: SlotSceneDocumentErrorCode,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'SlotSceneDocumentError';
  }
}

// Project a SlotSceneState into a SlotSceneDocument envelope. `name` is the project/document name (the
// host supplies it). The content hash is computed LAST over the canonical `{ slotSceneFormatVersion,
// name, scene, refs }` projection (the shared section 9.2 canonicalizer, reused via computeSlotSceneHash),
// so a one-byte change to any authored field changes the hash. The scene VALUE is the five SlotScene
// members; `refs` sits at envelope level (it is metadata about referenced artifacts, not scene content).
export function exportSlotSceneDocument(scene: SlotSceneState, name: string): SlotSceneDocument {
  const draft: SlotSceneDocument = {
    slotSceneFormatVersion: SLOT_SCENE_FORMAT_VERSION,
    name,
    hash: '',
    scene: {
      grid: scene.grid,
      symbols: scene.symbols,
      winSequencer: scene.winSequencer,
      featureFlows: scene.featureFlows,
      tumble: scene.tumble,
    },
    refs: scene.refs,
  };
  return { ...draft, hash: computeSlotSceneHash(draft) };
}

// Parse + validate a SlotSceneDocument and project it back to a SlotSceneState. Validates the envelope
// shape via the format Zod schema (LAW 3 fail-loud) and verifies the content hash, throwing a typed
// SlotSceneDocumentError on either failure. Returns a freshly deep-cloned SlotSceneState so the loaded
// state never aliases the parsed JSON.
export function loadSlotSceneState(input: unknown): SlotSceneState {
  const parsed = slotSceneDocumentSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new SlotSceneDocumentError(
      'schema',
      `SlotSceneDocument is malformed at /${issue.path.join('/')}: ${issue.message}`,
      parsed.error.issues,
    );
  }
  const doc = parsed.data;
  if (!verifySlotSceneContentHash(doc)) {
    throw new SlotSceneDocumentError(
      'hashMismatch',
      'SlotSceneDocument hash does not match the recomputed content hash (tamper or stale hash)',
    );
  }
  // Project the envelope (scene members + envelope-level refs) into the in-model aggregate, then deep-clone
  // so the loaded state owns its values. The parsed `symbols` record widens to possibly-undefined values
  // under noUncheckedIndexedAccess; filter it into a clean Record before the (re-cloning) projection.
  const symbols: Record<SymbolId, SymbolAnimSet> = {};
  for (const [id, set] of Object.entries(doc.scene.symbols)) {
    if (set !== undefined) symbols[symbolId(id)] = set;
  }
  const state: SlotSceneState = {
    grid: doc.scene.grid,
    symbols,
    winSequencer: doc.scene.winSequencer,
    featureFlows: doc.scene.featureFlows,
    tumble: doc.scene.tumble,
    refs: doc.refs,
  };
  return cloneSlotSceneState(state);
}
