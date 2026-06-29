import type { ValidationReport } from '@marionette/format';

// The document error model (command-history Section 4.2, 3.5). Every failure inside the spine is a
// typed member of the DocumentError union with a stable `code` discriminant and context fields. No
// bare strings are thrown; no `catch (e: unknown)` swallows. Callers narrow on `code` or `instanceof`.

export class CommandTargetMissingError extends Error {
  override readonly name = 'CommandTargetMissingError';
  readonly code = 'COMMAND_TARGET_MISSING' as const;
  constructor(
    readonly commandKind: string,
    readonly targetId: string,
  ) {
    super(`command "${commandKind}" target "${targetId}" does not exist`);
  }
}

export class CommandNotAppliedError extends Error {
  override readonly name = 'CommandNotAppliedError';
  readonly code = 'COMMAND_NOT_APPLIED' as const;
  constructor(readonly commandKind: string) {
    super(`command "${commandKind}" was asked to undo before it was applied`);
  }
}

export class DocumentInvariantError extends Error {
  override readonly name = 'DocumentInvariantError';
  readonly code = 'DOCUMENT_INVARIANT' as const;
  constructor(reason: string) {
    super(`document invariant violated: ${reason}`);
  }
}

export class HistoryReentrancyError extends Error {
  override readonly name = 'HistoryReentrancyError';
  readonly code = 'HISTORY_REENTRANCY' as const;
  constructor(readonly commandKind: string) {
    super(
      `a History listener mutated history while committing "${commandKind}"; ` +
        'listeners must not call execute/undo/redo',
    );
  }
}

export class ExportValidationError extends Error {
  override readonly name = 'ExportValidationError';
  readonly code = 'EXPORT_VALIDATION' as const;
  constructor(readonly report: ValidationReport) {
    super(`exported document failed format validation with ${report.errors.length} error(s)`);
  }
}

// An author-time reparent that would create a cycle (a bone reparented under itself or one of its
// descendants). It is a command-level guard surfaced to the UI, NOT a FormatErrorCode: the command
// throws this BEFORE any mutation, so no document change and no history entry result. The import-time
// equivalent for a hand-edited document is the format validator's BONE_ORDER_VIOLATION /
// BONE_PARENT_MISSING (a cycle cannot be topologically ordered).
export class ReparentCycleError extends Error {
  override readonly name = 'ReparentCycleError';
  readonly code = 'REPARENT_CYCLE' as const;
  constructor(
    readonly boneId: string,
    readonly newParentId: string,
  ) {
    super(`reparenting bone "${boneId}" under "${newParentId}" would create a cycle`);
  }
}

// An author-time SetAnimationDuration that would shrink an animation below its last keyframe time. A
// command-level guard surfaced to the UI, thrown BEFORE any mutation, so no document change and no
// history entry result. The import-time equivalent for a hand-edited document is the format validator's
// ANIM_DURATION (the duration must be >= the maximum keyframe time).
export class AnimationDurationError extends Error {
  override readonly name = 'AnimationDurationError';
  readonly code = 'ANIMATION_DURATION' as const;
  constructor(
    readonly animationId: string,
    readonly requestedDuration: number,
    readonly lastKeyframeTime: number,
  ) {
    super(
      `cannot set animation "${animationId}" duration to ${requestedDuration}; ` +
        `it is below the last keyframe time ${lastKeyframeTime}`,
    );
  }
}

// An author-time MoveKeyframe that would land a keyframe on a time another keyframe already occupies on
// the same channel. A command-level guard thrown BEFORE any mutation (channel times stay strictly
// ascending), so no document change and no history entry result. The UI/auto-key prevents collisions;
// this is the fail-loud backstop.
export class KeyframeCollisionError extends Error {
  override readonly name = 'KeyframeCollisionError';
  readonly code = 'KEYFRAME_COLLISION' as const;
  constructor(
    readonly keyframeId: string,
    readonly time: number,
  ) {
    super(
      `cannot move keyframe "${keyframeId}" to time ${time}; another keyframe already occupies it`,
    );
  }
}

