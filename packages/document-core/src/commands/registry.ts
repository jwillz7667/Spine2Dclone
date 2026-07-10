import { addBoneToMeshBindingSpec } from './add-bone-to-mesh-binding.command';
import { addMeshVertexSpec } from './add-mesh-vertex.command';
import { clearAttachmentDeformSpec } from './clear-attachment-deform.command';
import { createIkConstraintSpec } from './create-ik-constraint.command';
import { createPathConstraintSpec } from './create-path-constraint.command';
import { deletePathConstraintSpec } from './delete-path-constraint.command';
import { setPathConstraintParamsSpec } from './set-path-constraint-params.command';
import { setPathKeyframeSpec } from './set-path-keyframe.command';
import { deletePathKeyframeSpec } from './delete-path-keyframe.command';
import { movePathKeyframeSpec } from './move-path-keyframe.command';
import { createPhysicsConstraintSpec } from './create-physics-constraint.command';
import { deletePhysicsConstraintSpec } from './delete-physics-constraint.command';
import { renamePhysicsConstraintSpec } from './rename-physics-constraint.command';
import { setPhysicsConstraintTargetBoneSpec } from './set-physics-constraint-target-bone.command';
import { setPhysicsConstraintChannelsSpec } from './set-physics-constraint-channels.command';
import { setPhysicsConstraintParamsSpec } from './set-physics-constraint-params.command';
import { setPhysicsSettingsSpec } from './set-physics-settings.command';
import { setPhysicsKeyframeSpec } from './set-physics-keyframe.command';
import { movePhysicsKeyframeSpec } from './move-physics-keyframe.command';
import { deletePhysicsKeyframeSpec } from './delete-physics-keyframe.command';
import { createPathAttachmentSpec } from './create-path-attachment.command';
import { movePathControlPointSpec } from './move-path-control-point.command';
import { deletePathControlPointSpec } from './delete-path-control-point.command';
import { addPathCurveSpec } from './add-path-curve.command';
import { removePathCurveSpec } from './remove-path-curve.command';
import { setPathClosedSpec } from './set-path-closed.command';
import { setPathConstantSpeedSpec } from './set-path-constant-speed.command';
import { createSkinSpec } from './create-skin.command';
import { createTransformConstraintSpec } from './create-transform-constraint.command';
import { deleteDeformKeyframeSpec } from './delete-deform-keyframe.command';
import { deleteIkConstraintSpec } from './delete-ik-constraint.command';
import { deleteIkKeyframeSpec } from './delete-ik-keyframe.command';
import { deleteSkinSpec } from './delete-skin.command';
import { deleteTransformConstraintSpec } from './delete-transform-constraint.command';
import { deleteTransformKeyframeSpec } from './delete-transform-keyframe.command';
import { moveDeformKeyframeSpec } from './move-deform-keyframe.command';
import { addSkinScopeSpec } from './add-skin-scope.command';
import { removeSkinAttachmentSpec } from './remove-skin-attachment.command';
import { removeSkinScopeSpec } from './remove-skin-scope.command';
import { renameSkinSpec } from './rename-skin.command';
import { setDeformKeyframeSpec } from './set-deform-keyframe.command';
import { setGridConfigSpec } from './set-grid-config.command';
import { mapSymbolAnimSetSpec } from './map-symbol-anim-set.command';
import { createWinSequenceSpec } from './create-win-sequence.command';
import { setWinSequenceStepSpec } from './set-win-sequence-step.command';
import { reorderWinSequenceStepSpec } from './reorder-win-sequence-step.command';
import { createFeatureFlowStateSpec } from './create-feature-flow-state.command';
import { addFeatureFlowTransitionSpec } from './add-feature-flow-transition.command';
import { deleteFeatureFlowStateSpec } from './delete-feature-flow-state.command';
import { renameFeatureFlowStateSpec } from './rename-feature-flow-state.command';
import { removeFeatureFlowTransitionSpec } from './remove-feature-flow-transition.command';
import { setTumbleChoreographySpec } from './set-tumble-choreography.command';
import { setEscalationThresholdSpec } from './set-escalation-threshold.command';
import { defineEventSpec } from './define-event.command';
import { renameEventSpec } from './rename-event.command';
import { deleteEventSpec } from './delete-event.command';
import { setEventDefaultsSpec } from './set-event-defaults.command';
import { setEventAudioSpec } from './set-event-audio.command';
import { setEventKeySpec } from './set-event-key.command';
import { moveEventKeySpec } from './move-event-key.command';
import { deleteEventKeySpec } from './delete-event-key.command';
import { setDrawOrderKeySpec } from './set-draw-order-key.command';
import { moveDrawOrderKeySpec } from './move-draw-order-key.command';
import { deleteDrawOrderKeySpec } from './delete-draw-order-key.command';
import { setDocumentMetadataSpec } from './set-document-metadata.command';
import { setIkBendPositiveSpec } from './set-ik-bend-positive.command';
import { setIkKeyframeSpec } from './set-ik-keyframe.command';
import { setIkMixSpec } from './set-ik-mix.command';
import { setSkinAttachmentSpec } from './set-skin-attachment.command';
import { setTransformConstraintParamsSpec } from './set-transform-constraint-params.command';
import { setTransformKeyframeSpec } from './set-transform-keyframe.command';
import { addRegionAttachmentSpec } from './add-region-attachment.command';
import { autoGridFillMeshSpec } from './auto-grid-fill-mesh.command';
import { autoPerimeterTraceMeshSpec } from './auto-perimeter-trace-mesh.command';
import { autoWeightFromProximitySpec } from './auto-weight-from-proximity.command';
import { bindMeshToBonesSpec } from './bind-mesh-to-bones.command';
import { createAnimationSpec } from './create-animation.command';
import { createBoneSpec } from './create-bone.command';
import { createSlotSpec } from './create-slot.command';
import { deleteAnimationSpec } from './delete-animation.command';
import { deleteBoneSpec } from './delete-bone.command';
import { deleteKeyframeSpec } from './delete-keyframe.command';
import { deleteMeshVertexSpec } from './delete-mesh-vertex.command';
import { deleteSlotSpec } from './delete-slot.command';
import { duplicateAnimationSpec } from './duplicate-animation.command';
import { generateMeshFromRegionSpec } from './generate-mesh-from-region.command';
import { moveBoneSpec } from './move-bone.command';
import { moveKeyframeSpec } from './move-keyframe.command';
import { moveMeshVertexSpec } from './move-mesh-vertex.command';
import { normalizeBoneRotationSpec } from './normalize-bone-rotation.command';
import { normalizeMeshWeightsSpec } from './normalize-mesh-weights.command';
import { paintWeightStrokeSpec } from './paint-weight-stroke.command';
import { removeBoneFromMeshBindingSpec } from './remove-bone-from-mesh-binding.command';
import { pasteKeyframesSpec } from './paste-keyframes.command';
import { removeAttachmentSpec } from './remove-attachment.command';
import { renameAnimationSpec } from './rename-animation.command';
import { renameBoneSpec } from './rename-bone.command';
import { renameSlotSpec } from './rename-slot.command';
import { reorderSlotSpec } from './reorder-slot.command';
import { reparentBoneSpec } from './reparent-bone.command';
import { pasteBoneSubtreeSpec } from './paste-bone-subtree.command';
import { rotateBoneSpec } from './rotate-bone.command';
import { scaleBoneSpec } from './scale-bone.command';
import { setBoneShearSpec } from './set-bone-shear.command';
import { setActiveAttachmentSpec } from './set-active-attachment.command';
import { setAnimationDurationSpec } from './set-animation-duration.command';
import { setAtlasRefSpec } from './set-atlas-ref.command';
import { setBoneLengthSpec } from './set-bone-length.command';
import { setBoneTransformModeSpec } from './set-bone-transform-mode.command';
import { setCurveSpec } from './set-curve.command';
import { setKeyframeSpec } from './set-keyframe.command';
import { setAttachmentKeyframeSpec } from './set-attachment-keyframe.command';
import { deleteAttachmentKeyframeSpec } from './delete-attachment-keyframe.command';
import { moveAttachmentKeyframeSpec } from './move-attachment-keyframe.command';
import { moveIkKeyframeSpec } from './move-ik-keyframe.command';
import { moveTransformKeyframeSpec } from './move-transform-keyframe.command';
import { setIkDepthParamsSpec } from './set-ik-depth-params.command';
import { setTransformConstraintVariantsSpec } from './set-transform-constraint-variants.command';
import { reorderConstraintsSpec } from './reorder-constraints.command';
import { createLinkedMeshSpec } from './create-linked-mesh.command';
import { unlinkMeshSpec } from './unlink-mesh.command';
import { setAttachmentSequenceSpec } from './set-attachment-sequence.command';
import { setSequenceKeyframeSpec } from './set-sequence-keyframe.command';
import { moveSequenceKeyframeSpec } from './move-sequence-keyframe.command';
import { deleteSequenceKeyframeSpec } from './delete-sequence-keyframe.command';
import { setMeshEdgesSpec } from './set-mesh-edges.command';
import { setRegionAttachmentTransformSpec } from './set-region-attachment-transform.command';
import { setSlotBlendModeSpec } from './set-slot-blend-mode.command';
import { setSlotColorSpec } from './set-slot-color.command';
import { setSlotDarkColorSpec } from './set-slot-dark-color.command';
import { unbindMeshSpec } from './unbind-mesh.command';
import type { CommandSpec } from './spec';

