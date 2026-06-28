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
export { SetAtlasRefCommand, setAtlasRefSpec } from './set-atlas-ref.command';
export {
  SetRegionAttachmentTransformCommand,
  setRegionAttachmentTransformSpec,
} from './set-region-attachment-transform.command';
export type { RegionTransform } from './set-region-attachment-transform.command';
export { CreateAnimationCommand, createAnimationSpec } from './create-animation.command';
export { DeleteAnimationCommand, deleteAnimationSpec } from './delete-animation.command';
export { RenameAnimationCommand, renameAnimationSpec } from './rename-animation.command';
export {
  SetAnimationDurationCommand,
  setAnimationDurationSpec,
} from './set-animation-duration.command';
export { SetKeyframeCommand, setKeyframeSpec } from './set-keyframe.command';
export { MoveKeyframeCommand, moveKeyframeSpec } from './move-keyframe.command';
export { DeleteKeyframeCommand, deleteKeyframeSpec } from './delete-keyframe.command';
export { SetCurveCommand, setCurveSpec } from './set-curve.command';
export { DuplicateAnimationCommand, duplicateAnimationSpec } from './duplicate-animation.command';
export { PasteKeyframesCommand, pasteKeyframesSpec } from './paste-keyframes.command';
export type { PastedKeyframe } from './paste-keyframes.command';
export type { KeyframeTarget } from './keyframe-support';
// WP-2.1 mesh creation/editing
export {
  GenerateMeshFromRegionCommand,
  generateMeshFromRegionSpec,
} from './generate-mesh-from-region.command';
export { AddMeshVertexCommand, addMeshVertexSpec } from './add-mesh-vertex.command';
export { MoveMeshVertexCommand, moveMeshVertexSpec } from './move-mesh-vertex.command';
export { DeleteMeshVertexCommand, deleteMeshVertexSpec } from './delete-mesh-vertex.command';
export { SetMeshEdgesCommand, setMeshEdgesSpec } from './set-mesh-edges.command';
export { AutoGridFillMeshCommand, autoGridFillMeshSpec } from './auto-grid-fill-mesh.command';
export {
  AutoPerimeterTraceMeshCommand,
  autoPerimeterTraceMeshSpec,
} from './auto-perimeter-trace-mesh.command';
export type { MeshInit, MeshAutoFill } from './mesh-support';
// WP-2.3 mesh-to-bone binding
export { BindMeshToBonesCommand, bindMeshToBonesSpec } from './bind-mesh-to-bones.command';
export type { BindWeightMode } from './bind-mesh-to-bones.command';
export {
  AddBoneToMeshBindingCommand,
  addBoneToMeshBindingSpec,
} from './add-bone-to-mesh-binding.command';
export {
  RemoveBoneFromMeshBindingCommand,
  removeBoneFromMeshBindingSpec,
} from './remove-bone-from-mesh-binding.command';
export { UnbindMeshCommand, unbindMeshSpec } from './unbind-mesh.command';
// WP-2.4 weight painting
export {
  AutoWeightFromProximityCommand,
  autoWeightFromProximitySpec,
} from './auto-weight-from-proximity.command';
export { PaintWeightStrokeCommand, paintWeightStrokeSpec } from './paint-weight-stroke.command';
export type { PaintMode, WeightDab } from './paint-weight-stroke.command';
export {
  NormalizeMeshWeightsCommand,
  normalizeMeshWeightsSpec,
} from './normalize-mesh-weights.command';
export { commandRegistry } from './registry';
export type { CommandSpec, CommandFixture } from './spec';
export {
  findBoneSnapshot,
  findSlotSnapshot,
  findAttachmentSnapshot,
  findAnimationSnapshot,
} from './spec';
