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
export { DeleteBoneCommand, deleteBoneSpec } from './delete-bone.command';
export { commandRegistry } from './registry';
export type { CommandSpec, CommandFixture } from './spec';
export { findBoneSnapshot } from './spec';