// A topology-changing mesh edit (add or delete vertex, auto grid-fill, auto perimeter-trace) attempted
// on a mesh that is WEIGHTED or carries deform keyframes (TASK-2.1.8 topology-lock policy). Such edits
// change the vertex count/order, which would silently misalign the weighted `vertices` encoding (WP-2.3)
// and deform offset arrays (WP-2.9), both indexed by vertex position. A command-level guard thrown
// BEFORE any mutation, so no document change and no history entry result; the editor surfaces it and the
// artist must UnbindMesh (WP-2.3) / ClearAttachmentDeform (WP-2.9) first. The `reason` says which lock
// fired. MOVE vertex is exempt (count/order stable) and never throws this.
export class MeshTopologyLockedError extends Error {
  override readonly name = 'MeshTopologyLockedError';
  readonly code = 'MESH_TOPOLOGY_LOCKED' as const;
  constructor(
    readonly slotId: string,
    readonly attachmentName: string,
    readonly reason: 'weighted' | 'deformed',
  ) {
    super(
      `cannot change the topology of mesh "${attachmentName}" on slot "${slotId}": ` +
        `it is ${reason}. Unbind weights and clear deform keyframes before re-topologizing.`,
    );
  }
}

// A mesh-weight binding edit (WP-2.3 / WP-2.4) rejected BEFORE any mutation, so it leaves no document
// change and no history entry. The `reason` discriminant says which rule fired:
//   - notWeighted: a weighted-only command (add/remove bone, auto-weight, paint, normalize, unbind) was
//     run on an unweighted mesh.
//   - alreadyWeighted: BindMeshToBones was run on a mesh that is already weighted.
//   - boneMissing: a referenced bone is not in the document.
//   - boneAlreadyBound: AddBoneToMeshBinding targeted a bone already in the mesh binding.
//   - boneNotBound: RemoveBoneFromMeshBinding targeted a bone the mesh is not bound to.
//   - lastBone: RemoveBoneFromMeshBinding would remove the mesh's only bound bone (use UnbindMesh).
//   - noBones: BindMeshToBones was given an empty bone set.
//   - deformPresent: UnbindMesh was blocked because the mesh still has deform keyframes (WP-2.9).
//   - vertexOutOfRange: a paint dab indexed a vertex outside the mesh.
// The editor / MCP client surfaces it and the artist resolves it (bind first, pick a valid bone, unbind
// instead of removing the last bone, clear deform first).
export type MeshBindingErrorReason =
  | 'notWeighted'
  | 'alreadyWeighted'
  | 'boneMissing'
  | 'boneAlreadyBound'
  | 'boneNotBound'
  | 'lastBone'
  | 'noBones'
  | 'deformPresent'
  | 'vertexOutOfRange';

export class MeshBindingError extends Error {
  override readonly name = 'MeshBindingError';
  readonly code = 'MESH_BINDING' as const;
  constructor(
    readonly slotId: string,
    readonly attachmentName: string,
    readonly reason: MeshBindingErrorReason,
    readonly detail?: string,
  ) {
    super(
      `mesh "${attachmentName}" on slot "${slotId}" binding error (${reason})` +
        (detail === undefined ? '' : `: ${detail}`),
    );
  }
}

// A constraint authoring edit (WP-2.6 / WP-2.7) rejected BEFORE any mutation, so it leaves no document
// change and no history entry. The `reason` discriminant says which rule fired:
//   - boneMissing: a referenced chain bone is not in the document.
//   - targetMissing: the target bone is not in the document.
//   - chainArity: an IK chain is not 1 or 2 bones.
//   - chainDiscontinuous: a two-bone IK chain's child is not parented to its parent bone.
//   - cycle: the constrained bone (or an IK chain bone) is an ancestor of the target (would not resolve).
//   - duplicateName: a constraint with that name already exists (names are the on-disk record keys).
//   - notFound: an edit/delete targeted a constraint id that does not exist.
// The author-time equivalent of the format validator's IK_*/TC_*/CONSTRAINT_NAME_DUPLICATE codes.
export type ConstraintErrorReason =
  | 'boneMissing'
  | 'targetMissing'
  | 'chainArity'
  | 'chainDiscontinuous'
  | 'cycle'
  | 'duplicateName'
  | 'notFound';

export class ConstraintError extends Error {
  override readonly name = 'ConstraintError';
  readonly code = 'CONSTRAINT' as const;
  constructor(
    readonly reason: ConstraintErrorReason,
    readonly detail?: string,
  ) {
    super(`constraint error (${reason})` + (detail === undefined ? '' : `: ${detail}`));
  }
}

// A skin authoring edit (WP-2.8) rejected BEFORE any mutation. The `reason` discriminant:
//   - duplicateName: a skin with that name already exists, or a rename collides ('default' is reserved).
//   - defaultProtected: an attempt to create/rename/delete the implicit 'default' skin.
//   - notFound: an edit targeted a skin id that does not exist.
//   - slotMissing: SetSkinAttachment named a slot not in the document.
export type SkinErrorReason = 'duplicateName' | 'defaultProtected' | 'notFound' | 'slotMissing';

