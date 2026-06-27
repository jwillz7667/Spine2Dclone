import { addRegionAttachmentSpec } from './add-region-attachment.command';
import { createBoneSpec } from './create-bone.command';
import { createSlotSpec } from './create-slot.command';
import { deleteBoneSpec } from './delete-bone.command';
import { deleteSlotSpec } from './delete-slot.command';
import { moveBoneSpec } from './move-bone.command';
import { normalizeBoneRotationSpec } from './normalize-bone-rotation.command';
import { removeAttachmentSpec } from './remove-attachment.command';
import { renameBoneSpec } from './rename-bone.command';
import { renameSlotSpec } from './rename-slot.command';
import { reorderSlotSpec } from './reorder-slot.command';
import { reparentBoneSpec } from './reparent-bone.command';
import { rotateBoneSpec } from './rotate-bone.command';
import { scaleBoneSpec } from './scale-bone.command';
import { setActiveAttachmentSpec } from './set-active-attachment.command';
import { setBoneLengthSpec } from './set-bone-length.command';
import { setBoneTransformModeSpec } from './set-bone-transform-mode.command';
import { setRegionAttachmentTransformSpec } from './set-region-attachment-transform.command';
import { setSlotBlendModeSpec } from './set-slot-blend-mode.command';
import { setSlotColorSpec } from './set-slot-color.command';
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
  setRegionAttachmentTransformSpec,
];
