import { addBoneToMeshBindingSpec } from './add-bone-to-mesh-binding.command';
import { addMeshVertexSpec } from './add-mesh-vertex.command';
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
import { setActiveAttachmentSpec } from './set-active-attachment.command';
import { setAnimationDurationSpec } from './set-animation-duration.command';
import { setAtlasRefSpec } from './set-atlas-ref.command';
import { setBoneLengthSpec } from './set-bone-length.command';
import { setBoneTransformModeSpec } from './set-bone-transform-mode.command';
import { setCurveSpec } from './set-curve.command';
import { setKeyframeSpec } from './set-keyframe.command';
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
];