// The single discovery point (command-history Section 10.1): every command file appends its spec here.
// The discovery guard globs *.command.ts and fails CI if any command kind is missing from this list or
// any entry lacks its file, so the mandatory do/undo round-trip cannot be silently skipped.
export const commandRegistry: readonly CommandSpec[] = [
  createBoneSpec,
  moveBoneSpec,
  rotateBoneSpec,
  scaleBoneSpec,
  setBoneShearSpec,
  setBoneLengthSpec,
  setBoneTransformModeSpec,
  normalizeBoneRotationSpec,
  renameBoneSpec,
  reparentBoneSpec,
  deleteBoneSpec,
  // PP-D7 bone copy/paste/duplicate
  pasteBoneSubtreeSpec,
  createSlotSpec,
  deleteSlotSpec,
  renameSlotSpec,
  setSlotBlendModeSpec,
  setSlotColorSpec,
  setSlotDarkColorSpec,
  reorderSlotSpec,
  addRegionAttachmentSpec,
  // PP-D10 (Stage F2) linked meshes
  createLinkedMeshSpec,
  unlinkMeshSpec,
  // PP-D10 (Stage F2) attachment frame-sequence
  setAttachmentSequenceSpec,
  // PP-D10 (Stage F2) slot sequence timeline
  setSequenceKeyframeSpec,
  moveSequenceKeyframeSpec,
  deleteSequenceKeyframeSpec,
  removeAttachmentSpec,
  setActiveAttachmentSpec,
  setAtlasRefSpec,
  setRegionAttachmentTransformSpec,
  createAnimationSpec,
  deleteAnimationSpec,
  renameAnimationSpec,
  setAnimationDurationSpec,
  setKeyframeSpec,
  moveKeyframeSpec,
  deleteKeyframeSpec,
  setAttachmentKeyframeSpec,
  deleteAttachmentKeyframeSpec,
  moveAttachmentKeyframeSpec,
  setCurveSpec,
  duplicateAnimationSpec,
  pasteKeyframesSpec,
  // WP-2.1 mesh creation/editing
  generateMeshFromRegionSpec,
  addMeshVertexSpec,
  moveMeshVertexSpec,
  deleteMeshVertexSpec,
  setMeshEdgesSpec,
  autoGridFillMeshSpec,
  autoPerimeterTraceMeshSpec,
  // WP-2.3 mesh-to-bone binding
  bindMeshToBonesSpec,
  addBoneToMeshBindingSpec,
  removeBoneFromMeshBindingSpec,
  unbindMeshSpec,
  // WP-2.4 weight painting
  autoWeightFromProximitySpec,
  paintWeightStrokeSpec,
  normalizeMeshWeightsSpec,
  // WP-2.6 IK constraint authoring
  createIkConstraintSpec,
  setIkMixSpec,
  setIkBendPositiveSpec,
  deleteIkConstraintSpec,
  setIkKeyframeSpec,
  deleteIkKeyframeSpec,
  moveIkKeyframeSpec,
  // PP-D10 (Stage F2) IK depth authoring
  setIkDepthParamsSpec,
  // WP-2.7 transform constraint authoring
  createTransformConstraintSpec,
  setTransformConstraintParamsSpec,
  setTransformConstraintVariantsSpec,
  deleteTransformConstraintSpec,
  setTransformKeyframeSpec,
  deleteTransformKeyframeSpec,
  moveTransformKeyframeSpec,
  // PP-D10 (Stage F2) cross-array constraint solve order
  reorderConstraintsSpec,
  // WP-2.8 named skins
  createSkinSpec,
  renameSkinSpec,
  deleteSkinSpec,
  addSkinScopeSpec,
  removeSkinScopeSpec,
  setSkinAttachmentSpec,
  removeSkinAttachmentSpec,
  // WP-2.9 deform timelines
  setDeformKeyframeSpec,
  deleteDeformKeyframeSpec,
  moveDeformKeyframeSpec,
  clearAttachmentDeformSpec,
  // WP-4.5 / WP-4.6 slot-scene authoring
  setGridConfigSpec,
  mapSymbolAnimSetSpec,
  // WP-4.8 win presentation sequencer authoring
  createWinSequenceSpec,
  setWinSequenceStepSpec,
  reorderWinSequenceStepSpec,
  setEscalationThresholdSpec,
  // WP-4.9 feature + free-spin flow graph authoring
  createFeatureFlowStateSpec,
  addFeatureFlowTransitionSpec,
  deleteFeatureFlowStateSpec,
  renameFeatureFlowStateSpec,
  removeFeatureFlowTransitionSpec,
  // WP-4.10 tumble / cascade choreography authoring
  setTumbleChoreographySpec,
  // Stage F1 (PP-D9) event definition authoring
  defineEventSpec,
  renameEventSpec,
  deleteEventSpec,
  setEventDefaultsSpec,
  setEventAudioSpec,
  // Stage F1 (PP-D9) event timeline authoring
  setEventKeySpec,
  moveEventKeySpec,
  deleteEventKeySpec,
  // Stage F1 (PP-D9) draw-order timeline authoring
  setDrawOrderKeySpec,
  moveDrawOrderKeySpec,
  deleteDrawOrderKeySpec,
  // Stage F1 (PP-D9) document metadata authoring
  setDocumentMetadataSpec,
  // Stage F3 (PP-D11) path attachment authoring
  createPathAttachmentSpec,
  movePathControlPointSpec,
  deletePathControlPointSpec,
  addPathCurveSpec,
  removePathCurveSpec,
  setPathClosedSpec,
  setPathConstantSpeedSpec,
  // Stage F3 (PP-D11) path constraint authoring
  createPathConstraintSpec,
  setPathConstraintParamsSpec,
  deletePathConstraintSpec,
  // Stage F3 (PP-D11) path constraint timeline authoring
  setPathKeyframeSpec,
  movePathKeyframeSpec,
  deletePathKeyframeSpec,
  // Stage F4 (PP-D12) physics constraint authoring
  createPhysicsConstraintSpec,
  deletePhysicsConstraintSpec,
  renamePhysicsConstraintSpec,
  setPhysicsConstraintTargetBoneSpec,
  setPhysicsConstraintChannelsSpec,
  setPhysicsConstraintParamsSpec,
  setPhysicsSettingsSpec,
  // Stage F4 (PP-D12) physics constraint timeline authoring
  setPhysicsKeyframeSpec,
  movePhysicsKeyframeSpec,
  deletePhysicsKeyframeSpec,
];