export class SkinError extends Error {
  override readonly name = 'SkinError';
  readonly code = 'SKIN' as const;
  constructor(
    readonly reason: SkinErrorReason,
    readonly detail?: string,
  ) {
    super(`skin error (${reason})` + (detail === undefined ? '' : `: ${detail}`));
  }
}

// A deform timeline edit (WP-2.9) rejected BEFORE any mutation. The `reason` discriminant:
//   - notMesh: the target attachment is absent or is not a mesh (deform applies only to meshes).
//   - offsetLength: an offsets array length is not 2 * vertexCount of the target mesh.
//   - keyframeMissing: a delete/move targeted a deform keyframe time that does not exist.
//   - skinMissing: a named deform skin key does not resolve to a known skin.
export type DeformErrorReason = 'notMesh' | 'offsetLength' | 'keyframeMissing' | 'skinMissing';

export class DeformError extends Error {
  override readonly name = 'DeformError';
  readonly code = 'DEFORM' as const;
  constructor(
    readonly reason: DeformErrorReason,
    readonly detail?: string,
  ) {
    super(`deform error (${reason})` + (detail === undefined ? '' : `: ${detail}`));
  }
}

// An effect-editing edit (WP-3.7) rejected BEFORE any mutation, so it leaves no document change and no
// history entry. The `reason` discriminant says which rule fired:
//   - notFound: an edit/delete targeted an effect / layer / life-stop / bundle / bundle-item id (or bundle
//     name) that does not exist.
//   - simulationDt: SetEffectMeta was given a simulationDt that is not greater than zero (EFFECT_SIMULATION_DT).
//   - lifeCurveMinStops: RemoveLifeStop would drop a LifeCurve below its two-stop floor (the t=0 and t=1
//     anchors), or remove one of those anchors (the t=0/t=1 endpoints are not removable).
//   - lifeStopOrder: AddLifeStop / MoveLifeStop would break strict-ascending t or violate first.t===0 /
//     last.t===1 (the WP-3.0 LIFECURVE_STOP_ORDER contract enforced at the command boundary).
//   - lifeStopValueShape: SetLifeStopValue was handed a value of the wrong shape for the target curve (a
//     scalar value on an RGB curve, or vice versa).
//   - bundleEffectMissing: AddBundleItem / SetBundleItem referenced an EffectId the library does not define.
// The author-time equivalent of the format validator's EFFECT_* / BUNDLE_* codes; the dangling-region case
// for SetEffectsAtlas is surfaced through EffectsAtlasDanglingRegionError below (it carries the full report).
export type EffectEditErrorReason =
  | 'notFound'
  | 'simulationDt'
  | 'lifeCurveMinStops'
  | 'lifeStopOrder'
  | 'lifeStopValueShape'
  | 'bundleEffectMissing';

export class EffectEditError extends Error {
  override readonly name = 'EffectEditError';
  readonly code = 'EFFECT_EDIT' as const;
  constructor(
    readonly reason: EffectEditErrorReason,
    readonly detail?: string,
  ) {
    super(`effect edit error (${reason})` + (detail === undefined ? '' : `: ${detail}`));
  }
}

// A SetEffectsAtlas (WP-3.7 TASK-3.7.7) rejected BEFORE any mutation because the proposed atlas drops one
// or more atlas regions that a layer `region` / `regions[]` still references: the WP-3.0 cross-reference
// check (EFFECT_REGION_MISSING) is re-run against the candidate atlas, and a dangling reference fails
// loudly here rather than silently leaving the document referencing a region that no longer resolves. The
// `report` carries every EFFECT_REGION_MISSING (and any other) error so the editor can pinpoint each.
export class EffectsAtlasDanglingRegionError extends Error {
  override readonly name = 'EffectsAtlasDanglingRegionError';
  readonly code = 'EFFECTS_ATLAS_DANGLING_REGION' as const;
  constructor(readonly report: ValidationReport | EffectsValidationLike) {
    super('the proposed effects atlas drops a region still referenced by a layer');
  }
}

