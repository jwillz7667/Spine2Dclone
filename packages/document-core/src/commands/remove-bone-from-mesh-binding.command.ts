import {
  decodeWeightedVertices,
  encodeWeightedVertices,
  type WeightedInfluence,
} from '@marionette/format';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, MeshBindingError } from '../command/errors';
import { meshGeometryOf, type MeshGeometry } from '../model/doc-state';
import type { BoneId, SlotId } from '../model/ids';
import { distanceToSegment, finalizeVertexWeights } from '../weights';
import { requireWeightedMesh } from './mesh-support';
import { boneSegment, solveSetupWorld, toBindLocal, vertexWorldPosition } from './setup-world';
import { findAttachmentSnapshot, type CommandSpec } from './spec';
import type { SetupWorldSolve } from './setup-world';

// Remove one bone's influence from a weighted mesh and re-normalize the affected vertices (command-history
// catalog RemoveBoneFromMeshBinding, `mesh.removeBoneBinding`; TASK-2.3.3). A vertex that still has other
// influences just drops this bone and re-normalizes (proportions of the survivors preserved); a vertex
// whose ONLY influence was the removed bone falls back to its nearest remaining BOUND bone (weight 1) so
// it keeps at least one influence. Removing the mesh's only bound bone is rejected (lastBone): that is
// what UnbindMesh is for. Rejected if the bone is not bound (boneNotBound) or the mesh is unweighted
// (notWeighted). The prior weighted geometry is the before memento. NOT coalescing.
export class RemoveBoneFromMeshBindingCommand implements Command {
  readonly kind = 'mesh.removeBoneBinding';
  readonly label = 'Remove Bone From Mesh Binding';
  private before: MeshGeometry | undefined;
  private after: MeshGeometry | undefined;

  constructor(
    private readonly slotId: SlotId,
    private readonly name: string,
    private readonly boneId: BoneId,
  ) {}

  do(ctx: CommandContext): void {
    const mesh = requireWeightedMesh(ctx, this.kind, this.slotId, this.name);
    if (this.before === undefined || this.after === undefined) {
      const setup = solveSetupWorld(ctx.mutate);
      const removeIndex = setup.indexById.get(this.boneId);
      if (removeIndex === undefined) {
        throw new MeshBindingError(this.slotId, this.name, 'boneMissing', this.boneId);
      }
      const manifest = mesh.bones ?? [];
      if (!manifest.includes(removeIndex)) {
        throw new MeshBindingError(this.slotId, this.name, 'boneNotBound', this.boneId);
      }
      if (manifest.length <= 1) {
        throw new MeshBindingError(this.slotId, this.name, 'lastBone', this.boneId);
      }

      const decoded = decodeWeightedVertices({ vertices: [...mesh.vertices] });
      const bindings = decoded.map((influences) => {
        const remaining = influences.filter((inf) => inf.boneIndex !== removeIndex);
        if (remaining.length > 0) return finalizeVertexWeights(remaining);
        const [wx, wy] = vertexWorldPosition(influences, setup.worldByIndex);
        return [nearestRemainingInfluence(wx, wy, manifest, removeIndex, setup)];
      });
      const { vertices, bones } = encodeWeightedVertices(bindings);
      this.before = meshGeometryOf(mesh);
      this.after = { ...this.before, vertices, bones };
    }
    ctx.mutate.setMeshGeometry(this.slotId, this.name, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setMeshGeometry(this.slotId, this.name, this.before);
  }
}

// Pick the bound bone nearest a vertex (excluding the removed one) and bind the vertex rigidly to it
// (weight 1). The caller guarantees the manifest has at least two bones, so a remaining bone always
// exists; the loop is a deterministic nearest-by-distance-to-segment scan.
function nearestRemainingInfluence(
  wx: number,
  wy: number,
  manifest: readonly number[],
  removeIndex: number,
  setup: SetupWorldSolve,
): WeightedInfluence {
  let bestIndex = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const boneIndex of manifest) {
    if (boneIndex === removeIndex) continue;
    const world = setup.worldByIndex[boneIndex]!;
    const [ax, ay, bx, by] = boneSegment(world, setup.bones[boneIndex]!.length);
    const dist = distanceToSegment(wx, wy, ax, ay, bx, by);
    if (dist < bestDist) {
      bestDist = dist;
      bestIndex = boneIndex;
    }
  }
  const world = setup.worldByIndex[bestIndex]!;
  const [vx, vy] = toBindLocal(world, wx, wy);
  return { boneIndex: bestIndex, vx, vy, weight: 1 };
}

export const removeBoneFromMeshBindingSpec: CommandSpec = {
  kind: 'mesh.removeBoneBinding',
  // 'weighted' carries a mesh bound to [root, arm]; removing one leaves the other.
  representativeSeedId: 'weighted',
  fixture: (model) => {
    for (const slot of model.slots()) {
      const att = model
        .attachments(slot.id)
        .find((a) => a.kind === 'mesh' && a.bones !== undefined);
      if (!att || att.kind !== 'mesh' || att.bones === undefined || att.bones.length < 2) continue;
      const bones = model.bones();
      const boneId = bones[att.bones[0]!]?.id;
      if (boneId === undefined) continue;
      return { command: new RemoveBoneFromMeshBindingCommand(slot.id, att.name, boneId) };
    }
    return null;
  },
  assertApplied: (before, after) => {
    let removed = false;
    for (const b of before.attachments) {
      if (b.kind !== 'mesh' || b.bones === undefined) continue;
      const a = findAttachmentSnapshot(after, b.slotId, b.name);
      if (a && a.kind === 'mesh' && a.bones !== undefined && a.bones.length < b.bones.length) {
        removed = true;
      }
    }
    if (!removed) throw new Error('mesh.removeBoneBinding did not drop a bone from the binding');
  },
};
