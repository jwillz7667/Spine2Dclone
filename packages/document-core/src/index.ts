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
} from './command/errors';
export type { DocumentError } from './command/errors';

// Model (read surface + value types; the write surface stays private)
export type {
  BoneEntity,
  SlotEntity,
  RegionAttachmentEntity,
  PreservedAttachmentEntity,
  AttachmentEntity,
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
  DocState,
  PreservedContent,
} from './model/doc-state';
export { emptyPreservedContent, newDocState } from './model/doc-state';
export type { Id, BoneId, SlotId, AnimationId, KeyframeId, IdFactory } from './model/ids';
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
  CommandSpec,
  CommandFixture,
} from './commands';

// Save / load seam
export type { DocumentEnvironment, Document } from './save-load';
export { createDocument, loadDocument, exportDocument } from './save-load';