// The shape of the effects validation report carried by EffectsAtlasDanglingRegionError. document-core
// does not depend on the format's EffectsValidationReport type by name here (the import would couple the
// errors module to the effects barrel); a structural alias keeps the typed error self-contained while
// still exposing the per-error codes/paths to a caller that narrows on `code`.
export interface EffectsValidationLike {
  readonly ok: boolean;
  readonly errors: ReadonlyArray<{
    readonly code: string;
    readonly path: string;
    readonly message: string;
  }>;
}

// A slot-scene authoring edit (WP-4.5 / WP-4.6 / WP-4.8) rejected BEFORE any mutation, so it leaves no
// document change and no history entry. The `reason` discriminant says which rule fired:
//   - clusterNotSquare: a cluster grid whose cols !== rows.
//   - clusterGravity: a cluster grid not using cluster-down gravity.
//   - reelStripRows: a reelStrip grid whose rows are outside [2, 6].
//   - scatterPayCols: a scatterPay grid whose cols are outside [5, 7].
//   - anticipationTriggers: an empty anticipation triggerSymbols vocabulary.
//   - anticipationThreshold: an anticipation thresholdCount below 1.
//   - anticipationCols: an anticipation maxAnticipatingCols outside [1, cols].
//   - skeletonRefMissing: MapSymbolAnimSet referenced a skeletonRef with no provided animation names to
//     validate against (when an animation-name check was requested but the skeleton was not supplied).
//   - animMissing: a MapSymbolAnimSet animation name (idle/land/win/anticipation) is not in the referenced
//     skeleton's provided animation names.
//   - emptyName: a MapSymbolAnimSet skeletonRef or animation name is empty, or a CreateWinSequence name is
//     empty (structural floor).
//   - notMapped: MapSymbolAnimSet was asked to REMOVE a symbol that is not mapped.
//   - duplicateSequence: CreateWinSequence targeted a win-sequence name that already exists (WP-4.8).
//   - sequenceMissing: SetWinSequenceStep / ReorderWinSequenceStep named a win sequence that does not exist.
//   - stepIndexOutOfRange: SetWinSequenceStep targeted an index outside [0, steps.length], or
//     ReorderWinSequenceStep was given an order that is not a permutation of the sequence's step indices.
//   - duplicateState: CreateFeatureFlowState targeted a flow state name that already exists, or
//     RenameFeatureFlowState targeted a NEW name that already exists (WP-4.9).
//   - stateMissing: a WP-4.9 flow command (delete / rename / a transition endpoint) named a state that does
//     not exist.
//   - baseStateProtected: DeleteFeatureFlowState was asked to delete the sole mandatory `base` node (WP-4.9).
//   - transitionMissing: RemoveFeatureFlowTransition targeted a transition index/value that does not exist.
//   - invalidTiming: SetTumbleChoreography was given a timing value that is not a finite non-negative
//     integer millisecond (explodeMs/dropMs/refillStaggerMs/settleMs/stepGapMs), so the cascade timing is
//     malformed (WP-4.10).
// The author-time equivalent of the format slot-scene validator's GRID_* / SYMBOL_* / flow* codes; the full
// cross-document resolution (the skeleton actually exists on disk) is the import-time validator's job.
export type SlotEditErrorReason =
  | 'clusterNotSquare'
  | 'clusterGravity'
  | 'reelStripRows'
  | 'scatterPayCols'
  | 'anticipationTriggers'
  | 'anticipationThreshold'
  | 'anticipationCols'
  | 'skeletonRefMissing'
  | 'animMissing'
  | 'emptyName'
  | 'notMapped'
  | 'duplicateSequence'
  | 'sequenceMissing'
  | 'stepIndexOutOfRange'
  | 'duplicateState'
  | 'stateMissing'
  | 'baseStateProtected'
  | 'transitionMissing'
  | 'invalidTiming';

export class SlotEditError extends Error {
  override readonly name = 'SlotEditError';
  readonly code = 'SLOT_EDIT' as const;
  constructor(
    readonly reason: SlotEditErrorReason,
    readonly detail?: string,
  ) {
    super(`slot edit error (${reason})` + (detail === undefined ? '' : `: ${detail}`));
  }
}

export type DocumentError =
  | CommandTargetMissingError
  | CommandNotAppliedError
  | DocumentInvariantError
  | HistoryReentrancyError
  | ExportValidationError
  | ReparentCycleError
  | AnimationDurationError
  | KeyframeCollisionError
  | MeshTopologyLockedError
  | MeshBindingError
  | ConstraintError
  | SkinError
  | DeformError
  | EffectEditError
  | EffectsAtlasDanglingRegionError
  | SlotEditError;
