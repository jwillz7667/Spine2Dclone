import type { DocumentReadModel } from '../model/read-model';
import { DocumentInvariantError } from './errors';

// Dev/test invariant guard (command-history Section 3.5). Verifies the bone graph: every parent
// reference resolves, and parents precede children in boneOrder (the format invariant the world-pass
// relies on). It does NOT check name uniqueness, because that is an export-only contract (D9): a
// transient name collision is a legal internal state. The round-trip harness runs this after every do
// and every undo. A violation is a typed DocumentInvariantError, never a thrown string. Never called
// in a render loop.
export function assertInvariants(model: DocumentReadModel): void {
  const bones = model.bones(); // in boneOrder
  const indexById = new Map<string, number>();
  for (let i = 0; i < bones.length; i += 1) {
    const bone = bones[i];
    if (bone) indexById.set(bone.id, i);
  }
  for (let i = 0; i < bones.length; i += 1) {
    const bone = bones[i];
    if (!bone || bone.parent === null) continue;
    const parentIndex = indexById.get(bone.parent);
    if (parentIndex === undefined) {
      throw new DocumentInvariantError(
        `bone "${bone.name}" references parent ${bone.parent}, which does not exist`,
      );
    }
    if (parentIndex >= i) {
      throw new DocumentInvariantError(
        `bone "${bone.name}" must appear after its parent (parents precede children)`,
      );
    }
  }
}
