// Public barrel for @marionette/document-core: the renderer-agnostic document mutation spine (ADR-0001,
// command-history Section 12). Both the editor renderer AND the headless MCP server consume this same
// surface, so a human and an AI drive the SAME commands (user + AI control, LAW 2). NOTE: Mutator,
// createMutator, and DocumentModelInternal are deliberately NOT exported. The only way to obtain a
// Mutator is to be handed one by History during do/undo, which is the structural half of LAW 2.

// Command + history
export type {
  Command,
  CommandContext,
  HistoryPhase,
  HistoryEvent,
  SelectionHint,
  EntityRef,
} from './command/command';
export { CompositeCommand } from './command/composite';
export { History, HISTORY_DEFAULTS } from './command/history';
export type { HistoryDeps } from './command/history';
export { assertInvariants } from './command/invariants';
export {
  CommandTargetMissingError,
  CommandNotAppliedError,
  DocumentInvariantError,
  HistoryReentrancyError,
  ExportValidationError,
  ReparentCycleError,
  AnimationDurationError,
  KeyframeCollisionError,
  MeshTopologyLockedError,
  MeshBindingError,
  ConstraintError,
  SkinError,
  DeformError,
} from './command/errors';
export type {
  DocumentError,
  MeshBindingErrorReason,
  ConstraintErrorReason,
  SkinErrorReason,
  DeformErrorReason,
} from './command/errors';

// Model (read surface + value types; the write surface stays private)
export type {
  BoneEntity,
  SlotEntity,
  RegionAttachmentEntity,
  MeshAttachmentEntity,
  PreservedAttachmentEntity,
  AttachmentEntity,
  MeshGeometry,
  AnimationEntity,
  BoneChannel,
  BoneTimelineSet,
  SlotTimelineSet,
  KeyframeEntity,
  AttachmentFrameEntity,
  KeyframeValue,
  RotateValue,
  Vec2Value,
  ColorValue,
  IkConstraintEntity,
  TransformConstraintEntity,
  SkinEntity,
  IkKeyframeEntity,
  TransformKeyframeEntity,
  DeformKeyframeEntity,
  DeformSkinKey,
  DocState,
  PreservedContent,
} from './model/doc-state';
export {
  emptyPreservedContent,
  meshGeometryOf,
  newDocState,
  makeKeyframe,
  makeIkKeyframe,
  makeTransformKeyframe,
  makeDeformKeyframe,
  emptyAnimationConstraintTimelines,
} from './model/doc-state';
export type {
  Id,
  BoneId,
  SlotId,
  AnimationId,
  KeyframeId,
  IkConstraintId,
  TransformConstraintId,
  SkinId,
  IdFactory,
} from './model/ids';
export { makeIdFactory } from './model/ids';
export type {
  DocumentReadModel,
  DocSnapshot,
  BoneSnapshot,
  SlotSnapshot,
  AttachmentSnapshot,
  AnimationSnapshot,
  BoneTimelineSnapshot,
  SlotTimelineSnapshot,
  KeyframeSnapshot,
  AttachmentFrameSnapshot,
  IkConstraintSnapshot,
  TransformConstraintSnapshot,
  SkinSnapshot,
  IkTimelineSnapshot,
  TransformTimelineSnapshot,
  DeformTimelineSnapshot,
  IkKeyframeSnapshot,
  TransformKeyframeSnapshot,
  DeformKeyframeSnapshot,
} from './model/read-model';

// Commands (classes for tools/MCP, specs/registry for the harness)
export {
  CreateBoneCommand,
  MoveBoneCommand,
  RotateBoneCommand,
  ScaleBoneCommand,
  SetBoneLengthCommand,
  SetBoneTransformModeCommand,
  NormalizeBoneRotationCommand,
  RenameBoneCommand,
  ReparentBoneCommand,
  DeleteBoneCommand,
  CreateSlotCommand,
  DeleteSlotCommand,
  RenameSlotCommand,
  SetSlotBlendModeCommand,
  SetSlotColorCommand,
  ReorderSlotCommand,
  AddRegionAttachmentCommand,
  RemoveAttachmentCommand,
  SetActiveAttachmentCommand,
  SetAtlasRefCommand,
  SetRegionAttachmentTransformCommand,
  CreateAnimationCommand,
  DeleteAnimationCommand,
  RenameAnimationCommand,
  SetAnimationDurationCommand,
  SetKeyframeCommand,
  MoveKeyframeCommand,
  DeleteKeyframeCommand,
  SetCurveCommand,
  DuplicateAnimationCommand,
  PasteKeyframesCommand,
  GenerateMeshFromRegionCommand,
  AddMeshVertexCommand,
  MoveMeshVertexCommand,
  DeleteMeshVertexCommand,
  SetMeshEdgesCommand,
  AutoGridFillMeshCommand,
  AutoPerimeterTraceMeshCommand,
  BindMeshToBonesCommand,
  AddBoneToMeshBindingCommand,
  RemoveBoneFromMeshBindingCommand,
  UnbindMeshCommand,
  AutoWeightFromProximityCommand,
  PaintWeightStrokeCommand,
  NormalizeMeshWeightsCommand,
  wrapDegrees,
  commandRegistry,
  findBoneSnapshot,
  findSlotSnapshot,
  findAttachmentSnapshot,
  findAnimationSnapshot,
} from './commands';
export type {
  BoneGeometry,
  SlotInit,
  RegionAttachmentInit,
  RegionTransform,
  KeyframeTarget,
  PastedKeyframe,
  MeshInit,
  MeshAutoFill,
  BindWeightMode,
  PaintMode,
  WeightDab,
  CommandSpec,
  CommandFixture,
} from './commands';

// Pure weight-math helpers (WP-2.3 / WP-2.4): distance-to-segment plus influence normalize / cap /
// finalize. Exposed so the editor weight tools and tests share the exact math the commands use.
export {
  distanceToSegment,
  normalizeInfluences,
  capInfluences,
  finalizeVertexWeights,
} from './weights';
export type { BoneInfluence } from './weights';

// Save / load seam
export type { DocumentEnvironment, Document } from './save-load';
export { createDocument, loadDocument, exportDocument } from './save-load';
