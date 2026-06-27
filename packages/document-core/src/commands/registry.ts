import { createBoneSpec } from './create-bone.command';
import { deleteBoneSpec } from './delete-bone.command';
import { moveBoneSpec } from './move-bone.command';
import { normalizeBoneRotationSpec } from './normalize-bone-rotation.command';
import { renameBoneSpec } from './rename-bone.command';
import { reparentBoneSpec } from './reparent-bone.command';
import { rotateBoneSpec } from './rotate-bone.command';
import { scaleBoneSpec } from './scale-bone.command';
import { setBoneLengthSpec } from './set-bone-length.command';
import { setBoneTransformModeSpec } from './set-bone-transform-mode.command';
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
];
