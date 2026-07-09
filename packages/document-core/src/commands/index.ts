// Internal barrel for the command catalog. The command classes are exported so the editor tools and
// the MCP server can construct them; the specs feed the registry and the round-trip harness.
export { CreateBoneCommand, createBoneSpec } from './create-bone.command';
export type { BoneGeometry } from './create-bone.command';
export { MoveBoneCommand, moveBoneSpec } from './move-bone.command';
export { RotateBoneCommand, rotateBoneSpec } from './rotate-bone.command';
export { ScaleBoneCommand, scaleBoneSpec } from './scale-bone.command';
export { SetBoneShearCommand, setBoneShearSpec } from './set-bone-shear.command';
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
  CreateLinkedMeshCommand,
  createLinkedMeshSpec,
} from './create-linked-mesh.command';
export type { LinkedMeshInit } from './create-linked-mesh.command';
export { UnlinkMeshCommand, unlinkMeshSpec } from './unlink-mesh.command';
export {
  SetAttachmentSequenceCommand,
  setAttachmentSequenceSpec,
} from './set-attachment-sequence.command';
export {
  SetSequenceKeyframeCommand,
  setSequenceKeyframeSpec,
} from './set-sequence-keyframe.command';
export {
  MoveSequenceKeyframeCommand,
  moveSequenceKeyframeSpec,
} from './move-sequence-keyframe.command';
export {
  DeleteSequenceKeyframeCommand,
  deleteSequenceKeyframeSpec,
} from './delete-sequence-keyframe.command';
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
export {
  SetAttachmentKeyframeCommand,
  setAttachmentKeyframeSpec,
} from './set-attachment-keyframe.command';
export {
  DeleteAttachmentKeyframeCommand,
  deleteAttachmentKeyframeSpec,
} from './delete-attachment-keyframe.command';
export {
  MoveAttachmentKeyframeCommand,
  moveAttachmentKeyframeSpec,
} from './move-attachment-keyframe.command';
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
// WP-2.6 IK constraint authoring
export { CreateIkConstraintCommand, createIkConstraintSpec } from './create-ik-constraint.command';
export { SetIkMixCommand, setIkMixSpec } from './set-ik-mix.command';
export { SetIkBendPositiveCommand, setIkBendPositiveSpec } from './set-ik-bend-positive.command';
export { DeleteIkConstraintCommand, deleteIkConstraintSpec } from './delete-ik-constraint.command';
export { SetIkKeyframeCommand, setIkKeyframeSpec } from './set-ik-keyframe.command';
export { DeleteIkKeyframeCommand, deleteIkKeyframeSpec } from './delete-ik-keyframe.command';
export { MoveIkKeyframeCommand, moveIkKeyframeSpec } from './move-ik-keyframe.command';
export { SetIkDepthParamsCommand, setIkDepthParamsSpec } from './set-ik-depth-params.command';
export type { IkDepthPatch } from './set-ik-depth-params.command';
// WP-2.7 transform constraint authoring
export {
  CreateTransformConstraintCommand,
  createTransformConstraintSpec,
} from './create-transform-constraint.command';
export {
  SetTransformConstraintParamsCommand,
  setTransformConstraintParamsSpec,
} from './set-transform-constraint-params.command';
export {
  SetTransformConstraintVariantsCommand,
  setTransformConstraintVariantsSpec,
} from './set-transform-constraint-variants.command';
export type { TransformVariantPatch } from './set-transform-constraint-variants.command';
export {
  ReorderConstraintsCommand,
  reorderConstraintsSpec,
} from './reorder-constraints.command';
export type { TransformConstraintParams } from './create-transform-constraint.command';
export {
  DeleteTransformConstraintCommand,
  deleteTransformConstraintSpec,
} from './delete-transform-constraint.command';
export {
  SetTransformKeyframeCommand,
  setTransformKeyframeSpec,
} from './set-transform-keyframe.command';
export type { TransformKeyframeMix } from './set-transform-keyframe.command';
export {
  DeleteTransformKeyframeCommand,
  deleteTransformKeyframeSpec,
} from './delete-transform-keyframe.command';
export {
  MoveTransformKeyframeCommand,
  moveTransformKeyframeSpec,
} from './move-transform-keyframe.command';
// WP-2.8 named skins
export { CreateSkinCommand, createSkinSpec } from './create-skin.command';
export { RenameSkinCommand, renameSkinSpec } from './rename-skin.command';
export { DeleteSkinCommand, deleteSkinSpec } from './delete-skin.command';
export { SetSkinAttachmentCommand, setSkinAttachmentSpec } from './set-skin-attachment.command';
export {
  RemoveSkinAttachmentCommand,
  removeSkinAttachmentSpec,
} from './remove-skin-attachment.command';
// WP-2.9 deform timelines
export { SetDeformKeyframeCommand, setDeformKeyframeSpec } from './set-deform-keyframe.command';
export {
  DeleteDeformKeyframeCommand,
  deleteDeformKeyframeSpec,
} from './delete-deform-keyframe.command';
export { MoveDeformKeyframeCommand, moveDeformKeyframeSpec } from './move-deform-keyframe.command';
export {
  ClearAttachmentDeformCommand,
  clearAttachmentDeformSpec,
} from './clear-attachment-deform.command';
// WP-4.5 / WP-4.6 slot-scene authoring
export { SetGridConfigCommand, setGridConfigSpec } from './set-grid-config.command';
export { MapSymbolAnimSetCommand, mapSymbolAnimSetSpec } from './map-symbol-anim-set.command';
export type { MapSymbolAnimSetInit } from './map-symbol-anim-set.command';
// WP-4.8 win presentation sequencer authoring
export { CreateWinSequenceCommand, createWinSequenceSpec } from './create-win-sequence.command';
export { SetWinSequenceStepCommand, setWinSequenceStepSpec } from './set-win-sequence-step.command';
export {
  ReorderWinSequenceStepCommand,
  reorderWinSequenceStepSpec,
} from './reorder-win-sequence-step.command';
export {
  SetEscalationThresholdCommand,
  setEscalationThresholdSpec,
} from './set-escalation-threshold.command';
// WP-4.9 feature + free-spin flow graph authoring
export {
  CreateFeatureFlowStateCommand,
  createFeatureFlowStateSpec,
} from './create-feature-flow-state.command';
export {
  AddFeatureFlowTransitionCommand,
  addFeatureFlowTransitionSpec,
} from './add-feature-flow-transition.command';
export {
  DeleteFeatureFlowStateCommand,
  deleteFeatureFlowStateSpec,
} from './delete-feature-flow-state.command';
export {
  RenameFeatureFlowStateCommand,
  renameFeatureFlowStateSpec,
} from './rename-feature-flow-state.command';
export {
  RemoveFeatureFlowTransitionCommand,
  removeFeatureFlowTransitionSpec,
} from './remove-feature-flow-transition.command';
// WP-4.10 tumble / cascade choreography authoring
export {
  SetTumbleChoreographyCommand,
  setTumbleChoreographySpec,
} from './set-tumble-choreography.command';
// Stage F1 (PP-D9) event definition + event/draw-order timeline + document metadata authoring
export { DefineEventCommand, defineEventSpec } from './define-event.command';
export type { EventDefInit } from './define-event.command';
export { RenameEventCommand, renameEventSpec } from './rename-event.command';
export { DeleteEventCommand, deleteEventSpec } from './delete-event.command';
export { SetEventDefaultsCommand, setEventDefaultsSpec } from './set-event-defaults.command';
export type { EventDefaults } from './set-event-defaults.command';
export { SetEventAudioCommand, setEventAudioSpec } from './set-event-audio.command';
export { SetEventKeyCommand, setEventKeySpec } from './set-event-key.command';
export type { EventKeyOverrides } from './set-event-key.command';
export { MoveEventKeyCommand, moveEventKeySpec } from './move-event-key.command';
export { DeleteEventKeyCommand, deleteEventKeySpec } from './delete-event-key.command';
export { SetDrawOrderKeyCommand, setDrawOrderKeySpec } from './set-draw-order-key.command';
export { MoveDrawOrderKeyCommand, moveDrawOrderKeySpec } from './move-draw-order-key.command';
export { DeleteDrawOrderKeyCommand, deleteDrawOrderKeySpec } from './delete-draw-order-key.command';
export {
  SetDocumentMetadataCommand,
  setDocumentMetadataSpec,
} from './set-document-metadata.command';
export { sortEventKeysByTime } from './event-support';
export { assertConsistentDrawOrder, sortDrawOrderKeysByTime } from './draw-order-support';
export {
  assertValidGridConfig,
  preset5x3ReelStrip,
  preset6x5ScatterPay,
  preset7x7Cluster,
} from './slot-scene-support';
export { commandRegistry } from './registry';
export type { CommandSpec, CommandFixture } from './spec';
export {
  findBoneSnapshot,
  findSlotSnapshot,
  findAttachmentSnapshot,
  findAnimationSnapshot,
} from './spec';
