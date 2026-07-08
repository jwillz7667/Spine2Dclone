import { addBoneToMeshBindingSpec } from './add-bone-to-mesh-binding.command';
import { addMeshVertexSpec } from './add-mesh-vertex.command';
import { clearAttachmentDeformSpec } from './clear-attachment-deform.command';
import { createIkConstraintSpec } from './create-ik-constraint.command';
import { createSkinSpec } from './create-skin.command';
import { createTransformConstraintSpec } from './create-transform-constraint.command';
import { deleteDeformKeyframeSpec } from './delete-deform-keyframe.command';
import { deleteIkConstraintSpec } from './delete-ik-constraint.command';
import { deleteIkKeyframeSpec } from './delete-ik-keyframe.command';
import { deleteSkinSpec } from './delete-skin.command';
import { deleteTransformConstraintSpec } from './delete-transform-constraint.command';
import { deleteTransformKeyframeSpec } from './delete-transform-keyframe.command';
import { moveDeformKeyframeSpec } from './move-deform-keyframe.command';
import { removeSkinAttachmentSpec } from './remove-skin-attachment.command';
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
import { setMeshEdgesSpec } from './set-mesh-edges.command';
import { setRegionAttachmentTransformSpec } from './set-region-attachment-transform.command';
import { setSlotBlendModeSpec } from './set-slot-blend-mode.command';
import { setSlotColorSpec } from './set-slot-color.command';
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
  createSlotSpec,
  deleteSlotSpec,
  renameSlotSpec,
  setSlotBlendModeSpec,
  setSlotColorSpec,
  reorderSlotSpec,
  addRegionAttachmentSpec,
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
  // WP-2.7 transform constraint authoring
  createTransformConstraintSpec,
  setTransformConstraintParamsSpec,
  deleteTransformConstraintSpec,
  setTransformKeyframeSpec,
  deleteTransformKeyframeSpec,
  // WP-2.8 named skins
  createSkinSpec,
  renameSkinSpec,
  deleteSkinSpec,
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
];
