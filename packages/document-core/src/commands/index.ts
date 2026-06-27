// Internal barrel for the command catalog. The command classes are exported so the editor tools and
// the MCP server can construct them; the specs feed the registry and the round-trip harness.
export { CreateBoneCommand, createBoneSpec } from './create-bone.command';
export type { BoneGeometry } from './create-bone.command';
export { MoveBoneCommand, moveBoneSpec } from './move-bone.command';
export { RotateBoneCommand, rotateBoneSpec } from './rotate-bone.command';
export { ScaleBoneCommand, scaleBoneSpec } from './scale-bone.command';
export { SetBoneLengthCommand, setBoneLengthSpec } from './set-bone-length.command';
export {
  NormalizeBoneRotationCommand,
  normalizeBoneRotationSpec,
  wrapDegrees,
} from './normalize-bone-rotation.command';
export { RenameBoneCommand, renameBoneSpec } from './rename-bone.command';
export {
  SetBoneTransformModeCommand,
  setBoneTransformModeSpec,
} from './set-bone-transform-mode.command';
export { ReparentBoneCommand, reparentBoneSpec } from './reparent-bone.command';
export { DeleteBoneCommand, deleteBoneSpec } from './delete-bone.command';
export { CreateSlotCommand, createSlotSpec } from './create-slot.command';
export type { SlotInit } from './create-slot.command';
export { DeleteSlotCommand, deleteSlotSpec } from './delete-slot.command';
export { RenameSlotCommand, renameSlotSpec } from './rename-slot.command';
export { SetSlotBlendModeCommand, setSlotBlendModeSpec } from './set-slot-blend-mode.command';
export { SetSlotColorCommand, setSlotColorSpec } from './set-slot-color.command';
export { ReorderSlotCommand, reorderSlotSpec } from './reorder-slot.command';
export {
  AddRegionAttachmentCommand,
  addRegionAttachmentSpec,
} from './add-region-attachment.command';
export type { RegionAttachmentInit } from './add-region-attachment.command';
export { RemoveAttachmentCommand, removeAttachmentSpec } from './remove-attachment.command';
export {
  SetActiveAttachmentCommand,
  setActiveAttachmentSpec,
} from './set-active-attachment.command';
export {
  SetRegionAttachmentTransformCommand,
  setRegionAttachmentTransformSpec,
} from './set-region-attachment-transform.command';
export type { RegionTransform } from './set-region-attachment-transform.command';
export { commandRegistry } from './registry';
export type { CommandSpec, CommandFixture } from './spec';
export { findBoneSnapshot, findSlotSnapshot, findAttachmentSnapshot } from './spec';
